import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { defaultLocationCatalog, normalizeLocationCatalog } from './locations.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(moduleDir, '..', 'server-data');
const uploadsDir = path.join(dataDir, 'uploads');
const dbPath = path.join(dataDir, 'db.json');
let saveStoreQueue = Promise.resolve();

const mergeArraySpecs = {
  auditLogs: {
    keys: ['id'],
    limit: 200,
    freshnessFields: ['createdAt'],
    preserveLatestMissing: true,
  },
  consentRecords: {
    keys: ['id'],
    limit: 2000,
    freshnessFields: ['createdAt'],
    preserveLatestMissing: true,
  },
  crmEvents: {
    keys: ['id'],
    freshnessFields: ['sentAt', 'createdAt'],
    preserveLatestMissing: true,
  },
  customerVisits: {
    keys: ['id', 'sessionId'],
    limit: 1000,
    freshnessFields: ['updatedAt', 'lastSeenAt', 'entryNotificationSentAt', 'firstSeenAt'],
    preserveLatestMissing: true,
  },
  leadNotificationLedger: {
    keys: ['key'],
    limit: 1000,
    freshnessFields: ['createdAt'],
    preserveLatestMissing: true,
  },
  mailDeliveries: {
    keys: ['id'],
    limit: 500,
    freshnessFields: ['updatedAt', 'sentAt', 'queuedAt', 'createdAt'],
    preserveLatestMissing: true,
  },
  operationalNotificationLedger: {
    keys: ['key'],
    limit: 1000,
    freshnessFields: ['lastWhatsAppRetryAt', 'createdAt'],
    preserveLatestMissing: true,
  },
  whatsappConnections: {
    keys: ['id'],
    freshnessFields: ['lastHeartbeatAt', 'lastSyncedAt', 'updatedAt', 'createdAt'],
    preserveLatestMissing: false,
  },
};

const defaultSiteSettings = {
  brandName: 'OnlineSMMM',
  primaryDomain: 'www.onlinesmmm.com',
  secondaryDomain: 'onlinesmmm.com.tr',
  supportEmail: 'info@onlinesmmm.com',
  supportPhone: '+90 555 000 00 00',
  workingHours: 'Pazartesi - Cuma 09:00 - 19:00',
  whatsappRoutingEnabled: true,
  notifyLeads: true,
  notifyPayments: true,
  notifyDocuments: true,
  customerVisitTrackingEnabled: true,
  leadProgressTrackingEnabled: true,
  turnstileSiteKey: '',
  campaignPopupEnabled: true,
  campaignPopupDelaySeconds: 10,
  campaignPopupActiveId: 'launch-2026-summer',
  campaignPopupArchive: [
    {
      id: 'launch-2026-summer',
      title: 'Şirket Açılışına Özel!',
      badge: '%20 İndirim Fırsatı',
      subtitle: 'Başlangıç paketlerinde özel kampanya',
      description: 'Şirketini 3 adımda kur, başvurunu hızla tamamla ve süreçleri tek panelden takip et.',
      ctaLabel: 'Hemen Başvur',
      ctaHref: '/basvuru',
      imageUrl: '/campaigns/opening-promo.jpg',
      endDate: '2026-07-31T23:59:59',
      delaySeconds: 10,
      isActive: true,
      archivedAt: '',
    },
  ],
  crmEnabled: false,
  crmWebhookUrl: '',
  crmAuthToken: '',
  websiteUrl: 'https://www.onlinesmmm.com',
  paymentCallbackUrl: 'https://www.onlinesmmm.com/odeme/callback',
  paymentResultUrl: 'https://www.onlinesmmm.com/odeme/sonuc',
  paymentCheckoutUrl: '',
  iyzicoInitializeEndpoint: '/api/public/iyzico/checkout/initialize',
  iyzicoEnvironment: 'live',
  iyzicoMerchantId: '',
  iyzicoApiKey: '',
  iyzicoSecretKey: '',
  locationSourceUrl: '',
  locationSourceFormat: 'json',
  locationAutoSyncEnabled: true,
  locationLastSyncAt: '',
  locationLastSyncStatus: 'pending',
  locationLastSyncError: '',
};

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getEntryIdentity(entry = {}, keys = []) {
  for (const key of keys) {
    const value = entry?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return `${key}:${String(value)}`;
    }
  }
  return '';
}

