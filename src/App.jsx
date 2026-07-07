import React from 'react';
import { createPortal } from 'react-dom';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import CampaignPopup from './components/CampaignPopup';
import ContactBar from './components/ContactBar';
import CustomerVisitTracker from './components/CustomerVisitTracker';
import BrandIdentity from './components/BrandIdentity';
import Footer from './components/Footer';
import LanguageSwitcher from './components/LanguageSwitcher';
import ApplicationPaymentPanel from './components/ApplicationPaymentPanel';
import PaymentResultPage from './components/PaymentResultPage';
import TurnstileWidget from './components/TurnstileWidget';
import TopBar from './components/TopBar';
import { blogArticles } from './data/blog';
import { appEnv } from './config/env';
import {
  defaultSettings,
  languageOptions,
  locales,
} from './content';
import {
  applySettingsEnvelope,
  buildTelHref,
  composeLeadMessage,
  computeDiscountedPrice,
  ensureExternalUrl,
  formatPrice,
  getCanonicalUrl,
  getLocalizedPriceLabels,
  recordAuditEntry,
  renderFallbackPrice,
  resolveSeoContent,
  resolveIyzicoEndpoint,
  validateLeadForm,
} from './lib/site';
import { apiFetch, getApiBase } from './lib/api';
import { legalPages as importedLegalPages } from './lib/legalPages';

const AdminPanel = lazy(() => import('./components/AdminPanel'));
const ApplicationFlowPage = lazy(() => import('./components/ApplicationFlowPage'));
const OperationsPortal = lazy(() => import('./components/OperationsPortal'));
const BlogListingPage = lazy(() => import('./components/BlogListingPage'));
const BlogArticlePage = lazy(() => import('./components/BlogArticlePage'));
const CompanyLandingPage = lazy(() => import('./components/CompanyLandingPage'));
const TestimonialsCarousel = lazy(() => import('./components/TestimonialsCarousel'));
const ParticleCanvas = lazy(() => import('./components/ParticleCanvas'));

const storageKey = 'onlinesmmm-settings-v2';
const languageKey = 'onlinesmmm-language-v2';
const cookieKey = 'onlinesmmm-cookie-consent-v2';
const leadSourceKey = 'onlinesmmm-last-source-v1';
const appBasePath = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
const cookiePreferenceDefaults = {
  necessary: true,
  analytics: false,
  marketing: false,
};

function createAuditEntry(action, meta = {}, actor = 'admin') {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor,
    action,
    source: String(meta.source || meta.channel || meta.route || meta.stage || 'admin-panel').slice(0, 80),
    severity: 'info',
    meta,
    createdAt: new Date().toLocaleString('tr-TR'),
  };
}

function RouteLoading() {
  return (
    <div className="skeleton-grid-loader" role="status" aria-live="polite">
      <div className="skeleton-card shimmer">
        <div className="skeleton-line title" />
        <div className="skeleton-line text" />
        <div className="skeleton-line text short" />
      </div>
      <div className="skeleton-card shimmer">
        <div className="skeleton-line title" />
        <div className="skeleton-line text" />
        <div className="skeleton-line text short" />
      </div>
      <div className="skeleton-card shimmer">
        <div className="skeleton-line title" />
        <div className="skeleton-line text" />
        <div className="skeleton-line text short" />
      </div>
    </div>
  );
}
const legalPages = {
  ...importedLegalPages,
  '/rehber/sahis-sirketi-kurma': {
    title: 'Şahıs Şirketi Kurma Rehberi',
    description: 'Şahıs şirketi kuruluşu için gerekli belgeler, adımlar ve dikkat edilmesi gerekenler.',
    sections: [
      {
        title: 'Kimler için uygun',
        text: 'Freelancer, danışman, tek kişilik hizmet veren ve hızlı kurulum isteyen girişimciler için uygundur.',
      },
      {
        title: 'Gerekli belgeler',
        text: 'Kimlik, adres bilgisi, faaliyet alanı ve temel iletişim bilgileri ile süreç başlatılır.',
      },
      {
        title: 'Süreç akışı',
        text: 'Başvuru, resmi kayıt, e-belge ve muhasebe kurulumları adım adım tamamlanır.',
      },
    ],
  },
  '/rehber/limited-sirketi-kurma': {
    title: 'Limited Şirketi Kurma Rehberi',
    description: 'Limited şirket kuruluşunda sermaye, ortaklık ve resmi işlemler için pratik rehber.',
    sections: [
      {
        title: 'Ne zaman tercih edilir',
        text: 'Ekipli büyüme, e-ticaret, marka odaklı yapı ve daha kurumsal görünüm gerektiğinde tercih edilir.',
      },
      {
        title: 'Belge ve süreç',
        text: 'Kurucular, adres, sermaye planı, imza ve resmi kayıt adımları birlikte yönetilir.',
      },
      {
        title: 'Kuruluş sonrası',
        text: 'Mali müşavir, e-fatura ve operasyon akışları ilk günden yapılandırılır.',
      },
    ],
  },
  '/rehber/online-sirket-kurulusu': {
    title: 'Online Şirket Kuruluşu Rehberi',
    description: 'Online şirket kuruluşunun dijital akışı, belge yükleme ve takip sistemi.',
    sections: [
      {
        title: 'Dijital akış',
        text: 'Başvuru, belge toplama, yönlendirme ve operasyon takibi tek panelde ilerler.',
      },
      {
        title: 'Hız avantajı',
        text: 'Online süreçlerde doğru evraklarla aynı gün içinde ilerleme sağlanabilir.',
      },
      {
        title: 'Takip ve destek',
        text: 'Müşteri, personel ve süper admin aynı kayıt üzerinden durum takibi yapar.',
      },
    ],
  },
};

function getLocaleText(locale) {
  return locales[locale] || locales.tr;
}

function normalizeCoreUrls(settings = {}) {
  const rest = { ...(settings || {}) };
  delete rest.turnstileSecretKey;
  return normalizeCampaignSettings({
    ...rest,
    websiteUrl: appEnv.websiteUrl,
    websiteTrUrl: appEnv.websiteTrUrl,
    paymentCallbackUrl: `${appEnv.websiteUrl.replace(/\/+$/, '')}/odeme/callback`,
  });
}

function normalizeCampaignSettings(settings = {}) {
  const fallbackCampaign = {
    id: 'legacy-launch',
    title: settings.campaignPopupTitle || settings.campaignBarTitle || 'Şirket Açılışına Özel!',
    badge: settings.campaignPopupBadge || '%20 İndirim Fırsatı',
    subtitle: settings.campaignPopupSubtitle || settings.campaignBarSubtitle || 'Başlangıç paketlerinde özel kampanya',
    description:
      settings.campaignPopupDescription ||
      settings.campaignScopeNote ||
      'Şirketini 3 adımda kur, başvurunu hızla tamamla ve süreçleri tek panelden takip et.',
    ctaLabel: settings.campaignPopupCtaLabel || 'Hemen Başvur',
    ctaHref: settings.campaignPopupCtaHref || '/basvuru',
    imageUrl: settings.campaignPopupImageUrl || '/campaigns/opening-promo.jpg',
    endDate: settings.campaignPopupEndDate || settings.campaignBarEndDate || '2026-07-31T23:59:59',
    delaySeconds: Number(settings.campaignPopupDelaySeconds ?? 10),
    isActive: Boolean(settings.campaignBarEnabled ?? settings.campaignPopupEnabled ?? true),
    archivedAt: '',
  };

  const rawArchive = Array.isArray(settings.campaignPopupArchive) ? settings.campaignPopupArchive : [];
  const archive = rawArchive.length
    ? rawArchive.map((item, index) => ({
        id: String(item.id || `campaign-${index + 1}`),
        title: String(item.title || fallbackCampaign.title),
        badge: String(item.badge || fallbackCampaign.badge),
        subtitle: String(item.subtitle || fallbackCampaign.subtitle),
        description: String(item.description || fallbackCampaign.description),
        ctaLabel: String(item.ctaLabel || fallbackCampaign.ctaLabel),
        ctaHref: String(item.ctaHref || fallbackCampaign.ctaHref),
        imageUrl: String(item.imageUrl || fallbackCampaign.imageUrl),
        endDate: String(item.endDate || fallbackCampaign.endDate),
        delaySeconds: Number(item.delaySeconds ?? fallbackCampaign.delaySeconds) || 10,
        isActive: item.isActive !== false,
        archivedAt: String(item.archivedAt || ''),
      }))
    : [fallbackCampaign];

  const activeId =
    settings.campaignPopupActiveId ||
    archive.find((item) => item.isActive && !item.archivedAt)?.id ||
    archive[0]?.id ||
    fallbackCampaign.id;

  return {
    ...settings,
    campaignPopupEnabled: Boolean(settings.campaignPopupEnabled ?? settings.campaignBarEnabled ?? true),
    campaignPopupDelaySeconds: Number(settings.campaignPopupDelaySeconds ?? 10),
    campaignPopupActiveId: activeId,
    campaignPopupArchive: archive,
  };
}

function getCurrentPath() {
  if (typeof window === 'undefined') {
    return '/';
  }
  return getAppPathname().replace(/\/+$/, '') || '/';
}

function getAppPathname() {
  if (typeof window === 'undefined') {
    return '/';
  }
  const pathname = window.location.pathname || '/';
  if (appBasePath && appBasePath !== '/' && (pathname === appBasePath || pathname.startsWith(`${appBasePath}/`))) {
    return pathname.slice(appBasePath.length) || '/';
  }
  return pathname;
}

function withAppBasePath(pathname) {
  if (!appBasePath || appBasePath === '/') {
    return pathname;
  }
  if (pathname === '/') {
    return `${appBasePath}/`;
  }
  return pathname.startsWith('/') ? `${appBasePath}${pathname}` : `${appBasePath}/${pathname}`;
}

function normalizeTurkishPhoneInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (!digits) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length <= 8) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}`;
}

function normalizeEmailTyping(value) {
  return String(value || '').replace(/\s+/g, '');
}

function createStableStorageId(storage, key, prefix) {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const next = typeof crypto !== 'undefined' && crypto.randomUUID
      ? `${prefix}-${crypto.randomUUID()}`
      : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    storage.setItem(key, next);
    return next;
  } catch {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? `${prefix}-${crypto.randomUUID()}`
      : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function applyAddressDependencyPatch(key) {
  if (key === 'province') {
    return {
      form: { district: '', neighborhood: '' },
      errors: { district: '', neighborhood: '', address: '' },
    };
  }
  if (key === 'district') {
    return {
      form: { neighborhood: '' },
      errors: { neighborhood: '', address: '' },
    };
  }
  return { form: {}, errors: {} };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getRouteState() {
  if (typeof window === 'undefined') {
    return { locale: 'tr', path: '/' };
  }

  const pathname = getAppPathname().replace(/\/+$/, '') || '/';
  const parts = pathname.split('/').filter(Boolean);
  const maybeLocale = parts[0];

  if (maybeLocale && locales[maybeLocale] && maybeLocale !== 'tr') {
    const nextPath = `/${parts.slice(1).join('/')}`.replace(/\/+$/, '') || '/';
    return { locale: maybeLocale, path: nextPath };
  }

  if (maybeLocale === 'tr') {
    const nextPath = `/${parts.slice(1).join('/')}`.replace(/\/+$/, '') || '/';
    return { locale: 'tr', path: nextPath };
  }

  return { locale: 'tr', path: pathname };
}

function mergeLocalizedCommercialData(localizedItems, editableItems, priceKey) {
  const editableById = new Map((editableItems || []).map((item) => [item.id, item]));
  return localizedItems.map((item) => {
    const editable = editableById.get(item.id) || {};
    return {
      ...item,
      [priceKey]: editable[priceKey] ?? item[priceKey],
      featured: editable.featured ?? item.featured,
    };
  });
}

function splitHeroAccent(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d+)\s*(.*)$/);
  return {
    number: match?.[1] || '',
    label: match?.[2] || text,
  };
}

const internationalTestimonials = [
  { quote: 'The sole proprietorship setup was clear, fast and focused on the documents I actually needed.', name: 'Elena M.', role: 'E-commerce founder', country: 'Spain', photo: 'https://randomuser.me/api/portraits/women/65.jpg' },
  { quote: 'For our limited company, the registry and MERSIS steps were explained without legal jargon.', name: 'Jonas K.', role: 'SaaS co-founder', country: 'Germany', photo: 'https://randomuser.me/api/portraits/men/32.jpg' },
  { quote: 'The e-invoice transition was handled with a practical checklist instead of long generic emails.', name: 'Nora H.', role: 'Design studio owner', country: 'Sweden', photo: 'https://randomuser.me/api/portraits/women/12.jpg' },
  { quote: 'We saw the service fee, official fees and timeline before making a decision.', name: 'Lucas M.', role: 'Software consultant', country: 'Netherlands', photo: 'https://randomuser.me/api/portraits/men/75.jpg' },
  { quote: 'The team checked our foreign-shareholder documents before the registry appointment, which saved time.', name: 'Sofia R.', role: 'Marketplace seller', country: 'Spain', photo: 'https://randomuser.me/api/portraits/women/53.jpg' },
  { quote: 'Accounting onboarding started right after formation, so the first invoice was not a guessing game.', name: 'Daniel W.', role: 'Export advisor', country: 'United Kingdom', photo: 'https://randomuser.me/api/portraits/men/41.jpg' },
  { quote: 'The company type comparison was honest: cost, responsibility and monthly workload were shown together.', name: 'Emily C.', role: 'Operations lead', country: 'United Kingdom', photo: 'https://randomuser.me/api/portraits/women/33.jpg' },
  { quote: 'For a Turkey setup from abroad, having one WhatsApp thread and one document list made the process simple.', name: 'Pierre L.', role: 'Trade consultant', country: 'France', photo: 'https://randomuser.me/api/portraits/men/61.jpg' },
  { quote: 'Trademark filing started with a pre-check, not a rushed application. That made the scope much clearer.', name: 'Andrea P.', role: 'Fashion brand founder', country: 'Italy', photo: 'https://randomuser.me/api/portraits/women/29.jpg' },
  { quote: 'The monthly bookkeeping handover was organized; old records and new declarations were separated cleanly.', name: 'Laura N.', role: 'Consulting partner', country: 'Switzerland', photo: 'https://randomuser.me/api/portraits/women/9.jpg' },
  { quote: 'They did not push the most expensive structure. We chose the setup that matched the first year plan.', name: 'Markus S.', role: 'Mobile app founder', country: 'Estonia', photo: 'https://randomuser.me/api/portraits/men/54.jpg' },
  { quote: 'Document upload and missing-file feedback were quick, specific and easy to act on.', name: 'Maya L.', role: 'Import consultant', country: 'France', photo: 'https://randomuser.me/api/portraits/women/71.jpg' },
  { quote: 'The bank account, e-archive and accounting sequence was mapped before we started invoicing.', name: 'Oliver J.', role: 'Game studio founder', country: 'Denmark', photo: 'https://randomuser.me/api/portraits/men/64.jpg' },
  { quote: 'I needed a low-friction freelancer setup. The sole proprietorship route was explained in plain language.', name: 'Mateo G.', role: 'Creative consultant', country: 'Portugal', photo: 'https://randomuser.me/api/portraits/men/91.jpg' },
  { quote: 'For UAE planning, they separated setup costs, annual obligations and tax questions from day one.', name: 'Clara V.', role: 'Digital product founder', country: 'Belgium', photo: 'https://randomuser.me/api/portraits/women/76.jpg' },
  { quote: 'The team kept official registry steps visible, so we knew what was pending and what was already done.', name: 'Noah B.', role: 'Product manager', country: 'United States', photo: 'https://randomuser.me/api/portraits/men/83.jpg' },
  { quote: 'Payroll and social security tasks were placed on a simple calendar for our Turkey team.', name: 'Hannah K.', role: 'Operations manager', country: 'Germany', photo: 'https://randomuser.me/api/portraits/women/50.jpg' },
  { quote: 'The quote was not bloated with vague cards. Each line had a purpose and a clear owner.', name: 'Irina P.', role: 'Marketplace manager', country: 'Poland', photo: 'https://randomuser.me/api/portraits/women/21.jpg' },
  { quote: 'For a joint stock company, board documents and articles were reviewed in the right order.', name: 'Caner S.', role: 'Fintech founder', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/men/63.jpg' },
  { quote: 'They explained when a global company made sense and when a Turkey setup was enough.', name: 'Yusuf N.', role: 'E-commerce seller', country: 'Canada', photo: 'https://randomuser.me/api/portraits/men/28.jpg' },
  { quote: 'The first-month accounting support prevented mistakes before our first invoice was issued.', name: 'Zeynep G.', role: 'Boutique brand owner', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/women/36.jpg' },
  { quote: 'The incentive check was realistic. They did not overpromise grants that did not fit our profile.', name: 'Ahmet R.', role: 'Manufacturing founder', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/men/18.jpg' },
  { quote: 'Every document request came with a reason and a deadline, which kept our team aligned.', name: 'Selin M.', role: 'Agency founder', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/women/47.jpg' },
  { quote: 'The Estonia option was assessed together with maintenance costs, not just the initial setup fee.', name: 'Ece P.', role: 'Retail operator', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/women/58.jpg' },
  { quote: 'The address, signature and registry path was straightforward even though we were working remotely.', name: 'Burak E.', role: 'Marketing consultant', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/men/36.jpg' },
  { quote: 'We switched to e-documents after setup without needing a separate onboarding project.', name: 'Aylin D.', role: 'Agency owner', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/women/68.jpg' },
  { quote: 'The team kept the scope tight: sector, company type, expected result and timeline were always visible.', name: 'Mert A.', role: 'SaaS founder', country: 'Germany', photo: 'https://randomuser.me/api/portraits/men/49.jpg' },
  { quote: 'We handled a Turkey company from abroad with a clean checklist and no repeated document requests.', name: 'Leyla A.', role: 'Online education founder', country: 'Azerbaijan', photo: 'https://randomuser.me/api/portraits/women/44.jpg' },
  { quote: 'The legal and accounting language stayed practical, which helped our non-finance team follow the process.', name: 'Ozan B.', role: 'Business consultant', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/men/22.jpg' },
  { quote: 'They separated official authority work from advisory work, so the responsibility lines were clear.', name: 'Deniz U.', role: 'Logistics founder', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/men/57.jpg' },
  { quote: 'The US company discussion included Turkey-side tax impact before any setup decision was made.', name: 'Umut K.', role: 'Content creator', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/men/71.jpg' },
  { quote: 'I liked that the process did not rely on generic anonymous reviews; the outcomes were concrete.', name: 'İpek C.', role: 'Online store owner', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/women/25.jpg' },
  { quote: 'The service felt modern because the boring operational details were handled before they became problems.', name: 'Elif K.', role: 'DTC founder', country: 'Turkey', photo: 'https://randomuser.me/api/portraits/women/24.jpg' },
];

function buildLocalizedPath(pathname, locale) {
  const strippedPath = pathname === '/' ? '' : pathname.replace(/\/+$/, '');
  const normalizedPath = strippedPath.startsWith('#') ? `/${strippedPath}` : strippedPath;
  if (!locale || locale === 'tr') {
    return withAppBasePath(normalizedPath || '/');
  }
  return withAppBasePath(normalizedPath ? `/${locale}${normalizedPath}` : `/${locale}`);
}

function normalizeLookup(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, ' ')
    .trim();
}

function findOptionByName(options, value) {
  const query = normalizeLookup(value);
  return options.find((item) => normalizeLookup(item.name) === query);
}

function composeAddressLine(leadForm) {
  return [leadForm.neighborhood, leadForm.district, leadForm.province, leadForm.addressDetail]
    .filter(Boolean)
    .join(' / ');
}

function getLeadStepValidationOptions(step) {
  if (step === 5) {
    return { requireTcId: true };
  }
  if (step >= 6) {
    return { requireTcId: true, requireAddressDetails: true };
  }
  return {};
}

function reportLeadSubmitVisit(leadForm, locale, source) {
  try {
    const sessionId = window.sessionStorage.getItem('onlinesmmm-visit-session');
    const visitorId = window.localStorage.getItem('onlinesmmm-visitor-id');
    if (!sessionId || !visitorId) return;
    fetch(`${getApiBase()}/api/public/visit-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        visitorId,
        eventType: 'lead_submit',
        path: `${window.location.pathname}${window.location.hash || ''}`,
        locale,
        source,
        deviceType: window.innerWidth <= 640 ? 'mobile' : window.innerWidth <= 1024 ? 'tablet' : 'desktop',
        viewport: { width: window.innerWidth || 0, height: window.innerHeight || 0 },
        screen: { width: window.screen?.width || 0, height: window.screen?.height || 0 },
        lead: {
          name: leadForm.name,
          phone: leadForm.phone,
          email: leadForm.email,
          companyName: leadForm.companyName,
        },
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Tracking must never block the lead flow.
  }
}

