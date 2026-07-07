import { sendMailWithRetry } from '../server/server.js';

process.env.MAIL_TIMEOUT_MS = process.env.MAIL_TIMEOUT_MS || '60000';
process.env.LOGIN_MAIL_TIMEOUT_MS = process.env.LOGIN_MAIL_TIMEOUT_MS || '60000';

const recipient = process.argv[2] || process.env.MAIL_PROBE_TO || 'bilgi@onlinesmmm.com';
const store = {
  siteSettings: { primaryDomain: 'onlinesmmm.com' },
  mailDeliveries: [],
  auditLogs: [],
  crmEvents: [],
  customers: [],
  payments: [],
  messages: [],
  whatsappConnections: [],
  users: [],
};

const result = await sendMailWithRetry(
  store,
  {
    to: recipient,
    subject: 'OnlineSMMM Brevo canlı teslim testi',
    html: '<p>OnlineSMMM Brevo SMTP teslim testi.</p>',
  },
  {
    template: 'brevo_live_probe',
    requestId: 'codex-live-mail-probe',
    recipient,
  },
  { maxAttempts: 1, timeoutMs: Number(process.env.LOGIN_MAIL_TIMEOUT_MS || 60000) },
);

console.log(JSON.stringify({
  ok: result.ok,
  deliveryId: result.deliveryId,
  errorCode: result.errorCode || '',
  errorMessage: result.errorMessage || '',
  deliveries: store.mailDeliveries.map((delivery) => ({
    status: delivery.status,
    attempts: delivery.attempts,
    messageId: Boolean(delivery.messageId),
    durationMs: delivery.durationMs || 0,
    errorCode: delivery.errorCode || '',
  })),
}, null, 2));

process.exit(result.ok ? 0 : 1);