function getFreshnessMs(entry = {}, fields = []) {
  let freshness = 0;
  for (const field of fields) {
    const value = entry?.[field];
    const parsed = Date.parse(value || '');
    if (Number.isFinite(parsed) && parsed > freshness) {
      freshness = parsed;
    }
  }
  return freshness;
}

function mergeRecordByFreshness(latestRecord = {}, incomingRecord = {}, spec = {}) {
  if (!latestRecord) return incomingRecord;
  if (!incomingRecord) return latestRecord;

  const latestFreshness = getFreshnessMs(latestRecord, spec.freshnessFields || []);
  const incomingFreshness = getFreshnessMs(incomingRecord, spec.freshnessFields || []);
  if (latestFreshness > incomingFreshness) {
    return { ...incomingRecord, ...latestRecord };
  }
  return { ...latestRecord, ...incomingRecord };
}

function mergeArrayForSave(latestArray = [], incomingArray = [], spec = {}) {
  const latestById = new Map();
  for (const entry of Array.isArray(latestArray) ? latestArray : []) {
    const identity = getEntryIdentity(entry, spec.keys || []);
    if (identity) {
      latestById.set(identity, entry);
    }
  }

  const mergedById = new Map();
  const passthrough = [];
  for (const entry of Array.isArray(incomingArray) ? incomingArray : []) {
    const identity = getEntryIdentity(entry, spec.keys || []);
    if (!identity) {
      passthrough.push(entry);
      continue;
    }
    mergedById.set(identity, mergeRecordByFreshness(latestById.get(identity), entry, spec));
  }

  if (spec.preserveLatestMissing) {
    for (const [identity, entry] of latestById.entries()) {
      if (!mergedById.has(identity)) {
        mergedById.set(identity, entry);
      }
    }
  }

  const merged = [...mergedById.values(), ...passthrough];
  if (Array.isArray(spec.freshnessFields) && spec.freshnessFields.length) {
    merged.sort((left, right) => getFreshnessMs(right, spec.freshnessFields) - getFreshnessMs(left, spec.freshnessFields));
  }
  return Number(spec.limit || 0) > 0 ? merged.slice(0, Number(spec.limit)) : merged;
}

export function mergeStoreForSave(latestStore = {}, incomingStore = {}) {
  if (!latestStore || !Object.keys(latestStore).length) return incomingStore;
  const merged = {
    ...latestStore,
    ...incomingStore,
  };
  for (const [collectionName, spec] of Object.entries(mergeArraySpecs)) {
    merged[collectionName] = mergeArrayForSave(
      latestStore?.[collectionName],
      incomingStore?.[collectionName],
      spec,
    );
  }
  return merged;
}

function normalizeStore(store) {
  const locationCatalog = normalizeLocationCatalog(store?.locationCatalog || defaultLocationCatalog);
  const normalized = {
    siteSettings: { ...defaultSiteSettings, ...(store?.siteSettings || {}) },
    users: Array.isArray(store?.users) ? store.users : [],
    customers: Array.isArray(store?.customers) ? store.customers : [],
    messages: Array.isArray(store?.messages) ? store.messages : [],
    payments: Array.isArray(store?.payments) ? store.payments : [],
    customerVisits: Array.isArray(store?.customerVisits) ? store.customerVisits : [],
    consentRecords: Array.isArray(store?.consentRecords) ? store.consentRecords : [],
    crmEvents: Array.isArray(store?.crmEvents) ? store.crmEvents : [],
    mailDeliveries: Array.isArray(store?.mailDeliveries) ? store.mailDeliveries : [],
    whatsappConnections: Array.isArray(store?.whatsappConnections) ? store.whatsappConnections : [],
    auditLogs: Array.isArray(store?.auditLogs) ? store.auditLogs : [],
    leadNotificationLedger: Array.isArray(store?.leadNotificationLedger) ? store.leadNotificationLedger : [],
    operationalNotificationLedger: Array.isArray(store?.operationalNotificationLedger) ? store.operationalNotificationLedger : [],
    locationCatalog,
  };

  for (const key of ['websiteUrl', 'paymentCallbackUrl', 'paymentResultUrl', 'iyzicoInitializeEndpoint']) {
    if (!String(normalized.siteSettings[key] || '').trim()) {
      normalized.siteSettings[key] = defaultSiteSettings[key];
    }
  }
  if (!['sandbox', 'live'].includes(String(normalized.siteSettings.iyzicoEnvironment || '').trim())) {
    normalized.siteSettings.iyzicoEnvironment = defaultSiteSettings.iyzicoEnvironment;
  }

  normalized.users = normalized.users.map((user) => ({
    phone: '',
    whatsappConnectionId: '',
    ...user,
  }));

  normalized.whatsappConnections = normalized.whatsappConnections.map((connection) => {
    const nextConnection = {
      ownerUserId: '',
      ownerEmail: '',
      source: '',
      autoReconnect: true,
      ...connection,
    };
    const isStalePairingState =
      ['auth', 'qr'].includes(String(nextConnection.status || '')) &&
      !nextConnection.qrDataUrl &&
      !nextConnection.pairingCode;
    if (isStalePairingState) {
      nextConnection.status = 'disconnected';
      nextConnection.lastError = nextConnection.lastError || '';
    }
    return nextConnection;
  });

  return normalized;
}

