import path from 'node:path';
import { existsSync } from 'node:fs';
import { access, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import qrcode from 'qrcode';
import { Client } from 'whatsapp-web.js';
import wwebjs from 'whatsapp-web.js';

dotenv.config({ path: process.env.ONLINESMMM_ENV_FILE || '/var/www/onlinesmmm/.env', quiet: true });
dotenv.config({ quiet: true });

const { LocalAuth, MessageMedia } = wwebjs;

import { execFileSync, execSync } from 'node:child_process';

function getChromiumPath() {
  const configuredPath = process.env.WHATSAPP_CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '';
  if (configuredPath && existsSync(configuredPath)) return configuredPath;

  const binaryNames = [
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
  ];
  for (const binaryName of binaryNames) {
    try {
      const p = execSync(`command -v ${binaryName}`, { stdio: 'pipe' }).toString().trim();
      if (p && existsSync(p)) return p;
    } catch {}
  }

  try {
    const p = execSync('which chromium', { stdio: 'pipe' }).toString().trim();
    if (p && existsSync(p)) return p;
  } catch {}
  const paths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/run/current-system/sw/bin/chromium',
    '/root/.cache/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome',
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  if (process.platform === 'linux') {
    try {
      const p = execSync("find /root/.cache/puppeteer /home -path '*/chrome-linux64/chrome' -type f -perm -111 2>/dev/null | head -n 1", { stdio: 'pipe' }).toString().trim();
      if (p && existsSync(p)) return p;
    } catch {}
  }
  return undefined;
}

function isSingleProcessChromeEnabled() {
  return String(process.env.WHATSAPP_CHROME_SINGLE_PROCESS || '').toLowerCase() === 'true';
}

export function getPuppeteerArgs() {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ];
  if (isSingleProcessChromeEnabled()) {
    args.push('--single-process');
  }
  return args;
}

export function describeChromeLaunchFailure(error) {
  const message = String(error?.message || error || '');
  const lower = message.toLowerCase();
  if (lower.includes('libgbm.so.1') || lower.includes('error while loading shared libraries')) {
    return [
      'WhatsApp tarayıcısı başlatılamadı: sunucuda Chrome/Chromium sistem kütüphaneleri eksik.',
      'Sunucuda şu paketleri kurun: libgbm1, libnss3, libatk-bridge2.0-0, libgtk-3-0, libxss1, libasound2, fonts-liberation.',
      'Kurulumdan sonra PM2 uygulamasını /var/www/onlinesmmm dizininden --update-env ile yeniden başlatın.',
    ].join(' ');
  }
  if (lower.includes('no usable sandbox') || lower.includes('running as root without --no-sandbox')) {
    return 'WhatsApp tarayıcısı sandbox nedeniyle başlatılamadı. Uygulama --no-sandbox ve --disable-setuid-sandbox ile başlatılıyor; sunucuda Chrome bağımlılıklarını kontrol edin.';
  }
  return message || 'WhatsApp tarayıcısı başlatılamadı.';
}

const connectionRuntimes = new Map();
const sendQueues = new Map();
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 12_000;
const STANDBY_AFTER_READY_MS = Math.max(0, Number(process.env.WHATSAPP_STANDBY_AFTER_READY_MS || 0));
const QR_TIMEOUT_MS = 3 * 60_000;
const NOT_READY_TIMEOUT_MS = 4 * 60_000;
const MAX_RECONNECT_ATTEMPTS = 6;
const BASE_RECONNECT_DELAY_MS = 2_000;
const PAIRING_READY_TIMEOUT_MS = Number(process.env.WHATSAPP_PAIRING_READY_TIMEOUT_MS || 150_000);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '..');

export function getWhatsAppWebVersionOptions() {
  const webVersion = String(process.env.WHATSAPP_WEB_VERSION || '').trim();
  const remotePath = String(process.env.WHATSAPP_WEB_VERSION_REMOTE_PATH || '').trim();
  const cacheType = String(process.env.WHATSAPP_WEB_VERSION_CACHE_TYPE || '').trim().toLowerCase();
  const options = {};

  if (webVersion) {
    options.webVersion = webVersion;
  }

  if (remotePath) {
    options.webVersionCache = {
      type: 'remote',
      remotePath,
      strict: String(process.env.WHATSAPP_WEB_VERSION_STRICT || '').toLowerCase() === 'true',
    };
  } else if (cacheType && ['local', 'none'].includes(cacheType)) {
    options.webVersionCache = { type: cacheType };
  }

  return options;
}

