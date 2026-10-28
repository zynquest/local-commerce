// Imports seed CSV rows as seeded listings: one placeholder owner + an approved store per shop, with the category's
// starter catalog. Idempotent: the same source_ref updates the listing (until the owner claims it), a shop already
// on the platform within 60 m under the same name is skipped, and listings removed on request never come back.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { RESERVED_SLUGS, slugify } from '../serialize.js';
import { art, writeFile } from '../cli/art.js';
import { SEED_CATEGORIES } from './catalogs.js';
import { dedupeRows, distanceKm, mobileOf, sameName } from './util.js';

const SOURCES = new Set(['osm', 'google_places', 'manual']);
const HOURS = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/;
const hash = (s, n = 12) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);

/** One set of artwork per category, shared by every seeded store of that category (UPLOAD_DIR/seed-catalog/). */
const assetCache = new Map();
async function categoryAssets(key) {
  if (assetCache.has(key)) return assetCache.get(key);
  const c = SEED_CATEGORIES[key];
  const [a, b, light] = c.palette;
  const logo = await writeFile('seed-catalog', `logo-${key}`, 'svg', art(c.emoji, ['#ffffff', c.color]));
  const products = [];
  for (const [i, p] of c.products.entries()) {
    products.push([
      await writeFile('seed-catalog', `${key}-${i + 1}a`, 'svg', art(p.emoji, [a, b])),
      await writeFile('seed-catalog', `${key}-${i + 1}b`, 'svg', art(p.alt || p.emoji, [light, a])),
    ]);
  }
  const assets = { logo, products };
  assetCache.set(key, assets);
  return assets;
}

function catalogRows(key, images) {
  const prefix = key.slice(0, 4).toUpperCase();
  return SEED_CATEGORIES[key].products.map((p, i) => ({
    sku_id: `S${prefix}-${String(i + 1).padStart(3, '0')}`,
    name: p.name,
    category: p.section,
    mrp: p.mrp,
    offer_price: p.price,
    images: images[i],
    description: p.description,
    specs: p.specs,
    position: i + 1,
  }));
}

async function insertCatalog(client, storeId, key) {
  const { products } = await categoryAssets(key);
  await client.query(
    `INSERT INTO products (store_id, sku_id, name, category, mrp, offer_price, images, description, specs, position)
     SELECT $1, x.sku_id, x.name, x.category, x.mrp, x.offer_price, x.images, x.description, x.specs, x.position
       FROM jsonb_to_recordset($2::jsonb)
         AS x(sku_id text, name text, category text, mrp numeric, offer_price numeric, images text[], description text, specs jsonb, position int)`,
    [storeId, JSON.stringify(catalogRows(key, products))],
  );
}

