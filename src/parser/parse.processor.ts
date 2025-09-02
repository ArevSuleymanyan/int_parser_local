import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';
import { PARSE_QUEUE } from './queue.constants';
import { ResultWebhookService } from './webhook.service';

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

    const extractedAt = new Date().toISOString();

    const launchOpts: any = {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };

    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch(launchOpts);
      const page = await browser.newPage();
      await page.setUserAgent(
        process.env.PARSER_USER_AGENT ??
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123 Safari/537.36 ParserBot/1.0',
      );
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForSelector('body', { timeout: 15_000 });

      const results: Array<{ field: string; value: string | null }> = [];

      for (const field of fields) {
        const value = await this.extractFieldFromPage(field, page);
        results.push({ field, value });
        this.logger.log(
          `Извлечено: lead=${leadId} поле=${field} значение="${value ?? ''}"`,
        );
      }

      const payload = {
        leadId,
        url,
        results,
        extractedAt,
        jobId: job.id,
      };

      await this.webhook.send(webhookUrl, payload);
      this.logger.log(
        `Результат отправлен: lead=${leadId} поля=[${fields.join(',')}]`,
      );
      return 'ok';
    } catch (err: any) {
      this.logger.error(`Ошибка парсинга: ${err?.message || err}`);
      throw err;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
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
        const name = ps[1]?.textContent?.trim();
        if (name) return name;
        const last = wrap.querySelector('p:last-child')?.textContent?.trim();
        if (last) return last;
      }
      const label = Array.from(document.querySelectorAll('p,span,div')).find(
        (el) => el.textContent?.trim() === 'Контактное лицо',
      );
      if (label) {
        const candidate = label.parentElement?.querySelector(
          'p:nth-of-type(2), span:nth-of-type(2)',
        );
        return candidate?.textContent?.trim() || null;
      }
      return null;
    });
  }

  private async extractAddressFromPage(page: Page): Promise<string | null> {
    return page.evaluate(() => {
      const addrWrap = document.querySelector('[itemprop="address"]');
      const primary =
        (
          addrWrap?.querySelector('.xLPJ6') as HTMLElement | null
        )?.textContent?.trim() ||
        addrWrap?.textContent?.trim() ||
        null;
      if (primary) return primary;

      const title = Array.from(
        document.querySelectorAll('h2, h3, div, span'),
      ).find((el) => el.textContent?.trim() === 'Расположение');
      if (title) {
        const container = title.parentElement || title;
        const cand = (
          container.querySelector('span, p, div') as HTMLElement | null
        )?.textContent?.trim();
        if (cand) return cand;
      }
      return null;
    });
  }
}
