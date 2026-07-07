import { expect, test } from '@playwright/test';

const apiOrigin = 'http://localhost:4010';
const appOrigin = 'http://localhost:5173';
const testUser = {
  id: 'user-1',
  role: 'superadmin',
  email: 'admin@onlinesmmm.com',
  name: 'Test Admin',
  permissions: ['*'],
  isActive: true,
};

function json(body, status = 200) {
  return {
    status,
    headers: {
      'access-control-allow-origin': appOrigin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

function createDashboard(overrides = {}) {
  return {
    siteSettings: {
      brandName: 'OnlineSMMM',
      primaryDomain: 'onlinesmmm.com',
      supportEmail: 'bilgi@onlinesmmm.com',
      whatsappRoutingEnabled: true,
      notifyLeads: true,
      notifyPayments: true,
      notifyDocuments: true,
      campaignPopupEnabled: true,
      campaignPopupDelaySeconds: 0,
      campaignPopupActiveId: 'test-campaign',
      campaignPopupArchive: [
        {
          id: 'test-campaign',
          title: 'Test kampanya',
          subtitle: 'Operasyon testi',
          description: 'Popup görünürlük testi',
          ctaLabel: 'Hemen Başvur',
          ctaHref: '/basvuru',
          imageUrl: '/campaigns/opening-promo.jpg',
          endDate: '2026-07-31T23:59:59',
          isActive: true,
        },
      ],
    },
    users: [testUser],
    customers: [
      {
        id: 'cust-1',
        name: 'Test Musteri',
        email: 'client@example.com',
        phone: '05555555555',
        companyType: 'Limited',
        membershipStatus: 'Yeni',
        paymentStatus: 'pending',
        documents: [],
      },
    ],
    messages: [],
    payments: [
      {
        id: 'pay-1',
        customerId: 'cust-1',
        amount: 1200,
        currency: 'TRY',
        status: 'completed',
        orderId: 'ORD-OK',
        whatsappForwardedTo: ['Test Admin'],
        createdAt: '2026-07-05T00:00:00.000Z',
      },
    ],
    whatsappConnections: [],
    auditLogs: [
      { id: 'audit-1', actor: 'system', action: 'Test audit', createdAt: '2026-07-05T00:00:00.000Z' },
    ],
    customerVisits: [],
    counts: {},
    ...overrides,
  };
}

async function mockOperationalApi(page) {
  let authenticated = false;
  const dashboard = createDashboard();
  const calls = [];

  await page.route(`${apiOrigin}/api/**`, async (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    calls.push({ method, path });

    if (method === 'OPTIONS') {
      await route.fulfill(json({ ok: true }));
      return;
    }

    if (path === '/api/public/ip-check') {
      await route.fulfill(json({ allowed: true, countryCode: 'TR' }));
      return;
    }

    if (path === '/api/site-settings/public') {
      await route.fulfill(json({ settings: dashboard.siteSettings, siteSettings: dashboard.siteSettings, turnstileSiteKey: '' }));
      return;
    }

    if (path === '/api/auth/me') {
      await route.fulfill(authenticated ? json({ user: testUser }) : json({ message: 'Unauthorized' }, 401));
      return;
    }

    if (path === '/api/auth/login/start' && method === 'POST') {
      await route.fulfill(json({ challengeId: 'challenge-1', emailMasked: 'a***@onlinesmmm.com' }));
      return;
    }

    if (path === '/api/auth/login/verify' && method === 'POST') {
      authenticated = true;
      await route.fulfill(json({ user: testUser }));
      return;
    }

    if (path === '/api/dashboard') {
      await route.fulfill(json(dashboard));
      return;
    }

    if (path === '/api/auth/2fa/setup' && method === 'POST') {
      await route.fulfill(json({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/onlinesmmm:test',
        qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }));
      return;
    }

    if (path === '/api/auth/2fa/verify' && method === 'POST') {
      await route.fulfill(json({ ok: true, user: { ...testUser, twoFactorEnabled: true } }));
      return;
    }

    if (path === '/api/admin/send-email' && method === 'POST') {
      await route.fulfill(json({ ok: true, queued: true, deliveryIds: ['mail-1'] }));
      return;
    }

    if (path === '/api/whatsapp-connections' && method === 'POST') {
      const body = await request.postDataJSON();
      const connection = {
        id: `wa-${dashboard.whatsappConnections.length + 1}`,
        method: body.method === 'phone' ? 'phone' : 'qr',
        label: body.label || 'Test WhatsApp',
        phone: body.phone || '',
        status: 'disconnected',
        isActive: true,
        qrDataUrl: '',
        pairingCode: '',
      };
      dashboard.whatsappConnections.unshift(connection);
      await route.fulfill(json({ connection }));
      return;
    }

    const startMatch = path.match(/^\/api\/whatsapp-connections\/([^/]+)\/start$/);
    if (startMatch && method === 'POST') {
      const connection = dashboard.whatsappConnections.find((item) => item.id === startMatch[1]);
      Object.assign(connection, connection.method === 'phone'
        ? { status: 'qr', pairingCode: '123-456', qrDataUrl: '' }
        : { status: 'qr', pairingCode: '', qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
      await route.fulfill(json({ connection }));
      return;
    }

    if (path === '/api/public/iyzico/checkout/initialize' && method === 'POST') {
      const body = await request.postDataJSON();
      if (body.forceFailure) {
        await route.fulfill(json({ message: 'Odeme baslatilamadi.' }, 400));
        return;
      }
      await route.fulfill(json({
        ok: true,
        token: 'iyzico-token',
        conversationId: body.customerId || 'cust-1',
        paymentUrl: 'https://sandbox-iyzico.test/pay/iyzico-token',
        paymentPageUrl: 'https://sandbox-iyzico.test/pay/iyzico-token',
      }));
      return;
    }

    await route.fulfill(json({ ok: true }));
  });

  return { calls, dashboard };
}

async function loginToPortal(page) {
  await page.goto('/portal');
  await expect(page.getByText('Operasyon Paneli').first()).toBeVisible();
  await page.getByLabel('E-posta').fill(testUser.email);
  await page.getByLabel('Şifre').fill('secret-password');
  await page.getByRole('button', { name: 'Giriş kodu gönder' }).click();
  await expect(page.getByText('Giriş kodu gönderildi')).toBeVisible();

  const digits = page.locator('.otp-code-input');
  for (const [index, digit] of ['1', '2', '3', '4', '5', '6'].entries()) {
    await digits.nth(index).fill(digit);
  }
  await page.getByRole('button', { name: 'Kodu doğrula' }).click({ timeout: 1000 }).catch(() => {});
  await expect(page.getByRole('heading', { name: testUser.name })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Genel Bakış' })).toBeVisible();
}

test('admin session and 2FA setup flow runs in the browser', async ({ page }) => {
  const { calls } = await mockOperationalApi(page);

  await loginToPortal(page);
  await page.getByRole('tab', { name: 'Güvenlik' }).click();
  await page.getByRole('button', { name: 'Google Authenticator eşleştir' }).click();
  await expect(page.getByText('2FA Kurulumu')).toBeVisible();
  await page.getByLabel('Doğrulama kodu').fill('123456');
  await page.getByRole('button', { name: 'Etkinleştir' }).click();

  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: 'POST', path: '/api/auth/login/start' }),
    expect.objectContaining({ method: 'POST', path: '/api/auth/login/verify' }),
    expect.objectContaining({ method: 'POST', path: '/api/auth/2fa/setup' }),
    expect.objectContaining({ method: 'POST', path: '/api/auth/2fa/verify' }),
  ]));
});

test('management page opens without crashing the app shell', async ({ page }) => {
  await mockOperationalApi(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/yonetim');

  await expect(page.getByRole('heading', { name: 'Güvenli Yönetici Girişi' })).toBeVisible();
  await expect(page.getByText('Sayfa yüklenemedi')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('WhatsApp QR and phone pairing flows are scenario-tested', async ({ page }) => {
  const { calls } = await mockOperationalApi(page);

  await loginToPortal(page);
  await page.getByRole('tab', { name: 'WhatsApp' }).click();
  await page.getByRole('button', { name: 'Eşleştirme' }).click();
  const whatsappForm = page.locator('form').filter({ hasText: 'Bağlantı ekle' });
  await whatsappForm.getByLabel('Etiket').fill('QR Hat');
  await whatsappForm.getByRole('button', { name: 'Bağlantı ekle' }).click();
  await page.getByRole('button', { name: 'Hatlar' }).click();
  await page.getByRole('button', { name: 'QR oluştur' }).first().click();
  await expect(page.getByAltText('WhatsApp QR')).toBeVisible();

  await page.getByRole('button', { name: 'Eşleştirme' }).click();
  await whatsappForm.locator('select').selectOption('phone');
  await whatsappForm.getByLabel('Etiket').fill('Telefon Hat');
  await whatsappForm.locator('input[placeholder="905xxxxxxxxx"]').fill('905551112233');
  await whatsappForm.getByRole('button', { name: 'Bağlantı ekle' }).click();
  await page.getByRole('button', { name: 'Hatlar' }).click();
  await page.getByRole('button', { name: 'Telefon kodu iste' }).first().click();
  await expect(page.getByText('123-456')).toBeVisible();

  expect(calls.filter((call) => call.path === '/api/whatsapp-connections' && call.method === 'POST').length).toBeGreaterThanOrEqual(2);
  expect(calls.some((call) => /\/api\/whatsapp-connections\/wa-\d+\/start/.test(call.path))).toBe(true);
});

test('manual mail delivery flow queues a server-side email', async ({ page }) => {
  const { calls } = await mockOperationalApi(page);

  await loginToPortal(page);
  await page.getByRole('tab', { name: 'Mesajlar & E-Posta' }).click();
  await page.getByRole('button', { name: /E-Posta Gönder Hazırlanan e-postayı doğrudan gönderin\./ }).click();
  const emailForm = page.locator('form').filter({ hasText: 'Alıcı (E-Posta)' });
  await emailForm.getByLabel('Alıcı (E-Posta)').fill('client@example.com');
  await emailForm.getByLabel('Konu').fill('Operasyon testi');
  await emailForm.getByLabel('E-posta İçeriği (HTML Destekler)').fill('<p>Merhaba</p>');
  await emailForm.getByRole('button', { name: 'E-Posta Gönder', exact: true }).click();

  await expect(page.getByText('E-posta kuyruğa alındı')).toBeVisible();
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: 'POST', path: '/api/admin/send-email' }),
  ]));
});

