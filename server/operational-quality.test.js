import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import speakeasy from 'speakeasy';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

const mailMocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mailMocks.createTransport,
  },
}));

let server;

function createReq(ip = '203.0.113.10') {
  return {
    headers: {
      'x-forwarded-for': ip,
      'user-agent': 'vitest',
    },
    ip,
    socket: { remoteAddress: ip },
  };
}

function createStore(overrides = {}) {
  return {
    siteSettings: {
      primaryDomain: 'onlinesmmm.com',
      whatsappRoutingEnabled: false,
      notifyPayments: false,
      crmEnabled: false,
      ...overrides.siteSettings,
    },
    users: [],
    customers: [],
    payments: [],
    messages: [],
    auditLogs: [],
    crmEvents: [],
    mailDeliveries: [],
    whatsappConnections: [],
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.IYZICO_SYNC_DISABLED = 'true';
  process.env.SUPERADMIN_PASSWORD = 'TestSuperAdmin123!';
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.MAIL_SMTP_HOST = 'smtp.onlinesmmm.com';
  process.env.MAIL_SMTP_USER = 'mailer@onlinesmmm.com';
  process.env.MAIL_SMTP_PASS = 'secret';
  process.env.MAIL_FROM = 'bilgi@onlinesmmm.com';
  process.env.MAIL_REPLY_TO = 'destek@onlinesmmm.com';
  process.env.MAIL_ALLOWED_DOMAIN = 'onlinesmmm.com';
  mailMocks.createTransport.mockReturnValue({ sendMail: mailMocks.sendMail });
  server = await import('./server.js');
});

beforeEach(() => {
  mailMocks.sendMail.mockReset();
  mailMocks.createTransport.mockClear();
  process.env.MAIL_SMTP_HOST = 'smtp.onlinesmmm.com';
  process.env.MAIL_SMTP_USER = 'mailer@onlinesmmm.com';
  process.env.MAIL_SMTP_PASS = 'secret';
  process.env.MAIL_FROM = 'bilgi@onlinesmmm.com';
  process.env.MAIL_REPLY_TO = 'destek@onlinesmmm.com';
  process.env.MAIL_ALLOWED_DOMAIN = 'onlinesmmm.com';
});

describe('login lockout and 2FA controls', () => {
  test('locks a login key after five failed attempts and clears after success', () => {
    const req = createReq();
    const email = 'admin@onlinesmmm.com';

    for (let index = 0; index < 4; index += 1) {
      server.registerLoginFailure(req, email);
      expect(server.isLoginLocked(req, email)).toBe(false);
    }

    server.registerLoginFailure(req, email);
    expect(server.isLoginLocked(req, email)).toBe(true);

    server.clearLoginFailures(req, email);
    expect(server.isLoginLocked(req, email)).toBe(false);
  });

  test('creates one-time email login challenges and verifies only the matching code', () => {
    const req = createReq();
    const user = { id: 'user-1', email: 'admin@onlinesmmm.com', name: 'Admin' };
    const challenge = server.createLoginChallengeRecord(user, '123456', req);

    expect(server.getLoginChallenge(challenge.id)).toMatchObject({ id: challenge.id, email: user.email });
    expect(server.verifyLoginChallengeCode(challenge, '000000')).toBe(false);
    expect(server.verifyLoginChallengeCode(challenge, '123456')).toBe(true);
  });

  test('verifies generated TOTP secrets for authenticator based 2FA', async () => {
    const { generateTwoFactorSecret, verifyTotp } = await import('./auth.js');
    const secret = generateTwoFactorSecret('admin@onlinesmmm.com');
    const token = speakeasy.totp({ secret: secret.base32, encoding: 'base32' });

    expect(verifyTotp(secret.base32, token)).toBe(true);
    expect(verifyTotp(secret.base32, '000000')).toBe(false);
  });
});

