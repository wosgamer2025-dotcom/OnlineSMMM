import { chromium } from '@playwright/test';

const targetUrl = process.env.SMOKE_URL || 'https://www.onlinesmmm.com/';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const response = await desktop.goto(targetUrl, { waitUntil: 'load' });
  assert(response?.ok(), `Ana sayfa cevap vermedi: ${response?.status()}`);
  assert(desktop.url().startsWith('https://www.onlinesmmm.com'), `Canonical URL beklenmedik: ${desktop.url()}`);
  await desktop.waitForTimeout(800);

  const popupVisible = await desktop.locator('.campaign-popup').count();
  assert(popupVisible > 0, 'Kampanya popup görünmedi.');

  const whatsappLinks = await desktop.locator('a[href*="wa.me"]').count();
  assert(whatsappLinks > 0, 'WhatsApp linki bulunamadı.');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mobile.goto(targetUrl, { waitUntil: 'load' });
  await mobile.waitForTimeout(800);
  const closeCount = await mobile.locator('.campaign-popup-close').count();
  if (closeCount) {
    await mobile.locator('.campaign-popup-close').click();
  }
  await mobile.locator('#process').scrollIntoViewIfNeeded();
  const railBox = await mobile.locator('.topbar-mobile-rail').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      position: style.position,
      bottom: Math.round(rect.bottom),
      viewportHeight: window.innerHeight,
    };
  });
  assert(railBox.position === 'fixed', 'Mobil alt bar fixed değil.');
  assert(railBox.bottom <= railBox.viewportHeight + 2, 'Mobil alt bar ekran dışına taşıyor.');

  console.log('Smoke test passed:', targetUrl);
} finally {
  await browser.close();
}
