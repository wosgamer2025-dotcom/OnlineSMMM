import React, { useEffect, useMemo, useState } from 'react';

function CampaignPopup({ enabled, campaign, delaySeconds = 10, onClose, ctaHref = '/basvuru' }) {
  const [visible, setVisible] = useState(true);

  const storageKey = useMemo(() => {
    if (!campaign?.id) {
      return '';
    }
    return `campaign-popup-dismissed-${campaign.id}-${campaign.endDate || 'no-end'}`;
  }, [campaign?.endDate, campaign?.id]);

  const isExpired = useMemo(() => {
    if (!campaign?.endDate) {
      return false;
    }
    return Number.isFinite(new Date(campaign.endDate).getTime()) && new Date(campaign.endDate).getTime() <= Date.now();
  }, [campaign?.endDate]);

  useEffect(() => {
    if (!enabled || !campaign?.id || isExpired) {
      setVisible(false);
      return undefined;
    }

    let dismissed = false;
    try {
      dismissed = Boolean(sessionStorage.getItem(storageKey));
    } catch {
      dismissed = false;
    }

    if (dismissed) {
      setVisible(false);
      return undefined;
    }

    setVisible(true);

    return undefined;
  }, [campaign?.id, enabled, isExpired, storageKey]);

  useEffect(() => {
    if (!visible || !campaign?.id) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closePopup();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const autoCloseSeconds = Math.max(0, Number(delaySeconds) || 0);
    const autoCloseTimer = autoCloseSeconds > 0
      ? window.setTimeout(() => {
          closePopup();
        }, autoCloseSeconds * 1000)
      : null;

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (autoCloseTimer) {
        window.clearTimeout(autoCloseTimer);
      }
    };
  }, [campaign, delaySeconds, onClose, storageKey, visible]);

  function closePopup() {
    setVisible(false);
    try {
      sessionStorage.setItem(storageKey, '1');
    } catch {
      // ignore
    }
    if (onClose) {
      onClose(campaign);
    }
  }

  if (!enabled || !visible || !campaign?.id || isExpired) {
    return null;
  }

  const imageUrl = campaign.imageUrl || '/campaigns/opening-promo.jpg';

  const resolvedCtaHref = ctaHref || '/basvuru';

  return (
    <div
      className="campaign-popup-backdrop"
      role="presentation"
    >
      <section
        className="campaign-popup"
        role="dialog"
        aria-modal="false"
        aria-label={campaign.title || 'Kampanya bildirimi'}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="campaign-popup-close"
          type="button"
          onClick={closePopup}
          aria-label="Kampanya penceresini kapat"
        >
          ×
        </button>

        <div className="campaign-popup-media">
          <img src={imageUrl} alt={campaign.title || 'Kampanya görseli'} />
          <div className="campaign-popup-media-overlay" />
        </div>

        <div className="campaign-popup-content">
          <div className="campaign-popup-badge-row">
            {campaign.badge && <span className="campaign-popup-badge">{campaign.badge}</span>}
            {campaign.endDate && (
              <span className="campaign-popup-deadline">
                Son tarih: {new Date(campaign.endDate).toLocaleDateString('tr-TR')}
              </span>
            )}
          </div>

          <h3 className="campaign-popup-title">{campaign.title}</h3>
          {campaign.subtitle && <p className="campaign-popup-subtitle">{campaign.subtitle}</p>}
          {campaign.description && <p className="campaign-popup-body">{campaign.description}</p>}

          <div className="campaign-popup-actions">
            <a
              className="cta cta-dark campaign-popup-cta"
              href={resolvedCtaHref}
              data-track-source="campaign-popup"
              onClick={closePopup}
            >
              {campaign.ctaLabel || 'Hemen Başvur'}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

export default CampaignPopup;
