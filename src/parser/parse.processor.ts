import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import type { Browser, Page } from 'puppeteer';
import { PARSE_QUEUE } from './queue.constants';
import { ResultWebhookService } from './webhook.service';
import puppeteerExtra from 'puppeteer-extra';
import { faker } from '@faker-js/faker';
import { createHash } from 'crypto';
import type { HTTPResponse } from 'puppeteer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Processor(PARSE_QUEUE)
export class ParseProcessor {
  private readonly logger = new Logger(ParseProcessor.name);
  constructor(private readonly webhook: ResultWebhookService) {}

  @Process({
    name: 'parse',
    concurrency: 2,
  })
  async handle(job: Job<any>) {
    this.logger.log(
      '================================================================',
    );
    this.logger.log(`Получен JOB: ${JSON.stringify(job.data)}`);

    const { leadId, fields, url, webhookUrl } = job.data as {
      leadId: string;
      fields: string[];
      url: string;
      webhookUrl: string;
    };

    this.logger.log(
      `Начало обработки: id=${job.id} lead=${leadId} поля=[${fields.join(',')}] url=${url} webhook=${webhookUrl}`,
    );

    let browser: Browser | null = null;
    try {
      this.logger.log(`Запуск puppeteer...`);
      browser = await puppeteerExtra.launch();
      this.logger.log(`Браузер запущен: ${!!browser}`);

      const page = await browser.newPage();
      this.logger.log(`Создана новая вкладка`);

      // Базовый UA (потом будем менять при ретраях)
      const ua = faker.internet.userAgent();
      await page.setUserAgent(ua);
      this.logger.log(`Установлен User-Agent: ${ua}`);

      // Отключаем кэш на старте
      await page.setCacheEnabled(false);

      // --- НАВИГАЦИЯ С РЕТРАЯМИ/429 + ожидание главного ответа + лог HTML/куки/заголовков ---
      const resp = await this.gotoWithRetries(page, url, 3);
      const status = resp?.status();
      if (status === 429 || status === 503) {
        this.logger.error(
          `Не удалось обойти ${status} после повторных попыток`,
        );
        // При желании можно бросить ошибку для повторной постановки job
        // throw new Error(`HTTP ${status}`);
      }

      await sleep(800);

      this.logger.log(`Попытка извлечь адрес (первая попытка)`);
      let value = await this.extractAddressFromPage(page);
      this.logger.log(`Извлечённое значение: ${value}`);

      if (!value) {
        this.logger.log(
          'Адрес не найден, выполняем повторную загрузку и проверку изменения контента',
        );
        let beforeHash = '';
        try {
          beforeHash = this.sha256(await page.content());
        } catch {}

        await page.setCacheEnabled(false);
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
          this.logger.log(`Повторная загрузка выполнена`);
        } catch (e) {
          this.logger.warn(`Ошибка при повторной загрузке: ${e}`);
        }

        let afterHash = '';
        try {
          afterHash = this.sha256(await page.content());
        } catch {}
        this.logger.log(
          `Контент-хэш: до=${beforeHash.slice(0, 8)} после=${afterHash.slice(0, 8)} ${beforeHash === afterHash ? '(без изменений)' : '(изменился)'}`,
        );

        // Доп. лог после reload
        await this.logCookies(page, url);
        try {
          const htmlPreview = this.safeLogHtml(await page.content());
          this.logger.log(`HTML превью после reload: ${htmlPreview}`);
        } catch {}

        value = await this.extractAddressFromPage(page);
        this.logger.log(
          `Извлечённое значение после повторной загрузки: ${value}`,
        );
      }

      const payload = {
        leadId,
        url,
        results: [value],
        extractedAt: new Date().toISOString(),
        jobId: job.id,
      };
      this.logger.log(
        `Отправка в webhook: ${webhookUrl}, данные=${JSON.stringify(payload)}`,
      );

      await this.webhook.send(webhookUrl, payload);

      this.logger.log(
        `Результат успешно отправлен: lead=${leadId} поля=[${fields.join(',')}]`,
      );
      return 'ok';
    } catch (err: any) {
      this.logger.error(`Ошибка при парсинге: ${err?.message || err}`);
      throw err;
    } finally {
      if (browser) {
        try {
          this.logger.log(`Закрытие браузера...`);
          await browser.close();
          this.logger.log(`Браузер закрыт`);
        } catch (closeErr) {
          this.logger.warn(`Ошибка при закрытии браузера: ${closeErr}`);
        }
      }
      this.logger.log(
        '================================================================',
      );
    }
  }

  private async extractAddressFromPage(page: Page): Promise<string | null> {
    this.logger.log(`extractAddressFromPage: старт`);
    const result = await page.evaluate(() => {
      const norm = (s?: string | null) =>
        (s || '')
          .replace(/\u00A0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim() || null;

      const mainP = document.querySelector(
        '[data-marker="delivery/location"] p',
      ) as HTMLElement | null;
      const t1 = norm(mainP?.innerText || mainP?.textContent);
      if (t1) return t1;

      const mainDiv = document.querySelector(
        '[data-marker="delivery/location"]',
      ) as HTMLElement | null;
      const t2 = norm(mainDiv?.innerText || mainDiv?.textContent);
      if (t2) return t2;

      const geo = document.querySelector(
        '[data-marker="item-view/item-geo"]',
      ) as HTMLElement | null;
      const t3 = norm(geo?.innerText || geo?.textContent);
      if (t3) return t3;

      const byItemprop = document.querySelector(
        '[itemprop="address"]',
      ) as HTMLElement | null;
      const t4 = norm(byItemprop?.innerText || byItemprop?.textContent);
      if (t4) return t4;

      const title = Array.from(
        document.querySelectorAll('h2, h3, div, span'),
      ).find((el) => (el.textContent || '').trim() === 'Расположение');
      if (title) {
        const container = title.parentElement || title;
        const cand = container.querySelector(
          'span, p, div',
        ) as HTMLElement | null;
        const t5 = norm(cand?.innerText || cand?.textContent);
        if (t5) return t5;
      }

      return null;
    });
    this.logger.log(`extractAddressFromPage: результат=${result}`);
    return result;
  }

  // ===== ХЕЛПЕРЫ ДЛЯ БЕЗОПАСНОГО ЛОГИРОВАНИЯ/СРАВНЕНИЯ =====

  private safeLogHtml(html: string | null | undefined, maxLen = 2000): string {
    const s = (html ?? '').replace(/\s+/g, ' ').trim();
    if (!s) return '[пусто]';
    return s.length > maxLen ? s.slice(0, maxLen) + '…[обрезано]' : s;
  }

  private sha256(s: string): string {
    return createHash('sha256')
      .update(s || '')
      .digest('hex');
  }

  // ===== "ОТПЕЧАТКИ" + ЛОГИ КУКИ/ЗАГОЛОВКОВ =====

  /** Случайные отпечатки (UA, язык, viewport, заголовки) на попытку */
  private async applyRandomFingerprint(page: Page, attempt: number) {
    // 👉 если у тебя есть свой генератор, просто замени следующую строку на: const ua = uaFaker.random();
    const ua = faker.internet.userAgent();

    // немного варьируем язык между попытками
    const acceptLanguage =
      attempt % 2 === 0
        ? 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
        : 'ru,en-US;q=0.8,en;q=0.6';

    // чуть-чуть варьируем viewport
    const width = 1280 + Math.floor(Math.random() * 40);
    const height = 800 + Math.floor(Math.random() * 40);

    await page.setUserAgent(ua);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': acceptLanguage,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
    });

    this.logger.log(
      `Отпечаток установлен: UA="${ua}", Lang="${acceptLanguage}", viewport=${width}x${height}`,
    );
  }

  private logResponseHeaders(resp: HTTPResponse | null, limit = 12) {
    if (!resp) {
      this.logger.warn('Заголовки ответа: нет объекта ответа');
      return;
    }
    const headers = resp.headers();
    const keys = Object.keys(headers);
    const preview = keys.slice(0, limit).reduce(
      (acc, k) => {
        acc[k] = headers[k];
        return acc;
      },
      {} as Record<string, string>,
    );
    this.logger.log(
      `Заголовки ответа (первые ${Math.min(limit, keys.length)}): ${JSON.stringify(preview)}`,
    );
  }

  private async logCookies(page: Page, forUrl: string) {
    const cookies = await page.cookies(forUrl);
    const names = cookies.map((c) => c.name);
    this.logger.log(
      `Куки: всего=${cookies.length}, имена=[${names.join(', ')}]`,
    );
  }

  private async gotoWithRetries(page: Page, url: string, maxAttempts = 3) {
    let lastResp: HTTPResponse | null = null;
    const base = url.split('?')[0];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.applyRandomFingerprint(page, attempt);
      await page.setCacheEnabled(false); // отключаем кэш перед попыткой

      this.logger.log(
        `Навигация (попытка ${attempt}/${maxAttempts}) url=${url}`,
      );

      const waitMainResponse = page
        .waitForResponse(
          (resp) => {
            try {
              const req = resp.request();
              return req.isNavigationRequest() && resp.url().startsWith(base);
            } catch {
              return false;
            }
          },
          { timeout: 60_000 },
        )
        .catch(() => null);

      lastResp = await page
        .goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        .catch(() => null);

      const mainResp = await waitMainResponse;
      if (mainResp) lastResp = mainResp as HTTPResponse;

      const status = lastResp?.status();
      const finalUrl = lastResp?.url();
      this.logger.log(
        `Результат навигации: статус=${status ?? 'нет'} адрес=${finalUrl ?? 'нет'}`,
      );
      this.logResponseHeaders(lastResp);

      await this.logCookies(page, url);

      let rawHtml = '';
      try {
        rawHtml = (await lastResp?.text()) ?? '';
      } catch {}
      if (!rawHtml) {
        try {
          rawHtml = await page.content();
        } catch {}
      }
      this.logger.log(`HTML превью: ${this.safeLogHtml(rawHtml)}`);

      if (status !== 429 && status !== 503) {
        return lastResp;
      }

      const backoffMs = 2000 * attempt + Math.floor(Math.random() * 1000);
      this.logger.warn(
        `Получен ${status}. Пауза ${backoffMs} мс, затем повтор…`,
      );
      await sleep(backoffMs);

      let beforeHash = '';
      try {
        beforeHash = this.sha256(await page.content());
      } catch {}

      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
        this.logger.log(`Reload выполнен`);
      } catch (e) {
        this.logger.warn(`Ошибка reload: ${e}`);
      }

      let afterHash = '';
      try {
        afterHash = this.sha256(await page.content());
      } catch {}
      this.logger.log(
        `Сравнение контента после reload: до=${beforeHash.slice(0, 8)} после=${afterHash.slice(0, 8)} ${beforeHash === afterHash ? '(без изменений)' : '(изменился)'}`,
      );
    }

    return lastResp;
  }
}
