import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch, getApiBase } from '../lib/api';
import EmailCodeInput from './EmailCodeInput';
import TurnstileWidget from './TurnstileWidget';

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

function formatAuditSource(entry) {
  return String(entry?.source || entry?.meta?.source || entry?.meta?.channel || entry?.meta?.route || 'admin-panel')
    .replace(/_/g, ' ')
    .trim();
}

function formatAuditWhen(entry) {
  return entry?.createdAt || entry?.at || '';
}

function formatOtpRemaining(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!minutes) return `${rest} sn`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function AdminPanel({
  title,
  copy,
  labels,
  unlocked,
  onUnlock,
  settings,
  onSettingChange,
  onServiceChange,
  onPlanChange,
  onCampaignRecordChange,
  onCreateCampaignRecord,
  onArchiveCampaignRecord,
  onRestoreCampaignRecord,
  onSetActiveCampaignRecord,
  onSyncLocations,
  locationCatalogMeta = {},
  languageOptions,
  supportLanguages,
  onToggleSupportLanguage,
  activeLanguage,
  onSaveDraft,
  onPublish,
  onResetDraft,
  auditLog,
  leadCount,
  leadData,
  visitData = [],
  lastDraftSavedAt,
  lastPublishedAt,
  turnstileSiteKey,
}) {
  const [activeTab, setActiveTab] = useState('general');
  const [leadSearch, setLeadSearch] = useState('');
  const [leadTemperatureFilter, setLeadTemperatureFilter] = useState('all');
  const [leadSourceFilter, setLeadSourceFilter] = useState('all');
  const [leadDeviceFilter, setLeadDeviceFilter] = useState('all');
  const [leadCompanyTypeFilter, setLeadCompanyTypeFilter] = useState('all');
  const [leadDateFilter, setLeadDateFilter] = useState('all');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginStage, setLoginStage] = useState('credentials');
  const [loginChallengeId, setLoginChallengeId] = useState('');
  const [loginEmailMasked, setLoginEmailMasked] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginResending, setLoginResending] = useState(false);
  const [loginNotice, setLoginNotice] = useState('');
  const [loginExpiresAt, setLoginExpiresAt] = useState(0);
  const [loginRemainingSeconds, setLoginRemainingSeconds] = useState(0);
  const [error, setError] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetVersion, setTurnstileResetVersion] = useState(0);
  const [syncingLocations, setSyncingLocations] = useState(false);
  const [paymentTestState, setPaymentTestState] = useState({ status: 'idle', message: '' });

  function applyLoginCodeExpiry(expiresInSeconds) {
    const ttl = Number(expiresInSeconds || 0);
    setLoginExpiresAt(ttl > 0 ? Date.now() + ttl * 1000 : 0);
    setLoginRemainingSeconds(ttl > 0 ? ttl : 0);
  }

  function resetSecureLoginFlow() {
    setLoginCode('');
    setLoginChallengeId('');
    setLoginStage('credentials');
    setLoginEmailMasked('');
    setLoginExpiresAt(0);
    setLoginRemainingSeconds(0);
    setTurnstileToken('');
    setTurnstileResetVersion((current) => current + 1);
  }

  useEffect(() => {
    if (!loginExpiresAt || loginStage !== 'code') return undefined;
    const tick = () => {
      setLoginRemainingSeconds(Math.max(0, Math.ceil((loginExpiresAt - Date.now()) / 1000)));
    };
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [loginExpiresAt, loginStage]);

  async function runIyzicoDiagnostic(kind) {
    const isLiveTest = kind === 'live-test';
    setPaymentTestState({ status: 'loading', message: isLiveTest ? '1 TL canlı test ödeme sayfası hazırlanıyor...' : kind === 'checkout' ? 'Checkout testi çalışıyor...' : 'Bağlantı testi çalışıyor...' });
    try {
      const endpoint = isLiveTest ? 'live-test-checkout' : kind === 'checkout' ? 'test-checkout' : 'test-connection';
      const result = await apiFetch(`/api/admin/iyzico/${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({ amount: 1, currency: 'TRY' }),
      });
      if (isLiveTest && result.paymentUrl) {
        window.open(result.paymentUrl, '_blank', 'noopener,noreferrer');
      }
      setPaymentTestState({ status: 'success', message: result.message || 'Test başarılı.' });
    } catch (diagnosticError) {
      setPaymentTestState({ status: 'error', message: diagnosticError.message || 'Test başarısız.' });
    }
  }

  async function handleSecureLogin(event) {
    event.preventDefault();
    setError('');
    setErrorDetail('');

    if (turnstileSiteKey && !turnstileToken) {
      setError('Lütfen Turnstile doğrulamasını tamamlayın.');
      return;
    }

    try {
      setLoginSubmitting(true);
      const data = await apiFetch('/api/auth/login/start', {
        method: 'POST',
        timeoutMs: 75_000,
        body: JSON.stringify({ email, password, turnstileToken, audience: 'admin' }),
      });
      if (data.user) {
        onUnlock(true);
        setEmail('');
        setPassword('');
        resetSecureLoginFlow();
        return;
      }
      setLoginStage('code');
      setLoginChallengeId(data.challengeId || '');
      setLoginEmailMasked(data.emailMasked || email);
      setLoginCode(String(data.devCode || ''));
      applyLoginCodeExpiry(data.expiresInSeconds);
      setTurnstileToken('');
      setTurnstileResetVersion((current) => current + 1);
    } catch (apiError) {
      setError(apiError.message || 'Giriş doğrulanamadı.');
      setErrorDetail(describeTurnstileFailure(apiError?.details?.errorCodes || apiError?.details?.['error-codes'] || apiError?.details?.error_codes));
      setTurnstileToken('');
      setTurnstileResetVersion((current) => current + 1);
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function verifySecureLogin(event, overrideCode = '') {
    event?.preventDefault?.();
    const nextCode = String(overrideCode || loginCode || '').replace(/\D/g, '').slice(0, 6);
    if (loginSubmitting || nextCode.length !== 6) return;
    setError('');
    setErrorDetail('');

    try {
      setLoginSubmitting(true);
      await apiFetch('/api/auth/login/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId: loginChallengeId, code: nextCode }),
      });
      onUnlock(true);
      setEmail('');
      setPassword('');
      resetSecureLoginFlow();
    } catch (apiError) {
      setError(apiError.message || 'Giriş doğrulanamadı.');
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function resendSecureLoginCode() {
    setError('');
    setErrorDetail('');
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
    } catch (apiError) {
      setError(apiError.message || 'Giriş kodu tekrar gönderilemedi.');
    } finally {
      setLoginResending(false);
    }
  }

  const isValidUrlInput = (value) => !value || /^(https?:\/\/)?[^\s]+\.[^\s]+/i.test(String(value));
  const l = {
    adminPanel: labels?.adminPanel || 'Admin panel',
    adminAccess: labels?.adminAccess || 'Admin erişimi',
    adminAccessCopy: labels?.adminAccessCopy || 'Önce kısa bir şifre ile paneli aç.',
    adminPlaceholder: labels?.adminPlaceholder || '0000',
    adminOpen: labels?.adminOpen || 'Panel açık',
    adminOpenAction: labels?.adminOpenAction || 'Paneli aç',
    generalSettings: labels?.generalSettings || 'Genel ayarlar',
    heroAccent: labels?.heroAccent || 'Ana sayfa vurgu metni',
    heroCopy: labels?.heroCopy || 'Ana sayfa açıklaması',
    primaryCta: labels?.primaryCta || 'Birincil CTA',
    secondaryCta: labels?.secondaryCta || 'İkincil CTA',
    whatsappMessage: labels?.whatsappMessage || 'WhatsApp mesajı',
    phone: labels?.phone || 'Telefon',
    contactEmail: labels?.contactEmail || 'E-posta adresi',
    contactAddress: labels?.contactAddress || 'İletişim adresi',
    websiteUrl: labels?.websiteUrl || 'Web sitesi',
    websiteTrUrl: labels?.websiteTrUrl || 'TR web sitesi',
    whatsappNumber: labels?.whatsappNumber || 'WhatsApp numarası',
    telegramUrl: labels?.telegramUrl || 'Telegram URL',
    instagramUrl: labels?.instagramUrl || 'Instagram URL',
    facebookUrl: labels?.facebookUrl || 'Facebook URL',
    contactBarLabels: labels?.contactBarLabels || 'Alt iletişim barı etiketleri',
    contactBarWhatsAppLabel: labels?.contactBarWhatsAppLabel || 'WhatsApp etiketi',
    contactBarTelegramLabel: labels?.contactBarTelegramLabel || 'Telegram etiketi',
    contactBarEmailLabel: labels?.contactBarEmailLabel || 'E-posta etiketi',
    contactBarCallLabel: labels?.contactBarCallLabel || 'Ara etiketi',
    contactBarInstagramLabel: labels?.contactBarInstagramLabel || 'Instagram etiketi',
    contactBarFacebookLabel: labels?.contactBarFacebookLabel || 'Facebook etiketi',
    contactPreview: labels?.contactPreview || 'İletişim önizleme',
    discountPercent: labels?.discountPercent || 'İndirim %',
    languages: labels?.languages || 'Diller',
    languagesCopy: labels?.languagesCopy || 'Aktif dil listesi ve bayraklar buradan yönetilir.',
    activeView: labels?.activeView || 'Aktif görünüm',
    previewCopy: labels?.previewCopy || 'Önizleme bu dilde gösteriliyor.',
    servicePrices: labels?.servicePrices || 'Hizmet fiyatları',
    planPrices: labels?.planPrices || 'Paket fiyatları',
    quote: labels?.quote || 'Teklif',
    adminHint: labels?.adminHint || 'Admin panelini açınca fiyatlar, başlıklar, CTA metinleri ve dil ayarlarını değiştirebilirsin.',
    adminStatus: labels?.adminStatus || 'Güvenli yönetim alanı',
    adminStatusCopy: labels?.adminStatusCopy || '',
    unlockedStatus: labels?.unlockedStatus || 'Aktif',
    lockedStatus: labels?.lockedStatus || 'Kilitli',
    quickStats: labels?.quickStats || 'Hızlı özet',
    languageCount: labels?.languageCount || 'Dil sayısı',
    serviceCount: labels?.serviceCount || 'Hizmet sayısı',
    planCount: labels?.planCount || 'Paket sayısı',
    generalSettingsHint: labels?.generalSettingsHint || '',
    languageSettingsHint: labels?.languageSettingsHint || 'Yönetim ekranında yalnızca aktif diller görünür.',
    priceSettingsHint: labels?.priceSettingsHint || 'Fiyatlar admin panelinden hızlıca güncellenir.',
    paymentTab: labels?.paymentTab || 'Ödeme',
    paymentSettingsHint: labels?.paymentSettingsHint || 'iyzico bağlantısı, callback URL ve şirket bilgileri burada tutulur.',
    paymentTrustTitle: labels?.paymentTrustTitle || 'Ödeme ve güven başlığı',
    paymentTrustCopy: labels?.paymentTrustCopy || 'Ödeme kartı ve güven bloklarının kısa açıklaması.',
    paymentMethodLabel: labels?.paymentMethodLabel || 'Ödeme yöntemi etiketi',
    cardLogosLabel: labels?.cardLogosLabel || 'Kart logoları etiketi',
    companyLegalName: labels?.companyLegalName || 'Ticari unvan',
    companyAddress: labels?.companyAddress || 'Adres',
    taxOffice: labels?.taxOffice || 'Vergi dairesi',
    taxNumber: labels?.taxNumber || 'Vergi no',
    tradeRegistryNo: labels?.tradeRegistryNo || 'Ticaret sicil no',
    mersisNo: labels?.mersisNo || 'MERSİS no',
    paymentCheckoutUrl: labels?.paymentCheckoutUrl || 'iyzico ödeme URL',
    iyzicoEnvironment: labels?.iyzicoEnvironment || 'Ortam',
    iyzicoInitializeEndpoint: labels?.iyzicoInitializeEndpoint || 'iyzico initialize endpoint',
    paymentCallbackUrl: labels?.paymentCallbackUrl || 'Callback URL',
    iyzicoMerchantId: labels?.iyzicoMerchantId || 'iyzico Merchant ID',
    iyzicoApiKey: labels?.iyzicoApiKey || 'iyzico API Key',
    iyzicoSecretKey: labels?.iyzicoSecretKey || 'iyzico Secret Key',
    sslStatus: labels?.sslStatus || 'SSL durumu',
    workingHoursLabel: labels?.workingHoursLabel || 'Çalışma saatleri',
    workingHoursHint: labels?.workingHoursHint || 'Footer’da görünecek çalışma saatleri bilgisi.',
    paymentReady: labels?.paymentReady || 'Ödeme altyapısı hazır',
    paymentNotReady: labels?.paymentNotReady || 'Ödeme bağlantısı henüz tanımlı değil',
    callbackSslNote: labels?.callbackSslNote || 'iyzico callbackUrl alanı SSL ile korunmalıdır.',
    paymentFlowLabel: labels?.paymentFlowLabel || 'Checkout Form akışı',
    paymentFlowCopy: labels?.paymentFlowCopy || 'Önce initialize çağrısı, sonra token ile ödeme sayfası ve callback sonucu.',
    sandboxLabel: labels?.sandboxLabel || 'Sandbox',
    liveLabel: labels?.liveLabel || 'Live',
    generalTab: labels?.generalTab || 'Genel',
    pricingTab: labels?.pricingTab || 'Fiyatlar',
    languageTab: labels?.languageTab || 'Diller',
    contactTab: labels?.contactTab || 'İletişim',
    legalTab: labels?.legalTab || 'Hukuki',
    seoTab: labels?.seoTab || 'SEO',
    seoTitle: labels?.seoTitle || 'SEO başlığı',
    seoDescription: labels?.seoDescription || 'SEO açıklaması',
    seoKeywords: labels?.seoKeywords || 'SEO anahtar kelimeleri',
    seoFocusTopic: labels?.seoFocusTopic || 'Odak konu',
    seoSettingsHint: labels?.seoSettingsHint || 'Google görünürlüğü için başlık, açıklama, konu ve yapılandırılmış veri ayarları.',
    livePreview: labels?.livePreview || 'Canlı önizleme',
    urlWarning: labels?.urlWarning || 'Geçerli URL bekleniyor.',
    emailWarning: labels?.emailWarning || 'Geçerli e-posta bekleniyor.',
    phoneWarning: labels?.phoneWarning || 'Telefon numarası formatını kontrol et.',
    priceWarning: labels?.priceWarning || '0, ücretsiz veya teklif anlamına gelebilir.',
    adminSecurityWarning:
      labels?.adminSecurityWarning || 'Admin erişimi yalnızca env tabanlı sunucu değişkeni ile açılmalıdır.',
    saveDraft: labels?.saveDraft || 'Taslağı kaydet',
    publish: labels?.publish || 'Yayına al',
    resetDraft: labels?.resetDraft || 'Taslağı geri al',
    draftSaved: labels?.draftSaved || 'Son taslak kaydı',
    publishedAt: labels?.publishedAt || 'Son yayın',
    leadCountLabel: labels?.leadCountLabel || 'Lead kaydı',
    auditLogTitle: labels?.auditLogTitle || 'Değişiklik kaydı',
    noAudit: labels?.noAudit || 'Henüz kayıt yok.',
  };

  const tabs = [
    { id: 'general', label: l.generalTab },
    { id: 'pricing', label: l.pricingTab },
    { id: 'campaign', label: 'Kampanya' },
    { id: 'leads', label: `Lead (${leadCount}) / Ziyaret (${visitData.length})` },
    { id: 'languages', label: l.languageTab },
    { id: 'contact', label: l.contactTab },
    { id: 'locations', label: 'Adres Kaynağı' },
    { id: 'payment', label: l.paymentTab },
    { id: 'legal', label: l.legalTab },
    { id: 'seo', label: l.seoTab },
    { id: 'security', label: 'Güvenlik & Günlük' },
  ];

  const warnings = useMemo(
    () => ({
      contactPhone: !/^[0-9+()\s-]{6,}$/.test(String(settings.contactPhone || '')) ? l.phoneWarning : '',
      contactEmail: settings.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.contactEmail) ? l.emailWarning : '',
      whatsappNumber: !/^\d{10,15}$/.test(String(settings.whatsappNumber || '')) ? l.phoneWarning : '',
      telegramUrl: !isValidUrlInput(settings.telegramUrl) ? l.urlWarning : '',
      instagramUrl: !isValidUrlInput(settings.instagramUrl) ? l.urlWarning : '',
      facebookUrl: !isValidUrlInput(settings.facebookUrl) ? l.urlWarning : '',
      websiteUrl: !isValidUrlInput(settings.websiteUrl) ? l.urlWarning : '',
      websiteTrUrl: !isValidUrlInput(settings.websiteTrUrl) ? l.urlWarning : '',
      discountPercent:
        Number(settings.discountPercent) < 0 || Number(settings.discountPercent) > 90 ? l.priceWarning : '',
    }),
    [
      l.phoneWarning,
      l.priceWarning,
      l.emailWarning,
      l.urlWarning,
      settings.contactPhone,
      settings.contactEmail,
      settings.discountPercent,
      settings.facebookUrl,
      settings.instagramUrl,
      settings.telegramUrl,
      settings.whatsappNumber,
      settings.websiteTrUrl,
      settings.websiteUrl,
    ],
  );

  const adminMetrics = [
    { label: l.languageCount, value: supportLanguages.length },
    { label: l.serviceCount, value: settings.services.length },
    { label: l.planCount, value: settings.plans.length },
    { label: l.leadCountLabel, value: leadCount },
    { label: 'Ziyaret kaydı', value: visitData.length },
  ];
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayVisits = visitData.filter((visit) => String(visit.lastSeenAt || visit.firstSeenAt || '').slice(0, 10) === todayKey);
  const hotVisits = visitData.filter((visit) => visit.leadTemperature === 'hot');
  const abandonedVisits = visitData.filter((visit) => visit.formAbandoned);
  const whatsappVisits = visitData.filter((visit) => visit.whatsappClicked);
  const todaySummary = [
    { label: 'Bugünkü ziyaret', value: todayVisits.length },
    { label: 'Sıcak lead', value: hotVisits.length },
    { label: 'WhatsApp tıklama', value: whatsappVisits.reduce((sum, visit) => sum + Number(visit.whatsappClickCount || 0), 0) },
    { label: 'Yarım form', value: abandonedVisits.length },
  ];
  const seoChecks = [
    { label: 'Başlık 35-65 karakter', ok: String(settings.seoTitle || '').length >= 35 && String(settings.seoTitle || '').length <= 65 },
    { label: 'Açıklama 90-160 karakter', ok: String(settings.seoDescription || '').length >= 90 && String(settings.seoDescription || '').length <= 160 },
    { label: 'Odak konu dolu', ok: Boolean(settings.seoFocusTopic) },
    { label: 'Canonical HTTPS', ok: /^https:\/\/www\./i.test(String(settings.websiteUrl || '')) },
  ];
  const normalizedLeadQuery = leadSearch.trim().toLowerCase();
  const sourceOptions = useMemo(() => {
    const sources = new Set();
    (leadData || []).forEach((lead) => {
      if (lead.source) sources.add(lead.source);
    });
    (visitData || []).forEach((visit) => {
      if (visit.source) sources.add(visit.source);
    });
    return Array.from(sources).sort((a, b) => String(a).localeCompare(String(b), 'tr'));
  }, [leadData, visitData]);
  const deviceOptions = useMemo(() => {
    const devices = new Set((visitData || []).map((visit) => visit.deviceType).filter(Boolean));
    return Array.from(devices).sort();
  }, [visitData]);
  const companyTypeOptions = useMemo(() => {
    const types = new Set((leadData || []).map((lead) => lead.companyTypeLabel || lead.companyType).filter(Boolean));
    return Array.from(types).sort((a, b) => String(a).localeCompare(String(b), 'tr'));
  }, [leadData]);
  const isWithinDateFilter = (value) => {
    if (leadDateFilter === 'all') return true;
    const time = new Date(value || '').getTime();
    if (!Number.isFinite(time)) return false;
    const nowTime = Date.now();
    if (leadDateFilter === 'today') {
      return new Date(time).toISOString().slice(0, 10) === todayKey;
    }
    if (leadDateFilter === '7d') {
      return nowTime - time <= 7 * 24 * 60 * 60 * 1000;
    }
    return true;
  };
  const filteredVisitData = useMemo(
    () =>
      (visitData || []).filter((visit) => {
        const searchable = [
          visit.lead?.name,
          visit.lead?.phone,
          visit.lead?.email,
          visit.lead?.companyName,
          visit.visitorId,
          visit.source,
          visit.locale,
          ...(visit.paths || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (normalizedLeadQuery && !searchable.includes(normalizedLeadQuery)) return false;
        if (leadTemperatureFilter !== 'all' && (visit.leadTemperature || 'cold') !== leadTemperatureFilter) return false;
        if (leadSourceFilter !== 'all' && (visit.source || '') !== leadSourceFilter) return false;
        if (leadDeviceFilter !== 'all' && (visit.deviceType || '') !== leadDeviceFilter) return false;
        if (!isWithinDateFilter(visit.lastSeenAt || visit.firstSeenAt)) return false;
        return true;
      }),
    [isWithinDateFilter, leadDeviceFilter, leadSourceFilter, leadTemperatureFilter, normalizedLeadQuery, visitData],
  );
  const filteredLeadData = useMemo(
    () =>
      (leadData || []).filter((lead) => {
        const searchable = [
          lead.name,
          lead.phone,
          lead.email,
          lead.companyName,
          lead.companyTypeLabel,
          lead.companyType,
          lead.source,
          lead.locale,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (normalizedLeadQuery && !searchable.includes(normalizedLeadQuery)) return false;
        if (leadSourceFilter !== 'all' && (lead.source || '') !== leadSourceFilter) return false;
        if (leadCompanyTypeFilter !== 'all' && (lead.companyTypeLabel || lead.companyType || '') !== leadCompanyTypeFilter) return false;
        if (!isWithinDateFilter(lead.createdAt)) return false;
        return true;
      }),
    [isWithinDateFilter, leadCompanyTypeFilter, leadData, leadSourceFilter, normalizedLeadQuery],
  );
  const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const downloadCsv = (filename, rows) => {
    if (!rows.length) return;
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportLeadCsv = () => {
    const headers = ['Tip', 'Tarih', 'Ad Soyad', 'Telefon', 'E-posta', 'Şirket', 'Şirket Türü', 'Dil', 'Kaynak', 'Süre sn', 'WhatsApp', 'Cihaz', 'Sayfa'];
    const leadRows = filteredLeadData.map((lead) => [
      'Lead',
      lead.createdAt,
      lead.name,
      lead.phone,
      lead.email,
      lead.companyName,
      lead.companyTypeLabel || lead.companyType,
      lead.locale,
      lead.source,
      '',
      '',
      '',
      '',
    ]);
    const visitRows = filteredVisitData.map((visit) => [
      'Ziyaret',
      visit.lastSeenAt,
      visit.lead?.name || '',
      visit.lead?.phone || '',
      visit.lead?.email || '',
      visit.lead?.companyName || '',
      '',
      visit.locale,
      visit.source,
      visit.durationSeconds,
      visit.whatsappClicked ? `Evet (${visit.whatsappClickCount || 1})` : 'Hayır',
      visit.deviceType,
      (visit.paths || []).join(' > '),
    ]);
    downloadCsv(`lead-ziyaret-${new Date().toISOString().slice(0, 10)}.csv`, [headers, ...leadRows, ...visitRows]);
  };
  const exportTimelineCsv = () => {
    const headers = ['Ziyaretçi', 'Lead', 'Tarih', 'Olay', 'Kaynak', 'Hedef', 'Etiket', 'Sayfa', 'Süre sn', 'Sıcaklık', 'Cihaz'];
    const rows = filteredVisitData.flatMap((visit) => {
      const events = (visit.events || []).length
        ? visit.events
        : [{ type: 'summary', at: visit.lastSeenAt, path: (visit.paths || [])[0], durationSeconds: visit.durationSeconds }];
      return events.map((event) => [
        visit.visitorId || visit.sessionId || '',
        visit.lead?.name || '',
        event.at || visit.lastSeenAt,
        event.type || '',
        visit.source || '',
        event.target || '',
        event.label || '',
        event.path || '',
        event.durationSeconds ?? visit.durationSeconds ?? '',
        visit.leadTemperature || '',
        visit.deviceType || '',
      ]);
    });
    downloadCsv(`musteri-timeline-${new Date().toISOString().slice(0, 10)}.csv`, [headers, ...rows]);
  };

  return (
    <section className="section admin-section" id="admin">
      <div className="section-head">
        <div className="pill">{l.adminPanel}</div>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>

      <div className="admin-shell">
        {!unlocked ? (
          <div className="admin-lock admin-secure-login-card card lift">
            <div className="admin-lock-head">
              <div className="secure-badge-container">
                <span className="lock-icon-wrapper">🔒</span>
                <div>
                  <h3>Güvenli Yönetici Girişi</h3>
                  <p>Portal yönetim ve ayarlar paneline erişmek için bilgilerinizi giriniz.</p>
                </div>
              </div>
              <span className="admin-lock-chip secure-status">SSL Korumalı</span>
            </div>

            <form onSubmit={loginStage === 'code' ? verifySecureLogin : handleSecureLogin} className="admin-secure-form">
              {loginStage === 'credentials' ? (
                <>
                  <div className="secure-input-group">
                    <label htmlFor="admin-email">E-Posta Adresi</label>
                    <div className="input-with-icon">
                      <span className="input-icon">✉️</span>
                      <input
                        id="admin-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="isim@onlinesmmm.com"
                        required
                      />
                    </div>
                  </div>

                  <div className="secure-input-group">
                    <label htmlFor="admin-password">Şifre</label>
                    <div className="input-with-icon">
                      <span className="input-icon">🔑</span>
                      <input
                        id="admin-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        required
                      />
                    </div>
                  </div>

                  <TurnstileWidget
                    siteKey={turnstileSiteKey}
                    action="turnstile-spin-v1"
                    label="Turnstile doğrulaması"
                    onTokenChange={setTurnstileToken}
                    resetVersion={turnstileResetVersion}
                  />
                </>
              ) : (
                <div className="secure-otp-step">
                  <div className="portal-otp-copy">
                    <strong>Giriş kodu gönderildi</strong>
                    <p>{loginEmailMasked || email}</p>
                  </div>
                  <EmailCodeInput
                    value={loginCode}
                    onChange={setLoginCode}
                    onComplete={(code) => verifySecureLogin(null, code)}
                    disabled={loginSubmitting}
                    autoFocus
                  />
                  {loginRemainingSeconds > 0 ? (
                    <span className="field-hint">Kod {formatOtpRemaining(loginRemainingSeconds)} geçerli. Son hane girilince otomatik kontrol edilir.</span>
                  ) : (
                    <span className="field-hint field-hint-error">Kod süresi dolduysa tekrar gönderin.</span>
                  )}
                  {loginNotice && <p className="field-success">{loginNotice}</p>}
                  <button
                    type="button"
                    className="cta cta-light portal-otp-back"
                    disabled={loginResending}
                    onClick={resendSecureLoginCode}
                  >
                    {loginResending ? 'Tekrar gönderiliyor...' : 'Kodu tekrar gönder'}
                  </button>
                  <button
                    type="button"
                    className="cta cta-light portal-otp-back"
                    onClick={resetSecureLoginFlow}
                  >
                    Geri dön
                  </button>
                </div>
              )}

              {error && (
                <div className="secure-error-banner">
                  <span className="error-icon">⚠️</span>
                  <p className="error-text">{error}</p>
                  {errorDetail && <p className="error-detail">{errorDetail}</p>}
                </div>
              )}

              <button
                className="cta cta-dark secure-submit-btn"
                type="submit"
                  disabled={
                    loginSubmitting ||
                    (loginStage === 'credentials' ? Boolean(turnstileSiteKey && !turnstileToken) : String(loginCode).replace(/\D/g, '').length !== 6)
                  }
              >
                {loginSubmitting
                  ? 'Hazırlanıyor...'
                  : loginStage === 'code'
                    ? 'Kodu doğrula'
                    : 'Giriş kodu gönder'}
              </button>
            </form>

            <div className="secure-login-footer">
              <div className="security-signals-grid">
                <div className="signal-item">
                  <span className="signal-bullet">✓</span>
                  <span>256-Bit SSL Bağlantısı</span>
                </div>
                <div className="signal-item">
                  <span className="signal-bullet">✓</span>
                  <span>IP Ülke Kısıtlaması (Sadece TR)</span>
                </div>
                <div className="signal-item">
                  <span className="signal-bullet">✓</span>
                  <span>Giriş Denetimi Aktif (Audit Log)</span>
                </div>
              </div>
              <div className="client-ip-bar">
                <strong>API:</strong> <code>{getApiBase()}</code>
                <span className="ip-status-badge">Sunucu doğrulamalı</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="card admin-banner lift">
              <div className="admin-banner-copy">
                <div className="admin-kicker">{l.adminStatus}</div>
                <h3>{l.adminAccess}</h3>
                {l.adminStatusCopy ? <p>{l.adminStatusCopy}</p> : null}
              </div>
              <div className={`admin-status ${unlocked ? 'active' : ''}`}>
                <span className="admin-status-dot" />
                <strong>{unlocked ? l.unlockedStatus : l.lockedStatus}</strong>
              </div>
              <div className="admin-metrics" aria-label={l.quickStats}>
                {adminMetrics.map((metric) => (
                  <div className="admin-metric" key={metric.label}>
                    <strong>{metric.value}</strong>
                    <span>{metric.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="admin-today-panel">
              <div className="card admin-today-card lift">
                <div className="admin-card-head">
                  <div>
                    <h3>Bugün ne oldu?</h3>
                    <p>Ziyaret, sıcak lead, WhatsApp ve yarım form özetleri.</p>
                  </div>
                  <span className="admin-card-badge">Canlı satış radarı</span>
                </div>
                <div className="admin-today-metrics">
                  {todaySummary.map((metric) => (
                    <div className="admin-today-metric" key={metric.label}>
                      <strong>{metric.value}</strong>
                      <span>{metric.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card admin-today-card lift">
                <div className="admin-card-head">
                  <div>
                    <h3>Sıcak ziyaretçiler</h3>
                    <p>30 sn + WhatsApp, form veya lead davranışı gösterenler.</p>
                  </div>
                </div>
                <div className="hot-lead-list">
                  {hotVisits.slice(0, 5).map((visit) => (
                    <div className="hot-lead-row" key={visit.id || visit.sessionId}>
                      <strong>{visit.lead?.name || visit.visitorId || 'Anonim ziyaretçi'}</strong>
                      <span>{Math.round(Number(visit.durationSeconds || 0))} sn</span>
                      <span>{visit.whatsappClicked ? `WhatsApp ${visit.whatsappClickCount || 1}` : 'Form/Lead'}</span>
                    </div>
                  ))}
                  {!hotVisits.length && <p className="admin-empty-note">Henüz sıcak ziyaretçi yok.</p>}
                </div>
              </div>
            </div>

            <div className="admin-grid">
            <div className="card admin-card lift admin-card-wide">
              <div className="admin-card-head">
                <div>
                  <h3>{tabs.find((tab) => tab.id === activeTab)?.label || l.generalTab}</h3>
                  {l.generalSettingsHint ? <p>{l.generalSettingsHint}</p> : null}
                </div>
                <span className="admin-card-badge">{l.livePreview}</span>
              </div>

              <div className="admin-publish-row">
                <div className="admin-publish-meta">
                  <strong>{l.draftSaved}</strong>
                  <span>{lastDraftSavedAt || '-'}</span>
                </div>
                <div className="admin-publish-meta">
                  <strong>{l.publishedAt}</strong>
                  <span>{lastPublishedAt || '-'}</span>
                </div>
                <button className="cta cta-light" type="button" onClick={onResetDraft}>
                  {l.resetDraft}
                </button>
                <button className="cta cta-light" type="button" onClick={onSaveDraft}>
                  {l.saveDraft}
                </button>
                <button className="cta cta-dark" type="button" onClick={onPublish}>
                  {l.publish}
                </button>
              </div>

              <div className="admin-tabs" role="tablist" aria-label={l.adminPanel}>
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`admin-tab ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === 'general' && (
                <div className="admin-tab-panel">
                  <label>
                    {l.heroAccent}
                    <input value={settings.heroAccent} onChange={(event) => onSettingChange('heroAccent', event.target.value)} />
                  </label>
                  <label>
                    {l.heroCopy}
                    <textarea rows="4" value={settings.heroCopy} onChange={(event) => onSettingChange('heroCopy', event.target.value)} />
                  </label>
                  <label>
                    {l.primaryCta}
                    <input value={settings.primaryCta} onChange={(event) => onSettingChange('primaryCta', event.target.value)} />
                  </label>
                  <label>
                    {l.secondaryCta}
                    <input value={settings.secondaryCta} onChange={(event) => onSettingChange('secondaryCta', event.target.value)} />
                  </label>
                  <label>
                    {l.whatsappMessage}
                    <textarea rows="3" value={settings.whatsappMessage} onChange={(event) => onSettingChange('whatsappMessage', event.target.value)} />
                  </label>
                </div>
              )}

              {activeTab === 'pricing' && (
                <div className="admin-tab-panel">
                  <label>
                    {l.discountPercent}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="number"
                        min="0"
                        max="90"
                        value={settings.discountPercent}
                        onChange={(event) => onSettingChange('discountPercent', Number(event.target.value))}
                        style={{ width: 100, textAlign: 'right' }}
                      />
                      <span style={{ fontWeight: 900, color: '#2563eb', fontSize: '1.2rem' }}>%</span>
                    </div>
                    {warnings.discountPercent && <span className="field-warning">{warnings.discountPercent}</span>}
                    <span className="field-hint">Kampanya indirim oranı. 0 = indirim yok. Tüm hizmet ve paket fiyatlarına uygulanır.</span>
                  </label>

                  <div className="preview-box">
                    <strong>Kampanya Önizleme</strong>
                    <p>
                      {settings.discountPercent > 0
                        ? `%${settings.discountPercent} indirim aktif — fiyatlar otomatik hesaplanıyor`
                        : 'İndirim yok — orijinal fiyatlar gösteriliyor'}
                    </p>
                    <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      Örnek: 3.000 ₺ hizmet → {Math.round(3000 * (1 - (settings.discountPercent || 0) / 100)).toLocaleString('tr-TR')} ₺
                    </span>
                  </div>

                  <strong style={{ marginTop: 8 }}>Hizmet Fiyatları</strong>
                  <div className="admin-price-list">
                    {settings.services.map((service) => (
                      <label key={service.id}>
                        {service.title}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="number"
                            min="0"
                            value={service.price ?? ''}
                            onChange={(event) => onServiceChange(service.id, 'price', event.target.value)}
                            placeholder={l.quote}
                            style={{ flex: 1 }}
                          />
                          <span style={{ fontWeight: 700, color: '#64748b' }}>₺</span>
                        </div>
                        {service.price != null && settings.discountPercent > 0 && (
                          <span className="field-hint">
                            İndirimli: {Math.round(service.price * (1 - settings.discountPercent / 100)).toLocaleString('tr-TR')} ₺
                          </span>
                        )}
                      </label>
                    ))}
                  </div>

                  <strong style={{ marginTop: 8 }}>Paket Taban Fiyatları</strong>
                  <div className="admin-price-list">
                    {settings.plans.map((plan) => (
                      <label key={plan.id}>
                        {plan.name}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="number"
                            min="0"
                            value={plan.basePrice}
                            onChange={(event) => onPlanChange(plan.id, 'basePrice', event.target.value)}
                            style={{ flex: 1 }}
                          />
                          <span style={{ fontWeight: 700, color: '#64748b' }}>₺</span>
                        </div>
                        {settings.discountPercent > 0 && (
                          <span className="field-hint">
                            İndirimli: {Math.round(plan.basePrice * (1 - settings.discountPercent / 100)).toLocaleString('tr-TR')} ₺
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>

              )}

              {activeTab === 'campaign' && (
                <div className="admin-tab-panel">
                  <p>Kampanya popup'ını, gösterim süresini ve arşiv kayıtlarını buradan yönet.</p>
                  <div className="inline-grid">
                    <label className="admin-toggle-label">
                      <span>Kampanya Popup Aktif</span>
                      <input
                        type="checkbox"
                        checked={Boolean(settings.campaignPopupEnabled)}
                        onChange={(event) => onSettingChange('campaignPopupEnabled', event.target.checked)}
                      />
                    </label>
                    <label>
                      Otomatik kapanma süresi (sn)
                      <input
                        type="number"
                        min="0"
                        max="120"
                        value={settings.campaignPopupDelaySeconds ?? 10}
                        onChange={(event) => onSettingChange('campaignPopupDelaySeconds', Number(event.target.value || 0))}
                      />
                    </label>
                    <label>
                      Aktif kampanya
                      <select
                        value={settings.campaignPopupActiveId || ''}
                        onChange={(event) => onSetActiveCampaignRecord?.(event.target.value)}
                      >
                        {(settings.campaignPopupArchive || []).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title || item.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="campaign-admin-actions">
                    <button type="button" className="cta cta-dark" onClick={() => onCreateCampaignRecord?.()}>
                      + Yeni kampanya ekle
                    </button>
                    <span className="field-hint">Eski kampanyalar arşivde kalır, istersen tekrar aktif edilir.</span>
                  </div>

                  <div className="admin-campaign-archive">
                    {(settings.campaignPopupArchive || []).map((item) => {
                      const isActive = settings.campaignPopupActiveId === item.id && item.isActive && !item.archivedAt;
                      const isArchived = Boolean(item.archivedAt);
                      return (
                        <article key={item.id} className={`campaign-archive-card ${isActive ? 'is-active' : ''} ${isArchived ? 'is-archived' : ''}`}>
                          <div className="campaign-archive-head">
                            <div>
                              <strong>{item.title || 'Kampanya'}</strong>
                              <p>{item.subtitle || item.description || 'Kampanya detayı yok.'}</p>
                            </div>
                            <div className="campaign-archive-status">
                              {isActive ? 'Aktif' : isArchived ? 'Arşiv' : 'Pasif'}
                            </div>
                          </div>
                          <div className="inline-grid">
                            <label>
                              Başlık
                              <input
                                value={item.title || ''}
                                onChange={(event) => onCampaignRecordChange?.(item.id, { title: event.target.value })}
                              />
                            </label>
                            <label>
                              Rozet
                              <input
                                value={item.badge || ''}
                                onChange={(event) => onCampaignRecordChange?.(item.id, { badge: event.target.value })}
                              />
                            </label>
                            <label>
                              Alt başlık
                              <input
                                value={item.subtitle || ''}
                                onChange={(event) => onCampaignRecordChange?.(item.id, { subtitle: event.target.value })}
                              />
                            </label>
                            <label>
                              Aksiyon butonu
                              <input
                                value={item.ctaLabel || ''}
                                onChange={(event) => onCampaignRecordChange?.(item.id, { ctaLabel: event.target.value })}
                              />
                            </label>
                            <label>
                              Hedef bağlantı
                              <input
                                value={item.ctaHref || ''}
                                onChange={(event) => onCampaignRecordChange?.(item.id, { ctaHref: event.target.value })}
                              />
                            </label>
                            <label>
                              Görsel URL
                              <input
                                value={item.imageUrl || ''}
                                onChange={(event) => onCampaignRecordChange?.(item.id, { imageUrl: event.target.value })}
                              />
                            </label>
                            <label>
                              Bitiş tarihi
                              <input
                                type="datetime-local"
                                step="1"
                                value={item.endDate || ''}
                                placeholder="2026-08-30T23:59:59"
                                onChange={(event) => onCampaignRecordChange?.(item.id, { endDate: event.target.value })}
                              />
                            </label>
                            <label>
                              Otomatik kapanma süresi (sn)
                              <input
                                type="number"
                                min="0"
                                value={item.delaySeconds ?? 10}
                                onChange={(event) => onCampaignRecordChange?.(item.id, { delaySeconds: Number(event.target.value || 0) })}
                              />
                            </label>
                            <label className="field-full">
                              Kampanya açıklaması
                              <textarea
                                rows="3"
                                value={item.description || ''}
                                onChange={(event) => onCampaignRecordChange?.(item.id, { description: event.target.value })}
                              />
                            </label>
                          </div>
                          <div className="campaign-archive-actions">
                            <button type="button" className="cta cta-light" onClick={() => onSetActiveCampaignRecord?.(item.id)}>
                              Aktif et
                            </button>
                            <button type="button" className="cta cta-light" onClick={() => onArchiveCampaignRecord?.(item.id)}>
                              Arşive al
                            </button>
                            <button type="button" className="cta cta-light" onClick={() => onRestoreCampaignRecord?.(item.id)}>
                              Pasiften çıkar
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="preview-box">
                    <strong>Popup Durumu</strong>
                    <p>{settings.campaignPopupEnabled ? '✅ Aktif — Açılışta gösterilir' : '❌ Kapalı — Popup gizli'}</p>
                    <span>Otomatik kapanma: {settings.campaignPopupDelaySeconds ?? 10} sn</span>
                    <span>Toplam kayıt: {(settings.campaignPopupArchive || []).length}</span>
                  </div>
                </div>
              )}

              {activeTab === 'leads' && (
                <div className="admin-tab-panel">
                  <div className="admin-leads-header">
                    <p>
                      {leadCount} lead kaydı ve {visitData.length} ziyaret davranışı bulunuyor.
                      Filtre sonucu: {filteredLeadData.length} lead / {filteredVisitData.length} ziyaret.
                    </p>
                    <div className="admin-lead-toolbar">
                      <input
                        placeholder="Ad, e-posta veya şirket ile ara..."
                        value={leadSearch}
                        onChange={(e) => setLeadSearch(e.target.value)}
                      />
                      <select value={leadTemperatureFilter} onChange={(event) => setLeadTemperatureFilter(event.target.value)}>
                        <option value="all">Tüm sıcaklıklar</option>
                        <option value="hot">Sıcak lead</option>
                        <option value="warm">Ilık ziyaretçi</option>
                        <option value="cold">Soğuk ziyaretçi</option>
                      </select>
                      <select value={leadSourceFilter} onChange={(event) => setLeadSourceFilter(event.target.value)}>
                        <option value="all">Tüm kaynaklar</option>
                        {sourceOptions.map((source) => (
                          <option key={source} value={source}>{source}</option>
                        ))}
                      </select>
                      <select value={leadDeviceFilter} onChange={(event) => setLeadDeviceFilter(event.target.value)}>
                        <option value="all">Tüm cihazlar</option>
                        {deviceOptions.map((device) => (
                          <option key={device} value={device}>{device}</option>
                        ))}
                      </select>
                      <select value={leadCompanyTypeFilter} onChange={(event) => setLeadCompanyTypeFilter(event.target.value)}>
                        <option value="all">Tüm şirket tipleri</option>
                        {companyTypeOptions.map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                      <select value={leadDateFilter} onChange={(event) => setLeadDateFilter(event.target.value)}>
                        <option value="all">Tüm tarihler</option>
                        <option value="today">Bugün</option>
                        <option value="7d">Son 7 gün</option>
                      </select>
                      <button
                        className="cta cta-light"
                        type="button"
                        onClick={exportLeadCsv}
                      >
                        Lead CSV
                      </button>
                      <button
                        className="cta cta-light"
                        type="button"
                        onClick={exportTimelineCsv}
                      >
                        Timeline CSV
                      </button>
                    </div>
                  </div>
                  {filteredVisitData.length > 0 ? (
                    <div className="admin-visit-section">
                      <div className="admin-leads-header compact">
                        <p>Ziyaret ve davranış kayıtları</p>
                      </div>
                      <div className="admin-visit-grid">
                        {filteredVisitData.slice(0, 60).map((visit) => (
                          <div className="admin-visit-card" key={visit.id || visit.sessionId}>
                            <div className="admin-lead-head">
                              <strong>{visit.lead?.name || visit.visitorId || 'Anonim ziyaretçi'}</strong>
                              <span className={`admin-visit-temperature ${visit.leadTemperature || 'cold'}`}>
                                {visit.leadTemperature === 'hot' ? 'Sıcak lead' : visit.leadTemperature === 'warm' ? 'Ilık ziyaretçi' : 'Soğuk ziyaretçi'}
                              </span>
                              <span className={visit.whatsappClicked ? 'admin-visit-positive' : 'admin-lead-type'}>
                                {visit.whatsappClicked ? `WhatsApp: ${visit.whatsappClickCount || 1}` : 'WhatsApp yok'}
                              </span>
                              <span className="admin-lead-date">{visit.lastSeenAt}</span>
                            </div>
                            <div className="admin-lead-body">
                              <span>Süre: {Math.round(Number(visit.durationSeconds || 0))} sn</span>
                              <span>Sayfa: {visit.pageViews || 0}</span>
                              <span>Tıklama: {visit.clickCount || 0}</span>
                              <span>Cihaz: {visit.deviceType || '-'}</span>
                              {visit.formAbandoned && <span>Formu yarım bıraktı</span>}
                              {visit.phoneClicked && <span>Telefon tıkladı</span>}
                              {visit.source && <span>Kaynak: {visit.source}</span>}
                              {visit.lead?.phone && <span>Tel: {visit.lead.phone}</span>}
                              {visit.lead?.email && <span>E-posta: {visit.lead.email}</span>}
                              {(visit.paths || []).length ? <span>Gezdiği sayfalar: {(visit.paths || []).join(' > ')}</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="preview-box">
                      <strong>Ziyaret kaydı bekleniyor</strong>
                      <p>Ziyaretçiler siteyi gezdikçe süre, WhatsApp ve CTA tıklamaları burada görünecek.</p>
                    </div>
                  )}

                  {filteredLeadData.length > 0 ? (
                    <div className="admin-lead-list">
                      {filteredLeadData.map((lead) => (
                          <div className="admin-lead-card" key={lead.id}>
                            <div className="admin-lead-head">
                              <strong>{lead.name || '—'}</strong>
                              <span className="admin-lead-type">{lead.companyTypeLabel}</span>
                              <span className="admin-lead-date">{lead.createdAt}</span>
                            </div>
                            <div className="admin-lead-body">
                              <span>📞 {lead.phone}</span>
                              <span>✉️ {lead.email}</span>
                              {lead.companyName && <span>🏢 {lead.companyName}</span>}
                              {lead.estimate && <span>💰 {lead.estimate}</span>}
                              {lead.source && <span>🔗 {lead.source}</span>}
                              {lead.locale && <span>🌐 {lead.locale.toUpperCase()}</span>}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="preview-box">
                      <strong>Henüz lead kaydı yok</strong>
                      <p>Ziyaretçiler sihirbaz formunu doldurduğunda burada görünecek.</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'languages' && (
                <div className="admin-tab-panel">
                  <p>{l.languagesCopy}</p>
                  <div className="admin-language-grid">
                    {languageOptions.map((lang) => (
                      <button
                        key={lang.code}
                        type="button"
                        className={`language-tag ${supportLanguages.includes(lang.code) ? 'active' : ''}`}
                        onClick={() => onToggleSupportLanguage(lang.code)}
                      >
                        <span>{lang.flag}</span>
                        <span>{lang.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="preview-box">
                    <strong>{l.activeView}</strong>
                    <p>
                      {activeLanguage.flag} {activeLanguage.label}
                    </p>
                    <span>{l.previewCopy}</span>
                  </div>
                </div>
              )}

              {activeTab === 'contact' && (
                <div className="admin-tab-panel">
                  <p>{l.generalSettingsHint}</p>
                  <div className="inline-grid">
                    <label>
                      {l.phone}
                      <input value={settings.contactPhone} onChange={(event) => onSettingChange('contactPhone', event.target.value)} />
                      {warnings.contactPhone && <span className="field-warning">{warnings.contactPhone}</span>}
                    </label>
                    <label>
                      {l.contactEmail}
                      <input value={settings.contactEmail || ''} onChange={(event) => onSettingChange('contactEmail', event.target.value)} />
                      {warnings.contactEmail && <span className="field-warning">{warnings.contactEmail}</span>}
                    </label>
                    <label>
                      {l.contactAddress}
                      <input value={settings.contactAddress || ''} onChange={(event) => onSettingChange('contactAddress', event.target.value)} />
                    </label>
                    <label>
                      {l.whatsappNumber}
                      <input value={settings.whatsappNumber} onChange={(event) => onSettingChange('whatsappNumber', event.target.value)} />
                      {warnings.whatsappNumber && <span className="field-warning">{warnings.whatsappNumber}</span>}
                    </label>
                    <label>
                      {l.websiteUrl}
                      <input value={settings.websiteUrl || ''} onChange={(event) => onSettingChange('websiteUrl', event.target.value)} />
                      {warnings.websiteUrl && <span className="field-warning">{warnings.websiteUrl}</span>}
                    </label>
                    <label>
                      {l.websiteTrUrl}
                      <input value={settings.websiteTrUrl || ''} onChange={(event) => onSettingChange('websiteTrUrl', event.target.value)} />
                      {warnings.websiteTrUrl && <span className="field-warning">{warnings.websiteTrUrl}</span>}
                    </label>
                    <label>
                      {l.telegramUrl}
                      <input value={settings.telegramUrl} onChange={(event) => onSettingChange('telegramUrl', event.target.value)} />
                      {warnings.telegramUrl && <span className="field-warning">{warnings.telegramUrl}</span>}
                    </label>
                    <label>
                      {l.instagramUrl}
                      <input value={settings.instagramUrl} onChange={(event) => onSettingChange('instagramUrl', event.target.value)} />
                      {warnings.instagramUrl && <span className="field-warning">{warnings.instagramUrl}</span>}
                    </label>
                    <label>
                      {l.facebookUrl}
                      <input value={settings.facebookUrl} onChange={(event) => onSettingChange('facebookUrl', event.target.value)} />
                      {warnings.facebookUrl && <span className="field-warning">{warnings.facebookUrl}</span>}
                    </label>
                  </div>
                  <div className="admin-contact-labels">
                    <strong>{l.contactBarLabels}</strong>
                    <div className="inline-grid">
                      <label>
                        {l.contactBarWhatsAppLabel}
                        <input value={settings.contactBarWhatsAppLabel || ''} onChange={(event) => onSettingChange('contactBarWhatsAppLabel', event.target.value)} />
                      </label>
                      <label>
                        {l.contactBarTelegramLabel}
                        <input value={settings.contactBarTelegramLabel || ''} onChange={(event) => onSettingChange('contactBarTelegramLabel', event.target.value)} />
                      </label>
                      <label>
                        {l.contactBarEmailLabel}
                        <input value={settings.contactBarEmailLabel || ''} onChange={(event) => onSettingChange('contactBarEmailLabel', event.target.value)} />
                      </label>
                      <label>
                        {l.contactBarCallLabel}
                        <input value={settings.contactBarCallLabel || ''} onChange={(event) => onSettingChange('contactBarCallLabel', event.target.value)} />
                      </label>
                      <label>
                        {l.contactBarInstagramLabel}
                        <input value={settings.contactBarInstagramLabel || ''} onChange={(event) => onSettingChange('contactBarInstagramLabel', event.target.value)} />
                      </label>
                      <label>
                        {l.contactBarFacebookLabel}
                        <input value={settings.contactBarFacebookLabel || ''} onChange={(event) => onSettingChange('contactBarFacebookLabel', event.target.value)} />
                      </label>
                    </div>
                  </div>
                  <div className="preview-box contact-preview-box">
                    <strong>{l.contactPreview}</strong>
                    <p>{settings.contactPhone || '-'}</p>
                    <span>{settings.contactEmail || '-'}</span>
                    <span>{settings.contactAddress || '-'}</span>
                  </div>
                </div>
              )}

              {activeTab === 'locations' && (
                <div className="admin-tab-panel">
                  <p>İl, ilçe ve mahalle listesi tek bir resmi kaynaktan senkronlanır. JSON veya CSV export URL girebilir, değişiklikleri tek tıkla güncelleyebilirsin.</p>
                  <div className="inline-grid">
                    <label>
                      Kaynak URL
                      <input
                        value={settings.locationSourceUrl || ''}
                        onChange={(event) => onSettingChange('locationSourceUrl', event.target.value)}
                        placeholder="https://..."
                      />
                    </label>
                    <label>
                      Kaynak formatı
                      <select
                        value={settings.locationSourceFormat || 'json'}
                        onChange={(event) => onSettingChange('locationSourceFormat', event.target.value)}
                      >
                        <option value="json">JSON</option>
                        <option value="csv">CSV</option>
                      </select>
                    </label>
                    <label className="admin-toggle-label">
                      <span>Otomatik senkron</span>
                      <input
                        type="checkbox"
                        checked={Boolean(settings.locationAutoSyncEnabled)}
                        onChange={(event) => onSettingChange('locationAutoSyncEnabled', event.target.checked)}
                      />
                    </label>
                  </div>
                  <div className="preview-box">
                    <strong>Son senkron durumu</strong>
                    <p>{locationCatalogMeta.syncedAt || settings.locationLastSyncAt || 'Henüz senkron yok'}</p>
                    <span>{locationCatalogMeta.status || settings.locationLastSyncStatus || 'pending'}</span>
                    <span>{locationCatalogMeta.provinceCount || 0} il, {locationCatalogMeta.districtCount || 0} ilçe, {locationCatalogMeta.neighborhoodCount || 0} mahalle</span>
                    {settings.locationLastSyncError ? <em>{settings.locationLastSyncError}</em> : null}
                  </div>
                  <div className="admin-sync-actions">
                    <button
                      type="button"
                      className="cta cta-dark"
                      onClick={async () => {
                        setSyncingLocations(true);
                        try {
                          await onSyncLocations?.();
                        } finally {
                          setSyncingLocations(false);
                        }
                      }}
                      disabled={syncingLocations}
                    >
                      {syncingLocations ? 'Senkronlanıyor...' : 'Şimdi senkronla'}
                    </button>
                    <span className="field-hint">Resmi kaynak URL değişirse burada güncelleyip tekrar senkronlayabilirsin.</span>
                  </div>
                </div>
              )}

              {activeTab === 'payment' && (
                <div className="admin-tab-panel">
                  <p>{l.paymentSettingsHint}</p>
                  <div className="inline-grid">
                    <label>
                      {l.iyzicoEnvironment}
                      <select value={settings.iyzicoEnvironment || 'sandbox'} onChange={(event) => onSettingChange('iyzicoEnvironment', event.target.value)}>
                        <option value="sandbox">{l.sandboxLabel}</option>
                        <option value="live">{l.liveLabel}</option>
                      </select>
                    </label>
                    <label>
                      {l.iyzicoMerchantId}
                      <input value={settings.iyzicoMerchantId || ''} onChange={(event) => onSettingChange('iyzicoMerchantId', event.target.value)} />
                    </label>
                    <label>
                      {l.iyzicoApiKey}
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={settings.iyzicoApiKey || ''}
                        onChange={(event) => onSettingChange('iyzicoApiKey', event.target.value)}
                      />
                    </label>
                    <label>
                      {l.iyzicoSecretKey}
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={settings.iyzicoSecretKey || ''}
                        onChange={(event) => onSettingChange('iyzicoSecretKey', event.target.value)}
                      />
                    </label>
                    <label>
                      {l.paymentCheckoutUrl}
                      <input value={settings.paymentCheckoutUrl || ''} onChange={(event) => onSettingChange('paymentCheckoutUrl', event.target.value)} />
                    </label>
                    <label>
                      {l.iyzicoInitializeEndpoint}
                      <input value={settings.iyzicoInitializeEndpoint || ''} onChange={(event) => onSettingChange('iyzicoInitializeEndpoint', event.target.value)} />
                    </label>
                    <label>
                      {l.paymentCallbackUrl}
                      <input value={settings.paymentCallbackUrl || ''} onChange={(event) => onSettingChange('paymentCallbackUrl', event.target.value)} />
                    </label>
                  </div>
                  <div className="preview-box">
                    <strong>{settings.paymentCheckoutUrl ? l.paymentReady : l.paymentNotReady}</strong>
                    <p>{settings.paymentCallbackUrl || 'Callback URL tanımlanmadı.'}</p>
                    <span>{l.callbackSslNote}</span>
                  </div>
                  <div className="admin-sync-actions">
                    <button
                      type="button"
                      className="cta cta-dark"
                      onClick={() => runIyzicoDiagnostic('connection')}
                      disabled={paymentTestState.status === 'loading'}
                    >
                      Bağlantı testi
                    </button>
                    <button
                      type="button"
                      className="cta"
                      onClick={() => runIyzicoDiagnostic('checkout')}
                      disabled={paymentTestState.status === 'loading'}
                    >
                      Checkout testi
                    </button>
                    <button
                      type="button"
                      className="cta cta-light"
                      onClick={() => runIyzicoDiagnostic('live-test')}
                      disabled={paymentTestState.status === 'loading'}
                    >
                      1 TL canlı test
                    </button>
                    {paymentTestState.message ? (
                      <span className={`field-hint ${paymentTestState.status === 'error' ? 'field-hint-error' : ''}`}>
                        {paymentTestState.message}
                      </span>
                    ) : (
                      <span className="field-hint">Testler canlı ödeme oluşturmadan yapılandırmayı kontrol eder.</span>
                    )}
                  </div>
                  <div className="preview-box">
                    <strong>{l.paymentFlowLabel}</strong>
                    <p>{l.paymentFlowCopy}</p>
                    <span>{settings.iyzicoInitializeEndpoint || ''}</span>
                  </div>
                </div>
              )}

              {activeTab === 'legal' && (
                <div className="admin-tab-panel">
                  <p>{labels?.legalCopy || 'Çerez, KVKK ve kullanım şartları bağlantıları yönetiliyor.'}</p>
                  <div className="inline-grid">
                    <label>
                      {l.companyLegalName}
                      <input value={settings.companyLegalName || ''} onChange={(event) => onSettingChange('companyLegalName', event.target.value)} />
                    </label>
                    <label>
                      {l.companyAddress}
                      <input value={settings.companyAddress || ''} onChange={(event) => onSettingChange('companyAddress', event.target.value)} />
                    </label>
                    <label>
                      {l.taxOffice}
                      <input value={settings.taxOffice || ''} onChange={(event) => onSettingChange('taxOffice', event.target.value)} />
                    </label>
                    <label>
                      {l.taxNumber}
                      <input value={settings.taxNumber || ''} onChange={(event) => onSettingChange('taxNumber', event.target.value)} />
                    </label>
                    <label>
                      {l.tradeRegistryNo}
                      <input value={settings.tradeRegistryNo || ''} onChange={(event) => onSettingChange('tradeRegistryNo', event.target.value)} />
                    </label>
                    <label>
                      {l.mersisNo}
                      <input value={settings.mersisNo || ''} onChange={(event) => onSettingChange('mersisNo', event.target.value)} />
                    </label>
                    <label>
                      {l.sslStatus}
                      <input value={settings.sslStatus || ''} onChange={(event) => onSettingChange('sslStatus', event.target.value)} />
                    </label>
                    <label>
                      {l.workingHoursLabel}
                      <input value={settings.workingHours || ''} onChange={(event) => onSettingChange('workingHours', event.target.value)} />
                    </label>
                  </div>

                  <strong style={{ display: 'block', marginTop: 24, marginBottom: 10 }}>Güven ve Ödeme Başlıkları</strong>
                  <div className="inline-grid">
                    <label>
                      {l.paymentTrustTitle}
                      <input value={settings.paymentTrustTitle || ''} onChange={(event) => onSettingChange('paymentTrustTitle', event.target.value)} />
                    </label>
                    <label>
                      {l.paymentMethodLabel}
                      <input value={settings.paymentMethodLabel || ''} onChange={(event) => onSettingChange('paymentMethodLabel', event.target.value)} />
                    </label>
                    <label>
                      {l.cardLogosLabel}
                      <input value={settings.cardLogosLabel || ''} onChange={(event) => onSettingChange('cardLogosLabel', event.target.value)} />
                    </label>
                    <label>
                      {l.paymentTrustCopy}
                      <textarea rows="3" value={settings.paymentTrustCopy || ''} onChange={(event) => onSettingChange('paymentTrustCopy', event.target.value)} />
                    </label>
                  </div>
                </div>
              )}

              {activeTab === 'seo' && (
                <div className="admin-tab-panel">
                  <p>{l.seoSettingsHint}</p>
                  <div className="inline-grid">
                    <label>
                      {l.seoTitle}
                      <input value={settings.seoTitle || ''} onChange={(event) => onSettingChange('seoTitle', event.target.value)} />
                    </label>
                    <label>
                      {l.seoFocusTopic}
                      <input value={settings.seoFocusTopic || ''} onChange={(event) => onSettingChange('seoFocusTopic', event.target.value)} />
                    </label>
                    <label>
                      {l.seoDescription}
                      <textarea rows="3" value={settings.seoDescription || ''} onChange={(event) => onSettingChange('seoDescription', event.target.value)} />
                    </label>
                    <label>
                      {l.seoKeywords}
                      <textarea rows="3" value={settings.seoKeywords || ''} onChange={(event) => onSettingChange('seoKeywords', event.target.value)} />
                    </label>
                  </div>
                  <div className="preview-box">
                    <strong>{l.livePreview}</strong>
                    <p>{settings.seoTitle || 'onlinesmmm'}</p>
                    <span>Canonical: {String(settings.websiteUrl || 'www.onlinesmmm.com').replace(/^https?:\/\//, '')}</span>
                  </div>
                  <div className="seo-check-grid">
                    {seoChecks.map((check) => (
                      <span className={`seo-check ${check.ok ? 'ok' : 'missing'}`} key={check.label}>
                        {check.ok ? '✓' : '!'} {check.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {activeTab === 'security' && (
                <div className="admin-tab-panel">
                  <p style={{ color: '#64748b', marginBottom: '24px' }}>
                    Yönetici paneli üzerinden gerçekleştirilen tüm kritik ayar güncellemeleri, giriş denemeleri ve sistem olayları IP ve kullanıcı bazlı olarak burada kayıt altına alınır.
                  </p>

                  <div className="timeline-wrapper">
                    {auditLog?.length ? (
                      auditLog.map((item) => {
                        // Dynamically resolve icon for the action
                        let icon = 'ℹ️';
                        let borderCol = 'var(--blue)';
                        const actionText = String(item.action).toLowerCase();
                        
                        if (actionText.includes('giriş') || actionText.includes('login')) {
                          icon = '🔑';
                          borderCol = 'var(--teal)';
                        } else if (actionText.includes('güncellendi') || actionText.includes('değişiklik') || actionText.includes('kaydedildi')) {
                          icon = '⚙️';
                          borderCol = '#eab308';
                        } else if (actionText.includes('engellendi') || actionText.includes('yetkisiz')) {
                          icon = '🚨';
                          borderCol = '#ef4444';
                        } else if (actionText.includes('lead') || actionText.includes('müşteri')) {
                          icon = '👤';
                          borderCol = '#8b5cf6';
                        } else if (actionText.includes('ödeme') || actionText.includes('payment')) {
                          icon = '💰';
                          borderCol = '#22c55e';
                        }

                        // Try to parse actor and IP from metadata if present
                        const actor = item.actor || 'Sistem / Web';
                        const ip = item.ip || item.meta?.ip || item.details?.ip || 'N/A';
                        const source = formatAuditSource(item);
                        const when = formatAuditWhen(item);
                        const requestId = item.requestId || item.meta?.requestId || '';
                        const payloadKeys = Array.isArray(item.meta?.changedFields) ? item.meta.changedFields.slice(0, 4) : [];
                        const severity = item.severity || 'info';
                        const severityLabel = severity === 'critical' ? 'Kritik' : severity === 'warning' ? 'Uyarı' : 'Bilgi';

                        return (
                          <div className={`timeline-item severity-${severity}`} key={item.id}>
                            <div className="timeline-icon-dot" style={{ borderColor: borderCol }}>
                              {icon}
                            </div>
                            <div className="timeline-content-card">
                              <div className="timeline-main-info">
                                <span className="timeline-action-text">
                                  {item.action}
                                  <span className={`timeline-severity-badge ${severity}`}>{severityLabel}</span>
                                </span>
                                <div className="timeline-meta-text">
                                  <span>👤 {actor}</span>
                                  {source ? <span className="timeline-source-badge">Kaynak: {source}</span> : null}
                                  {ip !== 'N/A' && <span className="timeline-ip-badge">IP: {ip}</span>}
                                </div>
                                {(payloadKeys.length || requestId) ? (
                                  <div className="timeline-detail-chips">
                                    {requestId ? <span className="timeline-detail-chip">Req: {requestId}</span> : null}
                                    {payloadKeys.map((key) => (
                                      <span className="timeline-detail-chip" key={key}>{key}</span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              <div className="timeline-date-stack">
                                <span className="timeline-date">{when}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p style={{ textAlign: 'center', padding: '32px', color: '#64748b' }}>{l.noAudit}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  </section>
  );
}

export default AdminPanel;