async function ensureSeedSuperAdmin(store, superAdminPassword) {
  const superAdminEmail = String(process.env.SUPERADMIN_EMAIL || 'igurganx7@gmail.com').toLowerCase();
  const now = new Date().toISOString();
  let changed = false;
  store.users = Array.isArray(store.users) ? store.users : [];
  let user = store.users.find((entry) => String(entry.email || '').toLowerCase() === superAdminEmail);

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
      createdAt: now,
      updatedAt: now,
    };
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
  if (!user.passwordHash) {
    user.passwordHash = await bcrypt.hash(superAdminPassword, 10);
    changed = true;
  }
  if (changed) {
    user.updatedAt = now;
    store.auditLogs = Array.isArray(store.auditLogs) ? store.auditLogs : [];
    store.auditLogs.unshift({
      id: uuidv4(),
      actor: 'system',
      action: 'Superadmin ensured on startup',
      createdAt: now,
    });
  }

  return changed;
}

export async function initializeStore(superAdminPassword) {
  await ensureDir(dataDir);
  await ensureDir(uploadsDir);

  const existing = await readJson(dbPath, null);
  if (existing) {
    const normalized = normalizeStore(existing);
    const superAdminChanged = await ensureSeedSuperAdmin(normalized, superAdminPassword);
    if (superAdminChanged || JSON.stringify(normalized) !== JSON.stringify(existing)) {
      await saveStore(normalized);
    }
    return normalized;
  }

  const passwordHash = await bcrypt.hash(superAdminPassword, 10);
  const now = new Date().toISOString();

  const seed = {
    siteSettings: defaultSiteSettings,
    locationCatalog: defaultLocationCatalog,
    users: [
      {
        id: uuidv4(),
        role: 'superadmin',
        email: 'igurganx7@gmail.com',
        name: 'Super Admin',
        passwordHash,
        permissions: ['*'],
        isActive: true,
        twoFactorEnabled: false,
        twoFactorSecret: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    customers: [],
    messages: [],
    payments: [],
    customerVisits: [],
    consentRecords: [],
    crmEvents: [],
    mailDeliveries: [],
    whatsappConnections: [],
    auditLogs: [
      {
        id: uuidv4(),
        actor: 'system',
        action: 'System initialized',
        createdAt: now,
      },
    ],
  };

  await fs.writeFile(dbPath, JSON.stringify(seed, null, 2), 'utf8');
  return seed;
}

export async function loadStore() {
  const store = await readJson(dbPath, null);
  return normalizeStore(store || {});
}

export async function saveStore(data) {
  const writeOperation = saveStoreQueue.catch(() => {}).then(async () => {
    await ensureDir(dataDir);
    const latest = await readJson(dbPath, null);
    const merged = latest ? mergeStoreForSave(normalizeStore(latest), data) : data;
    const payload = JSON.stringify(merged, null, 2);
    const tempPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, dbPath);
  });
  saveStoreQueue = writeOperation;
  return writeOperation;
}

export function getUploadsDir() {
  return uploadsDir;
}
