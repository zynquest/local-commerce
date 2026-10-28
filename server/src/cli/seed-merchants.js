// Seeded merchants: list local shops from public data so nearby shoppers can find them, then hand each listing to
// its owner on a shop visit ("your shop is already listed — log in and set your prices").
//
// Pipeline (files under data/seed/, which is git-ignored):
//   npm run seed:merchants -- fetch-osm    --city bengaluru --out ../data/seed/blr-osm.csv
//   npm run seed:merchants -- fetch-places --city bengaluru --out ../data/seed/blr-places.csv [--max-requests 300] [--yes]
//   npm run seed:merchants -- merge        --out ../data/seed/blr.csv ../data/seed/blr-osm.csv ../data/seed/blr-places.csv
//   (review / edit the CSV: delete rows, fix names, add shops you walked past — source "manual")
//   npm run seed:merchants -- import       ../data/seed/blr.csv [--dry-run] [--refresh-catalog]
//   npm run seed:merchants -- export       --out ../data/seed/field-indiranagar.csv [--locality Indiranagar] [--near 12.97,77.64 --radius-km 2]
//   npm run seed:merchants -- remove       <store-link> [--reason "Owner asked"]
//   npm run seed:merchants -- remove-all   --yes            (every UNCLAIMED seeded listing)
//   npm run seed:merchants -- stats
//
// Seeded listings: origin = 'seed', approved, visible only to shoppers within NEARBY_RADIUS_KM, never indexed, no
// WhatsApp number (so no orders) until the owner claims them — by registering with the listing's mobile, or by the
// platform admin handing it over in the admin console. Salons, clinics and pharmacies are not seeded.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { pool, query } from '../db.js';
import { migrate } from '../migrate.js';
import { SEED_CATEGORIES } from '../seed/catalogs.js';
import { importSeeds } from '../seed/importer.js';
import { fetchOsm } from '../seed/osm.js';
import { USD_PER_1000, fetchPlaces, grid } from '../seed/places.js';
import { removeSeedStore } from '../seed/stores.js';
import { CITY_BBOX, dedupeRows, readCsv, writeCsv } from '../seed/util.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const VALUE_FLAGS = new Set(['out', 'city', 'bbox', 'near', 'radius-km', 'tile-km', 'spacing-km', 'max-requests', 'locality', 'reason']);
/** Arguments after the command that are neither flags nor flag values. */
function positional() {
  const res = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      if (VALUE_FLAGS.has(argv[i].slice(2))) i++;
    } else res.push(argv[i]);
  }
  return res;
}

function area() {
  const key = String(flag('city', 'bengaluru')).toLowerCase();
  const city = CITY_BBOX[key];
  if (!city) throw new Error(`Unknown --city "${key}" (known: ${Object.keys(CITY_BBOX).join(', ')})`);
  const near = flag('near');
  if (near) {
    const [lat, lng] = near.split(',').map(Number);
    const km = Number(flag('radius-km', 2));
    const dLat = km / 111;
    const dLng = km / (111 * Math.cos((lat * Math.PI) / 180));
    return { city: city.name, bbox: [lat - dLat, lng - dLng, lat + dLat, lng + dLng].map((v) => +v.toFixed(5)) };
  }
  const bbox = flag('bbox');
  return { city: city.name, bbox: bbox ? bbox.split(',').map(Number) : city.bbox };
}

