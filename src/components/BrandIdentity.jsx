import React from 'react';

function BrandIdentity({ brand, href, className = 'brand', onClick, ariaLabel, textClassName = 'brand-text' }) {
  const brandText = brand?.namePrefix && brand?.nameAccent ? (
    <>
      <span className="brand-text-prefix">{brand.namePrefix}</span>
      <span className="brand-text-accent">{brand.nameAccent}</span>
    </>
  ) : (
    brand?.name
  );

  const content = (
    <>
      <span className="brand-mark">
        {brand?.logo ? <img src={brand.logo} alt="" aria-hidden="true" /> : brand?.mark}
      </span>
      <span className={textClassName}>{brandText}</span>
    </>
  );

  if (href) {
    return (
      <a className={className} href={href} aria-label={ariaLabel || brand?.ariaLabel} onClick={onClick}>
        {content}
      </a>
    );
  }

  return (
    <span className={className} aria-label={ariaLabel || brand?.ariaLabel}>
      {content}
    </span>
  );
}

export default BrandIdentity;
