import React, { useState, useEffect, useRef } from 'react';

function TestimonialsCarousel({ list, locale }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(3);
  const trackRef = useRef(null);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 640) {
        setVisibleCount(1);
      } else if (window.innerWidth <= 1024) {
        setVisibleCount(2);
      } else {
        setVisibleCount(3);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const totalPages = Math.ceil(list.length / visibleCount);

  // Auto-play timer
  useEffect(() => {
    if (totalPages <= 1) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % totalPages);
    }, 7000);
    return () => clearInterval(timer);
  }, [totalPages]);

  const handlePrev = () => {
    setActiveIndex((prev) => (prev === 0 ? totalPages - 1 : prev - 1));
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev + 1) % totalPages);
  };

  // Safe bounds check when resizing
  useEffect(() => {
    if (activeIndex >= totalPages && totalPages > 0) {
      setActiveIndex(totalPages - 1);
    }
  }, [totalPages, activeIndex]);

  return (
    <div className="testimonials-carousel-container">
      <div className="testimonials-track-wrapper">
        <div 
          className="testimonials-carousel-track" 
          ref={trackRef}
          style={{
            display: 'flex',
            transition: 'transform 600ms cubic-bezier(0.25, 1, 0.5, 1)',
            transform: `translate3d(-${activeIndex * 100}%, 0, 0)`,
            width: '100%'
          }}
        >
          {list.map((item, idx) => (
            <div 
              className="testimonial-slide-item" 
              key={`${item.name}-${idx}`}
              style={{
                flex: `0 0 ${100 / visibleCount}%`,
                padding: '0 12px',
                boxSizing: 'border-box'
              }}
            >
              <blockquote className="card testimonial-card lift h-full" style={{ height: '100%', margin: 0 }}>
                <p className="testimonial-quote">"{item.quote}"</p>
                <footer className="testimonial-footer">
                  <img
                    className="avatar"
                    src={item.photo}
                    alt={item.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  <div className="testimonial-author-meta">
                    <strong>{item.name}</strong>
                    <span>{item.role}</span>
                    {item.country && <small className="testimonial-country">{item.country}</small>}
                  </div>
                </footer>
              </blockquote>
            </div>
          ))}
        </div>
      </div>

      <div className="testimonials-controls">
        <button 
          className="testimonials-nav-btn prev" 
          onClick={handlePrev} 
          aria-label={locale === 'en' ? 'Previous page' : 'Önceki sayfa'}
        >
          ←
        </button>
        
        <div className="testimonials-dots">
          {Array.from({ length: totalPages }).map((_, idx) => (
            <button
              key={idx}
              className={`testimonials-dot ${activeIndex === idx ? 'active' : ''}`}
              onClick={() => setActiveIndex(idx)}
              aria-label={`Go to page ${idx + 1}`}
            />
          ))}
        </div>

        <button 
          className="testimonials-nav-btn next" 
          onClick={handleNext} 
          aria-label={locale === 'en' ? 'Next page' : 'Sonraki sayfa'}
        >
          →
        </button>
      </div>
    </div>
  );
}

export default TestimonialsCarousel;
