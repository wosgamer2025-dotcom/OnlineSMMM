import React, { useEffect, useState } from 'react';
import BrandIdentity from './BrandIdentity';

function TopBar({ brand, brandHref = '#ana-sayfa', nav, ctaHref, ctaLabel, languageSwitcher, mobileQuickLinks = {} }) {
  const [activeDropdown, setActiveDropdown] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false);
  const mobileServicesHref = mobileQuickLinks.servicesHref || nav.find((item) => item.dropdown)?.dropdown?.[3]?.href || ctaHref;
  const mobileBlogHref = mobileQuickLinks.blogHref || nav.find((item) => item.label === 'Blog')?.href || ctaHref;
  const mobileStartHref = mobileQuickLinks.startHref || brandHref;
  const mobileProcessHref = mobileQuickLinks.processHref || nav.find((item) => item.label === 'Süreç')?.href || '#surec';
  const mobilePlansHref = mobileQuickLinks.plansHref || nav.find((item) => item.label === 'Fiyatlar')?.href || '#plans';
  const mobileServicesItems = nav.find((item) => Array.isArray(item.dropdown))?.dropdown || [];

  useEffect(() => {
    if (!mobileMenuOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        setMobileServicesOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileMenuOpen]);

  function handleSectionNavigation(event, href) {
    try {
      const targetUrl = new URL(href, window.location.origin);
      const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
      const targetPath = targetUrl.pathname.replace(/\/+$/, '') || '/';
      const isSamePage = currentPath === targetPath;

      if (targetUrl.hash && isSamePage) {
        event.preventDefault();
        const elementId = targetUrl.hash.slice(1);
        const targetElement = document.getElementById(elementId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          window.history.replaceState({}, '', `${targetUrl.pathname}${targetUrl.hash}`);
        }
        return;
      }

      if (targetUrl.hash && targetElementExists(targetUrl.hash)) {
        event.preventDefault();
        window.location.href = targetUrl.href;
      }
    } catch {
      // Let the browser handle the navigation.
    }
  }

  function targetElementExists(hash) {
    const id = String(hash || '').replace(/^#/, '');
    return Boolean(id && document.getElementById(id));
  }

  function bindNavigation(onClick, href) {
    return (event) => {
      handleSectionNavigation(event, href);
      if (onClick) onClick(event);
    };
  }

  const mobileRail = (
    <div className="topbar-mobile-rail" aria-label="Mobil hızlı gezinme">
      <a
        className="topbar-mobile-rail-pill"
        href={mobileServicesHref}
        onClick={bindNavigation(() => {
          setActiveDropdown(null);
          setMobileMenuOpen(false);
        }, mobileServicesHref)}
      >
        Hizmetler
      </a>
      <a
        className="topbar-mobile-rail-pill"
        href={mobileBlogHref}
        onClick={bindNavigation(() => {
          setActiveDropdown(null);
          setMobileMenuOpen(false);
        }, mobileBlogHref)}
      >
        Blog
      </a>
      <a
        className="topbar-mobile-rail-center"
        href={mobileStartHref}
        aria-label="Şirket Kur"
        onClick={bindNavigation(() => {
          setActiveDropdown(null);
          setMobileMenuOpen(false);
        }, mobileStartHref)}
      >
        <span>ŞİRKET</span>
        <strong>KUR</strong>
      </a>
      <a
        className="topbar-mobile-rail-pill"
        href={mobileProcessHref}
        onClick={bindNavigation(() => {
          setActiveDropdown(null);
          setMobileMenuOpen(false);
        }, mobileProcessHref)}
      >
        Süreç
      </a>
      <a
        className="topbar-mobile-rail-pill"
        href={mobilePlansHref}
        onClick={bindNavigation(() => {
          setActiveDropdown(null);
          setMobileMenuOpen(false);
        }, mobilePlansHref)}
      >
        Fiyatlar
      </a>
    </div>
  );

  const mobileServicesMenu = mobileServicesItems.length > 0 ? (
    <div className="topbar-mobile-group">
      <button
        type="button"
        className="topbar-mobile-trigger"
        aria-expanded={mobileServicesOpen}
        onClick={() => setMobileServicesOpen((current) => !current)}
      >
        <span>{nav.find((item) => Array.isArray(item.dropdown))?.label || 'Hizmetler'}</span>
        <strong>{mobileServicesOpen ? '−' : '+'}</strong>
      </button>
      <div className={`topbar-mobile-submenu ${mobileServicesOpen ? 'open' : ''}`}>
        {mobileServicesItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="topbar-mobile-sublink"
            onClick={bindNavigation(() => {
              setActiveDropdown(null);
              setMobileMenuOpen(false);
              setMobileServicesOpen(false);
            }, item.href)}
          >
            {item.label}
          </a>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <>
    <header className="topbar">
      <BrandIdentity brand={brand} href={brandHref} className="brand" onClick={bindNavigation(null, brandHref)} />

      <nav className="nav">
        {nav.map((item, idx) => {
          if (item.dropdown) {
            return (
              <div
                key={idx}
                className="nav-dropdown-wrapper"
                onMouseEnter={() => setActiveDropdown(idx)}
                onMouseLeave={() => setActiveDropdown(null)}
              >
                <button
                  className="nav-dropdown-trigger"
                  type="button"
                  aria-expanded={activeDropdown === idx}
                  onClick={() => setActiveDropdown(activeDropdown === idx ? null : idx)}
                >
                  {item.label} <span className="nav-arrow">▼</span>
                </button>
                <div className={`nav-dropdown-menu ${activeDropdown === idx ? 'show' : ''}`}>
                  {item.dropdown.map((sub, sidx) => (
                    <a
                      key={sidx}
                      href={sub.href}
                      className="nav-dropdown-item"
                      onClick={bindNavigation(() => {
                        setActiveDropdown(null);
                        setMobileMenuOpen(false);
                      }, sub.href)}
                    >
                      {sub.label}
                    </a>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <a
              key={item.href}
              href={item.href}
              onClick={bindNavigation(() => {
                setActiveDropdown(null);
                setMobileMenuOpen(false);
              }, item.href)}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      <div className="topbar-actions">
        {languageSwitcher}
        <button
          className="topbar-menu-toggle"
          type="button"
          aria-label={mobileMenuOpen ? 'Menüyü kapat' : 'Menüyü aç'}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((current) => {
            const next = !current;
            if (!next) {
              setMobileServicesOpen(false);
            }
            return next;
          })}
        >
          <span className="topbar-menu-icon" aria-hidden="true">
            <i />
            <i />
          </span>
        </button>
        <a className="cta cta-primary topbar-cta" href={ctaHref}>
          {ctaLabel}
        </a>
      </div>

    </header>
    <button
      type="button"
      className={`topbar-mobile-overlay ${mobileMenuOpen ? 'open' : ''}`}
      aria-label="Menüyü kapat"
      tabIndex={mobileMenuOpen ? 0 : -1}
      aria-hidden={!mobileMenuOpen}
      onClick={() => {
        setMobileMenuOpen(false);
        setMobileServicesOpen(false);
      }}
    />

    <div
      className={`topbar-mobile-menu ${mobileMenuOpen ? 'open' : ''}`}
      aria-hidden={!mobileMenuOpen}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="topbar-mobile-menu-header">
        <strong>Şirket Kur</strong>
        <span>Hızlı erişim</span>
      </div>
      <a
        href={mobileStartHref}
        className="topbar-mobile-link topbar-mobile-link-primary"
        onClick={bindNavigation(() => {
          setActiveDropdown(null);
          setMobileMenuOpen(false);
        }, mobileStartHref)}
      >
        Şirket Kur
      </a>
      <a
        href={mobileBlogHref}
        className="topbar-mobile-link"
        onClick={bindNavigation(() => {
          setActiveDropdown(null);
          setMobileMenuOpen(false);
        }, mobileBlogHref)}
      >
        Blog
      </a>
      <a
        href={mobileProcessHref}
        className="topbar-mobile-link"
        onClick={bindNavigation(() => {
          setActiveDropdown(null);
          setMobileMenuOpen(false);
        }, mobileProcessHref)}
      >
        Süreç
      </a>
      <a
        href={mobilePlansHref}
        className="topbar-mobile-link"
        onClick={bindNavigation(() => {
          setActiveDropdown(null);
          setMobileMenuOpen(false);
        }, mobilePlansHref)}
      >
        Fiyatlar
      </a>
      {mobileServicesMenu}
    </div>
    {mobileRail}
    </>
  );
}

export default TopBar;
