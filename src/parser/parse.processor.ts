import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { PARSE_QUEUE } from './queue.constants';
import { ResultWebhookService } from './webhook.service';
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

import type { Browser, Page, HTTPResponse } from 'puppeteer';
import type { Protocol } from 'devtools-protocol';

puppeteerExtra.use(StealthPlugin());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const clip = (s?: string | null, n = 800) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function logPagePreview(logger: Logger, page: Page, note: string) {
  try {
    const data = await page.evaluate(() => {
      const title = document.title || '';
      const text = (document.body?.innerText || '').trim();
      const html = (document.documentElement?.outerHTML || '').trim();
      return { title, preview: text || html };
    });
    logger.warn(`[PREVIEW@${note}] title="${clip(data.title, 160)}" :: ${clip(data.preview, 800)}`);
  } catch (e) {
    logger.warn(`[PREVIEW@${note}] не удалось получить превью: ${e}`);
  }
}

@Processor(PARSE_QUEUE)
export class ParseProcessor {
  private readonly logger = new Logger(ParseProcessor.name);
  constructor(private readonly webhook: ResultWebhookService) {}

  private readonly proxyHost = process.env.PROXY_HOST ?? 'gate.decodo.com';
  private readonly proxyUser = process.env.PROXY_USER ?? 'spdgkv82ag';
  private readonly proxyPass = process.env.PROXY_PASS ?? 'n96yq9jMhRsAGfnn0_';
  private readonly proxyPorts = [
    10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009, 10010,
  ];
  private proxyIdx = 0;

  private portCookies = new Map<number, Protocol.Network.Cookie[]>();

  @Process({ name: 'parse', concurrency: 2 })
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
      // (4) выбираем порт
      let port = this.proxyPorts[this.proxyIdx++ % this.proxyPorts.length];

      // локальная функция старта браузера с нужным портом
      const launchWithProxy = async (portNum: number) => {
        const proxyUrl = `http://${this.proxyHost}:${portNum}`; // (1) верный формат
        this.logger.log(`Запуск puppeteer с proxy=${proxyUrl}`);
        const br = await puppeteerExtra.launch({
          headless: true,
          args: [
            `--proxy-server=${proxyUrl}`,
            // (9) WebRTC/DNS leak mitigation
            '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
            '--disable-features=WebRtcHideLocalIpsWithMdns',
            '--disable-webrtc-encryption',
            '--no-sandbox',
            '--disable-dev-shm-usage',
          ],
        });
        return br;
      };

      browser = await launchWithProxy(port);
      this.logger.log(`Браузер запущен: ${!!browser}`);

      let page = await browser.newPage();
      this.logger.log(`Создана новая вкладка`);

      // (1) proxy auth
      if (this.proxyUser && this.proxyPass) {
        await page.authenticate({
          username: this.proxyUser,
          password: this.proxyPass,
        });
        this.logger.log(`Proxy-авторизация применена`);
      }

      const defaultUA = await page.evaluate(() => navigator.userAgent);
      await page.setUserAgent(defaultUA);

      await page.setExtraHTTPHeaders({
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7', // (3)
        DNT: '1',
        'Upgrade-Insecure-Requests': '1',
      });

      await page.setViewport({ width: 1366, height: 850 });
      await page.setCacheEnabled(false);

      const prevCookies = this.portCookies.get(port);
      if (prevCookies?.length) {
        try {
          await page.setCookie(
            ...prevCookies.map((c) => ({
              name: c.name,
              value: c.value,
              domain: c.domain || '.avito.ru',
              path: c.path || '/',
              expires: c.expires,
              httpOnly: c.httpOnly,
              secure: c.secure,
              sameSite: (c.sameSite as any) ?? 'Lax',
            })),
          );
          this.logger.log(
            `Восстановлено куков для порта ${port}: ${prevCookies.length}`,
          );
        } catch (e) {
          this.logger.warn(`Не удалось восстановить куки: ${e}`);
        }
      }

