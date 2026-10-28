// OpenStreetMap shops via the Overpass API (free; data © OpenStreetMap contributors, ODbL). The city's bounding box
// is split into tiles so each query stays small; requests are spaced out and retried across public servers.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OSM_KIND_TO_CATEGORY } from './catalogs.js';
import { distanceKm, isChain, simpleHours } from './util.js';

const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const UA = 'sonsari-merchant-seed/1.0 (+https://sonsari.in)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOP_KINDS = Object.keys(OSM_KIND_TO_CATEGORY).filter((k) => !['restaurant', 'fast_food'].includes(k));

async function overpass(ql, log) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = SERVERS[attempt % SERVERS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: ql }),
        signal: AbortSignal.timeout(120_000),
      });
      const text = await res.text();
      if (res.ok && text.startsWith('{')) return JSON.parse(text);
      lastErr = new Error(`${new URL(url).host} ${res.status}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
    } catch (err) {
      lastErr = err;
    }
    log?.(`   retry ${attempt + 1} after: ${lastErr.message}`);
    await sleep(5000 * (attempt + 1));
  }
  throw lastErr;
}

/** Splits [s, w, n, e] into tiles of about `km` × `km`. */
export function tiles([s, w, n, e], km = 4) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  const out = [];
  for (let lat = s; lat < n; lat += dLat) for (let lng = w; lng < e; lng += dLng) out.push([lat, lng, Math.min(lat + dLat, n), Math.min(lng + dLng, e)].map((v) => +v.toFixed(5)));
  return out;
}

/** Overpass query with an on-disk cache: a finished tile is never fetched again, so a failed run resumes. */
async function cachedOverpass(ql, cacheDir, log) {
  const file = cacheDir && path.join(cacheDir, `${crypto.createHash('sha1').update(ql).digest('hex')}.json`);
  if (file && fs.existsSync(file)) return { data: JSON.parse(fs.readFileSync(file, 'utf8')), cached: true };
  const data = await overpass(ql, log);
  if (file) fs.writeFileSync(file, JSON.stringify(data));
  return { data, cached: false };
}

/** Neighbourhood names (place=suburb|neighbourhood|quarter) inside the box, for labelling shops without addr:suburb. */
async function localities(bbox, cacheDir, log) {
  const { data } = await cachedOverpass(`[out:json][timeout:90];node["place"~"^(suburb|neighbourhood|quarter)$"]["name"](${bbox.join(',')});out;`, cacheDir, log);
  return data.elements.map((e) => ({ name: e.tags['name:en'] || e.tags.name, lat: e.lat, lng: e.lon }));
}

const nearest = (places, lat, lng) => {
  let best = null;
  for (const p of places) {
    const d = distanceKm(lat, lng, p.lat, p.lng);
    if (d <= 3 && (!best || d < best.d)) best = { name: p.name, d };
  }
  return best?.name || '';
};

/**
 * Fetches shops in `bbox` and returns { rows, failed } — seed CSV rows, and how many tiles could not be fetched
 * (public Overpass servers are often overloaded; re-run the same command later and only those tiles are fetched).
 * Chains (brand:wikidata, or a known chain name) are skipped unless includeChains. Only kinds in
 * OSM_KIND_TO_CATEGORY are kept: no salons, clinics or pharmacies.
 */
export async function fetchOsm({ bbox, city, tileKm = 4, includeChains = false, cacheDir, log = console.log }) {
  if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
  const places = await localities(bbox, cacheDir, log);
  log(`[osm] ${places.length} neighbourhood names`);
  const grid = tiles(bbox, tileKm);
  const rows = new Map();
  let failed = 0;
  for (const [i, t] of grid.entries()) {
    const box = t.join(',');
    const ql = `[out:json][timeout:90];(nwr["shop"~"^(${SHOP_KINDS.join('|')})$"]["name"](${box});nwr["amenity"~"^(restaurant|fast_food)$"]["name"](${box}););out center tags;`;
    let data;
    let cached = false;
    try {
      ({ data, cached } = await cachedOverpass(ql, cacheDir, log));
    } catch (err) {
      failed++;
      log(`[osm] tile ${i + 1}/${grid.length}: skipped after retries (${err.message.slice(0, 80)}); re-run later to fill it in`);
      continue;
    }
    let kept = 0;
    for (const el of data.elements) {
      const tg = el.tags || {};
      const kind = tg.shop || tg.amenity;
      const category = OSM_KIND_TO_CATEGORY[kind];
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      const name = (tg['name:en'] || tg.name || '').trim();
      if (!category || !name || lat == null || tg.disused || tg['disused:shop']) continue;
      if (!includeChains && (tg['brand:wikidata'] || isChain(name))) continue;
      const locality = tg['addr:suburb'] || tg['addr:neighbourhood'] || nearest(places, lat, lng);
      const street = [tg['addr:housenumber'], tg['addr:street']].filter(Boolean).join(', ');
      const phone = tg.phone || tg['contact:phone'] || tg.mobile || tg['contact:mobile'] || tg['contact:whatsapp'] || '';
      rows.set(`osm:${el.type}/${el.id}`, {
        source: 'osm',
        source_ref: `osm:${el.type}/${el.id}`,
        name: name.slice(0, 60),
        category,
        locality,
        address: [street, locality, city, tg['addr:postcode']].filter(Boolean).join(', '),
        pincode: tg['addr:postcode'] || '',
        lat: lat.toFixed(6),
        lng: lng.toFixed(6),
        phone, // raw value for the field team; the importer derives the claimable mobile from it
        hours: simpleHours(tg.opening_hours),
      });
      kept++;
    }
    log(`[osm] tile ${i + 1}/${grid.length}: ${kept} shops${cached ? ' (cached)' : ''}`);
    if (!cached) await sleep(1500); // be gentle with the public Overpass servers
  }
  return { rows: [...rows.values()], failed };
}
