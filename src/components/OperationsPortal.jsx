import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch, getApiBase } from '../lib/api';
import EmailCodeInput from './EmailCodeInput';
import TurnstileWidget from './TurnstileWidget';

const emptyStaffForm = {
  name: '',
  email: '',
  phone: '',
  password: '',
  role: 'staff',
  permissions: 'customers,messages,documents,whatsapp,payments',
};

const emptyConnectionForm = {
  method: 'qr',
  label: '',
  phone: '',
};

const portalPageSize = 25;

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

const permissionOptions = [
  { id: 'customers', label: 'Müşteriler' },
  { id: 'messages', label: 'Mesajlar' },
  { id: 'documents', label: 'Evraklar' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'payments', label: 'Ödeme' },
];

function formatOtpRemaining(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!minutes) return `${rest} sn`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function getDocumentTypeLabel(document) {
  const mime = String(document?.mimeType || '').toLowerCase();
  const name = String(document?.name || '').toLowerCase();
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'PDF';
  if (mime.includes('png') || name.endsWith('.png')) return 'PNG';
  if (mime.includes('jpeg') || name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'JPG';
  return 'Belge';
}

function compactValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value === 0) return '0';
  return value ? String(value) : '-';
}

function joinCompact(values, separator = ' / ') {
  return values.map((value) => compactValue(value)).filter((value) => value && value !== '-').join(separator) || '-';
}

function formatPortalDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('tr-TR');
}

function getWhatsappStatusMeta(connection) {
  const status = connection?.status || (connection?.isActive ? 'ready' : 'disconnected');
  const labels = {
    qr: 'QR bekleniyor',
    auth: 'Doğrulanıyor',
    ready: 'Hazır',
    standby: 'Hazırda',
    failed: 'Hata',
    disconnected: 'Kapalı',
  };
  const icons = {
    qr: 'QR',
    auth: '...',
    ready: 'OK',
    standby: 'Zz',
    failed: '!',
    disconnected: 'X',
  };
  return {
    status,
    label: labels[status] || status || 'Hazır',
    icon: icons[status] || '?',
    checked: status === 'ready' && connection?.isActive !== false,
    tone: status === 'ready' && connection?.isActive !== false ? 'ready' : status === 'failed' ? 'failed' : status === 'qr' || status === 'auth' ? 'pending' : 'muted',
  };
}

function getCustomerFormationFields(customer) {
  const activity = customer?.activity || {};
  return [
    { label: 'Ad soyad', value: customer?.name },
    { label: 'E-posta', value: customer?.email },
    { label: 'Telefon', value: customer?.phone },
    { label: 'Şirket türü', value: customer?.companyType },
    { label: 'Üyelik durumu', value: customer?.membershipStatus },
    { label: 'Faaliyet alanı', value: joinCompact([activity.mainActivity, activity.subActivity]) },
    { label: 'Satış kanalı', value: activity.salesChannel },
    { label: 'Gelir yöntemi', value: activity.revenueModel || activity.revenueMethod },
    { label: 'Adres', value: customer?.address },
    { label: 'Başvuru no', value: customer?.applicationId },
    { label: 'Başvuru tarihi', value: formatPortalDate(customer?.createdAt) },
    { label: 'Son güncelleme', value: formatPortalDate(customer?.updatedAt) },
  ];
}

function SectionTitle({ title, copy }) {
  return (
    <div className="section-head left portal-section-head">
      <div className="pill">{title}</div>
      {copy ? <p>{copy}</p> : null}
    </div>
  );
}

