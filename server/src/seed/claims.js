// Owner claim requests for seeded listings (migration 018): a new owner finds their shop, asks for it, proves it on
// WhatsApp, and the platform admin approves (hand-over to their email + WhatsApp number) or rejects.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { makeServerT, pickLanguage } from '../i18n.js';
import { sendMail } from '../mail.js';
import { DISTANCE_SQL } from '../routes/public.js';
import { claimSeedStore } from './stores.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, easy to read out
const newCode = () => `CLM-${Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('')}`;

const CLAIM_COLUMNS = `c.id, c.code, c.email, c.phone, c.status, c.remarks, c.created_at, c.decided_at,
  s.slug AS store_slug, s.name AS store_name, s.category AS store_category, s.locality AS store_locality, s.city AS store_city`;

/** What the claimant sees about their request. */
const forClaimant = (c) => ({
  code: c.code,
  status: c.status,
  phone: c.phone,
  created_at: c.created_at,
  store: { slug: c.store_slug, name: c.store_name, category: c.store_category, locality: c.store_locality, city: c.store_city },
});

/** Unclaimed seeded listings near (lat, lng), nearest first, optionally filtered by name. */
export async function searchClaimable({ q = '', lat, lng }) {
  const radius = config.nearbyRadiusKm;
  const distance = DISTANCE_SQL('$2', '$3');
  const { rows } = await query(
    `SELECT s.slug, s.name, s.category, s.locality, s.city, s.logo_url, s.address_text,
            round((${distance})::numeric, 1)::float AS distance_km
       FROM stores s
      WHERE s.origin = 'seed' AND s.claimed_at IS NULL AND s.status = 'approved'
        AND s.lat BETWEEN $2 - $5 AND $2 + $5 AND s.lng BETWEEN $3 - $6 AND $3 + $6 AND ${distance} <= $4
        AND ($1 = '' OR s.name ILIKE '%' || $1 || '%' OR s.locality ILIKE '%' || $1 || '%')
      ORDER BY ${distance}
      LIMIT 50`,
    [q, lat, lng, radius, radius / 111, radius / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))],
  );
  return rows;
}

/** The person's open request, for showing its status when they sign in again. */
export async function pendingClaimFor(email) {
  const { rows } = await query(
    `SELECT ${CLAIM_COLUMNS} FROM store_claims c JOIN stores s ON s.id = c.store_id WHERE c.email = $1 AND c.status = 'pending'`,
    [email],
  );
  return rows[0] ? forClaimant(rows[0]) : null;
}

/** Withdraws the person's open request (they created a store of their own instead). */
export const cancelPendingClaims = (client, email) =>
  client.query(`UPDATE store_claims SET status = 'cancelled', decided_at = now() WHERE email = $1 AND status = 'pending'`, [email]);

/**
 * Records a claim by a verified email that has no store yet. Asking again replaces the earlier open request.
 * The WhatsApp number must not already belong to another store.
 */
