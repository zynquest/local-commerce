// Username/password auth with opaque session tokens in httpOnly cookies.
// Only the SHA-256 of each token is stored, so a database leak doesn't expose live sessions.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { query } from './db.js';
import { forbidden, unauthorized } from './errors.js';

export const COOKIES = { user: 'vfl_owner', customer: 'vfl_customer', admin: 'vfl_admin' };

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Compared against when the account doesn't exist, so response time doesn't reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', config.bcryptRounds);

export const hashPassword = (pw) => bcrypt.hash(pw, config.bcryptRounds);

export async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash || DUMMY_HASH).then((ok) => ok && Boolean(hash));
}

export async function createSession(res, subjectType, subjectId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttlMs = subjectType === 'admin' ? config.adminSessionHours * 3600_000 : config.sessionDays * 86400_000;
  const expires = new Date(Date.now() + ttlMs);
  await query('INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at) VALUES ($1, $2, $3, $4)', [
    sha256(token),
    subjectType,
    subjectId,
    expires,
  ]);
  res.cookie(COOKIES[subjectType], token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    expires,
    path: '/',
  });
}

export async function destroySession(req, res, subjectType) {
  const token = req.cookies?.[COOKIES[subjectType]];
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.clearCookie(COOKIES[subjectType], { path: '/' });
}

export const destroyAllSessions = (subjectType, subjectId) =>
  query('DELETE FROM sessions WHERE subject_type = $1 AND subject_id = $2', [subjectType, subjectId]);

async function lookup(req, subjectType) {
  const token = req.cookies?.[COOKIES[subjectType]];
  if (!token) return null;
  const { rows } = await query(
    'SELECT subject_id FROM sessions WHERE token_hash = $1 AND subject_type = $2 AND expires_at > now()',
    [sha256(token), subjectType],
  );
  return rows[0]?.subject_id || null;
}

/** Requires a store-owner session; attaches req.user and req.store. */
export async function requireOwner(req, _res, next) {
  const userId = await lookup(req, 'user');
  if (!userId) throw unauthorized();
  const { rows } = await query(
    `SELECT u.id, u.username, u.phone, u.role, s.id AS store_id
       FROM users u LEFT JOIN stores s ON s.owner_id = u.id WHERE u.id = $1 AND u.role = 'owner'`,
    [userId],
  );
  if (!rows[0]) throw unauthorized();
  if (!rows[0].store_id) throw forbidden('No store linked to this account');
  req.user = rows[0];
  next();
}

/** Attaches req.customerId when a customer session exists (guest checkout stays allowed). */
export async function optionalCustomer(req, _res, next) {
  req.customerId = await lookup(req, 'customer');
  next();
}

export async function requireCustomer(req, _res, next) {
  req.customerId = await lookup(req, 'customer');
  if (!req.customerId) throw unauthorized();
  next();
}

/** Requires the platform-admin session (separate cookie, 12-hour lifetime). */
export async function requireAdmin(req, _res, next) {
  const adminId = await lookup(req, 'admin');
  if (!adminId) throw unauthorized('Admin login required');
  const { rows } = await query(`SELECT id, username FROM users WHERE id = $1 AND role = 'platform_admin'`, [adminId]);
  if (!rows[0]) throw unauthorized('Admin login required');
  req.admin = rows[0];
  next();
}

/** Who is viewing (for previews of not-yet-approved stores): { ownerStoreId, isAdmin }. */
export async function viewer(req) {
  const [userId, adminId] = await Promise.all([lookup(req, 'user'), lookup(req, 'admin')]);
  let ownerStoreId = null;
  if (userId) {
    const { rows } = await query('SELECT id FROM stores WHERE owner_id = $1', [userId]);
    ownerStoreId = rows[0]?.id || null;
  }
  return { ownerStoreId, isAdmin: Boolean(adminId) };
}

export const purgeExpiredSessions = () => query('DELETE FROM sessions WHERE expires_at < now()');
