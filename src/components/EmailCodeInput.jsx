import React, { useEffect, useMemo, useRef } from 'react';

function EmailCodeInput({ value, onChange, onComplete, length = 6, disabled = false, autoFocus = false }) {
  const inputsRef = useRef([]);
  const completedValueRef = useRef('');
  const digits = useMemo(() => {
    const normalized = String(value || '').replace(/\D/g, '').slice(0, length);
    return Array.from({ length }, (_, index) => normalized[index] || '');
  }, [length, value]);
  const completeCode = digits.join('');

  useEffect(() => {
    if (!autoFocus) return;
    const firstEmpty = digits.findIndex((digit) => !digit);
    const index = firstEmpty >= 0 ? firstEmpty : length - 1;
    inputsRef.current[index]?.focus?.();
  }, [autoFocus, digits, length]);

  useEffect(() => {
    if (disabled || !onComplete || completeCode.length !== length || digits.some((digit) => !digit)) {
      if (completeCode.length !== length) {
        completedValueRef.current = '';
      }
      return;
    }
    if (completedValueRef.current === completeCode) return;
    completedValueRef.current = completeCode;
    onComplete(completeCode);
  }, [completeCode, digits, disabled, length, onComplete]);

  const setNextValue = (nextDigits) => {
    onChange(nextDigits.join('').slice(0, length));
  };

  const handleChange = (index, nextValue) => {
    const cleaned = String(nextValue || '').replace(/\D/g, '');
    const nextDigits = [...digits];
    if (!cleaned) {
      nextDigits[index] = '';
      setNextValue(nextDigits);
      return;
    }

    const firstChar = cleaned[0];
    nextDigits[index] = firstChar;
    let cursor = index + 1;
    for (const char of cleaned.slice(1)) {
      if (cursor >= length) break;
      nextDigits[cursor] = char;
      cursor += 1;
    }
    setNextValue(nextDigits);
    inputsRef.current[Math.min(cursor, length - 1)]?.focus?.();
  };

  const handleKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus?.();
      const nextDigits = [...digits];
      nextDigits[index - 1] = '';
      setNextValue(nextDigits);
      event.preventDefault();
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1]?.focus?.();
      event.preventDefault();
    }
    if (event.key === 'ArrowRight' && index < length - 1) {
      inputsRef.current[index + 1]?.focus?.();
      event.preventDefault();
    }
  };

  const handlePaste = (event) => {
    const pasted = String(event.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    event.preventDefault();
    setNextValue(Array.from({ length }, (_, index) => pasted[index] || digits[index] || ''));
    inputsRef.current[Math.min(pasted.length, length - 1)]?.focus?.();
  };

  return (
    <div className="otp-code-group" role="group" aria-label="Doğrulama kodu">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            inputsRef.current[index] = node;
          }}
          className="otp-code-input"
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          pattern="[0-9]*"
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          aria-label={`${index + 1}. hane`}
        />
      ))}
    </div>
  );
}

export default EmailCodeInput;
