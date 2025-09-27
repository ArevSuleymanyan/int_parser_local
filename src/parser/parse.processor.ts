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
      console.log(browser);
      await browser.setCookie(
        { name: 'u', value: '3784d02v.jzrj9f.i4l4j77jn7', domain: 'avito.ru' },
        {
          name: 'srv_id',
          value:
            'M7tQPbxR1psgmQuo.1qLDIwHEYZTrSGtOcNS0RtTjtEgq_oUINj6CkPfBBmoEJ31dAe7G71sheibsZwc=.46ZhU64sE2GW2FQ93fgubDcfsrD2IJNbvWPUDC2Auz8=.web',
          domain: 'avito.ru',
        },
        { name: '_ym_uid', value: '1755733166551874553', domain: 'avito.ru' },
        { name: '_ym_d', value: '1755733166', domain: 'avito.ru' },
        {
          name: '_gcl_au',
          value: '1.1.1561402751.1755733166',
          domain: 'avito.ru',
        },
        {
          name: '_ga',
          value: 'GA1.1.1818344475.1755733167',
          domain: 'avito.ru',
        },
        {
          name: 'uxs_uid',
          value: 'e91547d0-7e1e-11f0-846b-d7ee39f1aa00',
          domain: 'avito.ru',
        },
        {
          name: 'adrcid',
          value: 'AcOYjAgEadXvZPqakSKNPIw',
          domain: 'avito.ru',
        },
        { name: '__upin', value: 'Dy22xEpCMDAn2DGxxkgSHA', domain: 'avito.ru' },
        { name: 'cookie_consent_shown', value: '1', domain: 'avito.ru' },
        { name: 'buyer_laas_location', value: '621540', domain: 'avito.ru' },
        { name: 'buyer_location_id', value: '621540', domain: 'avito.ru' },
        { name: 'ma_cid', value: '1758203587717190542', domain: 'avito.ru' },
        { name: 'yandex_monthly_cookie', value: 'true', domain: 'avito.ru' },
        {
          name: 'tmr_lvid',
          value: '1c2891be7570880a0fc4d9d2fa37e9fe',
          domain: 'avito.ru',
        },
        { name: 'tmr_lvidTS', value: '1758203588423', domain: 'avito.ru' },
        {
          name: '__zzatw-avito',
          value: 'MDA0dBA=Fz2+aQ==',
          domain: 'avito.ru',
        },
        { name: 'ma_id', value: '9497862911758203588321', domain: 'avito.ru' },
        {
          name: 'ma_id_api',
          value:
            'F6GwZA5LJptrUX/7EySvo6eHqncLZt77hP/zM5ykokrUGaBcPM9MpcyCaehFDzgND1uV50tM9aRZRzOtBBLb2mGrc54F/6MJwj6IJQntlSwxby9yXaQG0AUe13mMzK10Er+VWTHv++C32+5J6HpDHZarfnHVZaUUqrJKCV68JSc7Ko0/C2ki1tWkvzq92iwJI/2uoTVwbJjKFLGGmO2J/mrduN8R33Bm6CwPlBpbOycD2XBvOH0cJJuRkrZHmDtcIyep12MxP0sPhOj45N8X2qV9ohHqp0al4/4gN0w0x9q949M9JO9MwUdpT3H18PiDYGjn7nJLVnK7NdpzC6xnRw==',
          domain: 'avito.ru',
        },
        {
          name: 'gMltIuegZN2COuSe',
          value: 'EOFGWsm50bhh17prLqaIgdir1V0kgrvN',
          domain: 'avito.ru',
        },
        { name: 'luri', value: 'all', domain: 'avito.ru' },
        {
          name: '__ai_fp_uuid',
          value: '6c2bfe08eca5c844:3',
          domain: 'avito.ru',
        },
        {
          name: '_buzz_aidata',
          value:
            'JTdCJTIydWZwJTIyJTNBJTIyRHkyMnhFcENNREFuMkRHeHhrZ1NIQSUyMiUyQyUyMmJyb3dzZXJWZXJzaW9uJTIyJTNBJTIyMTQwLjAlMjIlMkMlMjJ0c0NyZWF0ZWQlMjIlM0ExNzU4ODY4MDYxNDk5JTdE',
          domain: 'avito.ru',
        },
        {
          name: 'cfidsw-avito',
          value:
            'Kw04bUHEk1g613+ulM2Yax20v8Pi7g5rWddwHn3zesKrEzgyj5D7Ej1pumycqMWKsLKeJaU34w7yMwcqqtZ6KMxDFja/M8rREl6N6E3wH1cJj0YQwidHiRwRWgCI1Ks3tZnuxXk8cLiuwHXJDQkRF3g1NNrpwpllxBMdng==',
          domain: 'avito.ru',
        },
        {
          name: 'sessid',
          value: 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9....',
          domain: 'avito.ru',
        },
        { name: 'auth', value: '1', domain: 'avito.ru' },
        {
          name: 'rt',
          value: '7af1c2bcb2c6652626ab036d4db53bb4',
          domain: 'avito.ru',
        },
        {
          name: 'sx',
          value:
            'H4sIAAAAAAAC/wTAMQ6DMAwF0Lv8uUOb1t9xDtCNGYkN4mRATBFiIMrdeR0kmV1ZjSb80Ypu5Wuu8s5Z3ZA6LiQ0PX261/m/S6t1OfBCQfqoRJMYQhjjCQAA//88dRzkTAAAAA==',
          domain: 'avito.ru',
        },
        { name: '_ym_isad', value: '2', domain: 'avito.ru' },
        { name: 'adrdel', value: '1758922209952', domain: 'avito.ru' },
        {
          name: 'ma_ss_64a8dba6-67f3-4fe4-8625-257c4adae014',
          value: '1758922209396726715.5.1758922915.2.1758922209',
          domain: 'avito.ru',
        },
        { name: 'v', value: '1758926929', domain: 'avito.ru' },
        {
          name: 'f',
          value: '5.bcb2d20145725c80cc0065cb1b69001fb456d7c4b56f6c0c....',
          domain: 'avito.ru',
        },
        {
          name: 'ft',
          value:
            'svDhs64BzWlENTRj1zwFi4arWUOCQ7Gti+tfKM+IMxrjq0jHIe+4+kAaUBch88OmYX6OIcObAAM9oFXXQ+1CJ0Hzw2kBSKowwyvuvkcqFVeuw47+zR3dnlBTGHa+JQ9diEVHguMVKzGfhOMbNeXGIraM1b8QV2UUxbktkzmf5ylCZPgTWX6slFSF45GW3a3m',
          domain: 'avito.ru',
        },
        {
          name: 'acs_3',
          value:
            '{"hash":"1aa3f9523ee6c2690cb34fc702d4143056487c0d","nst":1759013691517,"sl":{"224":1758927291517,"1228":1758927291517}}',
          domain: 'avito.ru',
        },
        {
          name: 'domain_sid',
          value: 'bRhevk8tA8778DkF4a-jj:1758927292549',
          domain: 'avito.ru',
        },
        { name: 'cartCounter', value: '4', domain: 'avito.ru' },
        { name: 'abp', value: '0', domain: 'avito.ru' },
        { name: 'pageviewCount', value: '24', domain: 'avito.ru' },
        {
          name: '_ga_M29JC28873',
          value: 'GS2.1.s1758927291$o11$g1$t1758929301$j59$l0$h0',
          domain: 'avito.ru',
        },
        { name: 'tmr_detect', value: '0|1758929304386', domain: 'avito.ru' },
        {
          name: 'cssid',
          value: 'be7adc31-aa1a-43cc-855f-27150d5e9217',
          domain: 'avito.ru',
        },
        { name: 'cssid_exp', value: '1758931173682', domain: 'avito.ru' },
        {
          name: '_adcc',
          value:
            '1.GW2GJixp8iAmC9shAx41LHFOFJzxamJD+uHRMavNbFWTo1jlPe1+JqMSiB3YQrvdS6NCCxk',
          domain: 'avito.ru',
        },
        {
          name: '_avisc',
          value: 'fmHZnirjBZ0KgQgxMd3qydZc5s1rpVZCzn5VbYjqkRw=',
          domain: 'avito.ru',
        },
        {
          name: 'csprefid',
          value: '3047bf56-2dad-4647-bc09-3907a129033c',
          domain: 'avito.ru',
        },
      );
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

      const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36`; //uaFaker.random();
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

      const resp = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      this.logger.log(`NAV status=${resp?.status()} finalUrl=${resp?.url()}`);

      // const meta = await page.evaluate(() => ({
      //   title: document.title,
      //   hasBody: !!document.querySelector('body'),
      //   htmlLen: document.documentElement?.innerHTML?.length || 0,
      //   lang: navigator.language,
      // }));
      // this.logger.log(
      //   `DOC title="${meta.title}" body=${meta.hasBody} htmlLen=${meta.htmlLen} lang=${meta.lang}`,
      // );

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