/** Validates and normalises one CSV row; returns [row, null] or [null, reason]. */
function normalise(r, city) {
  const name = String(r.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const category = String(r.category || '').trim().toLowerCase();
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  if (name.length < 2) return [null, 'no name'];
  if (!SEED_CATEGORIES[category]) return [null, `category "${r.category}" is not seeded`];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [null, 'no location'];
  const source = SOURCES.has(r.source) ? r.source : 'manual';
  const ref = r.source_ref || `manual:${hash(`${name.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`)}`;
  const locality = String(r.locality || '').trim().slice(0, 80);
  return [
    {
      name,
      category,
      lat,
      lng,
      source,
      ref,
      locality,
      address: (String(r.address || '').trim() || [locality, city].filter(Boolean).join(', ')).slice(0, 300),
      phone: String(r.phone || '').trim().slice(0, 40),
      hours: HOURS.test(String(r.hours || '').trim()) ? r.hours.trim() : null,
    },
    null,
  ];
}

/**
 * rows: seed CSV rows (see SEED_COLUMNS). Returns counts { created, updated, skipped: { reason: n } }.
 * dryRun reports what would happen without writing. refreshCatalog replaces the products of unclaimed listings.
 */
export async function importSeeds(rows, { city = 'Bengaluru', dryRun = false, refreshCatalog = false, log = () => {} } = {}) {
  const stats = { created: 0, updated: 0, skipped: {} };
  const skip = (why) => (stats.skipped[why] = (stats.skipped[why] || 0) + 1);

  const valid = [];
  for (const r of dedupeRows(rows)) {
    const [row, why] = normalise(r, city);
    if (row) valid.push(row);
    else skip(why);
  }
  if (!valid.length) return stats;

  const optouts = new Set((await query('SELECT seed_ref FROM seed_optouts')).rows.map((r) => r.seed_ref));
  const lats = valid.map((r) => r.lat);
  const lngs = valid.map((r) => r.lng);
  const { rows: existing } = await query(
    `SELECT id, name, lat, lng, origin, seed_ref, claimed_at FROM stores
      WHERE lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4`,
    [Math.min(...lats) - 0.01, Math.max(...lats) + 0.01, Math.min(...lngs) - 0.01, Math.max(...lngs) + 0.01],
  );
  const byRef = new Map(existing.filter((s) => s.seed_ref).map((s) => [s.seed_ref, s]));
  // Coarse spatial buckets (~1 km) so the duplicate check doesn't compare every pair.
  const bucket = (lat, lng) => `${Math.floor(lat * 100)}:${Math.floor(lng * 100)}`;
  const buckets = new Map();
  const remember = (s) => {
    const k = bucket(s.lat, s.lng);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(s);
  };
  existing.filter((s) => s.lat != null).forEach(remember);
  const nearbyTwin = (r) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const s of buckets.get(`${Math.floor(r.lat * 100) + dy}:${Math.floor(r.lng * 100) + dx}`) || [])
          if (s.seed_ref !== r.ref && sameName(s.name, r.name) && distanceKm(s.lat, s.lng, r.lat, r.lng) <= 0.06) return s;
    return null;
  };
  const slugs = new Set((await query('SELECT slug FROM stores')).rows.map((r) => String(r.slug)));
  const uniqueSlug = (r) => {
    const base = slugify(`${r.name} ${r.locality}`).slice(0, 52).replace(/-+$/, '') || 'shop';
    for (let i = 0; i < 100; i++) {
      const s = i === 0 && !RESERVED_SLUGS.has(base) ? base : `${base}-${i + 1}`;
      if (!slugs.has(s)) return slugs.add(s), s;
    }
    return `${base}-${hash(r.ref, 6)}`;
  };

  for (const [i, r] of valid.entries()) {
    if (i && i % 500 === 0) log(`[import] ${i}/${valid.length} (${stats.created} created, ${stats.updated} updated)`);
    if (optouts.has(r.ref)) {
      skip('removed on request');
      continue;
    }
    const mine = byRef.get(r.ref);
    if (mine?.claimed_at) {
      skip('claimed by its owner');
      continue;
    }
    if (!mine && nearbyTwin(r)) {
      skip('already on the platform');
      continue;
    }
    const c = SEED_CATEGORIES[r.category];
    const fields = {
      name: r.name,
      category: c.label,
      city,
      locality: r.locality || null,
      address_text: r.address,
      lat: r.lat,
      lng: r.lng,
      seed_phone: r.phone || null,
      claim_phone: mobileOf(r.phone),
      maps_url:
        r.source === 'google_places'
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name)}&query_place_id=${encodeURIComponent(r.ref.slice(7))}`
          : `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`,
      place_id: r.source === 'google_places' ? r.ref.slice(7) : null,
    };
    if (dryRun) {
      mine ? stats.updated++ : stats.created++;
      if (!mine) remember({ name: r.name, lat: r.lat, lng: r.lng, seed_ref: r.ref });
      continue;
    }
    if (mine) {
      const cols = Object.keys(fields);
      await tx(async (client) => {
        await client.query(
          `UPDATE stores SET ${cols.map((k, j) => `${k} = $${j + 2}`).join(', ')}, opening_hours = coalesce(opening_hours, $${cols.length + 2}), updated_at = now()
            WHERE id = $1 AND claimed_at IS NULL`,
          [mine.id, ...cols.map((k) => fields[k]), r.hours],
        );
        if (refreshCatalog) {
          await client.query('DELETE FROM products WHERE store_id = $1', [mine.id]);
          await insertCatalog(client, mine.id, r.category);
        }
      });
      stats.updated++;
      continue;
    }
    const { logo } = await categoryAssets(r.category);
    await tx(async (client) => {
      const { rows: users } = await client.query(`INSERT INTO users (username) VALUES ($1) RETURNING id`, [`seed-${hash(r.ref)}`]);
      const store = {
        ...fields,
        owner_id: users[0].id,
        slug: uniqueSlug(r),
        description: `${c.label} in ${r.locality || city}.`,
        opening_hours: r.hours,
        theme_color: c.color,
        logo_url: logo,
        status: 'approved',
        reviewed_at: new Date(),
        sku_limit: config.freeSkuLimit,
        business_type: 'shop',
        origin: 'seed',
        seed_source: r.source,
        seed_ref: r.ref,
      };
      const cols = Object.keys(store);
      const { rows: created } = await client.query(
        `INSERT INTO stores (${cols.join(', ')}) VALUES (${cols.map((_, j) => `$${j + 1}`).join(', ')}) RETURNING id`,
        cols.map((k) => store[k]),
      );
      await insertCatalog(client, created[0].id, r.category);
    });
    remember({ name: r.name, lat: r.lat, lng: r.lng, seed_ref: r.ref });
    stats.created++;
  }
  return stats;
}
