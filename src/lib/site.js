const localeFormatMap = {
  tr: 'tr-TR',
  en: 'en-US',
  de: 'de-DE',
  it: 'it-IT',
  es: 'es-ES',
  fr: 'fr-FR',
  az: 'az-Latn-AZ',
  ky: 'ky-KG',
  tk: 'tk-TM',
  ru: 'ru-RU',
  ar: 'ar-EG',
};

const priceDisplayMap = {
  tr: { locale: 'tr-TR', currency: 'TRY', rate: 1, roundTo: 1 },
  en: { locale: 'en-US', currency: 'USD', rate: 0.043, roundTo: 5 },
  de: { locale: 'de-DE', currency: 'EUR', rate: 0.04, roundTo: 5 },
  it: { locale: 'it-IT', currency: 'EUR', rate: 0.04, roundTo: 5 },
  es: { locale: 'es-ES', currency: 'EUR', rate: 0.04, roundTo: 5 },
  fr: { locale: 'fr-FR', currency: 'EUR', rate: 0.04, roundTo: 5 },
  az: { locale: 'az-Latn-AZ', currency: 'USD', rate: 0.043, roundTo: 5 },
  ky: { locale: 'ky-KG', currency: 'USD', rate: 0.043, roundTo: 5 },
  tk: { locale: 'tk-TM', currency: 'USD', rate: 0.043, roundTo: 5 },
  ru: { locale: 'ru-RU', currency: 'USD', rate: 0.043, roundTo: 5 },
  ar: { locale: 'ar-EG', currency: 'USD', rate: 0.043, roundTo: 5 },
};

const localizedPriceLabels = {
  tr: { free: 'Ücretsiz', quote: 'Teklif üzerine' },
  en: { free: 'Free', quote: 'On request' },
  de: { free: 'Kostenlos', quote: 'Auf Anfrage' },
  it: { free: 'Gratis', quote: 'Su richiesta' },
  es: { free: 'Gratis', quote: 'Bajo presupuesto' },
  fr: { free: 'Gratuit', quote: 'Sur devis' },
  az: { free: 'Pulsuz', quote: 'Təklif əsasında' },
  ky: { free: 'Акысыз', quote: 'Сунуш боюнча' },
  tk: { free: 'Mugt', quote: 'Teklip boýunça' },
  ru: { free: 'Бесплатно', quote: 'По запросу' },
  ar: { free: 'مجاني', quote: 'حسب العرض' },
};

export function getLocalizedPriceLabels(locale = 'tr') {
  return localizedPriceLabels[locale] || localizedPriceLabels.tr;
}

export function formatPrice(value, locale) {
  const config = priceDisplayMap[locale] || priceDisplayMap.tr;
  const rawValue = Math.max(0, Number(value) || 0) * config.rate;
  const roundedValue = Math.ceil(rawValue / config.roundTo) * config.roundTo;
  const nf = new Intl.NumberFormat(config.locale || localeFormatMap[locale] || 'tr-TR', {
    style: 'currency',
    currency: config.currency,
    maximumFractionDigits: 0,
  });
  return nf.format(roundedValue);
}

export function getCanonicalUrl(pathname, domain = 'www.onlinesmmm.com') {
  const normalizedPath = pathname === '/' ? '/' : pathname;
  return `https://${domain}${normalizedPath}`;
}

export function resolveSeoContent({
  content = {},
  settings = {},
  page = null,
  brandName = 'OnlineSMMM',
  locale = 'tr',
} = {}) {
  const seo = content.seo || {};
  const heroTitle = [content.hero?.top, content.hero?.accent, content.hero?.bottom].filter(Boolean).join(' ');
  const localizedTitle = seo.title || (heroTitle ? `${heroTitle} | ${brandName}` : brandName);
  const localizedDescription = seo.description || content.hero?.copy || '';
  const localizedKeywords = seo.keywords || [
    content.hero?.top,
    content.hero?.accent,
    ...(content.services || []).map((service) => service.title),
  ].filter(Boolean).join(', ');

  const title = page?.title
    ? `${page.title} | ${brandName}`
    : locale === 'tr' && settings.seoTitle
      ? settings.seoTitle
      : localizedTitle;

  const description = page?.description
    ? page.description
    : locale === 'tr' && settings.seoDescription
      ? settings.seoDescription
      : localizedDescription;

  const keywords = locale === 'tr' && settings.seoKeywords
    ? settings.seoKeywords
    : localizedKeywords;

  return {
    brandName: seo.brandName || brandName,
    title,
    description,
    keywords,
    focusTopic: locale === 'tr' && settings.seoFocusTopic ? settings.seoFocusTopic : seo.focusTopic,
    serviceName: seo.serviceName || seo.focusTopic || content.ui?.servicesSection || brandName,
    serviceDescription: seo.serviceDescription || description,
  };
}

