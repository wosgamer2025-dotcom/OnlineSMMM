import express from 'express';
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ONLINESMMM_ENV_FILE || '/var/www/onlinesmmm/.env', quiet: true });
dotenv.config({ quiet: true });

import cors from 'cors';
import crypto from 'node:crypto';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import dns from 'node:dns/promises';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import bcrypt from 'bcryptjs';
import Iyzipay from 'iyzipay';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import {
  defaultLocationCatalog,
  getProvinces,
  getDistricts,
  getNeighborhoods,
  normalizeLocationCatalog,
  syncLocationCatalogFromUrl,
} from './locations.js';
import {
  getUploadsDir,
  initializeStore,
  loadStore,
  saveStore,
} from './data-store.js';
import {
  generateTwoFactorSecret,
  sanitizeUser,
  signToken,
  verifyToken,
  verifyTotp,
} from './auth.js';
import {
  disconnectWhatsAppClient,
  ensureWhatsAppClient,
  getConnectionRuntime,
  getWhatsAppPreflightStatus,
  resetWhatsAppSession,
  sanitizePhone,
  sendWhatsAppMessage,
} from './whatsapp-service.js';

const serverModulePath = fileURLToPath(import.meta.url);
const isDirectServerRun = true;
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 4010);
const serverDir = path.dirname(serverModulePath);
const clientDistDir = path.resolve(serverDir, '..', 'dist');
const defaultDevSuperAdminPassword = 'OnlinEsmmM2026.,!';
if (isProduction && !process.env.SUPERADMIN_PASSWORD) {
  throw new Error('SUPERADMIN_PASSWORD must be set in production.');
}
const superAdminEmail = String(process.env.SUPERADMIN_EMAIL || 'igurganx7@gmail.com').toLowerCase();
const superAdminPassword = process.env.SUPERADMIN_PASSWORD || defaultDevSuperAdminPassword;
await initializeStore(superAdminPassword);

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true }));
const rateLimitBuckets = new Map();
const loginAttempts = new Map();
const loginChallenges = new Map();
const allowLoginEmailFailureFallback = String(process.env.LOGIN_ALLOW_EMAIL_FAILURE_FALLBACK || '').toLowerCase() === 'true';
const allowPasswordOnlyLogin = String(process.env.LOGIN_PASSWORD_ONLY_MODE || '').toLowerCase() === 'true';
const mailQueue = [];
let mailQueueProcessing = false;
let publicSiteSettingsCache = null;
const authCookieName = 'onlinesmmm_admin_token';
const operationTimeouts = {
  mailMs: Number(process.env.MAIL_TIMEOUT_MS || 60_000),
  whatsappMs: Number(process.env.WHATSAPP_OPERATION_TIMEOUT_MS || 180_000),
  iyzicoMs: Number(process.env.IYZICO_OPERATION_TIMEOUT_MS || 20_000),
};
const whatsappNotificationRetryIntervalMs = Math.max(60_000, Number(process.env.WHATSAPP_NOTIFICATION_RETRY_INTERVAL_MS || 60_000));
const whatsappNotificationMaxRetries = Math.max(0, Number(process.env.WHATSAPP_NOTIFICATION_MAX_RETRIES || 6));
let whatsappNotificationRetryRunning = false;
const loginMailTimeoutMs = Number(process.env.LOGIN_MAIL_TIMEOUT_MS || operationTimeouts.mailMs || 60_000);
const loginCodeTtlSeconds = Math.max(60, Number(process.env.LOGIN_CODE_TTL_SECONDS || 5 * 60));
const loginCodeTtlMs = loginCodeTtlSeconds * 1000;
const mailDefaults = {
  from: process.env.MAIL_FROM || process.env.SMTP_FROM || 'bilgi@onlinesmmm.com',
  replyTo: process.env.MAIL_REPLY_TO || process.env.SMTP_REPLY_TO || process.env.MAIL_FROM || process.env.SMTP_FROM || 'bilgi@onlinesmmm.com',
  inboundSecret: process.env.MAIL_INBOUND_SECRET || process.env.INBOUND_MAIL_SECRET || '',
};
const rateLimitPresets = {
  public: { windowMs: 60_000, max: 90 },
  lead: { windowMs: 60_000, max: 12 },
  leadProgress: { windowMs: 60_000, max: 90 },
  payment: { windowMs: 60_000, max: 20 },
  auth: { windowMs: 15 * 60_000, max: 20 },
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseCookies(cookieHeader = '') {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
      const [name, ...rest] = pair.split('=');
      if (!name) return cookies;
      cookies[name] = decodeURIComponent(rest.join('=') || '');
      return cookies;
    }, {});
}

function emitStructuredLog(event, details = {}, level = 'info') {
  const payload = {
    ts: now(),
    event,
    level,
    ...details,
  };
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  logger(JSON.stringify(payload));
}

function getSessionContextFromRequest(req) {
  const body = req?.body || {};
  const query = req?.query || {};
  return String(
    body.sessionId ||
    body.conversationId ||
    query.sessionId ||
    query.conversationId ||
    body.visitorId ||
    query.visitorId ||
    '',
  ).slice(0, 80);
}

function getRequestObservability(req, extra = {}) {
  return {
    requestId: req.requestId || '',
    method: req.method,
    path: req.originalUrl || req.path || '',
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
    userId: req.auth?.sub || extra.userId || '',
    userEmail: req.auth?.email || extra.userEmail || '',
    role: req.auth?.role || extra.role || '',
    sessionId: extra.sessionId || getSessionContextFromRequest(req),
    customerId: String(extra.customerId || '').slice(0, 80),
    conversationId: String(extra.conversationId || '').slice(0, 80),
  };
}

function observeDuration(startedAt) {
  return Math.round(performance.now() - startedAt);
}

function createRequestId() {
  return uuidv4();
}

function getAuthToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[authCookieName] || '';
}

function buildAuthCookie(token) {
  const ttlHours = Number(process.env.ADMIN_SESSION_TTL_HOURS || 2) || 2;
  const maxAgeSeconds = Math.max(60, Math.round(ttlHours * 60 * 60));
  const secureFlag = isProduction ? ['Secure'] : [];
  return [
    `${authCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...secureFlag,
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

function clearAuthCookie() {
  const secureFlag = isProduction ? ['Secure'] : [];
  return [
    `${authCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...secureFlag,
    'Max-Age=0',
  ].join('; ');
}

function generateLoginCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function validatePasswordStrength(password = '') {
  const value = String(password || '');
  if (value.length < 10) {
    return { ok: false, message: 'Şifre en az 10 karakter olmalı.' };
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    return { ok: false, message: 'Şifre büyük harf, küçük harf, rakam ve özel karakter içermeli.' };
  }
  return { ok: true };
}

function createLoginChallengeRecord(user, code, req) {
  const challengeId = uuidv4();
  const salt = crypto.randomUUID();
  const codeHash = crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
  const clientIp = getClientIp(req);
  const expiresAt = Date.now() + loginCodeTtlMs;
  const record = {
    id: challengeId,
    userId: user.id,
    email: user.email,
    salt,
    codeHash,
    attempts: 0,
    expiresAt,
    ip: clientIp,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
    createdAt: now(),
  };
  for (const [id, existing] of loginChallenges.entries()) {
    if (existing.email.toLowerCase() === user.email.toLowerCase()) {
      loginChallenges.delete(id);
    }
  }
  loginChallenges.set(challengeId, record);
  return record;
}

function getLoginChallenge(challengeId) {
  const challenge = loginChallenges.get(String(challengeId || ''));
  if (!challenge) return null;
  if (challenge.expiresAt <= Date.now()) {
    loginChallenges.delete(challenge.id);
    return null;
  }
  return challenge;
}

function verifyLoginChallengeCode(challenge, code) {
  const nextHash = crypto.createHash('sha256').update(`${challenge.salt}:${String(code || '')}`).digest('hex');
  return nextHash === challenge.codeHash;
}

function resetLoginChallengeCode(challenge, code, req) {
  const salt = crypto.randomUUID();
  challenge.salt = salt;
  challenge.codeHash = crypto.createHash('sha256').update(`${salt}:${String(code || '')}`).digest('hex');
  challenge.attempts = 0;
  challenge.expiresAt = Date.now() + loginCodeTtlMs;
  challenge.ip = getClientIp(req);
  challenge.userAgent = String(req.headers['user-agent'] || '').slice(0, 240);
  challenge.updatedAt = now();
  return challenge;
}

function buildLoginCodeEmailHtml(user, code) {
  const safeName = escapeHtml(user.name || user.email || 'Kullanıcı');
  const safeCode = escapeHtml(String(code || ''));
  const validityMinutes = Math.max(1, Math.round(loginCodeTtlSeconds / 60));
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef5ff;margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #dbeafe;border-radius:16px;">
            <tr>
              <td style="background:#0f172a;color:#ffffff;padding:18px 22px;border-radius:16px 16px 0 0;font:700 13px Arial,Helvetica,sans-serif;letter-spacing:.06em;text-transform:uppercase;">OnlineSMMM Guvenli Giris</td>
            </tr>
            <tr>
              <td style="padding:26px 22px 10px;">
                <h1 style="font:700 24px/1.25 Arial,Helvetica,sans-serif;color:#0f172a;margin:0 0 10px;">Dogrulama kodunuz hazir</h1>
                <p style="font:400 15px/1.6 Arial,Helvetica,sans-serif;color:#334155;margin:0;">Merhaba ${safeName}, portal veya yonetim girisini tamamlamak icin asagidaki 6 haneli kodu kullanin.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:18px 22px 14px;">
                <div style="display:block;width:100%;max-width:360px;box-sizing:border-box;border:1px solid #bfdbfe;border-radius:14px;background:#f8fbff;padding:16px 10px;text-align:center;font:800 34px/1.1 Arial,Helvetica,sans-serif;color:#0f172a;letter-spacing:10px;">${safeCode}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 22px 24px;">
                <p style="font:700 14px/1.5 Arial,Helvetica,sans-serif;color:#1d4ed8;margin:0 0 10px;">Bu kod ${validityMinutes} dakika gecerlidir.</p>
                <p style="font:400 13px/1.6 Arial,Helvetica,sans-serif;color:#64748b;margin:0;">Bu kodu kimseyle paylasmayin. Bu giris denemesi size ait degilse e-postayi dikkate almayin.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

async function sendAdminLoginCodeEmail(store, user, code, req) {
  const startedAt = performance.now();
  const recipient = String(user.email || '').trim();
  if (!recipient) {
    throw new Error('Kullanıcı e-postası bulunamadı.');
  }

  const settings = getServerMailSettings(store.siteSettings || {});
  if (!isMailConfigured(settings)) {
    if (isProduction) {
      throw new Error('Sunucu mail env ayarları yapılandırılmamış. Kod e-postası gönderilemedi.');
    }
    console.warn(`[DEV LOGIN CODE] ${recipient}: ${code}`);
    emitStructuredLog('mail_delivery', {
      ...getRequestObservability(req, { userId: user.id, userEmail: user.email, role: user.role }),
      delivery: 'skipped',
      template: 'admin_login_code',
      recipient,
      recipients: 1,
      messageId: '',
      durationMs: observeDuration(startedAt),
      statusCode: 200,
      subject: 'Admin giriş kodu',
      devCode: code,
    }, 'warn');
    return { ok: true, skipped: true };
  }

  const result = await sendMailWithRetry(store, {
    to: recipient,
    subject: 'OnlineSMMM yönetim giriş kodu',
    html: buildLoginCodeEmailHtml(user, code),
    text: `OnlineSMMM yönetim giriş kodunuz: ${code}. Bu kod ${Math.max(1, Math.round(loginCodeTtlSeconds / 60))} dakika geçerlidir.`,
  }, {
    ...getRequestObservability(req, { userId: user.id, userEmail: user.email, role: user.role }),
    template: 'admin_login_code',
    recipient,
    recipients: 1,
    subject: 'OnlineSMMM yönetim giriş kodu',
  }, { maxAttempts: 1, timeoutMs: loginMailTimeoutMs });
  if (!result.ok) {
    const error = new Error(result.errorMessage || 'Kod e-postası gönderilemedi.');
    error.code = result.errorCode || 'mail_send_failed';
    error.deliveryId = result.deliveryId || '';
    throw error;
  }
  const info = result.info || {};
  const durationMs = observeDuration(startedAt);
  emitStructuredLog('mail_delivery', {
    ...getRequestObservability(req, { userId: user.id, userEmail: user.email, role: user.role }),
    delivery: 'sent',
    template: 'admin_login_code',
    recipient,
    recipients: 1,
    accepted: Array.isArray(info.accepted) ? info.accepted.length : 0,
    rejected: Array.isArray(info.rejected) ? info.rejected.length : 0,
    messageId: info.messageId || '',
    durationMs,
    statusCode: 200,
    subject: 'OnlineSMMM yönetim giriş kodu',
  }, 'info');
  return { ok: true };
}

async function validateTurnstileToken(token, req) {
  const turnstileSecret = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (!turnstileSecret) {
    if (isProduction) {
      throw new Error('TURNSTILE_SECRET_KEY is not configured.');
    }
    return { success: true, skipped: true };
  }

  const responseToken = String(token || '').trim();
  if (!responseToken) {
    return { success: false, 'error-codes': ['missing-input-response'] };
  }

  const body = new URLSearchParams({
    secret: turnstileSecret,
    response: responseToken,
  });

  const remoteip = (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.ip ||
    req.socket.remoteAddress ||
    ''
  ).split(',')[0].trim();
  const shouldSendRemoteIp = String(process.env.TURNSTILE_SEND_REMOTE_IP || '').toLowerCase() === 'true';
  if (shouldSendRemoteIp && remoteip) {
    body.set('remoteip', remoteip);
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    return await response.json();
  } catch (error) {
    console.error('Turnstile validation failed:', error.message);
    return { success: false, 'error-codes': ['internal-error'] };
  }
}

function createRateLimiter(name, options = {}) {
  const { windowMs, max } = { ...(rateLimitPresets[name] || rateLimitPresets.public), ...options };
  return (req, res, next) => {
    const key = `${name}:${getClientIp(req)}:${req.path}`;
    const timestamp = Date.now();
    const bucket = rateLimitBuckets.get(key) || { count: 0, resetAt: timestamp + windowMs };
    if (timestamp > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = timestamp + windowMs;
    }
    bucket.count += 1;
    rateLimitBuckets.set(key, bucket);
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - timestamp) / 1000));
      return res.status(429).json({ message: 'Çok fazla istek gönderildi. Lütfen kısa süre sonra tekrar deneyin.' });
    }
    return next();
  };
}

function getLoginAttemptKey(req, email) {
  return `${getClientIp(req)}:${String(email || '').toLowerCase()}`;
}

function isLoginLocked(req, email) {
  const record = loginAttempts.get(getLoginAttemptKey(req, email));
  return Boolean(record?.lockedUntil && record.lockedUntil > Date.now());
}

function registerLoginFailure(req, email) {
  const key = getLoginAttemptKey(req, email);
  const current = loginAttempts.get(key) || { count: 0, firstAt: Date.now(), lockedUntil: 0 };
  const windowMs = 15 * 60_000;
  if (Date.now() - current.firstAt > windowMs) {
    current.count = 0;
    current.firstAt = Date.now();
    current.lockedUntil = 0;
  }
  current.count += 1;
  if (current.count >= 5) {
    current.lockedUntil = Date.now() + 15 * 60_000;
  }
  loginAttempts.set(key, current);
  return current;
}

function clearLoginFailures(req, email) {
  loginAttempts.delete(getLoginAttemptKey(req, email));
}

function getServerMailSettings(siteSettings = {}) {
  const envHost = process.env.MAIL_SMTP_HOST || process.env.SMTP_HOST || '';
  const envUser = process.env.MAIL_SMTP_USER || process.env.SMTP_USER || '';
  const envPass = process.env.MAIL_SMTP_PASS || process.env.SMTP_PASS || '';
  const brevoApiKey = process.env.BREVO_API_KEY || process.env.MAIL_BREVO_API_KEY || '';
  const cloudflareAccountId = process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const cloudflareApiToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN || '';
  const allowSettingsFallback = process.env.MAIL_ALLOW_DB_SETTINGS === 'true' || !isProduction;
  const smtpHost = envHost || (allowSettingsFallback ? siteSettings.smtpHost : '');
  const smtpUser = envUser || (allowSettingsFallback ? siteSettings.smtpUser : '');
  const smtpPass = envPass || (allowSettingsFallback ? siteSettings.smtpPass : '');
  const rawPort = process.env.MAIL_SMTP_PORT || process.env.SMTP_PORT || siteSettings.smtpPort;
  const smtpPort = normalizeSmtpPort(rawPort, smtpHost);
  const secureRaw = process.env.MAIL_SMTP_SECURE ?? process.env.SMTP_SECURE;
  const smtpSecure = resolveSmtpSecure(smtpPort, secureRaw, siteSettings.smtpSecure);
  const smtpFamily = resolveSmtpFamily(process.env.MAIL_SMTP_FAMILY || process.env.SMTP_FAMILY, smtpHost);
  const hasSmtpCredentials = Boolean(smtpHost && smtpUser && smtpPass);
  const hasCloudflare = Boolean(cloudflareAccountId && cloudflareApiToken);
  const provider = hasSmtpCredentials ? 'smtp' : hasCloudflare ? 'cloudflare' : brevoApiKey ? 'brevo' : 'smtp';
  const source = hasSmtpCredentials
    ? smtpHost.includes('brevo') ? 'brevo-smtp-env' : envHost && envUser && envPass ? 'env' : allowSettingsFallback ? 'settings-fallback' : 'missing'
    : hasCloudflare ? 'cloudflare-env'
      : brevoApiKey ? 'brevo-api-env'
        : 'missing';
  return {
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpFamily,
    smtpUser,
    smtpPass,
    smtpSender: process.env.MAIL_FROM || process.env.SMTP_FROM || siteSettings.smtpSender || mailDefaults.from,
    smtpReplyTo: process.env.MAIL_REPLY_TO || process.env.SMTP_REPLY_TO || siteSettings.supportEmail || mailDefaults.replyTo,
    cloudflareAccountId,
    cloudflareApiToken,
    brevoApiKey,
    provider,
    source,
  };
}

function normalizeSmtpPort(value, host = '') {
  const port = Number(value);
  if (Number.isFinite(port) && port > 0) {
    return port;
  }
  return String(host || '').toLowerCase().includes('brevo') ? 587 : 465;
}

function normalizeBooleanEnv(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function resolveSmtpSecure(port, envValue, settingValue) {
  const envSecure = normalizeBooleanEnv(envValue);
  if (typeof envSecure === 'boolean') return envSecure;
  if (typeof settingValue === 'boolean') return settingValue;
  return Number(port) === 465;
}

function resolveSmtpFamily(envValue, host = '') {
  const family = Number(envValue);
  if (family === 4 || family === 6) {
    return family;
  }
  return String(host || '').toLowerCase().includes('brevo') ? 4 : undefined;
}

function isMailConfigured(settings = {}) {
  return Boolean(
    (settings.provider === 'brevo' && settings.brevoApiKey && settings.smtpSender) ||
    (settings.provider === 'cloudflare' && settings.cloudflareAccountId && settings.cloudflareApiToken && settings.smtpSender) ||
    (settings.smtpHost && settings.smtpUser && settings.smtpPass),
  );
}

function extractEmailDomain(value = '') {
  const email = String(value || '').match(/[^\s<>]+@[^\s<>]+/)?.[0] || '';
  return email.split('@').pop()?.toLowerCase().replace(/[>)]/g, '') || '';
}

function getMailIdentityDomain(siteSettings = {}) {
  return String(process.env.MAIL_ALLOWED_DOMAIN || siteSettings.primaryDomain || 'onlinesmmm.com')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .trim();
}

function validateMailIdentity(settings = {}, siteSettings = {}) {
  const allowedDomain = getMailIdentityDomain(siteSettings);
  const fromDomain = extractEmailDomain(settings.smtpSender);
  const replyToDomain = extractEmailDomain(settings.smtpReplyTo);
  const errors = [];
  if (!fromDomain || fromDomain !== allowedDomain) {
    errors.push(`from_domain_mismatch:${fromDomain || 'empty'}!=${allowedDomain}`);
  }
  if (!replyToDomain || replyToDomain !== allowedDomain) {
    errors.push(`reply_to_domain_mismatch:${replyToDomain || 'empty'}!=${allowedDomain}`);
  }
  return {
    ok: errors.length === 0,
    allowedDomain,
    fromDomain,
    replyToDomain,
    errors,
  };
}

async function resolveTxtRecords(name) {
  try {
    return (await dns.resolveTxt(name)).map((record) => record.join(''));
  } catch {
    return [];
  }
}

async function checkMailDnsHealth(siteSettings = {}) {
  const domain = getMailIdentityDomain(siteSettings);
  const dkimSelector = process.env.MAIL_DKIM_SELECTOR || process.env.DKIM_SELECTOR || '';
  const [rootTxt, dmarcTxt, dkimTxt] = await Promise.all([
    resolveTxtRecords(domain),
    resolveTxtRecords(`_dmarc.${domain}`),
    dkimSelector ? resolveTxtRecords(`${dkimSelector}._domainkey.${domain}`) : Promise.resolve([]),
  ]);
  const spfRecord = rootTxt.find((record) => /^v=spf1\b/i.test(record)) || '';
  const dmarcRecord = dmarcTxt.find((record) => /^v=DMARC1\b/i.test(record)) || '';
  const dkimRecord = dkimTxt.find((record) => /^v=DKIM1\b/i.test(record)) || '';
  const warnings = [];
  if (!spfRecord) warnings.push('SPF kaydı bulunamadı.');
  if (!dmarcRecord) warnings.push('DMARC kaydı bulunamadı.');
  if (dmarcRecord && !/\bp=(quarantine|reject)\b/i.test(dmarcRecord)) warnings.push('DMARC politikası quarantine/reject değil.');
  if (!dkimSelector) warnings.push('MAIL_DKIM_SELECTOR tanımlanmadığı için DKIM otomatik doğrulanamadı.');
  if (dkimSelector && !dkimRecord) warnings.push(`DKIM kaydı bulunamadı: ${dkimSelector}._domainkey.${domain}`);
  return {
    domain,
    spf: { ok: Boolean(spfRecord), record: spfRecord },
    dmarc: { ok: Boolean(dmarcRecord), record: dmarcRecord },
    dkim: { ok: !dkimSelector || Boolean(dkimRecord), selector: dkimSelector, record: dkimRecord },
    ok: Boolean(spfRecord && dmarcRecord && (!dkimSelector || dkimRecord) && (!dmarcRecord || /\bp=(quarantine|reject)\b/i.test(dmarcRecord))),
    warnings,
  };
}

