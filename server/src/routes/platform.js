// Platform admin API (/api/platform). The single admin account is created from the CLI only
// (npm run admin:create); there is no sign-up route.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createSession, destroySession, requireAdmin, verifyPassword } from '../auth.js';
import { clientKey } from '../clientIp.js';
import { query, tx } from '../db.js';
import { conflict, notFound, parse, unauthorized } from '../errors.js';
import * as S from '../schemas.js';
import { PRODUCT_COLUMNS, product as serializeProduct } from '../serialize.js';
import { claimSeedStore, removeSeedStore } from '../seed/stores.js';

export const platformRouter = Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

platformRouter.post('/login', adminLoginLimiter, async (req, res) => {
  const { username, password } = parse(S.login, req.body);
  const { rows } = await query(`SELECT id, password_hash FROM users WHERE username = $1 AND role = 'platform_admin'`, [username]);
  if (!(await verifyPassword(password, rows[0]?.password_hash))) throw unauthorized('Incorrect username or password');
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [rows[0].id]);
  await createSession(res, 'admin', rows[0].id);
  res.json({ admin: { username } });
});

platformRouter.post('/logout', async (req, res) => {
  await destroySession(req, res, 'admin');
  res.json({ ok: true });
});

platformRouter.use(requireAdmin);

platformRouter.get('/me', (req, res) => res.json({ admin: { username: req.admin.username } }));

platformRouter.get('/stats', async (_req, res) => {
  const { rows } = await query(
    `SELECT
       (SELECT json_object_agg(status, n) FROM (SELECT status, count(*)::int AS n FROM stores
          WHERE NOT (origin = 'seed' AND claimed_at IS NULL) GROUP BY status) t) AS by_status,
       (SELECT count(*)::int FROM stores WHERE origin = 'seed' AND claimed_at IS NULL) AS seeds_unclaimed,
       (SELECT count(*)::int FROM stores WHERE origin = 'seed' AND claimed_at IS NOT NULL) AS seeds_claimed,
       (SELECT count(*)::int FROM products WHERE status = 'active') AS products,
       (SELECT count(*)::int FROM orders WHERE created_at > now() - interval '7 days') AS orders_7d,
       (SELECT count(*)::int FROM customers) AS customers`,
  );
  const by = rows[0].by_status || {};
  res.json({ ...rows[0], by_status: { ...by, seed: rows[0].seeds_unclaimed } });
});

const STORE_LIST_COLUMNS = `s.id, s.slug, s.name, s.status, s.plan, s.sku_limit, s.category, s.city, s.logo_url, s.business_type, s.lat,
  s.whatsapp_number, s.whatsapp_verified, s.submitted_at, s.reviewed_at, s.review_remarks, s.created_at,
  s.origin, s.claimed_at, s.locality, s.seed_phone,
  u.username AS owner_username, u.phone AS owner_phone, u.email AS owner_email,
  (SELECT count(*)::int FROM products p WHERE p.store_id = s.id AND p.status = 'active') AS product_count`;

/**
 * Store list. status=pending_review gives the approval queue (oldest submission first); status=seed lists the
 * unclaimed seeded listings (kept out of every other tab, "Live" included, since there can be thousands).
 */
platformRouter.get('/stores', async (req, res) => {
  const raw = typeof req.query.status === 'string' ? req.query.status : 'all';
  const status = raw === 'all' || raw === 'seed' ? null : raw;
  const unclaimedSeed = `(s.origin = 'seed' AND s.claimed_at IS NULL)`;
  const seedFilter = raw === 'seed' ? `AND ${unclaimedSeed}` : raw === 'all' ? '' : `AND NOT ${unclaimedSeed}`;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const { rows } = await query(
    `SELECT ${STORE_LIST_COLUMNS}
       FROM stores s JOIN users u ON u.id = s.owner_id
      WHERE ($1::text IS NULL OR s.status = $1) ${seedFilter}
        AND ($2 = '' OR s.name ILIKE '%' || $2 || '%' OR s.slug ILIKE '%' || $2 || '%' OR u.phone LIKE '%' || $2 || '%'
             OR s.locality ILIKE '%' || $2 || '%' OR s.seed_phone LIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%'
             OR s.whatsapp_number LIKE '%' || $2 || '%')
      ORDER BY CASE WHEN s.status = 'pending_review' THEN s.submitted_at END ASC NULLS LAST, s.created_at DESC
      LIMIT 200`,
    [status, q],
  );
  res.json({ stores: rows });
});

