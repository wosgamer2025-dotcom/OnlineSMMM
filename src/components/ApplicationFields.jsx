import React, { useMemo } from 'react';

const EMAIL_DOMAIN_SUGGESTIONS = ['gmail.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'outlook.com', 'live.com', 'proton.me'];

function normalizeTurkishPhone(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (!digits) return '';

  const parts = [];
  if (digits.length <= 3) return `(${digits}`;
  parts.push(`(${digits.slice(0, 3)})`);
  if (digits.length <= 6) {
    parts.push(digits.slice(3));
    return parts.join(' ');
  }
  parts.push(digits.slice(3, 6));
  if (digits.length <= 8) {
    parts.push(digits.slice(6));
    return parts.join(' ');
  }
  parts.push(digits.slice(6, 8));
  const tail = digits.slice(8);
  return tail ? `${parts.join(' ')} ${tail}` : parts.join(' ');
}

function extractEmailParts(value) {
  const raw = String(value || '').trim();
  const atIndex = raw.indexOf('@');
  if (atIndex === -1) {
    return { localPart: raw, domainPart: '', hasAt: false };
  }
  return {
    localPart: raw.slice(0, atIndex),
    domainPart: raw.slice(atIndex + 1),
    hasAt: true,
  };
}

function formatTurkishPhoneDisplay(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (!digits) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length <= 8) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}`;
}

function normalizeEmailInput(value) {
  const raw = String(value || '').replace(/\s+/g, '');
  const parts = extractEmailParts(raw);
  if (!parts.hasAt) return parts.localPart;
  return `${parts.localPart}@${parts.domainPart}`;
}

export function InputField({ label, value, error, onChange, list, disabled = false, type = 'text', inputMode, autoComplete, required = false, placeholder, onBlur }) {
  return (
    <label className={error ? 'has-error' : ''}>
      {label}
      <input
        value={value}
        list={list}
        disabled={disabled}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error && <span className="field-warning">{error}</span>}
    </label>
  );
}

export function PhoneField({ label, value, error, onChange, required = false }) {
  const handleChange = (inputValue) => {
    onChange(normalizeTurkishPhone(inputValue));
  };

  const handleBlur = () => {
    onChange(formatTurkishPhoneDisplay(value));
  };

  return (
    <InputField
      label={label}
      value={value}
      error={error}
      onChange={handleChange}
      onBlur={handleBlur}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="(555) 555 55 55"
      required={required}
    />
  );
}

export function EmailField({ label, value, error, onChange, required = false }) {
  const parts = extractEmailParts(value);
  const shouldSuggest = parts.localPart.length > 0;
  const filteredDomains = useMemo(() => {
    const query = parts.domainPart.toLowerCase();
    if (!parts.hasAt) {
      return EMAIL_DOMAIN_SUGGESTIONS;
    }
    if (!query) {
      return EMAIL_DOMAIN_SUGGESTIONS;
    }
    return EMAIL_DOMAIN_SUGGESTIONS.filter((domain) => domain.toLowerCase().startsWith(query));
  }, [parts.domainPart, parts.hasAt]);
  const suggestedEmails = filteredDomains.slice(0, 6).map((domain) => `${parts.localPart || 'ornek'}@${domain}`);

  const handleChange = (inputValue) => {
    onChange(normalizeEmailInput(inputValue));
  };

  return (
    <label className={error ? 'has-error' : ''}>
      {label}
      <div className="email-field-native">
        <input
          value={value}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="ornek@gmail.com"
          required={required}
          onChange={(event) => handleChange(event.target.value)}
          list="email-suggestions-list"
        />
        {shouldSuggest && suggestedEmails.length > 0 && (
          <datalist id="email-suggestions-list">
            {suggestedEmails.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        )}
      </div>
      {error && <span className="field-warning">{error}</span>}
    </label>
  );
}

export function SelectField({ label, value, error, onChange, disabled = false, required = false, children }) {
  return (
    <label className={error ? 'has-error' : ''}>
      {label}
      <select value={value} disabled={disabled} required={required} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
      {error && <span className="field-warning">{error}</span>}
    </label>
  );
}