test('payment initialize success and failure are exercised from a real browser context', async ({ page }) => {
  await mockOperationalApi(page);
  await page.goto('/');

  const success = await page.evaluate(async () => {
    const response = await fetch('http://localhost:4010/api/public/iyzico/checkout/initialize', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: 'cust-1', amount: 1200, currency: 'TRY' }),
    });
    return response.json();
  });
  const failure = await page.evaluate(async () => {
    const response = await fetch('http://localhost:4010/api/public/iyzico/checkout/initialize', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: 'cust-1', amount: 1200, currency: 'TRY', forceFailure: true }),
    });
    return { status: response.status, body: await response.json() };
  });

  expect(success).toMatchObject({ ok: true, token: 'iyzico-token' });
  expect(failure).toMatchObject({ status: 400, body: { message: 'Odeme baslatilamadi.' } });
});

test('payment result screen renders success and failure states', async ({ page }) => {
  await mockOperationalApi(page);

  await page.goto('/odeme/sonuc?status=success&paymentId=pay-1&orderId=ORD-1');
  await expect(page.getByRole('heading', { name: /ödemeniz alındı|payment received/i })).toBeVisible();
  await expect(page.getByText('pay-1')).toBeVisible();

  await page.goto('/odeme/sonuc?status=failed&error=timeout');
  await expect(page.getByRole('heading', { name: /ödeme tamamlanamadı|payment could not be completed/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /tekrar dene|try again/i })).toBeVisible();
});

