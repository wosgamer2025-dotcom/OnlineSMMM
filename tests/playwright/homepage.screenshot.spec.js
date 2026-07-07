import { test, expect } from '@playwright/test';

const viewports = [
  { width: 320, height: 800, name: '320x800' },
  { width: 375, height: 812, name: '375x812' },
  { width: 430, height: 900, name: '430x900' },
  { width: 768, height: 1024, name: '768x1024' },
  { width: 1024, height: 768, name: '1024x768' },
  { width: 1440, height: 900, name: '1440x900' },
  { width: 1920, height: 1080, name: '1920x1080' },
];

const pages = [
  { path: '/', name: 'homepage' },
  { path: '/#start', name: 'company-wizard' },
];

for (const viewport of viewports) {
  for (const pageInfo of pages) {
    test(`${pageInfo.name} screenshot at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(pageInfo.path);
      await page.waitForSelector('#root');
      await expect(page).toHaveScreenshot(`${pageInfo.name}-${viewport.name}.png`, { fullPage: true, timeout: 30000 });
    });
  }
}
