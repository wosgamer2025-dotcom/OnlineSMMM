import React, { Suspense, lazy } from 'react';

const CostCalculator = lazy(() => import('./CostCalculator'));

function CompanyLandingPage({ type, locale, ui: _ui, settings: _settings, onStartWizard }) {
  const isSole = type === 'sole';
  const isLimited = type === 'limited';

  // Title
  const title = isSole
    ? (locale === 'en' ? 'Sole Proprietorship Setup' : 'Şahıs Şirketi Kuruluşu')
    : isLimited
      ? (locale === 'en' ? 'Limited Company Formation' : 'Limited Şirket Kuruluşu')
      : (locale === 'en' ? 'Joint Stock Company (A.Ş.) Setup' : 'Anonim Şirket (A.Ş.) Kuruluşu');

  // Subtitle
  const subtitle = isSole
    ? (locale === 'en' 
        ? 'Fast, low-cost and low-friction setup for solo entrepreneurs and freelancers.' 
        : 'Freelancer, danışman ve tek kişilik işletmeler için en hızlı, ekonomik ve pratik şirket kurulum modeli.')
    : isLimited
      ? (locale === 'en'
          ? 'Establish a prestigious corporate presence. Ideal for partners, e-commerce and scale.'
          : 'Prestijli kurumsal kimlik, ortaklık yapısı ve e-ticaret odaklı işletmeler için en ideal şirket modeli.')
      : (locale === 'en'
          ? 'Corporate scale, unlimited partners, and equity options. Best for startups looking for VC funding.'
          : 'Büyük ölçekli hedefler, yatırım süreçleri ve hisse senedi opsiyonları için en prestijli sermaye şirketi yapısı.');

  // Features
  const features = isSole
    ? [
        { title: locale === 'en' ? '1-Day Setup' : '1 Günde Kurulum', text: locale === 'en' ? 'Fast registration with tax office.' : 'Vergi dairesi kaydı aynı gün içinde tamamlanır.' },
        { title: locale === 'en' ? 'Low Upkeep Costs' : 'Düşük İşletme Maliyeti', text: locale === 'en' ? 'Minimum corporate requirements.' : 'Kuruluş harçları ve defter tasdik giderleri minimum seviyededir.' },
        { title: locale === 'en' ? 'Easy Closing' : 'Kolay Tasfiye', text: locale === 'en' ? 'Close in just a few days if needed.' : 'Faaliyeti sonlandırmak istediğinizde tasfiye süreci hızlı ve zahmetsizdir.' },
      ]
    : isLimited
      ? [
          { title: locale === 'en' ? 'Prestigious Identity' : 'Prestijli Kurumsal Kimlik', text: locale === 'en' ? 'Limited liability protection.' : 'Ortakların sorumluluğu sadece taahhüt ettikleri sermaye ile sınırlıdır.' },
          { title: locale === 'en' ? 'Capital Structure' : 'Sermaye Ortaklığı', text: locale === 'en' ? 'Up to 50 partners allowed.' : 'Çok ortaklı yapılar ve yatırım alma süreçleri için en uygun modeldir.' },
          { title: locale === 'en' ? 'Tax Advantages' : 'Vergi Planlaması', text: locale === 'en' ? 'Flat corporate tax rates.' : 'Kurumlar vergisi oranıyla yüksek gelir dilimlerinde vergi avantajı sağlar.' },
        ]
      : [
          { title: locale === 'en' ? 'VC & Investment Ready' : 'Yatırıma Hazır Yapı', text: locale === 'en' ? 'Issue shares and attract venture capital.' : 'Hisse senedi ihracı ve kolay devri ile yatırım süreçleri için tek seçenektir.' },
          { title: locale === 'en' ? 'No Partner Limit' : 'Sınırsız Ortaklık', text: locale === 'en' ? 'No upper limit on shareholding partners.' : 'Ortak sayısında üst limit yoktur; halka açılma potansiyeline sahiptir.' },
          { title: locale === 'en' ? 'Prestigious Governance' : 'Yönetim Kurulu Gücü', text: locale === 'en' ? 'Structured management boards.' : 'Yönetim Kurulu yapısıyla kurumsal yönetim standartları en yüksek seviyededir.' },
        ];

  // Steps
  const steps = isSole
    ? [
        { step: '01', title: locale === 'en' ? 'ID & Address' : 'Kimlik & Adres Teyidi', desc: locale === 'en' ? 'Provide basic details online.' : 'Kimlik fotokopisi ve e-Devlet ikametgah belgesini online yükleyin.' },
        { step: '02', title: locale === 'en' ? 'Tax Registry' : 'Vergi Dairesi Kaydı', desc: locale === 'en' ? 'We submit your application.' : 'İşe başlama bildirimini sizin adınıza Gelir İdaresi\'ne iletiyoruz.' },
        { step: '03', title: locale === 'en' ? 'Yoklama & Active' : 'Yoklama & Açılış', desc: locale === 'en' ? 'Official check and active status.' : 'Vergi memuru yoklamasının ardından faturanızı kesmeye başlayın.' },
      ]
    : isLimited
      ? [
          { step: '01', title: locale === 'en' ? 'Articles of Association' : 'Ana Sözleşme Hazırlığı', desc: locale === 'en' ? 'Drafting rules and capital.' : 'Ortaklık yapısı, sermaye ve unvan bilgileriyle MERSİS kaydı açılır.' },
          { step: '02', title: locale === 'en' ? 'Notary & Trade Registry' : 'Noter Onayı & Tescil', desc: locale === 'en' ? 'Official registration phase.' : 'Ana sözleşme imzalanır, tescil işlemleri Ticaret Odası\'nda tamamlanır.' },
          { step: '03', title: locale === 'en' ? 'Tax Office & Signature' : 'Vergi Dairesi & İmza Sirküleri', desc: locale === 'en' ? 'Active corporate status.' : 'Vergi levhası çıkarılır, şirket müdürü imza sirkülerini düzenler.' },
        ]
      : [
          { step: '01', title: locale === 'en' ? 'MERSİS & Trade Name' : 'MERSİS & Unvan Rezervi', desc: locale === 'en' ? 'Reserve company name and draft charter.' : 'Şirket unvanı belirlenir, ana sözleşme MERSİS üzerinden hazırlanır.' },
          { step: '02', title: locale === 'en' ? 'Capital Blockage & Trade Registry' : 'Sermaye Blokajı & Tescil', desc: locale === 'en' ? 'Official registration process.' : 'Esas sermayenin 1/4\'ü bankada bloke edilir, Ticaret Odası tescili tamamlanır.' },
          { step: '03', title: locale === 'en' ? 'Board & Tax Registration' : 'Yönetim Kurulu & Vergi Açılışı', desc: locale === 'en' ? 'Structured active status.' : 'Yönetim kurulu imza yetkileri tescil edilir, vergi levhası çıkarılarak süreç bitirilir.' },
        ];

  return (
    <section className="section company-landing-page">
      {/* Foreign Investor Incentives Badge */}
      {locale !== 'tr' && (
        <div className="foreign-investor-incentive-badge">
          ✈️ <strong>Foreign Investor Privilege:</strong> 100% corporate ownership, full repatriation of capital, and 0% VAT on service exports from Turkey!
        </div>
      )}

      <div className="section-head">
        <div className="pill">
          {isSole ? 'Freelancer & Solo' : isLimited ? 'Corporate & Partner' : 'Enterprise & Investor'}
        </div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="landing-features-grid">
        {features.map((feat, i) => (
          <div className="card feature-card lift" key={i}>
            <div className="feature-icon">✓</div>
            <h3>{feat.title}</h3>
            <p>{feat.text}</p>
          </div>
        ))}
      </div>

      <div className="landing-layout">
        <div className="landing-content card">
          <h2>{locale === 'en' ? 'Step-by-Step Setup Process' : 'Adım Adım Kuruluş Süreci'}</h2>
          <p>
            {locale === 'en'
              ? 'Our experienced CPAs manage the entire workflow digitally. No physical office visits needed.'
              : 'Deneyimli mali müşavir ekibimiz tüm süreci online olarak yönetir. Vergi dairesine gitmenize gerek kalmaz.'}
          </p>
          
          <div className="landing-steps">
            {steps.map((st) => (
              <div className="landing-step-row" key={st.step}>
                <div className="landing-step-num">{st.step}</div>
                <div>
                  <h4>{st.title}</h4>
                  <p>{st.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="landing-comparison-notice">
            <strong>💡 {locale === 'en' ? 'Did you know?' : 'Biliyor muydunuz?'}</strong>
            <p>
              {isSole
                ? (locale === 'en'
                    ? 'You can easily upgrade your sole proprietorship to a limited company in the future if your sales grow.'
                    : 'Şahıs şirketi olarak başlayıp, işleriniz büyüdükçe limited şirkete geçiş yapabilirsiniz.')
                : isLimited
                  ? (locale === 'en'
                      ? 'Limited companies pay a flat corporate tax rate, making it highly advantageous for high income brackets.'
                      : 'Limited şirketler sabit kurumlar vergisi öder. Yüksek ciro beklentisi olan işlerde vergi yükünü hafifletir.')
                  : (locale === 'en'
                      ? 'Joint Stock Companies (A.Ş.) shares sold after 2 years are completely exempt from income tax.'
                      : 'Anonim şirketlerde, 2 yıldan fazla elde tutulan hisse senetlerinin satışı gelir vergisinden tamamen muaftır.')}
            </p>
          </div>
        </div>

        <div className="landing-sidebar card">
          <h3>{locale === 'en' ? 'Start Formation Process' : 'Kurulumu Başlatın'}</h3>
          <p>
            {locale === 'en'
              ? 'Fill out the wizard form with pre-filled configuration. Our team will contact you via WhatsApp immediately.'
              : 'Seçtiğiniz şirket tipine özel evrak listesini görmek ve süreci başlatmak için sihirbaza geçiş yapın.'}
          </p>
          <button 
            className="cta cta-whatsapp full" 
            onClick={() => onStartWizard(isSole ? 'sole' : isLimited ? 'limited' : 'anon')}
          >
            🚀 {locale === 'en' ? 'Open Setup Wizard' : 'Sihirbaza Git & Evrakları Gör'}
          </button>
        </div>
      </div>

      {/* COMPARISON MATRIX (Şirket Tipleri Karşılaştırma Matrisi) */}
      <div className="comparison-matrix-section card mt-12" style={{ marginTop: '48px', padding: '32px' }}>
        <h2 style={{ fontSize: '1.8rem', marginBottom: '16px', fontWeight: '800' }}>
          {locale === 'en' ? 'Company Type Comparison Matrix' : 'Şirket Tipleri Karşılaştırma Matrisi'}
        </h2>
        <p style={{ color: '#64748b', marginBottom: '24px' }}>
          {locale === 'en'
            ? 'Compare legal structures, tax obligations, and costs to make the right choice.'
            : 'İşinize en uygun yapıyı seçmek için yasal sorumlulukları, vergi oranlarını ve kuruluş detaylarını karşılaştırın.'}
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table className="comparison-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(15,23,42,0.08)' }}>
                <th style={{ padding: '12px', fontWeight: '700' }}>{locale === 'en' ? 'Feature' : 'Kriter / Özellik'}</th>
                <th style={{ padding: '12px', fontWeight: '700', color: 'var(--teal)' }}>{locale === 'en' ? 'Sole Proprietorship' : 'Şahıs Şirketi'}</th>
                <th style={{ padding: '12px', fontWeight: '700', color: 'var(--blue)' }}>{locale === 'en' ? 'Limited Company (Ltd. Şti.)' : 'Limited Şirket'}</th>
                <th style={{ padding: '12px', fontWeight: '700', color: 'var(--purple)' }}>{locale === 'en' ? 'Joint Stock Company (A.Ş.)' : 'Anonim Şirket'}</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid rgba(15,23,42,0.04)' }}>
                <td style={{ padding: '12px', fontWeight: '600' }}>{locale === 'en' ? 'Establishment Time' : 'Kuruluş Süresi'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? '1 Business Day' : '1 İş Günü'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? '2-3 Business Days' : '2-3 İş Günü'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? '3-4 Business Days' : '3-4 İş Günü'}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(15,23,42,0.04)' }}>
                <td style={{ padding: '12px', fontWeight: '600' }}>{locale === 'en' ? 'Min. Capital' : 'Minimum Sermaye'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? 'None' : 'Yok'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? '50,000 TRY' : '50.000 TL'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? '250,000 TRY' : '250.000 TL'}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(15,23,42,0.04)' }}>
                <td style={{ padding: '12px', fontWeight: '600' }}>{locale === 'en' ? 'Tax Type & Rate' : 'Vergi Oranı ve Türü'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? 'Progressive (15% - 40%)' : 'Gelir Vergisi (%15 - %40 arası kademeli)'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? 'Flat Corporate Tax (%25)' : 'Kurumlar Vergisi (%25 sabit)'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? 'Flat Corporate Tax (%25)' : 'Kurumlar Vergisi (%25 sabit)'}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(15,23,42,0.04)' }}>
                <td style={{ padding: '12px', fontWeight: '600' }}>{locale === 'en' ? 'Liability' : 'Borçlardan Sorumluluk'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? 'Unlimited (Personal assets)' : 'Sınırsız (Tüm şahsi mal varlığı)'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? 'Limited to capital (except public debts)' : 'Sermaye payı ile sınırlı (kamu borçları hariç)'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? 'Limited to capital contribution only' : 'Sadece taahhüt edilen sermaye ile sınırlı'}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(15,23,42,0.04)' }}>
                <td style={{ padding: '12px', fontWeight: '600' }}>{locale === 'en' ? 'Number of Partners' : 'Ortak Sayısı'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? 'Only 1 (Solo)' : 'Tek Ortaklı veya En Çok 50 Ortak'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? '1 to Unlimited' : 'Tek Ortaklı veya Sınırsız'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? '1 to Unlimited' : 'Tek Ortaklı veya Sınırsız'}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(15,23,42,0.04)' }}>
                <td style={{ padding: '12px', fontWeight: '600' }}>{locale === 'en' ? 'Share Transfer' : 'Hisse Devri'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? 'Not Applicable' : 'Uygulanamaz'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? 'Notary Approval Required' : 'Noter Onayı ve Sicil Tescili Şart'}</td>
                <td style={{ padding: '12px' }}>{locale === 'en' ? 'Easy (Transfer of shares privately)' : 'Çok Kolay (Yalnızca hisse devir defteri kaydı)'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* COST CALCULATOR WIDGET */}
      <Suspense fallback={<div className="skeleton-card shimmer"><div className="skeleton-line title" /></div>}>
        <CostCalculator locale={locale} />
      </Suspense>
    </section>
  );
}

export default CompanyLandingPage;
