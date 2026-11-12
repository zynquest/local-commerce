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

/** Owner sessions opened by the platform admin ("admin mode") last this long. */
export const ACTING_SESSION_HOURS = 2;

/** actingAdminId: the platform admin opening a store in the owner screens (an owner session in admin mode). */
export async function createSession(res, subjectType, subjectId, { actingAdminId = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttlMs = actingAdminId ? ACTING_SESSION_HOURS * 3600_000 : subjectType === 'admin' ? config.adminSessionHours * 3600_000 : config.sessionDays * 86400_000;
  const expires = new Date(Date.now() + ttlMs);
  await query('INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at, acting_admin_id) VALUES ($1, $2, $3, $4, $5)', [
    sha256(token),
    subjectType,
    subjectId,
    expires,
    actingAdminId,
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

async function session(req, subjectType) {
  const token = req.cookies?.[COOKIES[subjectType]];
  if (!token) return null;
  const { rows } = await query(
    'SELECT subject_id, acting_admin_id FROM sessions WHERE token_hash = $1 AND subject_type = $2 AND expires_at > now()',
    [sha256(token), subjectType],
  );
  return rows[0] || null;
}
const lookup = async (req, subjectType) => (await session(req, subjectType))?.subject_id || null;

/** Requires a store-owner session; attaches req.user and req.store. */
export async function requireOwner(req, _res, next) {
  const found = await session(req, 'user');
  if (!found) throw unauthorized();
  const { rows } = await query(
    `SELECT u.id, u.username, u.phone, u.role, s.id AS store_id, a.username AS acting_admin
       FROM users u LEFT JOIN stores s ON s.owner_id = u.id
       LEFT JOIN users a ON a.id = $2 AND a.role = 'platform_admin'
      WHERE u.id = $1 AND u.role = 'owner'`,
    [found.subject_id, found.acting_admin_id],
  );
  if (!rows[0]) throw unauthorized();
  if (found.acting_admin_id && !rows[0].acting_admin) throw unauthorized(); // the admin account is gone or changed role
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

/**
 * Requires an admin-console session (separate cookie, 12-hour lifetime): the platform admin, or a staff member
 * (sales rep, role 'staff', limited to their own stores' approvals; see routes/platform.js).
 */
export async function requireAdmin(req, _res, next) {
  const adminId = await lookup(req, 'admin');
  if (!adminId) throw unauthorized('Admin login required');
  const { rows } = await query(
    `SELECT id, username, role, rep_code, staff_name FROM users WHERE id = $1 AND role IN ('platform_admin', 'staff')`,
    [adminId],
  );
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
