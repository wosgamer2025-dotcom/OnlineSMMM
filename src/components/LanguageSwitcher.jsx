import React from 'react';
import FlagIcon from './FlagIcon';

function LanguageSwitcher({ title, options, activeCode, onChange, compact = false }) {
  const activeLanguage = options.find((lang) => lang.code === activeCode) || options[0];

  return (
    <label className={`language-switcher ${compact ? 'compact' : ''}`} aria-label={title}>
      <span className="language-current" aria-hidden="true">
        <span className="language-flag">
          <FlagIcon code={activeLanguage?.code} />
        </span>
        {!compact && <strong>{activeLanguage?.label}</strong>}
      </span>
      <select value={activeCode} onChange={(event) => onChange(event.target.value)} title={title}>
        {options.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.flag} {lang.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default LanguageSwitcher;
