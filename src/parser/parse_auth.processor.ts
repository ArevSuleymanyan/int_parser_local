// import { Processor, Process } from '@nestjs/bull';
// import { Job } from 'bull';
// import { Logger } from '@nestjs/common';
// import { PARSE_QUEUE_AUTH } from './queue.constants';
// import { ResultWebhookService } from './webhook.service';
// // import puppeteerExtra from 'puppeteer-extra';
// const puppeteerExtra = require('puppeteer-extra')
// // import StealthPlugin from 'puppeteer-extra-plugin-stealth'; // (3) stealth
// const StealthPlugin = require('puppeteer-extra-plugin-stealth')
//
// import { createHash } from 'crypto';
// import type { Browser, Page, HTTPResponse } from 'puppeteer';
// import type { Protocol } from 'devtools-protocol';
//
// puppeteerExtra.use(StealthPlugin()); // (3)
//
// const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
//
// @Processor(PARSE_QUEUE_AUTH)
// export class ParseAuthProcessor {
//   private readonly logger = new Logger(ParseAuthProcessor.name);
//   constructor(private readonly webhook: ResultWebhookService) {}
//
//   // === (1)(4)(7) Прокси и ротация (10 портов) + перенос cookie между рестартами ===
//   private readonly proxyHost = process.env.PROXY_HOST ?? 'gate.decodo.com';
//   private readonly proxyUser = process.env.PROXY_USER ?? 'spld0nf23i';
//   private readonly proxyPass = process.env.PROXY_PASS ?? 'bkQBt2=Ccyo5yx9F4y';
//   private readonly proxyPorts = [
//     10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009, 10010,
//   ];
//   private proxyIdx = 0;
//
//   // персист куков по порту (в пределах жизни воркера)
//   private portCookies = new Map<number, Protocol.Network.Cookie[]>();
//
//   @Process({ name: 'parse_auth', concurrency: 2 })
//   async handle(job: Job<any>) {
//     this.logger.log(
//       '================================================================',
//     );
//     this.logger.log(`Получен JOB: ${JSON.stringify(job.data)}`);
//
//     const { leadId, fields, url, webhookUrl } = job.data as {
//       leadId: string;
//       fields: string[];
//       url: string;
//       webhookUrl: string;
//     };
//
//     this.logger.log(
//       `Начало обработки: id=${job.id} lead=${leadId} поля=[${fields.join(',')}] url=${url} webhook=${webhookUrl}`,
//     );
//
//     let browser: Browser | null = null;
//
//     try {
//       // (4) выбираем порт
//       let port = this.proxyPorts[this.proxyIdx++ % this.proxyPorts.length];
//
//       // локальная функция старта браузера с нужным портом
//       const launchWithProxy = async (portNum: number) => {
//         const proxyUrl = `http://${this.proxyHost}:${portNum}`; // (1) верный формат
//         this.logger.log(`Запуск puppeteer с proxy=${proxyUrl}`);
//         const br = await puppeteerExtra.launch({
//           headless: true,
//           args: [
//             `--proxy-server=${proxyUrl}`,
//             // (9) WebRTC/DNS leak mitigation
//             '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
//             '--disable-features=WebRtcHideLocalIpsWithMdns',
//             '--disable-webrtc-encryption',
//             '--no-sandbox',
//             '--disable-dev-shm-usage',
//           ],
//         });
//         return br;
//       };
//
//       browser = await launchWithProxy(port);
//       this.logger.log(`Браузер запущен: ${!!browser}`);
//
//       let page = await browser.newPage();
//       this.logger.log(`Создана новая вкладка`);
//
//       // (1) proxy auth
//       if (this.proxyUser && this.proxyPass) {
//         await page.authenticate({
//           username: this.proxyUser,
//           password: this.proxyPass,
//         });
//         this.logger.log(`Proxy-авторизация применена`);
//       }
//
//       // (5)(2) UA и client hints: используем дефолтный UA браузера (избегаем несостыковок)
//       const defaultUA = await page.evaluate(() => navigator.userAgent);
//       const isMobileUA =
//         /Mobile|Android|iPhone|iPad|Opera Mini|IEMobile|Windows Phone/i.test(
//           defaultUA,
//         );
//       const finalUA = isMobileUA
//         ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
//         : defaultUA;
//       await page.setUserAgent(finalUA);
//
//       // client hints (минимально безопасно, без противоречий)
//       await page.setExtraHTTPHeaders({
//         'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7', // (3)
//         DNT: '1',
//         'Upgrade-Insecure-Requests': '1',
//       });
//
//       await page.setViewport({ width: 1366, height: 850 });
//       await page.setCacheEnabled(false);
//
//       // (7) восстанавливаем куки, если ранее были на этом порту
//       const prevCookies = this.portCookies.get(port);
//       if (prevCookies?.length) {
//         try {
//           await page.setCookie(
//             ...prevCookies.map((c) => ({
//               name: c.name,
//               value: c.value,
//               domain: c.domain || '.avito.ru',
//               path: c.path || '/',
//               expires: c.expires,
//               httpOnly: c.httpOnly,
//               secure: c.secure,
//               sameSite: (c.sameSite as any) ?? 'Lax',
//             })),
//           );
//           this.logger.log(
//             `Восстановлено куков для порта ${port}: ${prevCookies.length}`,
//           );
//         } catch (e) {
//           this.logger.warn(`Не удалось восстановить куки: ${e}`);
//         }
//       }
//
//       // --- НАВИГАЦИЯ: maxAttempts=5, экспоненциальный backoff + jitter (6) ---
//       const maxAttempts = 5;
//       let resp: HTTPResponse | null = null;
//
//       for (let attempt = 1; attempt <= maxAttempts; attempt++) {
//         this.logger.log(
//           `Навигация (попытка ${attempt}/${maxAttempts}) url=${url}`,
//         );
//
//         // (10) человекоподобные тайминги/скролл перед заходом
//         await sleep(400 + Math.floor(Math.random() * 600));
//         await page.evaluate(() =>
//           window.scrollTo(0, Math.floor(Math.random() * 200)),
//         );
//
//         resp = await page
//           .goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
//           .catch((e) => {
//             this.logger.warn(`page.goto выбросил ошибку: ${e}`);
//             return null;
//           });
//
//         const status = resp?.status();
//         const finalUrl = resp?.url();
//         this.logger.log(
//           `Результат навигации: статус=${status ?? 'нет'} адрес=${finalUrl ?? 'нет'}`,
//         );
//
//         // краткий лог заголовков
//         try {
//           const headers = resp?.headers() ?? {};
//           const keys = Object.keys(headers);
//           const preview: Record<string, string> = {};
//           keys.slice(0, 8).forEach((k) => (preview[k] = headers[k]));
//           this.logger.log(
//             `Заголовки ответа (первые ${Math.min(8, keys.length)}): ${JSON.stringify(preview)}`,
//           );
//         } catch (e) {
//           this.logger.warn(`Не удалось логировать заголовки: ${e}`);
//         }
//
//         // (7) сохраняем свежие куки (включая _avisc от Avito при 429)
//         try {
//           const gotCookies = await page.cookies();
//           this.portCookies.set(port, gotCookies as any);
//         } catch (e) {
//           this.logger.warn(`Не удалось получить куки: ${e}`);
//         }
//
//         if (status !== 429 && status !== 503) break;
//
//         // (4)(6) при 429/503 — ротация IP/порта + экспоненциальный backoff
//         const base = 2500 * Math.pow(1.6, attempt - 1);
//         const jitter = 800 + Math.floor(Math.random() * 1200);
//         const wait = Math.min(12000, Math.floor(base + jitter));
//         this.logger.warn(
//           `Получен ${status}. Ждём ${wait} мс, меняем прокси и пробуем заново...`,
//         );
//         await sleep(wait);
//
//         // закрываем текущий браузер и поднимаем новый с другим портом
//         try {
//           await browser?.close();
//         } catch {}
//         port = this.proxyPorts[this.proxyIdx++ % this.proxyPorts.length];
//         browser = await launchWithProxy(port);
//         page = await browser.newPage();
//
//         if (this.proxyUser && this.proxyPass) {
//           await page.authenticate({
//             username: this.proxyUser,
//             password: this.proxyPass,
//           });
//         }
//
//         // восстановим куки, если были на новом порту
//         const portCk = this.portCookies.get(port);
//         if (portCk?.length) {
//           try {
//             await page.setCookie(
//               ...portCk.map((c) => ({
//                 name: c.name,
//                 value: c.value,
//                 domain: c.domain || '.avito.ru',
//                 path: c.path || '/',
//                 expires: c.expires,
//                 httpOnly: c.httpOnly,
//                 secure: c.secure,
//                 sameSite: (c.sameSite as any) ?? 'Lax',
//               })),
//             );
//           } catch (e) {
//             this.logger.warn(
//               `Не удалось восстановить куки на новом порту: ${e}`,
//             );
//           }
//         }
//
//         await page.setUserAgent(finalUA);
//         await page.setExtraHTTPHeaders({
//           'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
//           DNT: '1',
//           'Upgrade-Insecure-Requests': '1',
//         });
//         await page.setViewport({ width: 1366, height: 850 });
//         await page.setCacheEnabled(false);
//       }
//
//       const navStatus = resp?.status();
//       if (navStatus === 429 || navStatus === 503) {
//         this.logger.error(
//           `Не удалось обойти ${navStatus} после повторных попыток`,
//         );
//       }
//
//       await sleep(500 + Math.floor(Math.random() * 400)); // (10)
//
//       // === ДАЛЬШЕ ВАШ КОД БЕЗ ИЗМЕНЕНИЙ ===
//       this.logger.log(`Попытка извлечь адрес (первая попытка)`);
//       let value = await this.extractAddressFromPage(page);
//       this.logger.log(`Извлечённое значение: ${value}`);
//
//       if (!value) {
//         this.logger.log(
//           'Адрес не найден, выполняем повторную загрузку и проверку изменения контента',
//         );
//         await page.setCacheEnabled(false);
//         try {
//           await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
//           this.logger.log(`Повторная загрузка выполнена`);
//         } catch (e) {
//           this.logger.warn(`Ошибка при повторной загрузке: ${e}`);
//         }
//         value = await this.extractAddressFromPage(page);
//         this.logger.log(
//           `Извлечённое значение после повторной загрузки: ${value}`,
//         );
//       }
//
//       const payload = {
//         leadId,
//         url,
//         results: [value],
//         extractedAt: new Date().toISOString(),
//         jobId: job.id,
//       };
//       this.logger.log(
//         `Отправка в webhook: ${webhookUrl}, данные=${JSON.stringify(payload)}`,
//       );
//       await this.webhook.send(webhookUrl, payload);
//       this.logger.log(
//         `Результат успешно отправлен: lead=${leadId} поля=[${fields.join(',')}]`,
//       );
//       return 'ok';
//     } catch (err: any) {
//       this.logger.error(`Ошибка при парсинге: ${err?.message || err}`);
//       throw err;
//     } finally {
//       if (browser) {
//         try {
//           this.logger.log(`Закрытие браузера...`);
//           await browser.close();
//           this.logger.log(`Браузер закрыт`);
//         } catch (closeErr) {
//           this.logger.warn(`Ошибка при закрытии браузера: ${closeErr}`);
//         }
//       }
//       this.logger.log(
//         '================================================================',
//       );
//     }
//   }
//
//   private async extractAddressFromPage(page: Page): Promise<string | null> {
//     this.logger.log(`extractAddressFromPage: старт`);
//     const result = await page.evaluate(() => {
//       const norm = (s?: string | null) =>
//         (s || '')
//           .replace(/\u00A0/g, ' ')
//           .replace(/\s+/g, ' ')
//           .trim() || null;
//
//       const mainP = document.querySelector(
//         '[data-marker="delivery/location"] p',
//       ) as HTMLElement | null;
//       const t1 = norm(mainP?.innerText || mainP?.textContent);
//       if (t1) return t1;
//
//       const mainDiv = document.querySelector(
//         '[data-marker="delivery/location"]',
//       ) as HTMLElement | null;
//       const t2 = norm(mainDiv?.innerText || mainDiv?.textContent);
//       if (t2) return t2;
//
//       const geo = document.querySelector(
//         '[data-marker="item-view/item-geo"]',
//       ) as HTMLElement | null;
//       const t3 = norm(geo?.innerText || geo?.textContent);
//       if (t3) return t3;
//
//       const byItemprop = document.querySelector(
//         '[itemprop="address"]',
//       ) as HTMLElement | null;
//       const t4 = norm(byItemprop?.innerText || byItemprop?.textContent);
//       if (t4) return t4;
//
//       const title = Array.from(
//         document.querySelectorAll('h2, h3, div, span'),
//       ).find((el) => (el.textContent || '').trim() === 'Расположение');
//       if (title) {
//         const container = (title as HTMLElement).parentElement || title;
//         const cand = container.querySelector(
//           'span, p, div',
//         ) as HTMLElement | null;
//         const t5 = norm(cand?.innerText || cand?.textContent);
//         if (t5) return t5;
//       }
//       return null;
//     });
//     this.logger.log(`extractAddressFromPage: результат=${result}`);
//     return result;
//   }
//
//   private sha256(s: string): string {
//     return createHash('sha256')
//       .update(s || '')
//       .digest('hex');
//   }
// }
