// Store-owner registration and login — 10-digit mobile number + OTP only (no passwords).
import { Router } from 'express';
import { createSession, destroySession, requireOwner } from '../auth.js';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { conflict, parse, unauthorized } from '../errors.js';
import { verifyOtp } from '../otp/otp.js';
import * as S from '../schemas.js';
import { slugify } from '../serialize.js';

export const authRouter = Router();

const RESERVED_SLUGS = new Set(['admin', 'api', 'login', 'register', 'account', 'stores', 'uploads', 's', 'p', 'demo', 'merchant']);

async function uniqueSlug(client, name) {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 && !RESERVED_SLUGS.has(base) ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { rowCount } = await client.query('SELECT 1 FROM stores WHERE slug = $1', [candidate]);
    if (!rowCount) return candidate;
  }
  throw conflict('Could not generate a store link, try a different name');
}

async function ownerProfile(userId) {
  const { rows } = await query(
    `SELECT u.id, u.username, u.phone, s.slug AS store_slug, s.name AS store_name, s.status AS store_status
       FROM users u LEFT JOIN stores s ON s.owner_id = u.id WHERE u.id = $1`,
    [userId],
  );
  return rows[0] || null;
}

async function assertPhoneFree(client, phone) {
  const { rowCount } = await client.query('SELECT 1 FROM users WHERE phone = $1', [phone]);
  if (rowCount) throw conflict('This mobile number is already registered. Please log in.');
}

/** Creates owner + draft store. The verified registration mobile becomes the store's WhatsApp number. */
async function createOwner({ storeName, phone }) {
  const username = `m${phone}`; // internal identifier; owners log in with their mobile number
  return tx(async (client) => {
    await assertPhoneFree(client, phone);
    if ((await client.query('SELECT 1 FROM users WHERE username = $1', [username])).rowCount) throw conflict('That username is taken');
    const { rows } = await client.query(
      `INSERT INTO users (username, phone, last_login_at) VALUES ($1, $2, now()) RETURNING id`,
      [username, phone],
    );
    await client.query(
      `INSERT INTO stores (owner_id, slug, name, whatsapp_number, whatsapp_verified, sku_limit)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [rows[0].id, await uniqueSlug(client, storeName), storeName, phone, true, config.freeSkuLimit],
    );
    return rows[0].id;
  });
}

// Registration: store name + 10-digit mobile verified by OTP (POST /api/otp/request, purpose owner_register).
authRouter.post('/register', async (req, res) => {
  const { storeName, phone, code } = parse(S.registerOwner, req.body);
  await verifyOtp({ phone, purpose: 'owner_register', code });
  const userId = await createOwner({ storeName, phone });
  await createSession(res, 'user', userId);
  res.status(201).json({ user: await ownerProfile(userId) });
});

// Login: 10-digit mobile + OTP (purpose owner_login).
authRouter.post('/login', async (req, res) => {
  const { phone, code } = parse(S.phoneLogin, req.body);
  await verifyOtp({ phone, purpose: 'owner_login', code });
  const { rows } = await query(`SELECT id FROM users WHERE phone = $1 AND role = 'owner'`, [phone]);
  if (!rows[0]) throw unauthorized('No store is registered with this number');
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [rows[0].id]);
  await createSession(res, 'user', rows[0].id);
  res.json({ user: await ownerProfile(rows[0].id) });
});

authRouter.post('/logout', async (req, res) => {
  await destroySession(req, res, 'user');
  res.json({ ok: true });
});

authRouter.get('/me', requireOwner, async (req, res) => {
  res.json({ user: await ownerProfile(req.user.id) });
});
