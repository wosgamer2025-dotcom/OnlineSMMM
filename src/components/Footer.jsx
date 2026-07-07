import React from 'react';
import BrandIdentity from './BrandIdentity';

function Footer({
  brand,
  brandHref = '#ana-sayfa',
  services = [],
  contacts = [],
  social = [],
  legalLinks = [],
  legalNote,
  labels,
  domains = [],
  legalDisclaimer,
  onNavigate = () => {},
  workingHours,
}) {
  const l = {
    footerTitle: labels?.footerTitle || 'Hizmetler',
    footerContact: labels?.footerContact || 'İletişim',
    footerLegal: labels?.footerLegal || 'Hukuki bilgiler',
    companyLegalName: labels?.companyLegalName || 'Ticari unvan',
    companyAddress: labels?.companyAddress || 'Adres',
    taxOffice: labels?.taxOffice || 'Vergi dairesi',
    taxNumber: labels?.taxNumber || 'Vergi no',
    tradeRegistryNo: labels?.tradeRegistryNo || 'Ticaret sicil no',
    mersisNo: labels?.mersisNo || 'MERSİS no',
    sslStatus: labels?.sslStatus || 'SSL durumu',
    workingHoursLabel: labels?.workingHoursLabel || 'Çalışma Saatleri',
  };

  return (
    <footer className="modern-footer">
      <div className="footer-container">
        {/* Footer Top Grid */}
        <div className="footer-grid">
          {/* Brand & Slogan */}
          <div className="footer-brand-col">
            <BrandIdentity brand={brand} href={brandHref} className="brand footer-brand-logo" />
            
            <div className="footer-slogan">
              <h4 className="footer-motto">
                {brand.copy.split('. ')[0] ? `${brand.copy.split('. ')[0]}.` : brand.copy}
              </h4>
              <p className="footer-subcopy">
                {brand.copy.split('. ').slice(1).join('. ')}
              </p>
            </div>

            {/* Social Media Link Buttons */}
            {social.length > 0 && (
              <div className="footer-social-row" aria-label="Sosyal medya bağlantıları">
                {social.map((item) => {
                  const key = item.label.toLowerCase();
                  const iconMap = {
                    instagram: (
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="social-icon instagram-icon">
                        <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                      </svg>
                    ),
                  };
                  return (
                    <a
                      key={item.label}
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className={`social-circle-btn ${key}`}
                      aria-label={item.label}
                    >
                      {iconMap[key] || <span className="btn-fallback-char">{item.label[0]}</span>}
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Services Column */}
          <div className="footer-links-col">
            <h3 className="footer-col-title">{l.footerTitle}</h3>
            <ul className="footer-links-list">
              {services.map((item) => (
                <li key={item} className="footer-link-item">
                  <span className="bullet-dot" aria-hidden="true">•</span>
                  <span className="link-label">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Column */}
          <div className="footer-links-col">
            <h3 className="footer-col-title">{l.footerContact}</h3>
            <ul className="footer-links-list footer-contact-list">
              {contacts.map((item) => {
                let iconSvg = (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                );
                
                const lowerLabel = item.label.toLowerCase();
                const isPhone = item.href && item.href.startsWith('tel:');
                const isMail = item.href && item.href.startsWith('mailto:');
                const isAddress = !item.href || item.href === '';

                if (isPhone) {
                  iconSvg = (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                    </svg>
                  );
                } else if (isMail) {
                  iconSvg = (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                      <polyline points="22,6 12,13 2,6"></polyline>
                    </svg>
                  );
                } else if (isAddress) {
                  iconSvg = (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                      <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                  );
                } else if (lowerLabel.includes('telegram')) {
                  iconSvg = (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  );
                }

                return (
                  <li key={item.label} className="footer-contact-item">
                    <span className="contact-icon-wrapper" aria-hidden="true">{iconSvg}</span>
                    {item.href ? (
                      <a
                        href={item.href}
                        target={item.external ? '_blank' : undefined}
                        rel={item.external ? 'noreferrer' : undefined}
                        className="footer-contact-link"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <span className="footer-contact-text">{item.label}</span>
                    )}
                  </li>
                );
              })}
            </ul>

            {workingHours && (
              <div className="footer-work-hours">
                <div className="work-hours-title">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <span>{l.workingHoursLabel}</span>
                </div>
                <p className="work-hours-val">{workingHours}</p>
              </div>
            )}
          </div>

          {/* Legal Column */}
          <div className="footer-links-col">
            <h3 className="footer-col-title">{l.footerLegal}</h3>
            <ul className="footer-links-list">
              {legalLinks.map((item) => (
                <li key={item.label} className="footer-link-item">
                  <span className="bullet-dot" aria-hidden="true">📄</span>
                  <a
                    href={item.href}
                    className="footer-link-anchor"
                    onClick={(event) => {
                      if (item.href?.startsWith('#')) {
                        event.preventDefault();
                        onNavigate(item.href);
                      }
                    }}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Verified Secure Domains Band (Modern Trust Signal) */}
        {domains.length > 0 && (
          <div className="footer-verified-band">
            <div className="verified-band-label">
              <span className="verified-shield-icon">🛡️</span>
              <span>KURUMSAL ALAN ADLARIMIZ</span>
            </div>
            <div className="verified-domains-grid">
              {domains.map((domain) => (
                <a href={`https://${domain}`} target="_blank" rel="noreferrer" className="verified-domain-pill" key={domain}>
                  <span className="domain-lock-icon">🔒</span>
                  <span className="domain-name">{domain}</span>
                  <span className="domain-status-check">✓ Güvenli Bağlantı</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Security & Payment Infrastructure Panel */}
        <div className="footer-trust-divider">
          <div className="footer-trust-visual" aria-hidden="true">
            <div className="trust-orbit trust-orbit-one" />
            <div className="trust-orbit trust-orbit-two" />
            <div className="trust-core">
              <span className="trust-core-lock">✓</span>
              <strong>SSL</strong>
            </div>
          </div>

          <div className="footer-trust-copy">
            <span className="trust-kicker">Güvenli işlem altyapısı</span>
            <h3>Başvuru ve ödeme adımları güvenli sağlayıcı yönlendirmesiyle ilerler.</h3>
            <p>
              Kart verisi bu sayfada saklanmaz. Ödeme gerektiğinde iyzico güvenli ödeme altyapısı,
              SSL/TLS bağlantı ve 3D Secure destekli sağlayıcı ekranı üzerinden ilerlenir.
            </p>
          </div>

          <div className="trust-badges-flow">
            <div className="trust-badge-item">
              <span className="trust-badge-icon">🔒</span>
              <span>SSL/TLS güvenli bağlantı</span>
            </div>
            <div className="trust-badge-item">
              <span className="trust-badge-icon">🛡️</span>
              <span>iyzico güvenli ödeme altyapısı</span>
            </div>
            <div className="trust-badge-item">
              <span className="trust-badge-icon">💳</span>
              <span>3D Secure / Visa / Mastercard</span>
            </div>
            <div className="trust-badge-item">
              <span className="trust-badge-icon">∅</span>
              <span>Kart verisi sitede tutulmaz</span>
            </div>
          </div>

          <div className="payment-providers-row">
            <span className="payment-provider-label">Kabul edilen kartlar</span>
            <div className="footer-card-logos" aria-label="Visa ve Mastercard">
              <img src="/cards/visa.svg" alt="Visa" className="card-brand-logo" />
              <img src="/cards/mastercard.svg" alt="Mastercard" className="card-brand-logo" />
            </div>
            <img src="/iyzico/iyzico-footer-band.svg" alt="iyzico güvenli ödeme altyapısı" className="iyzico-monochrome-logo" />
          </div>
        </div>

        {/* Disclaimer Bar */}
        {legalDisclaimer && (
          <div className="footer-legal-disclaimer">
            <span className="disclaimer-alert-icon">⚠️</span>
            <p className="disclaimer-para">{legalDisclaimer}</p>
          </div>
        )}

        {/* Footer Bottom Meta */}
        <div className="footer-bottom-meta">
          <p className="copyright-text">
            © 2026 OnlineSMMM. Tüm hakları saklıdır. {legalNote ? `• ${legalNote}` : ''}
          </p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