function getSmtpTransporter(settings = {}) {
  const smtpPort = Number(settings.smtpPort || 465);
  const smtpSecure = resolveSmtpSecure(smtpPort, settings.smtpSecure, undefined);
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    requireTLS: !smtpSecure,
    ...(settings.smtpFamily ? { family: settings.smtpFamily } : {}),
    connectionTimeout: operationTimeouts.mailMs,
    greetingTimeout: operationTimeouts.mailMs,
    socketTimeout: operationTimeouts.mailMs + 5_000,
    tls: {
      servername: settings.smtpHost,
      minVersion: 'TLSv1.2',
    },
    auth: {
      user: settings.smtpUser,
      pass: settings.smtpPass,
    },
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label = 'operation_timeout') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(label);
      error.code = label;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function normalizeEmailList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return [...new Set(list.map((item) => String(item || '').trim()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

function getOperationalNotificationRecipients() {
  return normalizeEmailList(process.env.OPERATIONAL_NOTIFICATION_EMAILS || 'wos.gamer.2025@gmail.com,bayraktarselami855@icloud.com');
}

async function sendViaCloudflareEmail(settings, mailOptions) {
  const to = normalizeEmailList(mailOptions.to);
  const cc = normalizeEmailList(mailOptions.cc);
  const bcc = normalizeEmailList(mailOptions.bcc);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), operationTimeouts.mailMs);
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${settings.cloudflareAccountId}/email/sending/send`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${settings.cloudflareApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: to.length === 1 ? to[0] : to,
      ...(cc.length ? { cc } : {}),
      ...(bcc.length ? { bcc } : {}),
      from: { address: mailOptions.from || settings.smtpSender, name: 'OnlineSMMM' },
      reply_to: mailOptions.replyTo || settings.smtpReplyTo,
      subject: String(mailOptions.subject || ''),
      ...(mailOptions.html ? { html: String(mailOptions.html) } : {}),
      ...(mailOptions.text ? { text: String(mailOptions.text) } : {}),
    }),
  }).finally(() => clearTimeout(timeoutId));
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const message = data.errors?.[0]?.message || response.statusText || 'Cloudflare Email gönderimi başarısız.';
    const error = new Error(message);
    error.code = data.errors?.[0]?.code || `cloudflare_${response.status}`;
    throw error;
  }
  const result = data.result || {};
  return {
    messageId: `cf-${Date.now()}`,
    accepted: result.delivered || [],
    rejected: result.permanent_bounces || [],
    queued: result.queued || [],
    providerResult: result,
  };
}

async function sendViaBrevoEmail(settings, mailOptions) {
  const to = normalizeEmailList(mailOptions.to);
  const cc = normalizeEmailList(mailOptions.cc);
  const bcc = normalizeEmailList(mailOptions.bcc);
  if (!to.length && !bcc.length) {
    throw new Error('Brevo alıcı listesi boş.');
  }

  const fromAddress = mailOptions.from || settings.smtpSender;
  const replyToAddress = mailOptions.replyTo || settings.smtpReplyTo;
  const fromDomain = extractEmailDomain(fromAddress);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), operationTimeouts.mailMs);
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      accept: 'application/json',
      'api-key': settings.brevoApiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: fromAddress, name: fromDomain === 'onlinesmmm.com' ? 'OnlineSMMM' : 'OnlineSMMM' },
      to: to.map((email) => ({ email })),
      ...(cc.length ? { cc: cc.map((email) => ({ email })) } : {}),
      ...(bcc.length ? { bcc: bcc.map((email) => ({ email })) } : {}),
      ...(replyToAddress ? { replyTo: { email: replyToAddress } } : {}),
      subject: String(mailOptions.subject || ''),
      ...(mailOptions.html ? { htmlContent: String(mailOptions.html) } : {}),
      ...(mailOptions.text ? { textContent: String(mailOptions.text) } : {}),
    }),
  }).finally(() => clearTimeout(timeoutId));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || response.statusText || 'Brevo API gönderimi başarısız.';
    const error = new Error(message);
    error.code = data.code || `brevo_${response.status}`;
    throw error;
  }
  return {
    messageId: data.messageId || `brevo-${Date.now()}`,
    accepted: to.length ? to : bcc,
    rejected: [],
    providerResult: data,
  };
}

function upsertMailDelivery(store, delivery) {
  store.mailDeliveries = Array.isArray(store.mailDeliveries) ? store.mailDeliveries : [];
  const existing = store.mailDeliveries.find((entry) => entry.id === delivery.id);
  if (existing) {
    Object.assign(existing, delivery, { updatedAt: now() });
    return existing;
  }
  const nextDelivery = {
    id: delivery.id || uuidv4(),
    status: 'queued',
    attempts: 0,
    createdAt: now(),
    updatedAt: now(),
    ...delivery,
  };
  store.mailDeliveries.unshift(nextDelivery);
  store.mailDeliveries = store.mailDeliveries.slice(0, 500);
  return nextDelivery;
}

async function sendMailWithRetry(store, mailOptions, context = {}, options = {}) {
  const settings = getServerMailSettings(store.siteSettings || {});
  const deliveryId = context.deliveryId || uuidv4();
  const identity = validateMailIdentity(settings, store.siteSettings || {});
  const timeoutMs = Number(options.timeoutMs || operationTimeouts.mailMs);
  const safeMailOptions = {
    ...mailOptions,
    html: mailOptions.html ? sanitizeEmailHtml(mailOptions.html) : '',
  };
  safeMailOptions.text = String(mailOptions.text || htmlToPlainText(safeMailOptions.html) || '').trim();
  if (!isMailConfigured(settings)) {
    upsertMailDelivery(store, {
      id: deliveryId,
      status: 'failed',
      subject: String(mailOptions.subject || '').slice(0, 180),
      to: normalizeEmailList(mailOptions.to || mailOptions.bcc).join(', '),
      errorCode: 'smtp_not_configured',
      errorMessage: 'Sunucu mail env ayarları eksik.',
      attempts: 0,
      source: settings.source,
    });
    emitStructuredLog('mail_delivery', {
      ...context,
      delivery: 'failed',
      errorCode: 'smtp_not_configured',
      source: settings.source,
    }, 'error');
    return { ok: false, deliveryId, errorCode: 'smtp_not_configured', errorMessage: 'Sunucu mail env ayarları eksik.' };
  }
  if (!identity.ok) {
    upsertMailDelivery(store, {
      id: deliveryId,
      status: 'failed',
      subject: String(safeMailOptions.subject || '').slice(0, 180),
      to: normalizeEmailList(safeMailOptions.to || safeMailOptions.bcc).join(', '),
      errorCode: 'mail_identity_misaligned',
      errorMessage: identity.errors.join('; '),
      attempts: 0,
      source: settings.source,
    });
    await addAudit(store, 'system', 'Kritik e-posta kimlik hizalama hatası', {
      deliveryId,
      severity: 'critical',
      allowedDomain: identity.allowedDomain,
      fromDomain: identity.fromDomain,
      replyToDomain: identity.replyToDomain,
      errors: identity.errors,
    });
    emitStructuredLog('mail_delivery', {
      ...context,
      delivery: 'failed',
      deliveryId,
      errorCode: 'mail_identity_misaligned',
      errors: identity.errors,
    }, 'error');
    return { ok: false, deliveryId, errorCode: 'mail_identity_misaligned', errorMessage: identity.errors.join('; ') };
  }

  const maxAttempts = Number(options.maxAttempts || 3);
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = performance.now();
    try {
      upsertMailDelivery(store, {
        id: deliveryId,
        status: attempt === 1 ? 'sending' : 'retrying',
        attempts: attempt,
        subject: String(safeMailOptions.subject || '').slice(0, 180),
        to: normalizeEmailList(safeMailOptions.to || safeMailOptions.bcc).join(', '),
        source: settings.source,
      });
      let info;
      if (settings.provider === 'brevo') {
        info = await sendViaBrevoEmail(settings, safeMailOptions);
      } else if (settings.provider === 'cloudflare') {
        info = await sendViaCloudflareEmail(settings, safeMailOptions);
      } else {
        const transporter = getSmtpTransporter(settings);
        try {
          info = await withTimeout(transporter.sendMail({
            ...safeMailOptions,
            from: safeMailOptions.from || settings.smtpSender,
            replyTo: safeMailOptions.replyTo || settings.smtpReplyTo,
          }), timeoutMs, 'mail_send_timeout');
        } finally {
          transporter.close?.();
        }
      }
      const durationMs = observeDuration(startedAt);
      upsertMailDelivery(store, {
        id: deliveryId,
        status: 'sent',
        attempts: attempt,
        messageId: info.messageId || '',
        accepted: Array.isArray(info.accepted) ? info.accepted.length : 0,
        rejected: Array.isArray(info.rejected) ? info.rejected.length : 0,
        durationMs,
        sentAt: now(),
        errorCode: '',
        errorMessage: '',
      });
      emitStructuredLog('mail_delivery', {
        ...context,
        delivery: 'sent',
        deliveryId,
        messageId: info.messageId || '',
        attempts: attempt,
        durationMs,
        provider: settings.provider,
        source: settings.source,
        smtpPort: settings.provider === 'smtp' ? settings.smtpPort : undefined,
        smtpSecure: settings.provider === 'smtp' ? settings.smtpSecure : undefined,
        smtpFamily: settings.provider === 'smtp' ? settings.smtpFamily : undefined,
      }, 'info');
      return { ok: true, info, deliveryId, attempts: attempt };
    } catch (error) {
      lastError = error;
      const durationMs = observeDuration(startedAt);
      upsertMailDelivery(store, {
        id: deliveryId,
        status: attempt >= maxAttempts ? 'failed' : 'retrying',
        attempts: attempt,
        errorCode: error.code || error.name || 'smtp_error',
        errorMessage: error.message || 'Mail gönderilemedi.',
        durationMs,
      });
      emitStructuredLog('mail_delivery', {
        ...context,
        delivery: attempt >= maxAttempts ? 'failed' : 'retrying',
        deliveryId,
        attempts: attempt,
        errorCode: error.code || error.name || 'smtp_error',
        errorMessage: error.message,
        durationMs,
        provider: settings.provider,
        source: settings.source,
        smtpPort: settings.provider === 'smtp' ? settings.smtpPort : undefined,
        smtpSecure: settings.provider === 'smtp' ? settings.smtpSecure : undefined,
        smtpFamily: settings.provider === 'smtp' ? settings.smtpFamily : undefined,
      }, attempt >= maxAttempts ? 'error' : 'warn');
      if (attempt < maxAttempts) {
        await wait(Math.min(20_000, 750 * 2 ** (attempt - 1)));
      } else {
        await addAudit(store, 'system', 'Kritik e-posta teslim hatası', {
          ...context,
          deliveryId,
          severity: 'critical',
          errorCode: error.code || error.name || 'smtp_error',
          errorMessage: error.message,
          attempts: attempt,
        });
      }
    }
  }
  return {
    ok: false,
    deliveryId,
    errorCode: lastError?.code || lastError?.name || 'smtp_error',
    errorMessage: lastError?.message || 'Mail gönderilemedi.',
  };
}

function enqueueMail(store, mailOptions, context = {}) {
  const deliveryId = context.deliveryId || uuidv4();
  upsertMailDelivery(store, {
    id: deliveryId,
    status: 'queued',
    attempts: 0,
    subject: String(mailOptions.subject || '').slice(0, 180),
    to: normalizeEmailList(mailOptions.to || mailOptions.bcc).join(', '),
    queuedAt: now(),
  });
  mailQueue.push({ deliveryId, mailOptions, context: { ...context, deliveryId } });
  processMailQueue();
  return { ok: true, queued: true, deliveryId };
}

async function processMailQueue() {
  if (mailQueueProcessing) return;
  mailQueueProcessing = true;
  try {
    while (mailQueue.length) {
      const item = mailQueue.shift();
      const store = await db();
      await sendMailWithRetry(store, item.mailOptions, item.context, { maxAttempts: 3 });
      await persist(store);
    }
  } finally {
    mailQueueProcessing = false;
  }
}

function getInboundMailSecret(req) {
  return String(
    req.headers['x-mail-secret'] ||
    req.headers['x-inbound-secret'] ||
    req.query?.secret ||
    req.body?.secret ||
    '',
  );
}

function requireInboundMailSecret(req, res) {
  if (!mailDefaults.inboundSecret) {
    res.status(503).json({ message: 'Inbound mail secret tanımlı değil.' });
    return false;
  }
  const provided = getInboundMailSecret(req);
  const expected = mailDefaults.inboundSecret;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    res.status(401).json({ message: 'Inbound mail doğrulaması başarısız.' });
    return false;
  }
  return true;
}

function normalizeInboundMailPayload(payload = {}) {
  const headers = payload.headers || {};
  const from = String(payload.from || payload.sender || payload.envelope?.from || headers.from || '').trim();
  const to = normalizeEmailList(payload.to || payload.recipient || payload.envelope?.to || headers.to);
  const subject = String(payload.subject || headers.subject || '(Konu yok)').trim().slice(0, 180);
  const messageId = String(payload.messageId || payload['message-id'] || headers['message-id'] || payload.id || '').trim();
  const text = String(payload.text || payload.textBody || payload.plain || '').trim();
  const html = sanitizeEmailHtml(payload.html || payload.htmlBody || '');
  const body = text || htmlToPlainText(html) || String(payload.body || '').trim();
  return {
    from,
    to,
    subject,
    messageId,
    text,
    html,
    body: body.slice(0, 20_000),
    rawProvider: String(payload.provider || payload.source || 'mail_webhook').slice(0, 80),
    receivedAt: String(payload.date || payload.receivedAt || now()),
  };
}

function storeInboundEmail(store, inbound, req) {
  store.messages = Array.isArray(store.messages) ? store.messages : [];
  const duplicate = inbound.messageId
    ? store.messages.find((message) => message.channel === 'email' && message.providerMessageId === inbound.messageId)
    : null;
  if (duplicate) {
    return { message: duplicate, duplicate: true };
  }
  const message = {
    id: uuidv4(),
    channel: 'email',
    direction: 'inbound',
    source: inbound.rawProvider,
    providerMessageId: inbound.messageId,
    actor: inbound.from || 'email',
    name: inbound.from,
    email: inbound.from.match(/[^\s<>]+@[^\s<>]+/)?.[0] || inbound.from,
    subject: inbound.subject,
    body: inbound.body || '(Boş e-posta)',
    html: inbound.html,
    recipients: inbound.to,
    archivedAt: '',
    createdAt: now(),
    receivedAt: inbound.receivedAt,
    ip: getClientIp(req),
  };
  store.messages.unshift(message);
  return { message, duplicate: false };
}

function htmlToPlainText(htmlContent = '') {
  return String(htmlContent)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function sanitizeEmailHtml(htmlContent = '') {
  const allowedTags = new Set([
    'a', 'b', 'br', 'blockquote', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'hr',
    'i', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td',
    'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
  ]);
  const allowedAttributes = new Set(['href', 'title', 'target', 'rel', 'style', 'colspan', 'rowspan']);
  return String(htmlContent || '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|meta|link)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|meta|link)[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(src|srcset|background)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+href\s*=\s*(['"]?)\s*(javascript:|data:|vbscript:)[^'"\s>]*\1/gi, '')
    .replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (match, rawTag, rawAttrs = '') => {
      const tag = String(rawTag || '').toLowerCase();
      const isClosing = /^<\s*\//.test(match);
      if (!allowedTags.has(tag)) {
        return '';
      }
      if (isClosing) {
        return `</${tag}>`;
      }
      const attrs = [];
      String(rawAttrs || '').replace(/([a-z0-9-:]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (_attrMatch, rawName, rawValue) => {
        const name = String(rawName || '').toLowerCase();
        if (!allowedAttributes.has(name) || name.startsWith('on')) return '';
        let value = String(rawValue || '').trim();
        const unquoted = value.replace(/^['"]|['"]$/g, '').trim();
        if (name === 'href' && !/^(https?:|mailto:|tel:|#|\/)/i.test(unquoted)) return '';
        if (name === 'target' && unquoted !== '_blank') return '';
        if (name === 'style' && /url\s*\(|expression\s*\(|javascript:/i.test(unquoted)) return '';
        value = `"${escapeHtml(unquoted)}"`;
        attrs.push(`${name}=${value}`);
        return '';
      });
      if (tag === 'a' && !attrs.some((attr) => attr.startsWith('rel='))) {
        attrs.push('rel="noopener noreferrer"');
      }
      return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
    });
}

function resolvePaymentCallbackUrl(settings = {}, req) {
  const configured = isProduction ? process.env.IYZICO_CALLBACK_URL : (process.env.IYZICO_CALLBACK_URL || settings.paymentCallbackUrl);
  if (configured && /^https:\/\//i.test(configured)) {
    return configured;
  }
  if (!isProduction && req) {
    return `${req.protocol}://${req.get('host')}/odeme/callback`;
  }
  return '';
}

function resolvePaymentResultUrl(settings = {}, req, locale = 'tr') {
  const configured = process.env.PAYMENT_RESULT_URL || settings.paymentResultUrl || settings.websiteUrl;
  const normalized = String(configured || '').replace(/\/+$/, '');
  if (normalized && /^https:\/\//i.test(normalized)) {
    const localePrefix = locale && locale !== 'tr' ? `/${locale}` : '';
    return `${normalized}${localePrefix}/odeme/sonuc`;
  }
  if (!isProduction && req) {
    const localePrefix = locale && locale !== 'tr' ? `/${locale}` : '';
    return `${req.protocol}://${req.get('host')}${localePrefix}/odeme/sonuc`;
  }
  return '';
}

async function validateUploadedFileSafety(file) {
  if (!file?.path) {
    return { ok: false, reason: 'missing_file' };
  }

  const buffer = await readFile(file.path);
  const ext = path.extname(file.originalname || '').toLowerCase();
  const header = buffer.subarray(0, 12);
  const isPdf = ext === '.pdf' && header.subarray(0, 4).toString('utf8') === '%PDF';
  const isJpeg = ['.jpg', '.jpeg'].includes(ext) && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng =
    ext === '.png' &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a;

  if (!isPdf && !isJpeg && !isPng) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  if (isPdf) {
    const pdfText = buffer.toString('latin1');
    if (/\/(JavaScript|JS|OpenAction|AA)\b/i.test(pdfText) || /<script\b/i.test(pdfText)) {
      return { ok: false, reason: 'active_pdf_content' };
    }
  }

  return { ok: true, type: isPdf ? 'pdf' : isPng ? 'png' : 'jpeg' };
}

async function rejectUnsafeUpload(file) {
  try {
    await unlink(file.path);
  } catch {
    // File may already be gone.
  }
}

async function cleanupUploadedFiles(files = []) {
  await Promise.all((files || []).filter(Boolean).map((file) => rejectUnsafeUpload(file)));
}

const maxUploadBatchBytes = 35 * 1024 * 1024;

function sanitizeDocumentName(name = '') {
  const ext = path.extname(name || '').toLowerCase().replace(/[^.\w]/g, '');
  const base = path.basename(name || 'belge', path.extname(name || ''))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'belge';
  return `${base}${ext || ''}`;
}

function buildDocumentAttachments(documents = []) {
  return (documents || [])
    .map((document) => {
      const uploadName = path.basename(String(document?.path || ''));
      if (!uploadName) return null;
      const filePath = path.join(getUploadsDir(), uploadName);
      if (!existsSync(filePath)) return null;
      const filename = sanitizeDocumentName(document?.name || uploadName);
      return {
        filename,
        name: filename,
        path: filePath,
        filePath,
        contentType: document?.mimeType || undefined,
        caption: `${filename} - Başvuru No: ${document?.applicationId || '-'}`,
      };
    })
    .filter(Boolean);
}

async function validateUploadedFilesOrReject(files = []) {
  const totalSize = (files || []).reduce((sum, file) => sum + Number(file?.size || 0), 0);
  if (totalSize > maxUploadBatchBytes) {
    await cleanupUploadedFiles(files);
    return { ok: false, file: null, reason: 'total_size_exceeded' };
  }

  const seen = new Set();
  for (const file of files || []) {
    const duplicateKey = `${sanitizeDocumentName(file.originalname || '').toLowerCase()}:${file.size}`;
    if (seen.has(duplicateKey)) {
      await cleanupUploadedFiles(files);
      return { ok: false, file, reason: 'duplicate_file' };
    }
    seen.add(duplicateKey);
    const result = await validateUploadedFileSafety(file);
    if (!result.ok) {
      await cleanupUploadedFiles(files);
      return { ok: false, file, reason: result.reason };
    }
  }
  return { ok: true };
}

const upload = multer({
  dest: getUploadsDir(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = /pdf|jpg|jpeg|png/i;
    const allowedMimeTypes = /application\/pdf|image\/jpeg|image\/png/i;

    const ext = path.extname(file.originalname || '').toLowerCase();
    const isExtAllowed = allowedExtensions.test(ext);
    const isMimeAllowed = allowedMimeTypes.test(file.mimetype || '');

    if (isExtAllowed && isMimeAllowed) {
      return cb(null, true);
    }
    return cb(new Error('Güvenlik ihlali: Yalnızca güvenli doküman formatlarına (PDF, JPG, JPEG, PNG) izin verilir!'));
  }
});

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4010',
    'http://127.0.0.1:4010',
    'https://www.onlinesmmm.com',
    'https://onlinesmmm.com',
    'https://onlinesmmm.com.tr',
    'https://gursoft.com.tr',
  ].join(','))
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = origin.replace(/\/+$/, '');
  if (allowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  try {
    const originUrl = new URL(normalizedOrigin);
    if (
      originUrl.hostname === 'localhost' ||
      originUrl.hostname === '127.0.0.1' ||
      originUrl.hostname === '::1'
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function getRequestHostname(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || String(req.headers.host || '').trim();
  return host.replace(/:\d+$/, '').toLowerCase();
}

function isLocalHost(hostname) {
  if (!hostname) {
    return true;
  }

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost')
  ) {
    return true;
  }

  return false;
}

function isLegacyCanonicalHost(hostname) {
  return hostname === 'onlinesmmm.com' || hostname === 'onlinesmmm.com.tr' || hostname === 'www.onlinesmmm.com.tr';
}

app.use((req, res, next) => {
  const hostname = getRequestHostname(req);
  if (isLocalHost(hostname) || hostname === 'www.onlinesmmm.com') {
    return next();
  }

  if (isLegacyCanonicalHost(hostname)) {
    return res.redirect(301, `https://www.onlinesmmm.com${req.originalUrl}`);
  }

  return next();
});

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'", 'https://dash.cloudflare.com', 'https://github.com'],
      "frame-ancestors": ["'none'"],
      "frame-src": ["'self'", 'https://challenges.cloudflare.com'],
      "img-src": ["'self'", 'data:', 'https:'],
      "font-src": ["'self'", 'data:', 'https://fonts.gstatic.com'],
      "style-src": ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      "script-src": ["'self'", 'https://challenges.cloudflare.com', 'https://static.cloudflareinsights.com'],
      "connect-src": ["'self'", 'https://challenges.cloudflare.com', 'https:', 'http:'],
      "media-src": ["'self'", 'https:'],
      "object-src": ["'none'"],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xFrameOptions: { action: 'deny' },
  xContentTypeOptions: true,
  permissionsPolicy: {
    features: {
      camera: [],
      microphone: [],
      geolocation: [],
    },
  },
}));

app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

if (existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
}

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin is not allowed.'));
  },
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  req.requestId = String(req.headers['x-request-id'] || createRequestId());
  res.setHeader('X-Request-Id', req.requestId);

  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const startedAt = performance.now();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    emitStructuredLog('api_request', {
      ...getRequestObservability(req),
      statusCode: res.statusCode,
      durationMs: observeDuration(startedAt),
    }, level);
  });

  return next();
});
app.use('/api/public/leads', createRateLimiter('lead'));
app.use('/api/public/visit-events', createRateLimiter('public', { max: 180 }));
app.use('/api/public/consent-events', createRateLimiter('public', { max: 60 }));
app.use('/api/auth/login', createRateLimiter('auth'));
app.use('/api/auth/login/start', createRateLimiter('auth'));
app.use('/api/auth/login/verify', createRateLimiter('auth'));

function now() {
  return new Date().toISOString();
}

async function db() {
  const store = await loadStore();
  return store;
}

async function persist(store) {
  await saveStore(store);
}

function isBootstrapSuperAdminEmail(email) {
  return String(email || '').trim().toLowerCase() === superAdminEmail;
}

async function ensureBootstrapSuperAdmin(store, requestedEmail) {
  if (!isBootstrapSuperAdminEmail(requestedEmail) || !superAdminPassword) {
    return null;
  }

  const nowIso = now();
  let changed = false;
  let user = (store.users || []).find((entry) => String(entry.email || '').toLowerCase() === superAdminEmail);

  if (!user) {
    user = {
      id: uuidv4(),
      role: 'superadmin',
      email: superAdminEmail,
      name: 'Super Admin',
      passwordHash: await bcrypt.hash(superAdminPassword, 10),
      permissions: ['*'],
      isActive: true,
      twoFactorEnabled: false,
      twoFactorSecret: '',
      phone: '',
      whatsappConnectionId: '',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    store.users = Array.isArray(store.users) ? store.users : [];
    store.users.push(user);
    changed = true;
  }

  if (user.role !== 'superadmin') {
    user.role = 'superadmin';
    changed = true;
  }
  if (user.isActive !== true) {
    user.isActive = true;
    changed = true;
  }
  if (!Array.isArray(user.permissions) || !user.permissions.includes('*')) {
    user.permissions = ['*'];
    changed = true;
  }
  if (!user.name) {
    user.name = 'Super Admin';
    changed = true;
  }
  if (!user.passwordHash) {
    user.passwordHash = await bcrypt.hash(superAdminPassword, 10);
    changed = true;
  }
  if (changed) {
    user.updatedAt = nowIso;
    store.auditLogs = Array.isArray(store.auditLogs) ? store.auditLogs : [];
    store.auditLogs.unshift({
      id: uuidv4(),
      actor: 'system',
      action: 'Superadmin hesabi otomatik onarildi',
      details: {
        email: superAdminEmail,
      },
      createdAt: nowIso,
    });
    await persist(store);
  }

  return user;
}

function getNormalizedLocationCatalog(store) {
  return normalizeLocationCatalog(store?.locationCatalog || defaultLocationCatalog);
}

function getLocationCatalogMeta(store) {
  const catalog = getNormalizedLocationCatalog(store);
  return {
    ...catalog.source,
    provinceCount: catalog.provinces.length,
    districtCount: catalog.provinces.reduce((count, province) => count + province.districts.length, 0),
    neighborhoodCount: catalog.provinces.reduce(
      (count, province) => count + province.districts.reduce((districtCount, district) => districtCount + district.neighborhoods.length, 0),
      0,
    ),
  };
}

function shouldAutoSyncLocationCatalog(store) {
  const settings = store?.siteSettings || {};
  if (!settings.locationAutoSyncEnabled) {
    return false;
  }
  if (!settings.locationSourceUrl) {
    return false;
  }
  const lastSyncAt = Date.parse(settings.locationLastSyncAt || '');
  if (!Number.isFinite(lastSyncAt)) {
    return true;
  }
  return Date.now() - lastSyncAt > 24 * 60 * 60 * 1000;
}

async function syncLocationCatalog(store, sourceUrl) {
  const { catalog, format } = await syncLocationCatalogFromUrl(sourceUrl);
  const syncedAt = now();
  store.locationCatalog = catalog;
  store.siteSettings = {
    ...store.siteSettings,
    locationSourceUrl: sourceUrl,
    locationSourceFormat: format,
    locationLastSyncAt: syncedAt,
    locationLastSyncStatus: 'success',
    locationLastSyncError: '',
  };
  return {
    catalog,
    meta: {
      ...catalog.source,
      format,
      syncedAt,
      status: 'success',
    },
  };
}

function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { name: 'Ad', surname: 'Soyad' };
  }
  if (parts.length === 1) {
    return { name: parts[0], surname: parts[0] };
  }
  return {
    name: parts.slice(0, -1).join(' '),
    surname: parts.at(-1),
  };
}

function validateTCKN(tckn) {
  const val = String(tckn || '').trim();
  if (val.length !== 11) return false;
  if (!/^\d{11}$/.test(val)) return false;
  if (val[0] === '0') return false;

  const digits = val.split('').map(Number);
  
  const sumOdd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const sumEven = digits[1] + digits[3] + digits[5] + digits[7];

  const d10 = (sumOdd * 7 - sumEven) % 10;
  if (d10 !== digits[9]) return false;

  const sumAll = digits.slice(0, 10).reduce((acc, curr) => acc + curr, 0);
  const d11 = sumAll % 10;
  if (d11 !== digits[10]) return false;

  return true;
}

async function sendNotificationEmail(store, subject, htmlContent, context = {}) {
  const settings = getServerMailSettings(store.siteSettings || {});
  if (!isMailConfigured(settings)) {
    const payload = {
      ...context,
      delivery: 'skipped',
      reason: 'smtp_not_configured',
      subject: String(subject || '').slice(0, 120),
    };
    emitStructuredLog('mail_delivery', payload, 'warn');
    await addAudit(store, context.actor || 'system', 'E-posta gönderimi atlandı', {
      ...context,
      subject: String(subject || '').slice(0, 120),
      delivery: 'skipped',
      reason: 'smtp_not_configured',
    });
    return { ok: false, skipped: true, reason: 'smtp_not_configured' };
  }

  // Get active users/staff
  const recipients = (store.users || [])
    .filter((u) => u.isActive !== false && u.email)
    .map((u) => u.email);

  if (recipients.length === 0) {
    const payload = {
      ...context,
      delivery: 'skipped',
      reason: 'no_recipients',
      subject: String(subject || '').slice(0, 120),
    };
    emitStructuredLog('mail_delivery', payload, 'warn');
    await addAudit(store, context.actor || 'system', 'E-posta gönderimi atlandı', {
      ...context,
      subject: String(subject || '').slice(0, 120),
      delivery: 'skipped',
      reason: 'no_recipients',
    });
    return { ok: false, skipped: true, reason: 'no_recipients' };
  }

  const startedAt = performance.now();

  try {
    const queued = enqueueMail(store, {
      to: settings.smtpSender || settings.smtpUser,
      bcc: recipients,
      subject: String(subject || ''),
      html: htmlContent,
      text: htmlToPlainText(htmlContent),
    }, {
      ...context,
      subject: String(subject || '').slice(0, 120),
      recipients: recipients.length,
    });
    const payload = {
      ...context,
      delivery: 'queued',
      recipients: recipients.length,
      deliveryId: queued.deliveryId,
      durationMs: observeDuration(startedAt),
      subject: String(subject || '').slice(0, 120),
    };
    emitStructuredLog('mail_delivery', payload, 'info');
    await addAudit(store, context.actor || 'system', 'E-posta kuyruğa alındı', {
      ...context,
      subject: String(subject || '').slice(0, 120),
      delivery: 'queued',
      deliveryId: queued.deliveryId,
      recipients: recipients.length,
      durationMs: payload.durationMs,
    });
    return { ok: true, queued: true, deliveryId: queued.deliveryId, recipients };
  } catch (err) {
    const payload = {
      ...context,
      delivery: 'failed',
      errorCode: err.code || err.name || 'smtp_error',
      errorMessage: err.message,
      durationMs: observeDuration(startedAt),
      subject: String(subject || '').slice(0, 120),
    };
    emitStructuredLog('mail_delivery', payload, 'error');
    await addAudit(store, context.actor || 'system', 'E-posta gönderimi başarısız', {
      ...context,
      subject: String(subject || '').slice(0, 120),
      delivery: 'failed',
      errorCode: payload.errorCode,
      errorMessage: err.message,
      durationMs: payload.durationMs,
      severity: 'critical',
    });
    return { ok: false, errorCode: payload.errorCode, errorMessage: err.message };
  }
}

function sendCustomerWelcomeEmail(store, customer, context = {}) {
  const settings = getServerMailSettings(store.siteSettings || {});
  if (!isMailConfigured(settings)) {
    emitStructuredLog('mail_delivery', {
      ...context,
      delivery: 'skipped',
      reason: 'smtp_not_configured',
      template: 'customer_welcome',
      customerId: customer?.id || '',
    }, 'warn');
    return { ok: false, skipped: true, reason: 'smtp_not_configured' };
  }

  const startedAt = performance.now();
  const companyTypeMap = {
    sole: 'Şahıs Şirketi',
    limited: 'Limited Şirket (Ltd. Şti.)',
    anon: 'Anonim Şirket (A.Ş.)',
  };
  const typeLabel = companyTypeMap[customer.companyType] || customer.companyType || 'Şirket';
  const escapedCustomerName = escapeHtml(customer.name || '');
  const escapedTypeLabel = escapeHtml(typeLabel);
  const escapedTckn = escapeHtml(customer.tckn || '-');
  const escapedPhone = escapeHtml(customer.phone || '-');
  const escapedEmail = escapeHtml(customer.email || '-');
  const escapedAddress = escapeHtml(customer.address || '-');
  const escapedCustomerCompanyName = escapeHtml(customer.companyName || '-');
  const escapedCustomerSource = escapeHtml(customer.source || '-');
  const escapedCustomerActivityMain = escapeHtml(customer.activity?.mainActivity || '-');
  const escapedCustomerActivitySub = escapeHtml(customer.activity?.subActivity || '-');
  const escapedCustomerRevenueMethod = escapeHtml(customer.activity?.revenueMethod || '-');
  const escapedCustomerSalesChannel = escapeHtml(customer.activity?.salesChannel || '-');

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tescil İşlemleriniz Başlatıldı</title>
</head>
<body>
  <h1>onlinesmmm</h1>
  <p>Sayın <strong>${escapedCustomerName}</strong>, başvurunuz tescil sürecine alındı.</p>
  <ul>
    <li>Şirket Adı: ${escapedCustomerCompanyName}</li>
    <li>Şirket Türü: ${escapedTypeLabel}</li>
    <li>T.C. Kimlik No: ${escapedTckn}</li>
    <li>Telefon: ${escapedPhone}</li>
    <li>E-Posta: ${escapedEmail}</li>
    <li>Adres: ${escapedAddress}</li>
    <li>Faaliyet: ${escapedCustomerActivityMain} / ${escapedCustomerActivitySub}</li>
    <li>Gelir Yöntemi: ${escapedCustomerRevenueMethod}</li>
    <li>Satış Kanalı: ${escapedCustomerSalesChannel}</li>
    <li>Kaynak: ${escapedCustomerSource}</li>
  </ul>
</body>
</html>`;

  const queued = enqueueMail(store, {
    to: customer.email || settings.smtpUser,
    subject: 'onlinesmmm - Şirket Tescil İşlemleriniz Başlatıldı!',
    html,
    text: htmlToPlainText(html),
    attachments: context.attachments || [],
  }, {
    ...context,
    template: 'customer_welcome',
    customerId: customer?.id || '',
    recipients: 1,
  });
  const durationMs = observeDuration(startedAt);
  emitStructuredLog('mail_delivery', {
    ...context,
    delivery: 'queued',
    template: 'customer_welcome',
    customerId: customer?.id || '',
    deliveryId: queued.deliveryId,
    durationMs,
  }, 'info');
  return addAudit(store, context.actor || 'website', 'Müşteri hoş geldin e-postası kuyruğa alındı', {
    ...context,
    template: 'customer_welcome',
    customerId: customer?.id || '',
    delivery: 'queued',
    deliveryId: queued.deliveryId,
    durationMs,
  }).then(() => ({ ok: true, queued: true, deliveryId: queued.deliveryId }));
}

function generateTurkishIdentityNumber(seed = '') {
  const digits = String(seed || '').replace(/\D/g, '');
  const source = `${digits}${Date.now()}`.slice(-9).padStart(9, '1').split('').map((digit, index) => {
    const value = Number(digit) || ((index + 1) % 9) + 1;
    return index === 0 ? Math.max(1, value % 9 || 1) : value % 10;
  });
  const oddSum = source[0] + source[2] + source[4] + source[6] + source[8];
  const evenSum = source[1] + source[3] + source[5] + source[7];
  const tenthDigit = ((oddSum * 7) - evenSum) % 10;
  const eleventhDigit = (source.reduce((sum, value) => sum + value, 0) + tenthDigit) % 10;
  return `${source.join('')}${Math.abs(tenthDigit)}${Math.abs(eleventhDigit)}`.slice(0, 11);
}

function buildIyzicoClient(store) {
  const settings = store.siteSettings || {};
  const uri = settings.iyzicoEnvironment === 'sandbox' ? 'https://sandbox-api.iyzipay.com' : 'https://api.iyzipay.com';
  return new Iyzipay({
    apiKey: settings.iyzicoApiKey || process.env.IYZIPAY_API_KEY || '',
    secretKey: settings.iyzicoSecretKey || process.env.IYZIPAY_SECRET_KEY || '',
    uri,
  });
}

function toIyzicoPrice(value) {
  const numeric = Number(value) || 0;
  return numeric.toFixed(2);
}

function renderPaymentResultPage({ success = false, title, message, redirectHref = '/basvuru' }) {
  const safeTitle = String(title || (success ? 'Ödeme Tamamlandı' : 'Ödeme İşlemi')).replace(/[<>]/g, '');
  const safeMessage = String(message || '').replace(/[<>]/g, '');
  const safeRedirect = String(redirectHref || '/basvuru');
  const safeRedirectHtml = escapeHtml(safeRedirect);
  const safeRedirectJs = JSON.stringify(safeRedirect);
  const accent = success ? '#0f766e' : '#dc2626';
  const bg = success
    ? 'radial-gradient(circle at top, rgba(16, 185, 129, 0.18), transparent 42%), linear-gradient(180deg, #effdf5 0%, #ffffff 100%)'
    : 'radial-gradient(circle at top, rgba(239, 68, 68, 0.12), transparent 42%), linear-gradient(180deg, #fff5f5 0%, #ffffff 100%)';
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="2;url=${safeRedirectHtml}" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: ${bg};
      color: #0f172a;
    }
    .card {
      width: min(92vw, 560px);
      padding: 30px;
      border-radius: 26px;
      background: rgba(255,255,255,0.9);
      border: 1px solid rgba(15, 23, 42, 0.08);
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
      text-align: center;
    }
    .mark {
      width: 76px;
      height: 76px;
      margin: 0 auto 18px;
      border-radius: 22px;
      display: grid;
      place-items: center;
      font-size: 2.4rem;
      font-weight: 900;
      color: #fff;
      background: linear-gradient(135deg, ${accent}, #2563eb);
      box-shadow: 0 18px 44px rgba(37, 99, 235, 0.24);
    }
    h1 { margin: 0 0 10px; font-size: clamp(1.5rem, 4vw, 2.2rem); line-height: 1.08; }
    p { margin: 0; color: #475569; line-height: 1.6; font-size: 1rem; }
    a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      margin-top: 22px;
      padding: 0 22px;
      border-radius: 999px;
      background: linear-gradient(135deg, #2563eb, #0f766e);
      color: #fff;
      text-decoration: none;
      font-weight: 800;
    }
  </style>
  <script>
    window.setTimeout(function () {
      window.location.replace(${safeRedirectJs});
    }, 1200);
  </script>
</head>
<body>
  <div class="card">
    <div class="mark">${success ? '✓' : '!'}</div>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    <a href="${safeRedirectHtml}">Ana sayfaya dön</a>
  </div>
  </body>
</html>`;
}

