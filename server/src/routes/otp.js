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
import { startWhatsAppRequest, usesWhatsAppReply } from '../otp/whatsappReply.js';
import { getProvider, isCustomerPurpose, providerFor } from '../otp/providers.js';
import { customerIdentity } from './customer.js';
import { DEMO_WHATSAPP_LOCKED } from './merchant.js';
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
  const { phone, email, purpose, name, language = 'en' } = parse(S.otpRequest, req.body);
  const meta = { name, ip: req.ip, language };

  if (purpose === 'whatsapp_change') return next(); // handled below (needs an owner session)

  // Shoppers: one flow for sign-in and sign-up, so the code is always sent — by email (CUSTOMER_LOGIN=email,
  // never the WhatsApp relay) or to the mobile number like owners' codes (CUSTOMER_LOGIN=mobile). Whether an
  // account exists is decided by /api/customer/auth once the code has been verified.
  if (isCustomerPurpose(purpose)) {
    const id = customerIdentity({ email, phone });
    if (id.column === 'phone' && usesWhatsAppReply()) return res.json({ ok: true, ...(await startWhatsAppRequest({ phone, purpose: 'customer_login', meta, language })) });
    return res.json({ ok: true, delivery: providerFor(purpose).delivery, ...(await issueOtp({ phone: id.value, purpose: 'customer_login', meta })) });
  }

  // Free WhatsApp mode: the user messages us first. Logins get a request even for unknown numbers, so the
  // response never reveals who is registered; the webhook tells the number's owner if there's no account.
  if (usesWhatsAppReply()) {
    if (purpose === 'owner_register' && (await exists('SELECT 1 FROM users WHERE phone = $1', [phone]))) throw conflict('This mobile number is already registered. Please log in.');
    return res.json({ ok: true, ...(await startWhatsAppRequest({ phone, purpose, meta, language })) });
  }

  const generic = { ok: true, delivery: getProvider().delivery, message: 'If the number can receive codes, one has been sent.' };
  switch (purpose) {
    case 'owner_register':
      if (await exists('SELECT 1 FROM users WHERE phone = $1', [phone])) throw conflict('This mobile number is already registered. Please log in.');
      return res.json({ ok: true, ...(await issueOtp({ phone, purpose, meta })) });
    case 'owner_login':
      if (!(await exists(`SELECT 1 FROM users WHERE phone = $1 AND role = 'owner'`, [phone]))) return res.json(generic);
      return res.json({ ...generic, ...(await issueOtp({ phone, purpose, meta })) });
    default:
      throw badRequest('Unknown purpose');
  }
});

// WhatsApp number change: the code goes to the NEW number to prove the owner controls it.
otpRouter.post('/request', requireOwner, async (req, res) => {
  const { phone, language = 'en' } = parse(S.otpRequest, req.body);
  const { rows } = await query('SELECT name, whatsapp_number, is_demo FROM stores WHERE id = $1', [req.user.store_id]);
  if (rows[0]?.is_demo) throw badRequest(DEMO_WHATSAPP_LOCKED);
  if (rows[0]?.whatsapp_number === phone) throw badRequest('This is already your WhatsApp number for orders');
  if (usesWhatsAppReply()) {
    const context = { store_id: req.user.store_id };
    return res.json({ ok: true, ...(await startWhatsAppRequest({ phone, purpose: 'whatsapp_change', context, meta: { name: rows[0]?.name, ip: req.ip }, language })) });
  }
  res.json({ ok: true, ...(await issueOtp({ phone, purpose: 'whatsapp_change', context: { store_id: req.user.store_id }, meta: { name: rows[0]?.name, ip: req.ip } })) });
});
