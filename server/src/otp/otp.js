// One-time passcodes: 6 digits, 10-minute expiry, 5 verification attempts, 3 sends per 15 minutes.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError, badRequest } from '../errors.js';
import { getProvider } from './providers.js';

const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_WINDOW = 3;

const hash = (id, code) => crypto.createHash('sha256').update(`${id}:${code}`).digest('hex');

/** Issues and sends a code. Returns { expiresIn, delivery, devCode? } (devCode only in local development). */
export async function issueOtp({ phone, purpose, context = {}, meta = {} }) {
  const recent = await query(
    `SELECT count(*)::int AS n FROM otp_codes
      WHERE phone = $1 AND purpose = $2 AND created_at > now() - interval '15 minutes'`,
    [phone, purpose],
  );
  if (recent.rows[0].n >= MAX_SENDS_PER_WINDOW) {
    throw new HttpError(429, 'Too many codes requested for this number. Try again in 15 minutes.');
  }

  const provider = getProvider();
  const code = provider.code ? provider.code() : crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const id = crypto.randomUUID();
  // Only the latest code for a phone + purpose is valid.
  await query('UPDATE otp_codes SET consumed_at = now() WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL', [phone, purpose]);
  await query(
    `INSERT INTO otp_codes (id, phone, purpose, code_hash, context, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))`,
    [id, phone, purpose, hash(id, code), JSON.stringify(context), TTL_MINUTES],
  );
  try {
    await provider.send(phone, code, purpose, meta);
  } catch (err) {
    console.error(`[otp] delivery failed (${config.otpProvider}):`, err.message);
    throw new HttpError(502, 'Could not send the code right now. Please try again in a minute.');
  }
  return { expiresIn: TTL_MINUTES * 60, delivery: provider.delivery, ...(config.exposeDevOtp ? { devCode: code } : {}) };
}

/** Verifies and consumes a code. Returns the stored context. Throws 400/429 on failure. */
export async function verifyOtp({ phone, purpose, code }) {
  const { rows } = await query(
    `SELECT id, code_hash, attempts, context FROM otp_codes
      WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose],
  );
  const otp = rows[0];
  if (!otp) throw badRequest('Code expired or not requested. Please request a new code.');
  if (otp.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong attempts. Please request a new code.');

  const expected = Buffer.from(otp.code_hash, 'hex');
  const actual = Buffer.from(hash(otp.id, String(code || '').trim()), 'hex');
  if (!crypto.timingSafeEqual(expected, actual)) {
    await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    throw badRequest('Incorrect code', { code: 'Incorrect code' });
  }
  await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
  return otp.context;
}