platformRouter.get('/stores/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, u.username AS owner_username, u.phone AS owner_phone, u.created_at AS owner_since,
            u.email AS owner_email, u.email_verified_at AS owner_email_verified_at, u.phone_verified_at AS owner_phone_verified_at
       FROM stores s JOIN users u ON u.id = s.owner_id WHERE s.id = $1`,
    [req.params.id],
  );
  if (!rows[0]) throw notFound('Store not found');
  const [products, reviews, counts] = await Promise.all([
    query(`SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.store_id = $1 AND p.status = 'active' ORDER BY p.position LIMIT 24`, [req.params.id]),
    query(
      `SELECT r.action, r.remarks, r.created_at, u.username AS actor, u.role AS actor_role
         FROM store_reviews r LEFT JOIN users u ON u.id = r.actor_id
        WHERE r.store_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
      [req.params.id],
    ),
    query(
      `SELECT (SELECT count(*)::int FROM products WHERE store_id = $1 AND status = 'active') AS products,
              (SELECT count(*)::int FROM orders WHERE store_id = $1) AS orders`,
      [req.params.id],
    ),
  ]);
  const { owner_id, sku_seq, ...store } = rows[0];
  res.json({ store, products: products.rows.map(serializeProduct), reviews: reviews.rows, counts: counts.rows[0] });
});

/** Hand a seeded listing to its owner: their mobile becomes the login + WhatsApp number; they log in with OTP. */
platformRouter.post('/stores/:id/claim', async (req, res) => {
  const { email, phone } = parse(S.seedClaim, req.body ?? {});
  await claimSeedStore({ storeId: req.params.id, email, phone, actorId: req.admin.id });
  res.json({ ok: true });
});

/** Remove an unclaimed seeded listing (e.g. the owner asked); re-imports skip it. */
platformRouter.post('/stores/:id/remove-seed', async (req, res) => {
  const { remarks } = parse(S.reviewDecision, req.body ?? {});
  await removeSeedStore({ storeId: req.params.id, reason: remarks });
  res.json({ ok: true });
});

async function verifyWhatsAppOnApproval(client, storeId) {
  const { rows } = await client.query('SELECT owner_id, whatsapp_number, is_demo FROM stores WHERE id = $1', [storeId]);
  const s = rows[0];
  if (!s?.whatsapp_number || s.is_demo) return;
  await client.query('UPDATE stores SET whatsapp_verified = true WHERE id = $1', [storeId]);
  await client.query(
    `UPDATE users SET phone = $2, phone_verified_at = now()
      WHERE id = $1 AND (phone IS NULL OR phone = $2) AND NOT EXISTS (SELECT 1 FROM users WHERE phone = $2 AND id <> $1)`,
    [s.owner_id, s.whatsapp_number],
  );
}

/** State machine for review actions: allowed source statuses → resulting status. */
const TRANSITIONS = {
  approve: { from: ['pending_review'], to: 'approved', log: 'approved', remarks: S.reviewDecision },
  reject: { from: ['pending_review'], to: 'rejected', log: 'rejected', remarks: S.reviewRemarksRequired },
  suspend: { from: ['approved'], to: 'suspended', log: 'suspended', remarks: S.reviewRemarksRequired },
  reinstate: { from: ['suspended'], to: 'approved', log: 'reinstated', remarks: S.reviewDecision },
};

for (const [action, t] of Object.entries(TRANSITIONS)) {
  platformRouter.post(`/stores/:id/${action}`, async (req, res) => {
    const { remarks } = parse(t.remarks, req.body ?? {});
    const store = await tx(async (client) => {
      const { rows } = await client.query('SELECT id, status FROM stores WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) throw notFound('Store not found');
      if (!t.from.includes(rows[0].status)) throw conflict(`Cannot ${action} a store that is ${rows[0].status.replace('_', ' ')}`);
      const updated = await client.query(
        `UPDATE stores SET status = $2, review_remarks = $3, reviewed_at = now(), updated_at = now()
          WHERE id = $1 RETURNING id, status, review_remarks, reviewed_at`,
        [req.params.id, t.to, remarks || null],
      );
      await client.query('INSERT INTO store_reviews (store_id, action, remarks, actor_id) VALUES ($1, $2, $3, $4)', [
        req.params.id,
        t.log,
        remarks || null,
        req.admin.id,
      ]);
      // Approving confirms the WhatsApp number the owner submitted (they messaged us from it): mark it verified, and
      // make it the owner's verified mobile when no one else uses that number.
      if (action === 'approve') await verifyWhatsAppOnApproval(client, req.params.id);
      return updated.rows[0];
    });
    res.json({ store });
  });
}

platformRouter.patch('/stores/:id/plan', async (req, res) => {
  const { plan, sku_limit } = parse(S.planChange, req.body);
  const { rows } = await query(
    'UPDATE stores SET plan = $2, sku_limit = $3, updated_at = now() WHERE id = $1 RETURNING id, plan, sku_limit',
    [req.params.id, plan, sku_limit],
  );
  if (!rows[0]) throw notFound('Store not found');
  res.json({ store: rows[0] });
});