function out(fallback) {
  const file = path.resolve(flag('out', fallback));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

const summary = (rows) => {
  const by = {};
  for (const r of rows) by[r.category] = (by[r.category] || 0) + 1;
  const phones = rows.filter((r) => r.phone).length;
  return `${rows.length} shops (${phones} with a phone): ${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ')}`;
};

async function main() {
  switch (cmd) {
    case 'fetch-osm': {
      const { city, bbox } = area();
      const file = out('../data/seed/osm.csv');
      const { rows, failed } = await fetchOsm({
        bbox, city, tileKm: Number(flag('tile-km', 4)), includeChains: has('include-chains'), cacheDir: path.resolve('../data/seed/.cache/osm'),
      });
      writeCsv(file, rows);
      console.log(`[osm] ${summary(rows)} → ${file}`);
      if (failed) {
        console.log(`[osm] ${failed} tiles could not be fetched (servers busy). Run the same command again later: finished tiles come from the cache.`);
        process.exitCode = 2;
      }
      console.log('[osm] Data © OpenStreetMap contributors (ODbL).');
      return;
    }
    case 'fetch-places': {
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!apiKey) throw new Error('Set GOOGLE_PLACES_API_KEY (a server key with "Places API (New)" enabled; Deployment.md §B21).');
      const { city, bbox } = area();
      const spacingKm = Number(flag('spacing-km', 1.5));
      const maxRequests = Number(flag('max-requests', 200));
      const points = grid(bbox, spacingKm).length * 3;
      console.log(`[places] about ${points}+ requests to cover this area (more where it's dense); budget ${maxRequests} ≈ $${((maxRequests * USD_PER_1000) / 1000).toFixed(2)} at list price, before Google's monthly free usage.`);
      if (!has('yes')) {
        console.log('[places] Nothing fetched. Re-run with --yes to spend up to that budget (cached requests are free).');
        return;
      }
      const file = out('../data/seed/places.csv');
      const rows = await fetchPlaces({ bbox, city, apiKey, spacingKm, maxRequests, includeChains: has('include-chains'), cacheDir: path.resolve('../data/seed/.cache/places') });
      writeCsv(file, rows);
      console.log(`[places] ${summary(rows)} → ${file}`);
      return;
    }
    case 'merge': {
      const inputs = positional();
      if (!inputs.length) throw new Error('Usage: merge --out <file> <a.csv> <b.csv> …');
      const rows = dedupeRows(inputs.flatMap((f) => readCsv(path.resolve(f))));
      const file = out('../data/seed/merged.csv');
      writeCsv(file, rows);
      console.log(`[merge] ${summary(rows)} → ${file}`);
      return;
    }
    case 'import': {
      const [file] = positional();
      if (!file) throw new Error('Usage: import <file.csv> [--dry-run] [--refresh-catalog]');
      await migrate({ log: () => {} });
      const { city } = area();
      const rows = readCsv(path.resolve(file));
      const stats = await importSeeds(rows, { city, dryRun: has('dry-run'), refreshCatalog: has('refresh-catalog'), log: console.log });
      console.log(`[import]${has('dry-run') ? ' (dry run)' : ''} ${stats.created} created, ${stats.updated} updated`);
      for (const [why, n] of Object.entries(stats.skipped)) console.log(`         skipped ${n}: ${why}`);
      return;
    }
    case 'export': {
      await migrate({ log: () => {} });
      const base = config.publicUrl || 'https://sonsari.in';
      const params = [flag('locality', null)];
      let where = '';
      const near = flag('near');
      if (near) {
        const [lat, lng] = near.split(',').map(Number);
        const km = Number(flag('radius-km', 2));
        params.push(lat, lng, km);
        where = `AND (6371 * 2 * asin(sqrt(power(sin(radians(s.lat - $2) / 2), 2) + cos(radians($2)) * cos(radians(s.lat)) * power(sin(radians(s.lng - $3) / 2), 2)))) <= $4`;
      }
      const { rows } = await query(
        `SELECT s.locality, s.name, s.category, s.address_text, s.seed_phone, s.slug, s.lat, s.lng, s.claimed_at,
                (SELECT count(*)::int FROM products p WHERE p.store_id = s.id AND p.status = 'active') AS products
           FROM stores s
          WHERE s.origin = 'seed' AND ($1::text IS NULL OR s.locality ILIKE $1) ${where}
          ORDER BY s.claimed_at IS NOT NULL, s.locality NULLS LAST, s.lat, s.lng`,
        params,
      );
      const file = out('../data/seed/field-list.csv');
      writeCsv(
        file,
        rows.map((r) => ({
          locality: r.locality || '',
          name: r.name,
          category: r.category,
          address: r.address_text,
          phone: r.seed_phone || '',
          status: r.claimed_at ? 'claimed' : 'to visit',
          products: r.products,
          store_link: `${base}/s/${r.slug}`,
          directions: `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`,
        })),
        ['locality', 'name', 'category', 'address', 'phone', 'status', 'products', 'store_link', 'directions'],
      );
      console.log(`[export] ${rows.length} listings (${rows.filter((r) => !r.claimed_at).length} to visit) → ${file}`);
      return;
    }
    case 'remove': {
      const [slug] = positional();
      if (!slug) throw new Error('Usage: remove <store-link> [--reason "…"]');
      const { rows } = await query('SELECT id FROM stores WHERE slug = $1', [slug.replace(/^.*\/s\//, '')]);
      if (!rows[0]) throw new Error(`No store "${slug}"`);
      const store = await removeSeedStore({ storeId: rows[0].id, reason: flag('reason', '') });
      fs.rmSync(path.join(config.uploadDir, rows[0].id), { recursive: true, force: true });
      console.log(`[remove] "${store.name}" removed; re-imports will skip it.`);
      return;
    }
    case 'remove-all': {
      if (!has('yes')) throw new Error('This deletes every UNCLAIMED seeded listing (claimed ones stay). Re-run with --yes.');
      const { rowCount } = await query(
        `DELETE FROM users u USING stores s WHERE s.owner_id = u.id AND s.origin = 'seed' AND s.claimed_at IS NULL`,
      );
      console.log(`[remove-all] ${rowCount} unclaimed seeded listings removed (they can be re-imported).`);
      return;
    }
    case 'stats': {
      await migrate({ log: () => {} });
      const { rows } = await query(
        `SELECT category, count(*)::int AS total, count(claimed_at)::int AS claimed, count(claim_phone)::int AS with_mobile
           FROM stores WHERE origin = 'seed' GROUP BY category ORDER BY total DESC`,
      );
      const { rows: top } = await query(
        `SELECT coalesce(locality, '(unknown)') AS locality, count(*)::int AS n FROM stores
          WHERE origin = 'seed' AND claimed_at IS NULL GROUP BY 1 ORDER BY n DESC LIMIT 15`,
      );
      console.table(rows);
      console.log('Unclaimed listings by locality (top 15):');
      console.table(top);
      return;
    }
    default:
      console.log(`Usage: npm run seed:merchants -- <fetch-osm|fetch-places|merge|import|export|remove|remove-all|stats> [options]
Seeded categories: ${Object.entries(SEED_CATEGORIES).map(([k, c]) => `${k} (${c.label})`).join(', ')}`);
      process.exitCode = cmd ? 1 : 0;
  }
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