async function recordCompletedPayment(store, paymentInput) {
  const {
    customerId,
    amount,
    currency = 'TRY',
    orderId,
    paymentMethod = 'iyzico',
    description,
    paymentStatus = 'completed',
    providerToken = '',
    providerPaymentId = '',
    environment = '',
    callbackId = '',
    expectedAmount,
    expectedCurrency,
  } = paymentInput || {};
  const customer = store.customers.find((entry) => entry.id === customerId);
  if (!customer) {
    return { ok: false, message: 'Musteri bulunamadi.' };
  }
  const normalizedStatus = normalizePaymentStatus(paymentStatus);
  const normalizedAmount = normalizePaymentAmount(amount);
  const normalizedCurrency = normalizePaymentCurrency(currency) || 'TRY';
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCallbackId = String(callbackId || providerPaymentId || providerToken || '').trim();
  const existingPayment = findPaymentRecord(store, {
    customerId,
    orderId: normalizedOrderId,
    providerToken,
    providerPaymentId,
    callbackId: normalizedCallbackId,
    paymentMethod,
  });

  if (existingPayment) {
    const previousStatus = normalizePaymentStatus(existingPayment.status);
    const nextStatus = existingPayment.status === 'completed' && normalizedStatus === 'pending'
      ? 'completed'
      : normalizedStatus;
    Object.assign(existingPayment, {
      amount: normalizedAmount ?? existingPayment.amount,
      currency: normalizedCurrency || existingPayment.currency,
      status: nextStatus,
      providerToken: providerToken || existingPayment.providerToken || '',
      providerPaymentId: providerPaymentId || existingPayment.providerPaymentId || '',
      callbackId: normalizedCallbackId || existingPayment.callbackId || '',
      expectedAmount: normalizePaymentAmount(expectedAmount) ?? existingPayment.expectedAmount ?? normalizedAmount ?? 0,
      expectedCurrency: normalizePaymentCurrency(expectedCurrency) || existingPayment.expectedCurrency || normalizedCurrency,
      environment: environment || existingPayment.environment || '',
      updatedAt: now(),
      lastCallbackAt: normalizedCallbackId ? now() : existingPayment.lastCallbackAt || '',
      callbackAttempts: normalizedCallbackId ? Number(existingPayment.callbackAttempts || 0) + 1 : existingPayment.callbackAttempts || 0,
    });
    applyCustomerPaymentStatus(customer, nextStatus, existingPayment.createdAt);
    customer.updatedAt = now();
    await addAudit(store, 'website', `Odeme kaydi tekrar işlendi: ${customer.name}`, {
      customerId,
      orderId: normalizedOrderId,
      paymentStatus: nextStatus,
      callbackId: normalizedCallbackId,
      ip: paymentInput?.ip || '',
    });
    if (previousStatus !== nextStatus) {
      const operationalResult = await notifyPaymentOperational(store, customer, existingPayment, {
        callbackId: normalizedCallbackId,
        providerPaymentId: existingPayment.providerPaymentId || '',
        ip: paymentInput?.ip || '',
      });
      existingPayment.whatsappForwardedTo = operationalResult.whatsappForwardedTo || existingPayment.whatsappForwardedTo || [];
      existingPayment.emailDeliveryId = operationalResult.email?.deliveryId || existingPayment.emailDeliveryId || '';
    }
    return { ok: true, payment: existingPayment, duplicate: true };
  }

  const payment = {
    id: uuidv4(),
    customerId,
    amount: normalizedAmount ?? 0,
    currency: normalizedCurrency,
    status: normalizedStatus,
    orderId: normalizedOrderId || `ORD-${Date.now()}`,
    paymentMethod,
    description: description || 'Online odeme kaydi',
    providerToken: String(providerToken || ''),
    providerPaymentId: String(providerPaymentId || ''),
    callbackId: normalizedCallbackId,
    expectedAmount: normalizePaymentAmount(expectedAmount) ?? normalizedAmount ?? 0,
    expectedCurrency: normalizePaymentCurrency(expectedCurrency) || normalizedCurrency,
    environment: String(environment || ''),
    callbackAttempts: normalizedCallbackId ? 1 : 0,
    lastCallbackAt: normalizedCallbackId ? now() : '',
    createdAt: now(),
    updatedAt: now(),
  };

  store.payments.unshift(payment);
  applyCustomerPaymentStatus(customer, normalizedStatus, payment.createdAt);

  await addAudit(store, 'website', `Odeme kaydedildi: ${customer.name} / ${payment.amount} ${payment.currency}`, {
    customerId,
    orderId: payment.orderId,
    paymentStatus: normalizedStatus,
    providerPaymentId: payment.providerPaymentId,
    callbackId: payment.callbackId,
    ip: paymentInput?.ip || '',
  });

  const operationalResult = await notifyPaymentOperational(store, customer, payment, {
    callbackId: normalizedCallbackId,
    providerPaymentId: payment.providerPaymentId || '',
    ip: paymentInput?.ip || '',
  });
  payment.whatsappForwardedTo = operationalResult.whatsappForwardedTo || [];
  payment.emailDeliveryId = operationalResult.email?.deliveryId || '';

  if (normalizedStatus === 'completed') {
    await syncCrmEvent(store, 'payment.received', {
      customerId,
      amount: payment.amount,
      currency: payment.currency,
      orderId: payment.orderId,
    });
  }

  return { ok: true, payment };
}

function retrieveIyzicoPayment(iyzico, request) {
  return withTimeout(new Promise((resolve) => {
    iyzico.payWithIyzico.retrieve(request, (err, result) => {
      resolve({ err, result });
    });
  }), operationTimeouts.iyzicoMs, 'iyzico_retrieve_timeout');
}

function initializeIyzicoPayment(iyzico, request) {
  return withTimeout(new Promise((resolve) => {
    iyzico.payWithIyzico.initialize(request, (err, result) => {
      resolve({ err, result });
    });
  }), operationTimeouts.iyzicoMs, 'iyzico_initialize_timeout');
}

async function syncPendingIyzicoPayments() {
  const store = await db();
  if (!store.siteSettings?.iyzicoApiKey || !store.siteSettings?.iyzicoSecretKey) {
    return;
  }
  const pendingPayments = (store.payments || [])
    .filter((payment) => payment.paymentMethod === 'iyzico' && payment.status === 'pending' && payment.providerToken)
    .slice(0, 20);
  if (!pendingPayments.length) return;

  const iyzico = buildIyzicoClient(store);
  let changed = false;
  for (const payment of pendingPayments) {
    const { err, result } = await retrieveIyzicoPayment(iyzico, {
      locale: Iyzipay.LOCALE.TR,
      conversationId: payment.customerId,
      token: payment.providerToken,
    });
    payment.lastSyncAt = now();
    changed = true;
    if (err || !result || result.status !== 'success') {
      payment.lastSyncError = err?.message || result?.errorMessage || 'iyzico_sync_failed';
      emitStructuredLog('iyzico_flow', {
        customerId: payment.customerId,
        orderId: payment.orderId,
        stage: 'payment_sync',
        outcome: 'failed',
        errorCode: err?.code || err?.name || result?.errorCode || 'iyzico_sync_failed',
        errorMessage: payment.lastSyncError,
      }, 'warn');
      continue;
    }

    const nextStatus = result.paymentStatus === 'SUCCESS'
      ? 'completed'
      : result.paymentStatus === 'FAILURE' ? 'failed' : 'pending';
    if (nextStatus !== 'pending') {
      await recordCompletedPayment(store, {
        customerId: payment.customerId,
        amount: normalizePaymentAmount(result.paidPrice || result.price) || payment.amount,
        currency: normalizePaymentCurrency(result.currency || payment.currency) || payment.currency,
        orderId: result.basketId || payment.orderId,
        paymentMethod: 'iyzico',
        description: 'iyzico scheduled payment sync',
        paymentStatus: nextStatus,
        providerToken: payment.providerToken,
        providerPaymentId: result.paymentId || payment.providerPaymentId || '',
        callbackId: result.paymentId || payment.providerToken,
        environment: payment.environment || getIyzicoEnvironment(store.siteSettings || {}),
        expectedAmount: payment.expectedAmount || payment.amount,
        expectedCurrency: payment.expectedCurrency || payment.currency,
      });
    }
  }
  if (changed) {
    await persist(store);
  }
}

function buildIyzicoBuyerFromLead(lead, customerId, ip) {
  const parsedName = splitFullName(lead?.name || lead?.fullName || '');
  const firstName = parsedName.name || 'Müşteri';
  const surname = parsedName.surname || firstName || 'Müşteri';
  const address = lead?.address || lead?.addressDetail || `${lead?.neighborhood || ''} ${lead?.district || ''} ${lead?.province || ''}`.trim() || 'Turkey';
  const city = lead?.province || 'Istanbul';
  return {
    id: String(customerId || uuidv4()).slice(0, 36),
    name: firstName || 'Müşteri',
    surname: surname || 'Müşteri',
    gsmNumber: sanitizePhone(lead?.phone || ''),
    email: String(lead?.email || 'info@example.com').trim(),
    identityNumber: lead?.tcId || generateTurkishIdentityNumber(`${customerId || ''}${lead?.phone || ''}${lead?.name || ''}`),
    registrationAddress: address,
    city,
    country: 'Turkey',
    ip: ip || '127.0.0.1',
    zipCode: '34000',
    registrationDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
    lastLoginDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
}

function buildIyzicoAddress(lead, contactName) {
  const address = lead?.address || [lead?.addressDetail, lead?.neighborhood, lead?.district, lead?.province].filter(Boolean).join(' / ') || 'Turkey';
  return {
    contactName,
    city: lead?.province || 'Istanbul',
    country: 'Turkey',
    address,
    zipCode: '34000',
  };
}

function normalizeStepLabel(step) {
  const numeric = Number(step) || 0;
  const labels = {
    1: 'Başlangıç',
    2: 'Şirket Türü',
    3: 'Ana Faaliyet',
    4: 'Evrak Yükleme',
    5: 'İletişim Bilgileri',
    6: 'Adres Bilgileri',
    7: 'Özet',
    8: 'Ödeme',
    9: 'Onay',
  };
  return labels[numeric] || `Aşama ${numeric}`;
}

function normalizeStageId(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'stage-0';
  if (/^\d+$/.test(raw)) return `stage-${raw}`;
  return raw;
}

function normalizeApplicationId(value, fallbackPrefix = 'APP') {
  const raw = String(value || '').trim();
  if (raw) return raw.slice(0, 80);
  return `${fallbackPrefix}-${uuidv4()}`;
}

function buildDocumentGroupId(customerId, applicationId, stageId) {
  return [customerId, applicationId, stageId].map((value) => String(value || '').trim()).filter(Boolean).join('::');
}

function normalizeLeadProgressPayload(body = {}) {
  const files = Array.isArray(body.files)
    ? body.files
        .map((file) => (typeof file === 'string' ? file : String(file?.name || file?.path || '')))
        .filter(Boolean)
        .slice(0, 20)
    : [];

  return {
    step: Number(body.step || 0) || 0,
    stepLabel: normalizeStepLabel(body.step),
    locale: String(body.locale || 'tr').slice(0, 12),
    source: String(body.source || 'wizard').slice(0, 120),
    applicationId: String(body.applicationId || '').slice(0, 80),
    selectedCompanyType: String(body.selectedCompanyType || '').slice(0, 48),
    selectedCompanyTypeLabel: String(body.selectedCompanyTypeLabel || '').slice(0, 96),
    activity: {
      mainActivity: String(body.activity?.mainActivity || '').slice(0, 80),
      subActivity: String(body.activity?.subActivity || '').slice(0, 80),
      revenueMethod: String(body.activity?.revenueMethod || '').slice(0, 80),
      salesChannel: String(body.activity?.salesChannel || '').slice(0, 80),
    },
    lead: {
      name: String(body.lead?.name || '').slice(0, 120),
      phone: String(body.lead?.phone || '').slice(0, 40),
      email: String(body.lead?.email || '').slice(0, 160),
      companyName: String(body.lead?.companyName || '').slice(0, 160),
      tcId: String(body.lead?.tcId || '').slice(0, 20),
      address: String(body.lead?.address || '').slice(0, 240),
      province: String(body.lead?.province || '').slice(0, 80),
      district: String(body.lead?.district || '').slice(0, 80),
      neighborhood: String(body.lead?.neighborhood || '').slice(0, 80),
      addressDetail: String(body.lead?.addressDetail || '').slice(0, 240),
    },
    files,
    estimate: String(body.estimate || '').slice(0, 48),
    paymentReady: Boolean(body.paymentReady),
    stepSummary: String(body.stepSummary || '').slice(0, 300),
    progress: body.progress && typeof body.progress === 'object'
      ? {
          currentStep: Number(body.progress.currentStep || body.step || 0) || 0,
          nextStep: Number(body.progress.nextStep || 0) || 0,
          ratio: Number(body.progress.ratio || 0) || 0,
          label: String(body.progress.label || '').slice(0, 96),
        }
      : null,
  };
}

function collectLeadProgressChanges(previousSnapshot, nextSnapshot) {
  const changedFields = [];
  const changes = {};
  const compareFields = [
    'step',
    'stepLabel',
    'locale',
    'source',
    'applicationId',
    'selectedCompanyType',
    'selectedCompanyTypeLabel',
    'activity',
    'lead',
    'files',
    'estimate',
    'paymentReady',
    'stepSummary',
    'progress',
  ];

  for (const field of compareFields) {
    const previousValue = previousSnapshot ? previousSnapshot[field] : undefined;
    const nextValue = nextSnapshot[field];
    const previousJson = JSON.stringify(previousValue || null);
    const nextJson = JSON.stringify(nextValue || null);
    if (previousJson !== nextJson) {
      changedFields.push(field);
      changes[field] = {
        from: previousValue ?? null,
        to: nextValue ?? null,
      };
    }
  }

  return { changedFields, changes };
}

function buildLeadProgressSignature(snapshot) {
  return crypto.createHash('sha1').update(JSON.stringify({
    step: snapshot.step,
    selectedCompanyType: snapshot.selectedCompanyType,
    selectedCompanyTypeLabel: snapshot.selectedCompanyTypeLabel,
    activity: snapshot.activity,
    lead: snapshot.lead,
    files: snapshot.files,
    estimate: snapshot.estimate,
    paymentReady: snapshot.paymentReady,
  })).digest('hex');
}

function normalizeLeadProgressNotificationKey(snapshot, sessionId, visitorId) {
  const phone = sanitizePhone(snapshot?.lead?.phone || '');
  const applicationId = String(snapshot?.applicationId || '').slice(0, 80);
  const baseIdentity = phone || `session:${String(sessionId || '').slice(0, 80)}:visitor:${String(visitorId || '').slice(0, 80)}`;
  return `${applicationId || baseIdentity}:${baseIdentity}:${snapshot.step}:${buildLeadProgressSignature(snapshot)}`;
}

function isMeaningfulLeadProgressStep(step) {
  const numeric = Number(step) || 0;
  return numeric >= 2 && numeric <= 9;
}

function shouldRecordLeadProgressSnapshot(previousSnapshot, nextSnapshot) {
  if (!previousSnapshot) {
    return true;
  }
  const previousSignature = previousSnapshot.signature || buildLeadProgressSignature(previousSnapshot);
  const nextSignature = nextSnapshot.signature || buildLeadProgressSignature(nextSnapshot);
  return previousSignature !== nextSignature || previousSnapshot.step !== nextSnapshot.step;
}

function hasLeadProgressIdentity(snapshot = {}) {
  const lead = snapshot.lead || {};
  return Boolean(
    snapshot.applicationId ||
    lead.name ||
    lead.phone ||
    lead.email ||
    lead.companyName ||
    snapshot.selectedCompanyTypeLabel ||
    snapshot.activity?.mainActivity,
  );
}

function buildLeadProgressMessage(snapshot = {}, customer = {}) {
  const lead = snapshot.lead || {};
  const activity = snapshot.activity || {};
  const address = lead.address ||
    [lead.addressDetail, lead.neighborhood, lead.district, lead.province].filter(Boolean).join(' / ');
  return [
    `Başvuru aşaması: ${snapshot.stepLabel || '-'}`,
    `Başvuru No: ${snapshot.applicationId || customer.applicationId || '-'}`,
    `Müşteri: ${lead.name || customer.name || '-'}`,
    `Telefon: ${lead.phone || customer.phone || '-'}`,
    `E-posta: ${lead.email || customer.email || '-'}`,
    `Şirket adı: ${lead.companyName || customer.companyName || '-'}`,
    `Şirket türü: ${snapshot.selectedCompanyTypeLabel || customer.companyType || '-'}`,
    `Ana faaliyet: ${activity.mainActivity || customer.activity?.mainActivity || '-'}`,
    `Alt faaliyet: ${activity.subActivity || customer.activity?.subActivity || '-'}`,
    `Adres: ${address || customer.address || '-'}`,
    `Evrak seçimi: ${snapshot.files?.length ? snapshot.files.join(', ') : '-'}`,
    `Tahmini bedel: ${snapshot.estimate || customer.estimate || '-'}`,
  ].join('\n');
}

function buildApplicationPackageMessage(customer = {}, documents = []) {
  const activity = customer.activity || {};
  const address = customer.address ||
    [customer.addressDetail, customer.neighborhood, customer.district, customer.province].filter(Boolean).join(' / ');
  const documentNames = documents.length
    ? documents.map((document) => document.name).join(', ')
    : (customer.selectedFiles || []).join(', ');
  const portalBase = String(customer.portalBaseUrl || customer.portalUrl || customer.websiteUrl || '').trim().replace(/\/$/, '');
  const portalLink = portalBase
    ? `${portalBase}/portal?customerId=${encodeURIComponent(customer.id || customer.leadId || '')}&applicationId=${encodeURIComponent(customer.applicationId || customer.leadId || customer.id || '')}`
    : `Portal: ${customer.id || customer.leadId || customer.applicationId || '-'}`;
  return [
    'Yeni başvuru paketi hazır',
    `Başvuru No: ${customer.applicationId || customer.leadId || customer.id || '-'}`,
    `Müşteri: ${customer.name || '-'}`,
    `Telefon: ${customer.phone || '-'}`,
    `E-posta: ${customer.email || '-'}`,
    `Şirket adı: ${customer.companyName || '-'}`,
    `Şirket türü: ${customer.companyType || '-'}`,
    `Ana faaliyet: ${activity.mainActivity || '-'}`,
    `Alt faaliyet: ${activity.subActivity || '-'}`,
    `Adres: ${address || '-'}`,
    `Evrak sayısı: ${documents.length || (customer.documents || []).length || 0}`,
    `Evraklar: ${documentNames || '-'}`,
    `Ödeme durumu: ${customer.paymentStatus || 'pending'}`,
    `Atanan personel: ${customer.assignedUserName || customer.assignedUserEmail || '-'}`,
    `Portal müşteri linki: ${portalLink}`,
  ].join('\n');
}

function buildApplicationPackageNotificationKey(customer = {}, applicationId = '') {
  const normalizedApplicationId = String(applicationId || customer.applicationId || customer.leadId || customer.id || '').slice(0, 120);
  return `package-ready:${normalizedApplicationId || 'no-application'}:${customer.id || customer.leadId || 'no-customer'}`;
}

function isPackageReadyTransition(snapshot = {}) {
  const previousStep = Number(snapshot.previousStep || 0) || 0;
  const nextStep = Number(snapshot.step || 0) || 0;
  return nextStep >= 8 && previousStep < 8;
}

function formatOperationalDateTime(value = now()) {
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(value));
  } catch {
    return String(value || now());
  }
}

function compactUserAgent(userAgent = '') {
  return String(userAgent || '')
    .replace(/\s+/g, ' ')
    .slice(0, 220);
}

function buildSiteEntryNotificationMessage(visit = {}) {
  const details = [
    `IP: ${visit.ip || '-'}`,
    `Konum: ${visit.country || '-'}`,
    `Cihaz: ${visit.deviceType || '-'}`,
    `Viewport: ${visit.viewport?.width || 0}x${visit.viewport?.height || 0}`,
    `Ekran: ${visit.screen?.width || 0}x${visit.screen?.height || 0}`,
    `Sayfa: ${(visit.paths || [])[0] || '-'}`,
    `Dil: ${visit.locale || '-'}`,
    `Kaynak: ${visit.source || visit.referrer || '-'}`,
    `Tarayıcı: ${compactUserAgent(visit.userAgent) || '-'}`,
  ];
  return [
    `${formatOperationalDateTime(visit.firstSeenAt || now())} tarihinde siteye giriş tespit edilmiştir.`,
    `(${details.join(' | ')})`,
  ].join('\n');
}

function buildPaymentNotificationMessage(customer = {}, payment = {}) {
  const completed = normalizePaymentStatus(payment.status) === 'completed';
  return [
    completed ? 'Ödeme tamamlandı' : 'Ödeme tamamlanmadı',
    `Müşteri: ${customer.name || '-'}`,
    `Telefon: ${customer.phone || '-'}`,
    `E-posta: ${customer.email || '-'}`,
    `Şirket adı: ${customer.companyName || '-'}`,
    `Başvuru No: ${customer.applicationId || customer.leadId || customer.id || '-'}`,
    `Tutar: ${payment.amount || 0} ${payment.currency || 'TRY'}`,
    `Durum: ${payment.status || '-'}`,
    `Sipariş No: ${payment.orderId || '-'}`,
    `Sağlayıcı ödeme no: ${payment.providerPaymentId || '-'}`,
    `Ortam: ${payment.environment || '-'}`,
    `Ödeme zamanı: ${payment.createdAt || now()}`,
  ].join('\n');
}

async function notifyPaymentOperational(store, customer = {}, payment = {}, context = {}) {
  if (store.siteSettings?.notifyPayments === false) {
    return { ok: false, skipped: true, reason: 'notify_payments_disabled', whatsappForwardedTo: [], email: null };
  }
  const status = normalizePaymentStatus(payment.status);
  const subject = status === 'completed'
    ? 'OnlineSMMM ödeme tamamlandı'
    : 'OnlineSMMM ödeme tamamlanmadı';
  return sendOperationalNotification(store, {
    key: `payment:${payment.id}:${status}`,
    type: `payment_${status}`,
    subject,
    body: buildPaymentNotificationMessage(customer, payment),
    preferredUserIds: customer.assignedUserId ? [customer.assignedUserId] : [],
    context: {
      ...context,
      actor: 'website',
      customerId: customer.id || '',
      paymentId: payment.id || '',
      orderId: payment.orderId || '',
      paymentStatus: status,
    },
  });
}

function buildOperationalNotificationHtml(title = 'OnlineSMMM Bildirim', body = '') {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body).replace(/\n/g, '<br>');
  return `<!DOCTYPE html>
<html lang="tr">
<body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#f8fafc;padding:20px;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
    <h2 style="margin:0 0 14px;color:#0f172a;">${safeTitle}</h2>
    <p style="font-size:15px;line-height:1.65;margin:0;">${safeBody}</p>
  </div>
</body>
</html>`;
}

function recordOperationalNotification(store = {}, entry = {}) {
  store.operationalNotificationLedger = Array.isArray(store.operationalNotificationLedger) ? store.operationalNotificationLedger : [];
  store.operationalNotificationLedger.unshift({
    id: uuidv4(),
    key: entry.key,
    type: entry.type || 'operational',
    subject: String(entry.subject || '').slice(0, 180),
    whatsappForwardedTo: entry.whatsappForwardedTo || [],
    emailDeliveryId: entry.emailDeliveryId || '',
    createdAt: now(),
    ...entry,
  });
  store.operationalNotificationLedger = store.operationalNotificationLedger.slice(0, 1000);
}

async function sendOperationalNotification(store, {
  key,
  type,
  subject,
  body,
  preferredUserIds = [],
  attachments = [],
  context = {},
  skipWhatsApp = false,
} = {}) {
  const notificationKey = String(key || '').trim();
  if (!notificationKey) {
    return { ok: false, skipped: true, reason: 'missing_key', whatsappForwardedTo: [], email: null };
  }
  const existingNotification = getOperationalNotification(store, notificationKey);
  if (existingNotification) {
    return {
      ok: true,
      duplicate: true,
      whatsappForwardedTo: existingNotification.whatsappForwardedTo || [],
      whatsappDeliveryStatus: existingNotification.whatsappDeliveryStatus || buildWhatsAppDeliverySummary(existingNotification.whatsappForwardedTo || []).status,
      email: existingNotification.emailDeliveryId ? { deliveryId: existingNotification.emailDeliveryId } : null,
    };
  }

  let whatsappForwardedTo = [];
  if (!skipWhatsApp && store.siteSettings?.whatsappRoutingEnabled !== false) {
    whatsappForwardedTo = await forwardWhatsAppNotifications(store, body, { preferredUserIds, attachments });
  }
  const whatsappDelivery = buildWhatsAppDeliverySummary(whatsappForwardedTo);

  const recipients = getOperationalNotificationRecipients();
  let email = null;
  if (recipients.length) {
    const settings = getServerMailSettings(store.siteSettings || {});
    if (isMailConfigured(settings)) {
      email = enqueueMail(store, {
        to: recipients,
        subject: String(subject || 'OnlineSMMM operasyon bildirimi'),
        html: buildOperationalNotificationHtml(subject, body),
        text: body,
        attachments,
      }, {
        ...context,
        template: `operational_${type || 'notification'}`,
        recipient: recipients.join(', '),
        recipients: recipients.length,
        subject: String(subject || '').slice(0, 120),
      });
    } else {
      email = { ok: false, skipped: true, reason: 'smtp_not_configured' };
    }
  }

  recordOperationalNotification(store, {
    key: notificationKey,
    type,
    subject,
    body: String(body || '').slice(0, 5000),
    preferredUserIds: preferredUserIds.map((id) => String(id || '')).filter(Boolean),
    whatsappForwardedTo,
    whatsappDeliveryStatus: whatsappDelivery.status,
    whatsappRetryCount: 0,
    lastWhatsAppRetryAt: '',
    nextWhatsAppRetryAt: '',
    emailDeliveryId: email?.deliveryId || '',
    context,
  });
  const ledgerEntry = getOperationalNotification(store, notificationKey);
  if (ledgerEntry) {
    markWhatsAppRetrySchedule(ledgerEntry, whatsappDelivery.status);
  }
  return { ok: true, whatsappForwardedTo, whatsappDeliveryStatus: whatsappDelivery.status, email };
}

function buildWhatsAppDeliverySummary(forwardedTo = []) {
  const entries = Array.isArray(forwardedTo) ? forwardedTo : [];
  const sent = entries.filter((entry) => !String(entry || '').startsWith('FAILED:') && !String(entry || '').startsWith('RECONNECT_FAILED:') && !String(entry || '').startsWith('NOT_READY:') && !String(entry || '').startsWith('NO_PHONE:')).length;
  const failed = entries.filter((entry) => String(entry || '').startsWith('FAILED:') || String(entry || '').startsWith('RECONNECT_FAILED:')).length;
  const skipped = entries.filter((entry) => String(entry || '').startsWith('NOT_READY:') || String(entry || '').startsWith('NO_PHONE:')).length;
  const status = sent > 0
    ? (failed > 0 || skipped > 0 ? 'partial' : 'sent')
    : (failed > 0 ? 'failed' : skipped > 0 ? 'skipped' : 'not_sent');
  return { status, sent, failed, skipped, total: entries.length, entries };
}

function isWhatsAppDeliveryComplete(status = '') {
  return ['sent', 'partial'].includes(String(status || ''));
}

function getWhatsAppRetryDelayMs(retryCount = 0) {
  return Math.min(15 * 60_000, 60_000 * (2 ** Math.max(0, Number(retryCount || 0))));
}

function getOperationalNotification(store = {}, key = '') {
  return (store.operationalNotificationLedger || []).find((entry) => entry.key === key) || null;
}

function shouldRetryOperationalWhatsApp(entry = {}) {
  if (!entry || !entry.body) return false;
  if (isWhatsAppDeliveryComplete(entry.whatsappDeliveryStatus)) return false;
  if (Number(entry.whatsappRetryCount || 0) >= whatsappNotificationMaxRetries) return false;
  if (entry.nextWhatsAppRetryAt && Date.parse(entry.nextWhatsAppRetryAt) > Date.now()) return false;
  return true;
}

function markWhatsAppRetrySchedule(entry = {}, status = '') {
  if (isWhatsAppDeliveryComplete(status)) {
    entry.nextWhatsAppRetryAt = '';
    return;
  }
  const retryCount = Number(entry.whatsappRetryCount || 0);
  entry.nextWhatsAppRetryAt = new Date(Date.now() + getWhatsAppRetryDelayMs(retryCount)).toISOString();
}

