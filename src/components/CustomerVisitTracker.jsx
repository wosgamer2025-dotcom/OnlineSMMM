import { useEffect, useRef } from 'react';
import { getApiBase } from '../lib/api';

const sessionKey = 'onlinesmmm-visit-session';
const visitorKey = 'onlinesmmm-visitor-id';

function createId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readOrCreateStorageValue(storage, key, prefix) {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const next = createId(prefix);
    storage.setItem(key, next);
    return next;
  } catch {
    return createId(prefix);
  }
}

function getDeviceType() {
  const width = window.innerWidth || 0;
  if (width <= 640) return 'mobile';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}

function CustomerVisitTracker({ locale }) {
  const startedAtRef = useRef(Date.now());
  const sessionIdRef = useRef('');
  const visitorIdRef = useRef('');

  useEffect(() => {
    sessionIdRef.current = readOrCreateStorageValue(window.sessionStorage, sessionKey, 'session');
    visitorIdRef.current = readOrCreateStorageValue(window.localStorage, visitorKey, 'visitor');

    const endpoint = `${getApiBase()}/api/public/visit-events`;

    function buildPayload(eventType, extra = {}) {
      const durationSeconds = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
      return {
        sessionId: sessionIdRef.current,
        visitorId: visitorIdRef.current,
        eventType,
        path: `${window.location.pathname}${window.location.hash || ''}`,
        locale,
        referrer: document.referrer,
        source: window.localStorage.getItem('onlinesmmm-lead-source') || '',
        durationSeconds,
        screen: { width: window.screen?.width || 0, height: window.screen?.height || 0 },
        viewport: { width: window.innerWidth || 0, height: window.innerHeight || 0 },
        deviceType: getDeviceType(),
        ...extra,
      };
    }

    function send(eventType, extra = {}, keepalive = false) {
      const payload = buildPayload(eventType, extra);
      const body = JSON.stringify(payload);
      if (keepalive && navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
        return;
      }
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive,
      }).catch(() => {});
    }

    function classifyClick(anchor) {
      const href = anchor.getAttribute('href') || '';
      if (/wa\.me|whatsapp/i.test(href)) return 'whatsapp';
      if (/^tel:/i.test(href)) return 'phone';
      if (/#start|#contact/i.test(href)) return 'form_start';
      if (anchor.classList.contains('cta')) return 'cta';
      return '';
    }

    function handleClick(event) {
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor) return;
      const target = classifyClick(anchor);
      if (!target) return;
      send('click', {
        target,
        label: anchor.textContent?.trim() || anchor.getAttribute('aria-label') || '',
        href: anchor.href || anchor.getAttribute('href') || '',
        source: anchor.dataset.trackSource || '',
      });
    }

    function handlePageHide() {
      send('heartbeat', { target: 'page_exit', label: 'Sayfadan ayrıldı' }, true);
    }

    send('page_view');
    const intervalId = window.setInterval(() => send('heartbeat'), 15000);
    document.addEventListener('click', handleClick, true);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('pagehide', handlePageHide);
      send('heartbeat', { target: 'component_unmount', label: 'Oturum güncellendi' }, true);
    };
  }, [locale]);

  return null;
}

export default CustomerVisitTracker;
