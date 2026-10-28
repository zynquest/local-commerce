// Store-owner registration and login — 10-digit mobile number + OTP only (no passwords).
import crypto from 'node:crypto';
import { Router } from 'express';
import { createSession, destroySession, requireOwner } from '../auth.js';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { badRequest, conflict, parse, unauthorized } from '../errors.js';
import { ownersUseEmail } from '../otp/providers.js';
import { verifyOtp } from '../otp/otp.js';
import * as S from '../schemas.js';
import { claimSeedStore, seedForMobile } from '../seed/stores.js';
import { RESERVED_SLUGS, slugify } from '../serialize.js';

export const authRouter = Router();


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
    `SELECT u.id, u.username, u.phone, u.email, s.slug AS store_slug, s.name AS store_name, s.status AS store_status, s.business_type
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
async function createOwner({ storeName, phone, businessType = 'shop' }) {
  const username = `m${phone}`; // internal identifier; owners log in with their mobile number
  return tx(async (client) => {
    await assertPhoneFree(client, phone);
    if ((await client.query('SELECT 1 FROM users WHERE username = $1', [username])).rowCount) throw conflict('That username is taken');
    const { rows } = await client.query(
      `INSERT INTO users (username, phone, last_login_at) VALUES ($1, $2, now()) RETURNING id`,
      [username, phone],
    );
    await client.query(
      `INSERT INTO stores (owner_id, slug, name, whatsapp_number, whatsapp_verified, sku_limit, business_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [rows[0].id, await uniqueSlug(client, storeName), storeName, phone, true, config.freeSkuLimit, businessType],
    );
    return rows[0].id;
  });
}

/** OWNER_LOGIN=email: creates owner (email verified by the code just checked) + draft store without a WhatsApp number. */
async function createOwnerByEmail({ storeName, email, businessType = 'shop' }) {
  return tx(async (client) => {
    if ((await client.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount) throw conflict('An account with this email already exists. Please log in.');
    let username = `o${crypto.createHash('sha1').update(email).digest('hex').slice(0, 12)}`; // internal; owners log in by email
    if ((await client.query('SELECT 1 FROM users WHERE username = $1', [username])).rowCount) username = `o${crypto.randomBytes(8).toString('hex')}`;
    const { rows } = await client.query(
      `INSERT INTO users (username, email, email_verified_at, last_login_at) VALUES ($1, $2, now(), now()) RETURNING id`,
      [username, email],
    );
    await client.query(
      `INSERT INTO stores (owner_id, slug, name, sku_limit, business_type) VALUES ($1, $2, $3, $4, $5)`,
      [rows[0].id, await uniqueSlug(client, storeName), storeName, config.freeSkuLimit, businessType],
    );
    return rows[0].id;
  });
}

/**
 * OWNER_LOGIN=email: one call for sign-in and sign-up (code from POST /api/otp/request, purpose owner_login).
 *   - email has an account          → log in, { user }
 *   - no account, no storeName sent → 200 { needsStore: true } (the code stays valid for the next call)
 *   - no account, storeName sent    → create owner + draft store, 201 { user, created: true }
 */
authRouter.post('/email', async (req, res) => {
  if (!ownersUseEmail()) throw badRequest('Log in with your mobile number');
  const { email, code, storeName, businessType } = parse(S.ownerEmailAuth, req.body);
  const { rows } = await query(`SELECT id FROM users WHERE email = $1 AND role = 'owner'`, [email]);
  if (!rows[0] && !storeName) {
    await verifyOtp({ phone: email, purpose: 'owner_login', code, consume: false });
    return res.json({ needsStore: true });
  }
  await verifyOtp({ phone: email, purpose: 'owner_login', code });
  let userId = rows[0]?.id;
  if (userId) await query('UPDATE users SET last_login_at = now(), email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1', [userId]);
  else userId = await createOwnerByEmail({ storeName, email, businessType });
  await createSession(res, 'user', userId);
  res.status(rows[0] ? 200 : 201).json({ user: await ownerProfile(userId), created: !rows[0] });
});

// Registration (OWNER_LOGIN=mobile): store name + 10-digit mobile verified by OTP (purpose owner_register).
authRouter.post('/register', async (req, res) => {
  const { storeName, phone, code, businessType } = parse(S.registerOwner, req.body);
  await verifyOtp({ phone, purpose: 'owner_register', code });
  // The platform may already list this shop (seeded from public data) with this mobile: hand that listing over
  // instead of creating a second store. The OTP just proved the owner controls the number.
  const seedId = businessType === 'appointments' ? null : await seedForMobile(phone);
  const userId = seedId ? await claimSeedStore({ storeId: seedId, phone, name: storeName, verified: true }) : await createOwner({ storeName, phone, businessType });
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