function buildApplicationPackageFileSignature(files = []) {
  return crypto.createHash('sha1').update(JSON.stringify(
    files.map((file) => ({
      name: sanitizeDocumentName(file.originalname || file.name || ''),
      size: Number(file.size || 0),
      type: String(file.mimetype || file.mimeType || ''),
    })),
  )).digest('hex');
}

function upsertLeadProgressCustomer(store, snapshot, context = {}) {
  store.customers = Array.isArray(store.customers) ? store.customers : [];
  if (!hasLeadProgressIdentity(snapshot)) {
    return null;
  }

  const lead = snapshot.lead || {};
  const applicationId = normalizeApplicationId(snapshot.applicationId || context.applicationId || '', 'APP');
  let customer = store.customers.find((entry) => entry.applicationId && entry.applicationId === applicationId);
  if (!customer && context.sessionId) {
    customer = store.customers.find((entry) =>
      entry.sessionId === context.sessionId &&
      (!context.visitorId || entry.visitorId === context.visitorId) &&
      ['website', 'wizard', 'application-flow'].includes(String(entry.source || '')),
    );
  }

  const assignedUser = customer?.assignedUserId
    ? (store.users || []).find((user) => user.id === customer.assignedUserId)
    : pickOperationalOwnerUser(store);
  const timestamp = now();
  const address = lead.address || [lead.addressDetail, lead.neighborhood, lead.district, lead.province].filter(Boolean).join(' / ');

  if (!customer) {
    customer = {
      id: uuidv4(),
      sessionId: context.sessionId || '',
      visitorId: context.visitorId || '',
      name: lead.name || 'Taslak başvuru',
      email: lead.email || '',
      phone: lead.phone || '',
      tckn: lead.tcId || '',
      applicationId,
      leadId: '',
      companyName: lead.companyName || '',
      companyTypeId: snapshot.selectedCompanyType || '',
      companyType: snapshot.selectedCompanyTypeLabel || '',
      address,
      province: lead.province || '',
      district: lead.district || '',
      neighborhood: lead.neighborhood || '',
      addressDetail: lead.addressDetail || '',
      estimate: snapshot.estimate || '',
      estimateValue: 0,
      activity: {
        mainActivity: snapshot.activity?.mainActivity || '',
        subActivity: snapshot.activity?.subActivity || '',
        revenueMethod: snapshot.activity?.revenueMethod || '',
        salesChannel: snapshot.activity?.salesChannel || '',
      },
      assignedUserId: assignedUser?.id || '',
      assignedUserEmail: assignedUser?.email || '',
      assignedUserName: assignedUser?.name || '',
      membershipStatus: 'Başvuru devam ediyor',
      paymentStatus: snapshot.paymentReady || snapshot.step >= 8 ? 'payment_pending' : 'pending',
      paymentCompletedAt: '',
      notes: 'Başvuru sihirbazından otomatik taslak kayıt.',
      source: context.source || snapshot.source || 'application-flow',
      stage: snapshot.step,
      stageId: normalizeStageId(snapshot.step || 0),
      stageLabel: snapshot.stepLabel || '',
      createdAt: timestamp,
      updatedAt: timestamp,
      documents: [],
      selectedFiles: [],
      progressSnapshots: [],
      timeline: [],
    };
    customer.leadId = customer.id;
    store.customers.unshift(customer);
  }

  Object.assign(customer, {
    sessionId: customer.sessionId || context.sessionId || '',
    visitorId: customer.visitorId || context.visitorId || '',
    name: lead.name || customer.name || 'Taslak başvuru',
    email: lead.email || customer.email || '',
    phone: lead.phone || customer.phone || '',
    tckn: lead.tcId || customer.tckn || '',
    applicationId: customer.applicationId || applicationId,
    companyName: lead.companyName || customer.companyName || '',
    companyTypeId: snapshot.selectedCompanyType || customer.companyTypeId || '',
    companyType: snapshot.selectedCompanyTypeLabel || customer.companyType || '',
    address: address || customer.address || '',
    province: lead.province || customer.province || '',
    district: lead.district || customer.district || '',
    neighborhood: lead.neighborhood || customer.neighborhood || '',
    addressDetail: lead.addressDetail || customer.addressDetail || '',
    estimate: snapshot.estimate || customer.estimate || '',
    activity: {
      mainActivity: snapshot.activity?.mainActivity || customer.activity?.mainActivity || '',
      subActivity: snapshot.activity?.subActivity || customer.activity?.subActivity || '',
      revenueMethod: snapshot.activity?.revenueMethod || customer.activity?.revenueMethod || '',
      salesChannel: snapshot.activity?.salesChannel || customer.activity?.salesChannel || '',
    },
    assignedUserId: customer.assignedUserId || assignedUser?.id || '',
    assignedUserEmail: customer.assignedUserEmail || assignedUser?.email || '',
    assignedUserName: customer.assignedUserName || assignedUser?.name || '',
    membershipStatus: snapshot.step >= 8 ? 'Ödeme aşamasında' : 'Başvuru devam ediyor',
    paymentStatus: snapshot.paymentReady || snapshot.step >= 8 ? 'payment_pending' : customer.paymentStatus || 'pending',
    source: context.source || snapshot.source || customer.source || 'application-flow',
    stage: snapshot.step,
    stageId: normalizeStageId(snapshot.step || 0),
    stageLabel: snapshot.stepLabel || customer.stageLabel || '',
    stepSummary: snapshot.stepSummary || customer.stepSummary || '',
    progress: snapshot.progress || customer.progress || null,
    selectedFiles: Array.isArray(snapshot.files) ? snapshot.files : customer.selectedFiles || [],
    updatedAt: timestamp,
  });

  customer.progressSnapshots = Array.isArray(customer.progressSnapshots) ? customer.progressSnapshots : [];
  if (!customer.progressSnapshots.find((entry) => entry.signature === snapshot.signature && entry.step === snapshot.step)) {
    customer.progressSnapshots.unshift({
      step: snapshot.step,
      stepLabel: snapshot.stepLabel,
      stepSummary: snapshot.stepSummary,
      changedFields: snapshot.changedFields || [],
      signature: snapshot.signature,
      createdAt: snapshot.createdAt || timestamp,
    });
    customer.progressSnapshots = customer.progressSnapshots.slice(0, 20);
  }

  customer.timeline = Array.isArray(customer.timeline) ? customer.timeline : [];
  if (!customer.timeline.find((entry) => entry.signature === snapshot.signature && entry.step === snapshot.step)) {
    customer.timeline.unshift({
      id: uuidv4(),
      type: 'progress',
      step: snapshot.step,
      stepLabel: snapshot.stepLabel,
      summary: snapshot.stepSummary || `${snapshot.stepLabel || 'Aşama'} kaydedildi`,
      changedFields: snapshot.changedFields || [],
      signature: snapshot.signature,
      createdAt: snapshot.createdAt || timestamp,
    });
    customer.timeline = customer.timeline.slice(0, 30);
  }

  return customer;
}

function resolveAuditSeverity(action = '', meta = {}) {
  if (meta.severity) {
    return meta.severity;
  }

  const normalized = String(action).toLowerCase();
  if (
    normalized.includes('engellendi') ||
    normalized.includes('yetkisiz') ||
    normalized.includes('hatali') ||
    normalized.includes('kilit') ||
    normalized.includes('guvenli olmayan') ||
    normalized.includes('hata')
  ) {
    return 'critical';
  }

  if (
    normalized.includes('silindi') ||
    normalized.includes('arşiv') ||
    normalized.includes('guncellendi') ||
    normalized.includes('degistirdi') ||
    normalized.includes('baslatildi') ||
    normalized.includes('durduruldu')
  ) {
    return 'warning';
  }

  return 'info';
}

async function addAudit(store, actor, action, meta = {}) {
  const source = String(meta.source || meta.channel || meta.route || meta.stage || meta.page || 'system').slice(0, 120);
  const entry = {
    id: uuidv4(),
    actor,
    action,
    source,
    severity: resolveAuditSeverity(action, meta),
    meta,
    createdAt: now(),
  };
  store.auditLogs.unshift(entry);
  store.auditLogs = store.auditLogs.slice(0, 200);
  emitStructuredLog('audit_event', {
    actor,
    action,
    source,
    severity: entry.severity,
    ...meta,
  }, entry.severity === 'critical' ? 'error' : entry.severity === 'warning' ? 'warn' : 'info');
  return entry;
}

function getClientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.ip ||
    req.socket.remoteAddress ||
    ''
  ).split(',')[0].trim();
}

function sanitizeVisitEvent(input = {}) {
  const eventType = ['page_view', 'heartbeat', 'click', 'lead_submit'].includes(input.eventType) ? input.eventType : 'heartbeat';
  return {
    sessionId: String(input.sessionId || '').slice(0, 80),
    visitorId: String(input.visitorId || '').slice(0, 80),
    eventType,
    path: String(input.path || '/').slice(0, 220),
    locale: String(input.locale || '').slice(0, 12),
    referrer: String(input.referrer || '').slice(0, 500),
    source: String(input.source || '').slice(0, 120),
    target: String(input.target || '').slice(0, 120),
    label: String(input.label || '').slice(0, 160),
    href: String(input.href || '').slice(0, 500),
    durationSeconds: Math.max(0, Math.min(86400, Number(input.durationSeconds || 0))),
    screen: {
      width: Number(input.screen?.width || 0),
      height: Number(input.screen?.height || 0),
    },
    viewport: {
      width: Number(input.viewport?.width || 0),
      height: Number(input.viewport?.height || 0),
    },
    deviceType: String(input.deviceType || '').slice(0, 30),
    lead: input.lead && typeof input.lead === 'object'
      ? {
          name: String(input.lead.name || '').slice(0, 120),
          phone: String(input.lead.phone || '').slice(0, 40),
          email: String(input.lead.email || '').slice(0, 160),
          companyName: String(input.lead.companyName || '').slice(0, 160),
        }
      : null,
  };
}

function isInternalVisitCheck(visit = {}) {
  return /^live-check-codex|^test-session-codex/.test(String(visit.sessionId || '')) ||
    /^live-check-codex|^test-visitor-codex/.test(String(visit.visitorId || ''));
}

function userCanReceiveOperationalWhatsApp(user = {}) {
  if (!user || user.isActive === false) return false;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return user.role === 'superadmin' ||
    permissions.includes('*') ||
    permissions.includes('whatsapp') ||
    permissions.includes('customers') ||
    permissions.includes('messages');
}

function pickOperationalOwnerUser(store = {}) {
  const users = Array.isArray(store.users) ? store.users : [];
  const connections = Array.isArray(store.whatsappConnections) ? store.whatsappConnections : [];
  const connectedOwnerIds = new Set(
    connections
      .filter((connection) => connection.isActive !== false && connection.ownerUserId)
      .map((connection) => String(connection.ownerUserId)),
  );
  const staff = users.filter((user) => user.role !== 'superadmin' && userCanReceiveOperationalWhatsApp(user));
  return staff.find((user) => connectedOwnerIds.has(String(user.id))) ||
    staff[0] ||
    users.find((user) => user.role === 'superadmin' && userCanReceiveOperationalWhatsApp(user)) ||
    null;
}

function resolveWhatsAppNotificationRecipients(store = {}, preferredUserIds = []) {
  const preferred = new Set(preferredUserIds.map((id) => String(id || '')).filter(Boolean));
  const usersById = new Map((store.users || []).map((user) => [String(user.id), user]));
  const recipients = [];
  const seen = new Set();

  for (const connection of store.whatsappConnections || []) {
    const canWakeConnection = connection.isActive !== false || connection.autoReconnect !== false;
    if (!canWakeConnection) continue;
    const owner = connection.ownerUserId ? usersById.get(String(connection.ownerUserId)) : null;
    if (owner && !userCanReceiveOperationalWhatsApp(owner)) continue;
    const targetPhone = connection.sessionPhone || connection.phone || owner?.phone || '';
    if (!targetPhone && !connection.ownerUserId) continue;
    const key = `${connection.id}:${sanitizePhone(targetPhone) || 'self'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({
      connection,
      owner,
      targetPhone,
      preferred: preferred.has(String(connection.ownerUserId || '')),
    });
  }

  return recipients.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    const roleRank = (recipient) => recipient.owner?.role === 'superadmin' ? 2 : 1;
    return roleRank(a) - roleRank(b);
  });
}

function buildOperationalWhatsAppSummary(customer = {}, title = 'Yeni müşteri başvurusu') {
  const activity = customer.activity || {};
  const address = customer.address ||
    [customer.addressDetail, customer.neighborhood, customer.district, customer.province].filter(Boolean).join(' / ');
  const lines = [
    title,
    `Başvuru No: ${customer.applicationId || customer.leadId || customer.id || '-'}`,
    `Müşteri: ${customer.name || '-'}`,
    `Telefon: ${customer.phone || '-'}`,
    `E-posta: ${customer.email || '-'}`,
    `Şirket adı: ${customer.companyName || '-'}`,
    `Şirket türü: ${customer.companyType || customer.companyTypeId || '-'}`,
    `Ana faaliyet: ${activity.mainActivity || '-'}`,
    `Alt faaliyet: ${activity.subActivity || '-'}`,
    `Gelir yöntemi: ${activity.revenueMethod || '-'}`,
    `Satış kanalı: ${activity.salesChannel || '-'}`,
    `Adres: ${address || '-'}`,
    `Evrak: ${(customer.documents || []).length} dosya`,
    `Ödeme: ${customer.paymentStatus || 'pending'}`,
    `Atanan personel: ${customer.assignedUserName || customer.assignedUserEmail || '-'}`,
    `Kayıt zamanı: ${customer.createdAt || now()}`,
  ];
  return lines.join('\n');
}

async function forwardWhatsAppNotifications(store, body, options = {}) {
  const forwarded = [];
  const recipients = resolveWhatsAppNotificationRecipients(store, options.preferredUserIds || []);
  for (const recipient of recipients) {
    const { connection, owner } = recipient;
    let runtime = getConnectionRuntime(connection.id);
    const targetPhone = recipient.targetPhone || connection.sessionPhone || connection.phone || owner?.phone;
    if (!targetPhone) {
      forwarded.push(`NO_PHONE:${connection.label || connection.id}`);
      emitStructuredLog('whatsapp_delivery', {
        connectionId: connection.id,
        connectionLabel: connection.label || '',
        ownerUserId: connection.ownerUserId || '',
        delivery: 'skipped',
        reason: 'no_phone',
      }, 'warn');
      continue;
    }
    if (runtime?.status !== 'ready' && (connection.isActive !== false || connection.autoReconnect !== false)) {
      try {
        if (connection.isActive === false && connection.autoReconnect !== false) {
          Object.assign(connection, {
            isActive: true,
            status: connection.status || 'disconnected',
            lastSyncedAt: now(),
          });
        }
        runtime = await withTimeout(
          ensureWhatsAppClient(connection, persistWhatsAppState, handleInboundWhatsApp),
          operationTimeouts.whatsappMs,
          'whatsapp_lazy_reconnect_timeout',
        );
        emitStructuredLog('whatsapp_state', {
          connectionId: connection.id,
          connectionLabel: connection.label || '',
          ownerUserId: connection.ownerUserId || '',
          outcome: 'lazy_reconnect',
          status: runtime?.status || connection.status || '',
        }, 'info');
      } catch (error) {
        forwarded.push(`RECONNECT_FAILED:${connection.label || connection.phone || connection.id}:${error.message}`);
        emitStructuredLog('whatsapp_delivery', {
          connectionId: connection.id,
          connectionLabel: connection.label || '',
          ownerUserId: connection.ownerUserId || '',
          delivery: 'failed',
          errorCode: error.code || error.name || 'whatsapp_lazy_reconnect_failed',
          errorMessage: error.message,
        }, 'error');
        continue;
      }
    }
    if (runtime?.status === 'ready') {
      const startedAt = performance.now();
      try {
        await withTimeout(
          sendWhatsAppMessage(connection.id, targetPhone, body, options.attachments || []),
          operationTimeouts.whatsappMs,
          'whatsapp_send_timeout',
        );
        forwarded.push(connection.label || connection.phone || connection.id);
        const durationMs = observeDuration(startedAt);
        emitStructuredLog('whatsapp_delivery', {
          connectionId: connection.id,
          connectionLabel: connection.label || '',
          ownerUserId: connection.ownerUserId || '',
          delivery: 'sent',
          durationMs,
        }, 'info');
        await addAudit(store, 'system', 'WhatsApp mesajı iletildi', {
          connectionId: connection.id,
          connectionLabel: connection.label || '',
          ownerUserId: connection.ownerUserId || '',
          delivery: 'sent',
          durationMs,
          severity: 'info',
        });
      } catch (error) {
        forwarded.push(`FAILED:${connection.label || connection.phone || connection.id}:${error.message}`);
        const durationMs = observeDuration(startedAt);
        emitStructuredLog('whatsapp_delivery', {
          connectionId: connection.id,
          connectionLabel: connection.label || '',
          ownerUserId: connection.ownerUserId || '',
          delivery: 'failed',
          errorCode: error.code || error.name || 'whatsapp_send_error',
          errorMessage: error.message,
          durationMs,
        }, 'error');
        await addAudit(store, 'system', 'WhatsApp mesajı iletilemedi', {
          connectionId: connection.id,
          connectionLabel: connection.label || '',
          ownerUserId: connection.ownerUserId || '',
          delivery: 'failed',
          errorCode: error.code || error.name || 'whatsapp_send_error',
          errorMessage: error.message,
          durationMs,
          severity: 'critical',
        });
      }
    } else {
      forwarded.push(`NOT_READY:${connection.label || connection.phone || connection.id}`);
      emitStructuredLog('whatsapp_delivery', {
        connectionId: connection.id,
        connectionLabel: connection.label || '',
        ownerUserId: connection.ownerUserId || '',
        delivery: 'skipped',
        reason: `state_${runtime?.status || 'unknown'}`,
      }, 'warn');
    }
  }
  return forwarded;
}

function buildWhatsAppDeliveryStatus(forwardedTo = [], recentNotification = false) {
  const summary = buildWhatsAppDeliverySummary(forwardedTo);
  if (recentNotification && summary.status === 'not_sent') {
    return 'duplicate_skipped';
  }
  return summary.status;
}

async function retryPendingOperationalWhatsAppNotifications() {
  if (whatsappNotificationRetryRunning || !whatsappNotificationMaxRetries) return;
  whatsappNotificationRetryRunning = true;
  try {
    const store = await db();
    const pending = (store.operationalNotificationLedger || [])
      .filter((entry) => shouldRetryOperationalWhatsApp(entry))
      .slice(0, 5);
    if (!pending.length) return;

    let changed = false;
    for (const entry of pending) {
      const startedAt = performance.now();
      entry.whatsappRetryCount = Number(entry.whatsappRetryCount || 0) + 1;
      entry.lastWhatsAppRetryAt = now();
      try {
        const forwardedTo = await forwardWhatsAppNotifications(store, entry.body, {
          preferredUserIds: entry.preferredUserIds || [],
        });
        const summary = buildWhatsAppDeliverySummary(forwardedTo);
        entry.whatsappForwardedTo = forwardedTo;
        entry.whatsappDeliveryStatus = summary.status;
        markWhatsAppRetrySchedule(entry, summary.status);
        emitStructuredLog('whatsapp_delivery', {
          notificationKey: entry.key,
          notificationType: entry.type || 'operational',
          delivery: summary.status,
          retryCount: entry.whatsappRetryCount,
          durationMs: observeDuration(startedAt),
        }, isWhatsAppDeliveryComplete(summary.status) ? 'info' : 'warn');
        changed = true;
      } catch (error) {
        entry.whatsappDeliveryStatus = 'failed';
        entry.whatsappForwardedTo = [`FAILED:notification-retry:${error.message || 'whatsapp_retry_failed'}`];
        entry.lastWhatsAppRetryError = error.message || 'whatsapp_retry_failed';
        markWhatsAppRetrySchedule(entry, 'failed');
        emitStructuredLog('whatsapp_delivery', {
          notificationKey: entry.key,
          notificationType: entry.type || 'operational',
          delivery: 'failed',
          retryCount: entry.whatsappRetryCount,
          errorCode: error.code || error.name || 'whatsapp_retry_failed',
          errorMessage: error.message,
          durationMs: observeDuration(startedAt),
        }, 'error');
        changed = true;
      }
    }

    if (changed) {
      await persist(store);
    }
  } finally {
    whatsappNotificationRetryRunning = false;
  }
}

async function syncCrmEvent(store, eventType, payload) {
  const event = {
    id: uuidv4(),
    eventType,
    payload,
    status: 'pending',
    createdAt: now(),
    sentAt: null,
  };
  store.crmEvents.unshift(event);

  if (store.siteSettings.crmEnabled && store.siteSettings.crmWebhookUrl) {
    try {
      const response = await fetch(store.siteSettings.crmWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(store.siteSettings.crmAuthToken ? { Authorization: `Bearer ${store.siteSettings.crmAuthToken}` } : {}),
        },
        body: JSON.stringify({ eventType, payload }),
      });
      event.status = response.ok ? 'sent' : `failed:${response.status}`;
    } catch (error) {
      event.status = `error:${error.message}`;
    }
    event.sentAt = now();
  }

  await addAudit(store, 'system', `CRM sync event: ${eventType}`, {
    eventType,
    status: event.status,
  });
  return event;
}

function filterPublicSiteSettings(siteSettings) {
  const safeSettings = { ...siteSettings };
  delete safeSettings.iyzicoApiKey;
  delete safeSettings.iyzicoSecretKey;
  delete safeSettings.crmAuthToken;
  delete safeSettings.smtpPass;
  safeSettings.turnstileSiteKey = String(
    safeSettings.turnstileSiteKey ||
    process.env.VITE_TURNSTILE_SITE_KEY ||
    process.env.TURNSTILE_SITE_KEY ||
    '',
  ).trim();
  return safeSettings;
}

function maskPrivateSiteSettings(siteSettings = {}) {
  const safeSettings = { ...siteSettings };
  for (const key of ['iyzicoApiKey', 'iyzicoSecretKey', 'smtpPass', 'crmAuthToken']) {
    if (safeSettings[key]) {
      safeSettings[key] = '********';
    }
  }
  return safeSettings;
}

function mergePrivateSiteSettings(current = {}, incoming = {}) {
  const nextSettings = { ...current, ...incoming };
  for (const key of ['iyzicoApiKey', 'iyzicoSecretKey', 'smtpPass', 'crmAuthToken']) {
    const value = String(incoming[key] ?? '').trim();
    if (!value || /^\*{4,}$/.test(value)) {
      nextSettings[key] = current[key] || '';
    }
  }
  return nextSettings;
}

const paymentStatuses = new Set(['pending', 'completed', 'failed', 'refunded', 'cancelled']);

function normalizePaymentStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'success' || value === 'paid') return 'completed';
  if (value === 'refund' || value === 'refunded') return 'refunded';
  if (value === 'failure' || value === 'error') return 'failed';
  return paymentStatuses.has(value) ? value : 'pending';
}

function normalizePaymentCurrency(currency = 'TRY') {
  const value = String(currency || 'TRY').trim().toUpperCase();
  return ['TRY', 'USD'].includes(value) ? value : '';
}

function normalizePaymentAmount(amount) {
  const raw = String(amount ?? '').trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, '');
  const hasComma = compact.includes(',');
  const hasDot = compact.includes('.');
  const normalized = hasComma && hasDot
    ? compact.lastIndexOf(',') > compact.lastIndexOf('.')
      ? compact.replace(/\./g, '').replace(',', '.')
      : compact.replace(/,/g, '')
    : hasComma
      ? compact.replace(',', '.')
      : compact;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function amountsMatch(left, right) {
  const first = normalizePaymentAmount(left);
  const second = normalizePaymentAmount(right);
  return Number.isFinite(first) && Number.isFinite(second) && Math.abs(first - second) < 0.01;
}

function buildIyzicoOrderId(customerId) {
  const safeCustomerId = String(customerId || 'customer').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);
  return `IYZ-${safeCustomerId}-${Date.now()}`;
}

function getIyzicoEnvironment(settings = {}) {
  return settings.iyzicoEnvironment === 'live' ? 'live' : 'sandbox';
}

function findPaymentRecord(store, match = {}) {
  const paymentMethod = match.paymentMethod || 'iyzico';
  const customerId = String(match.customerId || '');
  const orderId = String(match.orderId || '').trim();
  const providerToken = String(match.providerToken || '').trim();
  const providerPaymentId = String(match.providerPaymentId || '').trim();
  const callbackId = String(match.callbackId || '').trim();
  return (store.payments || []).find((entry) => {
    if (entry.paymentMethod !== paymentMethod) return false;
    if (customerId && entry.customerId !== customerId) return false;
    return (
      (callbackId && String(entry.callbackId || '') === callbackId) ||
      (providerPaymentId && String(entry.providerPaymentId || '') === providerPaymentId) ||
      (providerToken && String(entry.providerToken || '') === providerToken) ||
      (orderId && String(entry.orderId || '') === orderId)
    );
  });
}

function applyCustomerPaymentStatus(customer, status, paymentTimestamp = '') {
  if (!customer) return;
  const nextStatus = normalizePaymentStatus(status);
  if (nextStatus === 'completed') {
    customer.paymentStatus = 'completed';
    customer.paymentCompletedAt = customer.paymentCompletedAt || paymentTimestamp || now();
    customer.membershipStatus = customer.membershipStatus === 'Yeni lead'
      ? 'Ödeme tamamlandı'
      : customer.membershipStatus;
  } else if (customer.paymentStatus !== 'completed') {
    customer.paymentStatus = nextStatus;
  }
  customer.updatedAt = now();
}

function getIyzicoDiagnostics(settings = {}, req) {
  const callbackUrl = resolvePaymentCallbackUrl(settings, req);
  return {
    environment: getIyzicoEnvironment(settings),
    apiKeyConfigured: Boolean(settings.iyzicoApiKey),
    secretConfigured: Boolean(settings.iyzicoSecretKey),
    merchantIdConfigured: Boolean(settings.iyzicoMerchantId),
    callbackUrlConfigured: Boolean(callbackUrl),
    callbackUrl: callbackUrl ? 'configured' : '',
  };
}

function getWhatsAppConnectionPhones(connection = {}) {
  return [connection.phone, connection.sessionPhone]
    .map((value) => sanitizePhone(value))
    .filter(Boolean);
}

function findWhatsAppConnectionConflict(connections = [], candidate = {}) {
  const candidatePhones = getWhatsAppConnectionPhones(candidate);
  if (!candidatePhones.length) return null;
  return (connections || []).find((entry) => {
    if (!entry || entry.id === candidate.id) return false;
    const entryPhones = getWhatsAppConnectionPhones(entry);
    return candidatePhones.some((phone) => entryPhones.includes(phone));
  }) || null;
}

function findWhatsAppOwnerConflict(connections = [], ownerUserId = '', currentConnectionId = '') {
  const ownerId = String(ownerUserId || '');
  if (!ownerId) return null;
  return (connections || []).find((entry) =>
    entry.id !== currentConnectionId && String(entry.ownerUserId || '') === ownerId,
  ) || null;
}

async function persistWhatsAppState(connectionId, nextState) {
  const store = await db();
  const connection = store.whatsappConnections.find((entry) => entry.id === connectionId);
  if (!connection) return;
  const previousStatus = connection.status || 'unknown';
  const conflict = findWhatsAppConnectionConflict(store.whatsappConnections, { ...connection, ...nextState });
  if (conflict) {
    await disconnectWhatsAppClient(connectionId, 'duplicate_whatsapp_session');
    Object.assign(connection, nextState, {
      isActive: false,
      status: 'failed',
      qrDataUrl: '',
      pairingCode: '',
      lastError: `duplicate_whatsapp_session:${conflict.label || conflict.phone || conflict.id}`,
      lastSyncedAt: now(),
    });
    await addAudit(store, 'system', 'WhatsApp oturum çakışması engellendi', {
      connectionId,
      conflictConnectionId: conflict.id,
      sessionPhone: nextState.sessionPhone || connection.sessionPhone || '',
      severity: 'critical',
    }, 'critical');
    await persist(store);
    return;
  }
  Object.assign(connection, nextState);
  const nextStatus = connection.status || previousStatus;
  const statusChanged = previousStatus !== nextStatus || Boolean(nextState.lastError);
  if (statusChanged) {
    const severity =
      ['failed', 'disconnected'].includes(String(nextStatus)) ? 'critical' :
      String(nextStatus) === 'qr' || String(nextStatus) === 'auth' ? 'warning' :
      'info';
    emitStructuredLog('whatsapp_state', {
      connectionId,
      connectionLabel: connection.label || '',
      previousStatus,
      nextStatus,
      lastError: nextState.lastError || '',
      sessionPhone: nextState.sessionPhone || connection.sessionPhone || '',
      isActive: Boolean(connection.isActive),
    }, severity === 'critical' ? 'error' : severity === 'warning' ? 'warn' : 'info');
    await addAudit(store, 'system', 'WhatsApp bağlantı durumu güncellendi', {
      connectionId,
      connectionLabel: connection.label || '',
      previousStatus,
      nextStatus,
      lastError: nextState.lastError || '',
      sessionPhone: nextState.sessionPhone || connection.sessionPhone || '',
      severity,
    });
  }
  await persist(store);
}

async function handleInboundWhatsApp(connectionId, payload) {
  const store = await db();
  const connection = store.whatsappConnections.find((entry) => entry.id === connectionId);
  const matchingCustomer = store.customers.find((customer) => {
    const digits = String(customer.phone || '').replace(/[^\d]/g, '');
    return digits && payload.from.includes(digits);
  });

  store.messages.unshift({
    id: uuidv4(),
    customerId: matchingCustomer?.id || '',
    channel: 'whatsapp',
    direction: 'inbound',
    actor: connection?.label || connection?.phone || payload.from,
    body: payload.body,
    createdAt: now(),
    whatsappForwardedTo: [connection?.label || connection?.phone || connectionId],
  });
  emitStructuredLog('whatsapp_inbound', {
    connectionId,
    connectionLabel: connection?.label || '',
    messageLength: String(payload.body || '').length,
    hasMedia: Boolean(payload.hasMedia),
    matchedCustomerId: matchingCustomer?.id || '',
  }, 'info');
  await addAudit(store, connection?.label || 'whatsapp', 'WhatsApp üzerinden gelen mesaj portala düştü', {
    connectionId,
    connectionLabel: connection?.label || '',
    matchedCustomerId: matchingCustomer?.id || '',
    hasMedia: Boolean(payload.hasMedia),
    messageLength: String(payload.body || '').length,
    severity: 'info',
  });
  await persist(store);
}

// In-memory cache for IP countries to prevent rate-limiting (ip-api.com limits to 45 req/min)
const ipCountryCache = new Map();

async function checkTrCountry(ip, cfCountryHeader) {
  const cleanIp = String(ip || '').trim().replace(/^::ffff:/, '');

  // 1. Cloudflare country header check (extremely fast and secure)
  if (cfCountryHeader) {
    const country = String(cfCountryHeader).trim().toUpperCase();
    if (country === 'TR' || country === 'XX') {
      return true;
    }
    return false;
  }
  
  // 2. local IPs are allowed for development
  if (
    !cleanIp ||
    cleanIp === '::1' ||
    cleanIp === '127.0.0.1' ||
    cleanIp === 'localhost' ||
    cleanIp.startsWith('192.168.') ||
    cleanIp.startsWith('10.') ||
    cleanIp.startsWith('172.16.') ||
    cleanIp.startsWith('172.17.') ||
    cleanIp.startsWith('172.18.') ||
    cleanIp.startsWith('172.19.') ||
    cleanIp.startsWith('172.20.') ||
    cleanIp.startsWith('172.21.') ||
    cleanIp.startsWith('172.22.') ||
    cleanIp.startsWith('172.23.') ||
    cleanIp.startsWith('172.24.') ||
    cleanIp.startsWith('172.25.') ||
    cleanIp.startsWith('172.26.') ||
    cleanIp.startsWith('172.27.') ||
    cleanIp.startsWith('172.28.') ||
    cleanIp.startsWith('172.29.') ||
    cleanIp.startsWith('172.30.') ||
    cleanIp.startsWith('172.31.')
  ) {
    return true;
  }

  // 3. Cache lookup
  if (ipCountryCache.has(cleanIp)) {
    return ipCountryCache.get(cleanIp);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    const res = await fetch(`http://ip-api.com/json/${cleanIp}?fields=status,countryCode`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.status === 'success') {
        const isTr = data.countryCode === 'TR';
        ipCountryCache.set(cleanIp, isTr);
        return isTr;
      }
    }
  } catch (error) {
    console.error('GeoIP check failed:', error);
  }
  return !isProduction;
}

