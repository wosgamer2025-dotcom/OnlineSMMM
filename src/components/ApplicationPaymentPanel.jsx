import React from 'react';

function ApplicationPaymentPanel({ isEnglish, paymentState, activeWizard, wizardEstimate, applicationId, uploadedFiles = [], nextSteps = [] }) {
  const status = paymentState?.status || 'idle';
  const heading = status === 'error'
    ? (isEnglish ? 'Completion payment needs attention.' : 'Başvuruyu tamamlamak için ödeme bekliyor.')
    : status === 'redirecting'
      ? (isEnglish ? 'Secure completion page is opening.' : 'Güvenli tamamlama sayfası açılıyor.')
      : (isEnglish ? 'Your application package is ready.' : 'Başvuru paketiniz hazır.');
  const copy = status === 'error'
    ? (isEnglish ? 'Review the payment message, then restart secure completion.' : 'Ödeme mesajını kontrol edin, ardından güvenli tamamlamayı tekrar başlatın.')
    : (isEnglish ? 'We are opening the secure payment page automatically.' : 'Güvenli ödeme sayfasını otomatik olarak açıyoruz.');
  const securityLabel = status === 'error'
    ? (isEnglish ? 'Retry required' : 'Tekrar gerekli')
    : status === 'redirecting'
      ? (isEnglish ? 'Redirecting securely' : 'Güvenli yönlendirme')
      : (isEnglish ? 'Preparing securely' : 'Güvenli hazırlanıyor');

  return (
    <div className="application-payment-note">
      <div className="application-payment-head">
        <span className="application-payment-icon" aria-hidden="true">✓</span>
        <div>
          <strong>{heading}</strong>
          <p>{copy}</p>
        </div>
      </div>
      <div className="application-payment-package">
        <span>
          <small>{isEnglish ? 'Selected package' : 'Seçilen paket'}</small>
          <strong>{activeWizard?.label || '-'}</strong>
        </span>
        <span>
          <small>{isEnglish ? 'Amount' : 'Tutar'}</small>
          <strong>{wizardEstimate || '-'}</strong>
        </span>
        <span>
          <small>{isEnglish ? 'Application ID' : 'Başvuru ID'}</small>
          <strong>{applicationId || '-'}</strong>
        </span>
        <span>
          <small>{isEnglish ? 'Documents' : 'Evrak'}</small>
          <strong>{uploadedFiles.length ? `${uploadedFiles.length} ${isEnglish ? 'file(s)' : 'dosya'}` : '-'}</strong>
        </span>
      </div>
      <div className="application-payment-security">
        <div>
          <span>{securityLabel}</span>
          <strong>{isEnglish ? '256-bit secure payment infrastructure' : '256-bit güvenli ödeme altyapısı'}</strong>
        </div>
        <div className="application-payment-logos" aria-label={isEnglish ? 'Accepted payment providers' : 'Kabul edilen ödeme sağlayıcıları'}>
          <img src="/cards/visa.svg" alt="Visa" />
          <img src="/cards/mastercard.svg" alt="Mastercard" />
          <img src="/iyzico/iyzico-pay.svg" alt={isEnglish ? 'Pay with iyzico' : 'iyzico ile öde'} />
        </div>
      </div>
      {nextSteps.length ? (
        <ol className="application-payment-next">
          {nextSteps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      ) : null}
      {paymentState?.error ? <span className="field-warning">{paymentState.error}</span> : null}
    </div>
  );
}

export default ApplicationPaymentPanel;