describe('mail delivery quality', () => {
  test('sanitizes unsafe HTML, creates text fallback and records successful delivery', async () => {
    mailMocks.sendMail.mockResolvedValue({
      messageId: 'mail-1',
      accepted: ['client@example.com'],
      rejected: [],
    });
    const store = createStore();

    const result = await server.sendMailWithRetry(store, {
      to: 'client@example.com',
      subject: 'Test',
      html: '<p onclick="steal()">Merhaba</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
    }, { template: 'unit_test' }, { maxAttempts: 1 });

    expect(result.ok).toBe(true);
    expect(mailMocks.sendMail).toHaveBeenCalledTimes(1);
    const sentOptions = mailMocks.sendMail.mock.calls[0][0];
    expect(sentOptions.html).not.toMatch(/script|onclick|javascript:/i);
    expect(sentOptions.text).toContain('Merhaba');
    expect(store.mailDeliveries[0]).toMatchObject({ status: 'sent', attempts: 1, messageId: 'mail-1' });
  });

  test('fails fast when from/reply-to domains are not aligned with the site domain', async () => {
    process.env.MAIL_FROM = 'billing@example.net';
    process.env.MAIL_REPLY_TO = 'support@example.net';
    const store = createStore();

    const result = await server.sendMailWithRetry(store, {
      to: 'client@example.com',
      subject: 'Bad identity',
      html: '<p>Test</p>',
    }, { template: 'unit_test' }, { maxAttempts: 1 });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('mail_identity_misaligned');
    expect(mailMocks.sendMail).not.toHaveBeenCalled();
    expect(store.mailDeliveries[0].status).toBe('failed');
    expect(store.auditLogs[0].severity).toBe('critical');
  });
});