      const maxAttempts = 5;
      let resp: HTTPResponse | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        this.logger.log(
          `Навигация (попытка ${attempt}/${maxAttempts}) url=${url}`,
        );

        await sleep(400 + Math.floor(Math.random() * 600));
        await page.evaluate(() =>
          window.scrollTo(0, Math.floor(Math.random() * 200)),
        );

        resp = await page
          .goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
          .catch((e) => {
            this.logger.warn(`page.goto выбросил ошибку: ${e}`);
            return null;
          });

        const status = resp?.status();
        const finalUrl = resp?.url();
        this.logger.log(
          `Результат навигации: статус=${status ?? 'нет'} адрес=${finalUrl ?? 'нет'}`,
        );
        await logPagePreview(this.logger, page, `nav-attempt-${attempt}`);
        try {
          const headers = resp?.headers() ?? {};
          const keys = Object.keys(headers);
          const preview: Record<string, string> = {};
          keys.slice(0, 8).forEach((k) => (preview[k] = headers[k]));
          this.logger.log(
            `Заголовки ответа (первые ${Math.min(8, keys.length)}): ${JSON.stringify(preview)}`,
          );
        } catch (e) {
          this.logger.warn(`Не удалось логировать заголовки: ${e}`);
        }

        try {
          const gotCookies = await page.cookies();
          this.portCookies.set(port, gotCookies as any);
        } catch (e) {
          this.logger.warn(`Не удалось получить куки: ${e}`);
        }

        if (status !== 429 && status !== 503) break;

        const base = 2500 * Math.pow(1.6, attempt - 1);
        const jitter = 800 + Math.floor(Math.random() * 1200);
        const wait = Math.min(12000, Math.floor(base + jitter));
        this.logger.warn(
          `Получен ${status}. Ждём ${wait} мс, меняем прокси и пробуем заново...`,
        );
        await sleep(wait);

        try {
          await browser?.close();
        } catch {}
        port = this.proxyPorts[this.proxyIdx++ % this.proxyPorts.length];
        browser = await launchWithProxy(port);
        page = await browser.newPage();

        if (this.proxyUser && this.proxyPass) {
          await page.authenticate({
            username: this.proxyUser,
            password: this.proxyPass,
          });
        }

        const portCk = this.portCookies.get(port);
        if (portCk?.length) {
          try {
            await page.setCookie(
              ...portCk.map((c) => ({
                name: c.name,
                value: c.value,
                domain: c.domain || '.avito.ru',
                path: c.path || '/',
                expires: c.expires,
                httpOnly: c.httpOnly,
                secure: c.secure,
                sameSite: (c.sameSite as any) ?? 'Lax',
              })),
            );
          } catch (e) {
            this.logger.warn(
              `Не удалось восстановить куки на новом порту: ${e}`,
            );
          }
        }

        await page.setUserAgent(defaultUA);
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
          DNT: '1',
          'Upgrade-Insecure-Requests': '1',
        });
        await page.setViewport({ width: 1366, height: 850 });
        await page.setCacheEnabled(false);
      }

      const navStatus = resp?.status();
      if (navStatus === 429 || navStatus === 503) {
        this.logger.error(
          `Не удалось обойти ${navStatus} после повторных попыток`,
        );
      }

      await sleep(500 + Math.floor(Math.random() * 400));

      this.logger.log(`Попытка извлечь адрес (первая попытка)`);
      let value = await this.extractAddressFromPage(page);
      this.logger.log(`Извлечённое значение: ${value}`);

      if (!value) {
        await logPagePreview(this.logger, page, 'before-reload-no-address');
        this.logger.log(
          'Адрес не найден, выполняем повторную загрузку и проверку изменения контента',
        );
        await page.setCacheEnabled(false);
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
          this.logger.log(`Повторная загрузка выполнена`);
        } catch (e) {
          this.logger.warn(`Ошибка при повторной загрузке: ${e}`);
        }
        await logPagePreview(this.logger, page, 'after-reload');
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
        const container = (title as HTMLElement).parentElement || title;
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
}