function App() {
  const initialRoute = getRouteState();
  const [currentPath, setCurrentPath] = useState(() => initialRoute.path);
  const [locale, setLocale] = useState(initialRoute.locale);
  const [settings, setSettings] = useState(() => normalizeCoreUrls(defaultSettings));
  const [draftSettings, setDraftSettings] = useState(() => normalizeCoreUrls(defaultSettings));
  const [locationCatalog, setLocationCatalog] = useState({ source: {}, provinces: [] });
  const [locationCatalogMeta, setLocationCatalogMeta] = useState({});
  const [locationCatalogError, setLocationCatalogError] = useState('');
  const [auditLog, setAuditLog] = useState([]);
  const [capturedLeads, setCapturedLeads] = useState([]);
  const [customerVisits, setCustomerVisits] = useState([]);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState(null);
  const [lastPublishedAt, setLastPublishedAt] = useState(null);
  const [activeFaq, setActiveFaq] = useState(0);
  const [selectedCompanyType, setSelectedCompanyType] = useState('sole');
  const [activityForm, setActivityForm] = useState({
    mainActivity: 'service',
    subActivity: 'consulting',
    revenueMethod: 'invoice',
    salesChannel: 'direct',
  });
  const [leadForm, setLeadForm] = useState({
    name: '',
    phone: '',
    email: '',
    companyName: '',
    tcId: '',
    province: '',
    district: '',
    neighborhood: '',
    addressDetail: '',
  });
  const [leadErrors, setLeadErrors] = useState({});
  const [leadSubmitState, setLeadSubmitState] = useState('idle');
  const [paymentState, setPaymentState] = useState({ status: 'idle', error: '', message: '' });
  const [leadToast, setLeadToast] = useState({ visible: false, message: '', variant: 'success' });
  const [wizardTurnstileToken, setWizardTurnstileToken] = useState('');
  const [wizardTurnstileResetVersion, setWizardTurnstileResetVersion] = useState(0);
  const [wizardLeadCustomerId, setWizardLeadCustomerId] = useState('');
  const [applicationTurnstileToken, setApplicationTurnstileToken] = useState('');
  const [applicationTurnstileResetVersion, setApplicationTurnstileResetVersion] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadErrors, setUploadErrors] = useState([]);
  const [wizardStage, setWizardStage] = useState(1);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [isCompactWizard, setIsCompactWizard] = useState(false);
  const wizardActivityRef = useRef(null);
  const wizardUploadRef = useRef(null);
  const wizardFormRef = useRef(null);
  const wizardNextStepsRef = useRef(null);
  const wizardLeadCustomerIdRef = useRef('');
  const cookieDismissTimerRef = useRef(null);
  const leadToastTimerRef = useRef(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [cookieConsent, setCookieConsent] = useState({
    status: 'unknown',
    preferences: { ...cookiePreferenceDefaults },
  });
  const [cookiePreferencesOpen, setCookiePreferencesOpen] = useState(false);
  const [applicationId] = useState(() => createStableStorageId(window.sessionStorage, 'onlinesmmm-application-id', 'application'));
  const turnstileSiteKey = settings?.turnstileSiteKey || import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

  // Interactive Tax Calculator States
  const [calcMonthlyIncome, setCalcMonthlyIncome] = useState(60000);
  const [calcMonthlyExpense, setCalcMonthlyExpense] = useState(15000);
  const taxSavingsResults = useMemo(() => {
    const monthlyIncome = Math.max(0, Number(calcMonthlyIncome) || 0);
    const monthlyExpense = Math.max(0, Number(calcMonthlyExpense) || 0);
    const monthlyNetProfit = Math.max(0, monthlyIncome - monthlyExpense);
    const yearlyNetProfit = monthlyNetProfit * 12;
    const brackets = [
      { limit: 110000, rate: 0.15 },
      { limit: 230000, rate: 0.20 },
      { limit: 870000, rate: 0.27 },
      { limit: 3000000, rate: 0.35 },
      { limit: Infinity, rate: 0.40 },
    ];
    let remaining = yearlyNetProfit;
    let previousLimit = 0;
    let soleTax = 0;

    for (const bracket of brackets) {
      if (remaining <= 0) break;
      const taxableSlice = Math.min(remaining, bracket.limit - previousLimit);
      soleTax += taxableSlice * bracket.rate;
      remaining -= taxableSlice;
      previousLimit = bracket.limit;
    }

    const limitedTax = yearlyNetProfit * 0.25;
    const yearlySavings = Math.max(0, soleTax - limitedTax);

    return {
      monthlyNetProfit: Math.round(monthlyNetProfit),
      yearlyNetProfit: Math.round(yearlyNetProfit),
      soleTax: Math.round(soleTax),
      limitedTax: Math.round(limitedTax),
      yearlySavings: Math.round(yearlySavings),
      recommended: yearlySavings > 0 ? 'limited' : 'sole',
    };
  }, [calcMonthlyExpense, calcMonthlyIncome]);

  // Interactive Quiz States
  const [quizActive, setQuizActive] = useState(false);
  const [quizStep, setQuizStep] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState({
    partners: '', // 'single' or 'multiple'
    revenue: '',  // 'low', 'medium', 'high'
    ecommerce: '', // 'yes' or 'no'
  });
  const [quizResult, setQuizResult] = useState(null); // 'sole', 'limited', 'inc'
  const quizAnsweredCount = Object.values(quizAnswers).filter(Boolean).length;

  // FAQ Search & Filter States
  const [faqSearchQuery, setFaqSearchQuery] = useState('');
  const [faqActiveTab, setFaqActiveTab] = useState('all'); // 'all', 'formation', 'tax', 'accounting'

  useEffect(() => {
    try {
      const storedSettings = window.localStorage.getItem(storageKey);
      if (storedSettings) {
        const parsedSettings = applySettingsEnvelope(JSON.parse(storedSettings), {
          ...defaultSettings,
          websiteUrl: appEnv.websiteUrl,
          websiteTrUrl: appEnv.websiteTrUrl,
        });
        setSettings(normalizeCoreUrls(parsedSettings.published));
        setDraftSettings(normalizeCoreUrls(parsedSettings.draft));
        setAuditLog(parsedSettings.auditLog);
        setCapturedLeads(parsedSettings.leads);
        setLastDraftSavedAt(parsedSettings.lastDraftSavedAt);
        setLastPublishedAt(parsedSettings.lastPublishedAt);
      }
      const storedLocale = window.localStorage.getItem(languageKey);
      if (storedLocale && locales[storedLocale]) {
        setLocale(storedLocale);
      }
      const storedCookie = window.localStorage.getItem(cookieKey);
      if (storedCookie) {
        const parsedCookie = JSON.parse(storedCookie);
        if (parsedCookie && typeof parsedCookie === 'object') {
          setCookieConsent({
            status: parsedCookie.status || 'custom',
            preferences: {
              ...cookiePreferenceDefaults,
              ...(parsedCookie.preferences || {}),
            },
          });
        }
      }
      const routeState = getRouteState();
      setLocale((current) => routeState.locale || current);
      setCurrentPath(routeState.path || getCurrentPath());
    } catch {
      // Keep defaults if storage is unavailable.
    }
  }, []);

  useEffect(() => {
    async function fetchPublicSiteSettings() {
      try {
        const isPrivateArea =
          currentPath === '/yonetim' ||
          currentPath === '/portal' ||
          currentPath.startsWith('/yonetim/') ||
          currentPath.startsWith('/portal/');
        const publicDefaults = {
          ...defaultSettings,
          services: defaultSettings.services.map((item) => ({ ...item })),
          plans: defaultSettings.plans.map((item) => ({ ...item })),
        };
        const cached = window.sessionStorage.getItem('onlinesmmm.publicSettings.v1');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.expiresAt > Date.now() && parsed?.siteSettings) {
            setSettings((current) => normalizeCoreUrls({
              ...(isPrivateArea ? current : publicDefaults),
              ...parsed.siteSettings,
              ...(isPrivateArea ? {} : {
                services: publicDefaults.services,
                plans: publicDefaults.plans,
              }),
            }));
            return;
          }
        }
        const response = await fetchWithTimeout(`${getApiBase()}/api/site-settings/public`, {}, 5000);
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (data?.siteSettings) {
          window.sessionStorage.setItem('onlinesmmm.publicSettings.v1', JSON.stringify({
            siteSettings: data.siteSettings,
            expiresAt: Date.now() + 60_000,
          }));
          setSettings((current) => normalizeCoreUrls({
            ...(isPrivateArea ? current : publicDefaults),
            ...data.siteSettings,
            ...(isPrivateArea ? {} : {
              services: publicDefaults.services,
              plans: publicDefaults.plans,
            }),
          }));
        }
      } catch {
        // Ignore public API failures; fallback to local defaults.
      }
    }
    fetchPublicSiteSettings();
  }, [currentPath]);

  useEffect(() => {
    async function fetchLocationCatalog() {
      try {
        const response = await fetchWithTimeout(`${getApiBase()}/api/public/locations/catalog`, {}, 5000);
        if (!response.ok) {
          throw new Error('Adres kataloğu yüklenemedi.');
        }
        const data = await response.json();
        setLocationCatalog({
          source: data?.catalog?.source || {},
          provinces: Array.isArray(data?.catalog?.provinces) ? data.catalog.provinces : [],
        });
        setLocationCatalogMeta(data?.meta || {});
        setLocationCatalogError('');
      } catch (error) {
        setLocationCatalogError(String(error?.message || 'Adres kataloğu yüklenemedi.'));
      }
    }
    fetchLocationCatalog();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          published: settings,
          draft: draftSettings,
          auditLog,
          leads: capturedLeads,
          lastDraftSavedAt,
          lastPublishedAt,
        }),
      );
    } catch {
      // Ignore persistence issues.
    }
  }, [auditLog, capturedLeads, draftSettings, lastDraftSavedAt, lastPublishedAt, settings]);

  useEffect(() => {
    try {
      window.localStorage.setItem(languageKey, locale);
    } catch {
      // Ignore persistence issues.
    }
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    if (!payment) return;

    if (payment === 'success') {
      setPaymentState({
        status: 'success',
        error: '',
        message: locale === 'en'
          ? 'Payment received. Our advisor will contact you shortly.'
          : 'Teşekkürler ödemeniz alınmıştır, Danışmanımız en kısa zamanda sizinle iletişime geçecek, gerekli bilgilendirmeleri yapacaktır.',
      });
    } else {
      setPaymentState({
        status: 'error',
        error: locale === 'en' ? 'Payment could not be confirmed.' : 'Ödeme doğrulanamadı.',
        message: '',
      });
    }

    params.delete('payment');
    params.delete('customerId');
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [locale]);

  useEffect(() => {
    return () => {
      if (leadToastTimerRef.current) {
        window.clearTimeout(leadToastTimerRef.current);
        leadToastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (cookieConsent.status !== 'unknown') {
      if (cookieDismissTimerRef.current) {
        window.clearTimeout(cookieDismissTimerRef.current);
        cookieDismissTimerRef.current = null;
      }
      return undefined;
    }

    cookieDismissTimerRef.current = window.setTimeout(() => {
      setCookieConsent({
        status: 'dismissed',
        preferences: {
          ...cookiePreferenceDefaults,
        },
      });
      setCookiePreferencesOpen(false);
      try {
        window.localStorage.setItem(
          cookieKey,
          JSON.stringify({
            status: 'dismissed',
            preferences: {
              ...cookiePreferenceDefaults,
            },
          }),
        );
      } catch {
        // Ignore persistence issues.
      }
    }, 10000);

    return () => {
      if (cookieDismissTimerRef.current) {
        window.clearTimeout(cookieDismissTimerRef.current);
        cookieDismissTimerRef.current = null;
      }
    };
  }, [cookieConsent.status]);

  function persistCookieConsent(nextConsent) {
    setCookieConsent(nextConsent);
    setCookiePreferencesOpen(false);
    try {
      window.localStorage.setItem(cookieKey, JSON.stringify(nextConsent));
    } catch {
      // Ignore persistence issues.
    }
  }

  function toggleCookiePreferences() {
    setCookiePreferencesOpen((current) => !current);
  }

  function saveCookiePreferences(preferences) {
    persistCookieConsent({
      status: 'custom',
      preferences: {
        ...cookiePreferenceDefaults,
        ...(preferences || {}),
      },
    });
  }

  function acceptCookies() {
    persistCookieConsent({
      status: 'accepted',
      preferences: {
        necessary: true,
        analytics: true,
        marketing: true,
      },
    });
  }

  function rejectCookies() {
    persistCookieConsent({
      status: 'rejected',
      preferences: {
        ...cookiePreferenceDefaults,
      },
    });
  }

  const activeLanguage = languageOptions.find((item) => item.code === locale) || languageOptions[0];
  const content = getLocaleText(locale);
  const ui = { ...locales.tr.ui, ...content.ui };

  const filteredFaqs = useMemo(() => {
    let list = content.faqs || [];
    
    // 1. Dynamic Categorization Tab Filter
    if (faqActiveTab !== 'all') {
      list = list.filter((faq) => {
        const q = faq.question.toLowerCase();
        const a = faq.answer.toLowerCase();
        
        if (faqActiveTab === 'formation') {
          return (
            q.includes('kur') ||
            q.includes('süre') ||
            q.includes('evrak') ||
            q.includes('sermaye') ||
            q.includes('ltd') ||
            q.includes('anonim') ||
            q.includes('şirket') ||
            q.includes('aşama') ||
            a.includes('kurulum')
          );
        }
        if (faqActiveTab === 'tax') {
          return (
            q.includes('vergi') ||
            q.includes('stopaj') ||
            q.includes('kdv') ||
            a.includes('vergilendirme') ||
            a.includes('gelir vergisi') ||
            a.includes('geçici vergi')
          );
        }
        if (faqActiveTab === 'incentives') {
          return (
            q.includes('teşvik') ||
            q.includes('destek') ||
            q.includes('kadın') ||
            q.includes('genç') ||
            q.includes('kosgeb') ||
            q.includes('hibe') ||
            q.includes('muaf') ||
            q.includes('bağkur') ||
            a.includes('teşvik') ||
            a.includes('destek')
          );
        }
        if (faqActiveTab === 'accounting') {
          return (
            q.includes('müşavir') ||
            q.includes('defter') ||
            q.includes('fatura') ||
            q.includes('e-belge') ||
            q.includes('beyanname') ||
            q.includes('ücret') ||
            q.includes('iyzico') ||
            q.includes('sanal pos') ||
            a.includes('smmm')
          );
        }
        return true;
      });
    }

    // 2. Search query filter
    if (faqSearchQuery.trim()) {
      const query = faqSearchQuery.toLowerCase();
      list = list.filter(
        (faq) =>
          faq.question.toLowerCase().includes(query) ||
          faq.answer.toLowerCase().includes(query)
      );
    }
    return list;
  }, [content.faqs, faqActiveTab, faqSearchQuery]);
  const faqCopy = ui.faqCopy || 'Başlamadan önce en çok gelen soruları netleştirdik.';
  const brandLogo = '/smmm-logo.png';
  const brandDisplay = {
    ariaLabel: 'OnlineSMMM ana sayfa',
    mark: '◎',
    name: 'OnlineSMMM',
    namePrefix: 'Online',
    nameAccent: 'SMMM',
    logo: brandLogo,
  };
  const brandName = brandDisplay.name;
  const localizedWhatsAppMessage =
    locale === 'tr' ? settings.whatsappMessage : `${content.hero.primaryCta}. ${content.hero.copy}`;
  const whatsappHref = `https://wa.me/${settings.whatsappNumber}?text=${encodeURIComponent(localizedWhatsAppMessage)}`;
  const applicationCtaLabel = locale === 'en' ? 'Start my company' : 'Şirketimi hemen kur';
  const applicationPath = buildLocalizedPath('/basvuru', locale);
  const localizedSecondaryCta = locale === 'tr' ? settings.secondaryCta || content.hero.secondaryCta : content.hero.secondaryCta;
  const localizedHeroCopy = locale === 'tr' ? settings.heroCopy || content.hero.copy : content.hero.copy;
  const localizedPaymentTrustTitle = locale === 'tr' ? settings.paymentTrustTitle || ui.paymentTrustTitle : ui.paymentTrustTitle;
  const localizedPaymentTrustCopy = locale === 'tr' ? settings.paymentTrustCopy || ui.paymentTrustCopy : ui.paymentTrustCopy;
  const localizedPaymentMethodLabel = locale === 'tr' ? settings.paymentMethodLabel || ui.paymentMethodLabel : ui.paymentMethodLabel;
  const localizedCardLogosLabel = locale === 'tr' ? settings.cardLogosLabel || ui.cardLogosLabel : ui.cardLogosLabel;
  const customerVisitTrackingEnabled = settings.customerVisitTrackingEnabled !== false;
  const leadProgressTrackingEnabled = settings.leadProgressTrackingEnabled !== false;
  const priceLabels = getLocalizedPriceLabels(locale);
  const activeCampaign = useMemo(() => {
    const archive = Array.isArray(settings.campaignPopupArchive) ? settings.campaignPopupArchive : [];
    const isExpired = (item) => {
      if (!item?.endDate) {
        return false;
      }
      const deadline = new Date(item.endDate).getTime();
      return Number.isFinite(deadline) && deadline <= Date.now();
    };
    const candidate =
      archive.find((item) => item.id === settings.campaignPopupActiveId && item.isActive && !item.archivedAt && !isExpired(item)) ||
      archive.find((item) => item.isActive && !item.archivedAt && !isExpired(item)) ||
      archive.find((item) => !item.archivedAt && !isExpired(item));
    return candidate || null;
  }, [settings.campaignPopupActiveId, settings.campaignPopupArchive]);
  const popupCampaign = activeCampaign || normalizeCoreUrls(defaultSettings).campaignPopupArchive[0];
  // Canvas particle field replaces old CSS particle system
  const particleField = (
    <Suspense fallback={null}>
      <ParticleCanvas />
      <ParticleCanvas layer="foreground" />
    </Suspense>
  );
  const localizedServiceSource = mergeLocalizedCommercialData(content.services, settings.services, 'price');
  const localizedPlanSource = mergeLocalizedCommercialData(content.pricing.plans, settings.plans, 'basePrice');

  const renderedServices = useMemo(
    () =>
      localizedServiceSource.map((service) => ({
        ...service,
        original: service.price,
        discounted: service.price == null ? null : computeDiscountedPrice(service.price, settings.discountPercent),
      })),
    [localizedServiceSource, settings.discountPercent],
  );

  function buildServiceInquiryHref(service) {
    const servicePriceLabel =
      service.original == null
        ? priceLabels.quote
        : `${renderFallbackPrice(service.discounted, locale, priceLabels.quote)} (${renderFallbackPrice(service.original, locale, priceLabels.free)} yerine)`;

    const messageLines = [
      locale === 'en'
        ? 'Hello, I clicked a service card and would like information.'
        : 'Merhaba, hizmet kartı üzerinden iletişime geçiyorum.',
      `Kart / Card: ${service.title}`,
      `Kategori / Category: ${service.badge || '-'}`,
      `Fiyat durumu / Price status: ${servicePriceLabel}`,
      `Kaynak / Source: service-card`,
    ];

    return `https://wa.me/${settings.whatsappNumber}?text=${encodeURIComponent(messageLines.join('\n'))}`;
  }

  const renderedPlans = useMemo(
    () =>
      localizedPlanSource.map((plan) => ({
        ...plan,
        featured: plan.id === 'sole',
        label: plan.id === 'sole'
          ? ({
            tr: 'Kurumsal Başlangıç',
            en: 'Corporate Start',
            de: 'Unternehmensstart',
            it: 'Avvio Aziendale',
            es: 'Inicio Corporativo',
            fr: 'Départ Entreprise',
            az: 'Korporativ Başlanğıc',
            ky: 'Корпоративдик башталыш',
            tk: 'Korporatiw başlangyç',
            ru: 'Корпоративный старт',
            ar: 'بداية مؤسسية',
          }[locale] || 'Kurumsal Başlangıç')
          : plan.label,
        featuredLabel: locale === 'en' ? 'Featured choice' : 'En çok tercih edilen',
        original: plan.basePrice,
        discounted: computeDiscountedPrice(plan.basePrice, settings.discountPercent),
      })),
    [locale, localizedPlanSource, settings.discountPercent],
  );

  const renderedDraftServices = useMemo(
    () =>
      mergeLocalizedCommercialData(locales.tr.services, draftSettings.services, 'price').map((service) => ({
        ...service,
        original: service.price,
        discounted: service.price == null ? null : computeDiscountedPrice(service.price, draftSettings.discountPercent),
      })),
    [draftSettings.discountPercent, draftSettings.services],
  );

  const renderedDraftPlans = useMemo(
    () =>
      mergeLocalizedCommercialData(locales.tr.pricing.plans, draftSettings.plans, 'basePrice').map((plan) => ({
        ...plan,
        featured: plan.id === 'sole',
        label: plan.id === 'sole'
          ? ({
            tr: 'Kurumsal Başlangıç',
            en: 'Corporate Start',
            de: 'Unternehmensstart',
            it: 'Avvio Aziendale',
            es: 'Inicio Corporativo',
            fr: 'Départ Entreprise',
            az: 'Korporativ Başlanğıc',
            ky: 'Корпоративдик башталыш',
            tk: 'Korporatiw başlangyç',
            ru: 'Корпоративный старт',
            ar: 'بداية مؤسسية',
          }[locale] || 'Kurumsal Başlangıç')
          : plan.label,
        featuredLabel: locale === 'en' ? 'Featured choice' : 'En çok tercih edilen',
        original: plan.basePrice,
        discounted: computeDiscountedPrice(plan.basePrice, draftSettings.discountPercent),
      })),
    [locale, draftSettings.discountPercent, draftSettings.plans],
  );

  const companyWizardLabels = {
    tr: {
      title: 'Şirket türünü seç',
      copy: 'Şirket tipini seç; evrak listesi ve başlangıç maliyeti hemen netleşsin.',
      pill: 'Başlangıç sihirbazı',
      companyType: 'Şirket türü',
      activityTitle: 'Ticari faaliyet',
      activityCopy: 'Bu aşamada şirket kuruluşunda ticari faaliyet alanınızı belirleyelim.',
      mainActivity: 'Ana faaliyet alanı',
      subActivity: 'Alt faaliyet',
      revenueMethod: 'Gelir elde etme yöntemi',
      salesChannel: 'Satış kanalı',
      activityCta: 'Faaliyeti onayla',
      checklist: 'Gerekli evraklar',
      cta: 'İlerle',
      paymentTitle: 'Ödeme',
      paymentCopy: 'Başvuru kaydı alındı. Ödeme ekranında tutar ve işlem güvenli şekilde tamamlanır.',
      paymentOpen: 'Ödeme ekranını aç',
      paymentLater: 'Şimdilik kapat',
      name: 'Ad soyad',
      phone: 'Telefon',
      email: 'E-posta',
      companyName: 'Şirket adı',
      address: 'Adres',
      addressNote: '(!) Home Office değilse kira kontratı gerekir',
      province: 'İl',
      district: 'İlçe',
      neighborhood: 'Mahalle',
      addressDetail: 'Adres detay',
      documentUploadTitle: 'Evrak yükleme',
      documentUploadCopy: 'Fotoğraf yükle veya çek.',
      mobileUploadCopy: 'Tıkla fotoğraf yükle / çek',
      selectedFiles: 'Seçili dosyalar',
      clearFiles: 'Tümünü temizle',
      removeFile: 'Kaldır',
      stageFour: 'Kayıt alındı',
      stageFive: 'WhatsApp gönderildi',
    },
    en: {
      title: 'Choose your company type',
      copy: 'Select the structure to see the documents and starting estimate.',
      pill: 'Start wizard',
      companyType: 'Company type',
      activityTitle: 'Commercial activity',
      activityCopy: 'Clarify the activity structure with a clean, non-overlapping classification.',
      mainActivity: 'Main activity',
      subActivity: 'Sub activity',
      revenueMethod: 'Revenue method',
      salesChannel: 'Sales channel',
      activityCta: 'Confirm activity',
      checklist: 'Required documents',
      cta: 'Proceed',
      paymentTitle: 'Payment',
      paymentCopy: 'Your application is saved. The payment screen completes the amount and transaction securely.',
      paymentOpen: 'Open payment screen',
      paymentLater: 'Close for now',
      name: 'Full name',
      phone: 'Phone',
      email: 'Email',
      companyName: 'Company name',
      address: 'Address',
      addressNote: 'If it is not a home office, a lease contract is required.',
      province: 'Province',
      district: 'District',
      neighborhood: 'Neighborhood',
      addressDetail: 'Address detail',
      documentUploadTitle: 'Document upload',
      documentUploadCopy: 'Upload or take a photo.',
      mobileUploadCopy: 'Tap to upload / take a photo',
      selectedFiles: 'Selected files',
      clearFiles: 'Clear all',
      removeFile: 'Remove',
      stageFour: 'Saved',
      stageFive: 'WhatsApp sent',
    },
  };

  const wizardData = [
    {
      id: 'sole',
      label: locale === 'en' ? 'Sole Proprietorship' : 'Şahıs Şirketi',
      summary:
        locale === 'en'
          ? 'Fast, low-friction setup for solo founders and freelancers.'
          : 'Tek kişi, düşük karmaşıklık, hızlı kurulum isteyen yapı.',
      planId: 'sole',
      docs:
        locale === 'en'
          ? ['ID copy', 'Lease contract (if any)']
          : ['Kimlik Fotokopisi', 'Kira Kontratı (varsa)'],
    },
    {
      id: 'limited',
      label: locale === 'en' ? 'Limited Company' : 'Limited Şirket',
      summary:
        locale === 'en'
          ? 'Best for growing teams, e-commerce and brand-led businesses.'
          : 'Büyüyen ekipler, e-ticaret ve kurumsal yapı için en dengeli seçenek.',
      planId: 'limited',
      docs:
        locale === 'en'
          ? ['ID copy', 'Lease contract (if any)']
          : ['Kimlik Fotokopisi', 'Kira Kontratı (varsa)'],
    },
    {
      id: 'inc',
      label: locale === 'en' ? 'Joint Stock Company' : 'Anonim Şirket',
      summary:
        locale === 'en'
          ? 'Corporate structure for investment, scale and board-level governance.'
          : 'Yatırım, ölçek ve kurumsal yönetim için güçlü yapı.',
      planId: 'inc',
      docs:
        locale === 'en'
          ? ['ID copy', 'Lease contract (if any)']
          : ['Kimlik Fotokopisi', 'Kira Kontratı (varsa)'],
    },
    {
      id: 'global',
      label: locale === 'en' ? 'Global Setup' : 'Yurt Dışı Yapı',
      summary:
        locale === 'en'
          ? 'For US, UK, Estonia and UAE company formations.'
          : 'ABD, İngiltere, Estonya ve BAE şirket kurulumları için.',
      planId: 'global',
      docs:
        locale === 'en'
          ? ['ID copy', 'Lease contract (if any)']
          : ['Kimlik Fotokopisi', 'Kira Kontratı (varsa)'],
    },
  ];

  const selectedWizard = wizardData.find((item) => item.id === selectedCompanyType) || wizardData[1];
  const selectedWizardPlan = renderedPlans.find((plan) => plan.id === selectedWizard.planId);
  const wizardCopy = companyWizardLabels[locale] || companyWizardLabels.tr;
  const activityCatalog = useMemo(
    () => ({
      mainActivities: [
        {
          id: 'service',
          label: locale === 'en' ? 'Services / consulting' : 'Hizmet / danışmanlık',
          subActivities: [
            { id: 'consulting', label: locale === 'en' ? 'Consulting' : 'Danışmanlık' },
            { id: 'software-saas', label: locale === 'en' ? 'Software / SaaS' : 'Yazılım / SaaS' },
            { id: 'agency', label: locale === 'en' ? 'Agency / creative work' : 'Ajans / kreatif işler' },
            { id: 'education-training', label: locale === 'en' ? 'Education / training' : 'Eğitim / eğitim hizmeti' },
            { id: 'technical-support', label: locale === 'en' ? 'Technical support / maintenance' : 'Teknik destek / bakım' },
          ],
        },
        {
          id: 'commerce',
          label: locale === 'en' ? 'Trade / e-commerce' : 'Ticaret / e-ticaret',
          subActivities: [
            { id: 'retail', label: locale === 'en' ? 'Retail sales' : 'Perakende satış' },
            { id: 'wholesale', label: locale === 'en' ? 'Wholesale' : 'Toptan satış' },
            { id: 'ecommerce-store', label: locale === 'en' ? 'Online store' : 'E-ticaret mağazası' },
            { id: 'marketplace', label: locale === 'en' ? 'Marketplace seller' : 'Pazaryeri satıcılığı' },
            { id: 'import-trade', label: locale === 'en' ? 'Import trade' : 'İthalat ticareti' },
          ],
        },
        {
          id: 'production',
          label: locale === 'en' ? 'Production / workshop' : 'Üretim / atölye',
          subActivities: [
            { id: 'small-production', label: locale === 'en' ? 'Small-scale production' : 'Küçük ölçekli üretim' },
            { id: 'food', label: locale === 'en' ? 'Food / packaging' : 'Gıda / paketleme' },
            { id: 'textile', label: locale === 'en' ? 'Textile / workshop' : 'Tekstil / atölye' },
            { id: 'furniture', label: locale === 'en' ? 'Furniture / woodwork' : 'Mobilya / ahşap işleme' },
            { id: 'metal-work', label: locale === 'en' ? 'Metal / machinery work' : 'Metal / makine işleme' },
          ],
        },
        {
          id: 'construction',
          label: locale === 'en' ? 'Construction / real estate' : 'İnşaat / emlak',
          subActivities: [
            { id: 'contracting', label: locale === 'en' ? 'Construction contracting' : 'Taahhüt / inşaat' },
            { id: 'renovation', label: locale === 'en' ? 'Renovation / decoration' : 'Tadilat / dekorasyon' },
            { id: 'real-estate', label: locale === 'en' ? 'Real estate brokerage' : 'Emlak danışmanlığı' },
            { id: 'project-management', label: locale === 'en' ? 'Project management' : 'Proje yönetimi' },
          ],
        },
        {
          id: 'logistics',
          label: locale === 'en' ? 'Logistics / storage' : 'Lojistik / depolama',
          subActivities: [
            { id: 'courier', label: locale === 'en' ? 'Courier / delivery' : 'Kurye / teslimat' },
            { id: 'transport', label: locale === 'en' ? 'Transportation' : 'Nakliye' },
            { id: 'warehouse', label: locale === 'en' ? 'Storage / warehouse' : 'Depolama / antrepo' },
            { id: 'customs', label: locale === 'en' ? 'Customs operations' : 'Gümrük operasyonları' },
          ],
        },
        {
          id: 'agri-food',
          label: locale === 'en' ? 'Agriculture / food' : 'Tarım / gıda',
          subActivities: [
            { id: 'crop', label: locale === 'en' ? 'Crop production' : 'Bitkisel üretim' },
            { id: 'livestock', label: locale === 'en' ? 'Livestock' : 'Hayvancılık' },
            { id: 'organic', label: locale === 'en' ? 'Organic products' : 'Organik ürünler' },
            { id: 'food-processing', label: locale === 'en' ? 'Food processing' : 'Gıda işleme' },
          ],
        },
        {
          id: 'education-media',
          label: locale === 'en' ? 'Education / media' : 'Eğitim / medya',
          subActivities: [
            { id: 'courses', label: locale === 'en' ? 'Courses / seminars' : 'Kurs / seminer' },
            { id: 'online-education', label: locale === 'en' ? 'Online education' : 'Online eğitim' },
            { id: 'publishing', label: locale === 'en' ? 'Publishing / content' : 'Yayıncılık / içerik' },
            { id: 'events', label: locale === 'en' ? 'Event organization' : 'Organizasyon / etkinlik' },
          ],
        },
        {
          id: 'health-wellness',
          label: locale === 'en' ? 'Health / wellness' : 'Sağlık / bakım',
          subActivities: [
            { id: 'beauty', label: locale === 'en' ? 'Beauty / aesthetics' : 'Güzellik / estetik' },
            { id: 'wellness', label: locale === 'en' ? 'Sports / wellness' : 'Spor / wellness' },
            { id: 'personal-care', label: locale === 'en' ? 'Personal care' : 'Kişisel bakım' },
            { id: 'health-consulting', label: locale === 'en' ? 'Health consulting' : 'Sağlık danışmanlığı' },
          ],
        },
        {
          id: 'finance',
          label: locale === 'en' ? 'Finance / brokerage' : 'Finans / aracılık',
          subActivities: [
            { id: 'commission', label: locale === 'en' ? 'Commission / brokerage' : 'Komisyon / aracılık' },
            { id: 'finance-agency', label: locale === 'en' ? 'Agency work' : 'Acentelik' },
            { id: 'insurance', label: locale === 'en' ? 'Insurance agency' : 'Sigorta acenteliği' },
            { id: 'collection', label: locale === 'en' ? 'Collection / payment services' : 'Tahsilat / ödeme hizmetleri' },
          ],
        },
        {
          id: 'global',
          label: locale === 'en' ? 'International trade' : 'Dış ticaret / uluslararası',
          subActivities: [
            { id: 'micro-export', label: locale === 'en' ? 'Micro export' : 'Mikro ihracat' },
            { id: 'foreign-services', label: locale === 'en' ? 'Services abroad' : 'Yurt dışına hizmet' },
            { id: 'distribution', label: locale === 'en' ? 'Distribution / representative office' : 'Distribütörlük / temsilcilik' },
            { id: 'import-export', label: locale === 'en' ? 'Import / export operations' : 'İthalat / ihracat operasyonu' },
          ],
        },
      ],
      revenueMethods: [
        { id: 'invoice', label: locale === 'en' ? 'Invoice-based service income' : 'Fatura karşılığı hizmet geliri' },
        { id: 'product-sale', label: locale === 'en' ? 'Product sales' : 'Ürün satışı' },
        { id: 'subscription', label: locale === 'en' ? 'Subscription / recurring revenue' : 'Abonelik / düzenli gelir' },
        { id: 'commission', label: locale === 'en' ? 'Commission / brokerage' : 'Komisyon / aracılık' },
        { id: 'project', label: locale === 'en' ? 'Project-based income' : 'Proje bazlı gelir' },
        { id: 'service-package', label: locale === 'en' ? 'Service package' : 'Hizmet paketi' },
      ],
      salesChannels: [
        { id: 'direct', label: locale === 'en' ? 'Direct customer' : 'Doğrudan müşteri' },
        { id: 'website', label: locale === 'en' ? 'Website / online form' : 'Web sitesi / online form' },
        { id: 'marketplace', label: locale === 'en' ? 'Marketplace' : 'Pazaryeri' },
        { id: 'social', label: locale === 'en' ? 'Social media / WhatsApp' : 'Sosyal medya / WhatsApp' },
        { id: 'store', label: locale === 'en' ? 'Physical store / office' : 'Fiziki mağaza / ofis' },
        { id: 'field', label: locale === 'en' ? 'Field sales / visits' : 'Saha satış / ziyaret' },
      ],
    }),
    [locale],
  );
  const selectedMainActivity = activityCatalog.mainActivities.find((item) => item.id === activityForm.mainActivity) || activityCatalog.mainActivities[0];
  const selectedSubActivity =
    selectedMainActivity.subActivities.find((item) => item.id === activityForm.subActivity) || selectedMainActivity.subActivities[0];
  const selectedRevenueMethod =
    activityCatalog.revenueMethods.find((item) => item.id === activityForm.revenueMethod) || activityCatalog.revenueMethods[0];
  const selectedSalesChannel =
    activityCatalog.salesChannels.find((item) => item.id === activityForm.salesChannel) || activityCatalog.salesChannels[0];
  const selectedActivitySummary = {
    mainActivity: selectedMainActivity.label,
    subActivity: selectedSubActivity.label,
    revenueMethod: selectedRevenueMethod.label,
    salesChannel: selectedSalesChannel.label,
  };
  const provinceOptions = useMemo(() => (Array.isArray(locationCatalog.provinces) ? locationCatalog.provinces.map((province) => ({
    id: province.id,
    name: province.name,
    districts: Array.isArray(province.districts) ? province.districts.map((district) => ({
      id: district.id,
      name: district.name,
      neighborhoods: Array.isArray(district.neighborhoods) ? district.neighborhoods.map((neighborhood) => ({
        id: neighborhood.id,
        name: neighborhood.name,
      })) : [],
    })) : [],
  })) : []), [locationCatalog.provinces]);
  const selectedProvince = findOptionByName(provinceOptions, leadForm.province);
  const districtOptions = useMemo(
    () => (selectedProvince ? selectedProvince.districts || [] : []),
    [selectedProvince],
  );
  const selectedDistrict = findOptionByName(districtOptions, leadForm.district);
  const neighborhoodOptions = useMemo(
    () => (selectedDistrict ? selectedDistrict.neighborhoods || [] : []),
    [selectedDistrict],
  );
  const composedLeadAddress = composeAddressLine(leadForm);
  const wizardEstimate = selectedWizardPlan ? formatPrice(selectedWizardPlan.discounted, locale) : priceLabels.quote;
  const wizardOriginalPrice = selectedWizardPlan ? formatPrice(selectedWizardPlan.original, locale) : '';
  const wizardFlowSteps = [
    { number: '1', label: wizardCopy.title, state: wizardStage >= 1 ? 'active' : '' },
    { number: '2', label: wizardCopy.activityTitle, state: wizardStage >= 2 ? 'active' : '' },
    { number: '3', label: wizardCopy.documentUploadTitle, state: wizardStage >= 3 ? 'active' : 'next' },
    { number: '4', label: locale === 'en' ? 'Information' : 'Bilgiler', state: wizardStage >= 4 ? 'active' : '' },
    { number: '5', label: wizardCopy.paymentTitle, state: wizardStage >= 5 ? 'active' : '' },
  ];
  const discountLabelMap = {
    tr: `%${settings.discountPercent} indirim`,
    en: `${settings.discountPercent}% discounted`,
    de: `${settings.discountPercent}% Rabatt`,
    it: `${settings.discountPercent}% di sconto`,
    es: `${settings.discountPercent}% de descuento`,
    fr: `${settings.discountPercent}% de réduction`,
    az: `%${settings.discountPercent} endirim`,
    ky: `%${settings.discountPercent} арзандатуу`,
    tk: `%${settings.discountPercent} arzanladyş`,
    ru: `скидка ${settings.discountPercent}%`,
    ar: `خصم ${settings.discountPercent}%`,
  };
  const discountLabel = discountLabelMap[locale] || discountLabelMap.tr;
  const partnerLogos = [
    {
      short: 'GİB',
      name: locale === 'en' ? 'Revenue Administration' : 'Gelir İdaresi Başkanlığı',
      label: locale === 'en' ? 'e-Document and tax workflows' : 'e-Belge ve vergi süreçleri',
      tone: 'blue',
    },
    {
      short: 'T.C.',
      name: locale === 'en' ? 'Ministry of Trade' : 'Ticaret Bakanlığı',
      label: locale === 'en' ? 'Company formation regulations' : 'Şirket kuruluş mevzuatı',
      tone: 'red',
      logo: '/partners/ticaret-bakanligi.png',
    },
    {
      short: 'MERSİS',
      name: 'MERSİS',
      label: locale === 'en' ? 'Central registry records' : 'Merkezi sicil kayıtları',
      tone: 'navy',
      logo: '/partners/mersis.png',
      logoBackdrop: 'dark',
    },
    {
      short: 'TS',
      name: locale === 'en' ? 'Trade Registry' : 'Ticaret Sicil',
      label: locale === 'en' ? 'Formation and registration steps' : 'Kuruluş ve tescil adımları',
      tone: 'teal',
    },
    {
      short: 'SGK',
      name: locale === 'en' ? 'Social Security Institution' : 'Sosyal Güvenlik Kurumu',
      label: locale === 'en' ? 'Employer and personnel filings' : 'İşveren ve personel bildirimleri',
      tone: 'green',
      logo: '/partners/sgk.svg',
    },
    {
      short: 'KOSGEB',
      name: 'KOSGEB',
      label: locale === 'en' ? 'SME incentives and programs' : 'KOBİ destek ve teşvik programları',
      tone: 'slate',
      logo: '/partners/kosgeb.png',
    },
    {
      short: 'TÜRKPATENT',
      name: 'TÜRKPATENT',
      label: locale === 'en' ? 'Trademark and patent filings' : 'Marka ve patent başvuruları',
      tone: 'red',
      logo: '/partners/turkpatent.svg',
    },
    {
      short: 'TOBB',
      name: 'TOBB',
      label: locale === 'en' ? 'Chambers and commerce ecosystem' : 'Oda ve ticaret ekosistemi',
      tone: 'amber',
    },
    {
      short: 'İYZİCO',
      name: 'iyzico',
      label: locale === 'en' ? 'Secure provider redirect' : 'Güvenli sağlayıcı yönlendirmesi',
      tone: 'purple',
      logo: '/partners/iyzico.png',
    },
    {
      short: 'WA',
      name: 'WhatsApp',
      label: locale === 'en' ? 'Direct customer chat' : 'Doğrudan müşteri görüşmesi',
      tone: 'green',
      logo: '/partners/whatsapp.svg',
    },
    {
      short: 'G',
      name: 'Google',
      label: locale === 'en' ? 'Search and visibility' : 'Arama ve görünürlük',
      tone: 'slate',
      logo: '/partners/google.svg',
    },
    {
      short: 'GS',
      name: 'GurSoft.com.tr',
      label: locale === 'en' ? 'Software and digital solutions' : 'Yazılım ve dijital çözümler',
      tone: 'indigo',
      logo: '/partners/gursoft.svg',
    },
  ];
  const variableFeeLabel = locale === 'tr' ? 'Değişken' : locale === 'en' ? 'Variable' : priceLabels.quote;
  const lineItemFeeLabel = locale === 'tr' ? 'Kaleme göre' : locale === 'en' ? 'By item' : priceLabels.quote;
  const feeBreakdown = [
    { label: locale === 'en' ? 'Official fees' : 'Resmi harçlar', value: variableFeeLabel },
    { label: locale === 'en' ? 'Notary' : 'Noter', value: lineItemFeeLabel },
    { label: locale === 'en' ? 'Registry' : 'Sicil', value: lineItemFeeLabel },
    { label: locale === 'en' ? 'Service fee' : 'Hizmet bedeli', value: formatPrice(draftSettings.plans[0]?.basePrice || 0, locale) },
  ];
  const paymentReady =
    Boolean(settings.paymentCheckoutUrl) &&
    Boolean(settings.paymentCallbackUrl) &&
    Boolean(settings.iyzicoMerchantId);
  const wizardPaymentNextSteps = useMemo(
    () =>
      locale === 'en'
        ? ['Your application package is saved.', 'Secure payment opens automatically.', 'After payment, an advisor follows up with you.']
        : ['Başvuru paketiniz kaydedildi.', 'Güvenli ödeme otomatik açılır.', 'Ödeme sonrası danışmanınız sizinle iletişime geçer.'],
    [locale],
  );
  const heroAccent = locale === 'tr' ? settings.heroAccent || content.hero.accent : content.hero.accent;
  const heroAccentParts = splitHeroAccent(heroAccent);

  const footerSecuritySignals = [
    {
      label: ui.sslLabel || 'SSL Sertifikası',
      value: settings.sslStatus || 'Aktif SSL / TLS',
    },
    {
      label: localizedPaymentMethodLabel || (locale === 'en' ? 'Payment redirect' : 'Ödeme yönlendirme'),
      value: paymentReady ? 'iyzico' : locale === 'en' ? 'Defined in admin' : 'Admin panelinden tanımlanır',
    },
    {
      label: locale === 'en' ? 'Card data' : 'Kart verisi',
      value: locale === 'en' ? 'Not stored on this page' : 'Bu sayfada tutulmaz',
    },
    {
      label: localizedCardLogosLabel || (locale === 'en' ? 'Card brands' : 'Kart markaları'),
      value: 'Visa / Mastercard / 3D Secure',
    },
  ];
  const trustSignals = [
    {
      title: locale === 'en' ? '360 workflow' : '360 derece süreç',
      text:
        locale === 'en'
          ? 'Formation, legal address, e-signature, e-documents and advisory steps stay in one flow.'
          : 'Kuruluş, yasal adres, e-imza, e-belge ve danışmanlık adımları tek akışta toplanır.',
    },
    {
      title: locale === 'en' ? 'CPA-backed workflow' : 'SMMM destekli süreç',
      text:
        locale === 'en'
          ? 'CPA involvement keeps setup, bookkeeping and compliance aligned from day one.'
          : 'Kuruluş, muhasebe ve uyum akışı en baştan SMMM desteğiyle ilerler.',
    },
    {
      title: locale === 'en' ? 'Panel tracking' : 'Panelden takip',
      text:
        locale === 'en'
          ? 'Documents, missing items, lead source and process status are traceable from the admin area.'
          : 'Evrak, eksik kalem, lead kaynağı ve süreç durumu admin alanından izlenebilir.',
    },
    {
      title: ui.sslLabel || 'SSL Sertifikası',
      text: settings.sslStatus || 'Aktif SSL / TLS',
    },
  ];
  const qualityStandards = [
    {
      title: 'Hizmet Standartları',
      items: [
        'Her müşteri için yazılı hizmet sözleşmesi',
        'İş kabul ve müşteri tanıma (KYC) prosedürü',
        'Kontrol listeleriyle yürütülen iş akışı',
        'Beyanname ve bildirimlerde çift kontrol',
        'Her işlem için sorumlu personel ataması',
      ],
    },
    {
      title: 'Evrak Yönetimi',
      items: [
        'Gelen-giden evrak kayıt sistemi',
        'Evrak teslim tutanakları',
        'Dijital arşivleme',
        'Yasal saklama sürelerine uygun muhafaza',
        'Günlük yedekleme yaklaşımı',
      ],
    },
    {
      title: 'Bilgi Güvenliği',
      items: [
        'Güçlü parola politikası',
        'İki aşamalı doğrulama',
        'Yetkilendirilmiş kullanıcı sistemi',
        'KVKK uyumlu veri işleme süreçleri',
        'Güvenlik duvarı ve antivirüs kullanımı',
      ],
    },
    {
      title: 'Müşteri İletişimi',
      items: [
        'Bilgi taleplerine 2 saat içinde dönüş',
        'Belge taleplerine en geç 24 saat içinde dönüş',
        'Düzenli mali durum raporları',
        'Vergi takvimi hatırlatmaları',
        'WhatsApp, e-posta ve telefon iletişim prosedürü',
      ],
    },
    {
      title: 'Personel Yönetimi',
      items: [
        'Yazılı görev tanımları',
        'Yıllık eğitim planı',
        'Performans değerlendirme sistemi',
        'Gizlilik sözleşmeleri',
        'Yazılı etik kurallar',
      ],
    },
    {
      title: 'İç Kontrol',
      items: [
        'Beyannamelerde ikinci kişi kontrolü',
        'Aylık dosya denetimleri',
        'Hata kayıt ve düzeltme sistemi',
        'Risk analizi',
        'İş sürekliliği planı',
      ],
    },
    {
      title: 'Fiziki Ofis Standartları',
      items: [
        'Düzenli ve temiz çalışma alanı',
        'Güvenli evrak dolapları',
        'Yangın söndürme ekipmanları',
        'Misafir görüşme odası',
        'Mümkün olan ölçüde erişilebilir düzenlemeler',
      ],
    },
    {
      title: 'Teknolojik Altyapı',
      items: [
        'Lisanslı muhasebe yazılımları',
        'Bulut yedekleme',
        'Elektronik imza altyapısı',
        'E-Belge entegrasyonları',
        'Düzenli yazılım güncellemeleri',
      ],
    },
  ];

  const contactLinks = [
    {
      label: settings.contactBarWhatsAppLabel || ui.contactActions?.whatsapp || 'WhatsApp',
      href: whatsappHref,
      tone: 'whatsapp',
      icon: 'whatsapp',
      external: true,
    },
    settings.contactEmail && {
      label: settings.contactBarEmailLabel || ui.contactActions?.email || 'E-posta',
      href: `mailto:${settings.contactEmail}`,
      tone: 'light',
      icon: 'email',
      external: false,
    },
    {
      label: settings.contactBarCallLabel || ui.contactActions?.call || 'Ara',
      href: buildTelHref(settings.contactPhone),
      tone: 'light',
      icon: 'phone',
      external: false,
    },
  ].filter(Boolean).filter((link) => link.href);

  const footerContacts = [
    { label: settings.contactPhone, href: buildTelHref(settings.contactPhone), external: false },
    { label: settings.contactAddress, href: '', external: false },
    { label: settings.websiteUrl?.replace(/^https?:\/\//, ''), href: ensureExternalUrl(settings.websiteUrl), external: true },
    { label: settings.websiteTrUrl?.replace(/^https?:\/\//, ''), href: ensureExternalUrl(settings.websiteTrUrl), external: true },
  ].filter((item) => item.label && (item.href || item.label === settings.contactAddress));

  const footerSocial = [
    settings.instagramUrl && { label: 'Instagram', href: ensureExternalUrl(settings.instagramUrl) },
  ].filter(Boolean);
  const displayDomains = [settings.websiteUrl, settings.websiteTrUrl]
    .map((domain) => String(domain || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''))
    .filter(Boolean);

  const legalLinks = [
    { label: ui.aboutLabel || 'Hakkımızda', href: buildLocalizedPath('/hakkimizda', locale) },
    { label: ui.kvkkLabel || 'KVKK Aydınlatma', href: buildLocalizedPath('/kvkk', locale) },
    { label: ui.privacyLabel || 'Gizlilik Politikası', href: buildLocalizedPath('/gizlilik-politikasi', locale) },
    { label: ui.cookiesLabel || 'Çerez Politikası', href: buildLocalizedPath('/cerez-politikasi', locale) },
    { label: ui.consentLabel || 'Açık Rıza Metni', href: buildLocalizedPath('/acik-riza-metni', locale) },
    { label: ui.dataPolicyLabel || 'Veri İşleme Politikası', href: buildLocalizedPath('/veri-isleme-politikasi', locale) },
    { label: ui.deliveryReturnLabel || 'Teslimat ve İade', href: buildLocalizedPath('/teslimat-ve-iade-sartlari', locale) },
    { label: ui.privacyAgreementLabel || 'Gizlilik Sözleşmesi', href: buildLocalizedPath('/gizlilik-sozlesmesi', locale) },
    { label: ui.distanceSalesLabel || 'Mesafeli Satış', href: buildLocalizedPath('/mesafeli-satis-sozlesmesi', locale) },
    { label: ui.termsLabel || 'Kullanım Şartları', href: buildLocalizedPath('/kullanim-sartlari', locale) },
  ];
  const homeSectionHref = (hash) => `/${hash}`;

  function navigateTo(nextPath, options = {}) {
    const { locale: nextLocale = locale, localized = true } = options;
    const normalized = nextPath === '/' ? '/' : nextPath.replace(/\/+$/, '');
    const destination = localized ? buildLocalizedPath(normalized, nextLocale) : normalized;
    window.history.pushState({}, '', destination);
    setCurrentPath(normalized);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function changeLocale(nextLocale) {
    setLocale(nextLocale);
    if (!isPortalPage && !isAdminPage) {
      navigateTo(currentPath, { locale: nextLocale, localized: true });
    } else {
      window.localStorage.setItem(languageKey, nextLocale);
    }
  }

  const fileSummary = useMemo(() => {
    if (!uploadedFiles.length) return content.ui.fileEmpty;
    const types = [...new Set(uploadedFiles.map((file) => {
      const mime = String(file?.type || '').toLowerCase();
      if (mime.includes('pdf')) return 'PDF';
      if (mime.includes('jpeg') || mime.includes('jpg')) return 'JPG';
      if (mime.includes('png')) return 'PNG';
      return String(file?.name || '').split('.').pop()?.toUpperCase() || 'FILE';
    }))];
    return `${uploadedFiles.length} ${content.ui.fileReady} • ${types.join(', ')}`;
  }, [uploadedFiles, content.ui.fileEmpty, content.ui.fileReady]);

  function onFileChange(event) {
    const nextFiles = Array.from(event.target.files || []);
    const maxSize = 15 * 1024 * 1024;
    const maxFiles = 8;
    const acceptedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
    const existingFiles = uploadedFiles || [];
    const sizeErrors = nextFiles
      .filter((file) => file.size > maxSize)
      .map((file) => `${file.name} 15 MB sınırını aşıyor.`);
    const typeErrors = nextFiles
      .filter((file) => !acceptedTypes.has(file.type))
      .map((file) => `${file.name} için yalnızca PDF, JPG veya PNG kabul edilir.`);
    const accepted = nextFiles
      .filter((file) => file.size <= maxSize && acceptedTypes.has(file.type))
      .filter((file) => !existingFiles.some((current) => current.name === file.name && current.size === file.size && current.lastModified === file.lastModified));
    const mergedFiles = [...existingFiles, ...accepted].slice(0, maxFiles);
    const countErrors = existingFiles.length + accepted.length > maxFiles ? [`Toplam en fazla ${maxFiles} dosya yüklenebilir.`] : [];
    setUploadedFiles(mergedFiles);
    setUploadErrors([...sizeErrors, ...typeErrors, ...countErrors]);
    event.target.value = '';
    if (accepted.length && wizardStage < 4) {
      setWizardStage(4);
      window.setTimeout(() => {
        wizardFormRef.current?.scrollIntoView({ behavior: 'smooth', block: isCompactWizard ? 'start' : 'center' });
      }, 80);
    }
  }

  function removeUploadedFile(index) {
    setUploadedFiles((current) => current.filter((_, idx) => idx !== index));
  }

  function updateSetting(key, value) {
    setDraftSettings((current) => ({
      ...current,
      [key]: value,
      ...(key === 'iyzicoEnvironment'
        ? { iyzicoInitializeEndpoint: resolveIyzicoEndpoint(value) }
        : {}),
    }));
  }

  function toggleSupportLanguage(languageCode) {
    const validCodes = new Set(languageOptions.map((item) => item.code));
    if (!validCodes.has(languageCode)) return;

    setDraftSettings((current) => {
      const currentCodes = Array.isArray(current.supportLanguages)
        ? current.supportLanguages.filter((code) => validCodes.has(code))
        : [];
      const nextCodes = currentCodes.includes(languageCode)
        ? currentCodes.filter((code) => code !== languageCode)
        : [...currentCodes, languageCode];
      const normalizedCodes = (nextCodes.length ? nextCodes : [languageOptions[0]?.code || 'tr'])
        .filter(Boolean);

      return {
        ...current,
        supportLanguages: languageOptions
          .map((item) => item.code)
          .filter((code) => normalizedCodes.includes(code)),
      };
    });
  }

  function updateService(serviceId, key, value) {
    setDraftSettings((current) => ({
      ...current,
      services: current.services.map((service) =>
        service.id === serviceId ? { ...service, [key]: key === 'price' ? (value === '' ? null : Number(value)) : value } : service,
      ),
    }));
  }

  function updatePlan(planId, key, value) {
    setDraftSettings((current) => ({
      ...current,
      plans: current.plans.map((plan) =>
        plan.id === planId ? { ...plan, [key]: key === 'basePrice' ? Number(value || 0) : value } : plan,
      ),
    }));
  }

  function updateCampaignRecord(campaignId, patch = {}) {
    setDraftSettings((current) => {
      const nextArchive = (current.campaignPopupArchive || []).map((item) => {
        if (item.id !== campaignId) {
          return patch.isActive ? { ...item, isActive: false } : item;
        }
        return {
          ...item,
          ...patch,
          delaySeconds: patch.delaySeconds != null ? Number(patch.delaySeconds || 0) : item.delaySeconds,
          isActive: patch.isActive == null ? item.isActive : Boolean(patch.isActive),
        };
      });

      const activeId = patch.isActive
        ? campaignId
        : current.campaignPopupActiveId === campaignId
          ? nextArchive.find((item) => item.id !== campaignId && item.isActive && !item.archivedAt)?.id || ''
          : current.campaignPopupActiveId;

      return {
        ...current,
        campaignPopupArchive: nextArchive,
        campaignPopupActiveId: activeId,
        campaignPopupEnabled: current.campaignPopupEnabled ?? true,
      };
    });
  }

  function createCampaignRecord() {
    const id = "campaign-" + Date.now();
    setDraftSettings((current) => {
      const nextCampaign = {
        id,
        title: 'Yeni kampanya',
        badge: 'Yeni',
        subtitle: 'Kampanya açıklaması',
        description: 'Kampanya detaylarını buradan düzenleyin.',
        ctaLabel: 'Detayları Gör',
        ctaHref: '/basvuru',
        imageUrl: '/campaigns/opening-promo.jpg',
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19),
        delaySeconds: 10,
        isActive: false,
        archivedAt: '',
      };

      return {
        ...current,
        campaignPopupArchive: [nextCampaign, ...(current.campaignPopupArchive || [])],
      };
    });
    return id;
  }

  const draftHasChanges = useMemo(() => {
    try {
      return JSON.stringify(normalizeCoreUrls(draftSettings)) !== JSON.stringify(normalizeCoreUrls(settings));
    } catch {
      return true;
    }
  }, [draftSettings, settings]);

  function saveDraftSettings() {
    const savedAt = new Date().toISOString();
    setLastDraftSavedAt(savedAt);
    setAuditLog((current) =>
      recordAuditEntry(current, createAuditEntry('Taslak kaydedildi', {
        source: 'admin-panel',
        changedFields: Object.keys(draftSettings || {}),
      })),
    );
    showLeadToast(locale === 'en' ? 'Draft saved.' : 'Taslak kaydedildi.', 'success');
  }

  function resetDraftSettings() {
    if (draftHasChanges && !window.confirm(locale === 'en'
      ? 'Unsaved changes will be reverted to the published version. Continue?'
      : 'Kaydedilmemiş değişiklikler yayınlanmış sürüme döndürülecek. Devam edilsin mi?')) {
      return;
    }
    setDraftSettings(normalizeCoreUrls(settings));
    setAuditLog((current) =>
      recordAuditEntry(current, createAuditEntry('Taslak yayınlanmış sürüme döndürüldü', { source: 'admin-panel' })),
    );
    showLeadToast(locale === 'en' ? 'Draft restored from live settings.' : 'Taslak yayınlanmış sürümden geri yüklendi.', 'warning');
  }

  function publishDraftSettings() {
    const publishedAt = new Date().toISOString();
    const nextSettings = normalizeCoreUrls(draftSettings);
    setSettings(nextSettings);
    setLastPublishedAt(publishedAt);
    setAuditLog((current) =>
      recordAuditEntry(current, createAuditEntry('Taslak yayına alındı', {
        source: 'admin-panel',
        changedFields: Object.keys(draftSettings || {}),
      })),
    );
    showLeadToast(locale === 'en' ? 'Draft published.' : 'Taslak yayına alındı.', 'success');
  }

  function archiveCampaignRecord(campaignId) {
    updateCampaignRecord(campaignId, { archivedAt: new Date().toISOString().slice(0, 19), isActive: false });
  }

  function restoreCampaignRecord(campaignId) {
    updateCampaignRecord(campaignId, { archivedAt: '', isActive: false });
  }

  function setActiveCampaignRecord(campaignId) {
    updateCampaignRecord(campaignId, { isActive: true, archivedAt: '' });
  }

  function updateLeadForm(key, value) {
    const dependencyPatch = applyAddressDependencyPatch(key);
    setLeadForm((current) => ({
      ...current,
      [key]: value,
      ...dependencyPatch.form,
    }));
    setLeadErrors((current) => ({
      ...current,
      [key]: '',
      ...dependencyPatch.errors,
    }));
  }

  function updateActivityForm(key, value) {
    setActivityForm((current) => {
      if (key === 'mainActivity') {
        const nextMain = activityCatalog.mainActivities.find((item) => item.id === value) || activityCatalog.mainActivities[0];
        return {
          ...current,
          mainActivity: nextMain.id,
          subActivity: nextMain.subActivities[0]?.id || '',
        };
      }
      return { ...current, [key]: value };
    });
  }

  function selectCompanyType(itemId) {
    setSelectedCompanyType(itemId);
    setWizardLeadCustomerId('');
    wizardLeadCustomerIdRef.current = '';
    setWizardStage(2);
    window.setTimeout(() => {
      wizardActivityRef.current?.scrollIntoView({ behavior: 'smooth', block: isCompactWizard ? 'start' : 'center' });
    }, 80);
  }

  function unlockAdmin(nextUnlocked) {
    setAdminUnlocked(Boolean(nextUnlocked));
  }

  useEffect(() => {
    if (currentPath !== '/yonetim') {
      setAdminUnlocked(false);
      return undefined;
    }

    let cancelled = false;
    apiFetch('/api/auth/me')
      .then(({ user }) => {
        if (!cancelled) {
          setAdminUnlocked(user?.role === 'superadmin');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdminUnlocked(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  function evaluateQuizResult(nextAnswers) {
    if (nextAnswers.partners === 'multiple' || nextAnswers.revenue === 'high' || nextAnswers.ecommerce === 'yes') {
      return 'limited';
    }
    if (nextAnswers.revenue === 'medium') {
      return 'limited';
    }
    return 'sole';
  }

  function resetQuiz() {
    setQuizActive(false);
    setQuizStep(0);
    setQuizAnswers({
      partners: '',
      revenue: '',
      ecommerce: '',
    });
    setQuizResult(null);
  }

  function handleQuizAnswer(key, value) {
    setQuizAnswers((current) => {
      const nextAnswers = { ...current, [key]: value };
      const answeredCount = Object.values(nextAnswers).filter(Boolean).length;
      setQuizResult(answeredCount >= 3 ? evaluateQuizResult(nextAnswers) : null);
      setQuizStep((currentStep) => Math.min(currentStep + 1, 3));
      return nextAnswers;
    });
  }

  function confirmActivitySelection() {
    setWizardStage(3);
    window.setTimeout(() => {
      wizardUploadRef.current?.scrollIntoView({ behavior: 'smooth', block: isCompactWizard ? 'start' : 'center' });
    }, 80);
  }

  function resetTurnstileToken(sourceLabel) {
    if (sourceLabel === 'application-page') {
      setApplicationTurnstileToken('');
      setApplicationTurnstileResetVersion((current) => current + 1);
      return;
    }
    setWizardTurnstileToken('');
    setWizardTurnstileResetVersion((current) => current + 1);
  }

  function getTurnstileToken(sourceLabel) {
    return sourceLabel === 'application-page' ? applicationTurnstileToken : wizardTurnstileToken;
  }

  function showLeadToast(message, variant = 'success') {
    if (leadToastTimerRef.current) {
      window.clearTimeout(leadToastTimerRef.current);
      leadToastTimerRef.current = null;
    }
    setLeadToast({
      visible: true,
      message,
      variant,
    });
    leadToastTimerRef.current = window.setTimeout(() => {
      setLeadToast((current) => ({ ...current, visible: false }));
      leadToastTimerRef.current = null;
    }, 3600);
  }

  function getFirstLeadValidationMessage(errors) {
    const errorList = Object.values(errors || {}).filter(Boolean);
    return errorList[0] || (locale === 'en' ? 'Please complete the required fields.' : 'Lütfen zorunlu alanları tamamlayın.');
  }

  function getOrCreateLeadSessionContext() {
    let sessionId = '';
    let visitorId = '';
    try {
      sessionId = window.sessionStorage.getItem('onlinesmmm-visit-session') || '';
      visitorId = window.localStorage.getItem('onlinesmmm-visitor-id') || '';
      if (!sessionId) {
        sessionId = `lead-${applicationId || Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        window.sessionStorage.setItem('onlinesmmm-visit-session', sessionId);
      }
      if (!visitorId) {
        visitorId = `visitor-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        window.localStorage.setItem('onlinesmmm-visitor-id', visitorId);
      }
    } catch {
      const suffix = Math.random().toString(36).slice(2, 10);
      sessionId = sessionId || `lead-${applicationId || Date.now()}-${suffix}`;
      visitorId = visitorId || `visitor-${Date.now()}-${suffix}`;
    }
    return { sessionId, visitorId };
  }

  async function syncLocationCatalogNow() {
    const sourceUrl = String(draftSettings.locationSourceUrl || settings.locationSourceUrl || '').trim();
    if (!sourceUrl) {
      showLeadToast('Adres kaynağı URL gerekli.', 'error');
      return { ok: false };
    }

    try {
      const data = await apiFetch('/api/site-settings/location-sync', {
        method: 'POST',
        body: JSON.stringify({ sourceUrl }),
      });
      const nextMeta = data?.meta || {};
      setLocationCatalog({
        source: data?.catalog?.source || {},
        provinces: Array.isArray(data?.catalog?.provinces) ? data.catalog.provinces : [],
      });
      setLocationCatalogMeta(nextMeta);
      const nextSettingsPatch = {
        locationSourceUrl: sourceUrl,
        locationSourceFormat: nextMeta.format || 'json',
        locationLastSyncAt: nextMeta.syncedAt || nextMeta.updatedAt || new Date().toISOString(),
        locationLastSyncStatus: 'success',
        locationLastSyncError: '',
      };
      setDraftSettings((current) => ({ ...current, ...nextSettingsPatch }));
      setSettings((current) => ({ ...current, ...nextSettingsPatch }));
      showLeadToast('Adres kataloğu başarıyla güncellendi.', 'success');
      return { ok: true };
    } catch (error) {
      const message = String(error?.message || 'Adres kataloğu güncellenemedi.');
      setLocationCatalogError(message);
      setDraftSettings((current) => ({
        ...current,
        locationLastSyncStatus: 'error',
        locationLastSyncError: message,
      }));
      setSettings((current) => ({
        ...current,
        locationLastSyncStatus: 'error',
        locationLastSyncError: message,
      }));
      showLeadToast(message, 'error');
      return { ok: false, error: message };
    }
  }

  async function persistLead(sourceLabel, turnstileToken = '') {
    const leadFormForSubmit = {
      ...leadForm,
      address: composedLeadAddress,
    };
    const errors = validateLeadForm(leadFormForSubmit, locale, {
      requireTcId: true,
      requireAddressDetails: true,
    });
    if (Object.keys(errors).length) {
      setLeadErrors(errors);
      showLeadToast(
        getFirstLeadValidationMessage(errors),
        'error',
      );
      return { ok: false, reason: 'validation', errors };
    }

    setLeadSubmitState('submitting');
    showLeadToast(
      locale === 'en'
        ? 'Saving your request...'
        : 'Başvurunuz kaydediliyor...',
      'info',
    );
    if (!turnstileToken) {
      setLeadSubmitState('idle');
      showLeadToast(
        locale === 'en'
          ? 'Please complete the Turnstile check before continuing.'
          : 'Devam etmeden önce Turnstile doğrulamasını tamamlayın.',
        'error',
      );
      return { ok: false, reason: 'turnstile' };
    }

    const leadEntry = {
      id: `${Date.now()}`,
      applicationId,
      ...leadFormForSubmit,
      companyType: selectedWizard.id,
      companyTypeLabel: selectedWizard.label,
      activity: selectedActivitySummary,
      estimate: wizardEstimate,
      locale,
      source: sourceLabel,
      createdAt: new Date().toLocaleString('tr-TR'),
    };
    setCapturedLeads((current) => [leadEntry, ...current].slice(0, 100));
    setAuditLog((current) =>
      recordAuditEntry(
        current,
        createAuditEntry(`Yeni lead kaydı alındı (${sourceLabel})`, { source: sourceLabel, applicationId }, 'website'),
      ),
    );
    reportLeadSubmitVisit(leadFormForSubmit, locale, sourceLabel);
    try {
      window.localStorage.setItem(leadSourceKey, sourceLabel);
    } catch {
      // Ignore persistence issues.
    }

    let apiSuccess = false;
    let whatsappForwardedTo = [];
    let customerId = leadEntry.id;
    try {
      const formData = new FormData();
      formData.append('sessionId', window.sessionStorage.getItem('onlinesmmm-visit-session') || '');
      formData.append('visitorId', window.localStorage.getItem('onlinesmmm-visitor-id') || '');
      formData.append('applicationId', applicationId);
      formData.append('stage', String(wizardStage));
      formData.append('name', leadFormForSubmit.name);
      formData.append('email', leadFormForSubmit.email);
      formData.append('phone', leadFormForSubmit.phone);
      formData.append('companyName', leadFormForSubmit.companyName);
      formData.append('companyType', selectedWizard.label);
      formData.append('tckn', leadFormForSubmit.tcId);
      formData.append('province', leadFormForSubmit.province);
      formData.append('district', leadFormForSubmit.district);
      formData.append('neighborhood', leadFormForSubmit.neighborhood);
      formData.append('addressDetail', leadFormForSubmit.addressDetail);
      formData.append('address', leadFormForSubmit.address);
      formData.append('activityMain', selectedActivitySummary.mainActivity);
      formData.append('activitySub', selectedActivitySummary.subActivity);
      formData.append('revenueMethod', selectedActivitySummary.revenueMethod);
      formData.append('salesChannel', selectedActivitySummary.salesChannel);
      formData.append('message', composeWizardMessage(sourceLabel));
      formData.append('source', sourceLabel);
      formData.append('turnstileToken', turnstileToken);
      uploadedFiles.forEach((file) => formData.append('documents', file));
      const response = await fetchWithTimeout(`${getApiBase()}/api/public/leads`, {
        method: 'POST',
        body: formData,
      }, 10000);

      if (!response.ok) {
        throw new Error('Lead API returned non-ok');
      }
      const responseData = await response.json();
      customerId = responseData?.customer?.id || leadEntry.id;
      if (customerId) {
        wizardLeadCustomerIdRef.current = customerId;
        setWizardLeadCustomerId(customerId);
      }
      whatsappForwardedTo = Array.isArray(responseData?.whatsappForwardedTo) ? responseData.whatsappForwardedTo : [];
      apiSuccess = true;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Lead persist failed, local fallback used.', error);
      }
    } finally {
      setLeadSubmitState('idle');
      resetTurnstileToken(sourceLabel);
    }

    showLeadToast(
      apiSuccess
        ? locale === 'en'
          ? whatsappForwardedTo.length
            ? 'Your request has been saved and forwarded to the staff team.'
            : 'Your request has been saved.'
          : whatsappForwardedTo.length
            ? 'Başvurunuz kaydedildi ve personel ekibine iletildi.'
            : 'Başvurunuz kaydedildi.'
        : locale === 'en'
          ? 'Lead saved locally. API unavailable.'
          : 'Bağlantı yok, başvuru yerel olarak kaydedildi.',
      apiSuccess ? 'success' : 'warning',
    );

    return {
      ok: true,
      apiSuccess,
      customerId,
      leadEntry,
      whatsappForwardedTo,
    };
  }

  async function saveLeadProgress(step, extra = {}) {
    if (!leadProgressTrackingEnabled) {
      return null;
    }
    try {
      const { sessionId, visitorId } = getOrCreateLeadSessionContext();
      if (!sessionId || !visitorId) return null;

      const payload = {
        sessionId,
        visitorId,
        applicationId,
        step,
        locale,
        source: extra.source || 'wizard',
        selectedCompanyType: selectedWizard.id,
        selectedCompanyTypeLabel: selectedWizard.label,
        stepSummary: extra.stepSummary || '',
        progress: extra.progress || null,
        activity: selectedActivitySummary,
        lead: {
          name: leadForm.name,
          phone: leadForm.phone,
          email: leadForm.email,
          companyName: leadForm.companyName,
          tcId: leadForm.tcId,
          address: composedLeadAddress,
          province: leadForm.province,
          district: leadForm.district,
          neighborhood: leadForm.neighborhood,
          addressDetail: leadForm.addressDetail,
        },
        files: uploadedFiles.map((file) => file.name),
        estimate: wizardEstimate,
        paymentReady: paymentReady && step >= 8,
        deviceType: window.innerWidth <= 640 ? 'mobile' : window.innerWidth <= 1024 ? 'tablet' : 'desktop',
        viewport: { width: window.innerWidth || 0, height: window.innerHeight || 0 },
        screen: { width: window.screen?.width || 0, height: window.screen?.height || 0 },
      };

      const response = await fetchWithTimeout(`${getApiBase()}/api/public/lead-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }, 10000);
      const data = await response.json().catch(() => null);
      const hasCustomerContact = Boolean(
        data?.customer?.email ||
        data?.customer?.phone ||
        (data?.customer?.name && data.customer.name !== 'Taslak başvuru'),
      );
      if (data?.customer?.id && hasCustomerContact) {
        wizardLeadCustomerIdRef.current = data.customer.id;
        setWizardLeadCustomerId(data.customer.id);
      }
      return data;
    } catch {
      // Progress logging must never block the wizard.
      return null;
    }
  }

  async function persistApplicationPackage(sourceLabel = 'application-package') {
    try {
      const { sessionId, visitorId } = getOrCreateLeadSessionContext();
      const formData = new FormData();
      formData.append('sessionId', sessionId || '');
      formData.append('visitorId', visitorId || '');
      formData.append('applicationId', applicationId);
      formData.append('step', '7');
      formData.append('stage', '7');
      formData.append('source', sourceLabel);
      formData.append('name', leadForm.name);
      formData.append('email', leadForm.email);
      formData.append('phone', leadForm.phone);
      formData.append('companyName', leadForm.companyName);
      formData.append('companyTypeId', selectedWizard.id);
      formData.append('companyType', selectedWizard.label);
      formData.append('tckn', leadForm.tcId);
      formData.append('province', leadForm.province);
      formData.append('district', leadForm.district);
      formData.append('neighborhood', leadForm.neighborhood);
      formData.append('addressDetail', leadForm.addressDetail);
      formData.append('address', composedLeadAddress);
      formData.append('activityMain', selectedActivitySummary.mainActivity);
      formData.append('activitySub', selectedActivitySummary.subActivity);
      formData.append('revenueMethod', selectedActivitySummary.revenueMethod);
      formData.append('salesChannel', selectedActivitySummary.salesChannel);
      formData.append('estimate', wizardEstimate);
      formData.append('stepSummary', locale === 'en' ? 'Application package completed' : 'Başvuru paketi tamamlandı');
      uploadedFiles.forEach((file) => formData.append('documents', file));

      const response = await fetchWithTimeout(`${getApiBase()}/api/public/application-package`, {
        method: 'POST',
        body: formData,
      }, 20000);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.customer?.id) {
        throw new Error(data?.message || 'application package failed');
      }
      wizardLeadCustomerIdRef.current = data.customer.id;
      setWizardLeadCustomerId(data.customer.id);
      return { ok: true, apiSuccess: true, customerId: data.customer.id, data };
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Application package persist failed.', error);
      }
      return { ok: false, apiSuccess: false, error };
    }
  }

  async function validateApplicationFlowStep(step) {
    if (step < 5) {
      return true;
    }

    const leadFormForValidation = {
      ...leadForm,
      address: composedLeadAddress,
    };
    const errors = validateLeadForm(leadFormForValidation, locale, getLeadStepValidationOptions(step));
    if (Object.keys(errors).length) {
      setLeadErrors(errors);
      showLeadToast(
        getFirstLeadValidationMessage(errors),
        'error',
      );
      return false;
    }

    setLeadErrors({});
    return true;
  }

  async function startWizardPayment() {
    setPaymentState({ status: 'loading', error: '', message: '' });
    const packageResult = await persistApplicationPackage('wizard-step-7');
    const currentLeadCustomerId = packageResult?.customerId || wizardLeadCustomerId || wizardLeadCustomerIdRef.current;
    let savedLead = currentLeadCustomerId
      ? { ok: true, apiSuccess: true, customerId: currentLeadCustomerId }
      : null;
    if (!savedLead) {
      const progressData = await saveLeadProgress(8, {
        source: 'wizard-payment',
        stepSummary: locale === 'en' ? 'Payment step opened' : 'Ödeme adımı açıldı',
        progress: { currentStep: 7, nextStep: 8, ratio: 8 / 9, label: locale === 'en' ? 'Payment' : 'Ödeme' },
      });
      if (progressData?.customer?.id) {
        savedLead = { ok: true, apiSuccess: true, customerId: progressData.customer.id };
      }
    }
    if (!savedLead) {
      setPaymentState({
        status: 'error',
        error: locale === 'en'
          ? 'Payment could not create an online application record. Please try again.'
          : 'Ödeme için çevrimiçi başvuru kaydı oluşturulamadı. Lütfen tekrar deneyin.',
        message: '',
      });
      return;
    }

    if (!savedLead.apiSuccess || !savedLead.customerId) {
      setPaymentState({
        status: 'error',
        error: locale === 'en'
          ? 'Payment can only start after the application is saved online.'
          : 'Ödeme, başvuru çevrimiçi kaydedildikten sonra başlatılabilir.',
        message: '',
      });
      return;
    }

    const amount = Number(selectedWizardPlan?.discounted || selectedWizardPlan?.basePrice || 0);
    if (!amount) {
      setPaymentState({
        status: 'error',
        error: locale === 'en' ? 'Payment amount could not be determined.' : 'Ödeme tutarı belirlenemedi.',
        message: '',
      });
      return;
    }

    const buildPaymentPayload = (customerId) => ({
      customerId,
      amount,
      currency: 'TRY',
      name: leadForm.name,
      email: leadForm.email,
      phone: leadForm.phone,
      companyName: leadForm.companyName,
      address: composedLeadAddress,
      province: leadForm.province,
      district: leadForm.district,
      neighborhood: leadForm.neighborhood,
      addressDetail: leadForm.addressDetail,
    });
    const initializePayment = (customerId) => fetchWithTimeout(`${getApiBase()}/api/public/iyzico/checkout/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPaymentPayload(customerId)),
    }, 15000);

    try {
      let paymentCustomerId = savedLead.customerId;
      let response = await initializePayment(paymentCustomerId);
      let data = await response.json().catch(() => ({}));

      if (response.status === 404) {
        wizardLeadCustomerIdRef.current = '';
        setWizardLeadCustomerId('');
        const progressData = await saveLeadProgress(8, {
          source: 'wizard-payment-retry',
          stepSummary: locale === 'en' ? 'Payment step opened' : 'Ödeme adımı açıldı',
          progress: { currentStep: 7, nextStep: 8, ratio: 8 / 9, label: locale === 'en' ? 'Payment' : 'Ödeme' },
        });
        const retryCustomerId = progressData?.customer?.id;
        if (retryCustomerId && retryCustomerId !== paymentCustomerId) {
          paymentCustomerId = retryCustomerId;
          response = await initializePayment(paymentCustomerId);
          data = await response.json().catch(() => ({}));
        }
      }

      if (!response.ok || !data?.paymentUrl) {
        throw new Error(data?.message || 'payment init failed');
      }

      setPaymentState({ status: 'redirecting', error: '', message: '' });
      window.location.href = data.paymentUrl;
    } catch (error) {
      setPaymentState({
        status: 'error',
        error: error?.message || (locale === 'en'
          ? 'The secure payment page could not be opened.'
          : 'Güvenli ödeme sayfası açılamadı.'),
        message: '',
      });
    }
  }

  function composeWizardMessage(sourceLabel) {
    return composeLeadMessage({
      locale,
      selectedWizard,
      leadForm: {
        ...leadForm,
        address: composedLeadAddress,
      },
      activitySummary: selectedActivitySummary,
      wizardEstimate,
      sourceLabel,
    });
  }

  async function handleWizardSubmit() {
    const submitted = await persistLead('wizard-form', getTurnstileToken('wizard-form'));
    if (!submitted?.ok) {
      return;
    }

    setWizardLeadCustomerId(submitted.customerId || '');
    wizardLeadCustomerIdRef.current = submitted.customerId || '';
    setWizardStage(5);
    setPaymentModalOpen(false);
    saveLeadProgress(8, {
      source: 'wizard-payment',
      stepSummary: locale === 'en' ? 'Payment step opened' : 'Ödeme adımı açıldı',
      progress: { currentStep: 7, nextStep: 8, ratio: 8 / 9, label: locale === 'en' ? 'Payment' : 'Ödeme' },
    });

    window.setTimeout(() => {
      if (isCompactWizard) {
        wizardNextStepsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        wizardFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      startWizardPayment();
    }, 120);
  }

  const visibleLanguageCodes = settings.supportLanguages.filter((code) => locales[code]);
  const visibleLanguageOptions = languageOptions.filter((item) => visibleLanguageCodes.includes(item.code));
  const navItems = [
    { href: buildLocalizedPath(homeSectionHref('#ana-sayfa'), locale), label: ui.nav.home },
    { 
      label: ui.nav.services || (locale === 'en' ? 'Services' : 'Hizmetlerimiz'),
      dropdown: [
        { href: buildLocalizedPath('/sahis-sirketi', locale), label: locale === 'en' ? 'Sole Proprietorship' : 'Şahıs Şirketi Kuruluşu' },
        { href: buildLocalizedPath('/limited-sirketi', locale), label: locale === 'en' ? 'Limited Company' : 'Limited Şirket Kuruluşu' },
        { href: buildLocalizedPath('/anonim-sirketi', locale), label: locale === 'en' ? 'Joint Stock Company' : 'Anonim Şirket (A.Ş.) Kuruluşu' },
        { href: buildLocalizedPath(homeSectionHref('#services'), locale), label: locale === 'en' ? 'All Services' : 'Tüm Hizmetler' }
      ]
    },
    { href: buildLocalizedPath('/blog', locale), label: locale === 'en' ? 'Blog' : 'Blog' },
    { href: buildLocalizedPath(homeSectionHref('#process'), locale), label: ui.nav.process },
    { href: buildLocalizedPath(homeSectionHref('#plans'), locale), label: ui.nav.plans },
  ];
  const topbarMobileQuickLinks = {
    servicesHref: buildLocalizedPath(homeSectionHref('#services'), locale),
    blogHref: buildLocalizedPath('/blog', locale),
    startHref: applicationPath,
    processHref: buildLocalizedPath(homeSectionHref('#process'), locale),
    plansHref: buildLocalizedPath(homeSectionHref('#plans'), locale),
  };

  const isAdminPage = currentPath === '/yonetim';
  const isPortalPage = currentPath === '/portal' || currentPath === '/yonetim/personel';
  const currentLegalPage = legalPages[currentPath];
  const isPaymentResultPage = currentPath === '/odeme/sonuc';
  const paymentResultSearchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const paymentResultStatus = paymentResultSearchParams.get('status') === 'success'
    ? 'success'
    : paymentResultSearchParams.get('status') === 'failed'
      ? 'failed'
      : paymentResultSearchParams.get('status') || 'failed';
  const paymentResultMessage = paymentResultSearchParams.get('message') || '';
  const paymentResultReference = paymentResultSearchParams.get('paymentId') || paymentResultSearchParams.get('conversationId') || '';
  const paymentResultOrderId = paymentResultSearchParams.get('orderId') || '';

  useEffect(() => {
    const handlePopState = () => {
      const routeState = getRouteState();
      setLocale(routeState.locale);
      setCurrentPath(routeState.path);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const isRestrictedPath =
      currentPath === '/yonetim' ||
      currentPath === '/portal' ||
      currentPath.startsWith('/yonetim/') ||
      currentPath.startsWith('/portal/');

    if (isRestrictedPath) {
      fetch(`${getApiBase()}/api/public/ip-check?t=${Date.now()}`)
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then((data) => {
          if (data && data.isTr === false) {
            navigateTo('/', { locale });
            alert(
              locale === 'en'
                ? 'Access denied: The admin/portal area is only accessible from Turkey.'
                : 'Erişim engellendi: Güvenlik politikaları gereği yönetim/portal alanına yalnızca Türkiye sınırları içerisinden erişebilirsiniz.'
            );
          }
        })
        .catch(() => {
          // Fallback: do not block admin on network issue
        });
    }
  }, [currentPath, locale]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const syncCompactState = () => setIsCompactWizard(media.matches);

    syncCompactState();
    media.addEventListener?.('change', syncCompactState);
    media.addListener?.(syncCompactState);

    return () => {
      media.removeEventListener?.('change', syncCompactState);
      media.removeListener?.(syncCompactState);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash;
      const timer = setTimeout(() => {
        const id = hash.replace(/^#/, '');
        const element = document.getElementById(id);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [currentPath]);

  useEffect(() => {
    const page = legalPages[currentPath];
    const seo = resolveSeoContent({ content, settings, page, brandName, locale });
    const { title, description, keywords } = seo;
    const localizedPath = buildLocalizedPath(currentPath, locale);
    const canonical = getCanonicalUrl(localizedPath, appEnv.canonicalDomain);

    document.title = title;

    const ensureMeta = (selector, attr, value, type = 'name') => {
      let node = document.head.querySelector(selector);
      if (!node) {
        node = document.createElement('meta');
        document.head.appendChild(node);
      }
      node.setAttribute(type, attr);
      node.setAttribute('content', value);
    };

    const ensureLink = (selector, attr, value) => {
      let node = document.head.querySelector(selector);
      if (!node) {
        node = document.createElement('link');
        document.head.appendChild(node);
      }
      node.setAttribute('rel', attr);
      node.setAttribute('href', value);
    };
    const ensureAlternate = (code, href) => {
      let node = document.head.querySelector(`link[rel="alternate"][hreflang="${code}"]`);
      if (!node) {
        node = document.createElement('link');
        document.head.appendChild(node);
      }
      node.setAttribute('rel', 'alternate');
      node.setAttribute('hreflang', code);
      node.setAttribute('href', href);
    };

    ensureMeta('meta[name="description"]', 'description', description);
    ensureMeta('meta[name="keywords"]', 'keywords', keywords);
    ensureMeta('meta[property="og:title"]', 'og:title', title, 'property');
    ensureMeta('meta[property="og:description"]', 'og:description', description, 'property');
    ensureMeta('meta[property="og:type"]', 'og:type', 'website', 'property');
    ensureMeta('meta[property="og:url"]', 'og:url', canonical, 'property');
    ensureMeta('meta[name="twitter:card"]', 'twitter:card', 'summary_large_image');
    ensureMeta('meta[name="twitter:title"]', 'twitter:title', title);
    ensureMeta('meta[name="twitter:description"]', 'twitter:description', description);
    ensureLink('link[rel="canonical"]', 'canonical', canonical);
    visibleLanguageCodes.forEach((code) => {
      const alternatePath = buildLocalizedPath(currentPath, code);
      ensureAlternate(code, `https://${appEnv.canonicalDomain}${alternatePath}`);
    });
    ensureAlternate('x-default', `https://${appEnv.canonicalDomain}${buildLocalizedPath(currentPath, 'tr')}`);

    const schemaId = 'onlinesmmm-jsonld';
    let schemaNode = document.head.querySelector(`#${schemaId}`);
    if (!schemaNode) {
      schemaNode = document.createElement('script');
      schemaNode.type = 'application/ld+json';
      schemaNode.id = schemaId;
      document.head.appendChild(schemaNode);
    }
    const organizationSchema = {
      '@type': 'Organization',
      '@id': `${canonical}#organization`,
      name: seo.brandName,
      legalName: settings.companyLegalName || seo.brandName,
      url: ensureExternalUrl(settings.websiteUrl) || canonical,
      taxID: settings.taxNumber,
      email: settings.contactEmail,
      sameAs: [settings.telegramUrl].map(ensureExternalUrl).filter(Boolean),
      address: (settings.contactAddress || settings.companyAddress)
        ? {
            '@type': 'PostalAddress',
            streetAddress: settings.contactAddress || settings.companyAddress,
            addressCountry: 'TR',
          }
        : undefined,
      contactPoint: [
        {
          '@type': 'ContactPoint',
          telephone: buildTelHref(settings.contactPhone).replace(/^tel:/, ''),
          email: settings.contactEmail,
          contactType: 'customer support',
          availableLanguage: visibleLanguageCodes,
        },
      ],
    };
    const websiteSchema = {
      '@type': 'WebSite',
      '@id': `${canonical}#website`,
      name: seo.brandName,
      url: canonical,
      inLanguage: locale,
      publisher: { '@id': `${canonical}#organization` },
    };
    const serviceSchema = {
      '@type': 'ProfessionalService',
      '@id': `${canonical}#service`,
      name: seo.serviceName,
      description: seo.serviceDescription || description,
      url: canonical,
      provider: { '@id': `${canonical}#organization` },
      areaServed: 'TR',
      serviceType: (content.services || []).map((service) => service.title),
    };
    const faqSchema =
      currentPath === '/'
        ? {
            '@type': 'FAQPage',
            '@id': `${canonical}#faq`,
            mainEntity: (content.faqs || []).slice(0, 12).map((faq) => ({
              '@type': 'Question',
              name: faq.question,
              acceptedAnswer: {
                '@type': 'Answer',
                text: faq.answer,
              },
            })),
          }
        : null;
    schemaNode.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [organizationSchema, websiteSchema, serviceSchema, faqSchema].filter(Boolean),
    });
  }, [
    content.hero,
    content.seo,
    content.faqs,
    content.services,
    currentPath,
    settings.companyAddress,
    settings.companyLegalName,
    settings.contactAddress,
    settings.contactEmail,
    settings.contactPhone,
    settings.seoDescription,
    settings.seoFocusTopic,
    settings.seoKeywords,
    settings.seoTitle,
    settings.taxNumber,
    settings.telegramUrl,
    settings.websiteUrl,
    locale,
    brandName,
    visibleLanguageCodes.join(','),
  ]);

  if (isPortalPage) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <OperationsPortal
          onBackHome={() => navigateTo('/', { locale })}
          onCustomerVisitsChange={setCustomerVisits}
          turnstileSiteKey={turnstileSiteKey}
        />
      </Suspense>
    );
  }

  if (isPaymentResultPage) {
    return (
      <div className="page-shell payment-result-shell">
        {particleField}

        <TopBar
          brand={brandDisplay}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          nav={navItems}
          ctaHref={applicationPath}
          ctaLabel={applicationCtaLabel}
          mobileQuickLinks={topbarMobileQuickLinks}
          languageSwitcher={
            <LanguageSwitcher
              title={ui.languageSelector}
              options={visibleLanguageOptions}
              activeCode={locale}
              onChange={changeLocale}
              compact
            />
          }
        />

        <main className="payment-result-main">
          <PaymentResultPage
            locale={locale}
            status={paymentResultStatus}
            title={paymentResultStatus === 'success'
              ? (locale === 'en' ? 'Payment received' : 'Teşekkürler, ödemeniz alındı')
              : (locale === 'en' ? 'Payment could not be completed' : 'Ödeme tamamlanamadı')}
            message={paymentResultMessage || undefined}
            reference={paymentResultReference}
            orderId={paymentResultOrderId}
            onBackHome={() => navigateTo('/', { locale })}
            onRetry={() => navigateTo('/basvuru', { locale })}
          />
        </main>
      </div>
    );
  }

  if (isAdminPage) {
    return (
      <div className="page-shell admin-page-shell">
        {particleField}
        <header className="admin-page-top">
          <BrandIdentity
            brand={brandDisplay}
            href={buildLocalizedPath('/#ana-sayfa', locale)}
            className="brand"
          />
          <div className="admin-page-actions">
            <a className="cta cta-light" href={buildLocalizedPath('/portal', locale)}>
              Operasyon portalı
            </a>
            <a className="cta cta-light" href={buildLocalizedPath('/#ana-sayfa', locale)}>
              Ana sayfaya dön
            </a>
          </div>
        </header>

        <main className="admin-page-main">
          <Suspense fallback={<RouteLoading />}>
            <AdminPanel
              title={ui.adminTitle}
              copy={ui.adminCopy}
              unlocked={adminUnlocked}
              onUnlock={unlockAdmin}
              turnstileSiteKey={turnstileSiteKey}
              settings={{ ...draftSettings, services: renderedDraftServices, plans: renderedDraftPlans }}
              onSettingChange={updateSetting}
              onServiceChange={updateService}
              onPlanChange={updatePlan}
              onCampaignRecordChange={updateCampaignRecord}
              onCreateCampaignRecord={createCampaignRecord}
              onArchiveCampaignRecord={archiveCampaignRecord}
              onRestoreCampaignRecord={restoreCampaignRecord}
              onSetActiveCampaignRecord={setActiveCampaignRecord}
              onSyncLocations={syncLocationCatalogNow}
              locationCatalogMeta={locationCatalogMeta}
              languageOptions={languageOptions}
              supportLanguages={draftSettings.supportLanguages}
              onToggleSupportLanguage={toggleSupportLanguage}
              activeLanguage={activeLanguage}
              labels={ui}
              onSaveDraft={saveDraftSettings}
              onPublish={publishDraftSettings}
              onResetDraft={resetDraftSettings}
              auditLog={auditLog}
              leadCount={capturedLeads.length}
              leadData={capturedLeads}
              visitData={customerVisits}
              lastDraftSavedAt={lastDraftSavedAt}
              lastPublishedAt={lastPublishedAt}
            />
          </Suspense>
        </main>
      </div>
    );
  }

  const isBlogPage = currentPath === '/blog';
  const isOldRehberLink = currentPath.startsWith('/rehber/');
  const activeBlogSlug = currentPath.startsWith('/blog/')
    ? currentPath.slice(6)
    : isOldRehberLink
      ? currentPath.slice(8)
      : null;
  const activeBlogArticle = activeBlogSlug ? blogArticles.find((a) => a.slug === activeBlogSlug) : null;

  if (isBlogPage) {
    return (
      <div className="page-shell">
        {particleField}

        <TopBar
          brand={brandDisplay}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          nav={navItems}
          ctaHref={applicationPath}
          ctaLabel={applicationCtaLabel}
          mobileQuickLinks={topbarMobileQuickLinks}
          languageSwitcher={
            <LanguageSwitcher
              title={ui.languageSelector}
              options={visibleLanguageOptions}
              activeCode={locale}
              onChange={changeLocale}
              compact
            />
          }
        />

        <main>
          <Suspense fallback={<RouteLoading />}>
            <BlogListingPage
              articles={blogArticles}
              locale={locale}
              ui={ui}
              blogCopy={content.blog}
              onNavigate={(slug) => navigateTo('/blog/' + slug, { locale })}
            />
          </Suspense>
        </main>

        <Footer
          brand={{
            mark: '◎',
            ...brandDisplay,
            copy: content.footer.copy,
          }}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          services={content.footer.services}
          contacts={footerContacts}
          social={footerSocial}
          legalLinks={legalLinks}
          legalNote={ui.legalCopy}
          identity={{
            companyLegalName: settings.companyLegalName,
            companyAddress: settings.companyAddress || settings.contactAddress,
            taxOffice: settings.taxOffice,
            taxNumber: settings.taxNumber,
            tradeRegistryNo: settings.tradeRegistryNo,
            mersisNo: settings.mersisNo,
            sslStatus: settings.sslStatus,
          }}
          workingHours={settings.workingHours}
          labels={ui}
          domains={displayDomains}
          legalDisclaimer={settings.legalDisclaimer}
        />
      </div>
    );
  }

  if (activeBlogArticle) {
    return (
      <div className="page-shell">
        {particleField}

        <TopBar
          brand={brandDisplay}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          nav={navItems}
          ctaHref={applicationPath}
          ctaLabel={applicationCtaLabel}
          mobileQuickLinks={topbarMobileQuickLinks}
          languageSwitcher={
            <LanguageSwitcher
              title={ui.languageSelector}
              options={visibleLanguageOptions}
              activeCode={locale}
              onChange={changeLocale}
              compact
            />
          }
        />

        <main>
          <Suspense fallback={<RouteLoading />}>
            <BlogArticlePage
              article={activeBlogArticle}
              locale={locale}
              ui={ui}
              onBack={() => navigateTo('/blog', { locale })}
              allArticles={blogArticles}
              onNavigate={(slug) => navigateTo('/blog/' + slug, { locale })}
            />
          </Suspense>
        </main>

        <Footer
          brand={{
            mark: '◎',
            ...brandDisplay,
            copy: content.footer.copy,
          }}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          services={content.footer.services}
          contacts={footerContacts}
          social={footerSocial}
          legalLinks={legalLinks}
          legalNote={ui.legalCopy}
          identity={{
            companyLegalName: settings.companyLegalName,
            companyAddress: settings.companyAddress || settings.contactAddress,
            taxOffice: settings.taxOffice,
            taxNumber: settings.taxNumber,
            tradeRegistryNo: settings.tradeRegistryNo,
            mersisNo: settings.mersisNo,
            sslStatus: settings.sslStatus,
          }}
          workingHours={settings.workingHours}
          labels={ui}
          domains={displayDomains}
          legalDisclaimer={settings.legalDisclaimer}
        />
      </div>
    );
  }

  const isSoleLanding = currentPath === '/sahis-sirketi';
  const isLimitedLanding = currentPath === '/limited-sirketi';
  const isAnonLanding = currentPath === '/anonim-sirketi';
  const isApplicationPage = currentPath === '/basvuru';

  if (isApplicationPage) {
    return (
      <div className="page-shell">
        {particleField}
        {customerVisitTrackingEnabled ? <CustomerVisitTracker locale={locale} /> : null}

        <TopBar
          brand={brandDisplay}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          nav={navItems}
          ctaHref={applicationPath}
          ctaLabel={applicationCtaLabel}
          mobileQuickLinks={topbarMobileQuickLinks}
          languageSwitcher={
            <LanguageSwitcher
              title={ui.languageSelector}
              options={visibleLanguageOptions}
              activeCode={locale}
              onChange={changeLocale}
              compact
            />
          }
        />

        <Suspense fallback={<RouteLoading />}>
          <ApplicationFlowPage
            locale={locale}
            wizardCopy={wizardCopy}
            wizardData={wizardData}
            selectedCompanyType={selectedCompanyType}
            selectCompanyType={selectCompanyType}
            activityCatalog={activityCatalog}
            selectedMainActivity={selectedMainActivity}
            activitySummary={selectedActivitySummary}
            activityForm={activityForm}
            updateActivityForm={updateActivityForm}
            uploadedFiles={uploadedFiles}
            uploadErrors={uploadErrors}
            onFileChange={onFileChange}
            removeUploadedFile={removeUploadedFile}
            clearUploadedFiles={() => setUploadedFiles([])}
            fileSummary={fileSummary}
            leadForm={leadForm}
            leadErrors={leadErrors}
            updateLeadForm={updateLeadForm}
            provinceOptions={provinceOptions}
            districtOptions={districtOptions}
            neighborhoodOptions={neighborhoodOptions}
            locationCatalogError={locationCatalogError}
            selectedProvince={selectedProvince}
            selectedDistrict={selectedDistrict}
            leadSubmitState={leadSubmitState}
            submitApplication={async () => persistLead('application-page', getTurnstileToken('application-page'))}
            turnstileSiteKey={turnstileSiteKey}
            applicationId={applicationId}
            applicationTurnstileToken={applicationTurnstileToken}
            applicationTurnstileResetVersion={applicationTurnstileResetVersion}
            onApplicationTurnstileTokenChange={setApplicationTurnstileToken}
            wizardEstimate={wizardEstimate}
            paymentState={paymentState}
            onStartPayment={startWizardPayment}
            onStepAdvance={(snapshot) => saveLeadProgress(snapshot.nextStep || snapshot.step, snapshot)}
            onValidateStep={validateApplicationFlowStep}
          />
        </Suspense>

        <Footer
          brand={{
            mark: '◎',
            ...brandDisplay,
            copy: content.footer.copy,
          }}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          services={content.footer.services}
          contacts={footerContacts}
          social={footerSocial}
          legalLinks={legalLinks}
          legalNote={ui.legalCopy}
          identity={{
            companyLegalName: settings.companyLegalName,
            companyAddress: settings.companyAddress || settings.contactAddress,
            taxOffice: settings.taxOffice,
            taxNumber: settings.taxNumber,
            tradeRegistryNo: settings.tradeRegistryNo,
            mersisNo: settings.mersisNo,
            sslStatus: settings.sslStatus,
          }}
          workingHours={settings.workingHours}
          labels={ui}
          domains={displayDomains}
          legalDisclaimer={settings.legalDisclaimer}
        />
      </div>
    );
  }

  if (isSoleLanding || isLimitedLanding || isAnonLanding) {
    const type = isSoleLanding ? 'sole' : isLimitedLanding ? 'limited' : 'anon';
    return (
      <div className="page-shell">
        {particleField}

        <TopBar
          brand={brandDisplay}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          nav={navItems}
          ctaHref={applicationPath}
          ctaLabel={applicationCtaLabel}
          mobileQuickLinks={topbarMobileQuickLinks}
          languageSwitcher={
            <LanguageSwitcher
              title={ui.languageSelector}
              options={visibleLanguageOptions}
              activeCode={locale}
              onChange={changeLocale}
              compact
            />
          }
        />

        <main>
          <Suspense fallback={<RouteLoading />}>
            <CompanyLandingPage
              type={type}
              locale={locale}
              ui={ui}
              content={content}
              settings={settings}
              onStartWizard={(selectedType) => {
                setSelectedCompanyType(selectedType);
                navigateTo('/', { locale });
                setTimeout(() => {
                  const el = document.getElementById('start');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }, 150);
              }}
            />
          </Suspense>
        </main>

        <Footer
          brand={{
            mark: '◎',
            ...brandDisplay,
            copy: content.footer.copy,
          }}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          services={content.footer.services}
          contacts={footerContacts}
          social={footerSocial}
          legalLinks={legalLinks}
          legalNote={ui.legalCopy}
          identity={{
            companyLegalName: settings.companyLegalName,
            companyAddress: settings.companyAddress || settings.contactAddress,
            taxOffice: settings.taxOffice,
            taxNumber: settings.taxNumber,
            tradeRegistryNo: settings.tradeRegistryNo,
            mersisNo: settings.mersisNo,
            sslStatus: settings.sslStatus,
          }}
          workingHours={settings.workingHours}
          labels={ui}
          domains={displayDomains}
          legalDisclaimer={settings.legalDisclaimer}
        />
      </div>
    );
  }

  if (currentLegalPage) {
    return (
      <div className="page-shell">
        {particleField}

        <TopBar
          brand={brandDisplay}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          nav={navItems}
          ctaHref={applicationPath}
          ctaLabel={applicationCtaLabel}
          mobileQuickLinks={topbarMobileQuickLinks}
          languageSwitcher={
            <LanguageSwitcher
              title={ui.languageSelector}
              options={visibleLanguageOptions}
              activeCode={locale}
              onChange={changeLocale}
              compact
            />
          }
        />

        <main>
          <section className="section legal-page">
            <div className="section-head">
              <div className="pill">Yasal bilgi</div>
              <h1>{currentLegalPage.title}</h1>
              <p>{currentLegalPage.description}</p>
            </div>

            {currentLegalPage.image?.src && (
              <div className="legal-page-hero card lift">
                <div className="legal-page-hero-copy">
                  <div className="pill">Kurumsal hikaye</div>
                  <h2>Şeffaf, güncel ve teknoloji destekli bir çalışma modeli</h2>
                  <p>
                    Son mevzuatları takip eden uzman danışman kadromuz ve GürSoft.com.tr desteği ile sürekli güncellenen
                    yazılım altyapımız sayesinde şirket kurulumundan muhasebe akışına kadar süreçleri kontrollü, hızlı ve
                    hataya kapalı biçimde yönetiyoruz. GürSoft.com.tr’nin SaaS seviyesi Muhasebe / Mali Müşavir Yazılımı
                    entegrasyonu ile muhasebe işlemlerinin otomatik yürütülmesi, aksaklıklara izin vermeyen bir operasyon
                    standardı ve sürekli denetlenen bir çalışma modeli hedeflenmektedir.
                  </p>
                  {Array.isArray(currentLegalPage.highlights) && currentLegalPage.highlights.length > 0 && (
                    <ul className="legal-page-highlights">
                      {currentLegalPage.highlights.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                  {Array.isArray(currentLegalPage.trustBadges) && currentLegalPage.trustBadges.length > 0 && (
                    <div className="legal-page-trust-badges" aria-label="Güven rozetleri">
                      {currentLegalPage.trustBadges.map((badge) => (
                        <div className="legal-page-trust-badge" key={badge.label}>
                          <span className="legal-page-trust-badge-icon" aria-hidden="true">{badge.icon}</span>
                          <span>{badge.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <figure className="legal-page-hero-media">
                  <img src={currentLegalPage.image.src} alt={currentLegalPage.image.alt} loading="eager" />
                </figure>
              </div>
            )}

            <div className="legal-page-grid">
              {currentLegalPage.sections.map((section) => (
                <article className="card legal-page-card lift" key={section.title}>
                  <h2>{section.title}</h2>
                  <p>{section.text}</p>
                </article>
              ))}
            </div>
          </section>
        </main>

        <Footer
          brand={{
            mark: '◎',
            ...brandDisplay,
            copy: content.footer.copy,
          }}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          services={content.footer.services}
          contacts={footerContacts}
          social={footerSocial}
          legalLinks={legalLinks}
          legalNote={ui.legalCopy}
          identity={{
            companyLegalName: settings.companyLegalName,
            companyAddress: settings.companyAddress || settings.contactAddress,
            taxOffice: settings.taxOffice,
            taxNumber: settings.taxNumber,
            tradeRegistryNo: settings.tradeRegistryNo,
            mersisNo: settings.mersisNo,
            sslStatus: settings.sslStatus,
          }}
          workingHours={settings.workingHours}
          labels={ui}
          domains={displayDomains}
          legalDisclaimer={settings.legalDisclaimer}
        />
      </div>
    );
  }

  return (
      <div className="page-shell">
      {particleField}
      {customerVisitTrackingEnabled ? <CustomerVisitTracker locale={locale} /> : null}
      <CampaignPopup
        enabled={Boolean(popupCampaign)}
        campaign={popupCampaign}
        delaySeconds={Number(settings.campaignPopupDelaySeconds ?? popupCampaign?.delaySeconds ?? 10)}
        ctaHref={applicationPath}
      />

        <TopBar
          brand={brandDisplay}
          brandHref={buildLocalizedPath('/#ana-sayfa', locale)}
          nav={navItems}
          ctaHref={applicationPath}
          ctaLabel={applicationCtaLabel}
          mobileQuickLinks={topbarMobileQuickLinks}
          languageSwitcher={
            <LanguageSwitcher
              title={ui.languageSelector}
              options={visibleLanguageOptions}
              activeCode={locale}
              onChange={changeLocale}
              compact
            />
          }
        />


      <main>
        <span id="hero" className="legacy-section-anchor" aria-hidden="true" />
        <section className="hero" id="ana-sayfa">
          <div className="hero-topline">
            <div className="eyebrow">{ui.eyebrow}</div>
          </div>

          <h1>
            {content.hero.top}{' '}
            <span className="hero-accent">
              {heroAccentParts.number && <span className="hero-accent-number">{heroAccentParts.number}</span>}
              {heroAccentParts.number && heroAccentParts.label ? ' ' : ''}
              <span className="hero-accent-label">{heroAccentParts.label}</span>
            </span>
            <span className="hero-line-break" aria-hidden="true" />
            {content.hero.bottom}
          </h1>
          <p className="hero-copy">{localizedHeroCopy}</p>

          <div className="hero-actions">
            <a
              className="cta cta-primary"
              href={applicationPath}
              data-track-source="hero-primary-cta"
              onClick={() => {
                try {
                  window.localStorage.setItem(leadSourceKey, 'hero-application-cta');
                } catch {
                  // Ignore persistence issues.
                }
              }}
            >
              {applicationCtaLabel}
            </a>
            <a className="cta cta-light" href={buildLocalizedPath('#plans', locale)}>
              {localizedSecondaryCta}
            </a>
          </div>

          <div className="stats">
            {content.stats.map((stat) => (
              <div className="stat" key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="logos">
          <p>{ui.partnersLabel || (locale === 'tr' ? 'Kurumsal entegrasyonlar ve altyapılar' : 'Corporate integrations and infrastructure')}</p>
          <div className="partner-logo-marquee" aria-label="Entegre kurumlar">
            <div className="partner-logo-track">
              {[...partnerLogos, ...partnerLogos].map((item, index) => (
                <span className={`partner-logo ${item.logo ? 'has-logo' : ''}`} key={`${item.short}-${index}`}>
                  {item.logo ? (
                    <span className={`partner-logo-image-wrap ${item.logoBackdrop || ''}`} aria-hidden="true">
                      <img className="partner-logo-image" src={item.logo} alt="" loading="lazy" />
                    </span>
                  ) : (
                    <span className={`partner-logo-emblem ${item.tone}`} aria-hidden="true">
                      {item.short}
                    </span>
                  )}
                  <span className="partner-logo-copy">
                    <strong>{item.name}</strong>
                    <small>{item.label}</small>
                  </span>
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* INTERACTIVE TAX SAVINGS CALCULATOR */}
        {locale === 'tr' && (
          <section className="section tax-calc-section" id="tax-calculator">
            <div className="section-head">
              <div className="pill">Mali Planlama</div>
              <h2>Vergi Tasarrufu Hesaplayıcı</h2>
              <p>Tahmini aylık gelir ve giderlerinizi girerek, şahıs şirketi ile limited şirket arasındaki vergi yükü farkını anında hesaplayın.</p>
            </div>

            <div className="tax-calc-grid">
              <div className="tax-calc-inputs card lift">
                <h3>Gelir & Gider Parametreleri</h3>
                <p className="input-hint">Sürgüleri kaydırarak hesaplama yapabilirsiniz.</p>

                <div className="calc-slider-group">
                  <div className="slider-label-row">
                    <span>Aylık Tahmini Brüt Gelir</span>
                    <strong className="slider-value-badge">
                      {Number(calcMonthlyIncome).toLocaleString('tr-TR')} ₺
                    </strong>
                  </div>
                  <input
                    type="range"
                    min="10000"
                    max="500000"
                    step="5000"
                    value={calcMonthlyIncome}
                    onChange={(e) => setCalcMonthlyIncome(Number(e.target.value))}
                    className="calc-range-slider"
                  />
                  <div className="slider-limits">
                    <span>10K ₺</span>
                    <span>500K ₺</span>
                  </div>
                </div>

                <div className="calc-slider-group">
                  <div className="slider-label-row">
                    <span>Aylık Tahmini Gider (Maliyetler)</span>
                    <strong className="slider-value-badge warning">
                      {Number(calcMonthlyExpense).toLocaleString('tr-TR')} ₺
                    </strong>
                  </div>
                  <input
                    type="range"
                    min="5000"
                    max="300000"
                    step="5000"
                    value={calcMonthlyExpense}
                    onChange={(e) => setCalcMonthlyExpense(Number(e.target.value))}
                    className="calc-range-slider"
                  />
                  <div className="slider-limits">
                    <span>5K ₺</span>
                    <span>300K ₺</span>
                  </div>
                </div>

                <div className="tax-summary-profit-card">
                  <div className="profit-card-row">
                    <span>Aylık Net Kar:</span>
                    <strong>{taxSavingsResults.monthlyNetProfit.toLocaleString('tr-TR')} ₺</strong>
                  </div>
                  <div className="profit-card-row secondary">
                    <span>Yıllık Net Kar:</span>
                    <span>{taxSavingsResults.yearlyNetProfit.toLocaleString('tr-TR')} ₺</span>
                  </div>
                </div>
              </div>

              <div className="tax-calc-results card lift">
                <h3>Yıllık Karşılaştırmalı Vergi Yükü</h3>
                
                <div className="comparison-bars">
                  <div className="comparison-bar-row">
                    <div className="bar-label-row">
                      <span>Şahıs Şirketi (Artan Oranlı Gelir Vergisi)</span>
                      <strong>{taxSavingsResults.soleTax.toLocaleString('tr-TR')} ₺</strong>
                    </div>
                    <div className="bar-track">
                      <div 
                        className="bar-fill sole-fill" 
                        style={{ width: `${Math.min(100, Math.max(12, (taxSavingsResults.soleTax / Math.max(1, taxSavingsResults.soleTax + taxSavingsResults.limitedTax) * 100)))}%` }}
                      />
                    </div>
                  </div>

                  <div className="comparison-bar-row">
                    <div className="bar-label-row">
                      <span>Limited Şirket (Sabit Kurumlar Vergisi)</span>
                      <strong>{taxSavingsResults.limitedTax.toLocaleString('tr-TR')} ₺</strong>
                    </div>
                    <div className="bar-track">
                      <div 
                        className="bar-fill ltd-fill" 
                        style={{ width: `${Math.min(100, Math.max(12, (taxSavingsResults.limitedTax / Math.max(1, taxSavingsResults.soleTax + taxSavingsResults.limitedTax) * 100)))}%` }}
                      />
                    </div>
                  </div>
                </div>

                {taxSavingsResults.yearlySavings > 0 ? (
                  <div className="savings-alert-box animate-pulse">
                    <div className="savings-badge">💰 Yıllık Tasarruf Potansiyeli</div>
                    <div className="savings-amount">
                      {taxSavingsResults.yearlySavings.toLocaleString('tr-TR')} ₺
                    </div>
                    <p>
                      Limited Şirket kurarak yılda yaklaşık <strong>{taxSavingsResults.yearlySavings.toLocaleString('tr-TR')} ₺</strong> daha az vergi ödeyebilirsiniz.
                    </p>
                  </div>
                ) : (
                  <div className="savings-alert-box neutral">
                    <div className="savings-badge">ℹ️ Şahıs Şirketi Avantajı</div>
                    <p>
                      Bu ciro düzeyinde <strong>Şahıs Şirketi</strong> kurmak, limited şirket sabit giderlerine kıyasla vergi yönünden de daha ekonomiktir.
                    </p>
                  </div>
                )}

                <div className="advisor-note-box">
                  <strong>💡 SMMM Danışman Notu:</strong>
                  <p>
                    {taxSavingsResults.recommended === 'limited' 
                      ? 'Yüksek ciro diliminde olduğunuz için düz oranlı (%25) Kurumlar Vergisi ödemek, artan oranlı (%15-%40) Gelir Vergisi ödemekten çok daha avantajlıdır. Limited şirket yapısı sizin için en doğrusudur.'
                      : 'Şahıs şirketi kuruluş hızı ve düşük sabit masraflarıyla bu aşamada sizin için en avantajlı yapıdır. Cirolarınız arttıkça limited şirkete kolayca geçiş yapabilirsiniz.'}
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="section trust-section">
          <div className="section-head">
            <div className="pill">{locale === 'en' ? 'Managed process' : 'Kontrollü süreç'}</div>
            <h2>{locale === 'en' ? 'Manage formation, documents and follow-up in one place' : 'Kuruluş, evrak ve takip tek akışta ilerler'}</h2>
            <p>
              {locale === 'en'
                ? 'This area explains how the operational process works; payment and security badges stay in the footer where users expect them.'
                : 'Bu alan operasyon akışını anlatır; ödeme ve güven rozetleri kullanıcının beklediği gibi footer güven bandında yer alır.'}
            </p>
          </div>

          <div className="trust-compact-grid">
            {trustSignals.map((item) => (
              <article className="card trust-compact-card lift" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        {locale === 'tr' && (
          <section className="section quality-section" id="kalite-standartlari">
            <div className="section-head">
              <div className="pill">Kurumsal güvence</div>
              <h2>Kalite Standartlarımız</h2>
              <p>
                Şirket kuruluşu, evrak takibi, muhasebe ve müşteri iletişimi süreçlerini ölçülebilir kontrol adımlarıyla yönetiyoruz.
              </p>
            </div>

            <div className="quality-grid">
              {qualityStandards.map((standard, index) => (
                <article className="card quality-card lift" key={standard.title}>
                  <div className="quality-card-head">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <h3>{standard.title}</h3>
                  </div>
                  <ul>
                    {standard.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="section wizard-section" id="start">
          <div className="section-head">
            <div className="pill">{wizardCopy.pill}</div>
            <h2>{wizardCopy.title}</h2>
            <p>{wizardCopy.copy}</p>
          </div>
          <div className="wizard-flow" aria-label={locale === 'en' ? 'Start wizard steps' : 'Başlangıç sihirbazı aşamaları'}>
            {wizardFlowSteps.map((step, index) => (
              <div className={`wizard-flow-step ${step.state}`} key={step.number}>
                <span className="wizard-flow-num">{step.number}</span>
                {step.label && <strong>{step.label}</strong>}
                {index < wizardFlowSteps.length - 1 && <span className="wizard-flow-connector" aria-hidden="true" />}
              </div>
            ))}
          </div>
          <div className="wizard-grid">
            {(!isCompactWizard || wizardStage === 1) && (
            <div className="wizard-choice card lift">
                <div className="wizard-choice-head">
                  <div>
                    <h3>{quizActive ? `Şirket Türü Seçim Analizi` : wizardCopy.companyType}</h3>
                    {quizActive && <p>{`Adım ${quizStep + 1} / 3`}</p>}
                  </div>
                <div className="wizard-payment">
                  {quizActive ? (
                    <button className="quiz-close-btn" type="button" onClick={resetQuiz}>Vazgeç ✕</button>
                  ) : (
                    locale === 'tr' && (
                      <button className="quiz-trigger-btn animate-pulse" type="button" onClick={() => { setQuizActive(true); setQuizStep(0); }}>
                        🔍 Hangisi Bana Uygun?
                      </button>
                    )
                  )}
                </div>
              </div>

              {quizActive ? (
                <div className="interactive-quiz-container">
                  {quizStep === 0 && (
                  <div className="quiz-step-panel">
                      <h4>1. Ortak Yapısı Nasıl Olacak?</h4>
                      <p>Şirketi tek başınıza mı yoksa ortaklarla mı kuracaksınız?</p>
                      <small className="application-step-helper">İlerleme: {quizAnsweredCount}/3 soru</small>
                      <div className="quiz-options-list">
                        <button type="button" className="quiz-opt-btn" onClick={() => handleQuizAnswer('partners', 'single')}>
                          <strong>👤 Tek Başımayım</strong>
                          <span>Şirketin tek sahibi ben olacağım.</span>
                        </button>
                        <button type="button" className="quiz-opt-btn" onClick={() => handleQuizAnswer('partners', 'multiple')}>
                          <strong>👥 Birden Fazla Ortağım Olacak</strong>
                          <span>Girişimi ortaklarla birlikte yöneteceğiz.</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {quizStep === 1 && (
                    <div className="quiz-step-panel">
                      <h4>2. Yıllık Tahmini Ciro Hedefiniz Nedir?</h4>
                      <p>İlk yıl içerisinde elde etmeyi hedeflediğiniz yaklaşık brüt kazanç.</p>
                      <div className="quiz-options-list">
                        <button type="button" className="quiz-opt-btn" onClick={() => handleQuizAnswer('revenue', 'low')}>
                          <strong>💰 1 Milyon ₺'nin Altında</strong>
                          <span>Başlangıç ve test aşamasındayım.</span>
                        </button>
                        <button type="button" className="quiz-opt-btn" onClick={() => handleQuizAnswer('revenue', 'medium')}>
                          <strong>📈 1 Milyon ₺ - 3 Milyon ₺ Arası</strong>
                          <span>Hızlı büyüme ve ölçeklenme hedefliyorum.</span>
                        </button>
                        <button type="button" className="quiz-opt-btn" onClick={() => handleQuizAnswer('revenue', 'high')}>
                          <strong>🏦 3 Milyon ₺ ve Üzeri</strong>
                          <span>Yüksek hacimli ticaret ve faturalandırma yapacağım.</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {quizStep === 2 && (
                    <div className="quiz-step-panel">
                      <h4>3. E-Ticaret ve İhracat Planlıyor musunuz?</h4>
                      <p>Sınır ötesi satış, Trendyol/Amazon entegrasyonları veya döviz geliri var mı?</p>
                      <div className="quiz-options-list">
                        <button type="button" className="quiz-opt-btn" onClick={() => handleQuizAnswer('ecommerce', 'yes')}>
                          <strong>🌐 Evet, E-Ticaret veya Mikro-İhracat</strong>
                          <span>Global pazarlar veya e-ticaret siteleri.</span>
                        </button>
                        <button type="button" className="quiz-opt-btn" onClick={() => handleQuizAnswer('ecommerce', 'no')}>
                          <strong>💼 Hayır, Klasik Hizmet / Yerel Ticaret</strong>
                          <span>Yazılım, danışmanlık, ajans veya fiziki mağaza.</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {quizStep === 3 && (
                    <div className="quiz-step-panel quiz-result-panel">
                      <div className="result-check-icon">🎉</div>
                      <h4>Analiz Tamamlandı!</h4>
                      <p>Verdiğiniz yanıtlara göre size en uygun şirket türü:</p>
                      
                      <div className="recommended-badge-card">
                        <strong>
                          {quizResult === 'limited' ? '⚖️ Limited Şirket (Ltd. Şti.)' : '👤 Şahıs Şirketi'}
                        </strong>
                        <p>
                          {quizResult === 'limited' 
                            ? 'Ortaklık yapısı, e-ticaret hedefleri ve yüksek vergi avantajı nedeniyle sizin için en doğru seçim Limited Şirket kurmaktır.'
                            : 'Düşük sabit maliyetler, hızlı kuruluş avantajı ve solo yönetim yapısı nedeniyle sizin için en doğrusu Şahıs Şirketi kurmaktır.'}
                        </p>
                      </div>

                      <div className="result-actions">
                        <button 
                          type="button" 
                          className="cta cta-dark" 
                          onClick={() => {
                            selectCompanyType(quizResult || 'sole');
                            setQuizActive(false);
                          }}
                        >
                          Öneriyi Seç ve Sihirbazı Başlat
                        </button>
                        <button type="button" className="cta cta-light" onClick={resetQuiz}>
                          Yeniden Test Et
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="wizard-options">
                  {wizardData.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`wizard-option ${selectedCompanyType === item.id ? 'active' : ''}`}
                      onClick={() => selectCompanyType(item.id)}
                    >
                      <span>{item.label}</span>
                      <small>{item.summary}</small>
                    </button>
                  ))}
                </div>
              )}
              
              <div className="wizard-meta-grid">
                <div className="wizard-meta-card wizard-price-card">
                  <div>
                    <span className="wizard-price-label">{locale === 'en' ? 'Campaign price' : 'Kampanyalı fiyat'}</span>
                    <div className="wizard-price-row">
                      {wizardOriginalPrice && <span className="wizard-old-price">{wizardOriginalPrice}</span>}
                      <strong>{wizardEstimate}</strong>
                    </div>
                  </div>
                </div>
              </div>

            </div>
            )}

            {(!isCompactWizard || wizardStage === 2) && (
              <div className="wizard-form wizard-activity-card card lift" ref={wizardActivityRef}>
                <div className="wizard-form-head">
                  <div>
                    <h3>{wizardCopy.activityTitle}</h3>
                    <p>{wizardCopy.activityCopy}</p>
                  </div>
                </div>
                <div className="wizard-activity-grid">
                  <label>
                    {wizardCopy.mainActivity}
                    <select value={activityForm.mainActivity} onChange={(event) => updateActivityForm('mainActivity', event.target.value)}>
                      {activityCatalog.mainActivities.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {wizardCopy.subActivity}
                    <select value={activityForm.subActivity} onChange={(event) => updateActivityForm('subActivity', event.target.value)}>
                      {selectedMainActivity.subActivities.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {wizardCopy.revenueMethod}
                    <select value={activityForm.revenueMethod} onChange={(event) => updateActivityForm('revenueMethod', event.target.value)}>
                      {activityCatalog.revenueMethods.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {wizardCopy.salesChannel}
                    <select value={activityForm.salesChannel} onChange={(event) => updateActivityForm('salesChannel', event.target.value)}>
                      {activityCatalog.salesChannels.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {wizardStage === 2 && (
                  <button type="button" className="cta cta-whatsapp full" onClick={confirmActivitySelection}>
                    {wizardCopy.activityCta}
                  </button>
                )}
              </div>
            )}

            {(!isCompactWizard || wizardStage === 3) && (
            <div className="wizard-form wizard-upload-card card lift">
              <div className="wizard-form-head">
                <div>
                  <h3>{wizardCopy.documentUploadTitle}</h3>
                </div>
              </div>
                <div className="wizard-upload-panel" ref={wizardUploadRef}>
                  <div className="wizard-doc-checklist">
                    <strong>{locale === 'en' ? `Requested documents for ${selectedWizard.label}` : `${selectedWizard.label} için istenen evraklar`}</strong>
                    <div>
                      {(selectedWizard.docs || []).map((documentName) => (
                        <span key={documentName}>✓ {documentName}</span>
                      ))}
                    </div>
                  </div>
                  <label className="wizard-upload-zone">
                    <input
                      type="file"
                      capture={isCompactWizard ? 'environment' : undefined}
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,image/*"
                      onChange={onFileChange}
                    />
                    <strong>{isCompactWizard ? wizardCopy.mobileUploadCopy : wizardCopy.documentUploadCopy}</strong>
                    <span>{isCompactWizard ? 'PDF, JPG, PNG - çoklu seçim desteklenir' : 'PDF, JPG, PNG - çoklu seçim desteklenir'}</span>
                    <em>{fileSummary}</em>
                  </label>
                  {!!uploadErrors.length && (
                    <div className="upload-errors wizard-upload-errors" role="alert">
                      {uploadErrors.map((error) => (
                        <p key={error}>{error}</p>
                      ))}
                    </div>
                  )}
                  {!!uploadedFiles.length && (
                    <div className="wizard-file-list">
                      <div className="upload-file-list-header">
                        <strong>{wizardCopy.selectedFiles}</strong>
                        <button
                          type="button"
                          className="cta cta-ghost small"
                          onClick={() => setUploadedFiles([])}
                        >
                          {wizardCopy.clearFiles}
                        </button>
                      </div>
                      <ul>
                        {uploadedFiles.map((file, index) => (
                          <li key={`${file.name}-${file.size}`} className="upload-file-item">
                            <span>{file.name}</span>
                            <span>{Math.ceil(file.size / 1024)} KB</span>
                            <button
                              type="button"
                              className="cta cta-ghost small"
                              onClick={() => removeUploadedFile(index)}
                            >
                              {wizardCopy.removeFile}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {wizardStage === 3 && (
                    <button
                      type="button"
                      className="cta cta-whatsapp full"
                      onClick={() => {
                        setWizardStage(4);
                        window.setTimeout(() => {
                          wizardFormRef.current?.scrollIntoView({ behavior: 'smooth', block: isCompactWizard ? 'start' : 'center' });
                        }, 80);
                      }}
                    >
                      {locale === 'en' ? 'Continue to information' : 'Bilgilere geç'}
                    </button>
                  )}
                </div>
            </div>
            )}

            {(!isCompactWizard || wizardStage >= 4) && (
            <div className="wizard-form wizard-info-card card lift" ref={wizardFormRef}>
              <div className="wizard-form-head">
                <div>
                  <h3>{locale === 'en' ? 'Information' : 'Bilgiler'}</h3>
                </div>
              </div>
                <>
                  <div className="wizard-form-grid">
                    <div className="wizard-inline-duo wizard-inline-duo--full">
                      <label className={leadErrors.name ? 'has-error' : ''}>
                        {wizardCopy.name}
                        <input value={leadForm.name} onChange={(event) => updateLeadForm('name', event.target.value)} />
                        {leadErrors.name && <span className="field-warning">{leadErrors.name}</span>}
                      </label>
                      <label className={leadErrors.phone ? 'has-error' : ''}>
                        {wizardCopy.phone}
                        <input
                          value={leadForm.phone}
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="Telefon numarası"
                          onChange={(event) => updateLeadForm('phone', normalizeTurkishPhoneInput(event.target.value))}
                          onBlur={(event) => updateLeadForm('phone', normalizeTurkishPhoneInput(event.target.value))}
                        />
                        {leadErrors.phone && <span className="field-warning">{leadErrors.phone}</span>}
                      </label>
                    </div>
                    <label className={leadErrors.email ? 'has-error' : ''}>
                      {wizardCopy.email}
                      <input
                        value={leadForm.email}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="ornek@gmail.com"
                        onChange={(event) => updateLeadForm('email', normalizeEmailTyping(event.target.value))}
                      />
                      {leadErrors.email && <span className="field-warning">{leadErrors.email}</span>}
                    </label>
                    <label className={leadErrors.tcId ? 'has-error' : ''}>
                      {locale === 'en' ? 'T.C. Identity Number' : 'T.C. Kimlik Numarası'}
                      <input
                        value={leadForm.tcId}
                        maxLength={11}
                        onChange={(event) => updateLeadForm('tcId', event.target.value.replace(/\D/g, ''))}
                        placeholder={locale === 'en' ? '11-digit T.C. ID Number' : 'T.C. Kimlik Numaranız'}
                      />
                      {leadErrors.tcId && <span className="field-warning">{leadErrors.tcId}</span>}
                    </label>
                    <label className={leadErrors.companyName ? 'has-error' : ''}>
                      {wizardCopy.companyName}
                      <input value={leadForm.companyName} onChange={(event) => updateLeadForm('companyName', event.target.value)} />
                      {leadErrors.companyName && <span className="field-warning">{leadErrors.companyName}</span>}
                    </label>

                    <div className={`wizard-address-field ${leadErrors.address ? 'has-error' : ''}`}>
                      <span className="wizard-address-head">
                        <strong>{wizardCopy.address}</strong>
                        <span className="address-inline-note">{wizardCopy.addressNote}</span>
                      </span>
                      <div className="wizard-address-grid">
                        <label className={leadErrors.province ? 'has-error' : ''}>
                          {wizardCopy.province}
                          <select
                            className="calculator-select"
                          value={leadForm.province}
                          onChange={(event) => {
                              updateLeadForm('province', event.target.value);
                          }}
                        >
                            <option value="">{locale === 'en' ? 'Select' : 'Seçin'}</option>
                            {provinceOptions.map((item) => (
                              <option key={item.id} value={item.name}>{item.name}</option>
                            ))}
                          </select>
                          {leadErrors.province && <span className="field-warning">{leadErrors.province}</span>}
                        </label>
                        <label className={leadErrors.district ? 'has-error' : ''}>
                          {wizardCopy.district}
                          <select
                            className="calculator-select"
                          value={leadForm.district}
                          onChange={(event) => {
                              updateLeadForm('district', event.target.value);
                          }}
                          disabled={!leadForm.province}
                        >
                            <option value="">{locale === 'en' ? 'Select' : 'Seçin'}</option>
                            {districtOptions.map((item) => (
                              <option key={item.id} value={item.name}>{item.name}</option>
                            ))}
                          </select>
                          {leadErrors.district && <span className="field-warning">{leadErrors.district}</span>}
                        </label>
                        <label className={leadErrors.neighborhood ? 'has-error' : ''}>
                          {wizardCopy.neighborhood}
                          <select
                            className="calculator-select"
                            value={leadForm.neighborhood}
                            onChange={(event) => updateLeadForm('neighborhood', event.target.value)}
                            disabled={!leadForm.district}
                          >
                            <option value="">{locale === 'en' ? 'Select' : 'Seçin'}</option>
                            {neighborhoodOptions.map((item) => (
                              <option key={item.id} value={item.name}>{item.name}</option>
                            ))}
                          </select>
                          {leadErrors.neighborhood && <span className="field-warning">{leadErrors.neighborhood}</span>}
                        </label>
                      </div>
                      <input
                        value={leadForm.addressDetail}
                        onChange={(event) => updateLeadForm('addressDetail', event.target.value)}
                        placeholder={wizardCopy.addressDetail}
                      />
                      {(leadErrors.address || leadErrors.addressDetail) && (
                        <span className="field-warning">{leadErrors.addressDetail || leadErrors.address}</span>
                      )}
                    </div>
                  </div>
                  {Object.values(leadErrors).some(Boolean) && (
                    <div className="wizard-error-summary" role="alert" aria-live="polite">
                      <div className="wizard-error-summary-head">
                        <span className="wizard-error-summary-icon" aria-hidden="true">!</span>
                        <div>
                          <strong>Kontrol gerekli</strong>
                          <p>İlerlemeden önce aşağıdaki eksikler tamamlanmalı.</p>
                        </div>
                      </div>
                      <ul className="wizard-error-summary-list">
                        {Object.entries(leadErrors).filter(([, message]) => Boolean(message)).map(([key, message]) => (
                          <li key={key}>{message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(!isCompactWizard || wizardStage < 5) && (
                    <>
                      <button
                        type="button"
                        className="cta cta-whatsapp full"
                        onClick={handleWizardSubmit}
                        disabled={leadSubmitState === 'submitting'}
                      >
                        {leadSubmitState === 'submitting'
                          ? locale === 'en'
                            ? 'Sending...'
                            : 'Gönderiliyor...'
                          : wizardCopy.cta}
                      </button>
                      <TurnstileWidget
                        siteKey={turnstileSiteKey}
                        action="turnstile-spin-v1"
                        label={locale === 'en' ? 'Turnstile verification' : 'Turnstile doğrulaması'}
                        onTokenChange={setWizardTurnstileToken}
                        resetVersion={wizardTurnstileResetVersion}
                      />
                    </>
                  )}
                </>
              {isCompactWizard && wizardStage >= 5 && (
                <div className="wizard-next-steps" ref={wizardNextStepsRef}>
                  <div className={`wizard-next-step-card ${wizardStage >= 4 ? 'active' : ''}`}>
                    <span>4</span>
                    <strong>{locale === 'en' ? 'Saved' : 'Kayıt alındı'}</strong>
                    <p>{locale === 'en' ? 'Your submission is saved.' : 'Başvurunuz kaydedildi.'}</p>
                  </div>
                  <div className={`wizard-next-step-card ${wizardStage >= 5 ? 'active' : 'pending'}`}>
                    <span>5</span>
                    <strong>{wizardCopy.paymentTitle}</strong>
                    <p>{locale === 'en' ? 'Payment screen is ready.' : 'Ödeme ekranı hazır.'}</p>
                  </div>
                </div>
              )}
              {wizardStage >= 5 && (
                <div className="wizard-payment-step" ref={wizardNextStepsRef}>
                  <ApplicationPaymentPanel
                    isEnglish={locale === 'en'}
                    paymentState={paymentState}
                    activeWizard={selectedWizard}
                    wizardEstimate={wizardEstimate}
                    applicationId={applicationId}
                    uploadedFiles={uploadedFiles}
                    nextSteps={wizardPaymentNextSteps}
                  />
                  {paymentState?.status === 'error' && (
                    <button
                      type="button"
                      className="cta cta-whatsapp full"
                      onClick={startWizardPayment}
                    >
                      {locale === 'en' ? 'Restart secure payment' : 'Ödemeyi tekrar başlat'}
                    </button>
                  )}
                </div>
              )}
            </div>
            )}
          </div>
        </section>

        <section className="section" id="services">
          <div className="section-head">
            <div className="pill">{ui.servicesPill}</div>
            <h2>{ui.servicesSection}</h2>
            <p>{ui.servicesCopy}</p>
          </div>
          <div className="service-grid">
            {renderedServices.map((service) => (
              <a
                className="card service-card service-card-link lift"
                key={service.id}
                href={buildServiceInquiryHref(service)}
                target="_blank"
                rel="noreferrer"
                aria-label={`${service.title} için WhatsApp ile iletişime geç`}
              >
                <div className="card-badge">{service.badge}</div>
                <h3>{service.title}</h3>
                <p>{service.text}</p>
                <ul>
                  {service.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <div className="price-stack">
                  {service.original != null && (
                    <span className="old-price">
                      {ui.oldPriceLabel}: {renderFallbackPrice(service.original, locale, priceLabels.free)}
                    </span>
                  )}
                  {service.priceLabel ? (
                    <div className="price-line">{service.priceLabel}</div>
                  ) : service.discounted != null ? (
                    <div className="new-price">
                      <strong>{renderFallbackPrice(service.discounted, locale, priceLabels.free)}</strong>
                      <span>{discountLabel}</span>
                    </div>
                  ) : (
                    <div className="price-line">{priceLabels.quote}</div>
                  )}
                </div>
              </a>
            ))}
          </div>
        </section>

        <section className="section section-split">
          <div className="section-head left">
            <div className="pill">{ui.benefitsPill}</div>
            <h2>{ui.benefitsSection}</h2>
            <p>{ui.benefitsCopy}</p>
          </div>
          <div className="benefit-grid">
            {content.benefits.map((item) => (
              <article className="card benefit-card lift" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section" id="process">
          <div className="section-head">
            <div className="pill">{ui.processPill}</div>
            <h2>{ui.processSection}</h2>
            <p>{ui.processCopy}</p>
          </div>
          <div className="steps">
            {content.steps.map((step) => (
              <article className={`card step-card lift ${step.highlight ? 'highlight' : ''}`} key={step.index}>
                <span className="step-index">{step.index}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="section" id="plans">
          {locale !== 'tr' && (
            <div className="foreign-investor-incentive-badge" style={{ marginBottom: '24px' }}>
              ✈️ <strong>Foreign Investor Privilege:</strong> 100% corporate ownership, full repatriation of capital, and 0% VAT on service exports from Turkey!
            </div>
          )}
          <div className="section-head">
            <div className="pill">{ui.pricingPill}</div>
            <h2>{ui.pricingSection}</h2>
            <p>{ui.pricingCopy}</p>
          </div>
          <div className="card pricing-summary lift pricing-breakdown">
            <div className="pricing-summary-head">
              <div>
                <div className="pill">{locale === 'en' ? 'Pricing clarity' : 'Fiyat netliği'}</div>
                <h3>{locale === 'en' ? 'Official fees and service fee are shown separately' : 'Resmi harç ve hizmet bedeli ayrı gösterilir'}</h3>
              </div>
              <p>{locale === 'en' ? 'No hidden line items, no ambiguity at checkout.' : 'Fiyatlandırma net, şeffaf ve anlaşılır.'}</p>
            </div>
            <div className="pricing-summary-grid">
              {feeBreakdown.map((item) => (
                <div className="pricing-summary-row" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            <div className="pricing-summary-row highlight">
              <span>{locale === 'en' ? 'Disclosure' : 'Bilgilendirme'}</span>
              <strong>{locale === 'en' ? 'Official + service split' : 'Resmi + hizmet ayrımı'}</strong>
            </div>
          </div>
          </div>
          <div className="pricing-grid">
            {renderedPlans.map((plan) => (
              <article className={`card pricing-card lift ${plan.featured ? 'featured' : ''}`} key={plan.id}>
                <div className="pricing-top">
                  <div className="pricing-top-copy">
                    <strong>{plan.label || ui.popularLabel || (locale === 'en' ? 'Popular' : 'Popüler')}</strong>
                    {plan.featured ? <span className="pricing-featured-badge">{plan.featuredLabel || ui.popularLabel || (locale === 'en' ? 'Featured' : 'Öne çıkan')}</span> : null}
                  </div>
                </div>
                <h3>{plan.name}</h3>
                <div className="plan-price-wrap">
                  <div className="plan-price-topline">
                    <div className="old-price large">
                      {ui.oldPriceLabel}: {renderFallbackPrice(plan.original, locale, priceLabels.free)}
                    </div>
                    {plan.priceNote ? <span className="price-note-inline">{plan.priceNote}</span> : null}
                  </div>
                  <div className="new-price large">
                    <span className="new-price-label">{locale === 'en' ? 'Discounted price' : 'İndirimli fiyat'}</span>
                    <strong>{renderFallbackPrice(plan.discounted, locale, priceLabels.free)}</strong>
                    <span>{discountLabel}</span>
                  </div>
                </div>
                <ul>
                  {plan.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="pricing-actions">
                  {settings.paymentCheckoutUrl ? (
                    <a
                      className="cta cta-dark full payment-cta"
                      href={settings.paymentCheckoutUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img src="/iyzico/iyzico-pay.svg" alt="" aria-hidden="true" />
                      <span>{ui.paymentButtonLabel || 'iyzico ile öde'}</span>
                    </a>
                  ) : null}
                  <a
                        className={`cta ${settings.paymentCheckoutUrl ? 'cta-light' : 'cta-whatsapp'} full`}
                        href={whatsappHref}
                        data-track-source={`pricing-${plan.id}`}
                        onClick={() => {
                      try {
                        window.localStorage.setItem(leadSourceKey, `pricing-${plan.id}`);
                      } catch {
                        // Ignore persistence issues.
                      }
                    }}
                  >
                    {ui.applyLabel}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="section testimonials-section">
          <div className="section-head">
            <div className="pill">{ui.testimonialsPill}</div>
            <h2>{ui.testimonialsSection}</h2>
          </div>
          <Suspense fallback={<RouteLoading />}>
            <TestimonialsCarousel
              list={content.testimonials.length >= 33 ? content.testimonials : internationalTestimonials}
              locale={locale}
            />
          </Suspense>
        </section>

        <section className="section faq-section">
          <div className="section-head left">
            <div className="pill">{ui.faqPill}</div>
            <h2>{ui.faqSection}</h2>
            <p>{faqCopy}</p>

            {/* Interactive FAQ Search Bar */}
            {locale === 'tr' && (
              <div className="faq-search-wrapper">
                <input
                  type="text"
                  placeholder="Sorularda arayın... (ör. sermaye, vergi, fatura)"
                  value={faqSearchQuery}
                  onChange={(e) => setFaqSearchQuery(e.target.value)}
                  className="faq-search-input"
                />
                {faqSearchQuery && (
                  <button type="button" className="faq-search-clear" onClick={() => setFaqSearchQuery('')}>
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="faq-content-area">
            {/* Dynamic Filter Tabs */}
            {locale === 'tr' && (
              <div className="faq-tabs">
                <button
                  type="button"
                  className={`faq-tab-btn ${faqActiveTab === 'all' ? 'active' : ''}`}
                  onClick={() => { setFaqActiveTab('all'); setActiveFaq(-1); }}
                >
                  Tümü
                </button>
                <button
                  type="button"
                  className={`faq-tab-btn ${faqActiveTab === 'formation' ? 'active' : ''}`}
                  onClick={() => { setFaqActiveTab('formation'); setActiveFaq(-1); }}
                >
                  🏢 Şirket Kuruluşu
                </button>
                <button
                  type="button"
                  className={`faq-tab-btn ${faqActiveTab === 'tax' ? 'active' : ''}`}
                  onClick={() => { setFaqActiveTab('tax'); setActiveFaq(-1); }}
                >
                  ⚡ Vergi & Stopaj
                </button>
                <button
                  type="button"
                  className={`faq-tab-btn ${faqActiveTab === 'incentives' ? 'active' : ''}`}
                  onClick={() => { setFaqActiveTab('incentives'); setActiveFaq(-1); }}
                >
                  🎁 Girişimci Teşvikleri
                </button>
                <button
                  type="button"
                  className={`faq-tab-btn ${faqActiveTab === 'accounting' ? 'active' : ''}`}
                  onClick={() => { setFaqActiveTab('accounting'); setActiveFaq(-1); }}
                >
                  📚 Mali Müşavirlik
                </button>
              </div>
            )}

            <div className="faq-list">
              {filteredFaqs.length > 0 ? (
                filteredFaqs.map((faq, index) => {
                  const open = activeFaq === index;
                  return (
                    <div className={`faq-item ${open ? 'open' : ''}`} key={faq.question}>
                      <button type="button" onClick={() => setActiveFaq(open ? -1 : index)}>
                        <span>{faq.question}</span>
                        <span className={`faq-chevron-icon ${open ? 'rotate' : ''}`}>
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </span>
                      </button>
                      <div className={`faq-collapse-panel ${open ? 'expanded' : ''}`}>
                        <div className="faq-answer-inner">
                          <p>{faq.answer}</p>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="faq-empty-state">
                  <span className="faq-empty-icon">🔍</span>
                  <p>Aramanıza uygun soru bulunamadı. Lütfen başka kelimelerle deneyin veya doğrudan bize sorun.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="section cta-section" id="contact">
          <div className="cta-panel lift">
            <div>
              <div className="pill">{ui.ctaPill}</div>
              <h2>{ui.ctaSection}</h2>
              <p>{ui.ctaCopy}</p>
            </div>
            <div className="cta-links">
              <a
                className="cta cta-whatsapp"
                href={whatsappHref}
                data-track-source="contact-section-whatsapp"
              >
                {ui.contactActions?.whatsapp || 'WhatsApp'}
              </a>
            </div>
          </div>
        </section>

        {cookieConsent.status === 'unknown' && (
          <section className="cookie-section" aria-label={ui.cookieTitle || 'Çerez yönetimi'}>
            <div className="cookie-banner">
              <div className="cookie-banner-text">
                <h3>🍪 {ui.cookieTitle || 'Çerez Yönetimi'}</h3>
                <p>{ui.cookieCopy || 'Deneyimi geliştirmek için temel çerezleri kullanıyoruz. Siteyi kullanmaya devam ederek çerez politikasını kabul etmiş sayılırsınız.'}</p>
                {cookiePreferencesOpen && (
                  <div className="cookie-preferences">
                    <label className="cookie-toggle">
                      <span>{ui.cookieNecessaryLabel || 'Zorunlu çerezler (her zaman aktif)'}</span>
                      <input type="checkbox" checked disabled />
                    </label>
                    <label className="cookie-toggle">
                      <span>{ui.cookieAnalyticsLabel || 'Analitik çerezler'}</span>
                      <input
                        type="checkbox"
                        checked={cookieConsent.preferences.analytics}
                        onChange={(event) =>
                          setCookieConsent((current) => ({
                            ...current,
                            preferences: { ...current.preferences, analytics: event.target.checked },
                          }))
                        }
                      />
                    </label>
                    <label className="cookie-toggle">
                      <span>{ui.cookieMarketingLabel || 'Pazarlama çerezleri'}</span>
                      <input
                        type="checkbox"
                        checked={cookieConsent.preferences.marketing}
                        onChange={(event) =>
                          setCookieConsent((current) => ({
                            ...current,
                            preferences: { ...current.preferences, marketing: event.target.checked },
                          }))
                        }
                      />
                    </label>
                  </div>
                )}
              </div>
              <div className="cookie-actions">
                <div className="cookie-actions-secondary">
                  <a className="cta cta-ghost-light" href={buildLocalizedPath('/cerez-politikasi', locale)}>
                    {ui.cookiesLabel || 'Politika'}
                  </a>
                  <button className="cta cta-ghost-light" type="button" onClick={toggleCookiePreferences}>
                    {cookiePreferencesOpen ? (ui.cookieClose || 'Kapat') : (ui.cookieSettings || 'Tercihler')}
                  </button>
                </div>
                <div className="cookie-actions-primary">
                  {cookiePreferencesOpen && (
                    <button className="cta cta-ghost-light" type="button" onClick={() => saveCookiePreferences(cookieConsent.preferences)}>
                      {ui.cookieSave || 'Kaydet'}
                    </button>
                  )}
                  <button className="cta cta-ghost-light" type="button" onClick={rejectCookies}>
                    {ui.cookieReject || 'Reddet'}
                  </button>
                  <button className="cta cta-whatsapp" type="button" onClick={acceptCookies}>
                    {ui.cookieAccept || 'Kabul et'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}


        {paymentModalOpen && createPortal(
          <div className="wizard-payment-modal" role="dialog" aria-modal="true" aria-labelledby="wizard-payment-title">
            <div className="wizard-payment-backdrop" onClick={() => setPaymentModalOpen(false)} />
            <div className="wizard-payment-dialog">
              <button
                type="button"
                className="wizard-payment-close"
                onClick={() => setPaymentModalOpen(false)}
                aria-label={locale === 'en' ? 'Close payment screen' : 'Ödeme ekranını kapat'}
              >
                ×
              </button>
              <div className="wizard-payment-dialog-head">
                <span>5</span>
                <div>
                  <h3 id="wizard-payment-title">{wizardCopy.paymentTitle}</h3>
                  <p>{wizardCopy.paymentCopy}</p>
                </div>
              </div>
              <div className="wizard-payment-summary">
                <div>
                  <span>{wizardCopy.companyType}</span>
                  <strong>{selectedWizard.label}</strong>
                </div>
                <div>
                  <span>{wizardCopy.mainActivity}</span>
                  <strong>{selectedActivitySummary.mainActivity}</strong>
                </div>
                <div>
                  <span>{locale === 'en' ? 'Amount' : 'Tutar'}</span>
                  <strong>{wizardEstimate}</strong>
                </div>
              </div>
              {settings.paymentCheckoutUrl ? (
                <a className="cta cta-whatsapp full" href={settings.paymentCheckoutUrl} target="_blank" rel="noreferrer">
                  {wizardCopy.paymentOpen}
                </a>
              ) : (
                <button type="button" className="cta cta-light full" disabled>
                  {locale === 'en' ? 'Payment link is being prepared' : 'Ödeme bağlantısı hazırlanıyor'}
                </button>
              )}
              <button type="button" className="cta cta-ghost full" onClick={() => setPaymentModalOpen(false)}>
                {wizardCopy.paymentLater}
              </button>
            </div>
          </div>,
          document.body,
        )}
        <ContactBar title={ui.contactBarTitle} copy={ui.contactBarCopy} links={contactLinks} />
        {leadToast.visible && createPortal(
          <div className={`lead-toast ${leadToast.variant}`} role="status" aria-live="polite">
            <div className="lead-toast-icon" aria-hidden="true">
              {leadToast.variant === 'error' ? '!' : leadToast.variant === 'warning' ? 'i' : '✓'}
            </div>
            <div className="lead-toast-copy">
              <strong>{leadToast.variant === 'error' ? (locale === 'en' ? 'Attention' : 'Uyarı') : leadToast.variant === 'warning' ? (locale === 'en' ? 'Notice' : 'Bilgilendirme') : (locale === 'en' ? 'Success' : 'Başarılı')}</strong>
              <p>{leadToast.message}</p>
            </div>
            <button
              type="button"
              className="lead-toast-close"
              onClick={() => setLeadToast((current) => ({ ...current, visible: false }))}
              aria-label={locale === 'en' ? 'Close notification' : 'Bildirimi kapat'}
            >
              ×
            </button>
          </div>,
          document.body,
        )}
      </main>

        <Footer
          brand={{
            ...brandDisplay,
            copy: content.footer.copy,
          }}
          services={content.footer.services}
          contacts={footerContacts}
          social={footerSocial}
          legalLinks={legalLinks}
          legalNote={ui.legalCopy}
          identity={{
            companyLegalName: settings.companyLegalName,
            companyAddress: settings.companyAddress || settings.contactAddress,
            taxOffice: settings.taxOffice,
            taxNumber: settings.taxNumber,
            tradeRegistryNo: settings.tradeRegistryNo,
            mersisNo: settings.mersisNo,
            sslStatus: settings.sslStatus,
          }}
          securitySignals={footerSecuritySignals}
          securityTitle={localizedPaymentTrustTitle}
          securityCopy={localizedPaymentTrustCopy}
          workingHours={settings.workingHours}
          labels={ui}
          domains={displayDomains}
          legalDisclaimer={settings.legalDisclaimer}
        />
    </div>
  );
}

export default App;
