const apiKey = process.env.BREVO_API_KEY || process.env.MAIL_BREVO_API_KEY || process.env.MAIL_SMTP_PASS || '';
const to = process.argv[2] || process.env.MAIL_PROBE_TO || 'bilgi@onlinesmmm.com';

if (!apiKey) {
  console.error(JSON.stringify({ ok: false, error: 'brevo_api_key_missing' }));
  process.exit(1);
}

const response = await fetch('https://api.brevo.com/v3/smtp/email', {
  method: 'POST',
  headers: {
    accept: 'application/json',
    'api-key': apiKey,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    sender: { email: process.env.MAIL_FROM || 'bilgi@onlinesmmm.com', name: 'OnlineSMMM' },
    to: [{ email: to }],
    replyTo: { email: process.env.MAIL_REPLY_TO || process.env.MAIL_FROM || 'bilgi@onlinesmmm.com' },
    subject: 'OnlineSMMM Brevo API canlı testi',
    htmlContent: '<p>OnlineSMMM Brevo API teslim testi.</p>',
    textContent: 'OnlineSMMM Brevo API teslim testi.',
  }),
});

const data = await response.json().catch(() => ({}));
console.log(JSON.stringify({
  ok: response.ok,
  status: response.status,
  messageId: Boolean(data.messageId),
  code: data.code || '',
  message: data.message || '',
}, null, 2));

process.exit(response.ok ? 0 : 1);