function getSessionDir() {
  return path.resolve(process.env.WHATSAPP_SESSION_DIR || path.join(projectRoot, 'server-data', 'whatsapp-sessions'));
}

function getLocalAuthSessionPath(connectionId) {
  return path.join(getSessionDir(), `session-${connectionId}`);
}

export async function getWhatsAppPreflightStatus() {
  const executablePath = getChromiumPath();
  const sessionDir = getSessionDir();
  const expectedCwd = projectRoot;
  const cwd = process.cwd();
  const missingLibraries = [];
  let chromeVersion = '';
  let chromeExecutable = Boolean(executablePath);
  let chromeError = '';
  let sessionWritable = false;
  let sessionError = '';

  if (executablePath) {
    try {
      chromeVersion = execFileSync(executablePath, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
    } catch (error) {
      chromeExecutable = false;
      chromeError = String(error?.message || error || 'chrome_version_failed');
    }

    if (process.platform === 'linux') {
      try {
        const lddOutput = execFileSync('ldd', [executablePath], { encoding: 'utf8', timeout: 5000 });
        for (const line of lddOutput.split('\n')) {
          if (line.includes('not found')) {
            missingLibraries.push(line.trim().split(/\s+/)[0]);
          }
        }
      } catch (error) {
        if (!chromeError) {
          chromeError = String(error?.message || error || 'ldd_check_failed');
        }
      }
    }
  }

  try {
    await mkdir(sessionDir, { recursive: true });
    await access(sessionDir, fsConstants.R_OK | fsConstants.W_OK);
    const probePath = path.join(sessionDir, `.write-probe-${process.pid}-${Date.now()}`);
    await writeFile(probePath, 'ok', 'utf8');
    await unlink(probePath);
    sessionWritable = true;
  } catch (error) {
    sessionError = String(error?.message || error || 'session_write_failed');
  }

  const cwdOk = path.resolve(cwd) === path.resolve(expectedCwd);
  const ok = Boolean(executablePath) && chromeExecutable && !missingLibraries.length && sessionWritable && cwdOk;
  return {
    ok,
    platform: process.platform,
    cwd,
    expectedCwd,
    cwdOk,
    executablePath: executablePath || '',
    chromeFound: Boolean(executablePath),
    chromeExecutable,
    chromeVersion,
    chromeError,
    missingLibraries,
    sessionDir,
    sessionWritable,
    sessionError,
    singleProcessEnabled: isSingleProcessChromeEnabled(),
    configuredChromePath: process.env.WHATSAPP_CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '',
    hints: [
      !executablePath ? 'Chrome/Chromium bulunamadı veya WHATSAPP_CHROME_PATH geçersiz.' : '',
      missingLibraries.length ? `Eksik Chrome kütüphaneleri: ${missingLibraries.join(', ')}` : '',
      !sessionWritable ? 'WhatsApp session klasörü yazılabilir değil.' : '',
      !cwdOk ? 'PM2 uygulama çalışma dizini /var/www/onlinesmmm olmalı.' : '',
    ].filter(Boolean),
  };
}

export function sanitizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

function now() {
  return new Date().toISOString();
}

function createInitialState(connection) {
  return {
    id: connection.id,
    method: connection.method,
    label: connection.label,
    phone: connection.phone,
    isActive: Boolean(connection.isActive),
    status: connection.status || 'disconnected',
    qrDataUrl: connection.qrDataUrl || '',
    pairingCode: connection.pairingCode || '',
    lastError: connection.lastError || '',
    lastSyncedAt: connection.lastSyncedAt || '',
    sessionPhone: connection.sessionPhone || '',
    reconnectAttempts: Number(connection.reconnectAttempts || 0),
    lastHeartbeatAt: connection.lastHeartbeatAt || '',
  };
}

function getRuntime(connectionId) {
  return connectionRuntimes.get(connectionId) || null;
}

function isPairingVisibleState(state = {}) {
  if (!state) return false;
  if (state.status === 'ready') return true;
  if (state.status === 'qr' && (state.qrDataUrl || state.pairingCode)) return true;
  return false;
}

function waitForPairingVisibleState(connectionId, timeoutMs = PAIRING_READY_TIMEOUT_MS) {
  const runtime = getRuntime(connectionId);
  if (!runtime) {
    return Promise.reject(new Error('WhatsApp runtime not found.'));
  }
  runtime.pairingWaiters ||= new Set();
  if (isPairingVisibleState(runtime.state)) {
    return Promise.resolve(runtime.state);
  }

  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject };
    const timeoutId = setTimeout(() => {
      runtime.pairingWaiters.delete(waiter);
      const error = new Error('WhatsApp eşleştirme kodu zamanında üretilemedi. Lütfen birkaç saniye sonra tekrar deneyin.');
      error.code = 'whatsapp_pairing_code_timeout';
      reject(error);
    }, timeoutMs);
    waiter.resolve = (state) => {
      clearTimeout(timeoutId);
      resolve(state);
    };
    waiter.reject = (error) => {
      clearTimeout(timeoutId);
      reject(error);
    };
    runtime.pairingWaiters.add(waiter);
  });
}