describe('iyzico payment recording quality', () => {
  test('records completed payment once and treats repeated callback as duplicate', async () => {
    const store = createStore({
      customers: [{ id: 'cust-1', name: 'Test Customer', phone: '5555555555' }],
    });

    const first = await server.recordCompletedPayment(store, {
      customerId: 'cust-1',
      amount: '1200.50',
      currency: 'try',
      orderId: 'ORD-1',
      providerToken: 'token-1',
      providerPaymentId: 'pay-1',
      callbackId: 'pay-1',
      paymentStatus: 'completed',
    });
    const second = await server.recordCompletedPayment(store, {
      customerId: 'cust-1',
      amount: '1200.50',
      currency: 'TRY',
      orderId: 'ORD-1',
      providerToken: 'token-1',
      providerPaymentId: 'pay-1',
      callbackId: 'pay-1',
      paymentStatus: 'completed',
    });

    expect(first.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(store.payments).toHaveLength(1);
    expect(store.payments[0]).toMatchObject({ status: 'completed', amount: 1200.5, currency: 'TRY', callbackAttempts: 2 });
    expect(store.customers[0].paymentStatus).toBe('completed');
  });

  test('does not downgrade a completed payment when a later pending callback repeats', async () => {
    const store = createStore({
      customers: [{ id: 'cust-2', name: 'Paid Customer', phone: '5555555555' }],
    });

    await server.recordCompletedPayment(store, {
      customerId: 'cust-2',
      amount: 500,
      currency: 'TRY',
      orderId: 'ORD-2',
      providerPaymentId: 'pay-2',
      paymentStatus: 'completed',
    });
    await server.recordCompletedPayment(store, {
      customerId: 'cust-2',
      amount: 500,
      currency: 'TRY',
      orderId: 'ORD-2',
      providerPaymentId: 'pay-2',
      paymentStatus: 'pending',
    });

    expect(store.payments).toHaveLength(1);
    expect(store.payments[0].status).toBe('completed');
    expect(store.customers[0].paymentStatus).toBe('completed');
  });

  test('normalizes supported amount and currency inputs', () => {
    expect(server.normalizePaymentAmount('1.234,56')).toBe(1234.56);
    expect(server.normalizePaymentCurrency('usd')).toBe('USD');
    expect(server.normalizePaymentCurrency('eur')).toBe('');
  });
});

describe('WhatsApp connection ownership rules', () => {
  test('rejects weak staff passwords before user creation', () => {
    expect(server.validatePasswordStrength('short')).toMatchObject({ ok: false });
    expect(server.validatePasswordStrength('StrongPass1!')).toMatchObject({ ok: true });
  });

  test('detects duplicate WhatsApp phone numbers across saved and session phones', () => {
    const existing = [
      { id: 'conn-1', phone: '905551112233', sessionPhone: '' },
      { id: 'conn-2', phone: '', sessionPhone: '905554445566' },
    ];

    expect(server.findWhatsAppConnectionConflict(existing, { phone: '+90 555 111 22 33' })).toMatchObject({ id: 'conn-1' });
    expect(server.findWhatsAppConnectionConflict(existing, { phone: '905554445566' })).toMatchObject({ id: 'conn-2' });
    expect(server.findWhatsAppConnectionConflict(existing, { id: 'conn-1', phone: '905551112233' })).toBeNull();
  });

  test('allows one WhatsApp owner connection per staff user', () => {
    const existing = [
      { id: 'conn-1', ownerUserId: 'staff-1' },
      { id: 'conn-2', ownerUserId: 'staff-2' },
    ];

    expect(server.findWhatsAppOwnerConflict(existing, 'staff-1')).toMatchObject({ id: 'conn-1' });
    expect(server.findWhatsAppOwnerConflict(existing, 'staff-1', 'conn-1')).toBeNull();
    expect(server.findWhatsAppOwnerConflict(existing, 'staff-3')).toBeNull();
  });

  test('summarizes mixed WhatsApp delivery outcomes', () => {
    expect(server.buildWhatsAppDeliverySummary(['sent:ok', 'FAILED:conn-1:oops', 'NOT_READY:conn-2'])).toMatchObject({
      status: 'partial',
      sent: 1,
      failed: 1,
      skipped: 1,
      total: 3,
    });
    expect(server.buildWhatsAppDeliverySummary(['FAILED:conn-1:oops'])).toMatchObject({
      status: 'failed',
      sent: 0,
      failed: 1,
      skipped: 0,
    });
  });
});

describe('iyzico payment redirect quality', () => {
  test('builds locale-aware result urls and redirects the callback page to the frontend result screen', () => {
    const req = createReq();
    const trUrl = server.resolvePaymentResultUrl({ websiteUrl: 'https://www.onlinesmmm.com' }, req, 'tr');
    const enUrl = server.resolvePaymentResultUrl({ websiteUrl: 'https://www.onlinesmmm.com' }, req, 'en');
    const html = server.renderPaymentResultPage({
      success: true,
      title: 'Teşekkürler',
      message: 'Ödeme alındı',
      redirectHref: enUrl,
    });

    expect(trUrl).toBe('https://www.onlinesmmm.com/odeme/sonuc');
    expect(enUrl).toBe('https://www.onlinesmmm.com/en/odeme/sonuc');
    expect(html).toContain('window.location.replace');
    expect(html).toContain(enUrl);
  });
});

describe('turnstile validation quality', () => {
  test('does not send remote IP by default and allows opt-in transport only', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true }),
    });
    global.fetch = fetchMock;
    process.env.TURNSTILE_SECRET_KEY = 'turnstile-secret';
    delete process.env.TURNSTILE_SEND_REMOTE_IP;

    try {
      const req = createReq('198.51.100.20');
      await server.validateTurnstileToken('token-123', req);
      const payload = fetchMock.mock.calls[0][1].body;

      expect(String(payload)).toContain('secret=turnstile-secret');
      expect(String(payload)).toContain('response=token-123');
      expect(String(payload)).not.toContain('remoteip=');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('does not fall back to site settings secret when env secret is missing', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true }),
    });
    global.fetch = fetchMock;
    delete process.env.TURNSTILE_SECRET_KEY;

    try {
      const req = createReq('198.51.100.21');
      const result = await server.validateTurnstileToken('token-456', req, { turnstileSecretKey: 'settings-secret' });
      expect(result).toMatchObject({ success: true, skipped: true });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('lead progress snapshot quality', () => {
  test('captures field diffs and keeps duplicate snapshots out of the log', () => {
    const previousSnapshot = {
      step: 2,
      selectedCompanyType: 'sole',
      selectedCompanyTypeLabel: 'Şahıs Şirketi',
      activity: { mainActivity: 'service' },
      lead: { phone: '5551112233' },
      files: ['kimlik.pdf'],
      estimate: '1200',
      paymentReady: false,
      stepLabel: 'Şirket Türü',
      locale: 'tr',
      source: 'wizard',
      stepSummary: 'Şirket türü seçildi',
      progress: null,
    };
    const nextSnapshot = {
      ...previousSnapshot,
      step: 3,
      stepLabel: 'Ana Faaliyet',
      activity: { mainActivity: 'consulting' },
      stepSummary: 'Faaliyet seçildi',
    };

    const changes = server.collectLeadProgressChanges(previousSnapshot, nextSnapshot);
    expect(changes.changedFields).toEqual(expect.arrayContaining(['step', 'stepLabel', 'activity', 'stepSummary']));
    expect(server.shouldRecordLeadProgressSnapshot(previousSnapshot, nextSnapshot)).toBe(true);
    expect(server.shouldRecordLeadProgressSnapshot(nextSnapshot, nextSnapshot)).toBe(false);
    expect(server.isMeaningfulLeadProgressStep(3)).toBe(true);
    expect(server.isMeaningfulLeadProgressStep(1)).toBe(false);
    expect(server.isPackageReadyTransition(nextSnapshot)).toBe(false);
    expect(server.isPackageReadyTransition({ ...nextSnapshot, previousStep: 7, step: 8 })).toBe(true);

    const keyA = server.normalizeLeadProgressNotificationKey(nextSnapshot, 'session-1', 'visitor-1');
    const keyB = server.normalizeLeadProgressNotificationKey(nextSnapshot, 'session-1', 'visitor-1');
    expect(keyA).toBe(keyB);
    expect(server.buildApplicationPackageNotificationKey({ id: 'customer-1', applicationId: 'APP-1' })).toBe('package-ready:APP-1:customer-1');
    expect(server.buildLeadProgressSignature(nextSnapshot)).toHaveLength(40);
  });
});

describe('document upload safety', () => {
  test('rejects active PDF content even when extension and MIME look valid', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'onlinesmmm-upload-'));
    const filePath = path.join(tempDir, 'unsafe.pdf');

    try {
      await writeFile(filePath, '%PDF-1.7\n1 0 obj\n<< /OpenAction 2 0 R /JavaScript (app.alert("x")) >>\nendobj\n');
      const result = await server.validateUploadedFileSafety({
        path: filePath,
        originalname: 'unsafe.pdf',
        mimetype: 'application/pdf',
      });

      expect(result).toMatchObject({ ok: false, reason: 'active_pdf_content' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('whatsapp connection uniqueness', () => {
  test('detects duplicate phone and session phone conflicts before a session starts', () => {
    const connections = [
      { id: 'conn-1', phone: '905551112233', sessionPhone: '' },
      { id: 'conn-2', phone: '', sessionPhone: '905559998877' },
    ];

    expect(server.findWhatsAppConnectionConflict(connections, { phone: '+90 555 111 22 33' })).toMatchObject({ id: 'conn-1' });
    expect(server.findWhatsAppConnectionConflict(connections, { phone: '905559998877' })).toMatchObject({ id: 'conn-2' });
    expect(server.findWhatsAppConnectionConflict(connections, { id: 'conn-1', phone: '905551112233' })).toBeNull();
  });
});

describe('whatsapp runtime checks', () => {
  test('explains missing Chrome libraries and disables single-process only by env', async () => {
    const originalEnv = {
      WHATSAPP_CHROME_PATH: process.env.WHATSAPP_CHROME_PATH,
      PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
      WHATSAPP_CHROME_SINGLE_PROCESS: process.env.WHATSAPP_CHROME_SINGLE_PROCESS,
    };
    process.env.WHATSAPP_CHROME_PATH = '';
    process.env.PUPPETEER_EXECUTABLE_PATH = '';
    process.env.WHATSAPP_CHROME_SINGLE_PROCESS = 'true';

    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('missing');
      }),
      execSync: vi.fn(() => {
        throw new Error('missing');
      }),
    }));
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => false),
      constants: { R_OK: 4, W_OK: 2 },
    }));
    vi.doMock('node:fs/promises', () => ({
      access: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      rm: vi.fn(async () => {}),
      unlink: vi.fn(async () => {}),
      writeFile: vi.fn(async () => {}),
    }));

    try {
      const whatsappService = await import('./whatsapp-service.js');
      expect(whatsappService.getPuppeteerArgs()).toContain('--single-process');
      const preflight = await whatsappService.getWhatsAppPreflightStatus();
      expect(preflight.ok).toBe(false);
      expect(preflight.hints.join(' ')).toMatch(/Chrome|WHATSAPP_CHROME_PATH/);
      expect(whatsappService.describeChromeLaunchFailure(new Error('error while loading shared libraries: libgbm.so.1'))).toMatch(/libgbm1/);
    } finally {
      vi.doUnmock('node:child_process');
      vi.doUnmock('node:fs');
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
      process.env.WHATSAPP_CHROME_PATH = originalEnv.WHATSAPP_CHROME_PATH;
      process.env.PUPPETEER_EXECUTABLE_PATH = originalEnv.PUPPETEER_EXECUTABLE_PATH;
      process.env.WHATSAPP_CHROME_SINGLE_PROCESS = originalEnv.WHATSAPP_CHROME_SINGLE_PROCESS;
    }
  });
});
