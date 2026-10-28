// Printed QR codes (see migrations/012_qr_codes.sql): generation, lookup by scan, link/unlink to a store.
import crypto from 'node:crypto';
import { config } from './config.js';
import { query, tx } from './db.js';
import { badRequest, conflict, notFound } from './errors.js';

/** Address printed in every QR code. Always the public site, so codes printed from any machine work. */
export const qrBase = () => config.publicUrl || 'https://sonsari.in';
export const qrUrl = (code) => `${qrBase()}/q/${code}`;
export const isQrCode = (v) => /^[1-9][0-9]{7}$/.test(String(v || ''));

/** Creates `count` new random 8-digit codes that have never been issued. Returns them with their batch label. */
export async function generateQrCodes(count) {
  const batch = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${count}`;
  const codes = [];
  for (let attempt = 0; codes.length < count && attempt < count * 20; attempt++) {
    const want = Math.min(count - codes.length, 200);
    const candidates = [...new Set(Array.from({ length: want }, () => String(crypto.randomInt(10_000_000, 100_000_000))))];
    const { rows } = await query(
      `INSERT INTO qr_codes (code, batch) SELECT unnest($1::text[]), $2 ON CONFLICT (code) DO NOTHING RETURNING code`,
      [candidates, batch],
    );
    codes.push(...rows.map((r) => r.code));
  }
  return { batch, codes };
}

/** "/s/sri-ganesh", "sri-ganesh", "https://sonsari.in/s/sri-ganesh/" → "sri-ganesh". */
export function storeSlugFrom(input) {
  let s = String(input || '').trim();
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname;
  } catch {
    /* not a URL: use as typed */
  }
  return s.replace(/^\/+/, '').replace(/^s\//i, '').replace(/[/?#].*$/, '').trim().toLowerCase();
}

/** The store an admin typed: its link name ("annapoorna"), its full link, or its name ("Annapoorna Family Restaurant"). */
async function findStore(client, input) {
  const text = String(input || '').trim();
  const slug = storeSlugFrom(text);
  const bySlug = await client.query('SELECT id, name, slug FROM stores WHERE slug = $1 OR slug = $2 LIMIT 1', [slug, slug.replace(/\s+/g, '-')]);
  if (bySlug.rows[0]) return bySlug.rows[0];
  const byName = await client.query(
    `SELECT id, name, slug FROM stores WHERE lower(name) = lower($1) ORDER BY (status = 'approved') DESC, created_at LIMIT 5`,
    [text],
  );
  if (byName.rows.length > 1) {
    const msg = `${byName.rows.length} stores are called "${text}". Pick one from the suggestions.`;
    throw conflict(msg, { store: msg });
  }
  if (byName.rows[0]) return byName.rows[0];
  const msg = `No store called "${text}". Pick one from the suggestions.`;
  throw notFound(msg, { store: msg });
}

/** Links a free code to a store; a code already linked must be removed first. */
export async function assignQrCode(code, storeRef) {
  if (!String(storeRef || '').trim()) throw badRequest('Enter the store name', { store: 'Enter the store name' });
  return tx(async (client) => {
    const { rows: qr } = await client.query('SELECT code, store_id FROM qr_codes WHERE code = $1 FOR UPDATE', [code]);
    if (!qr[0]) throw notFound('QR code not found');
    if (qr[0].store_id) throw conflict('This QR code is already linked to a store. Remove it first.');
    const store = await findStore(client, storeRef);
    await client.query('UPDATE qr_codes SET store_id = $2, assigned_at = now() WHERE code = $1', [code, store.id]);
    return store;
  });
}

export async function unassignQrCode(code) {
  const { rowCount } = await query('UPDATE qr_codes SET store_id = NULL, assigned_at = NULL WHERE code = $1', [code]);
  if (!rowCount) throw notFound('QR code not found');
}

/** A scan: counts it and returns the linked store's slug, or null if the code is free (or unknown: undefined). */
export async function scanQrCode(code) {
  if (!isQrCode(code)) return undefined;
  const { rows } = await query(
    `UPDATE qr_codes q SET scans = scans + 1, last_scanned_at = now()
      WHERE code = $1
      RETURNING (SELECT s.slug FROM stores s WHERE s.id = q.store_id) AS slug`,
    [code],
  );
  if (!rows[0]) return undefined;
  return rows[0].slug || null;
}