function notifyPairingWaiters(runtime, state) {
  if (!runtime?.pairingWaiters?.size) return;
  if (!isPairingVisibleState(state)) return;
  for (const waiter of runtime.pairingWaiters) {
    waiter.resolve(state);
  }
  runtime.pairingWaiters.clear();
}

function rejectPairingWaiters(runtime, error) {
  if (!runtime?.pairingWaiters?.size) return;
  for (const waiter of runtime.pairingWaiters) {
    waiter.reject(error);
  }
  runtime.pairingWaiters.clear();
}

function ensureRuntime(connection) {
  let runtime = connectionRuntimes.get(connection.id);
  if (runtime) {
    runtime.connection = { ...runtime.connection, ...connection };
    runtime.pairingWaiters ||= new Set();
    runtime.state = {
      ...runtime.state,
      method: connection.method,
      label: connection.label,
      phone: connection.phone,
      isActive: Boolean(connection.isActive),
    };
    return runtime;
  }

  runtime = {
    connection: { ...connection },
    client: null,
    state: createInitialState(connection),
    initPromise: null,
    reconnectTimer: null,
    heartbeatTimer: null,
    standbyTimer: null,
    qrTimeoutTimer: null,
    notReadyTimer: null,
    pairingWaiters: new Set(),
    reconnectAttempts: Number(connection.reconnectAttempts || 0),
    stopRequested: false,
    standbyRequested: false,
    initializing: false,
    createdAt: Date.now(),
    lastReadyAt: null,
    lastStandbyAt: null,
    lastHeartbeatAt: null,
  };
  connectionRuntimes.set(connection.id, runtime);
  return runtime;
}

function clearTimers(runtime) {
  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }
  if (runtime.heartbeatTimer) {
    clearInterval(runtime.heartbeatTimer);
    runtime.heartbeatTimer = null;
  }
  if (runtime.standbyTimer) {
    clearTimeout(runtime.standbyTimer);
    runtime.standbyTimer = null;
  }
  if (runtime.qrTimeoutTimer) {
    clearTimeout(runtime.qrTimeoutTimer);
    runtime.qrTimeoutTimer = null;
  }
  if (runtime.notReadyTimer) {
    clearTimeout(runtime.notReadyTimer);
    runtime.notReadyTimer = null;
  }
}

function stopHeartbeat(runtime) {
  if (runtime.heartbeatTimer) {
    clearInterval(runtime.heartbeatTimer);
    runtime.heartbeatTimer = null;
  }
}

async function enterStandby(connectionId, onStateChange, reason = 'standby_idle') {
  const runtime = getRuntime(connectionId);
  if (!runtime || !runtime.client || runtime.state.status !== 'ready' || runtime.stopRequested) return null;

  runtime.standbyRequested = true;
  runtime.lastStandbyAt = now();
  if (runtime.standbyTimer) {
    clearTimeout(runtime.standbyTimer);
    runtime.standbyTimer = null;
  }
  stopHeartbeat(runtime);

  try {
    await runtime.client.destroy();
  } catch {
    // Browser may already be closed while entering standby.
  }

  runtime.client = null;
  runtime.initPromise = null;
  runtime.initializing = false;
  return emitState(connectionId, {
    status: 'standby',
    qrDataUrl: '',
    pairingCode: '',
    lastError: '',
    lastStandbyAt: runtime.lastStandbyAt,
    standbyReason: reason,
  }, onStateChange);
}

