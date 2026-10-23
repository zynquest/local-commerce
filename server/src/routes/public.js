// Public storefront API: store directory, catalog, guest/customer order placement.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { optionalCustomer, viewer } from '../auth.js';
import { config } from '../config.js';
import { getProvider } from '../otp/providers.js';
import { clientKey } from '../clientIp.js';
import { query, tx } from '../db.js';
import { badRequest, notFound, parse } from '../errors.js';
import * as S from '../schemas.js';
import { PRODUCT_COLUMNS, PUBLIC_STORE_COLUMNS, deliveryFeeFor, product as serializeProduct, publicStore, round2 } from '../serialize.js';
import { publicBookingCatalog } from './appointments.js';

export const publicRouter = Router();

/** Feature flags and plan limits the UI needs. */
publicRouter.get('/config', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    freeSkuLimit: config.freeSkuLimit,
    platformName: config.platformName,
    // How OTPs reach users: 'manual' = WhatsApp otpHelpWhatsApp to receive the code (until an SMS gateway exists).
    otpDelivery: getProvider().delivery,
    otpHelpWhatsApp: config.otpHelpWhatsApp,
    mapsKey: config.googleMapsKey,
    mapId: config.googleMapId,
    nearbyKm: config.nearbyRadiusKm,
  });
});

// Great-circle distance in km between the store and ($lat, $lng) — fine at city scale, no PostGIS needed.
const DISTANCE_SQL = (latParam, lngParam) => `(6371 * 2 * asin(sqrt(
    power(sin(radians(s.lat - ${latParam}) / 2), 2) +
    cos(radians(${latParam})) * cos(radians(s.lat)) * power(sin(radians(s.lng - ${lngParam}) / 2), 2))))`;

/**
 * Directory. With ?lat=&lng= (the shopper's location) only businesses within the radius are returned, nearest
 * first, plus demo stores (labelled, so new visitors anywhere can try the app). Without a location: every
 * approved store (used for SEO pages and links that don't need "near me").
 * ?type=shop|appointments filters by business type.
 */
publicRouter.get('/stores', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const near = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const radius = Math.min(config.nearbyRadiusKm, Math.max(0.5, Number(req.query.radius) || config.nearbyRadiusKm));
  const type = ['shop', 'appointments'].includes(req.query.type) ? req.query.type : '';
  const params = [q, type];
  let distance = 'NULL::float';
  let where = '';
  let order = 's.is_demo, s.verified DESC, s.created_at DESC';
  if (near) {
    params.push(lat, lng, radius, radius / 111, radius / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))));
    distance = DISTANCE_SQL('$3', '$4');
    // Bounding box first (uses the index), exact distance second. Demo stores are always included.
    where = `AND (s.is_demo OR (s.lat BETWEEN $3 - $6 AND $3 + $6 AND s.lng BETWEEN $4 - $7 AND $4 + $7 AND ${distance} <= $5))`;
    order = `s.is_demo, ${distance} NULLS LAST, s.verified DESC`;
  }
  const { rows } = await query(
    `SELECT s.slug, s.name, s.logo_url, s.category, s.city, s.description, s.verified, s.is_demo, s.business_type,
            round((${distance})::numeric, 1)::float AS distance_km,
            CASE WHEN s.business_type = 'appointments'
                 THEN (SELECT count(*)::int FROM services sv WHERE sv.store_id = s.id AND sv.active)
                 ELSE (SELECT count(*)::int FROM products p WHERE p.store_id = s.id AND p.status = 'active') END AS product_count
       FROM stores s
      WHERE s.status = 'approved' AND s.whatsapp_number IS NOT NULL
        AND ($1 = '' OR s.name ILIKE '%' || $1 || '%' OR s.city ILIKE '%' || $1 || '%' OR s.category ILIKE '%' || $1 || '%')
        AND ($2 = '' OR s.business_type = $2)
        ${where}
      ORDER BY ${order}
      LIMIT 100`,
    params,
  );
  res.json({ stores: rows, near: near ? { lat, lng, radius_km: radius } : null });
});

publicRouter.get('/domains/:host', async (req, res) => {
  const host = String(req.params.host).toLowerCase().replace(/^www\./, '');
  const { rows } = await query(
    `SELECT slug FROM stores WHERE status = 'approved' AND (custom_domain = $1 OR custom_domain = 'www.' || $1)`,
    [host],
  );
  if (!rows[0]) throw notFound('No store for this domain');
  res.json({ slug: rows[0].slug });
});

/**
 * Store profile + full active catalog (≤500 SKUs on the free plan, so one payload).
 * Any product or settings change bumps stores.updated_at, which versions the ETag; clients send
 * If-None-Match and get a cheap 304 when nothing changed.
 */
