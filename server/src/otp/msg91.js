// Minimal client for MSG91's WhatsApp API (https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/).
// Sends an approved AUTHENTICATION template (body = the code, "copy code" button = the code) from the WhatsApp
// number connected in the MSG91 panel. Business-initiated, so Meta charges per message (via the MSG91 wallet).
import { config } from '../config.js';

const ENDPOINT = 'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';

/** Sends `code` to an Indian mobile (digits with or without the 91 prefix). Resolves on success, throws otherwise. */
export async function sendOtpWhatsApp(phone, code) {
  const to = String(phone).replace(/\D/g, '').replace(/^(?=[6-9]\d{9}$)/, '91');
  if (!/^91[6-9]\d{9}$/.test(to)) throw new Error(`MSG91: not an Indian mobile number (${phone})`);
  const { authKey, whatsappNumber, template, templateLang, namespace } = config.msg91;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authkey: authKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      integrated_number: whatsappNumber,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: template,
          language: { code: templateLang, policy: 'deterministic' },
          ...(namespace ? { namespace } : {}),
          to_and_components: [
            {
              to: [to],
              components: {
                body_1: { type: 'text', value: String(code) },
                button_1: { subtype: 'url', type: 'text', value: String(code) }, // the "Copy code" button
              },
            },
          ],
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  // MSG91 answers { status: 'success', hasError: false, ... } or { status: 'fail', hasError: true, errors: [...] }.
  if (!res.ok || data.hasError || (data.status && data.status !== 'success')) {
    const errors = Array.isArray(data.errors) ? data.errors.map((e) => e?.message || e?.msg || JSON.stringify(e)).join('; ') : '';
    throw new Error(`MSG91 WhatsApp ${res.status}: ${errors || data.message || data.msg || 'request failed'}`);
  }
  return data;
}
