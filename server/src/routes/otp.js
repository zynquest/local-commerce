// OTP requests for every purpose. Login codes are only sent to registered numbers, but the response is
// identical either way so the endpoint can't be used to discover who is registered.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireOwner } from '../auth.js';
import { clientKey } from '../clientIp.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { badRequest, conflict, parse } from '../errors.js';
import { issueOtp } from '../otp/otp.js';
import { getProvider } from '../otp/providers.js';
import * as S from '../schemas.js';

export const otpRouter = Router();

const otpLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.isProd ? 10 : 500, // per IP; relaxed locally so seed/e2e scripts can register many stores
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: 'Too many code requests. Try again in a few minutes.' },
});

const exists = async (sql, params) => (await query(sql, params)).rowCount > 0;

otpRouter.post('/request', otpLimiter, async (req, res, next) => {
  const { phone, purpose, name } = parse(S.otpRequest, req.body);
  const meta = { name, ip: req.ip };

  if (purpose === 'whatsapp_change') return next(); // handled below (needs an owner session)

  const generic = { ok: true, delivery: getProvider().delivery, message: 'If the number can receive codes, one has been sent.' };
  switch (purpose) {
    case 'owner_register':
      if (await exists('SELECT 1 FROM users WHERE phone = $1', [phone])) throw conflict('This mobile number is already registered. Please log in.');
      return res.json({ ok: true, ...(await issueOtp({ phone, purpose, meta })) });
    case 'customer_register':
      if (await exists('SELECT 1 FROM customers WHERE phone = $1', [phone])) throw conflict('An account with this number exists. Please log in.');
      return res.json({ ok: true, ...(await issueOtp({ phone, purpose, meta })) });
    case 'owner_login':
      if (!(await exists(`SELECT 1 FROM users WHERE phone = $1 AND role = 'owner'`, [phone]))) return res.json(generic);
      return res.json({ ...generic, ...(await issueOtp({ phone, purpose, meta })) });
    case 'customer_login':
      if (!(await exists('SELECT 1 FROM customers WHERE phone = $1', [phone]))) return res.json(generic);
      return res.json({ ...generic, ...(await issueOtp({ phone, purpose, meta })) });
    default:
      throw badRequest('Unknown purpose');
  }
});

// WhatsApp number change: the code goes to the NEW number to prove the owner controls it.
otpRouter.post('/request', requireOwner, async (req, res) => {
  const { phone } = parse(S.otpRequest, req.body);
  const { rows } = await query('SELECT name, whatsapp_number FROM stores WHERE id = $1', [req.user.store_id]);
  if (rows[0]?.whatsapp_number === phone) throw badRequest('This is already your WhatsApp number for orders');
  res.json({ ok: true, ...(await issueOtp({ phone, purpose: 'whatsapp_change', context: { store_id: req.user.store_id }, meta: { name: rows[0]?.name, ip: req.ip } })) });
});