async function requireAuth(req, res, next) {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Auth required' });
    }
    req.auth = verifyToken(token);

    // Security: enforce TR IP restriction for authenticated routes (admin/staff)
    const clientIp = (
      req.headers['cf-connecting-ip'] ||
      req.headers['x-forwarded-for'] ||
      req.ip ||
      req.socket.remoteAddress ||
      ''
    ).split(',')[0].trim();

    const isTr = await checkTrCountry(clientIp, req.headers['cf-ipcountry']);
    if (!isTr) {
      const store = await db();
      await addAudit(store, req.auth.email || 'unknown', 'Yabancı IP ile yetkisiz API isteği engellendi', {
        ip: clientIp,
        path: req.path,
      });
      await persist(store);
      return res.status(403).json({
        message: 'Giriş engellendi: Güvenlik politikaları gereği yönetim paneline yalnızca Türkiye sınırları içerisinden (TR IP) erişim sağlayabilirsiniz.'
      });
    }

    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    return next();
  };
}

function requirePermission(...permissions) {
  return (req, res, next) => {
    if (req.auth.role === 'superadmin') {
      return next();
    }
    const granted = Array.isArray(req.auth.permissions) ? req.auth.permissions : [];
    const allowed = permissions.some((permission) => granted.includes(permission) || granted.includes('*'));
    if (!allowed) {
      return res.status(403).json({ message: 'Bu işlem için yetkiniz yok.' });
    }
    return next();
  };
}

function canManageWhatsAppConnection(req, connection) {
  if (req.auth.role === 'superadmin') {
    return true;
  }
  if (!connection?.ownerUserId) {
    return false;
  }
  return String(connection.ownerUserId) === String(req.auth.sub || '');
}

function requireWhatsAppConnectionOwner(connection, req, res) {
  if (canManageWhatsAppConnection(req, connection)) {
    return true;
  }
  res.status(403).json({ message: 'Bu WhatsApp bağlantısı için yetkiniz yok.' });
  return false;
}

async function getCurrentUser(req) {
  const store = await db();
  return store.users.find((user) => user.id === req.auth.sub);
}

app.get('/api/public/ip-check', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const clientIp = (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.ip ||
    req.socket.remoteAddress ||
    ''
  ).split(',')[0].trim();

  const isTr = await checkTrCountry(clientIp, req.headers['cf-ipcountry']);
  res.json({ isTr, country: req.headers['cf-ipcountry'] || 'Unknown' });
});

app.get('/api/health', async (_req, res) => {
  const store = await db();
  res.json({
    ok: true,
    users: store.users.length,
    customers: store.customers.length,
    messages: store.messages.length,
  });
});

async function startAdminLogin(req, res) {
  const { email, password, audience = 'portal' } = req.body || {};
  const turnstileToken = req.body?.turnstileToken || req.body?.['cf-turnstile-response'] || '';
  const store = await db();
  let turnstileResult;
  try {
    turnstileResult = await validateTurnstileToken(turnstileToken, req, store.siteSettings || {});
  } catch (error) {
    console.error('Turnstile login validation setup failed:', error.message);
    return res.status(500).json({ message: 'Turnstile doğrulama yapılandırması eksik.' });
  }
  if (!turnstileResult?.success) {
    console.warn('Turnstile login rejected', {
      host: req.headers.host || '',
      clientIp: getClientIp(req),
      errorCodes: turnstileResult?.['error-codes'] || [],
    });
    return res.status(400).json({
      message: 'Turnstile doğrulaması başarısız oldu. Lütfen tekrar deneyin.',
      errorCodes: turnstileResult?.['error-codes'] || [],
    });
  }
  if (isLoginLocked(req, email)) {
    await addAudit(store, email || 'unknown', 'Cok fazla hatali giris nedeniyle gecici kilit uygulandi', {
      ip: getClientIp(req),
    });
    await persist(store);
    return res.status(429).json({ message: 'Çok fazla hatalı deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin.' });
  }
  
  const clientIp = getClientIp(req);

  const isTr = await checkTrCountry(clientIp, req.headers['cf-ipcountry']);
  
  if (!isTr) {
    await addAudit(store, email || 'unknown', 'Yabancı ülkeden yönetim girişi engellendi', {
      ip: clientIp,
      userAgent: req.headers['user-agent'] || '',
    });
    await persist(store);
    return res.status(403).json({
      message: 'Giriş engellendi: Güvenlik politikaları gereği yönetim paneline yalnızca Türkiye sınırları içerisinden (TR IP) erişim sağlayabilirsiniz.'
    });
  }

  await ensureBootstrapSuperAdmin(store, email);
  const user = store.users.find((entry) => entry.email.toLowerCase() === String(email || '').toLowerCase());

  if (!user || !user.isActive) {
    registerLoginFailure(req, email);
    return res.status(401).json({ message: 'Kullanici bulunamadi veya pasif.' });
  }

  if (String(audience || '').toLowerCase() === 'admin' && user.role !== 'superadmin') {
    await addAudit(store, user.email, 'Yetkisiz yönetim giriş denemesi engellendi', {
      ip: clientIp,
      userAgent: req.headers['user-agent'] || '',
      audience: 'admin',
    });
    await persist(store);
    return res.status(403).json({ message: 'Bu panel yalnızca superadmin içindir.' });
  }

  let passwordOk = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!passwordOk && isBootstrapSuperAdminEmail(email) && String(password || '') === superAdminPassword) {
    user.passwordHash = await bcrypt.hash(String(password), 10);
    user.updatedAt = now();
    await addAudit(store, user.email, 'Superadmin sifresi canli veriyle yeniden senkronlandi', {
      ip: clientIp,
      source: 'bootstrap-login-repair',
    });
    await persist(store);
    passwordOk = true;
  }
  if (!passwordOk) {
    const attempt = registerLoginFailure(req, email);
    await addAudit(store, user.email, 'Hatali sifre denemesi', {
      ip: clientIp,
      count: attempt.count,
      lockedUntil: attempt.lockedUntil ? new Date(attempt.lockedUntil).toISOString() : '',
    });
    await persist(store);
    return res.status(401).json({ message: 'Sifre hatali.' });
  }

  if (allowPasswordOnlyLogin) {
    clearLoginFailures(req, email);
    await addAudit(store, user.email, 'E-posta kodu gecici olarak devre disi, sifre ve Turnstile ile giris verildi', {
      ip: clientIp,
      userAgent: req.headers['user-agent'] || '',
      audience: String(audience || 'portal'),
      severity: 'critical',
      fallback: 'password_turnstile_tr_ip_direct',
    });
    await persist(store);
    const token = signToken(user);
    res.setHeader('Set-Cookie', buildAuthCookie(token));
    return res.json({
      user: sanitizeUser(user),
      passwordOnlyLogin: true,
      message: 'E-posta kodu gecici olarak devre disi; sifre dogrulamasiyla giris acildi.',
    });
  }

  if (!user.email) {
    await addAudit(store, user.email, 'Giriş kodu gönderilemedi: e-posta eksik', {
      ip: clientIp,
    });
    await persist(store);
    return res.status(400).json({ message: 'Bu kullanıcı için e-posta adresi tanımlı değil.' });
  }

  const mailSettings = getServerMailSettings(store.siteSettings || {});
  if (!isMailConfigured(mailSettings)) {
    await addAudit(store, user.email, 'Giriş kodu gönderilemedi: mail ayarları eksik', {
      ip: clientIp,
      userAgent: req.headers['user-agent'] || '',
      mailSource: mailSettings.source || 'missing',
    });
    await persist(store);
    return res.status(503).json({ message: 'Mail ayarları eksik olduğu için giriş kodu gönderilemedi.' });
  }

  const code = generateLoginCode();
  const challenge = createLoginChallengeRecord(user, code, req);
  try {
    await sendAdminLoginCodeEmail(store, user, code, req);
  } catch (error) {
    loginChallenges.delete(challenge.id);
    if (allowLoginEmailFailureFallback) {
      clearLoginFailures(req, email);
      await addAudit(store, user.email, 'Giriş e-posta kodu gönderilemedi, güvenli geçici fallback ile giriş verildi', {
        ip: clientIp,
        userAgent: req.headers['user-agent'] || '',
        challengeId: challenge.id,
        deliveryId: error?.deliveryId || '',
        errorCode: error?.code || error?.name || 'mail_send_failed',
        errorMessage: String(error?.message || 'mail_send_failed'),
        severity: 'critical',
        fallback: 'password_turnstile_tr_ip',
      });
      await persist(store);
      const token = signToken(user);
      res.setHeader('Set-Cookie', buildAuthCookie(token));
      return res.json({
        user: sanitizeUser(user),
        mailFallback: true,
        message: 'Mail gönderimi geçici olarak başarısız oldu; güvenli fallback ile giriş açıldı.',
      });
    }
    await addAudit(store, user.email, 'Giriş kodu gönderimi başarısız', {
      ip: clientIp,
      userAgent: req.headers['user-agent'] || '',
      challengeId: challenge.id,
      deliveryId: error?.deliveryId || '',
      errorCode: error?.code || error?.name || 'mail_send_failed',
      errorMessage: String(error?.message || 'mail_send_failed'),
    });
    await persist(store);
    console.error('Admin login code delivery failed:', error?.message || error);
    return res.status(502).json({ message: 'Giriş kodu e-postası gönderilemedi. Lütfen birkaç dakika sonra tekrar deneyin.' });
  }
  clearLoginFailures(req, email);
  await addAudit(store, user.email, 'Giriş kodu oluşturuldu ve mail gönderildi', {
    ip: clientIp,
    userAgent: req.headers['user-agent'] || '',
    challengeId: challenge.id,
  });
  await persist(store);
  const payload = {
    challengeId: challenge.id,
    email: user.email,
    emailMasked: user.email.replace(/^(.{2}).*(@.*)$/, '$1***$2'),
    expiresInSeconds: loginCodeTtlSeconds,
    mailDeliveryPending: true,
    message: 'Giriş kodu gönderildi. Lütfen e-postadaki 6 haneli kodu girin.',
  };
  if (!isProduction && !user.email) {
    payload.devCode = code;
  }
  if (!isProduction && !store.siteSettings?.smtpHost) {
    payload.devCode = code;
  }
  return res.json(payload);
}

async function verifyAdminLogin(req, res) {
  const { challengeId, code, otp } = req.body || {};
  const nextCode = String(code || otp || '').replace(/\D/g, '').slice(0, 6);
  const challenge = getLoginChallenge(challengeId);
  if (!challenge) {
    return res.status(400).json({ message: 'Giriş kodu bulunamadı veya süresi doldu.' });
  }

  const store = await db();
  const user = store.users.find((entry) => entry.id === challenge.userId);
  if (!user || !user.isActive) {
    loginChallenges.delete(challenge.id);
    return res.status(401).json({ message: 'Kullanici bulunamadi veya pasif.' });
  }

  if (!nextCode || nextCode.length !== 6 || !verifyLoginChallengeCode(challenge, nextCode)) {
    challenge.attempts += 1;
    const attempt = registerLoginFailure(req, user.email);
    await addAudit(store, user.email, 'Hatali e-posta kodu denemesi', {
      ip: getClientIp(req),
      count: attempt.count,
      lockedUntil: attempt.lockedUntil ? new Date(attempt.lockedUntil).toISOString() : '',
      challengeId: challenge.id,
    });
    await persist(store);
    if (challenge.attempts >= 5) {
      loginChallenges.delete(challenge.id);
    }
    return res.status(401).json({ message: 'Doğrulama kodu geçersiz.' });
  }

  loginChallenges.delete(challenge.id);
  clearLoginFailures(req, user.email);
  await addAudit(store, user.email, 'Kullanici giris yapti', {
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || '',
    challengeId: challenge.id,
  });
  await persist(store);
  const token = signToken(user);
  res.setHeader('Set-Cookie', buildAuthCookie(token));
  res.json({ user: sanitizeUser(user) });
}

async function resendAdminLoginCode(req, res) {
  const { challengeId } = req.body || {};
  const challenge = getLoginChallenge(challengeId);
  if (!challenge) {
    return res.status(400).json({ message: 'Giriş kodu bulunamadı veya süresi doldu. Lütfen yeniden giriş başlatın.' });
  }

  const store = await db();
  const user = store.users.find((entry) => entry.id === challenge.userId);
  if (!user || !user.isActive) {
    loginChallenges.delete(challenge.id);
    return res.status(401).json({ message: 'Kullanici bulunamadi veya pasif.' });
  }

  const mailSettings = getServerMailSettings(store.siteSettings || {});
  if (!isMailConfigured(mailSettings)) {
    await addAudit(store, user.email, 'Giriş kodu tekrar gönderilemedi: mail ayarları eksik', {
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
      challengeId: challenge.id,
      mailSource: mailSettings.source || 'missing',
    });
    await persist(store);
    return res.status(503).json({ message: 'Mail ayarları eksik olduğu için giriş kodu gönderilemedi.' });
  }

  const code = generateLoginCode();
  resetLoginChallengeCode(challenge, code, req);
  try {
    await sendAdminLoginCodeEmail(store, user, code, req);
  } catch (error) {
    await addAudit(store, user.email, 'Giriş kodu tekrar gönderimi başarısız', {
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
      challengeId: challenge.id,
      deliveryId: error?.deliveryId || '',
      errorCode: error?.code || error?.name || 'mail_send_failed',
      errorMessage: String(error?.message || 'mail_send_failed'),
    });
    await persist(store);
    console.error('Admin login code resend delivery failed:', error?.message || error);
    return res.status(502).json({ message: 'Giriş kodu e-postası tekrar gönderilemedi. Lütfen birkaç dakika sonra yeniden deneyin.' });
  }

  await addAudit(store, user.email, 'Giriş kodu tekrar gönderildi', {
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || '',
    challengeId: challenge.id,
  });
  await persist(store);
  return res.json({
    challengeId: challenge.id,
    emailMasked: user.email.replace(/^(.{2}).*(@.*)$/, '$1***$2'),
    expiresInSeconds: loginCodeTtlSeconds,
    mailDeliveryPending: true,
    message: 'Giriş kodu tekrar gönderildi. Lütfen e-postanızı kontrol edin.',
  });
}

app.post('/api/auth/login', async (req, res) => {
  return startAdminLogin(req, res);
});

app.post('/api/auth/login/start', async (req, res) => {
  return startAdminLogin(req, res);
});

app.post('/api/auth/login/verify', async (req, res) => {
  return verifyAdminLogin(req, res);
});

app.post('/api/auth/login/resend', async (req, res) => {
  return resendAdminLoginCode(req, res);
});

app.post('/api/auth/logout', async (_req, res) => {
  res.setHeader('Set-Cookie', clearAuthCookie());
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    return res.status(404).json({ message: 'Kullanici bulunamadi.' });
  }
  return res.json({ user: sanitizeUser(user) });
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const store = await db();
  const user = store.users.find((entry) => entry.id === req.auth.sub);
  if (!user) {
    return res.status(404).json({ message: 'Kullanici bulunamadi.' });
  }

  const passwordOk = await bcrypt.compare(String(currentPassword || ''), user.passwordHash);
  if (!passwordOk) {
    return res.status(400).json({ message: 'Mevcut sifre hatali.' });
  }

  user.passwordHash = await bcrypt.hash(String(newPassword || ''), 10);
  user.updatedAt = now();
  await addAudit(store, user.email, 'Sifresini degistirdi');
  await persist(store);
  return res.json({ ok: true });
});

app.post('/api/auth/2fa/setup', requireAuth, async (req, res) => {
  const store = await db();
  const user = store.users.find((entry) => entry.id === req.auth.sub);
  if (!user) {
    return res.status(404).json({ message: 'Kullanici bulunamadi.' });
  }

  const secret = generateTwoFactorSecret(user.email);
  user.twoFactorSecret = secret.base32;
  user.twoFactorEnabled = false;
  user.updatedAt = now();
  await persist(store);

  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
  return res.json({
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url,
    qrDataUrl,
  });
});

app.post('/api/auth/2fa/verify', requireAuth, async (req, res) => {
  const { token } = req.body || {};
  const store = await db();
  const user = store.users.find((entry) => entry.id === req.auth.sub);
  if (!user?.twoFactorSecret) {
    return res.status(400).json({ message: 'Kurulum bulunamadi.' });
  }
  if (!verifyTotp(user.twoFactorSecret, String(token || ''))) {
    return res.status(400).json({ message: 'Kod gecersiz.' });
  }
  user.twoFactorEnabled = true;
  user.updatedAt = now();
  await addAudit(store, user.email, 'Google Authenticator etkinlestirdi');
  await persist(store);
  return res.json({ ok: true, user: sanitizeUser(user) });
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  const store = await db();
  const permissions = Array.isArray(req.auth.permissions) ? req.auth.permissions : [];
  const canSee = (permission) => req.auth.role === 'superadmin' || permissions.includes('*') || permissions.includes(permission);
  const visibleUsers = req.auth.role === 'superadmin'
    ? store.users.map(sanitizeUser)
    : [];
  const visibleWhatsAppConnections = req.auth.role === 'superadmin'
    ? store.whatsappConnections
    : store.whatsappConnections.filter((connection) => String(connection.ownerUserId || '') === String(req.auth.sub || ''));
  const includeAll = req.query.full === 'true';
  const listLimit = includeAll ? Number.MAX_SAFE_INTEGER : 100;

  res.json({
    siteSettings: req.auth.role === 'superadmin' ? maskPrivateSiteSettings(store.siteSettings) : filterPublicSiteSettings(store.siteSettings),
    users: visibleUsers,
    customers: canSee('customers') ? store.customers.slice(0, listLimit) : [],
    messages: canSee('messages') ? store.messages.slice(0, includeAll ? Number.MAX_SAFE_INTEGER : 150) : [],
    payments: canSee('payments') ? store.payments.slice(0, includeAll ? Number.MAX_SAFE_INTEGER : 100) : [],
    mailDeliveries: req.auth.role === 'superadmin' ? store.mailDeliveries.slice(0, includeAll ? Number.MAX_SAFE_INTEGER : 100) : [],
    customerVisits: canSee('customers') || canSee('messages') ? store.customerVisits.filter((visit) => !isInternalVisitCheck(visit)).slice(0, includeAll ? Number.MAX_SAFE_INTEGER : 120) : [],
    consentRecords: req.auth.role === 'superadmin' ? store.consentRecords : [],
    whatsappConnections: canSee('whatsapp') ? visibleWhatsAppConnections : [],
    auditLogs: req.auth.role === 'superadmin' ? store.auditLogs.slice(0, includeAll ? Number.MAX_SAFE_INTEGER : 80) : [],
    totals: {
      customers: canSee('customers') ? store.customers.length : 0,
      messages: canSee('messages') ? store.messages.length : 0,
      payments: canSee('payments') ? store.payments.length : 0,
      auditLogs: req.auth.role === 'superadmin' ? store.auditLogs.length : 0,
    },
  });
});

app.get('/api/site-settings/public', async (_req, res) => {
  if (publicSiteSettingsCache && publicSiteSettingsCache.expiresAt > Date.now()) {
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.setHeader('CDN-Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return res.json({ siteSettings: publicSiteSettingsCache.value });
  }
  const store = await db();
  const siteSettings = filterPublicSiteSettings(store.siteSettings);
  publicSiteSettingsCache = {
    value: siteSettings,
    expiresAt: Date.now() + 60_000,
  };
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.setHeader('CDN-Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return res.json({ siteSettings });
});

app.get('/api/site-settings/turnstile-status', requireAuth, requireRole('superadmin'), async (_req, res) => {
  const store = await db();
  const settings = store.siteSettings || {};
  const siteKeyConfigured = Boolean(String(settings.turnstileSiteKey || '').trim() || process.env.VITE_TURNSTILE_SITE_KEY);
  const secretKeyConfigured = Boolean(String(process.env.TURNSTILE_SECRET_KEY || '').trim());
  res.json({
    ok: true,
    siteKeyConfigured,
    secretKeyConfigured,
    remoteIpForwarding: String(process.env.TURNSTILE_SEND_REMOTE_IP || '').toLowerCase() === 'true',
    recommendation: siteKeyConfigured && secretKeyConfigured
      ? 'Turnstile canlı kullanım için hazır görünüyor.'
      : 'Site key ve secret key eşleşmesini kontrol edin.',
  });
});

app.get('/api/public/locations/catalog', async (_req, res) => {
  const store = await db();
  if (shouldAutoSyncLocationCatalog(store)) {
    try {
      await syncLocationCatalog(store, store.siteSettings.locationSourceUrl);
      await persist(store);
    } catch (error) {
      store.siteSettings = {
        ...store.siteSettings,
        locationLastSyncStatus: 'error',
        locationLastSyncError: String(error?.message || 'Senkron başarısız.'),
      };
      await persist(store);
    }
  }

  res.json({
    catalog: getNormalizedLocationCatalog(store),
    meta: getLocationCatalogMeta(store),
  });
});

app.put('/api/site-settings', requireAuth, requireRole('superadmin'), async (req, res) => {
  const store = await db();
  store.siteSettings = mergePrivateSiteSettings(store.siteSettings, req.body || {});
  publicSiteSettingsCache = null;
  await addAudit(store, req.auth.email, 'Site ayarlari guncellendi');
  await persist(store);
  res.json({ siteSettings: maskPrivateSiteSettings(store.siteSettings) });
});

app.post('/api/site-settings/location-sync', requireAuth, requireRole('superadmin'), async (req, res) => {
  const store = await db();
  const sourceUrl = String(req.body?.sourceUrl || store.siteSettings.locationSourceUrl || '').trim();
  if (!sourceUrl) {
    return res.status(400).json({ message: 'Kaynak URL gerekli.' });
  }

  try {
    const result = await syncLocationCatalog(store, sourceUrl);
    await addAudit(store, req.auth.email, 'Adres kataloğu senkronlandı');
    await persist(store);
    res.json({
      ok: true,
      catalog: result.catalog,
      meta: getLocationCatalogMeta(store),
    });
  } catch (error) {
    store.siteSettings = {
      ...store.siteSettings,
      locationSourceUrl: sourceUrl,
      locationLastSyncStatus: 'error',
      locationLastSyncError: String(error?.message || 'Senkron başarısız.'),
    };
    await addAudit(store, req.auth.email, 'Adres kataloğu senkronu başarısız');
    await persist(store);
    res.status(400).json({ message: String(error?.message || 'Senkron başarısız.') });
  }
});

app.post('/api/admin/iyzico/test-connection', requireAuth, requireRole('superadmin'), async (req, res) => {
  const store = await db();
  const diagnostics = getIyzicoDiagnostics(store.siteSettings || {}, req);
  const missing = [];
  if (!diagnostics.apiKeyConfigured) missing.push('apiKey');
  if (!diagnostics.secretConfigured) missing.push('secretKey');
  if (!diagnostics.callbackUrlConfigured) missing.push('callbackUrl');
  await addAudit(store, req.auth.email, 'iyzico bağlantı testi çalıştırıldı', {
    environment: diagnostics.environment,
    ok: missing.length === 0,
    missing,
  });
  await persist(store);
  if (missing.length) {
    return res.status(400).json({
      message: `iyzico ayarları eksik: ${missing.join(', ')}`,
      diagnostics,
      missing,
    });
  }
  return res.json({
    ok: true,
    message: 'iyzico bağlantı ayarları hazır görünüyor.',
    diagnostics,
  });
});

app.post('/api/admin/iyzico/test-checkout', requireAuth, requireRole('superadmin'), async (req, res) => {
  const store = await db();
  const diagnostics = getIyzicoDiagnostics(store.siteSettings || {}, req);
  const amount = normalizePaymentAmount(req.body?.amount || 1);
  const currency = normalizePaymentCurrency(req.body?.currency || 'TRY');
  const missing = [];
  if (!diagnostics.apiKeyConfigured) missing.push('apiKey');
  if (!diagnostics.secretConfigured) missing.push('secretKey');
  if (!diagnostics.callbackUrlConfigured) missing.push('callbackUrl');
  if (!amount) missing.push('amount');
  if (!currency) missing.push('currency');
  await addAudit(store, req.auth.email, 'iyzico checkout testi çalıştırıldı', {
    environment: diagnostics.environment,
    ok: missing.length === 0,
    missing,
    dryRun: true,
  });
  await persist(store);
  if (missing.length) {
    return res.status(400).json({
      message: `Checkout testi için eksik/hatalı alanlar: ${missing.join(', ')}`,
      diagnostics,
      missing,
    });
  }
  return res.json({
    ok: true,
    message: 'Checkout yapılandırması hazır. Bu test canlı ödeme oluşturmaz.',
    diagnostics,
    testRequest: {
      amount,
      currency,
      dryRun: true,
    },
  });
});

app.post('/api/admin/iyzico/live-test-checkout', requireAuth, requireRole('superadmin'), async (req, res) => {
  const store = await db();
  const settings = store.siteSettings || {};
  const diagnostics = getIyzicoDiagnostics(settings, req);
  const amount = normalizePaymentAmount(req.body?.amount || 1);
  const currency = normalizePaymentCurrency(req.body?.currency || 'TRY');
  const missing = [];
  if (!diagnostics.apiKeyConfigured) missing.push('apiKey');
  if (!diagnostics.secretConfigured) missing.push('secretKey');
  if (!diagnostics.callbackUrlConfigured) missing.push('callbackUrl');
  if (!amount) missing.push('amount');
  if (!currency) missing.push('currency');
  if (missing.length) {
    await addAudit(store, req.auth.email, 'iyzico 1 TL canlı test eksik ayar nedeniyle durduruldu', {
      environment: diagnostics.environment,
      missing,
      severity: 'warning',
      requestId: req.requestId,
    });
    await persist(store);
    return res.status(400).json({
      message: `1 TL canlı test için eksik/hatalı alanlar: ${missing.join(', ')}`,
      diagnostics,
      missing,
    });
  }

  const callbackUrl = resolvePaymentCallbackUrl(settings, req);
  if (!callbackUrl) {
    return res.status(400).json({ message: 'iyzico callback URL HTTPS olarak tanımlanmalı.', diagnostics });
  }

  const customerId = `iyzico-test-${Date.now()}`;
  const customer = {
    id: customerId,
    applicationId: `IYZICO-TEST-${Date.now()}`,
    name: 'OnlineSMMM iyzico Test',
    email: 'bilgi@onlinesmmm.com',
    phone: '+905546531581',
    province: 'Istanbul',
    district: 'Kadikoy',
    neighborhood: 'Merkez',
    addressDetail: 'OnlineSMMM iyzico 1 TL test islemi',
    address: 'OnlineSMMM iyzico 1 TL test islemi / Istanbul',
    companyType: 'iyzico test',
    paymentStatus: 'pending',
    source: 'admin-iyzico-live-test',
    isIyzicoTest: true,
    createdAt: now(),
    updatedAt: now(),
  };
  store.customers.unshift(customer);

  const iyzico = buildIyzicoClient(store);
  const orderId = buildIyzicoOrderId(customerId);
  const price = toIyzicoPrice(amount);
  const buyer = buildIyzicoBuyerFromLead(customer, customerId, getClientIp(req));
  const address = buildIyzicoAddress(customer, customer.name);
  const request = {
    locale: Iyzipay.LOCALE.TR,
    conversationId: customerId,
    price,
    paidPrice: price,
    currency: currency === 'USD' ? Iyzipay.CURRENCY.USD : Iyzipay.CURRENCY.TRY,
    basketId: orderId,
    paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
    callbackUrl,
    enabledInstallments: [1],
    buyer,
    shippingAddress: address,
    billingAddress: address,
    basketItems: [
      {
        id: customerId,
        name: 'OnlineSMMM iyzico 1 TL test urunu',
        category1: 'Test',
        category2: 'Payment Verification',
        itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
        price,
      },
    ],
  };

  let result;
  let err;
  try {
    ({ err, result } = await initializeIyzicoPayment(iyzico, request));
  } catch (error) {
    err = error;
  }

  if (err || !result || result.status !== 'success') {
    customer.paymentStatus = 'failed';
    customer.updatedAt = now();
    await addAudit(store, req.auth.email, 'iyzico 1 TL canlı test başlatılamadı', {
      customerId,
      orderId,
      environment: diagnostics.environment,
      severity: 'warning',
      requestId: req.requestId,
      errorCode: err?.code || err?.name || result?.errorCode || 'iyzico_live_test_initialize_failed',
      errorMessage: err?.message || result?.errorMessage || 'Ödeme başlatılamadı.',
    });
    await persist(store);
    return res.status(err?.message === 'iyzico_initialize_timeout' ? 504 : 400).json({
      message: err?.message || result?.errorMessage || '1 TL test ödemesi başlatılamadı.',
      diagnostics,
    });
  }

  await recordCompletedPayment(store, {
    customerId,
    amount,
    currency,
    orderId,
    paymentMethod: 'iyzico',
    description: 'iyzico 1 TL live test checkout initialized',
    paymentStatus: 'pending',
    providerToken: result.token || '',
    environment: getIyzicoEnvironment(settings),
    expectedAmount: amount,
    expectedCurrency: currency,
    ip: getClientIp(req),
  });
  await addAudit(store, req.auth.email, 'iyzico 1 TL canlı test ödeme sayfası oluşturuldu', {
    customerId,
    orderId,
    environment: diagnostics.environment,
    requestId: req.requestId,
    paymentToken: result.token || '',
  });
  await persist(store);
  return res.json({
    ok: true,
    message: '1 TL canlı test ödeme sayfası oluşturuldu. Açılan iyzico sayfasında test ödemesini tamamlayabilirsiniz.',
    diagnostics,
    customerId,
    orderId,
    paymentUrl: result.payWithIyzicoPageUrl || '',
    paymentPageUrl: result.payWithIyzicoPageUrl || '',
    token: result.token || '',
  });
});

app.post('/api/users', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { name, email, phone, password, role = 'staff', permissions = [] } = req.body || {};
  const store = await db();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPhone = sanitizePhone(phone);
  const normalizedPassword = String(password || '');
  const normalizedPermissions = Array.isArray(permissions) ? permissions : [];
  if (!name || !normalizedEmail || !normalizedPassword) {
    return res.status(400).json({ message: 'Ad, e-posta ve şifre zorunludur.' });
  }
  if (store.users.some((entry) => entry.email.toLowerCase() === normalizedEmail)) {
    return res.status(400).json({ message: 'Bu e-posta zaten kayitli.' });
  }
  if (normalizedPhone && store.users.some((entry) => sanitizePhone(entry.phone) === normalizedPhone)) {
    return res.status(400).json({ message: 'Bu telefon numarası zaten kayitli.' });
  }
  const passwordCheck = validatePasswordStrength(normalizedPassword);
  if (!passwordCheck.ok) {
    return res.status(400).json({ message: passwordCheck.message });
  }
  const user = {
    id: uuidv4(),
    name,
    email: normalizedEmail,
    phone: normalizedPhone,
    role,
    permissions: normalizedPermissions,
    whatsappConnectionId: '',
    passwordHash: await bcrypt.hash(normalizedPassword, 10),
    isActive: true,
    twoFactorEnabled: false,
    twoFactorSecret: '',
    createdAt: now(),
    updatedAt: now(),
  };
  store.users.push(user);
  await addAudit(store, req.auth.email, `Personel hesabi olusturdu: ${email}`);
  await persist(store);
  res.json({ user: sanitizeUser(user) });
});

app.put('/api/users/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const store = await db();
  const user = store.users.find((entry) => entry.id === req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'Kullanici bulunamadi.' });
  }
  const { password, ...rest } = req.body || {};
  if (password) {
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.ok) {
      return res.status(400).json({ message: passwordCheck.message });
    }
  }
  const previousActive = user.isActive !== false;
  const nextActive = rest.isActive !== undefined ? Boolean(rest.isActive) : previousActive;
  Object.assign(user, rest, { updatedAt: now() });
  if (password) {
    user.passwordHash = await bcrypt.hash(String(password), 10);
  }
  if (previousActive && !nextActive && user.whatsappConnectionId) {
    const connection = store.whatsappConnections.find((entry) => entry.id === user.whatsappConnectionId);
    if (connection) {
      connection.isActive = false;
      connection.status = 'disconnected';
      connection.qrDataUrl = '';
      connection.pairingCode = '';
      connection.lastError = '';
      connection.lastSyncedAt = now();
      connection.reconnectAttempts = 0;
      try {
        await withTimeout(disconnectWhatsAppClient(connection.id), operationTimeouts.whatsappMs, 'whatsapp_user_disable_timeout');
      } catch {}
    }
  }
  await addAudit(store, req.auth.email, `Kullanici guncellendi: ${user.email}`);
  await persist(store);
  res.json({ user: sanitizeUser(user) });
});