export function computeDiscountedPrice(basePrice, discountPercent) {
  return Math.round(basePrice * (1 - discountPercent / 100));
}

export function buildTelHref(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  if (!digits) {
    return 'tel:';
  }
  return digits.startsWith('+') ? `tel:${digits}` : `tel:+${digits}`;
}

export function buildMailHref(value) {
  const email = String(value || '').trim();
  return email ? `mailto:${email}` : '';
}

export function ensureExternalUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function renderFallbackPrice(value, locale, fallbackLabel) {
  const labels = getLocalizedPriceLabels(locale);
  if (value === 0) {
    return fallbackLabel && fallbackLabel !== 'Ücretsiz' ? fallbackLabel : labels.free;
  }
  if (value == null) {
    return fallbackLabel && fallbackLabel !== 'Teklif üzerine' && fallbackLabel !== 'Ücretsiz' ? fallbackLabel : labels.quote;
  }
  return formatPrice(value, locale);
}

export function resolveIyzicoEndpoint(environment) {
  const baseUrl = environment === 'sandbox' ? 'https://sandbox-api.iyzipay.com' : 'https://api.iyzipay.com';
  return `${baseUrl}/payment/iyzipos/checkoutform/initialize/auth/ecom`;
}

export function isValidTurkishIdentityNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^[1-9]\d{10}$/.test(digits)) return false;

  const numbers = digits.split('').map(Number);
  const oddSum = numbers[0] + numbers[2] + numbers[4] + numbers[6] + numbers[8];
  const evenSum = numbers[1] + numbers[3] + numbers[5] + numbers[7];
  const tenthDigit = ((oddSum * 7) - evenSum) % 10;
  const totalFirstTen = numbers.slice(0, 10).reduce((sum, number) => sum + number, 0) % 10;

  return numbers[9] === tenthDigit && numbers[10] === totalFirstTen;
}

export function validateLeadForm(leadForm, locale = 'tr', options = {}) {
  const messages = {
    tr: {
      name: 'Ad soyad alanı gerekli.',
      phone: 'Telefon numarası zorunlu.',
      email: 'Geçerli bir e-posta adresi girin.',
      companyName: 'Şirket veya marka adını girin.',
      address: 'Tescil için şirket adres bilgisi gerekir.',
      tcId: 'Geçerli bir T.C. Kimlik Numarası girin.',
      province: 'İl seçiniz.',
      district: 'İlçe seçiniz.',
      neighborhood: 'Mahalle seçiniz.',
      addressDetail: 'Adres detayı girin.',
    },
    en: {
      name: 'Full name is required.',
      phone: 'Enter a valid phone number.',
      email: 'Enter a valid email address.',
      companyName: 'Enter the company or brand name.',
      address: 'Enter the address.',
      tcId: 'Enter a valid Turkish ID number.',
      province: 'Select a province.',
      district: 'Select a district.',
      neighborhood: 'Select a neighborhood.',
      addressDetail: 'Enter address details.',
    },
  };

  const copy = messages[locale] || messages.tr;
  const errors = {};

  if (!String(leadForm.name || '').trim()) {
    errors.name = copy.name;
  }
  if (!/^[0-9+()\s-]{10,}$/.test(String(leadForm.phone || '').trim())) {
    errors.phone = copy.phone;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(leadForm.email || '').trim())) {
    errors.email = copy.email;
  }
  if (!String(leadForm.companyName || '').trim()) {
    errors.companyName = copy.companyName;
  }
  if (options.requireAddress && String(leadForm.address || '').trim().length === 0) {
    errors.address = copy.address;
  }
  if (options.requireTcId && !isValidTurkishIdentityNumber(leadForm.tcId)) {
    errors.tcId = copy.tcId;
  }
  if (options.requireAddressDetails) {
    if (!String(leadForm.province || '').trim()) {
      errors.province = copy.province;
    }
    if (!String(leadForm.district || '').trim()) {
      errors.district = copy.district;
    }
    if (!String(leadForm.neighborhood || '').trim()) {
      errors.neighborhood = copy.neighborhood;
    }
    if (!String(leadForm.addressDetail || '').trim()) {
      errors.addressDetail = copy.addressDetail;
    }
  }

  return errors;
}

