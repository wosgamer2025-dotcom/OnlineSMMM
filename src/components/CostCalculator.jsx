import React, { useState } from 'react';

function CostCalculator({ locale }) {
  const [companyType, setCompanyType] = useState('limited');
  const [partners, setPartners] = useState(1);
  const [capital, setCapital] = useState(50000);
  const [sector, setSector] = useState('service');

  // Multi-lingual labels
  const labels = {
    tr: {
      title: 'Dinamik Kurulum Maliyeti Hesaplayıcı',
      subtitle: 'Şirket tipinize, ortak ve sermaye yapınıza göre tescil masraflarını anında hesaplayın.',
      companyType: 'Şirket Türü',
      sole: 'Şahıs Şirketi',
      limited: 'Limited Şirket (Ltd. Şti.)',
      anon: 'Anonim Şirket (A.Ş.)',
      partnerCount: 'Ortak Sayısı',
      capitalAmount: 'Sermaye Tutarı',
      sectorType: 'Faaliyet Sektörü',
      service: 'Hizmet Sektörü / Yazılım / Danışmanlık',
      trade: 'Ticaret / E-Ticaret / İthalat-İhracat',
      production: 'Üretim / İnşaat / Ağır Sanayi',
      breakdown: 'Maliyet Kalemleri Kırılımı',
      notary: 'Noter İmza Beyanı ve Vekaletname',
      registry: 'Ticaret Odası Kayıt & Tescil Harcı',
      competition: 'Rekabet Kurumu Payı',
      blockage: 'Banka Sermaye Blokajı (1/4)',
      smmm: 'SMMM Kuruluş İşlemleri Hizmet Bedeli',
      total: 'Tahmini Tescil Maliyeti Toplamı',
      disclaimer: '* Hesaplanan tutarlar tahmini olup, ticaret odası tarifeleri ve noter harçlarındaki güncellemelere göre değişiklik gösterebilir.',
      minCapitalWarning: 'Sermaye bu şirket tipi için minimum sınırın altında kalıyor.',
    },
    en: {
      title: 'Dynamic Setup Cost Calculator',
      subtitle: 'Instantly calculate registration costs based on your company structure and capital.',
      companyType: 'Company Type',
      sole: 'Sole Proprietorship',
      limited: 'Limited Company (Ltd.)',
      anon: 'Joint Stock Company (JSC)',
      partnerCount: 'Number of Partners',
      capitalAmount: 'Capital Amount',
      sectorType: 'Activity Sector',
      service: 'Services / Software / Consulting',
      trade: 'Trade / E-commerce / Import-Export',
      production: 'Production / Construction / Heavy Industry',
      breakdown: 'Cost Breakdown',
      notary: 'Notary Documentation & Signatures',
      registry: 'Chamber of Commerce Registry Fees',
      competition: 'Competition Authority Fee',
      blockage: 'Bank Capital Blockage (1/4)',
      smmm: 'CPA Formation Service Fee',
      total: 'Estimated Total Setup Cost',
      disclaimer: '* Calculated fees are approximate and subject to notary and chamber rate updates.',
      minCapitalWarning: 'Capital is below the minimum legal requirement for this company type.',
    }
  };

  const l = labels[locale] || labels.tr;

  // Real-time calculations based on Turkish corporate regulations
  const calculateCosts = () => {
    let notaryCost = 0;
    let registryCost = 0;
    let competitionFee = 0;
    let blockageAmount = 0;
    let smmmFee = 0;

    const partnerFactor = Math.max(1, partners);
    const sectorPremium = sector === 'production' ? 1500 : sector === 'trade' ? 800 : 0;

    if (companyType === 'sole') {
      notaryCost = 450 * partnerFactor + 650; // signature declaration + tax proxy
      registryCost = 2200 + sectorPremium;
      smmmFee = 1500;
    } else if (companyType === 'limited') {
      notaryCost = 1200 * partnerFactor + 850;
      registryCost = 5400 + sectorPremium;
      competitionFee = capital * 0.0004; // 0.04% of capital
      smmmFee = 3500;
    } else if (companyType === 'anon') {
      notaryCost = 1500 * partnerFactor + 950;
      registryCost = 6800 + sectorPremium;
      competitionFee = capital * 0.0004;
      blockageAmount = capital * 0.25; // 25% blockage required for JSC
      smmmFee = 4500;
    }

    const totalCost = notaryCost + registryCost + competitionFee + smmmFee;

    return {
      notaryCost,
      registryCost,
      competitionFee,
      blockageAmount,
      smmmFee,
      totalCost
    };
  };

  const costs = calculateCosts();

  // Handle minimum capital rules
  const getMinCapital = () => {
    if (companyType === 'limited') return 50000;
    if (companyType === 'anon') return 250000;
    return 0;
  };

  const minCapital = getMinCapital();
  const hasCapitalWarning = capital < minCapital;

  const formatCurrency = (val) => {
    const formatter = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'tr-TR', {
      style: 'currency',
      currency: locale === 'en' ? 'USD' : 'TRY',
      maximumFractionDigits: 0
    });
    
    // For English locale, convert TRY to USD roughly for context representation
    const rate = locale === 'en' ? 0.043 : 1;
    return formatter.format(val * rate);
  };

  return (
    <div className="card cost-calculator-card lift">
      <h3 style={{ fontSize: '1.4rem', fontWeight: '800', marginBottom: '8px' }}>🚀 {l.title}</h3>
      <p style={{ color: '#64748b', fontSize: '0.92rem', marginBottom: '24px' }}>{l.subtitle}</p>

      <div className="calculator-layout">
        <div className="calculator-controls">
          <div className="calculator-control-group">
            <label>{l.companyType}</label>
            <select 
              className="calculator-select" 
              value={companyType} 
              onChange={(e) => {
                const type = e.target.value;
                setCompanyType(type);
                if (type === 'limited' && capital < 50000) setCapital(50000);
                if (type === 'anon' && capital < 250000) setCapital(250000);
              }}
            >
              <option value="sole">{l.sole}</option>
              <option value="limited">{l.limited}</option>
              <option value="anon">{l.anon}</option>
            </select>
          </div>

          <div className="calculator-control-group">
            <label>{l.partnerCount}</label>
            <div className="calculator-range-wrapper">
              <input 
                type="range" 
                min="1" 
                max="10" 
                value={partners} 
                onChange={(e) => setPartners(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span className="calculator-range-val">{partners}</span>
            </div>
          </div>

          {companyType !== 'sole' && (
            <div className="calculator-control-group">
              <label>{l.capitalAmount}</label>
              <input 
                type="number" 
                className="calculator-input"
                value={capital}
                onChange={(e) => setCapital(Math.max(0, Number(e.target.value)))}
                min={minCapital}
              />
              {hasCapitalWarning && (
                <small style={{ color: '#dc2626', fontWeight: '600', marginTop: '4px' }}>
                  ⚠️ {l.minCapitalWarning} (Min: {formatCurrency(minCapital)})
                </small>
              )}
            </div>
          )}

          <div className="calculator-control-group">
            <label>{l.sectorType}</label>
            <select 
              className="calculator-select" 
              value={sector} 
              onChange={(e) => setSector(e.target.value)}
            >
              <option value="service">{l.service}</option>
              <option value="trade">{l.trade}</option>
              <option value="production">{l.production}</option>
            </select>
          </div>
        </div>

        <div className="cost-breakdown-box">
          <h4 style={{ fontWeight: '700', marginBottom: '16px', borderBottom: '1px solid rgba(15,23,42,0.08)', paddingBottom: '8px' }}>
            📊 {l.breakdown}
          </h4>

          <div className="cost-row">
            <span>{l.notary}</span>
            <strong>{formatCurrency(costs.notaryCost)}</strong>
          </div>

          <div className="cost-row">
            <span>{l.registry}</span>
            <strong>{formatCurrency(costs.registryCost)}</strong>
          </div>

          {companyType !== 'sole' && (
            <div className="cost-row">
              <span>{l.competition}</span>
              <strong>{formatCurrency(costs.competitionFee)}</strong>
            </div>
          )}

          {companyType === 'anon' && (
            <div className="cost-row" style={{ color: '#0369a1' }}>
              <span>{l.blockage}</span>
              <strong>{formatCurrency(costs.blockageAmount)}</strong>
            </div>
          )}

          <div className="cost-row">
            <span>{l.smmm}</span>
            <strong>{formatCurrency(costs.smmmFee)}</strong>
          </div>

          <div className="cost-row total-row">
            <span>{l.total}</span>
            <span style={{ color: 'var(--blue)' }}>{formatCurrency(costs.totalCost)}</span>
          </div>

          <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '20px', lineHeight: '1.4' }}>
            {l.disclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}

export default CostCalculator;