app.delete('/api/users/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const store = await db();
  const user = store.users.find((entry) => entry.id === req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'Kullanici bulunamadi.' });
  }
  if (user.whatsappConnectionId) {
    const connectionIndex = store.whatsappConnections.findIndex((entry) => entry.id === user.whatsappConnectionId);
    if (connectionIndex >= 0) {
      const [connection] = store.whatsappConnections.splice(connectionIndex, 1);
      await withTimeout(disconnectWhatsAppClient(connection.id), operationTimeouts.whatsappMs, 'whatsapp_user_delete_timeout');
    }
  }
  store.users = store.users.filter((entry) => entry.id !== req.params.id);
  await addAudit(store, req.auth.email, `Kullanici silindi: ${user.email}`);
  await persist(store);
  res.json({ ok: true });
});

app.put('/api/customers/:id', requireAuth, requirePermission('customers'), async (req, res) => {
  const store = await db();
  const customer = store.customers.find((entry) => entry.id === req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Musteri bulunamadi.' });
  }
  Object.assign(customer, req.body || {}, { updatedAt: now() });
  await addAudit(store, req.auth.email, `Musteri guncellendi: ${customer.name}`);
  await persist(store);
  res.json({ customer });
});

app.post('/api/customers/:id/archive', requireAuth, requirePermission('customers'), async (req, res) => {
  const store = await db();
  const customer = store.customers.find((entry) => entry.id === req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Musteri bulunamadi.' });
  }
  customer.archivedAt = now();
  customer.updatedAt = now();
  await addAudit(store, req.auth.email, `Musteri arşivlendi: ${customer.name}`);
  await persist(store);
  res.json({ customer });
});

app.post('/api/customers/:id/unarchive', requireAuth, requirePermission('customers'), async (req, res) => {
  const store = await db();
  const customer = store.customers.find((entry) => entry.id === req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Musteri bulunamadi.' });
  }
  customer.archivedAt = '';
  customer.updatedAt = now();
  await addAudit(store, req.auth.email, `Musteri arşivden çıkarıldı: ${customer.name}`);
  await persist(store);
  res.json({ customer });
});

app.delete('/api/customers/:id', requireAuth, requirePermission('customers'), async (req, res) => {
  const store = await db();
  const customerIndex = store.customers.findIndex((entry) => entry.id === req.params.id);
  if (customerIndex < 0) {
    return res.status(404).json({ message: 'Musteri bulunamadi.' });
  }
  const [customer] = store.customers.splice(customerIndex, 1);
  for (const document of customer.documents || []) {
    try {
      await unlink(path.join(getUploadsDir(), path.basename(document.path)));
    } catch {
      // keep deleting even if a file is missing
    }
  }
  await addAudit(store, req.auth.email, `Musteri silindi: ${customer.name}`);
  await persist(store);
  res.json({ ok: true });
});

app.post('/api/customers/:id/documents', requireAuth, requirePermission('documents'), upload.single('file'), async (req, res) => {
  const store = await db();
  const customer = store.customers.find((entry) => entry.id === req.params.id);
  if (!customer || !req.file) {
    return res.status(400).json({ message: 'Musteri veya dosya bulunamadi.' });
  }
  const uploadSafety = await validateUploadedFilesOrReject([req.file]);
  if (!uploadSafety.ok) {
    await addAudit(store, req.auth.email, 'Guvenli olmayan belge yukleme engellendi', {
      customerId: customer.id,
      fileName: uploadSafety.file?.originalname,
      mimeType: uploadSafety.file?.mimetype,
      reason: uploadSafety.reason,
      ip: getClientIp(req),
    });
    await persist(store);
    return res.status(400).json({ message: 'Dosya güvenlik kontrolünden geçemedi. PDF, JPG veya PNG dosyası yükleyin.' });
  }
  const applicationId = normalizeApplicationId(customer.applicationId || customer.id, 'APP');
  const stageId = normalizeStageId(req.body?.stageId || customer.stageId || customer.stage || 'stage-portal');
  const groupId = buildDocumentGroupId(customer.id, applicationId, stageId);
  customer.applicationId = customer.applicationId || applicationId;
  customer.leadId = customer.leadId || customer.id;
  customer.stageId = customer.stageId || stageId;
  const document = {
    id: uuidv4(),
    name: sanitizeDocumentName(req.file.originalname),
    path: `/uploads/${path.basename(req.file.path)}`,
    mimeType: req.file.mimetype,
    size: req.file.size,
    uploadedAt: now(),
    uploadedBy: req.auth.email,
    requestIp: req.ip,
    userAgent: req.headers['user-agent'] || '',
    downloadCount: 0,
    downloadHistory: [],
    customerId: customer.id,
    leadId: customer.leadId || customer.id,
    applicationId,
    stageId,
    groupId,
    groupLabel: `${customer.id} • ${applicationId} • ${stageId}`,
  };
  customer.documents.unshift(document);
  customer.updatedAt = now();

  if (store.siteSettings.whatsappRoutingEnabled && store.siteSettings.notifyDocuments) {
    await forwardWhatsAppNotifications(
      store,
      [
        'Müşteri belgesi portala eklendi',
        `Müşteri: ${customer.name || '-'}`,
        `Belge: ${document.name || '-'}`,
        `Başvuru No: ${customer.applicationId || customer.leadId || customer.id || '-'}`,
        `Atanan personel: ${customer.assignedUserName || customer.assignedUserEmail || '-'}`,
      ].join('\n'),
      { preferredUserIds: [customer.assignedUserId] },
    );
  }

  await addAudit(store, req.auth.email, `Belge yuklendi: ${customer.name} / ${document.name}`, {
    ip: req.ip,
    documentId: document.id,
    customerId: customer.id,
    applicationId,
    stageId,
    groupId,
  });
  await persist(store);
  res.json({ document, customer });
});

app.get('/api/customers/:customerId/documents/:documentId/download', requireAuth, requirePermission('documents'), async (req, res) => {
  const store = await db();
  const customer = store.customers.find((entry) => entry.id === req.params.customerId);
  if (!customer) {
    return res.status(404).json({ message: 'Musteri bulunamadi.' });
  }

  const document = customer.documents.find((entry) => entry.id === req.params.documentId);
  if (!document) {
    return res.status(404).json({ message: 'Belge bulunamadi.' });
  }

  const filename = path.basename(document.path);
  const diskPath = path.join(getUploadsDir(), filename);
  if (!existsSync(diskPath)) {
    return res.status(404).json({ message: 'Dosya sunucuda bulunamadi.' });
  }

  document.downloadCount = (document.downloadCount || 0) + 1;
  document.downloadHistory = [
    {
      id: uuidv4(),
      actor: req.auth.email,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || '',
      downloadedAt: now(),
    },
    ...(document.downloadHistory || []),
  ].slice(0, 20);

  await addAudit(store, req.auth.email, `Belge indirildi: ${customer.name} / ${document.name}`, {
    ip: req.ip,
    documentId: document.id,
    customerId: customer.id,
  });
  await persist(store);

  return res.download(diskPath, document.name, (downloadError) => {
    if (downloadError) {
      console.error('Download error:', downloadError);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Dosya indirilemedi.' });
      }
    }
  });
});

app.get('/api/customers/:customerId/documents/:documentId/view', requireAuth, requirePermission('documents'), async (req, res) => {
  const store = await db();
  const customer = store.customers.find((entry) => entry.id === req.params.customerId);
  if (!customer) {
    return res.status(404).json({ message: 'Musteri bulunamadi.' });
  }

  const document = customer.documents.find((entry) => entry.id === req.params.documentId);
  if (!document) {
    return res.status(404).json({ message: 'Belge bulunamadi.' });
  }

  const filename = path.basename(document.path);
  const diskPath = path.join(getUploadsDir(), filename);
  if (!existsSync(diskPath)) {
    return res.status(404).json({ message: 'Dosya sunucuda bulunamadi.' });
  }

  await addAudit(store, req.auth.email, `Belge goruntulendi: ${customer.name} / ${document.name}`, {
    ip: req.ip,
    documentId: document.id,
    customerId: customer.id,
  });
  await persist(store);

  res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${sanitizeDocumentName(document.name || filename)}"`);
  return res.sendFile(diskPath, (viewError) => {
    if (viewError) {
      console.error('View document error:', viewError);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Dosya açılamadı.' });
      }
    }
  });
});

app.delete('/api/customers/:customerId/documents/:documentId', requireAuth, requirePermission('documents'), async (req, res) => {
  const store = await db();
  const customer = store.customers.find((entry) => entry.id === req.params.customerId);
  if (!customer) {
    return res.status(404).json({ message: 'Musteri bulunamadi.' });
  }

  const documentIndex = customer.documents.findIndex((entry) => entry.id === req.params.documentId);
  if (documentIndex < 0) {
    return res.status(404).json({ message: 'Belge bulunamadi.' });
  }

  const [document] = customer.documents.splice(documentIndex, 1);
  customer.updatedAt = now();
  const diskPath = path.join(getUploadsDir(), path.basename(document.path));
  try {
    await unlink(diskPath);
  } catch {
    // Missing files are tolerated; the record is still removed from the store.
  }

  await addAudit(store, req.auth.email, `Belge silindi: ${customer.name} / ${document.name}`);
  await persist(store);
  res.json({ ok: true });
});

app.post('/api/messages', requireAuth, requirePermission('messages'), async (req, res) => {
  const { customerId, channel = 'portal', body, direction = 'outbound' } = req.body || {};
  const store = await db();
  const message = {
    id: uuidv4(),
    customerId,
    channel,
    body,
    direction,
    actor: req.auth.email,
    archivedAt: '',
    createdAt: now(),
    whatsappForwardedTo: [],
  };
  store.messages.unshift(message);
  const targetCustomer = store.customers.find((entry) => entry.id === customerId);
  if (channel === 'whatsapp' && targetCustomer?.phone) {
    for (const connection of store.whatsappConnections.filter((entry) => entry.isActive)) {
      const runtime = getConnectionRuntime(connection.id);
      if (runtime?.status === 'ready') {
        try {
          await withTimeout(sendWhatsAppMessage(connection.id, targetCustomer.phone, body), operationTimeouts.whatsappMs, 'whatsapp_send_timeout');
        } catch (error) {
          message.whatsappForwardedTo.push(`FAILED:${connection.label || connection.phone}:${error.message}`);
        }
      }
    }
  } else if (store.siteSettings.whatsappRoutingEnabled && ['portal', 'payment', 'documents'].includes(channel)) {
    message.whatsappForwardedTo = await forwardWhatsAppNotifications(
      store,
      [
        'Portal mesaj kaydı',
        `Kanal: ${channel}`,
        `Müşteri: ${targetCustomer?.name || '-'}`,
        `Telefon: ${targetCustomer?.phone || '-'}`,
        `Mesaj: ${body || '-'}`,
      ].join('\n'),
      { preferredUserIds: [targetCustomer?.assignedUserId] },
    );
  }
  await addAudit(store, req.auth.email, `Mesaj olusturuldu: ${channel}`);
  await persist(store);
  res.json({ message });
});

app.post('/api/messages/:id/archive', requireAuth, requirePermission('messages'), async (req, res) => {
  const store = await db();
  const message = store.messages.find((entry) => entry.id === req.params.id);
  if (!message) {
    return res.status(404).json({ message: 'Mesaj bulunamadi.' });
  }
  message.archivedAt = now();
  await addAudit(store, req.auth.email, `Mesaj arşivlendi: ${message.id}`);
  await persist(store);
  res.json({ message });
});

app.post('/api/messages/:id/unarchive', requireAuth, requirePermission('messages'), async (req, res) => {
  const store = await db();
  const message = store.messages.find((entry) => entry.id === req.params.id);
  if (!message) {
    return res.status(404).json({ message: 'Mesaj bulunamadi.' });
  }
  message.archivedAt = '';
  await addAudit(store, req.auth.email, `Mesaj arşivden çıkarıldı: ${message.id}`);
  await persist(store);
  res.json({ message });
});

app.delete('/api/messages/:id', requireAuth, requirePermission('messages'), async (req, res) => {
  const store = await db();
  const messageIndex = store.messages.findIndex((entry) => entry.id === req.params.id);
  if (messageIndex < 0) {
    return res.status(404).json({ message: 'Mesaj bulunamadi.' });
  }
  const [message] = store.messages.splice(messageIndex, 1);
  await addAudit(store, req.auth.email, `Mesaj silindi: ${message.id}`);
  await persist(store);
  res.json({ ok: true });
});

app.get('/api/admin/whatsapp/preflight', requireAuth, requirePermission('whatsapp'), async (req, res) => {
  const store = await db();
  const preflight = await getWhatsAppPreflightStatus();
  await addAudit(store, req.auth.email, 'WhatsApp ön kontrol çalıştırıldı', {
    ok: preflight.ok,
    chromeFound: preflight.chromeFound,
    chromeExecutable: preflight.chromeExecutable,
    missingLibraries: preflight.missingLibraries,
    sessionWritable: preflight.sessionWritable,
    cwdOk: preflight.cwdOk,
    severity: preflight.ok ? 'info' : 'warning',
  });
  await persist(store);
  res.status(preflight.ok ? 200 : 503).json({
    message: preflight.ok ? 'WhatsApp ön kontrol başarılı.' : (preflight.hints[0] || 'WhatsApp ön kontrolünde eksik var.'),
    preflight,
  });
});

app.post('/api/whatsapp-connections', requireAuth, requirePermission('whatsapp'), async (req, res) => {
  const { method, label, phone, ownerUserId, ownerEmail, source } = req.body || {};
  const connectionMethod = method === 'phone' ? 'phone' : 'qr';
  const normalizedPhone = sanitizePhone(phone);
  const store = await db();
  if (connectionMethod === 'phone' && normalizedPhone.length < 10) {
    return res.status(400).json({ message: 'Telefon numarasini ulke koduyla birlikte girin.' });
  }
  if (normalizedPhone) {
    const duplicate = findWhatsAppConnectionConflict(store.whatsappConnections, { phone: normalizedPhone });
    if (duplicate) {
      return res.status(409).json({ message: 'Bu telefon numarasi icin zaten bir WhatsApp baglantisi var.' });
    }
  }
  const effectiveOwnerUserId = req.auth.role === 'superadmin'
    ? String(ownerUserId || req.auth.sub || '')
    : String(req.auth.sub || '');
  const ownerUser = store.users.find((entry) => entry.id === effectiveOwnerUserId);
  if (effectiveOwnerUserId) {
    const duplicateOwner = findWhatsAppOwnerConflict(store.whatsappConnections, effectiveOwnerUserId);
    if (duplicateOwner) {
      return res.status(409).json({ message: 'Bu kullanıcı için zaten bir WhatsApp bağlantısı var.' });
    }
  }
  const connection = {
    id: uuidv4(),
    method: connectionMethod,
    label: String(label || '').trim(),
    phone: normalizedPhone,
    ownerUserId: effectiveOwnerUserId,
    ownerEmail: req.auth.role === 'superadmin'
      ? String(ownerEmail || ownerUser?.email || '')
      : String(req.auth.email || ownerUser?.email || ''),
    source: req.auth.role === 'superadmin' ? String(source || '') : 'assigned-user',
    qrCodeToken: '',
    qrDataUrl: '',
    pairingCode: '',
    isActive: req.body?.isActive !== false,
    autoReconnect: req.body?.autoReconnect !== false,
    status: 'disconnected',
    sessionPhone: '',
    lastError: '',
    lastSyncedAt: now(),
    reconnectAttempts: 0,
    lastHeartbeatAt: '',
    createdAt: now(),
  };
  store.whatsappConnections.unshift(connection);
  if (connection.ownerUserId) {
    const owner = store.users.find((entry) => entry.id === connection.ownerUserId);
    if (owner) {
      owner.whatsappConnectionId = connection.id;
      owner.phone = owner.phone || normalizedPhone;
      owner.updatedAt = now();
    }
  }
  await addAudit(store, req.auth.email, `WhatsApp baglantisi eklendi: ${label || phone}`);
  await persist(store);
  res.json({ connection });
});

app.put('/api/whatsapp-connections/:id', requireAuth, requirePermission('whatsapp'), async (req, res) => {
  const store = await db();
  const connection = store.whatsappConnections.find((entry) => entry.id === req.params.id);
  if (!connection) {
    return res.status(404).json({ message: 'Baglanti bulunamadi.' });
  }
  if (!requireWhatsAppConnectionOwner(connection, req, res)) return;
  const nextBody = { ...(req.body || {}) };
  if (req.auth.role !== 'superadmin') {
    delete nextBody.ownerUserId;
    delete nextBody.ownerEmail;
    delete nextBody.source;
  }
  const nextPhone = sanitizePhone(nextBody.phone ?? connection.phone);
  if (nextBody.method === 'phone' && nextPhone.length < 10) {
    return res.status(400).json({ message: 'Telefon numarasini ulke koduyla birlikte girin.' });
  }
  if (nextPhone) {
    const duplicate = findWhatsAppConnectionConflict(store.whatsappConnections, { ...connection, phone: nextPhone });
    if (duplicate) {
      return res.status(409).json({ message: 'Bu telefon numarasi icin zaten bir WhatsApp baglantisi var.' });
    }
  }
  const nextOwnerUserId = req.auth.role === 'superadmin'
    ? String(nextBody.ownerUserId ?? connection.ownerUserId ?? '')
    : String(connection.ownerUserId || req.auth.sub || '');
  const duplicateOwner = findWhatsAppOwnerConflict(store.whatsappConnections, nextOwnerUserId, connection.id);
  if (duplicateOwner) {
    return res.status(409).json({ message: 'Bu kullanıcı için zaten bir WhatsApp bağlantısı var.' });
  }
  Object.assign(connection, nextBody, {
    phone: nextPhone,
    method: nextBody.method ? (nextBody.method === 'phone' ? 'phone' : 'qr') : connection.method,
    ownerUserId: nextOwnerUserId,
  });
  await addAudit(store, req.auth.email, `WhatsApp baglantisi guncellendi: ${connection.id}`);
  await persist(store);
  res.json({ connection });
});

app.post('/api/whatsapp-connections/:id/reset', requireAuth, requirePermission('whatsapp'), async (req, res) => {
  const store = await db();
  const connection = store.whatsappConnections.find((entry) => entry.id === req.params.id);
  if (!connection) {
    return res.status(404).json({ message: 'Baglanti bulunamadi.' });
  }
  if (!requireWhatsAppConnectionOwner(connection, req, res)) return;
  const startedAt = performance.now();
  await withTimeout(resetWhatsAppSession(connection.id), operationTimeouts.whatsappMs, 'whatsapp_session_reset_timeout');
  Object.assign(connection, {
    isActive: false,
    autoReconnect: false,
    status: 'disconnected',
    qrDataUrl: '',
    pairingCode: '',
    lastError: '',
    lastSyncedAt: now(),
    reconnectAttempts: 0,
    lastHeartbeatAt: '',
  });
  emitStructuredLog('whatsapp_state', {
    requestId: req.requestId,
    connectionId: connection.id,
    connectionLabel: connection.label || '',
    outcome: 'session_reset',
    durationMs: observeDuration(startedAt),
    userId: req.auth?.sub || '',
    userEmail: req.auth?.email || '',
    sessionId: getSessionContextFromRequest(req),
  }, 'warn');
  await addAudit(store, req.auth.email, `WhatsApp session temizlendi: ${connection.label || connection.phone || connection.id}`, {
    connectionId: connection.id,
    severity: 'warning',
  });
  await persist(store);
  res.json({ connection });
});

app.post('/api/whatsapp-connections/:id/start', requireAuth, requirePermission('whatsapp'), async (req, res) => {
  const store = await db();
  const connection = store.whatsappConnections.find((entry) => entry.id === req.params.id);
  if (!connection) {
    return res.status(404).json({ message: 'Baglanti bulunamadi.' });
  }
  if (!requireWhatsAppConnectionOwner(connection, req, res)) return;
  const preflight = await getWhatsAppPreflightStatus();
  if (!preflight.ok) {
    const message = preflight.hints?.[0] || 'WhatsApp ön kontrolünde eksik var.';
    await addAudit(store, req.auth.email, `WhatsApp oturumu başlatılamadı: ön kontrol başarısız`, {
      connectionId: connection.id,
      connectionLabel: connection.label || connection.phone || '',
      severity: 'critical',
      hints: preflight.hints || [],
    }, 'critical');
    await persist(store);
    return res.status(503).json({ message, preflight });
  }
  const startedAt = performance.now();
  if (connection.method === 'phone' && sanitizePhone(connection.phone).length < 10) {
    return res.status(400).json({ message: 'Kod istemek icin ulke koduyla telefon numarasi gerekli.' });
  }
  const duplicate = findWhatsAppConnectionConflict(store.whatsappConnections, connection);
  if (duplicate) {
    return res.status(409).json({ message: 'Bu telefon numarasi baska bir WhatsApp oturumunda aktif. Once eski oturumu durdurun veya silin.' });
  }
  Object.assign(connection, {
    isActive: true,
    autoReconnect: true,
    status: 'qr',
    qrDataUrl: '',
    pairingCode: '',
    lastError: '',
    lastSyncedAt: now(),
    reconnectAttempts: 0,
    lastHeartbeatAt: '',
  });
  let runtime;
  try {
    runtime = await withTimeout(
      ensureWhatsAppClient(connection, persistWhatsAppState, handleInboundWhatsApp),
      operationTimeouts.whatsappMs,
      'whatsapp_start_timeout',
    );
  } catch (error) {
    const errorMessage = String(error?.message || 'WhatsApp bağlantısı başlatılamadı.');
    Object.assign(connection, {
      status: 'failed',
      qrDataUrl: '',
      pairingCode: '',
      lastError: errorMessage,
      lastSyncedAt: now(),
    });
    const durationMs = observeDuration(startedAt);
    emitStructuredLog('whatsapp_state', {
      requestId: req.requestId,
      connectionId: connection.id,
      connectionLabel: connection.label || '',
      outcome: 'start_failed',
      durationMs,
      userId: req.auth?.sub || '',
      userEmail: req.auth?.email || '',
      sessionId: getSessionContextFromRequest(req),
      errorCode: error?.code || error?.name || 'whatsapp_start_failed',
      errorMessage,
    }, 'error');
    await addAudit(store, req.auth.email, `WhatsApp oturumu başlatılamadı: ${connection.label || connection.phone}`, {
      connectionId: connection.id,
      errorCode: error?.code || error?.name || 'whatsapp_start_failed',
      errorMessage,
      severity: 'critical',
    }, 'critical');
    await persist(store);
    return res.status(error?.code === 'whatsapp_start_timeout' ? 504 : 503).json({ message: errorMessage, connection });
  }
  const durationMs = observeDuration(startedAt);
  emitStructuredLog('whatsapp_state', {
    requestId: req.requestId,
    connectionId: connection.id,
    connectionLabel: connection.label || '',
    outcome: 'started',
    durationMs,
    userId: req.auth?.sub || '',
    userEmail: req.auth?.email || '',
    sessionId: getSessionContextFromRequest(req),
    status: runtime?.status || connection.status || '',
  }, 'info');
  await addAudit(store, req.auth.email, `WhatsApp QR/oturum baslatildi: ${connection.label || connection.phone}`);
  await persist(store);
  res.json({ connection: { ...connection, ...runtime } });
});

app.post('/api/whatsapp-connections/:id/stop', requireAuth, requirePermission('whatsapp'), async (req, res) => {
  const store = await db();
  const connection = store.whatsappConnections.find((entry) => entry.id === req.params.id);
  if (!connection) {
    return res.status(404).json({ message: 'Baglanti bulunamadi.' });
  }
  if (!requireWhatsAppConnectionOwner(connection, req, res)) return;
  const startedAt = performance.now();
  await withTimeout(disconnectWhatsAppClient(connection.id), operationTimeouts.whatsappMs, 'whatsapp_stop_timeout');
  Object.assign(connection, {
    isActive: false,
    autoReconnect: false,
    status: 'disconnected',
    qrDataUrl: '',
    pairingCode: '',
    lastError: '',
    lastSyncedAt: now(),
  });
  const durationMs = observeDuration(startedAt);
  emitStructuredLog('whatsapp_state', {
    requestId: req.requestId,
    connectionId: connection.id,
    connectionLabel: connection.label || '',
    outcome: 'stopped',
    durationMs,
    userId: req.auth?.sub || '',
    userEmail: req.auth?.email || '',
    sessionId: getSessionContextFromRequest(req),
    status: connection.status || 'stopped',
  }, 'info');
  await addAudit(store, req.auth.email, `WhatsApp oturumu durduruldu: ${connection.label || connection.phone}`);
  await persist(store);
  res.json({ connection });
});

app.delete('/api/whatsapp-connections/:id', requireAuth, requirePermission('whatsapp'), async (req, res) => {
  const store = await db();
  const connectionIndex = store.whatsappConnections.findIndex((entry) => entry.id === req.params.id);
  if (connectionIndex < 0) {
    return res.status(404).json({ message: 'Baglanti bulunamadi.' });
  }
  const startedAt = performance.now();
  const connection = store.whatsappConnections[connectionIndex];
  if (!requireWhatsAppConnectionOwner(connection, req, res)) return;
  store.whatsappConnections.splice(connectionIndex, 1);
  await withTimeout(disconnectWhatsAppClient(connection.id), operationTimeouts.whatsappMs, 'whatsapp_delete_timeout');
  for (const user of store.users) {
    if (user.whatsappConnectionId === connection.id) {
      user.whatsappConnectionId = '';
      user.updatedAt = now();
    }
  }
  const durationMs = observeDuration(startedAt);
  emitStructuredLog('whatsapp_state', {
    requestId: req.requestId,
    connectionId: connection.id,
    connectionLabel: connection.label || '',
    outcome: 'deleted',
    durationMs,
    userId: req.auth?.sub || '',
    userEmail: req.auth?.email || '',
    sessionId: getSessionContextFromRequest(req),
  }, 'info');
  await addAudit(store, req.auth.email, `WhatsApp baglantisi silindi: ${connection.label || connection.phone || connection.id}`);
  await persist(store);
  res.json({ ok: true });
});