function scheduleStandby(connectionId, onStateChange) {
  const runtime = getRuntime(connectionId);
  if (!runtime || !STANDBY_AFTER_READY_MS) return;
  if (runtime.standbyTimer) {
    clearTimeout(runtime.standbyTimer);
  }
  runtime.standbyTimer = setTimeout(() => {
    void enterStandby(connectionId, onStateChange);
  }, STANDBY_AFTER_READY_MS);
}

function scheduleNotReadyTimeout(connectionId, onStateChange, reason = 'not_ready_timeout') {
  const runtime = getRuntime(connectionId);
  if (!runtime) return;
  if (runtime.notReadyTimer) {
    clearTimeout(runtime.notReadyTimer);
  }
  runtime.notReadyTimer = setTimeout(async () => {
    const current = getRuntime(connectionId);
    if (!current || current.state.status === 'ready' || current.stopRequested) return;
    await disconnectWhatsAppClient(connectionId, reason);
    await emitState(connectionId, {
      status: 'disconnected',
      qrDataUrl: '',
      pairingCode: '',
      lastError: reason,
    }, onStateChange);
  }, NOT_READY_TIMEOUT_MS);
}

function scheduleQrTimeout(connectionId, onStateChange) {
  const runtime = getRuntime(connectionId);
  if (!runtime) return;
  if (runtime.qrTimeoutTimer) {
    clearTimeout(runtime.qrTimeoutTimer);
  }
  runtime.qrTimeoutTimer = setTimeout(async () => {
    const current = getRuntime(connectionId);
    if (!current || current.state.status !== 'qr' || current.stopRequested) return;
    await disconnectWhatsAppClient(connectionId, 'qr_pairing_timeout');
    await emitState(connectionId, {
      status: 'disconnected',
      qrDataUrl: '',
      pairingCode: '',
      lastError: 'qr_pairing_timeout',
    }, onStateChange);
  }, QR_TIMEOUT_MS);
}

