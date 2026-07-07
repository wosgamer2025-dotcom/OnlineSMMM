import React, { useState, useMemo } from 'react';

function BlogListingPage({ articles, locale, ui: _ui, onNavigate }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  const categories = useMemo(() => {
    const list = new Set(articles.map((a) => a.category));
    return ['All', ...Array.from(list)];
  }, [articles]);

  const filteredArticles = useMemo(() => {
    return articles.filter((article) => {
      const matchesCategory = activeCategory === 'All' || article.category === activeCategory;
      const matchesSearch =
        article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.category.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [articles, activeCategory, searchTerm]);

  // Translate category titles
  const categoryLabels = {
    'All': locale === 'en' ? 'All Topics' : 'Tüm Konular',
    'Şirket Açma': locale === 'en' ? 'Company Formation' : 'Şirket Açma',
    'E-Dönüşüm': locale === 'en' ? 'e-Transformation' : 'E-Dönüşüm',
    'Girişimcilik': locale === 'en' ? 'Entrepreneurship' : 'Girişimcilik',
    'Teknoloji': locale === 'en' ? 'Technology' : 'Teknoloji',
    'Vergi': locale === 'en' ? 'Taxation' : 'Vergi',
    'Dijital Pazarlama': locale === 'en' ? 'Digital Marketing' : 'Dijital Pazarlama',
  };

  return (
    <section className="section blog-page">
      <div className="section-head">
        <div className="pill">
          {locale === 'en' ? 'Resources & Guides' : 'Bilgi Bankası & Rehberler'}
        </div>
        <h1>{locale === 'en' ? 'onlinesmmm Blog' : 'onlinesmmm Bilgi Bankası'}</h1>
        <p>
          {locale === 'en'
            ? 'Guides on company formation, taxation, e-transformation and business growth.'
            : 'Şirket kuruluşu, vergilendirme, e-belge süreçleri ve girişimciliğe dair uzman kılavuzlar.'}
        </p>
      </div>

      <div className="blog-controls">
        <div className="blog-search-wrap">
          <input
            type="text"
            className="blog-search-input"
            placeholder={locale === 'en' ? 'Search articles...' : 'Makalelerde ara...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="blog-search-clear" onClick={() => setSearchTerm('')}>
              ×
            </button>
          )}
        </div>

        <div className="blog-categories">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`blog-category-btn ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {categoryLabels[cat] || cat}
            </button>
          ))}
        </div>
      </div>

      {filteredArticles.length > 0 ? (
        <div className="blog-grid-list">
          {filteredArticles.map((article, _idx) => {
            // Highlights company formation articles
            const isFormation = article.category === 'Şirket Açma';
            return (
              <article
                className={`card blog-listing-card lift ${isFormation ? 'formation-featured' : ''}`}
                key={article.slug}
                onClick={() => onNavigate(article.slug)}
                style={{ cursor: 'pointer' }}
              >
                {isFormation && (
                  <div className="blog-featured-badge">
                    {locale === 'en' ? 'Popular Guide' : 'Popüler Rehber'}
                  </div>
                )}
                {article.image && (
                  <div className="blog-card-image-wrap">
                    <img src={article.image} alt={article.title} loading="lazy" />
                  </div>
                )}
                <div className="blog-card-content-wrap">
                  <div className="blog-card-meta">
                    <span className="blog-card-category">{categoryLabels[article.category] || article.category}</span>
                    <span className="blog-card-dot">•</span>
                    <span>{article.readTime}</span>
                  </div>
                  <h3>{article.title}</h3>
                  <p>{article.summary}</p>
                  <div className="blog-card-footer">
                    <span className="blog-card-date">{article.date}</span>
                    <span className="blog-card-more">
                      {locale === 'en' ? 'Read Guide' : 'Rehberi Oku'} →
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="preview-box blog-empty-state">
          <strong>{locale === 'en' ? 'No articles found' : 'Sonuç bulunamadı'}</strong>
          <p>
            {locale === 'en'
              ? 'Try adjusting your search keywords or choosing another category.'
              : 'Farklı anahtar kelimeler aramayı veya başka bir kategori seçmeyi deneyin.'}
          </p>
        </div>
      )}
    </section>
  );
}

export default BlogListingPage;