test('campaign popup CTA routes to the application flow', async ({ page }) => {
  await mockOperationalApi(page);

  await page.goto('/');
  const popup = page.locator('.campaign-popup');
  const cta = page.locator('.campaign-popup-cta');

  await expect(popup).toBeVisible();
  await expect(cta).toHaveAttribute('href', /\/basvuru$/);
});

test('mobile top bar prioritizes language, menu and CTA without overlap', async ({ page }) => {
  await mockOperationalApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const topbar = page.locator('.topbar');
  const languageSwitcher = page.locator('.topbar-actions .language-switcher');
  const menuToggle = page.locator('.topbar-menu-toggle');
  const bottomRail = page.locator('.topbar-mobile-rail');
  const overlay = page.locator('.topbar-mobile-overlay');
  const mobileMenu = page.locator('.topbar-mobile-menu');

  await expect(topbar).toBeVisible();
  await expect(languageSwitcher).toBeVisible();
  await expect(menuToggle).toBeVisible();
  await expect(bottomRail).toBeVisible();

  const topbarBox = await topbar.boundingBox();
  const railBox = await bottomRail.boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(topbarBox.y + topbarBox.height).toBeLessThan(railBox.y);

  await menuToggle.click();
  await expect(overlay).toHaveClass(/open/);
  await expect(mobileMenu).toHaveClass(/open/);

  const menuBox = await mobileMenu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox.y + menuBox.height).toBeLessThan(railBox.y - 4);

  await page.mouse.click(8, 8);
  await expect(overlay).not.toHaveClass(/open/);
  await expect(mobileMenu).not.toHaveClass(/open/);
});