publicRouter.get('/stores/:slug', async (req, res) => {
  const { rows } = await query(`SELECT ${PUBLIC_STORE_COLUMNS}, s.status FROM stores s WHERE s.slug = $1`, [req.params.slug]);
  const store = rows[0];
  if (!store) throw notFound('Store not found');

  // Only approved stores are public. The owner and the platform admin can preview others.
  let preview = false;
  if (store.status !== 'approved') {
    const who = await viewer(req);
    if (who.ownerStoreId !== store.id && !who.isAdmin) throw notFound('Store not found');
    preview = true;
  }

  // b2: payload shape version (appointment stores added services/specialists) so old device caches refetch.
  const version = `${store.id}-${new Date(store.updated_at).getTime()}-${store.status}-b2`;
  const etag = `"${version}"`;
  res.set('ETag', etag);
  res.set('Cache-Control', 'no-cache');
  // Proxies/CDNs may weaken or suffix the tag (W/"…", "…-gzip"), so match on the version itself.
  if ((req.get('If-None-Match') || '').includes(version)) return res.status(304).end();

  const pub = publicStore(store);
  if (preview) Object.assign(pub, { preview: true, status: store.status, accepting_orders: false });
  if (store.business_type === 'appointments') {
    const { services, specialists } = await publicBookingCatalog(store.id);
    return res.json({ store: pub, products: [], services, specialists, version: etag });
  }
  const products = await query(
    `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.store_id = $1 AND p.status = 'active' ORDER BY p.position, p.created_at`,
    [store.id],
  );
  res.json({ store: pub, products: products.rows.map(serializeProduct), version: etag });
});

const orderLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: clientKey });

/**
 * Records an order. Idempotent on (store, order_code) so the offline outbox can safely retry.
 * Prices come from the device (they're what the shopper saw and sent on WhatsApp); any difference
 * from the live catalog is flagged with price_mismatch for the merchant.
 */
publicRouter.post('/stores/:slug/orders', orderLimiter, optionalCustomer, async (req, res) => {
  const o = parse(S.placeOrder, req.body);
  if (!o.items.length && !o.notes) throw badRequest('Add at least one item or a note');

  const storeRes = await query(`SELECT id, delivery_fee, free_delivery_above, whatsapp_number, business_type FROM stores WHERE slug = $1 AND status = 'approved'`, [req.params.slug]);
  const store = storeRes.rows[0];
  if (!store) throw notFound('Store not found');
  if (store.business_type === 'appointments') throw badRequest('This business takes appointments, not orders');

  const existing = await query('SELECT id, order_code, total, status FROM orders WHERE store_id = $1 AND order_code = $2', [
    store.id,
    o.order_code,
  ]);
  if (existing.rows[0]) return res.json({ order: existing.rows[0], duplicate: true });

  const live = await query(
    `SELECT id, sku_id, name, mrp, offer_price, in_stock, status FROM products WHERE store_id = $1 AND sku_id = ANY($2)`,
    [store.id, o.items.map((i) => i.sku_id)],
  );
  const bySku = new Map(live.rows.map((p) => [p.sku_id, p]));

  let mismatch = false;
  const lines = o.items.map((item) => {
    const p = bySku.get(item.sku_id);
    if (!p || p.status !== 'active' || !p.in_stock || p.offer_price !== item.unit_price) mismatch = true;
    const unit = round2(item.unit_price);
    return {
      product_id: p?.id || null,
      sku_id: item.sku_id,
      name: p?.name || item.name || item.sku_id,
      mrp: round2(Math.max(p?.mrp ?? item.mrp ?? unit, unit)),
      unit_price: unit,
      quantity: item.quantity,
      line_total: round2(unit * item.quantity),
    };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
  const savings = round2(lines.reduce((s, l) => s + (l.mrp - l.unit_price) * l.quantity, 0));
  const deliveryFee = deliveryFeeFor(store, subtotal, lines.length > 0);

  let { customer_name: name, customer_phone: phone } = o;
  if (req.customerId && (!name || !phone)) {
    const c = await query('SELECT name, phone FROM customers WHERE id = $1', [req.customerId]);
    name ||= c.rows[0]?.name || null;
    phone ||= c.rows[0]?.phone || null;
  }

  const order = await tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO orders (store_id, order_code, customer_id, customer_name, customer_phone, delivery_address, notes,
                           subtotal, delivery_fee, savings, total, price_mismatch, placed_offline, client_created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (store_id, order_code) DO NOTHING
       RETURNING id, order_code, total, status, price_mismatch`,
      [store.id, o.order_code, req.customerId, name, phone, o.delivery_address, o.notes, subtotal, deliveryFee, savings,
        round2(subtotal + deliveryFee), mismatch, o.placed_offline, o.client_created_at || null],
    );
    if (!rows[0]) return null; // a concurrent retry won the race
    for (const l of lines) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, sku_id, name, mrp, unit_price, quantity, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [rows[0].id, l.product_id, l.sku_id, l.name, l.mrp, l.unit_price, l.quantity, l.line_total],
      );
    }
    return rows[0];
  });
  if (!order) {
    const again = await query('SELECT id, order_code, total, status FROM orders WHERE store_id = $1 AND order_code = $2', [store.id, o.order_code]);
    return res.json({ order: again.rows[0], duplicate: true });
  }
  res.status(201).json({ order });
});
