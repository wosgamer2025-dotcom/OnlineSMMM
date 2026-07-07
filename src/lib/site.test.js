import { describe, expect, it } from 'vitest';
import {
  applySettingsEnvelope,
  buildTelHref,
  composeLeadMessage,
  computeDiscountedPrice,
  createSettingsEnvelope,
  ensureExternalUrl,
  getExperimentBucket,
  validateLeadForm,
} from './site';

describe('site helpers', () => {
  it('computes discounted prices', () => {
    expect(computeDiscountedPrice(1000, 20)).toBe(800);
  });

  it('normalizes phone links', () => {
    expect(buildTelHref('0555 000 00 00')).toBe('tel:+05550000000');
  });

  it('normalizes external URLs', () => {
    expect(ensureExternalUrl('instagram.com/onlinesmmm2026')).toBe('https://instagram.com/onlinesmmm2026');
  });

  it('validates lead form fields', () => {
    expect(validateLeadForm({ name: '', phone: '12', email: 'bad', companyName: '' })).toMatchObject({
      name: expect.any(String),
      phone: expect.any(String),
      email: expect.any(String),
      companyName: expect.any(String),
    });
  });

  it('does not block compact wizard flow on hidden address fields', () => {
    expect(
      validateLeadForm(
        {
          name: 'Ada',
          phone: '05550000000',
          email: 'ada@example.com',
          companyName: 'Acme',
          address: 'Kocatepe Mah. No:48 İzmir/Konak',
        },
        'tr',
        { requireTcId: false, requireAddressDetails: false },
      ),
    ).toEqual({});
  });

  it('creates a whatsapp-ready lead message', () => {
    const message = composeLeadMessage({
      selectedWizard: { label: 'Limited', docs: ['ID', 'Address'] },
      leadForm: { name: 'Ada', phone: '555', email: 'ada@example.com', companyName: 'Acme' },
      wizardEstimate: '5.000 ₺',
      sourceLabel: 'pricing-card',
    });
    expect(message).toContain('Limited');
    expect(message).toContain('pricing-card');
  });

  it('merges persisted settings envelope safely', () => {
    const defaults = createSettingsEnvelope({ websiteUrl: 'https://www.onlinesmmm.com' });
    const merged = applySettingsEnvelope(
      {
        published: { websiteUrl: 'https://example.com' },
        auditLog: [{ id: 1 }],
      },
      defaults.published,
    );
    expect(merged.published.websiteUrl).toBe('https://example.com');
    expect(merged.draft.websiteUrl).toBe('https://example.com');
    expect(merged.auditLog).toHaveLength(1);
  });

  it('creates an experiment bucket', () => {
    expect(['variant-a', 'variant-b']).toContain(getExperimentBucket('hero-copy'));
  });
});
