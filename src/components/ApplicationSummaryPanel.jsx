import React from 'react';

function describeUploadFile(file) {
  const mime = String(file?.type || '').toLowerCase();
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'JPG';
  if (mime.includes('png')) return 'PNG';
  if (mime.includes('heic')) return 'HEIC';
  return String(file?.name || '').split('.').pop()?.toUpperCase() || 'FILE';
}

function ApplicationSummaryPanel({ isEnglish, activeWizard, wizardEstimate, leadForm, activitySummary, uploadedFiles, applicationId }) {
  return (
    <div className="application-summary-card">
      <div className="application-summary-grid application-summary-review">
        <span className="summary-compact"><small>{isEnglish ? 'Company type' : 'Şirket türü'}</small><strong>{activeWizard.label}</strong></span>
        <span className="summary-compact"><small>{isEnglish ? 'Campaign estimate' : 'Kampanyalı tahmin'}</small><strong>{wizardEstimate}</strong></span>
        <span className="summary-wide"><small>{isEnglish ? 'Application ID' : 'Başvuru ID'}</small><strong>{applicationId || '-'}</strong></span>
        <span className="summary-compact"><small>{isEnglish ? 'Name' : 'Ad soyad'}</small><strong>{leadForm.name || '-'}</strong></span>
        <span className="summary-compact"><small>{isEnglish ? 'Phone' : 'Telefon'}</small><strong>{leadForm.phone || '-'}</strong></span>
        <span className="summary-wide"><small>{isEnglish ? 'Email' : 'E-posta'}</small><strong>{leadForm.email || '-'}</strong></span>
        <span className="summary-compact"><small>{isEnglish ? 'Identity no' : 'T.C. Kimlik No'}</small><strong>{leadForm.tcId || '-'}</strong></span>
        <span className="summary-compact"><small>{isEnglish ? 'Company name' : 'Şirket adı'}</small><strong>{leadForm.companyName || '-'}</strong></span>
        <span className="summary-wide"><small>{isEnglish ? 'Address' : 'Adres'}</small><strong>{[leadForm.addressDetail, leadForm.neighborhood, leadForm.district, leadForm.province].filter(Boolean).join(' / ') || '-'}</strong></span>
        <span className="summary-wide"><small>{isEnglish ? 'Activity' : 'Faaliyet'}</small><strong>{[
          activitySummary?.mainActivity,
          activitySummary?.subActivity,
          activitySummary?.revenueMethod,
          activitySummary?.salesChannel,
        ].filter(Boolean).join(' / ') || '-'}</strong></span>
      </div>
      <div className="application-summary-files application-summary-files-inline">
        <strong>{isEnglish ? 'Uploaded files' : 'Yüklenen evraklar'}</strong>
        <p className="application-summary-file-count">
          {uploadedFiles.length
            ? `${uploadedFiles.length} ${isEnglish ? 'file(s)' : 'dosya'} • ${uploadedFiles.map((file) => describeUploadFile(file)).join(', ')}`
            : isEnglish
              ? 'No files uploaded yet.'
              : 'Henüz evrak yüklenmedi.'}
        </p>
        {uploadedFiles.length ? (
          <div className="application-summary-file-grid">
            {uploadedFiles.map((file) => (
              <span key={`${file.name}-${file.size}`}>
                {file.name}
                <small>{describeUploadFile(file)} • {Math.ceil(file.size / 1024)} KB</small>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ApplicationSummaryPanel;
