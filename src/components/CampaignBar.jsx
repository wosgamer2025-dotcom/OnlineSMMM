import React, { useEffect, useState } from 'react';

function CampaignBar({ enabled, endDate, title, subtitle, onClose }) {
  const [timeLeft, setTimeLeft] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!enabled || !endDate) return;
    const storageKey = `campaign-bar-dismissed-${endDate}`;
    if (sessionStorage.getItem(storageKey)) {
      setDismissed(true);
      return;
    }
    function calc() {
      const diff = new Date(endDate) - Date.now();
      if (diff <= 0) {
        setTimeLeft(null);
        return;
      }
      const totalSeconds = Math.floor(diff / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      setTimeLeft({ days, hours, minutes, seconds });
    }
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [enabled, endDate]);

  if (!enabled || dismissed || (endDate && !timeLeft)) return null;

  function handleClose() {
    setDismissed(true);
    if (endDate) {
      try {
        sessionStorage.setItem(`campaign-bar-dismissed-${endDate}`, '1');
      } catch {
        // ignore
      }
    }
    if (onClose) onClose();
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  return (
    <div className="campaign-bar" role="banner" aria-label="Kampanya duyurusu">
      <div className="campaign-bar-inner">
        <div className="campaign-bar-text">
          {title && <span className="campaign-bar-title">{title}</span>}
          {subtitle && <span className="campaign-bar-subtitle">{subtitle}</span>}
        </div>
        {timeLeft && (
          <div className="campaign-bar-timer" aria-label="Kalan süre">
            <div className="campaign-timer-box">
              <strong>{pad(timeLeft.days)}</strong>
              <span>gün</span>
            </div>
            <div className="campaign-timer-sep">:</div>
            <div className="campaign-timer-box">
              <strong>{pad(timeLeft.hours)}</strong>
              <span>saat</span>
            </div>
            <div className="campaign-timer-sep">:</div>
            <div className="campaign-timer-box">
              <strong>{pad(timeLeft.minutes)}</strong>
              <span>dak.</span>
            </div>
            <div className="campaign-timer-sep">:</div>
            <div className="campaign-timer-box">
              <strong>{pad(timeLeft.seconds)}</strong>
              <span>san.</span>
            </div>
          </div>
        )}
      </div>
      <button
        className="campaign-bar-close"
        type="button"
        onClick={handleClose}
        aria-label="Kampanya barını kapat"
      >
        ×
      </button>
    </div>
  );
}

export default CampaignBar;
