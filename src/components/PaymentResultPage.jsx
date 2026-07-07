import React from 'react';

function PaymentResultPage({ locale, status, title, message, reference, orderId, onBackHome, onRetry }) {
  const isEnglish = locale === 'en';
  const isSuccess = status === 'success';
  const heading = title || (isSuccess
    ? (isEnglish ? 'Payment received' : 'Ödemeniz alındı')
    : (isEnglish ? 'Payment could not be completed' : 'Ödeme tamamlanamadı'));
  const copy = message || (isSuccess
    ? (isEnglish
      ? 'Thank you. Your payment was verified successfully and your advisor will contact you soon.'
      : 'Teşekkürler. Ödemeniz doğrulandı ve danışmanımız en kısa sürede sizinle iletişime geçecek.')
    : (isEnglish
      ? 'The payment could not be verified. Please try again or contact your advisor.'
      : 'Ödeme doğrulanamadı. Lütfen tekrar deneyin veya danışmanınızla iletişime geçin.'));

  return (
    <section className="payment-result-page">
      <div className={`payment-result-card ${isSuccess ? 'success' : 'failure'}`}>
        <div className="payment-result-badge" aria-hidden="true">
          {isSuccess ? '✓' : '!'}
        </div>
        <h1>{heading}</h1>
        <p>{copy}</p>

        <div className="payment-result-meta">
          {reference && (
            <div>
              <small>{isEnglish ? 'Reference' : 'Referans'}</small>
              <strong>{reference}</strong>
            </div>
          )}
          {orderId && (
            <div>
              <small>{isEnglish ? 'Order ID' : 'Sipariş no'}</small>
              <strong>{orderId}</strong>
            </div>
          )}
        </div>

        <div className="payment-result-actions">
          <button type="button" className="application-main-button" onClick={onBackHome}>
            {isSuccess ? (isEnglish ? 'Back to home' : 'Ana sayfaya dön') : (isEnglish ? 'Go home' : 'Ana sayfaya dön')}
          </button>
          {!isSuccess && (
            <button type="button" className="application-secondary-button" onClick={onRetry}>
              {isEnglish ? 'Try again' : 'Tekrar dene'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export default PaymentResultPage;
