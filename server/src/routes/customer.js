// Optional shopper accounts (email + OTP). Lets customers autofill details and track orders.
import { Router } from 'express';
import { createSession, destroySession, requireCustomer } from '../auth.js';
import { verifyOtp } from '../otp/otp.js';
import { query } from '../db.js';
import { conflict, parse, unauthorized } from '../errors.js';
import * as S from '../schemas.js';

export const customerRouter = Router();

const profile = async (id) =>
  (await query('SELECT id, name, email, phone, default_address FROM customers WHERE id = $1', [id])).rows[0] || null;

// Optional shopper accounts: name + email verified by OTP; login with email + OTP. (otp_codes.phone holds the email.)
customerRouter.post('/register', async (req, res) => {
  const { name, email, code } = parse(S.registerCustomer, req.body);
  await verifyOtp({ phone: email, purpose: 'customer_register', code });
  const { rows } = await query(
    `INSERT INTO customers (name, email, last_login_at) VALUES ($1, $2, now())
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [name, email],
  );
  if (!rows[0]) throw conflict('An account with this email already exists. Please log in.');
  await createSession(res, 'customer', rows[0].id);
  res.status(201).json({ customer: await profile(rows[0].id) });
});

customerRouter.post('/login', async (req, res) => {
  const { email, code } = parse(S.emailLogin, req.body);
  await verifyOtp({ phone: email, purpose: 'customer_login', code });
  const { rows } = await query('SELECT id FROM customers WHERE email = $1', [email]);
  if (!rows[0]) throw unauthorized('No account found for this email');
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
