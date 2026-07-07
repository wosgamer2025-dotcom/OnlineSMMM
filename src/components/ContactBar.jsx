import React from 'react';
import { useEffect, useMemo, useState } from 'react';

function Icon({ kind }) {
  const paths = {
    whatsapp: <path d="M20 11.5A8.5 8.5 0 0 1 7.5 19L3 20l1.1-4.3A8.5 8.5 0 1 1 20 11.5Z" />,
    telegram: <path d="m21 4-3.6 17-5.2-4-2.7 2.6-.3-5.3L21 4Z" />,
    phone: <path d="M6.6 3h3l1.2 4.2-1.8 1.8a16 16 0 0 0 6 6l1.8-1.8L21 14.4v3c0 1-.8 1.7-1.8 1.6C10.7 18.3 5.7 13.3 5 4.8 4.9 3.8 5.7 3 6.6 3Z" />,
    email: <path d="M3 6h18v12H3V6Zm0 1.5 9 6 9-6" />,
    instagram: <path d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm5 5.2A3.8 3.8 0 1 0 15.8 12 3.8 3.8 0 0 0 12 8.2Zm5.3-.9h.1" />,
    facebook: <path d="M13 21v-7h2.3l.7-3H13V9.1c0-.9.3-1.6 1.7-1.6H16V4.8c-.2 0-1-.1-1.9-.1-2.6 0-4.1 1.5-4.1 4.4V11H7v3h2.9v7H13Z" />,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[kind] || <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

function ContactBar({ title, copy: _copy, links }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    media.addListener?.(sync);
    return () => {
      media.removeEventListener?.('change', sync);
      media.removeListener?.(sync);
    };
  }, []);

  const primaryLink = useMemo(() => links.find((link) => link.icon === 'whatsapp') || links[0], [links]);
  const mobileLinks = useMemo(() => {
    const ordered = [
      primaryLink,
      ...links.filter((link) => link !== primaryLink),
    ];
    return ordered.filter(Boolean);
  }, [links, primaryLink]);

  return (
    <section className={`contact-bar-wrap ${isOpen ? 'open' : ''}`} aria-label={title}>
      <div className="contact-bar">
        {!isMobile && primaryLink && (
          <a
            className="contact-toggle contact-toggle-whatsapp contact-toggle-desktop"
            href={primaryLink.href}
            target={primaryLink.external ? '_blank' : undefined}
            rel={primaryLink.external ? 'noreferrer' : undefined}
            aria-label={primaryLink.label}
            title={primaryLink.label}
            data-track-source="contact-floating-whatsapp"
          >
            <span className="contact-toggle-pulse" />
            <Icon kind={primaryLink.icon} />
          </a>
        )}

        {isMobile && primaryLink && (
          <>
            <button
              className="contact-toggle contact-toggle-whatsapp contact-toggle-mobile"
              type="button"
              aria-label={isOpen ? 'İletişim menüsünü kapat' : 'İletişim menüsünü aç'}
              aria-expanded={isOpen}
              onClick={() => setIsOpen((current) => !current)}
            >
              <span className="contact-toggle-pulse" />
              <Icon kind="whatsapp" />
            </button>

            <div className="contact-bar-links" aria-hidden={!isOpen}>
              {mobileLinks.map((link, index) => (
                <a
                  key={link.label}
                  className={`contact-pill ${index === 0 ? 'whatsapp' : (link.tone || 'light')}`}
                  href={link.href}
                  target={link.external ? '_blank' : undefined}
                  rel={link.external ? 'noreferrer' : undefined}
                  data-track-source={`contact-bar-${link.icon || index}`}
                >
                  <Icon kind={link.icon} />
                  {link.label}
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default ContactBar;