function CustomerDetailPanel({
  customer,
  paymentSummary,
  selectedDocumentIds,
  uploadingCustomerId,
  allDocumentsSelected,
  onArchive,
  onClose,
  onDelete,
  onDeleteDocument,
  onDeleteSelectedDocuments,
  onSelectAllDocuments,
  onToggleDocumentSelection,
  onUploadDocument,
}) {
  if (!customer) return null;

  const documents = customer.documents || [];
  const documentIds = documents.map((document) => document.id);
  const documentUrl = (document, mode) =>
    `${getApiBase()}/api/customers/${customer.id}/documents/${document.id}/${mode}`;

  return (
    <section className="portal-customer-detail" aria-label="Müşteri detayları">
      <div className="portal-detail-head">
        <div>
          <span>Seçili müşteri</span>
          <strong>{customer.name || 'İsimsiz müşteri'}</strong>
        </div>
        <div className="portal-detail-head-actions">
          <span className={`portal-status-chip ${paymentSummary.completed ? 'paid' : 'pending'}`}>
            {paymentSummary.completed ? 'Ödeme tamamlandı' : 'Ödeme bekliyor'}
          </span>
          {onClose ? (
            <button type="button" className="portal-modal-close" onClick={onClose} aria-label="Müşteri detayını kapat">
              ×
            </button>
          ) : null}
        </div>
      </div>

      <div className="portal-detail-section">
        <div className="portal-detail-title">
          <strong>Şirket kuruluş bilgileri</strong>
          <span>Müşteriden alınan başvuru verileri</span>
        </div>
        <div className="portal-detail-grid">
          {getCustomerFormationFields(customer).map((field) => (
            <div className="portal-detail-field" key={field.label}>
              <span>{field.label}</span>
              <strong>{compactValue(field.value)}</strong>
            </div>
          ))}
        </div>
      </div>

      {Array.isArray(customer.selectedFiles) && customer.selectedFiles.length ? (
        <div className="portal-detail-section">
          <div className="portal-detail-title">
            <strong>Talep edilen evraklar</strong>
            <span>Sihirbazda seçilen dosya türleri</span>
          </div>
          <div className="portal-required-docs">
            {customer.selectedFiles.map((fileName) => (
              <span key={fileName}>{fileName}</span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="portal-detail-section">
        <div className="portal-detail-title">
          <strong>Eklenen dosyalar</strong>
          <span>{documents.length} dosya</span>
        </div>
        <div className="portal-document-row">
          <label className="cta cta-light">
            {uploadingCustomerId === customer.id ? 'Yükleniyor...' : 'Belge yükle'}
            <input
              type="file"
              capture="environment"
              accept=".pdf,.jpg,.jpeg,.png,image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUploadDocument(customer.id, file);
                event.target.value = '';
              }}
            />
          </label>
          <div className="portal-document-actions">
            <button
              type="button"
              className="cta cta-light"
              disabled={!documentIds.length}
              onClick={() => onSelectAllDocuments(customer.id, documentIds)}
            >
              {allDocumentsSelected ? 'Seçimi temizle' : 'Tümünü seç'}
            </button>
            <button
              type="button"
              className="cta cta-dark"
              disabled={!selectedDocumentIds.length}
              onClick={() => onDeleteSelectedDocuments(customer.id)}
            >
              Seçili evrakları sil
            </button>
          </div>
          <div className="portal-doc-list">
            {documents.map((document) => (
              <div className="portal-doc-item" key={document.id}>
                <label className="field-checkbox portal-doc-check">
                  <input
                    type="checkbox"
                    checked={selectedDocumentIds.includes(document.id)}
                    onChange={() => onToggleDocumentSelection(customer.id, document.id)}
                  />
                  <strong>{document.name}</strong>
                </label>
                <div className="portal-doc-meta">
                  <span>{document.applicationId ? `Başvuru No: ${document.applicationId}` : 'Başvuru yok'}</span>
                  <span>{document.stageId ? `Aşama: ${document.stageId}` : 'Aşama yok'}</span>
                  <span>{`Evrak türü: ${getDocumentTypeLabel(document)}`}</span>
                  <span>{document.uploadedBy ? `Yükleyen: ${document.uploadedBy}` : 'Yükleyen yok'}</span>
                  <span>{document.uploadedAt ? `Tarih: ${formatPortalDate(document.uploadedAt)}` : 'Tarih yok'}</span>
                  <span>{document.size ? `${Math.ceil(document.size / 1024)} KB` : '-'}</span>
                  <span>{document.downloadCount ? `${document.downloadCount} indirme` : '0 indirme'}</span>
                </div>
                <div className="portal-doc-actions">
                  <a className="portal-doc-open" href={documentUrl(document, 'view')} target="_blank" rel="noreferrer">
                    Aç
                  </a>
                  <a className="portal-doc-download" href={documentUrl(document, 'download')}>
                    İndir
                  </a>
                  <button type="button" className="portal-doc-delete" onClick={() => onDeleteDocument(customer.id, document.id)}>
                    Sil
                  </button>
                </div>
              </div>
            ))}
            {!documents.length ? (
              <div className="portal-empty-state">Henüz dosya eklenmemiş.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="portal-detail-section portal-detail-compact">
        <div className="portal-detail-title">
          <strong>Operasyon özeti</strong>
          <span>Muhasebe takibi için kısa durum</span>
        </div>
        <div className="portal-detail-grid compact">
          <div className="portal-detail-field">
            <span>Aşama</span>
            <strong>{customer.stageLabel || customer.stepSummary || (customer.stage ? `Adım ${customer.stage}` : '-')}</strong>
          </div>
          <div className="portal-detail-field">
            <span>Son ödeme</span>
            <strong>
              {paymentSummary.latest
                ? `${paymentSummary.latest.amount} ${paymentSummary.latest.currency || ''} (${formatPortalDate(paymentSummary.latest.createdAt)})`
                : '-'}
            </strong>
          </div>
          <div className="portal-detail-field">
            <span>Arşiv</span>
            <strong>{customer.archivedAt ? formatPortalDate(customer.archivedAt) : 'Aktif kayıt'}</strong>
          </div>
        </div>
      </div>

      <div className="portal-inline-actions">
        <button type="button" className="cta cta-light" onClick={() => onArchive(customer.id, customer.archivedAt)}>
          {customer.archivedAt ? 'Arşivden çıkar' : 'Arşivle'}
        </button>
        <button type="button" className="cta cta-light" onClick={() => onDelete(customer.id)}>
          Sil
        </button>
      </div>
    </section>
  );
}

function describeTurnstileFailure(errorCodes = []) {
  const codes = Array.isArray(errorCodes) ? errorCodes.filter(Boolean) : [];
  if (!codes.length) {
    return '';
  }

  const hints = {
    'missing-input-response': 'Turnstile kutusu tamamlanmadan giriş denenmiş olabilir.',
    'invalid-input-response': 'Token geçersiz, süresi dolmuş ya da site/secret eşleşmesi sorunlu olabilir.',
    'timeout-or-duplicate': 'Token süresi dolmuş veya aynı token tekrar kullanılmış olabilir.',
    'invalid-input-secret': 'Sunucudaki TURNSTILE_SECRET_KEY yanlış ya da eksik olabilir.',
    'bad-request': 'Siteverify isteği beklenmedik biçimde oluşmuş olabilir.',
  };

  const hint = codes.map((code) => hints[code]).find(Boolean);
  return `Turnstile hata kodu: ${codes.join(', ')}${hint ? ` • ${hint}` : ''}`;
}

function OperationsPortal({ onBackHome, onCustomerVisitsChange, turnstileSiteKey }) {
  const [user, setUser] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginStage, setLoginStage] = useState('credentials');
  const [loginChallengeId, setLoginChallengeId] = useState('');
  const [loginEmailMasked, setLoginEmailMasked] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginResending, setLoginResending] = useState(false);
  const [loginNotice, setLoginNotice] = useState('');
  const [loginExpiresAt, setLoginExpiresAt] = useState(0);
  const [loginRemainingSeconds, setLoginRemainingSeconds] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetVersion, setTurnstileResetVersion] = useState(0);
  const [staffForm, setStaffForm] = useState(emptyStaffForm);
  const [connectionForm, setConnectionForm] = useState(emptyConnectionForm);
  const [messageForm, setMessageForm] = useState({ customerId: '', body: '', channel: 'portal' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [siteSettings, setSiteSettings] = useState(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSavedAt, setSettingsSavedAt] = useState('');
  const [twoFactorSetup, setTwoFactorSetup] = useState(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [uploadingCustomerId, setUploadingCustomerId] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState({});
  const [recordsView, setRecordsView] = useState('active');
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', body: '' });
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState('');
  const [mailHealth, setMailHealth] = useState(null);
  const [mailHealthChecking, setMailHealthChecking] = useState(false);
  const [paymentTestState, setPaymentTestState] = useState({ status: 'idle', message: '', diagnostics: null });
  const [whatsappPreflight, setWhatsappPreflight] = useState(null);
  const [whatsappPreflightChecking, setWhatsappPreflightChecking] = useState(false);
  const [messageComposerOpen, setMessageComposerOpen] = useState(false);
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [customerIntroOpen, setCustomerIntroOpen] = useState(false);
  const [customerDetailOpen, setCustomerDetailOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [visibleCounts, setVisibleCounts] = useState({
    customers: portalPageSize,
    messages: portalPageSize,
    payments: portalPageSize,
    auditLogs: portalPageSize,
  });
  const [activePortalTab, setActivePortalTab] = useState('overview');
  const [activeWhatsappTab, setActiveWhatsappTab] = useState('accounts');
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const siteSettingsDirtyRef = useRef(false);
  const dashboardRefreshTimerRef = useRef(null);
  const lastDashboardLoadAtRef = useRef(0);

  const isSuperAdmin = user?.role === 'superadmin';
  const portalTabs = useMemo(
    () => [
      { id: 'overview', label: 'Genel Bakış' },
      { id: 'customers', label: 'Müşteriler' },
      { id: 'messages', label: 'Mesajlar & E-Posta' },
      { id: 'payments', label: 'Ödemeler' },
      { id: 'whatsapp', label: 'WhatsApp' },
      { id: 'security', label: 'Güvenlik' },
      ...(isSuperAdmin ? [{ id: 'users', label: 'Portal Kullanıcıları' }, { id: 'settings', label: 'Sistem Ayarları' }, { id: 'audit', label: 'Sistem Logları' }] : []),
    ],
    [isSuperAdmin],
  );
  const whatsappStateLabels = {
    qr: 'QR bekleniyor',
    auth: 'Doğrulanıyor',
    ready: 'Hazır',
    standby: 'Hazırda bekliyor',
    failed: 'Hata',
    disconnected: 'Bağlantı kapalı',
  };
  const whatsappTabs = [
    { id: 'accounts', label: 'Hatlar' },
    { id: 'pairing', label: 'Eşleştirme' },
    { id: 'settings', label: 'Ayarlar' },
  ];
  const settingsTabs = [
    { id: 'general', label: 'Genel' },
    { id: 'notifications', label: 'Bildirimler' },
    { id: 'payment', label: 'Ödeme' },
    { id: 'mail', label: 'E-posta' },
    { id: 'integrations', label: 'Entegrasyon' },
  ];

  async function loadDashboard(options = {}) {
    const { forceSettings = false } = options;
    const data = await apiFetch('/api/dashboard');
    lastDashboardLoadAtRef.current = Date.now();
    setDashboard(data);
    onCustomerVisitsChange?.(Array.isArray(data.customerVisits) ? data.customerVisits : []);
    setSiteSettings((current) => (siteSettingsDirtyRef.current && !forceSettings ? current : data.siteSettings));
  }

  function resetLoginFlow() {
    setLoginStage('credentials');
    setLoginChallengeId('');
    setLoginEmailMasked('');
    setLoginCode('');
    setLoginExpiresAt(0);
    setLoginRemainingSeconds(0);
    setTurnstileToken('');
    setTurnstileResetVersion((current) => current + 1);
    setLoginSubmitting(false);
  }

  function applyLoginCodeExpiry(expiresInSeconds) {
    const ttl = Number(expiresInSeconds || 0);
    setLoginExpiresAt(ttl > 0 ? Date.now() + ttl * 1000 : 0);
    setLoginRemainingSeconds(ttl > 0 ? ttl : 0);
  }

  function patchDashboard(mutator) {
    setDashboard((current) => {
      if (!current) return current;
      return mutator(current);
    });
  }

  function upsertDashboardItem(collectionKey, nextItem) {
    patchDashboard((current) => {
      const items = Array.isArray(current[collectionKey]) ? current[collectionKey] : [];
      const rest = items.filter((item) => item.id !== nextItem.id);
      return {
        ...current,
        [collectionKey]: [nextItem, ...rest],
      };
    });
  }

  function removeDashboardItem(collectionKey, itemId) {
    patchDashboard((current) => {
      const items = Array.isArray(current[collectionKey]) ? current[collectionKey] : [];
      return {
        ...current,
        [collectionKey]: items.filter((item) => item.id !== itemId),
      };
    });
  }

  function updateDashboardCustomer(customerId, updater) {
    patchDashboard((current) => ({
      ...current,
      customers: (current.customers || []).map((customer) => (customer.id === customerId ? updater(customer) : customer)),
    }));
  }

  function updateDashboardMessage(messageId, updater) {
    patchDashboard((current) => ({
      ...current,
      messages: (current.messages || []).map((message) => (message.id === messageId ? updater(message) : message)),
    }));
  }

  function updateDashboardConnection(connectionId, updater) {
    patchDashboard((current) => ({
      ...current,
      whatsappConnections: (current.whatsappConnections || []).map((connection) =>
        connection.id === connectionId ? updater(connection) : connection,
      ),
    }));
  }

  function updateSiteSetting(key, value) {
    siteSettingsDirtyRef.current = true;
    setSiteSettings((current) => ({ ...(current || {}), [key]: value }));
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/auth/me')
      .then(({ user: nextUser }) => {
        if (cancelled) return;
        setUser(nextUser);
        return loadDashboard();
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) {
          setSessionReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const scheduleRefresh = () => {
      if (cancelled || document.visibilityState !== 'visible') {
        return;
      }
      if (dashboardRefreshTimerRef.current) {
        window.clearTimeout(dashboardRefreshTimerRef.current);
      }
      dashboardRefreshTimerRef.current = window.setTimeout(async () => {
        if (cancelled || document.visibilityState !== 'visible') {
          return;
        }
        await loadDashboard().catch(() => {});
        scheduleRefresh();
      }, document.hasFocus() ? 30_000 : 90_000);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastDashboardLoadAtRef.current > 20_000) {
          loadDashboard().catch(() => {});
        }
        scheduleRefresh();
      } else if (dashboardRefreshTimerRef.current) {
        window.clearTimeout(dashboardRefreshTimerRef.current);
        dashboardRefreshTimerRef.current = null;
      }
    };
    scheduleRefresh();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      if (dashboardRefreshTimerRef.current) {
        window.clearTimeout(dashboardRefreshTimerRef.current);
        dashboardRefreshTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user]);

  useEffect(() => {
    if (!user || activePortalTab !== 'whatsapp') return undefined;
    const intervalId = window.setInterval(() => {
      loadDashboard().catch(() => {});
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [activePortalTab, user]);

  useEffect(() => {
    if (!loginExpiresAt || loginStage !== 'code') return undefined;
    const tick = () => {
      setLoginRemainingSeconds(Math.max(0, Math.ceil((loginExpiresAt - Date.now()) / 1000)));
    };
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [loginExpiresAt, loginStage]);

  useEffect(() => {
    if (!isSuperAdmin && ['settings', 'audit'].includes(activePortalTab)) {
      setActivePortalTab('overview');
    }
  }, [activePortalTab, isSuperAdmin]);

  useEffect(() => {
    setVisibleCounts((current) => ({
      ...current,
      customers: portalPageSize,
      messages: portalPageSize,
    }));
  }, [recordsView]);

  useEffect(() => {
    if (!customerIntroOpen && !customerDetailOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setCustomerIntroOpen(false);
        setCustomerDetailOpen(false);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [customerDetailOpen, customerIntroOpen]);

  async function runPortalAction(action) {
    setError('');
    try {
      await action();
    } catch (nextError) {
      setError(nextError.message || 'İşlem tamamlanamadı.');
    }
  }

  const customerOptions = useMemo(() => dashboard?.customers || [], [dashboard]);
  const activeCustomers = useMemo(
    () => (dashboard?.customers || []).filter((customer) => (recordsView === 'archive' ? customer.archivedAt : !customer.archivedAt)),
    [dashboard, recordsView],
  );
  const activeMessages = useMemo(
    () => (dashboard?.messages || []).filter((message) => (recordsView === 'archive' ? message.archivedAt : !message.archivedAt)),
    [dashboard, recordsView],
  );
  const visibleCustomers = useMemo(() => activeCustomers.slice(0, visibleCounts.customers), [activeCustomers, visibleCounts.customers]);
  const visibleMessages = useMemo(() => activeMessages.slice(0, visibleCounts.messages), [activeMessages, visibleCounts.messages]);
  const visiblePayments = useMemo(() => (dashboard?.payments || []).slice(0, visibleCounts.payments), [dashboard, visibleCounts.payments]);
  const visibleAuditLogs = useMemo(() => (dashboard?.auditLogs || []).slice(0, visibleCounts.auditLogs), [dashboard, visibleCounts.auditLogs]);
  const selectedCustomer = useMemo(
    () => visibleCustomers.find((customer) => customer.id === selectedCustomerId) || visibleCustomers[0] || null,
    [selectedCustomerId, visibleCustomers],
  );
  useEffect(() => {
    if (customerDetailOpen && !selectedCustomer) {
      setCustomerDetailOpen(false);
    }
  }, [customerDetailOpen, selectedCustomer]);
  const recentCustomers = useMemo(() => (dashboard?.customers || []).filter((customer) => !customer.archivedAt).slice(0, 5), [dashboard]);
  const waitingCustomers = useMemo(
    () =>
      (dashboard?.customers || [])
        .filter((customer) => !customer.archivedAt && customer.paymentStatus !== 'completed')
        .slice(0, 5),
    [dashboard],
  );
  const readyConnections = useMemo(
    () => (dashboard?.whatsappConnections || []).filter((connection) => connection.status === 'ready' && connection.isActive !== false),
    [dashboard],
  );
  const paymentsByCustomer = useMemo(() => {
    const grouped = new Map();
    for (const payment of dashboard?.payments || []) {
      const list = grouped.get(payment.customerId) || [];
      list.push(payment);
      grouped.set(payment.customerId, list);
    }
    return grouped;
  }, [dashboard]);
  const portalStats = useMemo(() => {
    const customers = dashboard?.customers || [];
    const messages = dashboard?.messages || [];
    const payments = dashboard?.payments || [];
    const documents = customers.reduce((total, customer) => total + (customer.documents || []).length, 0);
    return [
      { label: 'Aktif müşteri', value: customers.filter((customer) => !customer.archivedAt).length },
      { label: 'Bekleyen evrak', value: documents },
      { label: 'Mesaj kaydı', value: messages.length },
      { label: 'Ödeme tamamlanan', value: payments.filter((payment) => payment.status === 'completed').length },
      { label: 'WhatsApp hesap', value: (dashboard?.whatsappConnections || []).length },
    ];
  }, [dashboard]);
  const whatsappConnectionById = useMemo(() => {
    const map = new Map();
    for (const connection of dashboard?.whatsappConnections || []) {
      map.set(connection.id, connection);
    }
    return map;
  }, [dashboard]);
  const userById = useMemo(() => {
    const map = new Map();
    for (const entry of dashboard?.users || []) {
      map.set(entry.id, entry);
    }
    return map;
  }, [dashboard]);
  const currentUserWhatsappConnection = (dashboard?.whatsappConnections || []).find((connection) =>
    String(connection.ownerUserId || '') === String(user?.id || ''),
  );
  const selectedVisibleMessageIds = useMemo(() => {
    const visibleIds = new Set(visibleMessages.map((message) => message.id));
    return selectedMessageIds.filter((messageId) => visibleIds.has(messageId));
  }, [selectedMessageIds, visibleMessages]);
  const visibleMessagesAllSelected = visibleMessages.length > 0 && selectedVisibleMessageIds.length === visibleMessages.length;
  const whatsappStatusSummary = useMemo(() => {
    const connections = dashboard?.whatsappConnections || [];
    return {
      total: connections.length,
      ready: connections.filter((connection) => getWhatsappStatusMeta(connection).checked).length,
      pending: connections.filter((connection) => ['qr', 'auth'].includes(connection.status)).length,
      failed: connections.filter((connection) => ['failed', 'disconnected'].includes(connection.status) || connection.isActive === false).length,
    };
  }, [dashboard]);

  function getCustomerPaymentSummary(customerId) {
    const customer = (dashboard?.customers || []).find((entry) => entry.id === customerId);
    const payments = paymentsByCustomer.get(customerId) || [];
    const completed = payments.find((payment) => payment.status === 'completed') || payments[0];
    return {
      count: payments.length,
      completed: Boolean(customer?.paymentStatus === 'completed' || payments.some((payment) => payment.status === 'completed')),
      latest: completed,
    };
  }

  async function startLogin(event) {
    event.preventDefault();
    setError('');
    if (turnstileSiteKey && !turnstileToken) {
      setError('Lütfen Turnstile doğrulamasını tamamlayın.');
      return;
    }
    try {
      setLoginSubmitting(true);
      const data = await apiFetch('/api/auth/login/start', {
        method: 'POST',
        timeoutMs: 75_000,
        body: JSON.stringify({ ...loginForm, audience: 'portal', turnstileToken }),
      });
      if (data.user) {
        setUser(data.user);
        setLoginForm({ email: '', password: '' });
        resetLoginFlow();
        await loadDashboard();
        return;
      }
      setLoginStage('code');
      setLoginChallengeId(data.challengeId || '');
      setLoginEmailMasked(data.emailMasked || loginForm.email);
      setLoginCode(String(data.devCode || ''));
      applyLoginCodeExpiry(data.expiresInSeconds);
      setTurnstileToken('');
      setTurnstileResetVersion((current) => current + 1);
    } catch (nextError) {
      const detail = describeTurnstileFailure(nextError?.details?.errorCodes || nextError?.details?.['error-codes'] || nextError?.details?.error_codes);
      setError([nextError.message, detail].filter(Boolean).join(' '));
      setTurnstileToken('');
      setTurnstileResetVersion((current) => current + 1);
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function verifyLogin(event, overrideCode = '') {
    event?.preventDefault?.();
    const nextCode = String(overrideCode || loginCode || '').replace(/\D/g, '').slice(0, 6);
    if (loginSubmitting || nextCode.length !== 6) return;
    setError('');
    try {
      setLoginSubmitting(true);
      const data = await apiFetch('/api/auth/login/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId: loginChallengeId, code: nextCode }),
      });
      setUser(data.user);
      setLoginForm({ email: '', password: '' });
      resetLoginFlow();
      await loadDashboard();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function resendLoginCode() {
    setError('');
    setLoginNotice('');
    if (!loginChallengeId) {
      setError('Giriş kodu süresi dolmuş olabilir. Lütfen yeniden giriş başlatın.');
      return;
    }
    try {
      setLoginResending(true);
      const data = await apiFetch('/api/auth/login/resend', {
        method: 'POST',
        body: JSON.stringify({ challengeId: loginChallengeId }),
      });
      setLoginCode('');
      setLoginEmailMasked(data.emailMasked || loginEmailMasked);
      applyLoginCodeExpiry(data.expiresInSeconds);
      setLoginNotice(data.message || 'Giriş kodu tekrar gönderildi.');
    } catch (nextError) {
      setError(nextError.message || 'Giriş kodu tekrar gönderilemedi.');
    } finally {
      setLoginResending(false);
    }
  }

  function logout() {
    apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setDashboard(null);
  }

  async function saveSettings() {
    await runPortalAction(async () => {
      setSettingsSaving(true);
      try {
        const data = await apiFetch('/api/site-settings', {
          method: 'PUT',
          body: JSON.stringify(siteSettings),
        });
        siteSettingsDirtyRef.current = false;
        setSiteSettings(data.siteSettings);
        setSettingsSavedAt(new Date().toLocaleString('tr-TR'));
        patchDashboard((current) => ({
          ...current,
          siteSettings: data.siteSettings,
        }));
      } finally {
        setSettingsSaving(false);
      }
    });
  }

  async function createStaff(event) {
    event.preventDefault();
    await runPortalAction(async () => {
      const userData = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          ...staffForm,
          phone: normalizePhone(staffForm.phone),
          permissions: staffForm.permissions.split(',').map((item) => item.trim()).filter(Boolean),
        }),
      });
      setStaffForm(emptyStaffForm);
      upsertDashboardItem('users', userData.user);
    });
  }

  async function prepareStaffWhatsappConnection(staffUser) {
    const existingConnection = staffUser.whatsappConnectionId
      ? whatsappConnectionById.get(staffUser.whatsappConnectionId)
      : (dashboard?.whatsappConnections || []).find((connection) => String(connection.ownerUserId || '') === String(staffUser.id || ''));
    if (existingConnection) {
      setError('Bu personel için zaten bir WhatsApp bağlantısı var.');
      return;
    }
    const staffPhone = normalizePhone(staffUser.phone);
    if (staffPhone && staffPhone.length < 10) {
      setError('Personel telefonu ülke koduyla girilmeli. Örn: 905xxxxxxxxx');
      return;
    }
    if (staffPhone) {
      const duplicatePhone = (dashboard?.whatsappConnections || []).find((connection) =>
        [connection.phone, connection.sessionPhone].map(normalizePhone).filter(Boolean).includes(staffPhone),
      );
      if (duplicatePhone) {
        setError('Bu telefon numarası başka bir WhatsApp bağlantısında kullanılıyor.');
        return;
      }
    }
    await runPortalAction(async () => {
      const data = await apiFetch('/api/whatsapp-connections', {
        method: 'POST',
        body: JSON.stringify({
          method: staffPhone ? 'phone' : 'qr',
          label: `${staffUser.name || staffUser.email || 'Personel'} WhatsApp`,
          phone: staffPhone,
          ownerUserId: staffUser.id,
          ownerEmail: staffUser.email,
          source: 'staff-manual',
          isActive: false,
        }),
      });
      if (data?.connection) {
        upsertDashboardItem('whatsappConnections', data.connection);
        upsertDashboardItem('users', {
          ...staffUser,
          whatsappConnectionId: data.connection.id,
        });
      }
    });
  }

  async function toggleStaff(userId, isActive) {
    await runPortalAction(async () => {
      const data = await apiFetch(`/api/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !isActive }),
      });
      if (data?.user) {
        upsertDashboardItem('users', data.user);
      }
    });
  }

  async function removeStaff(userId) {
    await runPortalAction(async () => {
      const existingUser = (dashboard?.users || []).find((entry) => entry.id === userId);
      await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
      removeDashboardItem('users', userId);
      if (existingUser?.whatsappConnectionId) {
        removeDashboardItem('whatsappConnections', existingUser.whatsappConnectionId);
      }
    });
  }

  function toggleStaffPermission(permissionId) {
    setStaffForm((current) => {
      const permissions = new Set(current.permissions.split(',').map((item) => item.trim()).filter(Boolean));
      if (permissions.has(permissionId)) {
        permissions.delete(permissionId);
      } else {
        permissions.add(permissionId);
      }
      return { ...current, permissions: [...permissions].join(',') };
    });
  }

  function toggleDocumentSelection(customerId, documentId) {
    setSelectedDocuments((current) => {
      const customerSelection = new Set(current[customerId] || []);
      if (customerSelection.has(documentId)) {
        customerSelection.delete(documentId);
      } else {
        customerSelection.add(documentId);
      }
      return {
        ...current,
        [customerId]: [...customerSelection],
      };
    });
  }

  function selectAllDocuments(customerId, documentIds) {
    setSelectedDocuments((current) => ({
      ...current,
      [customerId]: current[customerId]?.length === documentIds.length ? [] : [...documentIds],
    }));
  }

  async function deleteSelectedDocuments(customerId) {
    const selection = selectedDocuments[customerId] || [];
    if (!selection.length) return;
    await runPortalAction(async () => {
      await Promise.all(
        selection.map((documentId) =>
          apiFetch(`/api/customers/${customerId}/documents/${documentId}`, {
            method: 'DELETE',
          }),
        ),
      );
      setSelectedDocuments((current) => ({ ...current, [customerId]: [] }));
      updateDashboardCustomer(customerId, (customer) => ({
        ...customer,
        documents: (customer.documents || []).filter((document) => !selection.includes(document.id)),
        updatedAt: new Date().toISOString(),
      }));
    });
  }

  async function archiveCustomer(customerId, archivedAt) {
    await runPortalAction(async () => {
      await apiFetch(`/api/customers/${customerId}/${archivedAt ? 'unarchive' : 'archive'}`, {
        method: 'POST',
      });
      updateDashboardCustomer(customerId, (customer) => ({
        ...customer,
        archivedAt: archivedAt ? '' : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    });
  }

  async function deleteCustomer(customerId) {
    if (!window.confirm('Bu müşteriyi ve tüm evraklarını silmek istiyor musun?')) return;
    await runPortalAction(async () => {
      await apiFetch(`/api/customers/${customerId}`, {
        method: 'DELETE',
      });
      removeDashboardItem('customers', customerId);
    });
  }

  async function createConnection(event) {
    event.preventDefault();
    const normalizedPhone = normalizePhone(connectionForm.phone);
    if (connectionForm.method === 'phone' && normalizedPhone.length < 10) {
      setError('Telefon numarasını ülke koduyla birlikte girin. Örn: 905xxxxxxxxx');
      return;
    }
    if (normalizedPhone) {
      const duplicate = (dashboard?.whatsappConnections || []).find((connection) =>
        [connection.phone, connection.sessionPhone].map(normalizePhone).filter(Boolean).includes(normalizedPhone),
      );
      if (duplicate) {
        setError('Bu telefon numarası için zaten bir WhatsApp bağlantısı var. Önce mevcut bağlantıyı durdurun veya silin.');
        return;
      }
    }
    await runPortalAction(async () => {
      const data = await apiFetch('/api/whatsapp-connections', {
        method: 'POST',
        body: JSON.stringify({
          ...connectionForm,
          label: connectionForm.label || `${user?.name || user?.email || 'Portal kullanıcısı'} WhatsApp`,
          phone: normalizedPhone,
          ownerUserId: user?.id,
          ownerEmail: user?.email,
          source: 'portal-manual',
        }),
      });
      setConnectionForm(emptyConnectionForm);
      if (data?.connection) {
        upsertDashboardItem('whatsappConnections', data.connection);
      }
    });
  }

  async function startConnection(connectionId) {
    await runPortalAction(async () => {
      try {
        const preflightData = await apiFetch('/api/admin/whatsapp/preflight', { timeoutMs: 20_000 });
        setWhatsappPreflight(preflightData.preflight || null);
      } catch (preflightError) {
        setWhatsappPreflight(preflightError.details?.preflight || null);
        throw preflightError;
      }
      const data = await apiFetch(`/api/whatsapp-connections/${connectionId}/start`, {
        method: 'POST',
        timeoutMs: 90_000,
      });
      updateDashboardConnection(connectionId, () => data.connection);
    });
  }

  async function checkWhatsAppPreflight() {
    setWhatsappPreflightChecking(true);
    setError('');
    try {
      const data = await apiFetch('/api/admin/whatsapp/preflight', { timeoutMs: 20_000 });
      setWhatsappPreflight(data.preflight || null);
    } catch (preflightError) {
      setWhatsappPreflight(preflightError.details?.preflight || null);
      setError(preflightError.message || 'WhatsApp ön kontrol tamamlanamadı.');
    } finally {
      setWhatsappPreflightChecking(false);
    }
  }

  async function resetConnectionSession(connectionId) {
    if (!window.confirm('Bu WhatsApp oturumunu temizleyip yeniden eşleştirmeye hazırlamak istiyor musun?')) return;
    await runPortalAction(async () => {
      const data = await apiFetch(`/api/whatsapp-connections/${connectionId}/reset`, {
        method: 'POST',
        timeoutMs: 30_000,
      });
      updateDashboardConnection(connectionId, () => data.connection);
    });
  }

  async function stopConnection(connectionId) {
    await runPortalAction(async () => {
      await apiFetch(`/api/whatsapp-connections/${connectionId}/stop`, {
        method: 'POST',
      });
      updateDashboardConnection(connectionId, (connection) => ({
        ...connection,
        isActive: false,
        status: 'disconnected',
        qrDataUrl: '',
        pairingCode: '',
        lastError: '',
      }));
    });
  }

  async function deleteConnection(connectionId) {
    if (!window.confirm('Bu WhatsApp bağlantısını tamamen silmek istiyor musun?')) return;
    await runPortalAction(async () => {
      await apiFetch(`/api/whatsapp-connections/${connectionId}`, {
        method: 'DELETE',
      });
      removeDashboardItem('whatsappConnections', connectionId);
    });
  }

  async function sendCustomEmail(event) {
    event.preventDefault();
    if (!emailForm.to || !emailForm.subject || !emailForm.body) {
      setEmailStatus('Lütfen tüm alanları doldurun.');
      return;
    }
    setEmailSending(true);
    setEmailStatus('');
    try {
      const result = await apiFetch('/api/admin/send-email', {
        method: 'POST',
        body: JSON.stringify(emailForm),
      });
      setEmailForm({ to: '', subject: '', body: '' });
      setEmailStatus(result?.queued ? 'E-posta kuyruğa alındı, sunucu arka planda gönderecek.' : 'E-posta başarıyla gönderildi.');
    } catch (err) {
      setEmailStatus(`Hata: ${err.message || 'Gönderilemedi'}`);
    } finally {
      setEmailSending(false);
    }
  }

  async function checkMailHealth() {
    setMailHealthChecking(true);
    setEmailStatus('');
    try {
      const data = await apiFetch('/api/admin/mail/health');
      setMailHealth(data.health);
    } catch (err) {
      setMailHealth(err.details?.health || { ok: false, error: err.message });
    } finally {
      setMailHealthChecking(false);
    }
  }

  async function runIyzicoDiagnostic(kind) {
    const isLiveTest = kind === 'live-test';
    setPaymentTestState({
      status: 'loading',
      message: isLiveTest ? '1 TL canlı test ödeme sayfası hazırlanıyor...' : kind === 'checkout' ? 'Checkout testi çalışıyor...' : 'Bağlantı ayarları kontrol ediliyor...',
      diagnostics: null,
    });
    try {
      const endpoint = isLiveTest ? 'live-test-checkout' : kind === 'checkout' ? 'test-checkout' : 'test-connection';
      const result = await apiFetch(`/api/admin/iyzico/${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({ amount: 1, currency: 'TRY' }),
      });
      if (isLiveTest && result.paymentUrl) {
        window.open(result.paymentUrl, '_blank', 'noopener,noreferrer');
      }
      setPaymentTestState({
        status: 'success',
        message: result.message || 'Test başarılı.',
        diagnostics: result.diagnostics || null,
      });
    } catch (diagnosticError) {
      setPaymentTestState({
        status: 'error',
        message: diagnosticError.message || 'Test başarısız.',
        diagnostics: diagnosticError.details?.diagnostics || null,
      });
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    await runPortalAction(async () => {
      const data = await apiFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ ...messageForm, direction: 'outbound' }),
      });
      setMessageForm({ customerId: '', body: '', channel: 'portal' });
      if (data?.message) {
        upsertDashboardItem('messages', data.message);
      }
    });
  }

  async function archiveMessage(messageId, archivedAt) {
    await runPortalAction(async () => {
      await apiFetch(`/api/messages/${messageId}/${archivedAt ? 'unarchive' : 'archive'}`, {
        method: 'POST',
      });
      updateDashboardMessage(messageId, (message) => ({
        ...message,
        archivedAt: archivedAt ? new Date().toISOString() : '',
      }));
    });
  }

  async function deleteMessage(messageId) {
    if (!window.confirm('Bu mesaj kaydını silmek istiyor musun?')) return;
    await runPortalAction(async () => {
      await apiFetch(`/api/messages/${messageId}`, {
        method: 'DELETE',
      });
      removeDashboardItem('messages', messageId);
      setSelectedMessageIds((current) => current.filter((id) => id !== messageId));
    });
  }

  function toggleMessageSelection(messageId) {
    setSelectedMessageIds((current) =>
      current.includes(messageId) ? current.filter((id) => id !== messageId) : [...current, messageId],
    );
  }

  function toggleAllVisibleMessages() {
    setSelectedMessageIds((current) => {
      const visibleIds = visibleMessages.map((message) => message.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
      return allSelected ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  async function deleteSelectedMessages() {
    const ids = [...selectedVisibleMessageIds];
    if (!ids.length) return;
    if (!window.confirm(`Seçili ${ids.length} mesajı silmek istiyor musun?`)) return;
    await runPortalAction(async () => {
      await Promise.all(ids.map((messageId) => apiFetch(`/api/messages/${messageId}`, { method: 'DELETE' })));
      patchDashboard((current) => ({
        ...current,
        messages: (current.messages || []).filter((message) => !ids.includes(message.id)),
      }));
      setSelectedMessageIds((current) => current.filter((id) => !ids.includes(id)));
    });
  }

  async function changePassword(event) {
    event.preventDefault();
    await runPortalAction(async () => {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(passwordForm),
      });
      setPasswordForm({ currentPassword: '', newPassword: '' });
    });
  }

  async function setup2fa() {
    await runPortalAction(async () => {
      const data = await apiFetch('/api/auth/2fa/setup', { method: 'POST' });
      setTwoFactorSetup(data);
    });
  }

  async function verify2fa(event) {
    event.preventDefault();
    await runPortalAction(async () => {
      await apiFetch('/api/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ token: twoFactorCode }),
      });
      setTwoFactorCode('');
      setTwoFactorSetup(null);
      const me = await apiFetch('/api/auth/me');
      setUser(me.user);
    });
  }

  async function uploadDocument(customerId, file) {
    await runPortalAction(async () => {
      const formData = new FormData();
      formData.append('file', file);
      setUploadingCustomerId(customerId);
      try {
        const data = await apiFetch(`/api/customers/${customerId}/documents`, {
          method: 'POST',
          body: formData,
        });
        if (data?.customer) {
          upsertDashboardItem('customers', data.customer);
        }
      } finally {
        setUploadingCustomerId('');
      }
    });
  }

  async function deleteDocument(customerId, documentId) {
    await runPortalAction(async () => {
      await apiFetch(`/api/customers/${customerId}/documents/${documentId}`, {
        method: 'DELETE',
      });
      updateDashboardCustomer(customerId, (customer) => ({
        ...customer,
        documents: (customer.documents || []).filter((document) => document.id !== documentId),
        updatedAt: new Date().toISOString(),
      }));
    });
  }

  function renderStaffManagementPanel() {
    return (
      <article className="card admin-card lift admin-card-wide">
        <form className="portal-form" onSubmit={createStaff}>
          <SectionTitle title="Portal Kullanıcısı Tanımla" />
          <div className="staff-user-form">
            <div className="inline-grid staff-basic-grid">
            <label>
              Ad soyad
              <input value={staffForm.name} onChange={(event) => setStaffForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label>
              E-posta
              <input type="email" value={staffForm.email} onChange={(event) => setStaffForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label>
              Telefon
              <input
                value={staffForm.phone}
                inputMode="tel"
                placeholder="905xxxxxxxxx"
                onChange={(event) => setStaffForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </label>
            <label>
              Şifre
              <input type="password" value={staffForm.password} onChange={(event) => setStaffForm((current) => ({ ...current, password: event.target.value }))} />
            </label>
            </div>
            <div className="staff-options-grid">
              <section className="staff-form-panel">
                <div className="staff-form-panel-head">
                  <strong>Yetkiler</strong>
                </div>
                <div className="staff-permission-grid">
                  {permissionOptions.map((permission) => (
                    <label className="staff-permission-option" key={permission.id}>
                      <input
                        type="checkbox"
                        checked={staffForm.permissions.split(',').includes(permission.id)}
                        onChange={() => toggleStaffPermission(permission.id)}
                      />
                      <span>{permission.label}</span>
                    </label>
                  ))}
                </div>
              </section>
            </div>
          </div>
          <button type="submit" className="cta cta-dark">
            Portal kullanıcısı oluştur
          </button>
        </form>

        <div className="admin-audit">
          <strong>Portal Kullanıcıları</strong>
          <ul className="admin-audit-list">
            {(dashboard?.users || []).map((entry) => {
              const staffConnection = entry.whatsappConnectionId ? whatsappConnectionById.get(entry.whatsappConnectionId) : null;
              return (
                <li key={entry.id}>
                  <span>
                    {entry.name} - {entry.email} - {entry.isActive ? 'Aktif' : 'Pasif'}
                  </span>
                  <small>Telefon: {entry.phone || '-'}</small>
                  <small>{(entry.permissions || []).join(', ') || 'Yetki yok'}</small>
                  {entry.role !== 'superadmin' && (
                    <div className="portal-inline-actions">
                      <small>
                        WhatsApp: {staffConnection
                          ? `${whatsappStateLabels[staffConnection.status] || staffConnection.status || 'Hazır'}${staffConnection.pairingCode ? ` · Kod: ${staffConnection.pairingCode}` : ''}`
                          : 'Bağlantı yok'}
                      </small>
                      <button type="button" className="cta cta-light" onClick={() => toggleStaff(entry.id, entry.isActive)}>
                        {entry.isActive ? 'Kapat' : 'Aç'}
                      </button>
                      {staffConnection ? (
                        <button type="button" className="cta cta-light" onClick={() => startConnection(staffConnection.id)}>
                          Eşleştir
                        </button>
                      ) : (
                        <button type="button" className="cta cta-light" onClick={() => prepareStaffWhatsappConnection(entry)}>
                          WhatsApp bağlantısı hazırla
                        </button>
                      )}
                      <button type="button" className="cta cta-light" onClick={() => removeStaff(entry.id)}>
                        Sil
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </article>
    );
  }

  if (!sessionReady) {
    return (
      <div className="page-shell portal-shell">
        <main className="portal-main">
          <section className="section portal-login-section">
            <div className="card portal-login-card lift">
              <SectionTitle
                title="Operasyon Paneli"
                copy="Güvenli oturum kontrol ediliyor..."
              />
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page-shell portal-shell">
        <main className="portal-main">
          <section className="section portal-login-section">
            <div className="card portal-login-card lift">
              <div className="portal-top-actions">
                <button type="button" className="cta cta-light" onClick={onBackHome}>
                  Ana sayfa
                </button>
              </div>
              <SectionTitle
                title="Operasyon Paneli"
              />
              <form className="portal-form" onSubmit={loginStage === 'code' ? verifyLogin : startLogin}>
                {loginStage === 'credentials' ? (
                  <>
                    <label>
                      E-posta
                      <input
                        type="email"
                        autoComplete="email"
                        value={loginForm.email}
                        onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      Şifre
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={loginForm.password}
                        onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                        required
                      />
                    </label>
                    <TurnstileWidget
                      siteKey={turnstileSiteKey}
                      action="portal-login"
                      label="Portal güvenlik doğrulaması"
                      onTokenChange={setTurnstileToken}
                      resetVersion={turnstileResetVersion}
                    />
                  </>
                ) : (
                  <div className="portal-otp-step">
                    <div className="portal-otp-copy">
                      <strong>Giriş kodu gönderildi</strong>
                      <p>{loginEmailMasked || loginForm.email}</p>
                    </div>
                    <EmailCodeInput
                      value={loginCode}
                      onChange={setLoginCode}
                      onComplete={(code) => verifyLogin(null, code)}
                      disabled={loginSubmitting}
                      autoFocus
                    />
                    {loginRemainingSeconds > 0 ? (
                      <span className="field-hint">Kod {formatOtpRemaining(loginRemainingSeconds)} geçerli.</span>
                    ) : (
                      <span className="field-hint field-hint-error">Kod süresi dolduysa tekrar gönderin.</span>
                    )}
                    {loginNotice && <p className="field-success">{loginNotice}</p>}
                    <button
                      type="button"
                      className="cta cta-light portal-otp-back"
                      disabled={loginResending}
                      onClick={resendLoginCode}
                    >
                      {loginResending ? 'Tekrar gönderiliyor...' : 'Kodu tekrar gönder'}
                    </button>
                    <button
                      type="button"
                      className="cta cta-light portal-otp-back"
                      onClick={() => resetLoginFlow()}
                    >
                      Geri dön
                    </button>
                  </div>
                )}
                {error && <p className="field-warning">{error}</p>}
                <button
                  type="submit"
                  className="cta cta-dark"
                  disabled={
                    loginSubmitting ||
                    (loginStage === 'credentials' && turnstileSiteKey && !turnstileToken) ||
                    (loginStage === 'code' && String(loginCode).replace(/\D/g, '').length !== 6)
                  }
                >
                  {loginSubmitting
                    ? 'Hazırlanıyor...'
                    : loginStage === 'code'
                      ? 'Kodu doğrula'
                      : turnstileToken || !turnstileSiteKey
                        ? 'Giriş kodu gönder'
                        : 'Güvenlik doğrulaması hazırlanıyor'}
                </button>
              </form>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell portal-shell">
      <main className="portal-main">
        <section className="section admin-section">
          <div className="portal-header">
            <div>
              <div className="pill">{isSuperAdmin ? 'Super Admin' : 'Personel'}</div>
              <h1>{user.name}</h1>
              <p>{user.email}</p>
            </div>
            <div className="portal-header-actions">
              <button type="button" className="cta cta-light" onClick={onBackHome}>
                Siteye dön
              </button>
              <button type="button" className="cta cta-dark" onClick={logout}>
                Çıkış yap
              </button>
            </div>
          </div>

          {error && <p className="field-warning portal-error">{error}</p>}

          <div className="portal-console">
            <aside className="portal-sidebar">
              <div className="portal-tabs" role="tablist" aria-label="Portal bölümleri">
                {portalTabs.map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    role="tab"
                    aria-selected={activePortalTab === tab.id}
                    className={`portal-tab ${activePortalTab === tab.id ? 'active' : ''}`}
                    onClick={() => setActivePortalTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </aside>

            <div className="portal-workspace">
              <div className="portal-workspace-head">
                <div>
                  <span>{isSuperAdmin ? 'Tam yetkili konsol' : 'Operasyon konsolu'}</span>
                  <strong>{portalTabs.find((tab) => tab.id === activePortalTab)?.label || 'Genel Bakış'}</strong>
                </div>
                <button type="button" className="cta cta-light" onClick={() => loadDashboard({ forceSettings: true }).catch(() => {})}>
                  Yenile
                </button>
              </div>

              <div className="portal-stats portal-workspace-stats" aria-label="Portal operasyon özeti">
                {portalStats.map((stat) => (
                  <div className="portal-stat-card" key={stat.label}>
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                  </div>
                ))}
              </div>

              <div className="portal-grid">
            {activePortalTab === 'overview' && (
              <article className="admin-card portal-overview-panel">
                <SectionTitle title="Operasyon Özeti" />
                <div className="portal-overview-grid">
                  <div className="preview-box">
                    <strong>Son başvurular</strong>
                    {recentCustomers.length ? (
                      <ul className="portal-compact-list">
                        {recentCustomers.map((customer) => (
                          <li key={customer.id}>
                            <span>{customer.name || 'Müşteri'}</span>
                            <small>{customer.companyType || '-'} | {customer.createdAt || 'Tarih yok'}</small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Henüz yeni başvuru yok.</p>
                    )}
                  </div>
                  <div className="preview-box">
                    <strong>Ödeme bekleyenler</strong>
                    {waitingCustomers.length ? (
                      <ul className="portal-compact-list">
                        {waitingCustomers.map((customer) => (
                          <li key={customer.id}>
                            <span>{customer.name || 'Müşteri'}</span>
                            <small>{customer.paymentStatus || 'pending'} | {customer.phone || '-'}</small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Bekleyen ödeme görünmüyor.</p>
                    )}
                  </div>
                  <div className="preview-box">
                    <strong>WhatsApp hatları</strong>
                    <p>{readyConnections.length} hazır / {(dashboard?.whatsappConnections || []).length} toplam</p>
                    <span>Hazır hatlar müşteri başvurusu, ödeme ve belge bildirimlerini otomatik alır.</span>
                  </div>
                  <div className="preview-box">
                    <strong>Bildirim ayarları</strong>
                    <p>{siteSettings?.whatsappRoutingEnabled ? 'WhatsApp yönlendirme açık' : 'WhatsApp yönlendirme kapalı'}</p>
                    <span>Lead: {siteSettings?.notifyLeads ? 'Açık' : 'Kapalı'} | Ödeme: {siteSettings?.notifyPayments ? 'Açık' : 'Kapalı'} | Belge: {siteSettings?.notifyDocuments ? 'Açık' : 'Kapalı'}</span>
                  </div>
                </div>
              </article>
            )}

            {isSuperAdmin && activePortalTab === 'users' && renderStaffManagementPanel()}

            {isSuperAdmin && activePortalTab === 'settings' && (
              <article className="card admin-card lift admin-card-wide">
                <SectionTitle title="Sistem Ayarları" />
                <div className="portal-subtabs" role="tablist" aria-label="Sistem ayarı başlıkları">
                  {settingsTabs.map((tab) => (
                    <button
                      type="button"
                      key={tab.id}
                      className={`portal-subtab ${activeSettingsTab === tab.id ? 'active' : ''}`}
                      onClick={() => setActiveSettingsTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeSettingsTab === 'general' && (
                  <div className="inline-grid">
                    <label>
                      Marka adı
                      <input value={siteSettings?.brandName || ''} onChange={(event) => updateSiteSetting('brandName', event.target.value)} />
                    </label>
                    <label>
                      Ana domain
                      <input value={siteSettings?.primaryDomain || ''} onChange={(event) => updateSiteSetting('primaryDomain', event.target.value)} />
                    </label>
                    <label>
                      TR domain
                      <input value={siteSettings?.secondaryDomain || ''} onChange={(event) => updateSiteSetting('secondaryDomain', event.target.value)} />
                    </label>
                    <label>
                      Destek e-postası
                      <input value={siteSettings?.supportEmail || ''} onChange={(event) => updateSiteSetting('supportEmail', event.target.value)} />
                    </label>
                    <label>
                      Destek telefonu
                      <input value={siteSettings?.supportPhone || ''} onChange={(event) => updateSiteSetting('supportPhone', event.target.value)} />
                    </label>
                    <label>
                      Turnstile site anahtarı
                      <input value={siteSettings?.turnstileSiteKey || ''} onChange={(event) => updateSiteSetting('turnstileSiteKey', event.target.value)} placeholder="0x4AAAA..." />
                    </label>
                  </div>
                )}

                {activeSettingsTab === 'notifications' && (
                  <div className="inline-grid">
                    <label className="field-checkbox">
                      <input type="checkbox" checked={Boolean(siteSettings?.notifyLeads)} onChange={(event) => updateSiteSetting('notifyLeads', event.target.checked)} />
                      Lead bildirimleri aktif
                    </label>
                    <label className="field-checkbox">
                      <input type="checkbox" checked={Boolean(siteSettings?.whatsappRoutingEnabled)} onChange={(event) => updateSiteSetting('whatsappRoutingEnabled', event.target.checked)} />
                      WhatsApp yönlendirme aktif
                    </label>
                    <label className="field-checkbox">
                      <input type="checkbox" checked={Boolean(siteSettings?.notifyPayments)} onChange={(event) => updateSiteSetting('notifyPayments', event.target.checked)} />
                      Ödeme bildirimleri aktif
                    </label>
                    <label className="field-checkbox">
                      <input type="checkbox" checked={Boolean(siteSettings?.notifyDocuments)} onChange={(event) => updateSiteSetting('notifyDocuments', event.target.checked)} />
                      Belge bildirimleri aktif
                    </label>
                    <label className="field-checkbox">
                      <input type="checkbox" checked={siteSettings?.customerVisitTrackingEnabled !== false} onChange={(event) => updateSiteSetting('customerVisitTrackingEnabled', event.target.checked)} />
                      Müşteri ilk giriş/ziyaret takibi aktif
                    </label>
                    <label className="field-checkbox">
                      <input type="checkbox" checked={siteSettings?.leadProgressTrackingEnabled !== false} onChange={(event) => updateSiteSetting('leadProgressTrackingEnabled', event.target.checked)} />
                      Başvuru adım takibi aktif
                    </label>
                  </div>
                )}

                {activeSettingsTab === 'payment' && (
                  <div className="inline-grid">
                    <label>
                      iyzico ortamı
                      <select value={siteSettings?.iyzicoEnvironment || 'sandbox'} onChange={(event) => updateSiteSetting('iyzicoEnvironment', event.target.value)}>
                        <option value="sandbox">Sandbox</option>
                        <option value="live">Live</option>
                      </select>
                    </label>
                    <label>
                      Merchant ID
                      <input value={siteSettings?.iyzicoMerchantId || ''} onChange={(event) => updateSiteSetting('iyzicoMerchantId', event.target.value)} />
                    </label>
                    <label>
                      API Key
                      <input type="password" autoComplete="new-password" value={siteSettings?.iyzicoApiKey || ''} onChange={(event) => updateSiteSetting('iyzicoApiKey', event.target.value)} />
                    </label>
                    <label>
                      Secret Key
                      <input type="password" autoComplete="new-password" value={siteSettings?.iyzicoSecretKey || ''} onChange={(event) => updateSiteSetting('iyzicoSecretKey', event.target.value)} />
                    </label>
                    <label>
                      Callback URL
                      <input value={siteSettings?.paymentCallbackUrl || ''} onChange={(event) => updateSiteSetting('paymentCallbackUrl', event.target.value)} placeholder="https://www.onlinesmmm.com/odeme/callback" />
                    </label>
                    <label>
                      Initialize endpoint
                      <input value={siteSettings?.iyzicoInitializeEndpoint || ''} onChange={(event) => updateSiteSetting('iyzicoInitializeEndpoint', event.target.value)} placeholder="/api/public/iyzico/checkout/initialize" />
                    </label>
                    <label>
                      Hazır ödeme URL
                      <input value={siteSettings?.paymentCheckoutUrl || ''} onChange={(event) => updateSiteSetting('paymentCheckoutUrl', event.target.value)} />
                    </label>
                    <div className="preview-box portal-full-span">
                      <strong>{paymentTestState.status === 'success' ? 'Ödeme testi başarılı' : paymentTestState.status === 'error' ? 'Ödeme testi hata verdi' : 'Ödeme test ekranı'}</strong>
                      <p>{paymentTestState.message || 'Ayarları kaydettikten sonra bağlantı ya da checkout testini çalıştırın.'}</p>
                      {paymentTestState.diagnostics ? (
                        <span>
                          Ortam: {paymentTestState.diagnostics.environment} | API: {paymentTestState.diagnostics.apiKeyConfigured ? 'var' : 'eksik'} | Secret: {paymentTestState.diagnostics.secretConfigured ? 'var' : 'eksik'} | Callback: {paymentTestState.diagnostics.callbackUrlConfigured ? 'var' : 'eksik'}
                        </span>
                      ) : null}
                    </div>
                    <div className="admin-sync-actions portal-full-span">
                      <button type="button" className="cta cta-dark" onClick={() => runIyzicoDiagnostic('connection')} disabled={paymentTestState.status === 'loading'}>
                        Bağlantı testi
                      </button>
                      <button type="button" className="cta cta-light" onClick={() => runIyzicoDiagnostic('checkout')} disabled={paymentTestState.status === 'loading'}>
                        Checkout dry-run testi
                      </button>
                      <button type="button" className="cta" onClick={() => runIyzicoDiagnostic('live-test')} disabled={paymentTestState.status === 'loading'}>
                        1 TL canlı test
                      </button>
                    </div>
                  </div>
                )}

                {activeSettingsTab === 'mail' && (
                  <div className="inline-grid">
                    <div className="preview-box portal-full-span">
                      <strong>Sunucu mail kimliği</strong>
                      <p>Gönderici: bilgi@onlinesmmm.com veya sunucu env içindeki MAIL_FROM değeri</p>
                      <span>Inbound webhook: /api/mail/inbound, Bounce webhook: /api/mail/bounce</span>
                    </div>
                    <div className="admin-sync-actions portal-full-span">
                      <button type="button" className="cta cta-dark" onClick={checkMailHealth} disabled={mailHealthChecking}>
                        {mailHealthChecking ? 'Mail kontrol ediliyor...' : 'Mail sağlık kontrolü'}
                      </button>
                      {mailHealth ? (
                        <span className={`field-hint ${mailHealth.ok ? '' : 'field-hint-error'}`}>
                          {mailHealth.ok
                            ? `Mail sağlıklı: ${mailHealth.provider}, SPF/DKIM/DMARC ve alan adı uyumu tamam.`
                            : `Mail eksik: ${(mailHealth.dns?.warnings || mailHealth.identity?.errors || [mailHealth.error || 'Yapılandırma kontrol edilmeli.']).join(' | ')}`}
                        </span>
                      ) : (
                        <span className="field-hint">SPF, DKIM, DMARC, from/reply-to ve son hata metriklerini kontrol eder.</span>
                      )}
                    </div>
                  </div>
                )}

                {activeSettingsTab === 'integrations' && (
                  <div className="inline-grid">
                    <label className="field-checkbox">
                      <input type="checkbox" checked={Boolean(siteSettings?.crmEnabled)} onChange={(event) => updateSiteSetting('crmEnabled', event.target.checked)} />
                      CRM entegrasyonu aktif
                    </label>
                    <label>
                      CRM web kancası
                      <input value={siteSettings?.crmWebhookUrl || ''} onChange={(event) => updateSiteSetting('crmWebhookUrl', event.target.value)} />
                    </label>
                    <label>
                      CRM erişim anahtarı
                      <input value={siteSettings?.crmAuthToken || ''} onChange={(event) => updateSiteSetting('crmAuthToken', event.target.value)} />
                    </label>
                  </div>
                )}

                <div className="portal-settings-actions">
                  <button type="button" className="cta cta-dark" onClick={saveSettings} disabled={settingsSaving}>
                    {settingsSaving ? 'Site ayarları kaydediliyor...' : 'Site ayarlarını kaydet'}
                  </button>
                  {settingsSavedAt ? <span className="field-hint">Son kayıt: {settingsSavedAt}</span> : null}
                </div>
              </article>
            )}

            {activePortalTab === 'customers' && (
            <article className="card admin-card lift admin-card-wide">
              <div className="portal-section-toolbar">
                <SectionTitle title="Müşteri Yönetimi" />
                <button type="button" className="portal-info-trigger" onClick={() => setCustomerIntroOpen(true)}>
                  Bilgi
                </button>
              </div>
              <div className="portal-view-switcher">
                <button type="button" className={`cta ${recordsView === 'active' ? 'cta-dark' : 'cta-light'}`} onClick={() => setRecordsView('active')}>
                  Aktif kayıtlar
                </button>
                <button type="button" className={`cta ${recordsView === 'archive' ? 'cta-dark' : 'cta-light'}`} onClick={() => setRecordsView('archive')}>
                  Arşiv
                </button>
              </div>

              <div className="portal-customer-workbench">
                <div className="portal-customer-table" role="list" aria-label="Müşteri kayıtları">
                  {visibleCustomers.map((customer) => {
                    const paymentSummary = getCustomerPaymentSummary(customer.id);
                    const isSelected = selectedCustomer?.id === customer.id;
                    return (
                      <button
                        type="button"
                        className={`portal-customer-row ${isSelected ? 'active' : ''}`}
                        key={customer.id}
                        onClick={() => {
                          setSelectedCustomerId(customer.id);
                          setCustomerDetailOpen(true);
                        }}
                        aria-pressed={isSelected}
                      >
                        <span className="portal-row-main">
                          <strong>{customer.name || 'İsimsiz müşteri'}</strong>
                          <small>{joinCompact([customer.companyType, customer.membershipStatus], ' | ')}</small>
                        </span>
                        <span className="portal-row-meta">
                          <span>{customer.stageLabel || (customer.stage ? `Adım ${customer.stage}` : 'Aşama yok')}</span>
                          <span>{formatPortalDate(customer.updatedAt || customer.createdAt)}</span>
                        </span>
                        <span className="portal-row-contact">
                          <span>{customer.phone || '-'}</span>
                          <span>{customer.email || '-'}</span>
                        </span>
                        <span className="portal-row-badges">
                          <span className={`portal-status-chip ${paymentSummary.completed ? 'paid' : 'pending'}`}>
                            {paymentSummary.completed ? 'Ödendi' : 'Ödeme bekliyor'}
                          </span>
                          <span className="portal-count-chip">{(customer.documents || []).length} evrak</span>
                        </span>
                      </button>
                    );
                  })}
                  {!visibleCustomers.length ? (
                    <div className="portal-empty-state">Bu görünümde müşteri kaydı yok.</div>
                  ) : null}
                </div>
              </div>
                {activeCustomers.length > visibleCustomers.length ? (
                  <button
                    type="button"
                    className="cta cta-light"
                    onClick={() => setVisibleCounts((current) => ({ ...current, customers: current.customers + portalPageSize }))}
                >
                  Daha fazla müşteri göster ({visibleCustomers.length}/{activeCustomers.length})
                </button>
              ) : null}
            </article>
            )}

            {activePortalTab === 'customers' && customerDetailOpen && selectedCustomer && typeof document !== 'undefined' ? createPortal((() => {
              const paymentSummary = getCustomerPaymentSummary(selectedCustomer.id);
              const documentIds = (selectedCustomer.documents || []).map((document) => document.id);
              const selectedDocumentIds = selectedDocuments[selectedCustomer.id] || [];
              const allDocumentsSelected = documentIds.length > 0 && selectedDocumentIds.length === documentIds.length;
              return (
                <div className="portal-customer-modal" role="dialog" aria-modal="true" aria-label="Müşteri detayları">
                  <button type="button" className="portal-customer-modal-backdrop" onClick={() => setCustomerDetailOpen(false)} aria-label="Müşteri detayını kapat" />
                  <div className="portal-customer-modal-dialog">
                    <CustomerDetailPanel
                      customer={selectedCustomer}
                      paymentSummary={paymentSummary}
                      selectedDocumentIds={selectedDocumentIds}
                      uploadingCustomerId={uploadingCustomerId}
                      allDocumentsSelected={allDocumentsSelected}
                      onArchive={archiveCustomer}
                      onClose={() => setCustomerDetailOpen(false)}
                      onDelete={deleteCustomer}
                      onDeleteDocument={deleteDocument}
                      onDeleteSelectedDocuments={deleteSelectedDocuments}
                      onSelectAllDocuments={selectAllDocuments}
                      onToggleDocumentSelection={toggleDocumentSelection}
                      onUploadDocument={uploadDocument}
                    />
                  </div>
                </div>
              );
            })(), document.body) : null}

            {activePortalTab === 'customers' && customerIntroOpen ? (
              <div className="portal-info-modal" role="dialog" aria-modal="true" aria-label="Müşteri yönetimi bilgisi">
                <button type="button" className="portal-info-backdrop" onClick={() => setCustomerIntroOpen(false)} aria-label="Kapat" />
                <div className="portal-info-dialog">
                  <button type="button" className="portal-info-close" onClick={() => setCustomerIntroOpen(false)} aria-label="Kapat">
                    ×
                  </button>
                  <div className="portal-info-head">
                    <span>i</span>
                    <div>
                      <h3>Müşteri Yönetimi</h3>
                      <p>
                        Müşteri kayıtları yalnızca web başvuru akışından gelir; portal bu kayıtları takip, belge, mesaj ve ödeme operasyonları için kullanır.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {activePortalTab === 'messages' && (
            <article className="card admin-card lift admin-card-wide">
              <div className="portal-collapse">
                <button
                  type="button"
                  className="portal-collapse-toggle"
                  aria-expanded={messageComposerOpen}
                  onClick={() => setMessageComposerOpen((current) => !current)}
                >
                  <span>
                    <strong>Yeni Mesaj Gönder</strong>
                    <small>Müşteriye SMS/WhatsApp veya Portal üzerinden mesaj iletin.</small>
                  </span>
                  <span className="portal-collapse-mark" aria-hidden="true">
                    {messageComposerOpen ? '−' : '+'}
                  </span>
                </button>
                <div className={`portal-collapse-panel ${messageComposerOpen ? 'expanded' : ''}`}>
                  <form className="portal-form portal-collapse-body" onSubmit={sendMessage}>
                <div className="inline-grid">
                  <label>
                    Müşteri
                    <select
                      value={messageForm.customerId}
                      onChange={(event) => setMessageForm((current) => ({ ...current, customerId: event.target.value }))}
                    >
                      <option value="">Seçin</option>
                      {customerOptions.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Kanal
                    <select value={messageForm.channel} onChange={(event) => setMessageForm((current) => ({ ...current, channel: event.target.value }))}>
                      <option value="portal">Portal</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="payment">Ödeme</option>
                      <option value="documents">Belge</option>
                    </select>
                  </label>
                </div>
                <label>
                  Mesaj
                  <textarea rows="3" value={messageForm.body} onChange={(event) => setMessageForm((current) => ({ ...current, body: event.target.value }))} />
                </label>
                <button type="submit" className="cta cta-dark">
                  Mesajı kaydet ve yönlendir
                </button>
                  </form>
                </div>
              </div>

              <div className="portal-collapse">
                <button
                  type="button"
                  className="portal-collapse-toggle"
                  aria-expanded={emailComposerOpen}
                  onClick={() => setEmailComposerOpen((current) => !current)}
                >
                  <span>
                    <strong>E-Posta Gönder</strong>
                    <small>Hazırlanan e-postayı doğrudan gönderin.</small>
                  </span>
                  <span className="portal-collapse-mark" aria-hidden="true">
                    {emailComposerOpen ? '−' : '+'}
                  </span>
                </button>
                <div className={`portal-collapse-panel ${emailComposerOpen ? 'expanded' : ''}`}>
                  <form className="portal-form portal-collapse-body" onSubmit={sendCustomEmail}>
                <div className="inline-grid">
                  <label>
                    Alıcı (E-Posta)
                    <input
                      type="email"
                      list="portal-customer-emails"
                      value={emailForm.to}
                      placeholder="Orn: musteri@mail.com"
                      onChange={(event) => setEmailForm((current) => ({ ...current, to: event.target.value }))}
                      required
                    />
                    <datalist id="portal-customer-emails">
                      {customerOptions.filter((c) => c.email).map((customer) => (
                        <option key={customer.id} value={customer.email}>
                          {customer.name} ({customer.email})
                        </option>
                      ))}
                    </datalist>
                  </label>
                  <label>
                    Konu
                    <input
                      value={emailForm.subject}
                      placeholder="E-posta konusu"
                      onChange={(event) => setEmailForm((current) => ({ ...current, subject: event.target.value }))}
                      required
                    />
                  </label>
                </div>
                <label>
                  E-posta İçeriği (HTML Destekler)
                  <textarea
                    rows="6"
                    value={emailForm.body}
                    placeholder="E-posta içeriğini buraya yazın..."
                    onChange={(event) => setEmailForm((current) => ({ ...current, body: event.target.value }))}
                    required
                  />
                </label>
                {emailStatus && <p className="field-hint" style={{ color: emailStatus.startsWith('Hata') ? '#ef4444' : '#10b981' }}>{emailStatus}</p>}
                <button type="submit" className="cta cta-dark" disabled={emailSending}>
                  {emailSending ? 'Gönderiliyor...' : 'E-Posta Gönder'}
                </button>
                  </form>
                </div>
              </div>

              <div className="admin-audit">
                <div className="portal-list-head">
                  <div>
                    <strong>Mesaj Akışı</strong>
                    <span>{visibleMessages.length ? `${selectedVisibleMessageIds.length}/${visibleMessages.length} seçili` : 'Kayıt yok'}</span>
                  </div>
                  <div className="portal-inline-actions">
                    <button type="button" className="cta cta-light" onClick={toggleAllVisibleMessages} disabled={!visibleMessages.length}>
                      {visibleMessagesAllSelected ? 'Seçimi temizle' : 'Tümünü seç'}
                    </button>
                    <button
                      type="button"
                      className="cta cta-dark"
                      onClick={deleteSelectedMessages}
                      disabled={!selectedVisibleMessageIds.length}
                    >
                      Seçiliyi sil
                    </button>
                  </div>
                </div>
                <ul className="admin-audit-list">
                  {visibleMessages.map((message) => (
                    <li key={message.id} className="portal-message-row">
                      <label className="field-checkbox portal-message-select">
                        <input
                          type="checkbox"
                          checked={selectedVisibleMessageIds.includes(message.id)}
                          onChange={() => toggleMessageSelection(message.id)}
                        />
                        <span>
                          <strong>
                            [{message.channel}] {message.body}
                          </strong>
                          <small>{message.createdAt ? `${message.createdAt} · ` : ''}{message.whatsappForwardedTo?.join(', ') || 'Yönlendirme yok'}</small>
                        </span>
                      </label>
                      <div className="portal-inline-actions">
                        <button type="button" className="cta cta-light" onClick={() => archiveMessage(message.id, message.archivedAt)}>
                          {message.archivedAt ? 'Arşivden çıkar' : 'Arşivle'}
                        </button>
                        <button type="button" className="cta cta-light" onClick={() => deleteMessage(message.id)}>
                          Sil
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {activeMessages.length > visibleMessages.length ? (
                  <button
                    type="button"
                    className="cta cta-light"
                    onClick={() => setVisibleCounts((current) => ({ ...current, messages: current.messages + portalPageSize }))}
                  >
                    Daha fazla mesaj göster ({visibleMessages.length}/{activeMessages.length})
                  </button>
                ) : null}
              </div>
            </article>
            )}

            {activePortalTab === 'payments' && (
            <article className="card admin-card lift admin-card-wide">
              <div className="admin-audit">
                <SectionTitle title="Ödeme Takibi" copy="Müşterilerin yaptığı tüm ödemeleri buradan izleyebilirsiniz." />
                <ul className="admin-audit-list">
                  {visiblePayments.map((payment) => {
                    const paymentCustomer = (dashboard?.customers || []).find((customer) => customer.id === payment.customerId);
                    return (
                      <li key={payment.id}>
                        <span>
                          {paymentCustomer?.name || 'Müşteri'} · {payment.amount} {payment.currency} · {payment.status}
                          {payment.createdAt ? ` · ${payment.createdAt}` : ''}
                        </span>
                        <strong>{payment.orderId || '-'}</strong>
                        <small>{payment.whatsappForwardedTo?.join(', ') || 'WhatsApp bildirimi yok'}</small>
                      </li>
                    );
                  })}
                </ul>
                {(dashboard?.payments || []).length > visiblePayments.length ? (
                  <button
                    type="button"
                    className="cta cta-light"
                    onClick={() => setVisibleCounts((current) => ({ ...current, payments: current.payments + portalPageSize }))}
                  >
                    Daha fazla ödeme göster ({visiblePayments.length}/{(dashboard?.payments || []).length})
                  </button>
                ) : null}
              </div>
            </article>
            )}

            {activePortalTab === 'whatsapp' && (
            <article className="card admin-card lift admin-card-wide">
              <SectionTitle title="WhatsApp" />
              <div className="portal-subtabs" role="tablist" aria-label="WhatsApp bölümleri">
                {whatsappTabs.map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    className={`portal-subtab ${activeWhatsappTab === tab.id ? 'active' : ''}`}
                    onClick={() => setActiveWhatsappTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeWhatsappTab === 'accounts' && (
                <div className="whatsapp-dashboard">
                  <div className="whatsapp-status-summary" aria-label="WhatsApp durum özeti">
                    <div>
                      <span>Toplam hat</span>
                      <strong>{whatsappStatusSummary.total}</strong>
                    </div>
                    <div>
                      <span>Hazır</span>
                      <strong>{whatsappStatusSummary.ready}</strong>
                    </div>
                    <div>
                      <span>İşlem bekleyen</span>
                      <strong>{whatsappStatusSummary.pending}</strong>
                    </div>
                    <div>
                      <span>Kapalı / pasif</span>
                      <strong>{whatsappStatusSummary.failed}</strong>
                    </div>
                  </div>

                  <div className="whatsapp-current-line">
                    {currentUserWhatsappConnection ? (() => {
                      const meta = getWhatsappStatusMeta(currentUserWhatsappConnection);
                      return (
                        <div className="preview-box portal-feature-box whatsapp-current-card">
                          <div>
                            <strong>Bu kullanıcıya bağlı hat</strong>
                            <p>{currentUserWhatsappConnection.label || currentUserWhatsappConnection.phone || user?.email}</p>
                          </div>
                          <span className={`whatsapp-status-pill ${meta.tone}`}>
                            <span className={`status-check ${meta.checked ? 'checked' : ''}`}>{meta.checked ? '✓' : ''}</span>
                            <span>{meta.icon}</span>
                            {meta.label}
                          </span>
                        </div>
                      );
                    })() : (
                      <div className="preview-box portal-feature-box whatsapp-current-card">
                        <div>
                          <strong>Kullanıcı bağlantısı hazır değil</strong>
                          <p>Bu portal kullanıcısı için WhatsApp bağlantısı ayrı olarak hazırlanır.</p>
                        </div>
                        <span className="whatsapp-status-pill muted">
                          <span className="status-check" />
                          X Kapalı
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="whatsapp-connection-grid">
                    {(dashboard?.whatsappConnections || []).map((connection) => {
                      const owner = connection.ownerUserId ? userById.get(connection.ownerUserId) : null;
                      const meta = getWhatsappStatusMeta(connection);
                      return (
                        <div className="preview-box whatsapp-connection-card" key={connection.id}>
                          <div className="whatsapp-card-head">
                            <div>
                              <strong>{connection.label || connection.phone || connection.id}</strong>
                              <p>{connection.method === 'qr' ? 'QR oturumu' : `Telefon: ${connection.phone || '-'}`}</p>
                            </div>
                            <span className={`whatsapp-status-pill ${meta.tone}`}>
                              <span className={`status-check ${meta.checked ? 'checked' : ''}`}>{meta.checked ? '✓' : ''}</span>
                              <span>{meta.icon}</span>
                              {meta.label}
                            </span>
                          </div>
                          <div className="whatsapp-info-grid">
                            <span>
                              <small>Portal kullanıcısı</small>
                              <strong>{owner ? `${owner.name || owner.email} (${owner.email})` : '-'}</strong>
                            </span>
                            <span>
                              <small>Durum</small>
                              <strong>{connection.isActive ? 'Aktif' : 'Pasif'}</strong>
                            </span>
                            <span>
                              <small>Oturum telefonu</small>
                              <strong>{connection.sessionPhone || connection.phone || '-'}</strong>
                            </span>
                          </div>
                          {connection.pairingCode ? (
                            <div className="portal-pairing-code">
                              <span>WhatsApp telefon kodu</span>
                              <strong>{connection.pairingCode}</strong>
                            </div>
                          ) : null}
                          {connection.qrDataUrl ? (
                            <img className="portal-qr" src={connection.qrDataUrl} alt="WhatsApp QR" />
                          ) : null}
                          <div className="portal-inline-actions">
                            <button type="button" className="cta cta-light" onClick={() => startConnection(connection.id)}>
                              {connection.method === 'phone' ? 'Telefon kodu iste' : 'QR oluştur'}
                            </button>
                            <button type="button" className="cta cta-light" onClick={() => stopConnection(connection.id)}>
                              Durdur
                            </button>
                            <button type="button" className="cta cta-light" onClick={() => resetConnectionSession(connection.id)}>
                              Session temizle
                            </button>
                            <button type="button" className="cta cta-light danger-action" onClick={() => deleteConnection(connection.id)}>
                              Sil
                            </button>
                          </div>
                          {connection.lastError ? <span className="field-warning">{connection.lastError}</span> : null}
                        </div>
                      );
                    })}
                    {!(dashboard?.whatsappConnections || []).length ? (
                      <div className="portal-empty-state">Henüz WhatsApp hattı yok.</div>
                    ) : null}
                  </div>
                </div>
              )}

              {activeWhatsappTab === 'pairing' && (
                <form className="portal-form" onSubmit={createConnection}>
                  <div className="inline-grid">
                    <label>
                      Yöntem
                      <select value={connectionForm.method} onChange={(event) => setConnectionForm((current) => ({ ...current, method: event.target.value }))}>
                        <option value="qr">QR</option>
                        <option value="phone">Telefon numarası</option>
                      </select>
                    </label>
                    <label>
                      Etiket
                      <input
                        value={connectionForm.label}
                        placeholder={`${user?.name || user?.email || 'Portal kullanıcısı'} WhatsApp`}
                        onChange={(event) => setConnectionForm((current) => ({ ...current, label: event.target.value }))}
                      />
                    </label>
                    <label>
                      Telefon
                      <input
                        value={connectionForm.phone}
                        inputMode="tel"
                        placeholder="905xxxxxxxxx"
                        onChange={(event) => setConnectionForm((current) => ({ ...current, phone: event.target.value }))}
                      />
                    </label>
                  </div>
                  <button type="submit" className="cta cta-dark">
                    Bağlantı ekle
                  </button>
                </form>
              )}

              {activeWhatsappTab === 'settings' && (
                <div className="inline-grid">
                  <div className="preview-box portal-full-span">
                    <strong>Ön kontrol</strong>
                    <p>
                      {whatsappPreflight
                        ? (whatsappPreflight.ok ? 'WhatsApp altyapısı hazır.' : 'WhatsApp altyapısında eksik var.')
                        : 'Henüz kontrol çalıştırılmadı.'}
                    </p>
                    {whatsappPreflight?.hints?.length ? (
                      <span>{whatsappPreflight.hints.join(' | ')}</span>
                    ) : null}
                    <div className="portal-inline-actions">
                      <button type="button" className="cta cta-light" onClick={checkWhatsAppPreflight} disabled={whatsappPreflightChecking}>
                        {whatsappPreflightChecking ? 'Kontrol ediliyor...' : 'Ön kontrol çalıştır'}
                      </button>
                    </div>
                  </div>
                  <div className="preview-box portal-full-span">
                    <strong>Hazırda bekletme</strong>
                    <p>Hat hazır olduktan sonra tarayıcı oturumu boşta kapatılır; mesaj gönderileceği zaman kayıtlı oturum yeniden açılır.</p>
                  </div>
                  <label className="field-checkbox">
                    <input type="checkbox" checked={Boolean(siteSettings?.whatsappRoutingEnabled)} onChange={(event) => updateSiteSetting('whatsappRoutingEnabled', event.target.checked)} />
                    WhatsApp yönlendirme aktif
                  </label>
                  <label className="field-checkbox">
                    <input type="checkbox" checked={Boolean(siteSettings?.notifyLeads)} onChange={(event) => updateSiteSetting('notifyLeads', event.target.checked)} />
                    Lead bildirimi gönder
                  </label>
                  <label className="field-checkbox">
                    <input type="checkbox" checked={Boolean(siteSettings?.notifyPayments)} onChange={(event) => updateSiteSetting('notifyPayments', event.target.checked)} />
                    Ödeme bildirimi gönder
                  </label>
                  <label className="field-checkbox">
                    <input type="checkbox" checked={Boolean(siteSettings?.notifyDocuments)} onChange={(event) => updateSiteSetting('notifyDocuments', event.target.checked)} />
                    Belge bildirimi gönder
                  </label>
                  <div className="portal-settings-actions portal-full-span">
                    <button type="button" className="cta cta-dark" onClick={saveSettings} disabled={settingsSaving}>
                      {settingsSaving ? 'Ayarlar kaydediliyor...' : 'WhatsApp ayarlarını kaydet'}
                    </button>
                    {settingsSavedAt ? <span className="field-hint">Son kayıt: {settingsSavedAt}</span> : null}
                  </div>
                </div>
              )}
            </article>
            )}

            {activePortalTab === 'security' && (
            <article className="card admin-card lift admin-card-wide">
              <SectionTitle title="Hesap Güvenliği" copy="Şifre değiştirin ve Google Authenticator ile ikinci faktör tanımlayın." />
              <form className="portal-form" onSubmit={changePassword}>
                <label>
                  Mevcut şifre
                  <input
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                  />
                </label>
                <label>
                  Yeni şifre
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                  />
                </label>
                <button type="submit" className="cta cta-dark">
                  Şifreyi değiştir
                </button>
              </form>
              <button type="button" className="cta cta-light" onClick={setup2fa}>
                Google Authenticator eşleştir
              </button>
              {twoFactorSetup && (
                <div className="preview-box">
                  <strong>2FA Kurulumu</strong>
                  <img src={twoFactorSetup.qrDataUrl} alt="Google Authenticator QR" className="portal-qr" />
                  <span>{twoFactorSetup.secret}</span>
                  <form className="portal-form" onSubmit={verify2fa}>
                    <label>
                      Doğrulama kodu
                      <input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value)} />
                    </label>
                    <button type="submit" className="cta cta-dark">
                      Etkinleştir
                    </button>
                  </form>
                </div>
              )}
            </article>
            )}

            {isSuperAdmin && activePortalTab === 'audit' && (
              <article className="card admin-card lift">
                <SectionTitle title="Audit Log" copy="Süper admin tüm kritik işlemleri geriye dönük izler." />
                <ul className="admin-audit-list">
                  {visibleAuditLogs.map((entry) => (
                    <li key={entry.id}>
                      <span>{entry.action}</span>
                      <strong>{entry.actor}</strong>
                      {entry.meta?.ip ? <small>IP: {entry.meta.ip}</small> : null}
                    </li>
                  ))}
                </ul>
                {(dashboard?.auditLogs || []).length > visibleAuditLogs.length ? (
                  <button
                    type="button"
                    className="cta cta-light"
                    onClick={() => setVisibleCounts((current) => ({ ...current, auditLogs: current.auditLogs + portalPageSize }))}
                  >
                    Daha fazla audit göster ({visibleAuditLogs.length}/{(dashboard?.auditLogs || []).length})
                  </button>
                ) : null}
              </article>
            )}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default OperationsPortal;