export function composeLeadMessage({
  locale = 'tr',
  selectedWizard,
  leadForm,
  activitySummary,
  wizardEstimate,
  sourceLabel,
}) {
  const intro =
    locale === 'en'
      ? 'Hello, I want to start an application from the onboarding wizard.'
      : 'Merhaba, başlangıç sihirbazından başvuru oluşturmak istiyorum.';

  const lines = [
    intro,
    `Şirket türü / Company type: ${selectedWizard.label}`,
    `Ana faaliyet / Main activity: ${activitySummary?.mainActivity || '-'}`,
    `Alt faaliyet / Sub activity: ${activitySummary?.subActivity || '-'}`,
    `Gelir yöntemi / Revenue method: ${activitySummary?.revenueMethod || '-'}`,
    `Satış kanalı / Sales channel: ${activitySummary?.salesChannel || '-'}`,
    `Ad Soyad / Full name: ${leadForm.name || '-'}`,
    `Telefon / Phone: ${leadForm.phone || '-'}`,
    `E-posta / Email: ${leadForm.email || '-'}`,
    `Şirket adı / Company name: ${leadForm.companyName || '-'}`,
    `Adres / Address: ${leadForm.address || '-'}`,
    `Evrak / Documents: ${selectedWizard.docs.join(', ')}`,
    `Başlangıç fiyatı / Starting price: ${wizardEstimate}`,
    `Kaynak / Source: ${sourceLabel || 'website-wizard'}`,
  ];

  return lines.join('\n');
}

export function createSettingsEnvelope(defaultSettings) {
  return {
    published: { ...defaultSettings },
    draft: { ...defaultSettings },
    auditLog: [],
    leads: [],
    lastDraftSavedAt: null,
    lastPublishedAt: null,
  };
}

export function applySettingsEnvelope(rawEnvelope, defaultSettings) {
  const base = createSettingsEnvelope(defaultSettings);
  if (!rawEnvelope || typeof rawEnvelope !== 'object') {
    return base;
  }
  return {
    ...base,
    ...rawEnvelope,
    published: { ...defaultSettings, ...(rawEnvelope.published || rawEnvelope.settings || {}) },
    draft: { ...defaultSettings, ...(rawEnvelope.draft || rawEnvelope.published || rawEnvelope.settings || {}) },
    auditLog: Array.isArray(rawEnvelope.auditLog) ? rawEnvelope.auditLog : [],
    leads: Array.isArray(rawEnvelope.leads) ? rawEnvelope.leads : [],
  };
}

export function recordAuditEntry(entries, entry) {
  return [entry, ...entries].slice(0, 40);
}

export function trackEvent(name, properties = {}) {
  try {
    const existing = JSON.parse(window.localStorage.getItem('onlinesmmm-event-log-v1') || '[]');
    const next = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        properties,
        at: new Date().toISOString(),
      },
      ...existing,
    ].slice(0, 200);
    window.localStorage.setItem('onlinesmmm-event-log-v1', JSON.stringify(next));
    return next[0];
  } catch {
    return null;
  }
}

export function getExperimentBucket(key = 'hero-copy') {
  try {
    const storageKey = `onlinesmmm-exp-${key}`;
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;
    const bucket = Math.random() > 0.5 ? 'variant-a' : 'variant-b';
    window.localStorage.setItem(storageKey, bucket);
    return bucket;
  } catch {
    return 'variant-a';
  }
}
