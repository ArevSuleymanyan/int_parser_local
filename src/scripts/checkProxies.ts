import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { URL } from 'url';

const PROXIES_FILE = path.resolve(__dirname, '../../proxies.txt');
const GOOD_FILE = path.resolve(__dirname, '../../good.txt');
const TEST_URL = 'https://httpbin.org/ip';
const TIMEOUT_MS = 10000;
const RETRIES = 1;

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function testProxy(proxyLine: string): Promise<boolean> {
  const proxy = proxyLine.trim();
  if (!proxy) return false;

  let agent: any;
  try {
    const u = new URL(proxy);
    if (u.protocol.startsWith('socks')) {
      agent = new SocksProxyAgent(u.toString());
    } else {
      agent = new HttpsProxyAgent(u.toString());
    }
  } catch (err) {
    console.log(`[ERR] ${proxy}  invalid URL`);
    return false;
  }

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await axios.get(TEST_URL, {
        httpAgent: agent,
        httpsAgent: agent,
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; proxy-checker)',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (res.status >= 200 && res.status < 400 && res.data) {
        console.log(`[OK]  ${proxy}  status=${res.status}`);
        return true;
      } else {
        console.log(`[BAD] ${proxy}  status=${res.status}`);
      }
    } catch (err: any) {
      const code = err.code || err.message;
      console.log(`[ERR] ${proxy}  ${code}`);
    }

    if (attempt < RETRIES) {
      await sleep(500);
    }
  }

  return false;
}

async function main() {
  if (!fs.existsSync(PROXIES_FILE)) {
    console.error('Не найден файл proxies.txt в корне проекта.');
    process.exit(1);
  }

  const lines = fs
    .readFileSync(PROXIES_FILE, 'utf-8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (fs.existsSync(GOOD_FILE)) fs.unlinkSync(GOOD_FILE);

  for (const line of lines) {
    const ok = await testProxy(line);
    if (ok) {
      fs.appendFileSync(GOOD_FILE, line + '\n', 'utf-8');
    }
    await sleep(300 + Math.floor(Math.random() * 700));
  }

  console.log('Готово. Рабочие прокси в файле good.txt');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
