// Minimal client for Fast2SMS's OTP route (https://www.fast2sms.com/dev/bulkV2, route=otp).
// The OTP route uses Fast2SMS's own DLT-approved template, so we need no DLT registration of our own:
// the recipient gets "Your OTP: 123456" from Fast2SMS's sender ID. Prepaid, charged per SMS (Deployment.md §B14).
import { config } from '../config.js';

const ENDPOINT = 'https://www.fast2sms.com/dev/bulkV2';

/** Sends `code` to an Indian mobile (digits with or without the 91 prefix). Resolves on success, throws otherwise. */
export async function sendOtpSms(phone, code) {
  const number = String(phone).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(number)) throw new Error(`Fast2SMS: not an Indian mobile number (${phone})`);
  if (!/^\d{4,8}$/.test(String(code))) throw new Error('Fast2SMS: the OTP route accepts a numeric code only');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: config.fast2sms.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ route: 'otp', variables_values: String(code), numbers: number, flash: 0 }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  // Fast2SMS answers { return: true, request_id, message: [...] } on success and
  // { return: false, status_code, message } (often with an HTTP 4xx) on failure.
  if (!res.ok || data.return !== true) {
    const msg = Array.isArray(data.message) ? data.message.join('; ') : data.message || `HTTP ${res.status}`;
    throw new Error(`Fast2SMS ${data.status_code || res.status}: ${msg}`);
  }
  return data;
}
