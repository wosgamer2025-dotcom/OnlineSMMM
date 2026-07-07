import { chromium } from '@playwright/test';
import fs from 'node:fs';

const target = process.argv[2] || 'portal';
const baseUrl = process.env.LIVE_BASE_URL || 'https://www.onlinesmmm.com';
const credentialsText = fs.readFileSync('Z:/onlinesmmm.txt', 'utf8');
const email = credentialsText.match(/Kullanıcı adı:\s*([^\r\n]+)/)?.[1]?.trim();
const password = credentialsText.match(/Şifre:\s*([^\r\n]+)/)?.[1]?.trim();

if (!email || !password) {
  throw new Error('Z:/onlinesmmm.txt içinde kullanıcı adı/şifre bulunamadı.');
}

const routes = {
  portal: '/portal',
  yonetim: '/yonetim',
  admin: '/yonetim',
};
const route = routes[target] || target;
const url = new URL(route, baseUrl).toString();

const userDataDir = process.env.LIVE_BROWSER_PROFILE || 'Z:/Projeler/onlinesmmm/.tmp/live-login-chrome-profile';
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chrome',
  headless: false,
  slowMo: 80,
  args: ['--disable-blink-features=AutomationControlled'],
  viewport: { width: 1180, height: 880 },
  locale: 'tr-TR',
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});
const page = await context.newPage();

page.on('console', (message) => {
  if (['error', 'warning'].includes(message.type())) {
    console.log(`[browser:${message.type()}] ${message.text()}`);
  }
});
page.on('response', async (response) => {
  const request = response.request();
  if (request.method() === 'POST' && response.url().includes('/api/auth/login/start')) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '';
    }
    console.log(JSON.stringify({
      event: 'login_start_response',
      target,
      status: response.status(),
      body: body.slice(0, 500),
    }));
  }
});

console.log(JSON.stringify({
  event: 'opening',
  target,
  url,
  emailMasked: email.replace(/^(.{2}).*(@.*)$/, '$1***$2'),
}));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.getByLabel('E-posta', { exact: true }).fill(email, { timeout: 20_000 });
await page.getByLabel('Şifre', { exact: true }).fill(password, { timeout: 20_000 });

console.log(JSON.stringify({
  event: 'credentials_filled',
  target,
  instruction: 'Turnstile başarılı olunca buton aktifleşecek ve script giriş kodu isteğini gönderecek.',
}));

const submitButton = page.getByRole('button', { name: 'Giriş kodu gönder', exact: true });
await submitButton.waitFor({ state: 'visible', timeout: 60_000 });

const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  if (await submitButton.isEnabled()) {
    break;
  }
  await page.waitForTimeout(1000);
}

if (!(await submitButton.isEnabled())) {
  console.log(JSON.stringify({
    event: 'turnstile_wait_timeout',
    target,
    message: 'Turnstile tamamlanmadığı için giriş kodu isteği gönderilmedi.',
  }));
  await page.waitForTimeout(10 * 60_000);
  await context.close();
  process.exit(2);
}

console.log(JSON.stringify({ event: 'submitting_login_start', target }));
await submitButton.click();

const codeState = page.getByText('Giriş kodu gönderildi', { exact: false });
const errorState = page.locator('.field-warning, .portal-error');
const result = await Promise.race([
  codeState.waitFor({ state: 'visible', timeout: 45_000 }).then(() => 'code'),
  errorState.waitFor({ state: 'visible', timeout: 45_000 }).then(() => 'error'),
]).catch(() => 'timeout');

let visibleText = '';
try {
  visibleText = (await page.locator('body').innerText({ timeout: 5_000 })).slice(0, 1000);
} catch {
  visibleText = '';
}

console.log(JSON.stringify({
  event: 'login_start_result',
  target,
  result,
  visibleText,
}));

await page.waitForTimeout(10 * 60_000);
await context.close();
