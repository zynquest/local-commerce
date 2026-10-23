// Optional shopper accounts (email + OTP). Lets customers autofill details and track orders.
import { Router } from 'express';
import { createSession, destroySession, requireCustomer } from '../auth.js';
import { verifyOtp } from '../otp/otp.js';
import { query } from '../db.js';
import { badRequest, parse, unauthorized } from '../errors.js';
import { customersUseEmail } from '../otp/providers.js';
import * as S from '../schemas.js';

export const customerRouter = Router();

/**
 * The shopper's identity for this deployment: { column: 'email' | 'phone', value }. CUSTOMER_LOGIN picks which;
 * the other field is ignored. The OTP for customer purposes is keyed by the same value (otp_codes.phone).
 */
export function customerIdentity({ email, phone }) {
  if (customersUseEmail()) {
    if (!email) throw badRequest('Enter a valid email address', { email: 'Enter a valid email address' });
    return { column: 'email', value: email };
  }
  if (!phone) throw badRequest('Enter a valid 10-digit mobile number', { phone: 'Enter a valid 10-digit mobile number' });
  return { column: 'phone', value: phone };
}

const profile = async (id) =>
  (await query('SELECT id, name, email, phone, default_address FROM customers WHERE id = $1', [id])).rows[0] || null;

/**
 * One endpoint for sign-in and sign-up. The code is verified first (it proves control of the email / number):
 *   - account exists           → log in, { customer }
 *   - no account, no name sent → 200 { needsName: true } (the code stays valid for the next call)
 *   - no account, name sent    → create it and log in, 201 { customer }
 */
async function customerAuth(req, res) {
  const { code, name, ...ids } = parse(S.customerAuth, req.body);
  const id = customerIdentity(ids);
  const existing = await query(`SELECT id FROM customers WHERE ${id.column} = $1`, [id.value]);
  if (!existing.rows[0] && !name) {
    await verifyOtp({ phone: id.value, purpose: 'customer_login', code, consume: false });
    return res.json({ needsName: true });
  }
  await verifyOtp({ phone: id.value, purpose: 'customer_login', code });
  let customerId = existing.rows[0]?.id;
  let created = false;
  if (!customerId) {
    const { rows } = await query(
      `INSERT INTO customers (name, ${id.column}, last_login_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING RETURNING id`,
      [name, id.value],
    );
    customerId = rows[0]?.id ?? (await query(`SELECT id FROM customers WHERE ${id.column} = $1`, [id.value])).rows[0]?.id; // lost a race: log in
    created = Boolean(rows[0]);
  } else {
    await query('UPDATE customers SET last_login_at = now() WHERE id = $1', [customerId]);
  }
  if (!customerId) throw unauthorized('Could not sign you in. Please try again.');
  await createSession(res, 'customer', customerId);
  res.status(created ? 201 : 200).json({ customer: await profile(customerId) });
}
customerRouter.post('/auth', customerAuth);
// Older app builds (precached by the service worker until their next load) still post here.
customerRouter.post(['/login', '/register'], customerAuth);

customerRouter.post('/logout', async (req, res) => {
  await destroySession(req, res, 'customer');
  res.json({ ok: true });
});

customerRouter.get('/me', requireCustomer, async (req, res) => {
  const customer = await profile(req.customerId);
  if (!customer) throw unauthorized();
  res.json({ customer });
});

customerRouter.put('/me', requireCustomer, async (req, res) => {
  const data = parse(S.customerProfile, req.body);
  await query(
    `UPDATE customers SET name = coalesce($2, name),
            default_address = CASE WHEN $3::boolean THEN $4 ELSE default_address END
      WHERE id = $1`,
    [req.customerId, data.name ?? null, data.default_address !== undefined, data.default_address ?? null],
  );
  res.json({ customer: await profile(req.customerId) });
});

customerRouter.get('/orders', requireCustomer, async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.order_code, o.status, o.total, o.subtotal, o.delivery_fee, o.notes, o.created_at,
            s.name AS store_name, s.slug AS store_slug, s.currency_symbol,
            coalesce(json_agg(json_build_object('name', i.name, 'quantity', i.quantity, 'line_total', i.line_total)
              ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM orders o
       JOIN stores s ON s.id = o.store_id
       LEFT JOIN order_items i ON i.order_id = o.id
      WHERE o.customer_id = $1
      GROUP BY o.id, s.id
      ORDER BY o.created_at DESC
      LIMIT 50`,
    [req.customerId],
  );
  res.json({ orders: rows });
});
