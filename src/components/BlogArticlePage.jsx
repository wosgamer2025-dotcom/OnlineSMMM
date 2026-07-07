import React, { useMemo } from 'react';

function BlogArticlePage({ article, locale, ui: _ui, onBack, allArticles, onNavigate }) {
  // Suggest other articles (excluding current one)
  const relatedArticles = useMemo(() => {
    // Recommend the company opening guides first if they are not the current one
    const formationGuides = allArticles.filter(
      (a) => a.category === 'Şirket Açma' && a.slug !== article.slug
    );
    const otherArticles = allArticles.filter(
      (a) => a.category !== 'Şirket Açma' && a.slug !== article.slug
    );
    return [...formationGuides, ...otherArticles].slice(0, 4);
  }, [allArticles, article.slug]);

  const categoryLabels = {
    'Şirket Açma': locale === 'en' ? 'Company Formation' : 'Şirket Açma',
    'E-Dönüşüm': locale === 'en' ? 'e-Transformation' : 'E-Dönüşüm',
    'Girişimcilik': locale === 'en' ? 'Entrepreneurship' : 'Girişimcilik',
    'Teknoloji': locale === 'en' ? 'Technology' : 'Teknoloji',
    'Vergi': locale === 'en' ? 'Taxation' : 'Vergi',
    'Dijital Pazarlama': locale === 'en' ? 'Digital Marketing' : 'Dijital Pazarlama',
  };

  return (
    <section className="section blog-detail-page">
      <div className="blog-back-bar">
        <button className="cta cta-ghost-light" onClick={onBack}>
          ← {locale === 'en' ? 'Back to Blog' : 'Blog Listesine Dön'}
        </button>
      </div>

      <div className="blog-detail-layout">
        <article className="blog-detail-main card">
          <header className="blog-detail-header">
            <div className="blog-card-meta">
              <span className="blog-card-category">{categoryLabels[article.category] || article.category}</span>
              <span className="blog-card-dot">•</span>
              <span>{article.date}</span>
              <span className="blog-card-dot">•</span>
              <span>{article.readTime}</span>
            </div>
            <h1>{article.title}</h1>
            <p className="blog-detail-lead">{article.description || article.summary}</p>
            {article.image && (
              <div className="blog-detail-image-wrap">
                <img src={article.image} alt={article.title} />
              </div>
            )}
          </header>

          <div className="blog-detail-content">
            {article.sections && article.sections.length > 0 ? (
              article.sections.map((sec, index) => (
                <div className="blog-detail-section" key={index}>
                  <h2>{sec.title}</h2>
                  <p>{sec.text}</p>
                </div>
              ))
            ) : (
              <div className="blog-detail-section">
                <p>{article.summary}</p>
              </div>
            )}
          </div>
        </article>

        <aside className="blog-detail-sidebar">
          <div className="card blog-sidebar-card">
            <h3>{locale === 'en' ? 'Recommended Guides' : 'Önerilen Rehberler'}</h3>
            <p className="sidebar-intro">
              {locale === 'en'
                ? 'Check out our most popular company opening and growth resources.'
                : 'Şirket kuruluşu ve iş geliştirme üzerine en çok okunan kaynaklar.'}
            </p>
            <div className="blog-sidebar-links">
              {relatedArticles.map((rel) => (
                <div
                  key={rel.slug}
                  className="blog-sidebar-item"
                  onClick={() => onNavigate(rel.slug)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="blog-sidebar-item-cat">
                    {categoryLabels[rel.category] || rel.category}
                  </span>
                  <h4>{rel.title}</h4>
                  <span className="blog-sidebar-item-more">
                    {locale === 'en' ? 'Read' : 'Oku'} →
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card blog-sidebar-cta">
            <h3>{locale === 'en' ? 'Ready to Start?' : 'Şirketini Kurmaya Hazır mısın?'}</h3>
            <p>
              {locale === 'en'
                ? 'Launch your business in 1 business day with expert accountant backing.'
                : 'Uzman mali müşavir desteğiyle 1 iş gününde tamamen online şirketini kur.'}
            </p>
            <a href="#start" className="cta cta-whatsapp full" onClick={onBack}>
              {locale === 'en' ? 'Launch Setup Wizard' : 'Sihirbazı Başlat'}
            </a>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default BlogArticlePage;