app.post('/api/public/visit-events', async (req, res) => {
  const event = sanitizeVisitEvent(req.body || {});
  if (!event.sessionId || !event.visitorId) {
    return res.status(400).json({ message: 'Oturum bilgisi eksik.' });
  }
  if (isInternalVisitCheck(event)) {
    return res.json({ ok: true });
  }

  const store = await db();
  if (store.siteSettings?.customerVisitTrackingEnabled === false) {
    return res.json({ ok: true, trackingDisabled: true });
  }
  const clientIp = getClientIp(req);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
  const country = String(req.headers['cf-ipcountry'] || '').slice(0, 8);
  const timestamp = now();

  let visit = store.customerVisits.find((entry) => entry.sessionId === event.sessionId);
  let isNewVisit = false;
  if (!visit) {
    isNewVisit = true;
    visit = {
      id: uuidv4(),
      sessionId: event.sessionId,
      visitorId: event.visitorId,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      durationSeconds: 0,
      pageViews: 0,
      clickCount: 0,
      whatsappClicked: false,
      whatsappClickCount: 0,
      phoneClicked: false,
      ctaClicks: [],
      paths: [],
      referrer: event.referrer,
      source: event.source,
      locale: event.locale,
      deviceType: event.deviceType,
      screen: event.screen,
      viewport: event.viewport,
      ip: clientIp,
      country,
      userAgent,
      lead: null,
      lastAction: '',
      events: [],
    };
    store.customerVisits.unshift(visit);
  }

  visit.lastSeenAt = timestamp;
  visit.durationSeconds = Math.max(Number(visit.durationSeconds || 0), event.durationSeconds);
  visit.locale = event.locale || visit.locale;
  visit.deviceType = event.deviceType || visit.deviceType;
  visit.viewport = event.viewport || visit.viewport;
  visit.screen = event.screen || visit.screen;
  visit.ip = clientIp || visit.ip;
  visit.country = country || visit.country;
  visit.userAgent = userAgent || visit.userAgent;
  visit.referrer = visit.referrer || event.referrer;
  visit.source = visit.source || event.source;

  if (event.path && !visit.paths.includes(event.path)) {
    visit.paths.push(event.path);
    visit.paths = visit.paths.slice(-12);
  }
  if (event.eventType === 'page_view') {
    visit.pageViews = Number(visit.pageViews || 0) + 1;
  }
  if (event.eventType === 'click') {
    visit.clickCount = Number(visit.clickCount || 0) + 1;
    visit.lastAction = event.label || event.target || 'Tıklama';
    if (event.target === 'whatsapp' || /wa\.me|whatsapp/i.test(event.href)) {
      visit.whatsappClicked = true;
      visit.whatsappClickCount = Number(visit.whatsappClickCount || 0) + 1;
    }
    if (event.target === 'phone' || /^tel:/i.test(event.href)) {
      visit.phoneClicked = true;
    }
    if (event.target === 'form_start' || /#start|#contact/i.test(event.href)) {
      visit.formStarted = true;
    }
    if (event.target === 'cta' || event.target === 'whatsapp') {
      visit.ctaClicks.unshift({
        label: event.label,
        target: event.target,
        href: event.href,
        at: timestamp,
      });
      visit.ctaClicks = visit.ctaClicks.slice(0, 12);
    }
  }
  if (event.eventType === 'lead_submit' && event.lead) {
    visit.lead = event.lead;
    visit.formSubmitted = true;
    visit.lastAction = 'Lead formu gönderildi';
  }
  visit.formAbandoned = Boolean(visit.formStarted && !visit.formSubmitted);
  visit.leadTemperature =
    visit.formSubmitted || (visit.whatsappClicked && Number(visit.durationSeconds || 0) >= 30)
      ? 'hot'
      : visit.whatsappClicked || Number(visit.durationSeconds || 0) >= 30 || visit.formStarted
        ? 'warm'
        : 'cold';

  visit.events.unshift({
    type: event.eventType,
    path: event.path,
    target: event.target,
    label: event.label,
    durationSeconds: event.durationSeconds,
    at: timestamp,
  });
  visit.events = visit.events.slice(0, 30);
  store.customerVisits = store.customerVisits.slice(0, 1000);

  if (isNewVisit && event.eventType === 'page_view' && !visit.entryNotificationSentAt) {
    const entryBody = buildSiteEntryNotificationMessage(visit);
    const entryResult = await sendOperationalNotification(store, {
      key: `site-entry:${visit.sessionId}`,
      type: 'site_entry',
      subject: 'OnlineSMMM site girişi tespit edildi',
      body: entryBody,
      context: {
        actor: 'website',
        requestId: req.requestId,
        sessionId: visit.sessionId,
        visitorId: visit.visitorId,
        ip: clientIp,
        country,
        path: event.path,
      },
    });
    visit.entryNotificationSentAt = now();
    visit.entryNotificationStatus = entryResult.duplicate ? 'duplicate_skipped' : 'sent';
    visit.entryWhatsappForwardedTo = entryResult.whatsappForwardedTo || [];
    visit.entryEmailDeliveryId = entryResult.email?.deliveryId || '';
  }

  await persist(store);
  res.json({ ok: true });
});

app.post('/api/public/consent-events', async (req, res) => {
  const body = req.body || {};
  const store = await db();
  const record = {
    id: uuidv4(),
    sessionId: String(body.sessionId || '').slice(0, 80),
    visitorId: String(body.visitorId || '').slice(0, 80),
    status: ['accepted', 'rejected', 'custom'].includes(body.status) ? body.status : 'custom',
    preferences: {
      necessary: true,
      analytics: Boolean(body.preferences?.analytics),
      marketing: Boolean(body.preferences?.marketing),
    },
    path: String(body.path || '').slice(0, 220),
    locale: String(body.locale || '').slice(0, 12),
    ip: getClientIp(req),
    country: String(req.headers['cf-ipcountry'] || '').slice(0, 8),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    createdAt: now(),
  };
  store.consentRecords.unshift(record);
  store.consentRecords = store.consentRecords.slice(0, 2000);
  await persist(store);
  res.json({ ok: true });
});

app.post('/api/public/application-package', createRateLimiter('leadProgress'), upload.array('documents', 8), async (req, res) => {
  const store = await db();
  const files = req.files || [];
  const uploadSafety = await validateUploadedFilesOrReject(files);
  if (!uploadSafety.ok) {
    await addAudit(store, 'website', 'Guvenli olmayan başvuru paketi belge yükleme engellendi', {
      fileName: uploadSafety.file?.originalname || '',
      mimeType: uploadSafety.file?.mimetype || '',
      reason: uploadSafety.reason,
      ip: getClientIp(req),
      severity: 'critical',
    });
    await persist(store);
    return res.status(400).json({ message: 'Dosya güvenlik kontrolünden geçemedi. PDF, JPG veya PNG dosyası yükleyin.' });
  }

  const applicationId = normalizeApplicationId(req.body.applicationId, 'APP');
  const stageId = normalizeStageId(req.body.stage || '7');
  const sessionId = String(req.body.sessionId || '').slice(0, 80);
  const visitorId = String(req.body.visitorId || '').slice(0, 80);
  const snapshot = normalizeLeadProgressPayload({
    step: Number(req.body.step || 7) || 7,
    applicationId,
    source: req.body.source || 'application-package',
    selectedCompanyType: req.body.companyTypeId || '',
    selectedCompanyTypeLabel: req.body.companyType || req.body.companyTypeLabel || '',
    activity: {
      mainActivity: req.body.activityMain || '',
      subActivity: req.body.activitySub || '',
      revenueMethod: req.body.revenueMethod || '',
      salesChannel: req.body.salesChannel || '',
    },
    lead: {
      name: req.body.name || '',
      phone: req.body.phone || '',
      email: req.body.email || '',
      companyName: req.body.companyName || '',
      tcId: req.body.tckn || req.body.tcId || '',
      address: req.body.address || '',
      province: req.body.province || '',
      district: req.body.district || '',
      neighborhood: req.body.neighborhood || '',
      addressDetail: req.body.addressDetail || '',
    },
    files: files.map((file) => sanitizeDocumentName(file.originalname || '')),
    estimate: req.body.estimate || '',
    paymentReady: true,
    stepSummary: req.body.stepSummary || 'Başvuru paketi tamamlandı',
    progress: { currentStep: 7, nextStep: 8, ratio: 8 / 9, label: 'Ödeme' },
  });
  snapshot.signature = buildLeadProgressSignature(snapshot);
  snapshot.createdAt = now();

  const customer = upsertLeadProgressCustomer(store, snapshot, {
    sessionId,
    visitorId,
    source: req.body.source || 'application-package',
    applicationId,
  });
  if (!customer) {
    await cleanupUploadedFiles(files);
    return res.status(400).json({ message: 'Başvuru paketi için müşteri bilgisi eksik.' });
  }

  customer.membershipStatus = 'Başvuru paketi alındı';
  customer.paymentStatus = customer.paymentStatus === 'completed' ? 'completed' : 'payment_pending';
  customer.packageSubmittedAt = customer.packageSubmittedAt || now();
  customer.stage = 7;
  customer.stageId = stageId;
  customer.stageLabel = 'Özet';
  customer.documents = Array.isArray(customer.documents) ? customer.documents : [];

  const addedDocuments = [];
  for (const file of files) {
    const safeName = sanitizeDocumentName(file.originalname);
    const alreadyExists = customer.documents.some((document) =>
      document.applicationId === applicationId &&
      document.stageId === stageId &&
      document.name === safeName &&
      Number(document.size || 0) === Number(file.size || 0),
    );
    if (alreadyExists) {
      await rejectUnsafeUpload(file);
      continue;
    }
    const groupId = buildDocumentGroupId(customer.id, applicationId, stageId);
    const document = {
      id: uuidv4(),
      name: safeName,
      path: `/uploads/${path.basename(file.path)}`,
      mimeType: file.mimetype,
      size: file.size,
      uploadedAt: now(),
      uploadedBy: 'website',
      requestIp: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
      downloadCount: 0,
      downloadHistory: [],
      customerId: customer.id,
      applicationId,
      leadId: customer.leadId || customer.id,
      stageId,
      groupId,
      groupLabel: `${customer.id} • ${applicationId} • ${stageId}`,
    };
    customer.documents.unshift(document);
    addedDocuments.push(document);
  }

  const notificationKey = buildApplicationPackageNotificationKey(customer, applicationId);
  const recentNotification = (store.leadNotificationLedger || []).find((entry) => entry.key === notificationKey);
  const body = buildApplicationPackageMessage(customer, addedDocuments.length ? addedDocuments : customer.documents);
  const documentAttachments = buildDocumentAttachments(addedDocuments.length ? addedDocuments : customer.documents);
  let whatsappForwardedTo = [];
  let operationalEmailDeliveryId = '';
  if (!recentNotification && store.siteSettings.notifyLeads) {
    const operationalResult = await sendOperationalNotification(store, {
      key: notificationKey,
      type: 'package_ready',
      subject: 'OnlineSMMM başvuru paketi hazır',
      body,
      preferredUserIds: customer.assignedUserId ? [customer.assignedUserId] : [],
      attachments: documentAttachments,
      context: {
        actor: 'website',
        requestId: req.requestId,
        sessionId,
        visitorId,
        customerId: customer.id,
        applicationId,
      },
    });
    whatsappForwardedTo = operationalResult.whatsappForwardedTo || [];
    operationalEmailDeliveryId = operationalResult.email?.deliveryId || '';
  }
  const whatsappDeliveryStatus = buildWhatsAppDeliveryStatus(whatsappForwardedTo, Boolean(recentNotification));
  let emailDeliveryStatus = 'not_sent';
  try {
    const emailResult = await sendCustomerWelcomeEmail(store, customer, {
      actor: 'website',
      requestId: req.requestId,
      sessionId,
      visitorId,
      template: 'application_package_customer',
      attachments: documentAttachments,
    });
    emailDeliveryStatus = emailResult?.ok ? 'queued' : (emailResult?.skipped ? `skipped:${emailResult.reason}` : 'failed');
  } catch (error) {
    emailDeliveryStatus = `failed:${error?.code || error?.name || 'mail_error'}`;
  }

  const message = {
    id: uuidv4(),
    customerId: customer.id,
    channel: 'website',
    direction: 'inbound',
    actor: customer.email || customer.phone || 'website',
    body,
    createdAt: now(),
    whatsappForwardedTo,
    archivedAt: '',
    applicationId,
    stageId,
    deliveryStatus: {
      portal: 'saved',
      whatsapp: whatsappDeliveryStatus,
      email: emailDeliveryStatus,
    },
  };
  if (!recentNotification || addedDocuments.length) {
    store.messages.unshift(message);
    store.messages = store.messages.slice(0, 1000);
  }

  store.leadNotificationLedger = Array.isArray(store.leadNotificationLedger) ? store.leadNotificationLedger : [];
  if (!recentNotification) {
    store.leadNotificationLedger.unshift({
      key: notificationKey,
      sessionId,
      visitorId,
      step: 7,
      stepLabel: 'Özet',
      phone: sanitizePhone(customer.phone || ''),
      customerId: customer.id,
      applicationId,
      forwardedTo: whatsappForwardedTo,
      emailDeliveryId: operationalEmailDeliveryId,
      createdAt: now(),
      signature: buildApplicationPackageFileSignature(files),
    });
    store.leadNotificationLedger = store.leadNotificationLedger.slice(0, 500);
  }

  await addAudit(store, 'website', 'Başvuru paketi kaydedildi', {
    customerId: customer.id,
    applicationId,
    stageId,
    documentCount: customer.documents.length,
    addedDocumentCount: addedDocuments.length,
    whatsappForwardedTo,
  });
  await syncCrmEvent(store, 'application.package.ready', {
    customer: { ...customer, documentCount: customer.documents.length },
    addedDocuments,
  });
  await persist(store);
  res.json({
    ok: true,
    customer,
    addedDocuments,
    whatsappForwardedTo,
    duplicateNotification: Boolean(recentNotification),
    notificationKey,
  });
});

app.post('/api/public/leads', upload.array('documents', 8), async (req, res) => {
  const store = await db();
  const turnstileToken = req.body?.turnstileToken || req.body?.['cf-turnstile-response'] || '';
  let turnstileResult;
  try {
    turnstileResult = await validateTurnstileToken(turnstileToken, req, store.siteSettings || {});
  } catch (error) {
    console.error('Turnstile lead validation setup failed:', error.message);
    return res.status(500).json({ message: 'Turnstile doğrulama yapılandırması eksik.' });
  }
  if (!turnstileResult?.success) {
    console.warn('Turnstile lead rejected', {
      host: req.headers.host || '',
      clientIp: getClientIp(req),
      errorCodes: turnstileResult?.['error-codes'] || [],
    });
    return res.status(400).json({
      message: 'Turnstile doğrulaması başarısız oldu. Lütfen tekrar deneyin.',
      errorCodes: turnstileResult?.['error-codes'] || [],
    });
  }

  // Validate TCKN if provided
  if (req.body.tckn) {
    if (!validateTCKN(req.body.tckn)) {
      return res.status(400).json({ message: 'Güvenlik doğrulaması başarısız: Lütfen 11 haneli T.C. Kimlik Numaranızı doğru girdiğinizden emin olun.' });
    }
  }

  const applicationId = normalizeApplicationId(req.body.applicationId, 'APP');
  const stageId = normalizeStageId(req.body.stage || 'stage-0');
  const assignedUser = pickOperationalOwnerUser(store);

  const uploadSafety = await validateUploadedFilesOrReject(req.files || []);
  if (!uploadSafety.ok) {
    await addAudit(store, 'website', 'Guvenli olmayan public belge yukleme engellendi', {
      fileName: uploadSafety.file?.originalname,
      mimeType: uploadSafety.file?.mimetype,
      reason: uploadSafety.reason,
      ip: getClientIp(req),
    });
    await persist(store);
    return res.status(400).json({ message: 'Dosya güvenlik kontrolünden geçemedi. PDF, JPG veya PNG dosyası yükleyin.' });
  }
  const customer = {
    id: uuidv4(),
    sessionId: String(req.body.sessionId || '').slice(0, 80),
    visitorId: String(req.body.visitorId || '').slice(0, 80),
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    tckn: req.body.tckn || '',
    applicationId,
    leadId: req.body.leadId || '',
    companyName: req.body.companyName || '',
    companyTypeId: req.body.companyTypeId || '',
    address: req.body.address || '',
    province: req.body.province || '',
    district: req.body.district || '',
    neighborhood: req.body.neighborhood || '',
    addressDetail: req.body.addressDetail || '',
    companyType: req.body.companyType,
    estimate: req.body.estimate || '',
    estimateValue: Number(req.body.estimateValue || 0),
    activity: {
      mainActivity: req.body.activityMain || '',
      subActivity: req.body.activitySub || '',
      revenueMethod: req.body.revenueMethod || '',
      salesChannel: req.body.salesChannel || '',
    },
    assignedUserId: assignedUser?.id || '',
    assignedUserEmail: assignedUser?.email || '',
    assignedUserName: assignedUser?.name || '',
    membershipStatus: 'Yeni lead',
    paymentStatus: 'pending',
    paymentCompletedAt: '',
    notes: req.body.notes || '',
    source: req.body.source || 'website',
    stage: Number(req.body.stage || 0) || 0,
    stageId,
    createdAt: now(),
    updatedAt: now(),
    documents: [],
  };

  customer.leadId = customer.id;
  customer.documents = (req.files || []).map((file) => {
    const documentStageId = stageId;
    const groupId = buildDocumentGroupId(customer.id, applicationId, documentStageId);
    return {
      id: uuidv4(),
      name: sanitizeDocumentName(file.originalname),
      path: `/uploads/${path.basename(file.path)}`,
      mimeType: file.mimetype,
      size: file.size,
      uploadedAt: now(),
      uploadedBy: 'website',
      requestIp: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
      downloadCount: 0,
      downloadHistory: [],
      customerId: customer.id,
      applicationId,
      leadId: customer.leadId,
      stageId: documentStageId,
      groupId,
      groupLabel: `${customer.id} • ${applicationId} • ${documentStageId}`,
    };
  });

  store.customers.unshift(customer);
  const whatsappForwardedTo = store.siteSettings.whatsappRoutingEnabled && store.siteSettings.notifyLeads
    ? await forwardWhatsAppNotifications(store, buildOperationalWhatsAppSummary(customer, 'Yeni web başvurusu alındı'), {
      preferredUserIds: [customer.assignedUserId],
    })
    : [];

  const message = {
    id: uuidv4(),
    customerId: customer.id,
    channel: 'website',
    direction: 'inbound',
    actor: customer.email || customer.phone || 'website',
    body: req.body.message || 'Web sitesi uzerinden yeni basvuru alindi.',
    createdAt: now(),
    whatsappForwardedTo,
  };

  store.messages.unshift(message);
  await addAudit(store, 'website', `Yeni lead olustu: ${customer.name}`, {
    ip: req.ip,
    customerId: customer.id,
  });

  await syncCrmEvent(store, 'lead.created', {
    customer: { ...customer, documentCount: customer.documents.length },
    source: customer.source,
  });

  // 1. Send HTML Welcome email to Customer
  await sendCustomerWelcomeEmail(store, customer, {
    actor: 'website',
    requestId: req.requestId,
    sessionId: customer.sessionId || req.body.sessionId || '',
    visitorId: customer.visitorId || req.body.visitorId || '',
    customerId: customer.id,
  });

  // 2. Send Notification Email to all active staff & superadmins
  const escapedNotifyName = escapeHtml(customer.name || '-');
  const escapedNotifyTckn = escapeHtml(customer.tckn || '-');
  const escapedNotifyEmail = escapeHtml(customer.email || '-');
  const escapedNotifyPhone = escapeHtml(customer.phone || '-');
  const escapedNotifyType = escapeHtml(customer.companyType || '-');
  const escapedNotifyAddress = escapeHtml(customer.address || '-');
  const notifySubject = `Yeni Başvuru Alındı: ${customer.name}`;
  const notifyHtml = `
    <h2>Yeni Başvuru Alındı (OnlineSMMM)</h2>
    <p><strong>Müşteri:</strong> ${escapedNotifyName}</p>
    <p><strong>T.C. Kimlik No:</strong> ${escapedNotifyTckn}</p>
    <p><strong>E-Posta:</strong> ${escapedNotifyEmail}</p>
    <p><strong>Telefon:</strong> ${escapedNotifyPhone}</p>
    <p><strong>Şirket Tipi:</strong> ${escapedNotifyType}</p>
    <p><strong>Adres:</strong> ${escapedNotifyAddress}</p>
  `;
  await sendNotificationEmail(store, notifySubject, notifyHtml, {
    actor: 'website',
    requestId: req.requestId,
    sessionId: customer.sessionId || req.body.sessionId || '',
    visitorId: customer.visitorId || req.body.visitorId || '',
    customerId: customer.id,
    recipients: (store.users || []).filter((u) => u.isActive !== false && u.email).length,
  });

  await persist(store);
  res.json({ ok: true, customer, message, whatsappForwardedTo });
});

app.get('/api/public/locations/provinces', async (_req, res) => {
  const store = await db();
  res.json({ provinces: getProvinces(getNormalizedLocationCatalog(store)) });
});

app.get('/api/public/locations/provinces/:provinceId/districts', async (req, res) => {
  const store = await db();
  res.json({ districts: getDistricts(req.params.provinceId, getNormalizedLocationCatalog(store)) });
});

app.get('/api/public/locations/districts/:districtId/neighborhoods', async (req, res) => {
  const store = await db();
  res.json({ neighborhoods: getNeighborhoods(req.params.districtId, getNormalizedLocationCatalog(store)) });
});

app.post('/api/mail/inbound', async (req, res) => {
  if (!requireInboundMailSecret(req, res)) return;
  const store = await db();
  const inbound = normalizeInboundMailPayload(req.body || {});
  if (!inbound.from || !inbound.body) {
    return res.status(400).json({ message: 'Inbound e-posta için from ve body zorunlu.' });
  }
  const { message, duplicate } = storeInboundEmail(store, inbound, req);
  await addAudit(store, 'mail-webhook', duplicate ? 'Inbound e-posta tekrarlandı' : 'Inbound e-posta portala düştü', {
    messageId: message.id,
    providerMessageId: inbound.messageId,
    from: inbound.from,
    to: inbound.to,
    subject: inbound.subject,
    duplicate,
  });
  await persist(store);
  emitStructuredLog('mail_inbound', {
    messageId: message.id,
    providerMessageId: inbound.messageId,
    from: inbound.from,
    recipients: inbound.to.length,
    duplicate,
  }, duplicate ? 'warn' : 'info');
  res.json({ ok: true, duplicate, messageId: message.id });
});

app.post('/api/mail/bounce', async (req, res) => {
  if (!requireInboundMailSecret(req, res)) return;
  const store = await db();
  const body = req.body || {};
  const deliveryId = String(body.deliveryId || body.metadata?.deliveryId || '').trim();
  const providerMessageId = String(body.messageId || body['message-id'] || body.providerMessageId || '').trim();
  const recipient = String(body.recipient || body.email || '').trim();
  const reason = String(body.reason || body.error || body.description || 'bounce').slice(0, 500);
  const delivery = (store.mailDeliveries || []).find((entry) =>
    (deliveryId && entry.id === deliveryId) ||
    (providerMessageId && entry.messageId === providerMessageId) ||
    (recipient && String(entry.to || '').includes(recipient))
  );
  if (delivery) {
    Object.assign(delivery, {
      status: 'bounced',
      bounceReason: reason,
      bouncedAt: now(),
      updatedAt: now(),
    });
  } else {
    upsertMailDelivery(store, {
      id: deliveryId || uuidv4(),
      status: 'bounced',
      to: recipient,
      messageId: providerMessageId,
      bounceReason: reason,
      bouncedAt: now(),
    });
  }
  await addAudit(store, 'mail-webhook', 'Kritik mail bounce kaydı alındı', {
    deliveryId,
    providerMessageId,
    recipient,
    reason,
    severity: 'critical',
  });
  await persist(store);
  emitStructuredLog('mail_delivery', {
    delivery: 'bounced',
    deliveryId,
    providerMessageId,
    recipient,
    errorMessage: reason,
  }, 'warn');
  res.json({ ok: true });
});

app.get('/api/admin/mail/health', requireAuth, requireRole('superadmin'), async (req, res) => {
  const store = await db();
  const settings = getServerMailSettings(store.siteSettings || {});
  const identity = validateMailIdentity(settings, store.siteSettings || {});
  const dnsHealth = await checkMailDnsHealth(store.siteSettings || {});
  const queued = (store.mailDeliveries || []).filter((entry) => entry.status === 'queued' || entry.status === 'retrying').length;
  const failedLast24h = (store.mailDeliveries || []).filter((entry) => {
    const updatedAt = Date.parse(entry.updatedAt || entry.createdAt || '');
    return ['failed', 'bounced'].includes(entry.status) && Number.isFinite(updatedAt) && Date.now() - updatedAt < 24 * 60 * 60 * 1000;
  }).length;
  const health = {
    ok: isMailConfigured(settings) && identity.ok && dnsHealth.ok && failedLast24h === 0,
    provider: settings.provider,
    source: settings.source,
    configured: isMailConfigured(settings),
    from: settings.smtpSender,
    replyTo: settings.smtpReplyTo,
    identity,
    dns: dnsHealth,
    metrics: {
      queued,
      failedLast24h,
      totalTracked: (store.mailDeliveries || []).length,
    },
  };
  await addAudit(store, req.auth.email, 'Mail güvenilirlik kontrolü çalıştırıldı', {
    ok: health.ok,
    provider: health.provider,
    configured: health.configured,
    identityOk: identity.ok,
    dnsOk: dnsHealth.ok,
    failedLast24h,
  });
  await persist(store);
  res.status(health.ok ? 200 : 409).json({ health });
});

app.post('/api/admin/send-email', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { to, subject, body } = req.body || {};
  const store = await db();
  const settings = getServerMailSettings(store.siteSettings || {});
  const recipients = normalizeEmailList(to);
  const mailSubject = String(subject || '').trim();
  const mailBody = String(body || '').trim();
  const sanitizedMailBody = sanitizeEmailHtml(mailBody);
  const startedAt = performance.now();

  if (!isMailConfigured(settings)) {
    return res.status(503).json({ message: 'Sunucu mail ayarları eksik. MAIL_SMTP_HOST, MAIL_SMTP_USER, MAIL_SMTP_PASS env değerleri tanımlanmalı.' });
  }
  if (!recipients.length || !mailSubject || !sanitizedMailBody) {
    return res.status(400).json({ message: 'Geçerli alıcı, konu ve içerik zorunludur.' });
  }

  try {
    const queued = recipients.map((recipient) => enqueueMail(store, {
      to: recipient,
      subject: mailSubject,
      html: sanitizedMailBody,
      text: htmlToPlainText(sanitizedMailBody),
    }, {
      ...getRequestObservability(req, { userId: req.auth?.sub || '', userEmail: req.auth?.email || '' }),
      template: 'admin_manual',
      recipient,
      recipients: 1,
      subject: mailSubject.slice(0, 120),
    }));

    const durationMs = observeDuration(startedAt);
    emitStructuredLog('mail_delivery', {
      ...getRequestObservability(req, { userId: req.auth?.sub || '', userEmail: req.auth?.email || '' }),
      delivery: 'queued',
      template: 'admin_manual',
      recipients: recipients.length,
      deliveryIds: queued.map((item) => item.deliveryId),
      durationMs,
      statusCode: 200,
      subject: mailSubject.slice(0, 120),
    }, 'info');
    await addAudit(store, req.auth.email, `E-posta kuyruğa alındı: Alıcı=${recipients.join(', ')}, Konu=${mailSubject}`, {
      requestId: req.requestId,
      userId: req.auth?.sub || '',
      userEmail: req.auth?.email || '',
      sessionId: getSessionContextFromRequest(req),
      recipients,
      delivery: 'queued',
      template: 'admin_manual',
      deliveryIds: queued.map((item) => item.deliveryId),
      durationMs,
    });
    await persist(store);
    res.json({ ok: true, queued: true, deliveryIds: queued.map((item) => item.deliveryId) });
  } catch (err) {
    const durationMs = observeDuration(startedAt);
    emitStructuredLog('mail_delivery', {
      ...getRequestObservability(req, { userId: req.auth?.sub || '', userEmail: req.auth?.email || '' }),
      delivery: 'failed',
      template: 'admin_manual',
      recipients,
      errorCode: err.code || err.name || 'smtp_error',
      errorMessage: err.message,
      durationMs,
      statusCode: 500,
      subject: mailSubject.slice(0, 120),
    }, 'error');
    await addAudit(store, req.auth.email, `E-posta gönderimi başarısız: Alıcı=${recipients.join(', ')}, Konu=${mailSubject}`, {
      requestId: req.requestId,
      userId: req.auth?.sub || '',
      userEmail: req.auth?.email || '',
      sessionId: getSessionContextFromRequest(req),
      recipients,
      delivery: 'failed',
      template: 'admin_manual',
      errorCode: err.code || err.name || 'smtp_error',
      errorMessage: err.message,
      durationMs,
      severity: 'critical',
    });
    await persist(store);
    res.status(500).json({ message: `E-posta gönderimi başarısız: ${err.message}` });
  }
});

