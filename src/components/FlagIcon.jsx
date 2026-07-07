import React from 'react';
function FlagIcon({ code }) {
  switch (code) {
    case 'tr':
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="24" height="16" rx="3" fill="#e11d48" />
          <circle cx="10" cy="8" r="4.3" fill="#fff" />
          <circle cx="11.4" cy="8" r="3.4" fill="#e11d48" />
          <path d="M16.2 8l1.65 1.2-.63-1.9 1.63-1.16h-2.02l-.63-1.93-.63 1.93h-2.02l1.63 1.16-.63 1.9z" fill="#fff" />
        </svg>
      );
    case 'en':
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="24" height="16" rx="3" fill="#1d4ed8" />
          <path d="M0 0l24 16M24 0L0 16" stroke="#fff" strokeWidth="3.2" />
          <path d="M0 0l24 16M24 0L0 16" stroke="#dc2626" strokeWidth="1.6" />
          <path d="M10 0h4v16h-4z" fill="#fff" />
          <path d="M0 6h24v4H0z" fill="#fff" />
          <path d="M10.8 0h2.4v16h-2.4z" fill="#dc2626" />
          <path d="M0 6.8h24v2.4H0z" fill="#dc2626" />
        </svg>
      );
    case 'de':
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="24" height="16" rx="3" fill="#000" />
          <rect y="5.33" width="24" height="5.34" fill="#dc2626" />
          <rect y="10.66" width="24" height="5.34" fill="#f59e0b" />
        </svg>
      );
    case 'it':
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="24" height="16" rx="3" fill="#16a34a" />
          <rect x="8" width="8" height="16" fill="#fff" />
          <rect x="16" width="8" height="16" fill="#dc2626" />
        </svg>
      );
    case 'es':
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="24" height="16" rx="3" fill="#dc2626" />
          <rect y="4" width="24" height="8" fill="#facc15" />
        </svg>
      );
    case 'fr':
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="8" height="16" rx="3" fill="#1d4ed8" />
          <rect x="8" width="8" height="16" fill="#fff" />
          <rect x="16" width="8" height="16" rx="3" fill="#dc2626" />
        </svg>
      );
    case 'az':
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="24" height="16" rx="3" fill="#0ea5e9" />
          <rect y="5.33" width="24" height="5.34" fill="#ef4444" />
          <rect y="10.66" width="24" height="5.34" fill="#16a34a" />
          <circle cx="11.1" cy="8" r="3" fill="#fff" />
          <circle cx="12.2" cy="8" r="2.35" fill="#ef4444" />
          <path d="M15.3 8l1.25.9-.48-1.45 1.24-.88h-1.54l-.48-1.47-.48 1.47h-1.54l1.24.88-.48 1.45z" fill="#fff" />
        </svg>
      );
    case 'ky':
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="24" height="16" rx="3" fill="#dc2626" />
          <circle cx="12" cy="8" r="4" fill="#facc15" opacity="0.95" />
          <circle cx="12" cy="8" r="1.4" fill="#dc2626" />
          <path d="M12 2.4v2.2M12 11.4v2.2M5.2 8h2.2M16.6 8h2.2M7.1 3.9l1.5 1.5M15.4 12.2l1.5 1.5M16.9 3.9l-1.5 1.5M7.1 12.2l1.5-1.5" stroke="#facc15" strokeWidth="1" strokeLinecap="round" />
        </svg>
      );
    case 'tk':
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="24" height="16" rx="3" fill="#15803d" />
          <rect x="3" y="2" width="3" height="12" rx="1.5" fill="#dc2626" />
          <path d="M11.5 8.2a2.8 2.8 0 1 1 0-4.4 3.6 3.6 0 1 0 0 6.1 2.8 2.8 0 0 1 0-1.7z" fill="#fff" />
          <path d="M15.7 8l1.25.9-.48-1.45 1.24-.88h-1.54l-.48-1.47-.48 1.47h-1.54l1.24.88-.48 1.45z" fill="#fff" />
        </svg>
      );
    case 'ru':
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="24" height="16" rx="3" fill="#fff" />
          <rect y="5.33" width="24" height="5.34" fill="#2563eb" />
          <rect y="10.66" width="24" height="5.34" fill="#dc2626" />
        </svg>
      );
    case 'ar':
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="24" height="16" rx="3" fill="#15803d" />
          <rect y="5.33" width="24" height="5.34" fill="#fff" />
          <path d="M16.6 7.9l1.2.86-.45-1.38 1.18-.85h-1.46l-.46-1.4-.45 1.4h-1.47l1.19.85-.45 1.38z" fill="#fff" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false">
          <rect width="24" height="16" rx="3" fill="#cbd5e1" />
        </svg>
      );
  }
}

export default FlagIcon;
