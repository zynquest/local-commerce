// Merchant console API (/api/merchant). Every route is scoped to the logged-in owner's store.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { requireOwner } from '../auth.js';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { badRequest, conflict, notFound, parse } from '../errors.js';
import { MAX_MESSAGE_ITEMS, parseCatalogMessage } from '../catalog/messageParser.js';
import { verifyOtp } from '../otp/otp.js';
import * as S from '../schemas.js';
import { CLOSED_NOW_SQL, PRODUCT_COLUMNS, product as serializeProduct } from '../serialize.js';
import { qrBase } from '../qr.js';

export const merchantRouter = Router();
merchantRouter.use(requireOwner);

const PRODUCT_FIELDS = ['name', 'category', 'mrp', 'offer_price', 'images', 'description', 'specs', 'tags', 'rating', 'review_count', 'in_stock'];

const skuLimitError = (limit, used, adding) =>
  conflict(
    `Your plan allows ${limit} active products. You have ${used}${adding ? ` and tried to add ${adding}` : ''}. ` +
      `Archive unused products, or contact us for the paid plan (${limit}+ products).`,
  );

/** Next free auto SKU for the store (P0001, P0002, …), skipping codes the merchant already used. */
async function nextSku(client, storeId) {
  for (;;) {
    const { rows } = await client.query('UPDATE stores SET sku_seq = sku_seq + 1 WHERE id = $1 RETURNING sku_seq', [storeId]);
    const sku = `P${String(rows[0].sku_seq).padStart(4, '0')}`;
    const taken = await client.query('SELECT 1 FROM products WHERE store_id = $1 AND sku_id = $2', [storeId, sku]);
    if (!taken.rowCount) return sku;
  }
}

const REVIEWABLE = ['draft', 'rejected', 'suspended'];
// Once a store has been approved, these identify it to customers (links, QR codes, WhatsApp) and only the platform
// team can change them (PATCH /api/platform/stores/:id/details).
export const LOCKED_AFTER_APPROVAL = ['business_type', 'category', 'name', 'slug'];
export const detailsLocked = (store) => ['approved', 'suspended'].includes(store.status);
export const SUPPORT_WHATSAPP = '+91 93530 95481';
const lockedError = () =>
  conflict(`Business type, store type, store name, store link and WhatsApp number can't be changed after approval. Message support on WhatsApp ${SUPPORT_WHATSAPP} to correct them.`);
export const DEMO_WHATSAPP_LOCKED = 'Demo stores always take orders on the Vocal For Local WhatsApp number';

/** What must be in place before a store can be submitted for review. */
export async function reviewChecklist(store) {
  const common = [
    { key: 'name', label: 'Store name', done: Boolean(store.name) },
    { key: 'whatsapp', label: 'WhatsApp number for orders', done: Boolean(store.whatsapp_number) },
    // Shoppers only see businesses near them, so the map pin is required.
    { key: 'location', label: 'Location on the map', done: store.lat != null && store.lng != null && Boolean(store.address_text || store.city) },
    { key: 'category', label: 'Store type (e.g. Grocery, Bakery)', done: Boolean(store.category) },
  ];
  if (store.business_type === 'appointments') {
    const { rows } = await query(
      `SELECT (SELECT count(*)::int FROM services WHERE store_id = $1 AND active) AS services,
              (SELECT count(*)::int FROM specialists sp WHERE sp.store_id = $1 AND sp.active
                  AND EXISTS (SELECT 1 FROM specialist_services ss JOIN services sv ON sv.id = ss.service_id
                               WHERE ss.specialist_id = sp.id AND sv.active)
                  AND EXISTS (SELECT 1 FROM jsonb_each(sp.schedule) d WHERE jsonb_array_length(d.value) > 0)) AS specialists`,
      [store.id],
    );
    return [
      ...common,
      { key: 'services', label: 'At least 1 service', done: rows[0].services > 0 },
      { key: 'specialists', label: 'At least 1 specialist with working hours and services', done: rows[0].specialists > 0 },
    ];
  }
  const { rows } = await query(`SELECT count(*)::int AS n FROM products WHERE store_id = $1 AND status = 'active'`, [store.id]);
  return [
    ...common,
    {
      key: 'products',
      label: `At least ${config.minProductsForReview} product${config.minProductsForReview > 1 ? 's' : ''}`,
      done: rows[0].n >= config.minProductsForReview,
    },
  ];
}