function startHeartbeat(connectionId, onStateChange, _onInboundMessage) {
  const runtime = getRuntime(connectionId);
  if (!runtime || !runtime.client || runtime.heartbeatTimer) return;

  runtime.heartbeatTimer = setInterval(async () => {
    const current = getRuntime(connectionId);
    if (!current || !current.client || current.state.status !== 'ready') {
      return;
    }

    try {
      const state = await Promise.race([
      current.client.getState(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('heartbeat_timeout')), HEARTBEAT_TIMEOUT_MS)),
      ]);

      if (String(state || '').toUpperCase() !== 'CONNECTED') {
        current.heartbeatFailures = Number(current.heartbeatFailures || 0) + 1;
        await emitState(connectionId, {
          status: 'ready',
          lastHeartbeatAt: now(),
          lastError: `heartbeat:${state || 'unknown'}`,
          heartbeatFailures: current.heartbeatFailures,
        }, onStateChange);
        return;
      }
      current.heartbeatFailures = 0;
      current.lastHeartbeatAt = now();
      await emitState(connectionId, {
        status: 'ready',
        lastHeartbeatAt: current.lastHeartbeatAt,
        lastError: '',
        heartbeatFailures: 0,
      }, onStateChange);
    } catch (error) {
      current.heartbeatFailures = Number(current.heartbeatFailures || 0) + 1;
      await emitState(connectionId, {
        status: 'ready',
        lastHeartbeatAt: now(),
        lastError: error.message || 'heartbeat_failed',
        heartbeatFailures: current.heartbeatFailures,
      }, onStateChange);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

async function emitState(connectionId, partial, onStateChange) {
  const runtime = getRuntime(connectionId);
  if (!runtime) return null;

  const nextState = {
    ...runtime.state,
    ...partial,
    lastSyncedAt: now(),
  };
  runtime.state = nextState;
  runtime.connection = {
    ...runtime.connection,
    ...partial,
    lastSyncedAt: nextState.lastSyncedAt,
  };
  await onStateChange(connectionId, nextState);
  notifyPairingWaiters(runtime, nextState);
  return nextState;
}

function scheduleReconnect(connectionId, onStateChange, onInboundMessage, reason = 'reconnect') {
  const runtime = getRuntime(connectionId);
  if (!runtime || runtime.stopRequested) return;

  clearTimers(runtime);
  if (runtime.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    void emitState(connectionId, {
      status: 'failed',
      lastError: `${reason}: max reconnect attempts reached`,
    }, onStateChange);
    return;
  }

  runtime.reconnectAttempts += 1;
  const delay = Math.min(60_000, BASE_RECONNECT_DELAY_MS * 2 ** (runtime.reconnectAttempts - 1));
  runtime.reconnectTimer = setTimeout(async () => {
    runtime.reconnectTimer = null;
    try {
      await initializeClient(connectionId, onStateChange, onInboundMessage, true);
    } catch (error) {
      await emitState(connectionId, {
        status: 'failed',
        lastError: error.message || `reconnect_failed:${reason}`,
        reconnectAttempts: runtime.reconnectAttempts,
      }, onStateChange);
      scheduleReconnect(connectionId, onStateChange, onInboundMessage, reason);
    }
  }, delay);
}

async function attachClient(connection, client, onStateChange, onInboundMessage) {
  const runtime = ensureRuntime(connection);
  runtime.client = client;
  runtime.initializing = true;
  runtime.stopRequested = false;

  client.on('qr', async (qr) => {
    const qrDataUrl = await qrcode.toDataURL(qr);
    scheduleQrTimeout(connection.id, onStateChange);
    scheduleNotReadyTimeout(connection.id, onStateChange, 'not_ready_timeout');
    await emitState(connection.id, {
      status: 'qr',
      qrDataUrl,
      pairingCode: '',
      lastError: '',
      reconnectAttempts: runtime.reconnectAttempts,
    }, onStateChange);
  });

  client.on('code', async (code) => {
    scheduleQrTimeout(connection.id, onStateChange);
    scheduleNotReadyTimeout(connection.id, onStateChange, 'not_ready_timeout');
    await emitState(connection.id, {
      status: 'qr',
      pairingCode: code,
      qrDataUrl: '',
      lastError: '',
      reconnectAttempts: runtime.reconnectAttempts,
    }, onStateChange);
  });

  client.on('authenticated', async () => {
    runtime.reconnectAttempts = 0;
    scheduleNotReadyTimeout(connection.id, onStateChange, 'authenticated_not_ready_timeout');
    await emitState(connection.id, {
      status: 'auth',
      qrDataUrl: '',
      pairingCode: '',
      lastError: '',
      reconnectAttempts: 0,
    }, onStateChange);
  });

  client.on('ready', async () => {
    runtime.reconnectAttempts = 0;
    if (runtime.qrTimeoutTimer) {
      clearTimeout(runtime.qrTimeoutTimer);
      runtime.qrTimeoutTimer = null;
    }
    if (runtime.notReadyTimer) {
      clearTimeout(runtime.notReadyTimer);
      runtime.notReadyTimer = null;
    }
    runtime.lastReadyAt = now();
    runtime.standbyRequested = false;
    const info = client.info;
    await emitState(connection.id, {
      status: 'ready',
      qrDataUrl: '',
      pairingCode: '',
      sessionPhone: info?.wid?.user || sanitizePhone(connection.phone),
      lastError: '',
      reconnectAttempts: 0,
      lastHeartbeatAt: now(),
    }, onStateChange);
    startHeartbeat(connection.id, onStateChange, onInboundMessage);
    scheduleStandby(connection.id, onStateChange);
  });

  client.on('auth_failure', async (message) => {
    stopHeartbeat(runtime);
    await emitState(connection.id, {
      status: 'failed',
      lastError: message || 'Authentication failed',
      reconnectAttempts: runtime.reconnectAttempts,
    }, onStateChange);
    scheduleReconnect(connection.id, onStateChange, onInboundMessage, 'auth_failure');
  });

  client.on('disconnected', async (reason) => {
    if (runtime.standbyRequested) {
      return;
    }
    stopHeartbeat(runtime);
    await emitState(connection.id, {
      status: 'disconnected',
      lastError: reason || 'Disconnected',
      reconnectAttempts: runtime.reconnectAttempts,
    }, onStateChange);
    if (!runtime.stopRequested) {
      scheduleReconnect(connection.id, onStateChange, onInboundMessage, 'disconnected');
    }
  });

  client.on('message', async (message) => {
    await onInboundMessage(connection.id, {
      from: message.from,
      body: message.body,
      timestamp: message.timestamp,
      hasMedia: message.hasMedia,
    });
  });

  client.on('change_state', async (state) => {
    if (String(state || '').toUpperCase() === 'CONNECTED') {
      runtime.lastHeartbeatAt = now();
      runtime.state.lastHeartbeatAt = runtime.lastHeartbeatAt;
    }
  });
}

async function createClient(connection, onStateChange, onInboundMessage) {
  const executablePath = getChromiumPath();
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: connection.id,
      dataPath: getSessionDir(),
    }),
    ...getWhatsAppWebVersionOptions(),
    pairWithPhoneNumber:
      connection.method === 'phone' && connection.phone
        ? {
            phoneNumber: sanitizePhone(connection.phone),
            showNotification: false,
            intervalMs: 300000,
          }
        : undefined,
    puppeteer: {
      headless: true,
      executablePath: executablePath || undefined,
      protocolTimeout: Number(process.env.WHATSAPP_PROTOCOL_TIMEOUT_MS || 180_000),
      args: getPuppeteerArgs(),
    },
  });

  await attachClient(connection, client, onStateChange, onInboundMessage);
  return client;
}