app.post('/api/public/lead-progress', createRateLimiter('leadProgress'), async (req, res) => {
  const body = req.body || {};
  const sessionId = String(body.sessionId || '').slice(0, 80);
  const visitorId = String(body.visitorId || '').slice(0, 80);
  const step = Number(body.step || 0) || 0;
  const store = await db();
  if (store.siteSettings?.leadProgressTrackingEnabled === false) {
    return res.json({ ok: true, trackingDisabled: true });
  }
  if (!sessionId || !visitorId || !step) {
    return res.status(400).json({ message: 'Oturum veya aşama bilgisi eksik.' });
  }

  let visit = store.customerVisits.find((entry) => entry.sessionId === sessionId);
  if (!visit) {
    visit = {
      id: uuidv4(),
      sessionId,
      visitorId,
      firstSeenAt: now(),
      lastSeenAt: now(),
      durationSeconds: 0,
      pageViews: 0,
      clickCount: 0,
      whatsappClicked: false,
      whatsappClickCount: 0,
      phoneClicked: false,
      ctaClicks: [],
      paths: [],
      referrer: '',
      source: body.source || 'wizard',
      locale: String(body.locale || 'tr').slice(0, 12),
      applicationId: String(body.applicationId || '').slice(0, 80),
      deviceType: String(body.deviceType || 'desktop').slice(0, 24),
      screen: body.screen || {},
      viewport: body.viewport || {},
      ip: getClientIp(req),
      country: String(req.headers['cf-ipcountry'] || '').slice(0, 8),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
      lead: null,
      leadSnapshots: [],
      lastAction: '',
      events: [],
      leadTemperature: 'cold',
      progressNotificationKeys: [],
    };
    store.customerVisits.unshift(visit);
  }

  const normalizedSnapshot = normalizeLeadProgressPayload(body);
  const previousSnapshot = Array.isArray(visit.leadSnapshots) ? visit.leadSnapshots[0] : null;
  const { changedFields, changes } = collectLeadProgressChanges(previousSnapshot, normalizedSnapshot);
  const snapshot = {
    ...normalizedSnapshot,
    signature: buildLeadProgressSignature(normalizedSnapshot),
    changedFields,
    changes,
    previousStep: Number(previousSnapshot?.step || 0) || 0,
    createdAt: now(),
  };
  const duplicateSnapshot = !shouldRecordLeadProgressSnapshot(previousSnapshot, snapshot);

  visit.lastSeenAt = now();
  visit.lastAction = `${snapshot.stepLabel} kaydedildi`;
  visit.leadSnapshots = Array.isArray(visit.leadSnapshots) ? visit.leadSnapshots : [];
  if (!duplicateSnapshot) {
    visit.leadSnapshots.unshift(snapshot);
    visit.leadSnapshots = visit.leadSnapshots.slice(0, 20);
  }
  visit.formStarted = true;
  visit.formAbandoned = false;
  visit.leadTemperature = 'warm';

  const leadMeta = {
    sessionId,
    visitorId,
    step,
    source: body.source || 'wizard',
    applicationId: snapshot.applicationId || '',
  };

  if (!duplicateSnapshot) {
    await addAudit(store, 'website', `Aşama kaydedildi: ${snapshot.stepLabel}`, {
      ...leadMeta,
      changedFields,
      changes,
    });
  }

  const progressCustomer = upsertLeadProgressCustomer(store, snapshot, {
    sessionId,
    visitorId,
    source: body.source || 'application-flow',
    applicationId: snapshot.applicationId || '',
  });
  if (progressCustomer && !duplicateSnapshot) {
    store.messages = Array.isArray(store.messages) ? store.messages : [];
    store.messages.unshift({
      id: uuidv4(),
      customerId: progressCustomer.id,
      channel: 'portal',
      direction: 'inbound',
      actor: 'website',
      body: buildLeadProgressMessage(snapshot, progressCustomer),
      createdAt: now(),
      whatsappForwardedTo: [],
      archivedAt: '',
    });
    store.messages = store.messages.slice(0, 1000);
  }

  const notificationKey = progressCustomer
    ? buildApplicationPackageNotificationKey(progressCustomer, snapshot.applicationId || '')
    : normalizeLeadProgressNotificationKey(snapshot, sessionId, visitorId);
  const recentNotification = (store.leadNotificationLedger || []).find((entry) => entry.key === notificationKey);
  const shouldNotify = !duplicateSnapshot && isPackageReadyTransition(snapshot) && progressCustomer;
  visit.whatsappForwardedTo = [];
  if (shouldNotify && store.siteSettings.notifyLeads && !recentNotification) {
    const lines = buildApplicationPackageMessage(progressCustomer, progressCustomer.documents || []);
    const operationalResult = await sendOperationalNotification(store, {
      key: notificationKey,
      type: 'package_ready',
      subject: 'OnlineSMMM başvuru paketi hazır',
      body: lines,
      preferredUserIds: progressCustomer.assignedUserId ? [progressCustomer.assignedUserId] : [],
      context: {
        actor: 'website',
        requestId: req.requestId,
        sessionId,
        visitorId,
        customerId: progressCustomer.id,
        applicationId: snapshot.applicationId || progressCustomer.applicationId || '',
      },
    });
    visit.whatsappForwardedTo = operationalResult.whatsappForwardedTo || [];
    if (progressCustomer) {
      progressCustomer.lastWhatsappForwardedTo = visit.whatsappForwardedTo;
      const latestMessage = (store.messages || []).find((message) =>
        message.customerId === progressCustomer.id &&
        message.actor === 'website',
      );
      if (latestMessage) {
        latestMessage.whatsappForwardedTo = visit.whatsappForwardedTo;
        latestMessage.deliveryStatus = {
          ...(latestMessage.deliveryStatus || {}),
          whatsapp: buildWhatsAppDeliveryStatus(visit.whatsappForwardedTo, false),
          email: operationalResult.email?.deliveryId ? 'queued' : 'not_sent',
        };
      }
    }
    store.leadNotificationLedger = Array.isArray(store.leadNotificationLedger) ? store.leadNotificationLedger : [];
    store.leadNotificationLedger.unshift({
      key: notificationKey,
      sessionId,
      visitorId,
      step: snapshot.step,
      stepLabel: snapshot.stepLabel,
      phone: sanitizePhone(snapshot.lead?.phone || ''),
      customerId: progressCustomer?.id || '',
      applicationId: snapshot.applicationId || '',
      forwardedTo: visit.whatsappForwardedTo,
      emailDeliveryId: operationalResult.email?.deliveryId || '',
      createdAt: now(),
      changedFields,
      signature: snapshot.signature,
    });
    store.leadNotificationLedger = store.leadNotificationLedger.slice(0, 500);
  }

  await persist(store);
  res.json({
    ok: true,
    snapshot,
    customer: progressCustomer,
    duplicateSnapshot,
    notificationSent: Boolean(visit.whatsappForwardedTo?.length),
    whatsappForwardedTo: visit.whatsappForwardedTo || [],
    notificationKey,
  });
});

app.post('/api/public/payments', async (req, res) => {
  const { customerId, amount, currency = 'TRY', orderId, paymentMethod = 'iyzico', description } = req.body || {};
  const store = await db();
  const customer = store.customers.find((entry) => entry.id === customerId);
  if (!customer) {
    return res.status(404).json({ message: 'Musteri bulunamadi.' });
  }

  const result = await recordCompletedPayment(store, {
    customerId,
    amount,
    currency,
    orderId: orderId || `PUBLIC-${customerId}-${Date.now()}`,
    paymentMethod,
    description: description || 'Online odeme kaydi',
    paymentStatus: 'completed',
    ip: getClientIp(req),
  });

  await persist(store);
  res.json({ ok: true, payment: result.payment, duplicate: Boolean(result.duplicate) });
});

app.post('/api/public/iyzico/checkout/initialize', createRateLimiter('payment'), async (req, res) => {
  const body = req.body || {};
  const store = await db();
  const settings = store.siteSettings || {};
  const customerId = String(body.customerId || '').slice(0, 80);
  const amount = normalizePaymentAmount(body.amount);
  const currency = normalizePaymentCurrency(body.currency || 'TRY');
  const customer = store.customers.find((entry) => entry.id === customerId);
  if (!customer) {
    return res.status(404).json({ message: 'Musteri bulunamadi.' });
  }
  if (!amount) {
    return res.status(400).json({ message: 'Tutar bilgisi eksik.' });
  }
  if (!currency) {
    return res.status(400).json({ message: 'Para birimi desteklenmiyor.' });
  }

  const diagnostics = getIyzicoDiagnostics(settings, req);
  const missingSettings = [];
  if (!diagnostics.apiKeyConfigured) missingSettings.push('apiKey');
  if (!diagnostics.secretConfigured) missingSettings.push('secretKey');
  if (!diagnostics.callbackUrlConfigured) missingSettings.push('callbackUrl');
  if (missingSettings.length) {
    await addAudit(store, 'website', 'iyzico ödeme başlatma ayar eksikliği nedeniyle durduruldu', {
      customerId,
      missingSettings,
      severity: 'warning',
      requestId: req.requestId,
    });
    await persist(store);
    return res.status(400).json({
      message: `iyzico ayarları eksik: ${missingSettings.join(', ')}. Yönetim panelinden canlı ödeme anahtarlarını kaydedin.`,
      diagnostics,
    });
  }

  const iyzico = buildIyzicoClient(store);
  const contactName = customer.name || body.name || 'Müşteri';
  const buyer = buildIyzicoBuyerFromLead({
    ...customer,
    address: customer.address || [customer.addressDetail, customer.neighborhood, customer.district, customer.province].filter(Boolean).join(' / '),
  }, customerId, getClientIp(req));
  const address = buildIyzicoAddress(customer, contactName);
  const conversationId = customerId;
  const orderId = buildIyzicoOrderId(customerId);
  const price = toIyzicoPrice(amount);
  const callbackUrl = resolvePaymentCallbackUrl(settings, req);
  if (!callbackUrl) {
    return res.status(400).json({ message: 'iyzico callback URL HTTPS olarak tanımlanmalı.' });
  }
  const request = {
    locale: Iyzipay.LOCALE.TR,
    conversationId,
    price,
    paidPrice: price,
    currency: currency === 'USD' ? Iyzipay.CURRENCY.USD : Iyzipay.CURRENCY.TRY,
    basketId: orderId,
    paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
    callbackUrl,
    enabledInstallments: [1, 2, 3, 6, 9, 12],
    buyer,
    shippingAddress: address,
    billingAddress: address,
    basketItems: [
      {
        id: customerId,
        name: `OnlineSMMM hizmet bedeli - ${customer.companyType || 'Başvuru'}`,
        category1: 'Professional Services',
        category2: 'Company Formation',
        itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
        price,
      },
    ],
  };

  const startedAt = performance.now();
  let initializeSettled = false;
  const initializeTimeoutId = setTimeout(async () => {
    if (initializeSettled) return;
    initializeSettled = true;
    const durationMs = observeDuration(startedAt);
    emitStructuredLog('iyzico_flow', {
      requestId: req.requestId,
      customerId,
      conversationId,
      outcome: 'timeout',
      stage: 'initialize',
      errorCode: 'iyzico_initialize_timeout',
      durationMs,
      statusCode: 504,
    }, 'error');
    await addAudit(store, 'website', 'iyzico ödeme başlatma zaman aşımı', {
      customerId,
      conversationId,
      severity: 'critical',
      requestId: req.requestId,
      durationMs,
    });
    await persist(store);
    if (!res.headersSent) {
      res.status(504).json({ message: 'Ödeme altyapısı zaman aşımına uğradı. Lütfen biraz sonra tekrar deneyin.' });
    }
  }, operationTimeouts.iyzicoMs);
  iyzico.payWithIyzico.initialize(request, async (err, result) => {
    if (initializeSettled) return;
    initializeSettled = true;
    clearTimeout(initializeTimeoutId);
    if (err) {
      const durationMs = observeDuration(startedAt);
      emitStructuredLog('iyzico_flow', {
        requestId: req.requestId,
        customerId,
        conversationId,
        outcome: 'error',
        stage: 'initialize',
        errorCode: err.code || err.name || 'iyzico_initialize_error',
        errorMessage: err.message,
        durationMs,
        statusCode: 502,
        userId: req.auth?.sub || '',
        userEmail: req.auth?.email || '',
        sessionId: customer.sessionId || req.body.sessionId || '',
      }, 'error');
      await addAudit(store, 'website', 'iyzico ödeme başlatılamadı', {
        customerId,
        conversationId,
        severity: 'critical',
        requestId: req.requestId,
        userId: req.auth?.sub || '',
        userEmail: req.auth?.email || '',
        sessionId: customer.sessionId || req.body.sessionId || '',
        durationMs,
        errorCode: err.code || err.name || 'iyzico_initialize_error',
        errorMessage: err.message,
      });
      await persist(store);
      return res.status(502).json({ message: 'Ödeme altyapısı şu anda yanıt vermiyor.' });
    }
    if (!result || result.status !== 'success') {
      const durationMs = observeDuration(startedAt);
      const errorCode = result?.errorCode || result?.errorMessage || 'iyzico_initialize_failed';
      emitStructuredLog('iyzico_flow', {
        requestId: req.requestId,
        customerId,
        conversationId,
        outcome: 'failed',
        stage: 'initialize',
        errorCode,
        errorMessage: result?.errorMessage || 'Ödeme başlatılamadı.',
        durationMs,
        statusCode: 400,
        userId: req.auth?.sub || '',
        userEmail: req.auth?.email || '',
        sessionId: customer.sessionId || req.body.sessionId || '',
      }, 'warn');
      await addAudit(store, 'website', 'iyzico ödeme başlatma başarısız', {
        customerId,
        conversationId,
        severity: 'warning',
        requestId: req.requestId,
        userId: req.auth?.sub || '',
        userEmail: req.auth?.email || '',
        sessionId: customer.sessionId || req.body.sessionId || '',
        durationMs,
        errorCode,
        errorMessage: result?.errorMessage || 'Ödeme başlatılamadı.',
      });
      await persist(store);
      return res.status(400).json({
        message: result?.errorMessage || 'Ödeme başlatılamadı.',
      });
    }

    customer.paymentStatus = 'pending';
    customer.updatedAt = now();
    await recordCompletedPayment(store, {
      customerId,
      amount,
      currency,
      orderId,
      paymentMethod: 'iyzico',
      description: 'iyzico checkout initialized',
      paymentStatus: 'pending',
      providerToken: result.token || '',
      environment: getIyzicoEnvironment(settings),
      expectedAmount: amount,
      expectedCurrency: currency,
      ip: getClientIp(req),
    });
    const durationMs = observeDuration(startedAt);
    emitStructuredLog('iyzico_flow', {
      requestId: req.requestId,
      customerId,
      conversationId,
      outcome: 'success',
      stage: 'initialize',
      durationMs,
      statusCode: 200,
      userId: req.auth?.sub || '',
      userEmail: req.auth?.email || '',
      sessionId: customer.sessionId || req.body.sessionId || '',
      paymentToken: result.token || '',
      orderId,
    }, 'info');
    await addAudit(store, 'website', `iyzico ödeme başlatıldı: ${customer.name}`, {
      customerId,
      conversationId,
      orderId,
      requestId: req.requestId,
      userId: req.auth?.sub || '',
      userEmail: req.auth?.email || '',
      sessionId: customer.sessionId || req.body.sessionId || '',
      durationMs,
      paymentToken: result.token || '',
      environment: getIyzicoEnvironment(settings),
    });
    await persist(store);

    return res.json({
      ok: true,
      token: result.token,
      conversationId: result.conversationId || conversationId,
      paymentUrl: result.payWithIyzicoPageUrl || '',
      paymentPageUrl: result.payWithIyzicoPageUrl || '',
      checkoutFormContent: result.checkoutFormContent || '',
    });
  });
});

app.all('/odeme/callback', async (req, res) => {
  const store = await db();
  const payload = { ...req.body, ...req.query };
  const token = String(payload.token || '').trim();
  const conversationId = String(payload.conversationId || payload.customerId || '').trim();
  const fallbackResultLocale = 'tr';
  const buildResultRedirect = (status, params = {}, locale = fallbackResultLocale) => {
    const baseUrl = resolvePaymentResultUrl(store.siteSettings || {}, req, locale) || `${req.protocol}://${req.get('host')}/odeme/sonuc`;
    const redirectUrl = new URL(baseUrl);
    redirectUrl.searchParams.set('status', status);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        redirectUrl.searchParams.set(key, String(value));
      }
    });
    return redirectUrl.toString();
  };
  if (!token || !conversationId) {
    const redirectHref = buildResultRedirect('failed', {
      error: 'missing-data',
      message: 'İşlem verisi eksik geldi.',
    });
    return res.status(400).send(renderPaymentResultPage({
      success: false,
      title: 'Ödeme doğrulanamadı',
      message: 'İşlem verisi eksik geldi. Lütfen tekrar deneyin.',
      redirectHref,
    }));
  }

  const iyzico = buildIyzicoClient(store);
  const startedAt = performance.now();
  const pendingPayment = findPaymentRecord(store, {
    customerId: conversationId,
    providerToken: token,
    paymentMethod: 'iyzico',
  });
  const customer = store.customers.find((entry) => entry.id === conversationId);
  let callbackSettled = false;
  const callbackTimeoutId = setTimeout(async () => {
    if (callbackSettled) return;
    callbackSettled = true;
    const durationMs = observeDuration(startedAt);
    emitStructuredLog('iyzico_flow', {
      requestId: req.requestId,
      conversationId,
      outcome: 'timeout',
      stage: 'callback',
      errorCode: 'iyzico_callback_timeout',
      durationMs,
      statusCode: 504,
    }, 'error');
    await addAudit(store, 'website', 'iyzico callback zaman aşımı', {
      conversationId,
      severity: 'critical',
      requestId: req.requestId,
      durationMs,
      sessionId: getSessionContextFromRequest(req),
    });
    await persist(store);
    const redirectHref = buildResultRedirect('failed', {
      conversationId,
      error: 'timeout',
    }, customer?.locale || pendingPayment?.locale || fallbackResultLocale);
    if (!res.headersSent) {
      res.status(504).send(renderPaymentResultPage({
        success: false,
        title: 'Ödeme doğrulaması gecikti',
        message: 'Ödeme sağlayıcısından zamanında yanıt alınamadı. Danışmanımız ödeme durumunu kontrol edecektir.',
        redirectHref,
      }));
    }
  }, operationTimeouts.iyzicoMs);
  iyzico.payWithIyzico.retrieve({
    locale: Iyzipay.LOCALE.TR,
    conversationId,
    token,
  }, async (err, result) => {
    if (callbackSettled) return;
    callbackSettled = true;
    clearTimeout(callbackTimeoutId);
    if (err || !result || result.status !== 'success' || result.paymentStatus !== 'SUCCESS') {
      const durationMs = observeDuration(startedAt);
      const errorCode = err?.code || err?.name || result?.errorCode || result?.errorMessage || 'iyzico_callback_failed';
      if (pendingPayment || store.customers.some((entry) => entry.id === conversationId)) {
        await recordCompletedPayment(store, {
          customerId: conversationId,
          amount: pendingPayment?.amount || result?.paidPrice || result?.price || 0,
          currency: pendingPayment?.currency || result?.currency || 'TRY',
          orderId: pendingPayment?.orderId || result?.basketId || `IYZ-FAILED-${Date.now()}`,
          paymentMethod: 'iyzico',
          description: 'iyzico checkout callback failed',
          paymentStatus: 'failed',
          providerToken: token,
          providerPaymentId: result?.paymentId || '',
          callbackId: result?.paymentId || token,
          environment: pendingPayment?.environment || getIyzicoEnvironment(store.siteSettings || {}),
          expectedAmount: pendingPayment?.expectedAmount || pendingPayment?.amount || 0,
          expectedCurrency: pendingPayment?.expectedCurrency || pendingPayment?.currency || 'TRY',
          ip: getClientIp(req),
        });
      }
      emitStructuredLog('iyzico_flow', {
        requestId: req.requestId,
        conversationId,
        outcome: 'failed',
        stage: 'callback',
        errorCode,
        errorMessage: err?.message || result?.errorMessage || 'Ödeme doğrulanamadı.',
        durationMs,
        statusCode: 200,
        userId: req.auth?.sub || '',
        userEmail: req.auth?.email || '',
        sessionId: getSessionContextFromRequest(req),
      }, 'warn');
      await addAudit(store, 'website', 'iyzico ödeme doğrulama başarısız', {
        conversationId,
        severity: 'warning',
        requestId: req.requestId,
        durationMs,
        errorCode,
        errorMessage: err?.message || result?.errorMessage || 'Ödeme doğrulanamadı.',
        sessionId: getSessionContextFromRequest(req),
      });
      await persist(store);
      const redirectHref = buildResultRedirect('failed', {
        conversationId,
        error: errorCode,
      }, customer?.locale || pendingPayment?.locale || fallbackResultLocale);
      return res.status(200).send(renderPaymentResultPage({
        success: false,
        title: 'Ödeme tamamlanamadı',
        message: 'Ödeme doğrulanamadı. Lütfen tekrar deneyin veya danışmanınızla iletişime geçin.',
        redirectHref,
      }));
    }

    const resultAmount = normalizePaymentAmount(result.paidPrice || result.price);
    const resultCurrency = normalizePaymentCurrency(result.currency || pendingPayment?.currency || 'TRY');
    const resultOrderId = String(result.basketId || pendingPayment?.orderId || result.paymentId || '').trim();
    const expectedAmount = pendingPayment?.expectedAmount || pendingPayment?.amount;
    const expectedCurrency = pendingPayment?.expectedCurrency || pendingPayment?.currency || 'TRY';
    const dataQualityErrors = [];
    if (!customer) dataQualityErrors.push('customer_not_found');
    if (pendingPayment?.orderId && result.basketId && String(pendingPayment.orderId) !== String(result.basketId)) {
      dataQualityErrors.push('order_mismatch');
    }
    if (!resultAmount || (expectedAmount && !amountsMatch(resultAmount, expectedAmount))) {
      dataQualityErrors.push('amount_mismatch');
    }
    if (!resultCurrency || (expectedCurrency && resultCurrency !== normalizePaymentCurrency(expectedCurrency))) {
      dataQualityErrors.push('currency_mismatch');
    }

    if (dataQualityErrors.length) {
      const durationMs = observeDuration(startedAt);
      if (customer) {
        await recordCompletedPayment(store, {
          customerId: conversationId,
          amount: pendingPayment?.amount || resultAmount || 0,
          currency: pendingPayment?.currency || resultCurrency || 'TRY',
          orderId: pendingPayment?.orderId || resultOrderId || `IYZ-FAILED-${Date.now()}`,
          paymentMethod: 'iyzico',
          description: 'iyzico callback data quality failed',
          paymentStatus: 'failed',
          providerToken: token,
          providerPaymentId: result.paymentId || '',
          callbackId: result.paymentId || token,
          environment: pendingPayment?.environment || getIyzicoEnvironment(store.siteSettings || {}),
          expectedAmount: expectedAmount || pendingPayment?.amount || 0,
          expectedCurrency: expectedCurrency || pendingPayment?.currency || 'TRY',
          ip: getClientIp(req),
        });
      }
      emitStructuredLog('iyzico_flow', {
        requestId: req.requestId,
        conversationId,
        outcome: 'failed',
        stage: 'callback_data_quality',
        errorCode: dataQualityErrors.join(','),
        durationMs,
        statusCode: 200,
        paymentId: result.paymentId || '',
        basketId: result.basketId || '',
      }, 'error');
      await addAudit(store, 'website', 'iyzico ödeme veri doğrulaması başarısız', {
        conversationId,
        severity: 'critical',
        requestId: req.requestId,
        durationMs,
        errors: dataQualityErrors,
        paymentId: result.paymentId || '',
        basketId: result.basketId || '',
      });
      await persist(store);
      const redirectHref = buildResultRedirect('failed', {
        conversationId,
        orderId: resultOrderId || pendingPayment?.orderId || '',
        error: dataQualityErrors.join(','),
      }, customer?.locale || pendingPayment?.locale || fallbackResultLocale);
      return res.status(200).send(renderPaymentResultPage({
        success: false,
        title: 'Ödeme doğrulanamadı',
        message: 'Ödeme bilgileri beklenen kayıtla eşleşmedi. Lütfen danışmanınızla iletişime geçin.',
        redirectHref,
      }));
    }

    const paymentResult = {
      customerId: conversationId,
      amount: resultAmount,
      currency: resultCurrency,
      orderId: resultOrderId || result.paymentId || `IYZ-${Date.now()}`,
      paymentMethod: 'iyzico',
      description: 'iyzico checkout form payment',
      paymentStatus: 'completed',
      providerToken: token,
      providerPaymentId: result.paymentId || '',
      callbackId: result.paymentId || token,
      environment: pendingPayment?.environment || getIyzicoEnvironment(store.siteSettings || {}),
      expectedAmount: expectedAmount || resultAmount,
      expectedCurrency: expectedCurrency || resultCurrency,
      ip: getClientIp(req),
    };

    await recordCompletedPayment(store, paymentResult);
    if (customer) {
      customer.paymentStatus = 'completed';
      customer.updatedAt = now();
    }
    const durationMs = observeDuration(startedAt);
    emitStructuredLog('iyzico_flow', {
      requestId: req.requestId,
      conversationId,
      outcome: 'success',
      stage: 'callback',
      durationMs,
      statusCode: 200,
      userId: req.auth?.sub || '',
      userEmail: req.auth?.email || '',
      sessionId: getSessionContextFromRequest(req),
      paymentId: result.paymentId || '',
      basketId: result.basketId || '',
    }, 'info');
    await addAudit(store, 'website', `iyzico ödeme doğrulandı: ${conversationId}`, {
      conversationId,
      severity: 'info',
      requestId: req.requestId,
      durationMs,
      paymentId: result.paymentId || '',
      basketId: result.basketId || '',
      sessionId: getSessionContextFromRequest(req),
    });
    await persist(store);
    const redirectHref = buildResultRedirect('success', {
      conversationId,
      orderId: paymentResult.orderId,
      paymentId: paymentResult.providerPaymentId || result.paymentId || '',
    }, customer?.locale || pendingPayment?.locale || fallbackResultLocale);

    return res.status(200).send(renderPaymentResultPage({
      success: true,
      title: 'Teşekkürler, ödemeniz alındı',
      message: 'Teşekkürler ödemeniz alınmıştır, Danışmanımız en kısa zamanda sizinle iletişime geçecek, gerekli bilgilendirmeleri yapacaktır.',
      redirectHref,
    }));
  });
});

app.all('/', (_req, res) => {
  if (existsSync(clientDistDir)) {
    res.sendFile(path.join(clientDistDir, 'index.html'));
    return;
  }
  res.send(`onlinesmmm backend is running. Try /api/health or /api/site-settings/public`);
});

app.use('/uploads', (_req, res) => {
  res.status(404).send('Uploads are not served directly.');
});

app.get(/^(?!\/api\/).*/, (_req, res, next) => {
  if (!existsSync(clientDistDir)) {
    return next();
  }
  return res.sendFile(path.join(clientDistDir, 'index.html'));
});

app.get('/api', (_req, res) => {
  res.json({ ok: true, message: 'onlinesmmm backend API is running', routes: ['/api/health', '/api/site-settings/public'] });
});

app.get('/api/crm/events', requireAuth, requireRole('superadmin'), async (req, res) => {
  const store = await db();
  res.json({ crmEvents: store.crmEvents.slice(0, 50) });
});

app.use((error, _req, res, next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'Dosya boyutu 10 MB sınırını aştı.' });
  }
  if (error && error.message && error.message.includes('Güvenlik ihlali')) {
    return res.status(400).json({ message: error.message });
  }
  return next(error);
});

app.use((req, res) => {
  res.status(404).send(`onlinesmmm backend: ${req.method} ${req.originalUrl} not found. Use / or /api/health`);
});

if (isDirectServerRun && process.env.IYZICO_SYNC_DISABLED !== 'true') {
  const iyzicoSyncIntervalMs = Number(process.env.IYZICO_SYNC_INTERVAL_MS || 10 * 60_000);
  const iyzicoSyncTimer = setInterval(() => {
    syncPendingIyzicoPayments().catch((error) => {
      emitStructuredLog('iyzico_flow', {
        stage: 'payment_sync',
        outcome: 'error',
        errorCode: error?.code || error?.name || 'iyzico_sync_error',
        errorMessage: error?.message || 'Unknown sync error',
      }, 'error');
    });
  }, Math.max(60_000, iyzicoSyncIntervalMs));
  iyzicoSyncTimer.unref?.();
}

if (isDirectServerRun && process.env.WHATSAPP_NOTIFICATION_RETRY_DISABLED !== 'true') {
  const whatsappRetryTimer = setInterval(() => {
    retryPendingOperationalWhatsAppNotifications().catch((error) => {
      emitStructuredLog('whatsapp_delivery', {
        delivery: 'retry_loop_failed',
        errorCode: error?.code || error?.name || 'whatsapp_retry_loop_failed',
        errorMessage: error?.message || 'Unknown WhatsApp retry error',
      }, 'error');
    });
  }, whatsappNotificationRetryIntervalMs);
  whatsappRetryTimer.unref?.();
}

if (isDirectServerRun) {
  app.listen(port, () => {
    console.log(`onlinesmmm backend listening on http://localhost:${port}`);
  });
}

export {
  app,
  buildAuthCookie,
  buildWhatsAppDeliverySummary,
  clearAuthCookie,
  clearLoginFailures,
  createLoginChallengeRecord,
  getLoginChallenge,
  getServerMailSettings,
  htmlToPlainText,
  isLoginLocked,
  isMeaningfulLeadProgressStep,
  isPackageReadyTransition,
  normalizeEmailList,
  normalizePaymentAmount,
  normalizePaymentCurrency,
  normalizeLeadProgressNotificationKey,
  normalizeLeadProgressPayload,
  buildApplicationPackageNotificationKey,
  recordCompletedPayment,
  registerLoginFailure,
  resolvePaymentCallbackUrl,
  resolvePaymentResultUrl,
  renderPaymentResultPage,
  sanitizeEmailHtml,
  sendMailWithRetry,
  validatePasswordStrength,
  shouldRecordLeadProgressSnapshot,
  collectLeadProgressChanges,
  buildLeadProgressSignature,
  findWhatsAppConnectionConflict,
  findWhatsAppOwnerConflict,
  validateUploadedFileSafety,
  validateTurnstileToken,
  validateMailIdentity,
  verifyLoginChallengeCode,
  withTimeout,
};