async function storeWithReview(storeId) {
  const { rows } = await query(`SELECT s.*, ${CLOSED_NOW_SQL} AS closed_now FROM stores s WHERE s.id = $1`, [storeId]);
  const store = rows[0];
  const [usage, reviews, checklist] = await Promise.all([
    query(`SELECT count(*)::int AS used FROM products WHERE store_id = $1 AND status = 'active'`, [storeId]),
    query('SELECT action, remarks, created_at FROM store_reviews WHERE store_id = $1 ORDER BY created_at DESC LIMIT 20', [storeId]),
    reviewChecklist(store),
  ]);
  const { owner_id, sku_seq, ...rest } = store;
  return {
    ...rest,
    sku_used: usage.rows[0].used,
    reviews: reviews.rows,
    checklist,
    can_submit: REVIEWABLE.includes(store.status),
    details_locked: detailsLocked(store),
  };
}

/** Locks the store row so concurrent creates can't exceed the SKU limit. Returns { limit, used }. */
async function lockSkuUsage(client, storeId) {
  const { rows } = await client.query(
    `SELECT s.sku_limit AS limit,
            (SELECT count(*)::int FROM products p WHERE p.store_id = s.id AND p.status = 'active') AS used
       FROM stores s WHERE s.id = $1 FOR UPDATE`,
    [storeId],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Store settings + dashboard
// ---------------------------------------------------------------------------

merchantRouter.get('/store', async (req, res) => {
  res.json({ store: await storeWithReview(req.user.store_id) });
});

/**
 * Sets the store's WhatsApp number for orders (unverified: the platform verifies it when approving the store).
 * The number must not belong to another store or another owner's login.
 */
async function setWhatsApp(client, store, ownerId, phone) {
  if (phone === store.whatsapp_number) return;
  if (store.is_demo) throw badRequest(DEMO_WHATSAPP_LOCKED);
  if (detailsLocked(store)) throw lockedError();
  const taken = await client.query(
    `SELECT 1 FROM stores WHERE whatsapp_number = $1 AND id <> $2 AND NOT is_demo
     UNION ALL SELECT 1 FROM users WHERE phone = $1 AND id <> $3`,
    [phone, store.id, ownerId],
  );
  if (taken.rowCount) throw conflict('This WhatsApp number is already used by another store', { whatsapp_number: 'This WhatsApp number is already used by another store' });
  await client.query('UPDATE stores SET whatsapp_number = $2, whatsapp_verified = false, updated_at = now() WHERE id = $1', [store.id, phone]);
  store.whatsapp_number = phone;
}

/**
 * Submit (or resubmit after rejection/suspension) for platform review. The WhatsApp number for orders can be given
 * here (OWNER_LOGIN=email stores don't have one yet); the client also opens a WhatsApp message to the platform from
 * that number, and approval marks the number verified.
 */
merchantRouter.post('/store/submit', async (req, res) => {
  const { note, whatsapp_number } = parse(S.submitForReview, req.body ?? {});
  await tx(async (client) => {
    const { rows } = await client.query('SELECT * FROM stores WHERE id = $1 FOR UPDATE', [req.user.store_id]);
    const store = rows[0];
    if (!REVIEWABLE.includes(store.status)) {
      throw conflict(store.status === 'pending_review' ? 'Your store is already waiting for review' : 'Your store is already approved');
    }
    if (whatsapp_number) await setWhatsApp(client, store, req.user.id, whatsapp_number);
    const missing = (await reviewChecklist(store)).filter((c) => !c.done);
    if (missing.length) throw badRequest(`Please complete: ${missing.map((m) => m.label).join(', ')}`);
    await client.query(`UPDATE stores SET status = 'pending_review', submitted_at = now(), updated_at = now() WHERE id = $1`, [store.id]);
    await client.query(`INSERT INTO store_reviews (store_id, action, remarks, actor_id) VALUES ($1, 'submitted', $2, $3)`, [
      store.id,
      note || null,
      req.user.id,
    ]);
  });
  res.json({ store: await storeWithReview(req.user.store_id) });
});

/** OWNER_LOGIN=email: changes the WhatsApp number without an OTP; it's unverified until the platform approves it. */
merchantRouter.put('/store/whatsapp', async (req, res) => {
  const { phone } = parse(S.whatsappSet, req.body);
  await tx(async (client) => {
    const { rows } = await client.query('SELECT * FROM stores WHERE id = $1 FOR UPDATE', [req.user.store_id]);
    await setWhatsApp(client, rows[0], req.user.id, phone);
  });
  res.json({ store: await storeWithReview(req.user.store_id) });
});

/** Confirms a WhatsApp number change with the OTP sent to the new number (see POST /api/otp/request). */
merchantRouter.post('/store/whatsapp/verify', async (req, res) => {
  const { phone, code } = parse(S.whatsappVerify, req.body);
  const { rows: demo } = await query('SELECT is_demo, status FROM stores WHERE id = $1', [req.user.store_id]);
  if (demo[0]?.is_demo) throw badRequest(DEMO_WHATSAPP_LOCKED);
  if (detailsLocked(demo[0])) throw lockedError();
  const context = await verifyOtp({ phone, purpose: 'whatsapp_change', code });
  if (context.store_id !== req.user.store_id) throw badRequest('This code was issued for a different store');
  await query('UPDATE stores SET whatsapp_number = $2, whatsapp_verified = true, updated_at = now() WHERE id = $1', [
    req.user.store_id,
    phone,
  ]);
  res.json({ store: await storeWithReview(req.user.store_id) });
});

merchantRouter.put('/store', async (req, res) => {
  const data = parse(S.storeSettings, req.body);
  if (data.delivery_fee !== undefined && !(Number(data.delivery_fee) > 0)) data.free_delivery_above = null; // free delivery: no threshold
  const { rows: current } = await query('SELECT status, business_type, category, name, slug FROM stores WHERE id = $1', [req.user.store_id]);
  if (detailsLocked(current[0])) {
    // The settings form sends these back unchanged; only an actual change is refused.
    const changed = LOCKED_AFTER_APPROVAL.filter((k) => data[k] !== undefined && String(data[k] ?? '') !== String(current[0][k] ?? ''));
    if (changed.length) throw lockedError();
    for (const k of LOCKED_AFTER_APPROVAL) delete data[k];
  }
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (!entries.length) throw badRequest('Nothing to update');
  if (data.slug) {
    const taken = await query('SELECT 1 FROM stores WHERE slug = $1 AND id <> $2', [data.slug, req.user.store_id]);
    if (taken.rowCount) throw conflict('That store link is already taken', { slug: 'That store link is already taken' });
  }
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  await query(`UPDATE stores SET ${sets}, updated_at = now() WHERE id = $1`, [req.user.store_id, ...entries.map(([, v]) => v)]);
  res.json({ store: await storeWithReview(req.user.store_id) });
});

/** The printed QR stickers the platform team linked to this store (see /api/platform/qr), for printing and sharing. */
merchantRouter.get('/qr', async (req, res) => {
  const { rows } = await query(
    'SELECT code, scans, last_scanned_at, assigned_at FROM qr_codes WHERE store_id = $1 ORDER BY assigned_at, code',
    [req.user.store_id],
  );
  res.json({ codes: rows, base: qrBase() });
});

merchantRouter.get('/stats', async (req, res) => {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM products WHERE store_id = $1 AND status = 'active') AS sku_used,
       (SELECT sku_limit FROM stores WHERE id = $1) AS sku_limit,
       (SELECT count(*)::int FROM orders WHERE store_id = $1 AND created_at >= date_trunc('day', now())) AS orders_today,
       (SELECT count(*)::int FROM orders WHERE store_id = $1 AND status = 'placed') AS orders_pending,
       (SELECT coalesce(sum(total), 0) FROM orders
          WHERE store_id = $1 AND status <> 'cancelled' AND created_at >= now() - interval '7 days') AS revenue_7d,
       (SELECT count(*)::int FROM appointments WHERE store_id = $1 AND status IN ('requested', 'confirmed')
          AND starts_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
          AND starts_at < (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 day') AT TIME ZONE 'Asia/Kolkata') AS appointments_today,
       (SELECT count(*)::int FROM appointments WHERE store_id = $1 AND status = 'requested' AND ends_at > now()) AS appointments_pending`,
    [req.user.store_id],
  );
  res.json(rows[0]);
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

merchantRouter.get('/products', async (req, res) => {
  const { rows } = await query(
    `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.store_id = $1 ORDER BY p.status, p.position, p.created_at`,
    [req.user.store_id],
  );
  res.json({ products: rows.map(serializeProduct) });
});

merchantRouter.post('/products', async (req, res) => {
  const p = parse(S.product, req.body);
  const row = await tx(async (client) => {
    const { limit, used } = await lockSkuUsage(client, req.user.store_id);
    if (used >= limit) throw skuLimitError(limit, used);
    if (p.sku_id) {
      const dup = await client.query('SELECT 1 FROM products WHERE store_id = $1 AND sku_id = $2', [req.user.store_id, p.sku_id]);
      if (dup.rowCount) throw conflict(`Item code ${p.sku_id} is already used by another product`, { sku_id: 'Already used' });
    } else {
      p.sku_id = await nextSku(client, req.user.store_id);
    }
    const { rows } = await client.query(
      `INSERT INTO products (store_id, sku_id, ${PRODUCT_FIELDS.join(', ')}, position)
       VALUES ($1, $2, ${PRODUCT_FIELDS.map((_, i) => `$${i + 3}`).join(', ')},
               (SELECT coalesce(max(position), 0) + 1 FROM products WHERE store_id = $1))
       RETURNING ${PRODUCT_COLUMNS.replaceAll('p.', '')}`,
      [req.user.store_id, p.sku_id, ...PRODUCT_FIELDS.map((f) => (f === 'specs' ? JSON.stringify(p[f]) : p[f]))],
    );
    await client.query('UPDATE stores SET updated_at = now() WHERE id = $1', [req.user.store_id]);
    return rows[0];
  });
  res.status(201).json({ product: serializeProduct(row) });
});

merchantRouter.put('/products/:id', async (req, res) => {
  const p = parse(S.product, req.body); // sku_id is immutable; the body's value is ignored
  const { rows } = await query(
    `UPDATE products SET ${PRODUCT_FIELDS.map((f, i) => `${f} = $${i + 3}`).join(', ')}, updated_at = now()
      WHERE id = $1 AND store_id = $2
      RETURNING ${PRODUCT_COLUMNS.replaceAll('p.', '')}`,
    [req.params.id, req.user.store_id, ...PRODUCT_FIELDS.map((f) => (f === 'specs' ? JSON.stringify(p[f]) : p[f]))],
  );
  if (!rows[0]) throw notFound('Product not found');
  await query('UPDATE stores SET updated_at = now() WHERE id = $1', [req.user.store_id]);
  res.json({ product: serializeProduct(rows[0]) });
});

merchantRouter.patch('/products/:id', async (req, res) => {
  const patch = {};
  if (typeof req.body?.in_stock === 'boolean') patch.in_stock = req.body.in_stock;
  if (['active', 'archived'].includes(req.body?.status)) patch.status = req.body.status;
  if (!Object.keys(patch).length) throw badRequest('Nothing to update');

  const row = await tx(async (client) => {
    if (patch.status === 'active') {
      const current = await client.query('SELECT status FROM products WHERE id = $1 AND store_id = $2', [req.params.id, req.user.store_id]);
      if (current.rows[0]?.status === 'archived') {
        const { limit, used } = await lockSkuUsage(client, req.user.store_id);
        if (used >= limit) throw skuLimitError(limit, used);
      }
    }
    const keys = Object.keys(patch);
    const { rows } = await client.query(
      `UPDATE products SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now()
        WHERE id = $1 AND store_id = $2 RETURNING ${PRODUCT_COLUMNS.replaceAll('p.', '')}`,
      [req.params.id, req.user.store_id, ...keys.map((k) => patch[k])],
    );
    if (!rows[0]) throw notFound('Product not found');
    await client.query('UPDATE stores SET updated_at = now() WHERE id = $1', [req.user.store_id]);
    return rows[0];
  });
  res.json({ product: serializeProduct(row) });
});

merchantRouter.delete('/products/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM products WHERE id = $1 AND store_id = $2', [req.params.id, req.user.store_id]);
  if (!rowCount) throw notFound('Product not found');
  await query('UPDATE stores SET updated_at = now() WHERE id = $1', [req.user.store_id]);
  res.json({ ok: true });
});

/**
 * Bulk import (CSV / Excel). Rows are matched to existing products by item code (sku_id) when given,
 * otherwise by product name (case-insensitive), so re-importing a sheet updates instead of duplicating.
 * All-or-nothing per request; the client sends at most 500 valid rows at a time.
 */
merchantRouter.post('/products/import', async (req, res) => {
  const { products: rawRows } = parse(S.productImport, req.body);
  const valid = [];
  const errors = [];
  const seenSku = new Set();
  const seenName = new Set();
  rawRows.forEach((raw, i) => {
    const r = S.product.safeParse(raw);
    if (!r.success) return errors.push({ row: i + 1, error: r.error.issues.map((x) => x.message).join('; ') });
    const nameKey = r.data.name.toLowerCase();
    if (r.data.sku_id && seenSku.has(r.data.sku_id)) return errors.push({ row: i + 1, error: `Duplicate item code ${r.data.sku_id}` });
    if (!r.data.sku_id && seenName.has(nameKey)) return errors.push({ row: i + 1, error: `Duplicate product name "${r.data.name}"` });
    if (r.data.sku_id) seenSku.add(r.data.sku_id);
    seenName.add(nameKey);
    valid.push(r.data);
  });
  if (errors.length) throw badRequest(`${errors.length} row(s) have errors`, { rows: errors.slice(0, 50) });

  const result = await tx(async (client) => {
    const { limit, used } = await lockSkuUsage(client, req.user.store_id);
    const { rows: existing } = await client.query('SELECT id, sku_id, lower(name) AS name_key, status FROM products WHERE store_id = $1', [
      req.user.store_id,
    ]);
    const bySku = new Map(existing.map((e) => [e.sku_id, e]));
    const byName = new Map(existing.map((e) => [e.name_key, e]));
    const matched = valid.map((p) => (p.sku_id ? bySku.get(p.sku_id) : byName.get(p.name.toLowerCase())) || null);

    // New products and re-imported archived products both become active.
    const adding = matched.filter((m) => !m || m.status !== 'active').length;
    if (used + adding > limit) throw skuLimitError(limit, used, adding);

    let { rows: posRows } = await client.query('SELECT coalesce(max(position), 0) AS pos FROM products WHERE store_id = $1', [req.user.store_id]);
    let position = Number(posRows[0].pos);
    let inserted = 0;
    let updated = 0;
    for (let i = 0; i < valid.length; i++) {
      const p = valid[i];
      const values = PRODUCT_FIELDS.map((f) => (f === 'specs' ? JSON.stringify(p[f]) : p[f]));
      if (matched[i]) {
        await client.query(
          `UPDATE products SET ${PRODUCT_FIELDS.map((f, j) => `${f} = $${j + 2}`).join(', ')}, status = 'active', updated_at = now()
            WHERE id = $1`,
          [matched[i].id, ...values],
        );
        updated++;
      } else {
        const sku = p.sku_id || (await nextSku(client, req.user.store_id));
        await client.query(
          `INSERT INTO products (store_id, sku_id, ${PRODUCT_FIELDS.join(', ')}, position)
           VALUES ($1, $2, ${PRODUCT_FIELDS.map((_, j) => `$${j + 3}`).join(', ')}, $${PRODUCT_FIELDS.length + 3})`,
          [req.user.store_id, sku, ...values, ++position],
        );
        inserted++;
      }
    }
    await client.query('UPDATE stores SET updated_at = now() WHERE id = $1', [req.user.store_id]);
    return { inserted, updated };
  });
  res.json(result);
});

/**
 * Products from a pasted WhatsApp message. Each product is handled on its own: valid ones are created (or, when a
 * product with the same name exists, its prices are updated); invalid ones come back with an error code and the
 * message lines they came from. dryRun: same report, nothing saved.
 */
merchantRouter.post('/products/from-message', async (req, res) => {
  const { text, dryRun } = parse(S.messageImport, req.body);
  const { items } = parseCatalogMessage(text);
  if (!items.length) throw badRequest('No products found in the message');
  if (items.length > MAX_MESSAGE_ITEMS) throw badRequest(`Too many products in one message (max ${MAX_MESSAGE_ITEMS}). Send it in parts.`);

  const results = await tx(async (client) => {
    const { limit, used } = await lockSkuUsage(client, req.user.store_id);
    const { rows: existing } = await client.query('SELECT id, lower(name) AS name_key, status FROM products WHERE store_id = $1', [req.user.store_id]);
    const byName = new Map(existing.map((e) => [e.name_key, e]));
    let room = Math.max(0, limit - used);
    let { rows: posRows } = await client.query('SELECT coalesce(max(position), 0) AS pos FROM products WHERE store_id = $1', [req.user.store_id]);
    let position = Number(posRows[0].pos);
    const out = [];

    for (const item of items) {
      const base = { index: item.index, lines: item.lines, source: item.source };
      if (item.error) {
        out.push({ ...base, status: 'failed', error: item.error, params: item.params || {} });
        continue;
      }
      // Same rules as the product form (name length, price range, list price ≤ MRP).
      const checked = S.product.safeParse({ name: item.name, mrp: item.mrp, offer_price: item.list_price });
      if (!checked.success) {
        out.push({ ...base, status: 'failed', error: 'invalid', params: { message: checked.error.issues.map((x) => x.message).join('; ') } });
        continue;
      }
      const p = checked.data;
      const match = byName.get(p.name.toLowerCase());
      const needsSlot = !match || match.status !== 'active';
      if (needsSlot && room <= 0) {
        out.push({ ...base, status: 'failed', error: 'sku_limit', params: { limit } });
        continue;
      }
      if (needsSlot) room--;
      const result = { ...base, status: match ? 'updated' : 'created', name: p.name, mrp: p.mrp, list_price: p.offer_price };
      if (!dryRun) {
        if (match) {
          // Only prices change; the product's photos, category and description are kept.
          await client.query(`UPDATE products SET mrp = $2, offer_price = $3, status = 'active', updated_at = now() WHERE id = $1`, [match.id, p.mrp, p.offer_price]);
        } else {
          const sku = await nextSku(client, req.user.store_id);
          await client.query(
            `INSERT INTO products (store_id, sku_id, ${PRODUCT_FIELDS.join(', ')}, position)
             VALUES ($1, $2, ${PRODUCT_FIELDS.map((_, j) => `$${j + 3}`).join(', ')}, $${PRODUCT_FIELDS.length + 3})`,
            [req.user.store_id, sku, ...PRODUCT_FIELDS.map((f) => (f === 'specs' ? JSON.stringify(p[f]) : p[f])), ++position],
          );
        }
      }
      byName.set(p.name.toLowerCase(), { id: match?.id, status: 'active' });
      out.push(result);
    }
    if (!dryRun && out.some((r) => r.status !== 'failed')) await client.query('UPDATE stores SET updated_at = now() WHERE id = $1', [req.user.store_id]);
    return out;
  });

  const count = (status) => results.filter((r) => r.status === status).length;
  res.json({ dryRun, summary: { created: count('created'), updated: count('updated'), failed: count('failed') }, results });
});

// ---------------------------------------------------------------------------
// Image uploads: resized to WebP (+ a JPEG twin for link previews) and stored under UPLOAD_DIR/<store_id>/
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    /^image\/(jpeg|png|webp|gif|avif|heic|heif)$/.test(file.mimetype) ? cb(null, true) : cb(badRequest('Please upload an image')),
});

merchantRouter.post('/uploads', upload.single('image'), async (req, res) => {
  if (!req.file) throw badRequest('No image received');
  let output;
  let share;
  try {
    const img = sharp(req.file.buffer, { failOn: 'error' })
      .rotate() // respect EXIF orientation from phone cameras
      .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true });
    output = await img.clone().webp({ quality: 80 }).toBuffer();
    // JPEG twin for link previews (og:image): WhatsApp/Facebook previews don't reliably support WebP.
    share = await img.clone().flatten({ background: '#ffffff' }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  } catch {
    throw badRequest('That file could not be read as an image');
  }
  const dir = path.join(config.uploadDir, req.user.store_id);
  await fs.mkdir(dir, { recursive: true });
  const id = crypto.randomUUID();
  const name = `${id}.webp`;
  await fs.writeFile(path.join(dir, name), output);
  await fs.writeFile(path.join(dir, `${id}.jpg`), share);
  res.status(201).json({ url: `/uploads/${req.user.store_id}/${name}` });
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

merchantRouter.get('/orders', async (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  const { rows } = await query(
    `SELECT o.*, c.name AS account_name,
            coalesce(json_agg(json_build_object(
              'sku_id', i.sku_id, 'name', i.name, 'quantity', i.quantity,
              'unit_price', i.unit_price, 'mrp', i.mrp, 'line_total', i.line_total) ORDER BY i.id)
              FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM orders o
       LEFT JOIN order_items i ON i.order_id = o.id
       LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.store_id = $1 AND ($2::text IS NULL OR o.status = $2) AND ($3::timestamptz IS NULL OR o.created_at < $3)
      GROUP BY o.id, c.name
      ORDER BY o.created_at DESC
      LIMIT $4`,
    [req.user.store_id, status, before && !isNaN(before) ? before : null, limit],
  );
  res.json({ orders: rows.map(({ store_id, ...o }) => o) });
});

merchantRouter.patch('/orders/:id', async (req, res) => {
  const { status } = parse(S.orderStatus, req.body);
  const { rows } = await query(
    'UPDATE orders SET status = $3, updated_at = now() WHERE id = $1 AND store_id = $2 RETURNING id, status',
    [req.params.id, req.user.store_id, status],
  );
  if (!rows[0]) throw notFound('Order not found');
  res.json(rows[0]);
});