async function initializeClient(connectionId, onStateChange, onInboundMessage, isReconnect = false) {
  const runtime = getRuntime(connectionId);
  if (!runtime) {
    throw new Error('WhatsApp runtime not found.');
  }

  if (runtime.client && runtime.state.status === 'ready') {
    return runtime.state;
  }
  if (runtime.initPromise) {
    return runtime.initPromise;
  }

  const connection = runtime.connection;
  runtime.initPromise = (async () => {
    clearTimers(runtime);
    runtime.stopRequested = false;
    runtime.standbyRequested = false;
    runtime.initializing = true;
    if (runtime.client && !isReconnect) {
      return runtime.state;
    }

    if (runtime.client && isReconnect) {
      try {
        await runtime.client.destroy();
      } catch {
        // Ignore destroy failures before reconnect.
      }
      runtime.client = null;
    }

    await emitState(connection.id, {
      status: 'auth',
      lastError: '',
      reconnectAttempts: runtime.reconnectAttempts,
    }, onStateChange);

    runtime.client = await createClient(connection, onStateChange, onInboundMessage);
    const initializePromise = runtime.client.initialize()
      .then(() => runtime.state)
      .catch(async (error) => {
      stopHeartbeat(runtime);
      await emitState(connection.id, {
        status: 'failed',
        lastError: describeChromeLaunchFailure(error),
        reconnectAttempts: runtime.reconnectAttempts,
      }, onStateChange);
      rejectPairingWaiters(runtime, error);
      if (!runtime.stopRequested) {
        scheduleReconnect(connection.id, onStateChange, onInboundMessage, 'init_failed');
      }
      throw error;
      })
      .finally(() => {
        runtime.initializing = false;
        runtime.initPromise = null;
      });

    initializePromise.catch(() => {});
    await waitForPairingVisibleState(connection.id);

    return runtime.state;
  })();

  return runtime.initPromise;
}

export function getConnectionRuntime(connectionId) {
  const runtime = getRuntime(connectionId);
  return runtime?.state || null;
}

export async function ensureWhatsAppClient(connection, onStateChange, onInboundMessage) {
  const runtime = ensureRuntime(connection);
  if (runtime.client && ['qr', 'auth', 'ready'].includes(runtime.state.status)) {
    if (runtime.state.status === 'ready') {
      startHeartbeat(connection.id, onStateChange, onInboundMessage);
      scheduleStandby(connection.id, onStateChange);
    }
    return runtime.state;
  }
  if (runtime.client && ['failed', 'disconnected'].includes(runtime.state.status)) {
    return initializeClient(connection.id, onStateChange, onInboundMessage, true);
  }
  return initializeClient(connection.id, onStateChange, onInboundMessage, false);
}

