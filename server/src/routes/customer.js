// Optional shopper accounts (email + OTP). Lets customers autofill details and track orders.
import { Router } from 'express';
import { createSession, destroySession, requireCustomer } from '../auth.js';
import { verifyOtp } from '../otp/otp.js';
import { query } from '../db.js';
import { badRequest, conflict, parse, unauthorized } from '../errors.js';
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

// Optional shopper accounts: name + email (or mobile) verified by OTP; login the same way.
customerRouter.post('/register', async (req, res) => {
  const { name, code, ...ids } = parse(S.registerCustomer, req.body);
  const id = customerIdentity(ids);
  await verifyOtp({ phone: id.value, purpose: 'customer_register', code });
  const { rows } = await query(
    `INSERT INTO customers (name, ${id.column}, last_login_at) VALUES ($1, $2, now())
     ON CONFLICT DO NOTHING RETURNING id`,
    [name, id.value],
  );
  if (!rows[0]) throw conflict(id.column === 'email' ? 'An account with this email already exists. Please log in.' : 'An account with this phone number already exists. Please log in.');
  await createSession(res, 'customer', rows[0].id);
  res.status(201).json({ customer: await profile(rows[0].id) });
});

customerRouter.post('/login', async (req, res) => {
  const { code, ...ids } = parse(S.customerLogin, req.body);
  const id = customerIdentity(ids);
  await verifyOtp({ phone: id.value, purpose: 'customer_login', code });
  const { rows } = await query(`SELECT id FROM customers WHERE ${id.column} = $1`, [id.value]);
  if (!rows[0]) throw unauthorized(id.column === 'email' ? 'No account found for this email' : 'No account found for this number');
  await query('UPDATE customers SET last_login_at = now() WHERE id = $1', [rows[0].id]);
  await createSession(res, 'customer', rows[0].id);
  res.json({ customer: await profile(rows[0].id) });
});

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
