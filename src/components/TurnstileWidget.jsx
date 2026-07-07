import React, { useEffect, useRef, useState } from 'react';

function ensureTurnstileScript() {
  if (typeof window === 'undefined') return;
  if (document.querySelector('script[data-turnstile-api="true"]')) return;
  if ([...document.scripts].some((script) => String(script.src || '').includes('challenges.cloudflare.com/turnstile/v0/api.js'))) return;

  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.defer = true;
  script.dataset.turnstileApi = 'true';
  document.head.appendChild(script);
}

function waitForTurnstile(timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (window.turnstile && typeof window.turnstile.render === 'function') {
        resolve(window.turnstile);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Turnstile script could not be loaded.'));
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

function TurnstileWidget({
  siteKey,
  action = 'turnstile-spin-v1',
  theme = 'auto',
  size = 'normal',
  label = 'Turnstile',
  onTokenChange,
  resetVersion = 0,
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    let retryId;

    async function renderWidget() {
      if (!siteKey || !containerRef.current) {
        return;
      }

      try {
        setStatus('loading');
        ensureTurnstileScript();
        const turnstile = await waitForTurnstile();
        if (cancelled || !containerRef.current) {
          return;
        }

        if (widgetIdRef.current !== null) {
          try {
            turnstile.remove(widgetIdRef.current);
          } catch {
            // Ignore teardown errors.
          }
        }

        onTokenChange?.('');
        setStatus('ready');
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme,
          size,
          callback: (token) => {
            setStatus(token ? 'success' : 'ready');
            onTokenChange?.(token || '');
          },
          'expired-callback': () => {
            setStatus('ready');
            onTokenChange?.('');
          },
          'error-callback': () => {
            setStatus('retrying');
            onTokenChange?.('');
            retryId = window.setTimeout(() => {
              if (!cancelled && window.turnstile && widgetIdRef.current !== null) {
                try {
                  window.turnstile.reset(widgetIdRef.current);
                } catch {
                  renderWidget();
                }
              }
            }, 2000);
          },
        });
      } catch {
        setStatus('retrying');
        onTokenChange?.('');
        retryId = window.setTimeout(() => {
          if (!cancelled) renderWidget();
        }, 3000);
      }
    }

    renderWidget();

    return () => {
      cancelled = true;
      if (retryId) {
        window.clearTimeout(retryId);
      }
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignore teardown errors.
        }
        widgetIdRef.current = null;
      }
    };
  }, [action, onTokenChange, siteKey, size, theme]);

  useEffect(() => {
    if (!resetVersion || widgetIdRef.current === null || !window.turnstile) {
      return;
    }
    try {
      window.turnstile.reset(widgetIdRef.current);
      setStatus('ready');
      onTokenChange?.('');
    } catch {
      setStatus('retrying');
      onTokenChange?.('');
    }
  }, [onTokenChange, resetVersion]);

  if (!siteKey) {
    return null;
  }

  return (
    <div className="turnstile-widget-shell" aria-label={label}>
      <div ref={containerRef} />
      {status !== 'success' && (
        <span className="turnstile-widget-status">
          {status === 'retrying' ? 'Güvenlik doğrulaması yeniden deneniyor...' : 'Güvenlik doğrulaması hazırlanıyor...'}
        </span>
      )}
    </div>
  );
}

export default TurnstileWidget;