export async function sendWhatsAppMessage(connectionId, toPhone, body, attachments = []) {
  const currentQueue = sendQueues.get(connectionId) || Promise.resolve();
  const nextQueue = currentQueue.then(async () => {
    const runtime = getRuntime(connectionId);
    if (!runtime || !runtime.client) {
      throw new Error('WhatsApp oturumu baslatilmadi.');
    }
    if (runtime.state.status !== 'ready') {
      throw new Error('WhatsApp oturumu hazir degil.');
    }
    const normalized = `${sanitizePhone(toPhone)}@c.us`;
    if (String(body || '').trim()) {
      await runtime.client.sendMessage(normalized, body);
    }
    for (const attachment of attachments || []) {
      if (!attachment?.filePath) continue;
      const media = MessageMedia.fromFilePath(attachment.filePath);
      await runtime.client.sendMessage(normalized, media, {
        caption: String(attachment.caption || attachment.filename || attachment.name || '').slice(0, 1024),
      });
    }
  });
  sendQueues.set(connectionId, nextQueue.catch(() => {}));
  return nextQueue;
}

export async function disconnectWhatsAppClient(connectionId, reason = 'Disconnected by operator') {
  const runtime = getRuntime(connectionId);
  if (!runtime) return;

  runtime.stopRequested = true;
  clearTimers(runtime);
  sendQueues.delete(connectionId);

  if (runtime.client) {
    try {
      await runtime.client.destroy();
    } catch {
      // Ignore shutdown errors.
    }
  }

  runtime.client = null;
  runtime.initPromise = null;
  runtime.reconnectAttempts = 0;
  runtime.state = {
    ...runtime.state,
    status: 'disconnected',
    qrDataUrl: '',
    pairingCode: '',
    lastError: reason,
    lastSyncedAt: now(),
  };
}

export async function resetWhatsAppSession(connectionId, reason = 'session_reset') {
  await disconnectWhatsAppClient(connectionId, reason);
  await rm(getLocalAuthSessionPath(connectionId), { recursive: true, force: true });
}

export async function refreshWhatsAppHeartbeat(connectionId) {
  const runtime = getRuntime(connectionId);
  if (!runtime?.client) return null;
  try {
    const state = await runtime.client.getState();
    runtime.lastHeartbeatAt = now();
    runtime.state.lastHeartbeatAt = runtime.lastHeartbeatAt;
    if (String(state || '').toUpperCase() !== 'CONNECTED') {
      runtime.state.status = 'failed';
      runtime.state.lastError = `heartbeat:${state || 'unknown'}`;
    }
    return state;
  } catch (error) {
    runtime.state.status = 'failed';
    runtime.state.lastError = error.message || 'heartbeat_failed';
    return null;
  }
}

export function listWhatsAppConnectionStates() {
  return Array.from(connectionRuntimes.values()).map((runtime) => ({ ...runtime.state }));
}

export async function __resetWhatsAppRuntimeForTest() {
  for (const runtime of connectionRuntimes.values()) {
    clearTimers(runtime);
    if (runtime.client?.destroy) {
      await Promise.resolve(runtime.client.destroy()).catch(() => {});
    }
  }
  connectionRuntimes.clear();
  sendQueues.clear();
}

export function __setWhatsAppRuntimeForTest(connectionId, runtime) {
  connectionRuntimes.set(connectionId, {
    connection: { id: connectionId, ...(runtime.connection || {}) },
    client: runtime.client || null,
    state: {
      id: connectionId,
      status: 'disconnected',
      ...(runtime.state || {}),
    },
    initPromise: null,
    reconnectTimer: null,
    heartbeatTimer: null,
    standbyTimer: null,
    qrTimeoutTimer: null,
    notReadyTimer: null,
    pairingWaiters: new Set(),
    reconnectAttempts: 0,
    stopRequested: false,
    standbyRequested: false,
    initializing: false,
    createdAt: Date.now(),
    lastReadyAt: null,
    lastStandbyAt: null,
    lastHeartbeatAt: null,
    ...runtime,
  });
}
