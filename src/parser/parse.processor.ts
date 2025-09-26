import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import type { Browser, Page } from 'puppeteer';
import { PARSE_QUEUE } from './queue.constants';
import { ResultWebhookService } from './webhook.service';
import puppeteerExtra from 'puppeteer-extra';

// плагины / генератор UA
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Stealth = require('puppeteer-extra-plugin-stealth');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const uaFaker = require('useragent-faker');

puppeteerExtra.use((Stealth.default ?? Stealth)());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pickDecodoPort(): string | null {
  const list = (
    process.env.DECODO_PROXY_PORTS ||
    process.env.DECODO_PROXY_PORT ||
    ''
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function buildDecodoProxy(portOverride?: string): string | null {
  const proto = process.env.DECODO_PROXY_PROTOCOL || 'http';
  const host = process.env.DECODO_PROXY_HOST;
  const port = portOverride || process.env.DECODO_PROXY_PORT;
  if (!host || !port) return null;
  return `${proto}://${host}:${port}`;
}

@Processor(PARSE_QUEUE)
export class ParseProcessor {
  private readonly logger = new Logger(ParseProcessor.name);
  constructor(private readonly webhook: ResultWebhookService) {}

  @Process({
    name: 'parse',
    concurrency: Number(process.env.PARSER_CONCURRENCY ?? 2),
  })
  async handle(job: Job<any>) {
    const { leadId, fields, url, webhookUrl } = job.data as {
      leadId: string;
      fields: string[];
      url: string;
      webhookUrl: string;
    };

    this.logger.log(
      `JOB START id=${job.id} lead=${leadId} fields=[${fields.join(',')}] url=${url} webhook=${webhookUrl}`,
    );

    const launchOpts: any = {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--lang=ru-RU,ru',
      ],
    };

    // const pickedPort = pickDecodoPort();
    // const proxy = buildDecodoProxy(pickedPort || undefined);
    // if (proxy) {
    //   launchOpts.args.push(`--proxy-server=${proxy}`);
    //   this.logger.log(`Использую Decodo proxy: ${proxy}`);
    // }

    let browser: Browser | null = null;
    try {
      browser = await puppeteerExtra.launch(launchOpts);
      const page = await browser.newPage();

      // if (
      //   process.env.DECODO_PROXY_USERNAME &&
      //   process.env.DECODO_PROXY_PASSWORD
      // ) {
      //   await page.authenticate({
      //     username: process.env.DECODO_PROXY_USERNAME!,
      //     password: process.env.DECODO_PROXY_PASSWORD!,
      //   });
      // }

      const ua = uaFaker.random();
      await page.setUserAgent(ua);

      // if (/Mobile|Android|iPhone|iPad/i.test(ua)) {
      //   await page.setViewport({
      //     width: 360 + Math.floor(Math.random() * 80),
      //     height: 720 + Math.floor(Math.random() * 200),
      //     isMobile: true,
      //     deviceScaleFactor: 2,
      //   });
      // } else {
      //   await page.setViewport({
      //     width: 1200 + Math.floor(Math.random() * 200),
      //     height: 800 + Math.floor(Math.random() * 200),
      //     deviceScaleFactor: 1,
      //   });
      // }

      // await page.setExtraHTTPHeaders({
      //   'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      //   Accept:
      //     'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      //   Connection: 'keep-alive',
      //   Referer: url, // можно заменить на поисковик при необходимости
      // });
      this.logger.log(`Using fake UA: ${ua}`);

      // try {
      //   const ipResp = await page.goto('https://api.ipify.org?format=text', {
      //     waitUntil: 'networkidle2',
      //     timeout: 10_000,
      //   });
      //   this.logger.log(
      //     `OUTGOING IP: ${ipResp ? await ipResp.text() : 'no-response'}`,
      //   );
      // } catch (e: any) {
      //   this.logger.warn('Failed to detect outgoing IP: ' + e.message);
      // }

      // const resp = await page.goto(url, {
      //   waitUntil: 'domcontentloaded',
      //   timeout: 60_000,
      // });
      // this.logger.log(`NAV status=${resp?.status()} finalUrl=${resp?.url()}`);

      await sleep(800);

      // const results: Array<{ field: string; value: string | null }> = [];
      // for (const field of fields) {
      let value = await this.extractFieldFromPage(fields[0], page);
      if (!value) {
        this.logger.log('RELOAD');
        await page.reload();
        value = await this.extractFieldFromPage(fields[0], page);
      }
      // results.push({ field, value });
      // this.logger.log(
      //   `EXTRACT lead=${leadId} field=${field} value="${value ?? ''}"`,
      // );
      // }

      await this.webhook.send(webhookUrl, {
        leadId,
        url,
        results: [value],
        extractedAt: new Date().toISOString(),
        jobId: job.id,
      });
      this.logger.log(
        `Результат отправлен: lead=${leadId} поля=[${fields.join(',')}]`,
      );
      return 'ok';
    } catch (err: any) {
      this.logger.error(`Ошибка парсинга: ${err?.message || err}`);
      throw err;
    } finally {
      if (browser)
        try {
          await browser.close();
        } catch {}
    }
  }

  private async extractFieldFromPage(
    field: string,
    page: Page,
  ): Promise<string | null> {
    switch (field) {
      case 'CONTACT_PERSON_NAME':
        return this.extractContactNameFromPage(page);
      case 'ADDRESS':
        return this.extractAddressFromPage(page);
      default:
        this.logger.warn(`Неподдерживаемое поле "${field}" — нет обработчика`);
        return null;
    }
  }

  private async extractContactNameFromPage(page: Page): Promise<string | null> {
    return page.evaluate(() => {
      const wrap = document.querySelector(
        '[data-marker="seller-info/contact-person"]',
      );
      if (wrap) {
        const ps = Array.from(wrap.querySelectorAll('p'));
        const name =
          ps[1]?.textContent?.trim() ||
          (
            wrap.querySelector('p:last-child') as HTMLElement | null
          )?.textContent?.trim();
        if (name) return name;
      }
      const label = Array.from(document.querySelectorAll('p,span,div')).find(
        (el) => el.textContent?.trim() === 'Контактное лицо',
      );
      if (label) {
        const cand = label.parentElement?.querySelector(
          'p:nth-of-type(2), span:nth-of-type(2)',
        ) as HTMLElement | null;
        return cand?.textContent?.trim() || null;
      }
      return null;
    });
  }

  private async extractAddressFromPage(page: Page): Promise<string | null> {
    const isMobile = await page.evaluate(() =>
      location.hostname.startsWith('m.'),
    );
    if (isMobile) return this.extractAddressFromMobile(page);
    return this.extractAddressFromMobile(page);
  }

  private async extractAddressFromMobile(page: Page): Promise<string | null> {
    return page.evaluate(() => {
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
  }
}
