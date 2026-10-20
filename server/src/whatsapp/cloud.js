// Minimal client for Meta's WhatsApp Cloud API (graph.facebook.com). Used for WhatsApp OTPs.
//   - sendText: a free-form message. Free when it's a reply inside the 24-hour customer service window
//     (i.e. the user messaged us first), which is how OTP_PROVIDER=whatsapp_reply stays free.
//   - sendOtpTemplate: an approved AUTHENTICATION template (business-initiated, charged per message).
import crypto from 'node:crypto';
import { config } from '../config.js';

const endpoint = () => `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;

async function post(body) {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error || {};
    throw new Error(`WhatsApp API ${res.status}: ${e.message || 'request failed'}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return data;
}

/** Free-form text (to: digits with country code, e.g. 919876543210). */
export const sendText = (to, text) => post({ to, type: 'text', text: { body: text, preview_url: false } });

/** Authentication template with the code in the body and the copy-code button. */
export const sendOtpTemplate = (to, code) =>
  post({
    to,
    type: 'template',
    template: {
      name: config.whatsapp.otpTemplate,
      language: { code: config.whatsapp.otpTemplateLang },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  });

/** Checks Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret). */
export function validSignature(rawBody, header) {
  if (!config.whatsapp.appSecret || !header || !String(header).startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest();
  const given = Buffer.from(String(header).slice(7), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Text messages in a webhook payload: [{ from, id, text }]. */
export function incomingTexts(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value?.messages || []) {
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? '';
        if (m.from && text) out.push({ from: String(m.from).replace(/\D/g, ''), id: m.id, text: String(text) });
      }
    }
  }
  return out;
}