export async function requestClaim({ email, slug, phone, language = 'en' }) {
  return tx(async (client) => {
    if ((await client.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount) {
      throw conflict('An account with this email already exists. Please log in.');
    }
    const { rows } = await client.query(`SELECT id, origin, claimed_at FROM stores WHERE slug = $1 AND status = 'approved'`, [slug]);
    const store = rows[0];
    if (!store || store.origin !== 'seed') throw notFound('Store not found');
    if (store.claimed_at) throw conflict('This listing has already been claimed');
    const taken = await client.query(
      `SELECT 1 FROM users WHERE phone = $1 UNION ALL SELECT 1 FROM stores WHERE whatsapp_number = $1 AND NOT is_demo`,
      [phone],
    );
    if (taken.rowCount) {
      throw conflict('This mobile number already has a store. Log in with it, or use another number.', { phone: 'This mobile number already has a store' });
    }
    await cancelPendingClaims(client, email);
    for (let i = 0; ; i++) {
      try {
        await client.query('SAVEPOINT claim_code');
        await client.query(`INSERT INTO store_claims (code, store_id, email, phone, language) VALUES ($1, $2, $3, $4, $5)`, [
          newCode(),
          store.id,
          email,
          phone,
          pickLanguage(language),
        ]);
        break;
      } catch (err) {
        // A clash on the random code (unique_violation on store_claims_code_key): try another one.
        if (err.code !== '23505' || err.constraint !== 'store_claims_code_key' || i > 4) throw err;
        await client.query('ROLLBACK TO SAVEPOINT claim_code');
      }
    }
    const { rows: out } = await client.query(
      `SELECT ${CLAIM_COLUMNS} FROM store_claims c JOIN stores s ON s.id = c.store_id WHERE c.email = $1 AND c.status = 'pending'`,
      [email],
    );
    return forClaimant(out[0]);
  });
}

/** Admin list: open requests first (oldest first, like a queue); decided ones newest first. */
export async function listClaims(status = 'pending') {
  const one = ['pending', 'approved', 'rejected', 'cancelled'].includes(status);
  const { rows } = await query(
    `SELECT ${CLAIM_COLUMNS}, c.store_id, s.address_text AS store_address, s.seed_phone AS store_seed_phone,
            s.claimed_at AS store_claimed_at, u.username AS decided_by_username,
            (SELECT count(*)::int FROM store_claims o WHERE o.store_id = c.store_id AND o.status = 'pending' AND o.id <> c.id) AS other_pending
       FROM store_claims c JOIN stores s ON s.id = c.store_id LEFT JOIN users u ON u.id = c.decided_by
       ${one ? 'WHERE c.status = $1' : ''}
      ORDER BY (c.status = 'pending') DESC,
               CASE WHEN c.status = 'pending' THEN c.created_at END ASC,
               coalesce(c.decided_at, c.created_at) DESC
      LIMIT 200`,
    one ? [status] : [],
  );
  return rows;
}

async function openClaim(id) {
  const { rows } = await query(
    `SELECT c.*, s.name AS store_name, s.slug AS store_slug FROM store_claims c JOIN stores s ON s.id = c.store_id WHERE c.id = $1`,
    [id],
  );
  const claim = rows[0];
  if (!claim) throw notFound('Claim not found');
  if (claim.status !== 'pending') throw conflict('This claim has already been decided');
  return claim;
}

/**
 * Approves a claim: the listing is handed to the claimant's email (their login) and WhatsApp number (counted as
 * verified: the admin checked the proof in a chat from that number). Other open claims for the shop are rejected.
 */
export async function approveClaim({ id, actorId }) {
  const claim = await openClaim(id);
  await claimSeedStore({
    storeId: claim.store_id,
    email: claim.email,
    phone: claim.phone,
    verified: true,
    actorId,
    note: `Claim ${claim.code} approved: ownership checked on WhatsApp`,
  });
  await query(`UPDATE store_claims SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1`, [id, actorId]);
  const { rows: others } = await query(
    `UPDATE store_claims SET status = 'rejected', remarks = 'Another claim for this shop was approved', decided_by = $2, decided_at = now()
      WHERE store_id = $1 AND status = 'pending' RETURNING email, language`,
    [claim.store_id, actorId],
  );
  notify(claim, 'approved');
  for (const o of others) notify({ ...claim, ...o, remarks: '' }, 'rejected');
}

export async function rejectClaim({ id, remarks, actorId }) {
  const claim = await openClaim(id);
  await query(`UPDATE store_claims SET status = 'rejected', remarks = $2, decided_by = $3, decided_at = now() WHERE id = $1`, [id, remarks, actorId]);
  notify({ ...claim, remarks }, 'rejected');
}

/** Emails the claimant the decision in their language. Production only (local dev and tests send nothing); best effort. */
function notify(claim, decision) {
  if (!config.isProd || !config.smtp.user || !config.smtp.pass) return;
  const t = makeServerT(claim.language || 'en');
  const vars = { name: claim.store_name, code: claim.code, brand: config.platformName, url: `${config.publicUrl || 'https://sonsari.in'}/login`, email: claim.email };
  const body = decision === 'approved' ? t('claim.emailApprovedBody', vars) : `${t('claim.emailRejectedBody', vars)}${claim.remarks ? `\n\n${claim.remarks}` : ''}`;
  sendMail({
    to: claim.email,
    subject: t(decision === 'approved' ? 'claim.emailApprovedSubject' : 'claim.emailRejectedSubject', vars),
    text: body,
  }).catch((err) => console.error(`[claims] could not email ${claim.code}:`, err.message));
}
