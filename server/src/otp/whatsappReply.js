// OTP_PROVIDER=whatsapp_reply — free WhatsApp OTPs on Meta's Cloud API.
//
// 1. POST /api/otp/request saves a short-lived request token and returns a pre-filled WhatsApp message
//    ("…code request #K7Q2XZ") addressed to our business number.
// 2. The user sends it. Meta calls our webhook (routes/whatsapp.js) with the message and the sender's number.
// 3. If the sender is the number typed in the app, we issue the OTP and send it back as a reply — a free-form
//    message inside the 24-hour customer service window, which Meta doesn't charge for.
// The code is then entered in the app exactly like any other OTP (verifyOtp).
import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError } from '../errors.js';
import { makeServerT } from '../i18n.js';
import { sendText } from '../whatsapp/cloud.js';
import { issueOtp } from './otp.js';

const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const TOKEN_RE = /#([A-HJ-NP-Z2-9]{6})\b/;
const REQUEST_TTL_MINUTES = 15;
const MAX_REQUESTS_PER_WINDOW = 5;

export const usesWhatsAppReply = () => config.otpProvider === 'whatsapp_reply';

const newToken = () => Array.from({ length: 6 }, () => TOKEN_CHARS[crypto.randomInt(TOKEN_CHARS.length)]).join('');

/** Step 1: remember the request and hand the app a WhatsApp message to send. */
export async function startWhatsAppRequest({ phone, purpose, context = {}, meta = {}, language = 'en' }) {
  const recent = await query(
    `SELECT count(*)::int AS n FROM otp_wa_requests WHERE phone = $1 AND created_at > now() - interval '15 minutes'`,
    [phone],
  );
  if (recent.rows[0].n >= MAX_REQUESTS_PER_WINDOW) {
    throw new HttpError(429, 'Too many codes requested for this number. Try again in 15 minutes.');
  }
  let token;
  for (let i = 0; i < 5 && !token; i++) {
    const candidate = newToken();
    const { rowCount } = await query(
      `INSERT INTO otp_wa_requests (token, phone, purpose, context, meta, language, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7)) ON CONFLICT (token) DO NOTHING`,
      [candidate, phone, purpose, JSON.stringify(context), JSON.stringify(meta), language, REQUEST_TTL_MINUTES],
    );
    if (rowCount) token = candidate;
  }
  if (!token) throw new HttpError(503, 'Could not start verification, please try again');
  const t = makeServerT(language);
  return {
    delivery: 'whatsapp_reply',
    expiresIn: REQUEST_TTL_MINUTES * 60,
    waNumber: config.whatsapp.businessNumber,
    waText: t('otp.waRequestText', { brand: config.platformName, token: `#${token}` }),
  };
}

const exists = async (sql, params) => (await query(sql, params)).rowCount > 0;

/** Whether the purpose still makes sense for this number (it may have changed since the request). */
async function purposeProblem(purpose, phone) {
  switch (purpose) {
    case 'owner_register':
      return (await exists('SELECT 1 FROM users WHERE phone = $1', [phone])) ? 'otp.waAlreadyRegistered' : null;
    case 'owner_login':
      return (await exists(`SELECT 1 FROM users WHERE phone = $1 AND role = 'owner'`, [phone])) ? null : 'otp.waNoAccount';
    case 'customer_login': // CUSTOMER_LOGIN=mobile: one flow for sign-in and sign-up, any number may request a code
      return null;
    default:
      return null;
  }
}

const pretty = (phone) => `+${phone.slice(0, phone.length - 10)} ${phone.slice(-10, -5)} ${phone.slice(-5)}`;

/**
 * Step 2 (webhook): a WhatsApp text arrived from `from`. If it carries a request token, answer it.
 * Returns what happened (for logs/tests): 'sent' | 'ignored' | 'expired' | 'wrong_number' | 'refused' | 'limited'.
 */
export async function handleIncomingText({ from, text }) {
  const m = TOKEN_RE.exec(String(text).toUpperCase());
  if (!m) return 'ignored'; // an ordinary chat message — leave it for the humans on the business app
  const { rows } = await query(`SELECT * FROM otp_wa_requests WHERE token = $1`, [m[1]]);
  const reqRow = rows[0];
  const reply = async (key, vars = {}) => {
    const t = makeServerT(reqRow?.language || 'en');
    await sendText(from, t(key, { brand: config.platformName, ...vars }));
  };

  if (!reqRow || reqRow.used_at || new Date(reqRow.expires_at) < new Date()) {
    await reply('otp.waExpired');
    return 'expired';
  }
  // Only the owner of the number typed in the app can receive its code.
  if (reqRow.phone !== from) {
    await reply('otp.waWrongNumber', { phone: pretty(reqRow.phone) });
    return 'wrong_number';
  }
  const problem = await purposeProblem(reqRow.purpose, reqRow.phone);
  await query('UPDATE otp_wa_requests SET used_at = now() WHERE token = $1', [reqRow.token]);
  if (problem) {
    await reply(problem);
    return 'refused';
  }
  try {
    // Sends the code through providers.whatsapp_reply (a free reply in the open service window).
    await issueOtp({ phone: reqRow.phone, purpose: reqRow.purpose, context: reqRow.context, meta: { ...reqRow.meta, language: reqRow.language } });
    return 'sent';
  } catch (err) {
    if (err.status === 429) {
      await reply('otp.waTooMany');
      return 'limited';
    }
    throw err;
  }
}
