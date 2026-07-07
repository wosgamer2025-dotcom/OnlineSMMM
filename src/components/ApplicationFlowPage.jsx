import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmailField, InputField, PhoneField, SelectField } from './ApplicationFields';
import ApplicationPaymentPanel from './ApplicationPaymentPanel';
import ApplicationSummaryPanel from './ApplicationSummaryPanel';
import TurnstileWidget from './TurnstileWidget';

function ApplicationFlowPage({
  locale,
  wizardCopy,
  wizardData,
  selectedCompanyType,
  selectCompanyType,
  activityCatalog,
  selectedMainActivity,
  activitySummary,
  activityForm,
  updateActivityForm,
  uploadedFiles,
  uploadErrors,
  onFileChange,
  removeUploadedFile,
  clearUploadedFiles,
  fileSummary,
  leadForm,
  leadErrors,
  updateLeadForm,
  provinceOptions,
  districtOptions,
  neighborhoodOptions,
  selectedProvince,
  selectedDistrict,
  leadSubmitState,
  submitApplication,
  turnstileSiteKey,
  applicationId,
  applicationTurnstileToken,
  applicationTurnstileResetVersion,
  onApplicationTurnstileTokenChange,
  wizardEstimate,
  paymentState,
  onStartPayment,
  onStepAdvance,
  onValidateStep,
}) {
  const isEnglish = locale === 'en';
  const [flowStep, setFlowStep] = useState(1);
  const [stepSubmitting, setStepSubmitting] = useState(false);
  const autoPaymentStartedRef = useRef(false);
  const autoPaymentTimerRef = useRef(null);
  const carouselRef = useRef(null);
  const shellRef = useRef(null);
  const onStartPaymentRef = useRef(onStartPayment);

  useEffect(() => {
    onStartPaymentRef.current = onStartPayment;
  }, [onStartPayment]);

  useEffect(() => () => {
    if (autoPaymentTimerRef.current) {
      window.clearTimeout(autoPaymentTimerRef.current);
    }
  }, []);
  const activeWizard = wizardData.find((item) => item.id === selectedCompanyType) || wizardData[0];
  const describeFileType = (file) => {
    const mime = String(file?.type || '').toLowerCase();
    if (mime.includes('pdf')) return 'PDF';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'JPG';
    if (mime.includes('png')) return 'PNG';
    if (mime.includes('heic')) return 'HEIC';
    return String(file?.name || '').split('.').pop()?.toUpperCase() || 'FILE';
  };
  const stepTitles = useMemo(
    () =>
      isEnglish
        ? ['Welcome', 'Company Type', 'Main Activity', 'Documents', 'Contact', 'Address', 'Review', 'Payment', 'Submit']
        : ['Hoşgeldiniz', 'Şirket Türü', 'Ana Faaliyet', 'Evraklar', 'İletişim', 'Adres', 'Özet', 'Ödeme', 'Gönder'],
    [isEnglish],
  );
  const stepActionLabels = useMemo(
    () =>
      isEnglish
        ? {
          1: 'Start the setup',
          3: 'Save activity details',
          4: 'Confirm documents',
          5: 'Save contact details',
          6: 'Save address details',
          7: 'Complete application package',
          8: 'Restart secure payment',
          9: 'Submit application',
        }
        : {
          1: 'Kuruluma başla',
          3: 'Faaliyet bilgilerini kaydet',
          4: 'Evrakları onayla',
          5: 'İletişim bilgilerini kaydet',
          6: 'Adres bilgilerini kaydet',
          7: 'Başvuruyu tamamlamaya geç',
          8: 'Ödemeyi tekrar başlat',
          9: 'Başvuruyu gönder',
        },
    [isEnglish],
  );
  const paymentNextSteps = useMemo(
    () =>
      isEnglish
        ? ['Your application package is saved.', 'Secure payment opens automatically.', 'After payment, an advisor follows up with you.']
        : ['Başvuru paketiniz kaydedildi.', 'Güvenli ödeme otomatik açılır.', 'Ödeme sonrası danışmanınız sizinle iletişime geçer.'],
    [isEnglish],
  );
  const progressWidth = `${Math.max(8, (flowStep / stepTitles.length) * 100)}%`;
  const resolveCompanyTypeLabel = (companyType) => wizardData.find((item) => item.id === companyType)?.label || '';
  const buildStepSummary = (step, overrides = {}) => {
    const data = {
      companyType: overrides.selectedCompanyTypeLabel || resolveCompanyTypeLabel(overrides.selectedCompanyType) || activeWizard?.label || '',
      activity: [
        activitySummary?.mainActivity,
        activitySummary?.subActivity,
        activitySummary?.revenueMethod,
        activitySummary?.salesChannel,
      ].filter(Boolean).join(' / '),
      files: uploadedFiles.map((file) => file.name),
      contact: [leadForm.name, leadForm.phone, leadForm.email].filter(Boolean).join(' • '),
      address: [leadForm.addressDetail, leadForm.neighborhood, leadForm.district, leadForm.province].filter(Boolean).join(' / '),
      payment: paymentState?.status || 'idle',
      applicationId,
      ...overrides,
    };

    if (step === 2) return isEnglish ? `Company type selected: ${data.companyType || '-'}` : `Şirket türü seçildi: ${data.companyType || '-'}`;
    if (step === 3) return isEnglish ? `Activity set: ${data.activity || '-'}` : `Faaliyet seçildi: ${data.activity || '-'}`;
    if (step === 4) return isEnglish ? `Documents ready: ${data.files.length} file(s)` : `Evraklar hazır: ${data.files.length} dosya`;
    if (step === 5) return isEnglish ? `Contact filled: ${data.contact || '-'}` : `İletişim bilgileri doldu: ${data.contact || '-'}`;
    if (step === 6) return isEnglish ? `Address filled: ${data.address || '-'}` : `Adres bilgileri doldu: ${data.address || '-'}`;
    if (step === 7) return isEnglish ? 'Review completed' : 'Önizleme tamamlandı';
    if (step === 8) return isEnglish ? 'Payment step opened' : 'Ödeme adımı açıldı';
    if (step === 9) return isEnglish ? 'Application completed' : 'Başvuru tamamlandı';
    return isEnglish ? 'Wizard started' : 'Sihirbaz başlatıldı';
  };
  const reportStepAdvance = (currentStep, nextStep, extra = {}) => {
    const selectedTypeLabel = extra.selectedCompanyTypeLabel || resolveCompanyTypeLabel(extra.selectedCompanyType);
    const progress = {
      currentStep,
      nextStep,
      ratio: Number((nextStep / stepTitles.length).toFixed(3)),
      label: stepTitles[nextStep - 1] || stepTitles[currentStep - 1] || '',
    };
    onStepAdvance?.({
      step: currentStep,
      nextStep,
      progress,
      stepSummary: buildStepSummary(nextStep, extra),
      source: 'application-flow',
      selectedCompanyType: extra.selectedCompanyType || selectedCompanyType,
      selectedCompanyTypeLabel: selectedTypeLabel || activeWizard?.label || '',
    });
  };
  const companyCards = wizardData.map((item, index) => ({
    ...item,
    badge: isEnglish
      ? ['FASTEST', 'MOST POPULAR', 'FOR SCALE', 'GLOBAL'][index] || 'OPTION'
      : ['EN HIZLI', 'EN POPÜLER', 'ÖLÇEK İÇİN', 'GLOBAL'][index] || 'SEÇENEK',
    duration:
      item.id === 'sole'
        ? (isEnglish ? 'Same day' : 'Aynı gün')
        : item.id === 'limited'
          ? '1-2 iş günü'
          : item.id === 'global'
            ? '4-7 iş günü'
            : '2-3 iş günü',
    highlights:
      item.id === 'sole'
        ? isEnglish
          ? ['Low cost', 'Simple accounting', 'Founder incentive fit']
          : ['Düşük maliyet', 'Basit muhasebe', 'Genç girişimci desteği']
        : item.id === 'limited'
          ? isEnglish
            ? ['Limited liability', 'Corporate image', 'Partner friendly']
            : ['Sınırlı sorumluluk', 'Kurumsal imaj', 'Ortaklığa uygun']
          : item.id === 'global'
            ? isEnglish
              ? ['Country selection', 'Remote follow-up', 'Tax impact check']
              : ['Ülke seçimi', 'Uzaktan takip', 'Vergi etkisi kontrolü']
            : isEnglish
              ? ['Easy share transfer', 'Investor friendly', 'Scale-ready']
              : ['Hisse devri kolay', 'Yatırım almaya uygun', 'Ölçeklenebilir yapı'],
  }));

  const goToStep = (nextStep, extra = {}) => {
    setFlowStep((current) => {
      if (nextStep > current) {
        reportStepAdvance(current, nextStep, extra);
      }
      return nextStep;
    });
  };
  const goBack = () => setFlowStep((current) => {
    if (current === 8) {
      autoPaymentStartedRef.current = false;
    }
    return Math.max(1, current - 1);
  });
  const scrollCompanyCards = (direction) => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    carousel.scrollBy({
      left: direction * Math.max(280, carousel.clientWidth * 0.72),
      behavior: 'smooth',
    });
  };

  const selectAndContinue = (companyType) => {
    const companyTypeLabel = resolveCompanyTypeLabel(companyType);
    selectCompanyType(companyType);
    goToStep(3, { selectedCompanyType: companyType, selectedCompanyTypeLabel: companyTypeLabel });
  };

  useEffect(() => {
    if (paymentState?.status === 'success') {
      goToStep(9, { paymentStatus: 'success' });
    }
  }, [paymentState?.status]);

  const handlePaymentStart = useCallback(async () => {
    await onStartPaymentRef.current?.();
  }, []);

  const triggerAutoPaymentStart = useCallback(() => {
    if (autoPaymentStartedRef.current) return;
    autoPaymentStartedRef.current = true;
    if (autoPaymentTimerRef.current) {
      window.clearTimeout(autoPaymentTimerRef.current);
    }
    autoPaymentTimerRef.current = window.setTimeout(async () => {
      await handlePaymentStart();
      autoPaymentTimerRef.current = null;
    }, 80);
  }, [handlePaymentStart]);

  useEffect(() => {
    if (flowStep === 8 && ['idle', 'error'].includes(paymentState?.status || 'idle')) {
      triggerAutoPaymentStart();
    }
  }, [flowStep, paymentState?.status, triggerAutoPaymentStart]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      shellRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [flowStep]);

  const handleNext = async () => {
    if (stepSubmitting) return;
    setStepSubmitting(true);
    try {
      const isStepValid = await onValidateStep?.(flowStep);
      if (isStepValid === false) return;
      const nextStep = Math.min(stepTitles.length, flowStep + 1);
      if (flowStep === 7) {
        goToStep(8, { paymentReady: true });
        triggerAutoPaymentStart();
        return;
      }
      goToStep(nextStep);
    } finally {
      setStepSubmitting(false);
    }
  };

  const paymentActionLabel = paymentState?.status === 'error'
    ? stepActionLabels[8]
    : paymentState?.status === 'redirecting'
      ? (isEnglish ? 'Opening secure completion...' : 'Güvenli tamamlama açılıyor...')
      : (isEnglish ? 'Preparing completion...' : 'Tamamlama hazırlanıyor...');

  return (
    <main className="application-page">
      <div className="application-flow-shell" ref={shellRef}>
        <div className="application-top-progress" aria-label={isEnglish ? 'Application progress' : 'Başvuru ilerleme'}>
          <button type="button" className="application-back-button" onClick={goBack} disabled={flowStep === 1} aria-label={isEnglish ? 'Previous step' : 'Önceki adım'}>
            ←
          </button>
          <div className="application-progress-copy">
            <strong>{stepTitles[flowStep - 1]}</strong>
            <span style={{ width: progressWidth }} />
          </div>
          <em><span className="application-progress-check" key={flowStep}>✓</span>{flowStep} / {stepTitles.length}</em>
        </div>

        <section className={`application-wizard-card application-step-${flowStep}`} key={flowStep}>
          {flowStep === 1 && (
            <div className="application-welcome">
              <h1>{isEnglish ? 'Welcome' : 'Hoşgeldiniz'} <span aria-hidden="true">👋</span></h1>
              <p>
                <strong>{isEnglish ? 'Let’s set up your company.' : 'Şirketinizi hemen kuralım.'}</strong>{' '}
                {isEnglish
                  ? 'We complete your company type, activity, documents and payment in a few steps. Average 2 minutes.'
                  : 'Birkaç adımda türünü, faaliyetini, evraklarını ve ödemenizi tamamlıyoruz. Ortalama 2 dakika.'}
              </p>
              <div className="application-benefit-list">
                {(isEnglish
                  ? ['No bureaucracy', 'Registration in 1 business day', 'Advisor follows up with you']
                  : ['Bürokrasi yok', '1 iş gününde tescil', 'Danışman size dönüş yapar']
                ).map((item) => (
                  <span key={item}>✓ {item}</span>
                ))}
              </div>
              <button type="button" className="application-main-button" onClick={handleNext} disabled={stepSubmitting}>
                {stepActionLabels[1]} <span>→</span>
              </button>
              <a className="application-home-link" href={isEnglish ? '/en' : '/'}>{isEnglish ? 'Back to home' : 'Ana sayfaya dön'}</a>
            </div>
          )}

          {flowStep === 2 && (
            <div className="application-choice-step">
              <h2>{isEnglish ? 'Which company type should we set up?' : 'Hangi tür şirket kuralım?'}</h2>
              <p>{isEnglish ? 'Let’s choose the structure that fits you best.' : 'Sana en uygun yapıyı birlikte seçelim'}</p>
              <div className="application-carousel-toolbar" aria-label={isEnglish ? 'Company type controls' : 'Şirket türü kaydırma kontrolleri'}>
                <button type="button" onClick={() => scrollCompanyCards(-1)} aria-label={isEnglish ? 'Scroll left' : 'Sola kaydır'}>←</button>
                <small>{isEnglish ? 'Choose or scroll' : 'Seç ya da kaydır'}</small>
                <button type="button" onClick={() => scrollCompanyCards(1)} aria-label={isEnglish ? 'Scroll right' : 'Sağa kaydır'}>→</button>
              </div>
              <div className="application-company-carousel" ref={carouselRef}>
                {companyCards.map((item) => (
                  <button
                    type="button"
                    className={`application-type-card ${selectedCompanyType === item.id ? 'active' : ''}`}
                    key={item.id}
                    onClick={() => selectAndContinue(item.id)}
                  >
                    <em>{item.badge}</em>
                    <strong>{item.label}</strong>
                    <span>{item.duration} • {item.id === 'sole' ? wizardEstimate : item.summary}</span>
                    <ul>
                      {item.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                    </ul>
                  </button>
                ))}
              </div>
            </div>
          )}

          {flowStep === 3 && (
            <ApplicationFormStep
              title={wizardCopy.activityTitle}
              copy=""
              onBack={goBack}
              onNext={handleNext}
              nextLabel={stepActionLabels[3]}
              nextDisabled={stepSubmitting}
              stepStatus={isEnglish ? 'Activity step' : 'Faaliyet adımı'}
            >
              <div className="application-field-grid">
                <label>{wizardCopy.mainActivity}<select value={activityForm.mainActivity} onChange={(event) => updateActivityForm('mainActivity', event.target.value)}>{activityCatalog.mainActivities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <label>{wizardCopy.subActivity}<select value={activityForm.subActivity} onChange={(event) => updateActivityForm('subActivity', event.target.value)}>{selectedMainActivity.subActivities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <label>{wizardCopy.revenueMethod}<select value={activityForm.revenueMethod} onChange={(event) => updateActivityForm('revenueMethod', event.target.value)}>{activityCatalog.revenueMethods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <label>{wizardCopy.salesChannel}<select value={activityForm.salesChannel} onChange={(event) => updateActivityForm('salesChannel', event.target.value)}>{activityCatalog.salesChannels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              </div>
            </ApplicationFormStep>
          )}

          {flowStep === 4 && (
            <ApplicationFormStep
              title={wizardCopy.documentUploadTitle}
              copy={isEnglish ? 'Upload only the required documents for this application.' : 'Bu aşamada sadece Kimlik Fotokopisi ile Kira Kontratı (varsa) yükleyin.'}
              onBack={goBack}
              onNext={handleNext}
              nextLabel={stepActionLabels[4]}
              nextDisabled={stepSubmitting}
              stepStatus={isEnglish ? 'Document step' : 'Evrak adımı'}
            >
              <div className="application-doc-checklist">
                <strong>{isEnglish ? `Requested documents for ${activeWizard.label}` : `${activeWizard.label} için istenen evraklar`}</strong>
                <div>
                  {activeWizard.docs.map((documentName) => (
                    <span key={documentName}>✓ {documentName}</span>
                  ))}
                </div>
              </div>
              <div className="application-upload-actions">
                <label className="application-camera-button">
                  <input type="file" accept="image/*" capture="environment" onChange={onFileChange} />
                  {isEnglish ? 'Take photo' : 'Kamerayla çek'}
                </label>
                <label className="application-file-button">
                  <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,image/*" onChange={onFileChange} />
                  {isEnglish ? 'Choose file' : 'Dosya seç'}
                </label>
              </div>
              <label className="application-upload-drop">
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,image/*" onChange={onFileChange} />
                <strong>{wizardCopy.documentUploadCopy}</strong>
                <span>PDF, JPG, PNG - max 15 MB</span>
                <em>{fileSummary}</em>
              </label>
              {!!uploadErrors.length && <div className="upload-errors wizard-upload-errors" role="alert">{uploadErrors.map((error) => <p key={error}>{error}</p>)}</div>}
              {!!uploadedFiles.length && (
                <div className="application-file-list">
                  <div>
                    <strong>{wizardCopy.selectedFiles}</strong>
                    <button type="button" className="cta cta-ghost small" onClick={clearUploadedFiles}>{wizardCopy.clearFiles}</button>
                  </div>
                  {uploadedFiles.map((file, index) => (
                    <span key={`${file.name}-${file.size}`}>
                      {file.name}
                      <small>{describeFileType(file)} • {Math.ceil(file.size / 1024)} KB</small>
                      <button type="button" onClick={() => removeUploadedFile(index)}>{wizardCopy.removeFile}</button>
                    </span>
                  ))}
                </div>
              )}
            </ApplicationFormStep>
          )}

          {flowStep === 5 && (
            <ApplicationFormStep
              title={isEnglish ? 'Contact information' : 'İletişim bilgileri'}
              copy={'\u00A0'}
              onBack={goBack}
              onNext={handleNext}
              nextLabel={stepActionLabels[5]}
              nextDisabled={stepSubmitting}
              stepStatus={isEnglish ? 'Contact step' : 'İletişim adımı'}
            >
              <div className="application-field-grid application-contact-grid">
                <div className="application-contact-name">
                  <InputField label={wizardCopy.name} value={leadForm.name} error={leadErrors.name} onChange={(value) => updateLeadForm('name', value)} autoComplete="name" required />
                </div>
                <div className="application-contact-phone">
                  <PhoneField label={wizardCopy.phone} value={leadForm.phone} error={leadErrors.phone} onChange={(value) => updateLeadForm('phone', value)} required />
                </div>
                <div className="application-contact-email">
                  <EmailField label={wizardCopy.email} value={leadForm.email} error={leadErrors.email} onChange={(value) => updateLeadForm('email', value)} required />
                </div>
                <div className="application-contact-company">
                  <InputField label={wizardCopy.companyName} value={leadForm.companyName} error={leadErrors.companyName} onChange={(value) => updateLeadForm('companyName', value)} autoComplete="organization" required />
                </div>
                <div className="application-contact-tc">
                  <InputField label={isEnglish ? 'T.C. Identity Number' : 'T.C. Kimlik Numarası'} value={leadForm.tcId} error={leadErrors.tcId} onChange={(value) => updateLeadForm('tcId', value.replace(/\D/g, '').slice(0, 11))} type="text" inputMode="numeric" autoComplete="off" required />
                </div>
              </div>
            </ApplicationFormStep>
          )}

          {flowStep === 6 && (
            <ApplicationFormStep
              title={isEnglish ? 'Address details' : 'Adres bilgileri'}
              copy={isEnglish ? 'This helps us prepare the correct registration flow.' : 'Tescil için şirket adres bilgisi gerekir.'}
              onBack={goBack}
              onNext={handleNext}
              nextLabel={stepActionLabels[6]}
              nextDisabled={stepSubmitting}
              stepStatus={isEnglish ? 'Address step' : 'Adres adımı'}
            >
              <div className="application-field-grid">
                <SelectField label={wizardCopy.province} value={leadForm.province} error={leadErrors.province} onChange={(value) => updateLeadForm('province', value)} required>
                  <option value="">{isEnglish ? 'Select province' : 'İl seçin'}</option>
                  {provinceOptions.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                </SelectField>
                <SelectField label={wizardCopy.district} value={leadForm.district} error={leadErrors.district} onChange={(value) => updateLeadForm('district', value)} disabled={!selectedProvince} required>
                  <option value="">{isEnglish ? 'Select district' : 'İlçe seçin'}</option>
                  {districtOptions.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                </SelectField>
                <SelectField label={wizardCopy.neighborhood} value={leadForm.neighborhood} error={leadErrors.neighborhood} onChange={(value) => updateLeadForm('neighborhood', value)} disabled={!selectedDistrict} required>
                  <option value="">{isEnglish ? 'Select neighborhood' : 'Mahalle seçin'}</option>
                  {neighborhoodOptions.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                </SelectField>
                <InputField label={wizardCopy.addressDetail} value={leadForm.addressDetail} error={leadErrors.addressDetail || leadErrors.address} onChange={(value) => updateLeadForm('addressDetail', value)} autoComplete="street-address" required />
              </div>
            </ApplicationFormStep>
          )}

          {flowStep === 7 && (
            <ApplicationFormStep
              title={isEnglish ? 'Application review' : 'Başvuru kontrolü'}
              copy=""
              onBack={goBack}
              onNext={handleNext}
              nextLabel={stepActionLabels[7]}
              nextDisabled={stepSubmitting}
              stepStatus={isEnglish ? 'Application review' : 'Başvuru kontrolü'}
            >
              <ApplicationSummaryPanel
                isEnglish={isEnglish}
                activeWizard={activeWizard}
                wizardEstimate={wizardEstimate}
                leadForm={leadForm}
                activitySummary={activitySummary}
                uploadedFiles={uploadedFiles}
                applicationId={applicationId}
              />
            </ApplicationFormStep>
          )}

          {flowStep === 8 && (
            <ApplicationFormStep
              title={isEnglish ? 'Secure payment step' : 'Güvenli ödeme adımı'}
              copy={paymentState?.status === 'error'
                ? (isEnglish ? 'Your application package is ready. Restart secure payment to complete it.' : 'Başvuru paketiniz hazır. Tamamlamak için güvenli ödemeyi tekrar başlatın.')
                : (isEnglish ? 'Your application package is ready. Secure completion is opening automatically.' : 'Başvuru paketiniz hazır. Güvenli tamamlama otomatik açılıyor.')}
              onBack={goBack}
              onNext={handlePaymentStart}
              nextLabel={paymentActionLabel}
              nextDisabled={paymentState?.status !== 'error'}
              stepStatus={isEnglish ? 'Completion step' : 'Tamamlama adımı'}
            >
              <ApplicationPaymentPanel
                isEnglish={isEnglish}
                paymentState={paymentState}
                activeWizard={activeWizard}
                wizardEstimate={wizardEstimate}
                applicationId={applicationId}
                uploadedFiles={uploadedFiles}
                nextSteps={paymentNextSteps}
              />
            </ApplicationFormStep>
          )}

          {flowStep === 9 && (
            <div className="application-final-step">
              <div className="application-icon-tile" aria-hidden="true">✓</div>
              <h2>{paymentState?.status === 'success' ? (isEnglish ? 'Congratulations, payment received' : 'Hayırlı olsun, ödemeniz alındı') : (isEnglish ? 'Ready to submit?' : 'Başvuruyu göndermeye hazır mısın?')}</h2>
              <p>
                {paymentState?.status === 'success'
                  ? (isEnglish
                    ? 'Thank you, your payment has been received. Our advisor will contact you as soon as possible with the next steps.'
                    : 'Teşekkürler, ödemeniz alınmıştır. Danışmanımız en kısa zamanda sizinle iletişime geçecek, gerekli bilgilendirmeleri yapacaktır.')
                  : (isEnglish ? 'Your request will be saved and forwarded to the operations team.' : 'Başvurun kaydedilir ve operasyon ekibine iletilir.')}
              </p>
              {paymentState?.status === 'success' ? (
                <button type="button" className="application-secondary-button" onClick={goBack}>
                  {isEnglish ? 'Review previous step' : 'Önceki adımı kontrol et'}
                </button>
              ) : (
                <>
                  <TurnstileWidget
                    siteKey={turnstileSiteKey}
                    action="turnstile-spin-v1"
                    label={isEnglish ? 'Turnstile verification' : 'Turnstile doğrulaması'}
                    onTokenChange={onApplicationTurnstileTokenChange}
                    resetVersion={applicationTurnstileResetVersion}
                  />
                  <button
                    type="button"
                    className="application-main-button"
                    onClick={() => submitApplication?.()}
                    disabled={leadSubmitState === 'submitting' || !applicationTurnstileToken}
                  >
                    {leadSubmitState === 'submitting' ? (isEnglish ? 'Sending...' : 'Gönderiliyor...') : stepActionLabels[9]}
                  </button>
                  <button type="button" className="application-secondary-button" onClick={goBack}>{isEnglish ? 'Review previous step' : 'Önceki adımı kontrol et'}</button>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ApplicationFormStep({ title, copy, helperText, children, onBack, onNext, nextLabel, nextDisabled = false, stepStatus }) {
  const hasCopy = String(copy || '').trim().length > 0;
  return (
    <div className="application-form-step">
      {stepStatus ? <span className="application-step-status">{stepStatus}</span> : null}
      <h2>{title}</h2>
      {hasCopy ? <p>{copy}</p> : null}
      {helperText ? <small className="application-step-helper">{helperText}</small> : null}
      {children}
      <div className="application-step-actions">
        <button type="button" className="application-secondary-button" onClick={onBack}>Geri</button>
        <button type="button" className="application-main-button" onClick={onNext} disabled={nextDisabled} aria-busy={nextDisabled}>
          <span className="application-button-check" aria-hidden="true">✓</span>
          {nextLabel}
          <span>→</span>
        </button>
      </div>
    </div>
  );
}

export default ApplicationFlowPage;
