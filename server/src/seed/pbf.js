// OpenStreetMap shops from a local extract (Geofabrik's india-latest.osm.pbf) instead of the public Overpass API,
// which asks automated, high-volume users to run their own instance. osmium (brew install osmium-tool) cuts the
// extract down to the shops we seed plus neighbourhood names, once; then every city is a quick in-memory filter.
// Rows are the same as fetch-osm's (toRow), so source refs match and re-imports update instead of duplicating.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { SHOP_KINDS, toRow } from './osm.js';
import { inBox } from './util.js';

const TYPES = { n: 'node', w: 'way', r: 'relation', a: 'way' };

function osmium(args) {
  const r = spawnSync('osmium', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.error?.code === 'ENOENT') throw new Error('osmium not found. Install it: brew install osmium-tool (or apt install osmium-tool).');
  if (r.status !== 0) throw new Error(`osmium ${args[0]} failed (exit ${r.status})`);
}

/**
 * Shops + neighbourhood names from the extract, as GeoJSON lines next to it. Reused while newer than the extract.
 * Returns the .geojsonseq path.
 */
export function filterExtract(pbf, log = console.log) {
  const base = pbf.replace(/\.osm\.pbf$|\.pbf$/, '');
  const filtered = `${base}.shops.osm.pbf`;
  const lines = `${base}.shops.geojsonseq`;
  const fresh = (f) => fs.existsSync(f) && fs.statSync(f).mtimeMs > fs.statSync(pbf).mtimeMs;
  if (fresh(lines)) return lines;
  log(`[pbf] filtering ${path.basename(pbf)} (a few minutes)…`);
  osmium(['tags-filter', pbf, `nwr/shop=${SHOP_KINDS.join(',')}`, 'nwr/amenity=restaurant,fast_food', 'n/place=suburb,neighbourhood,quarter', '-o', filtered, '--overwrite']);
  osmium(['export', filtered, '-f', 'geojsonseq', '--add-unique-id=type_id', '-o', lines, '--overwrite']);
  return lines;
}

/** Centre of a GeoJSON geometry's bounding box (what Overpass calls "center" for ways and relations). */
function centre(geometry) {
  if (geometry.type === 'Point') return { lng: geometry.coordinates[0], lat: geometry.coordinates[1] };
  let s = 90, w = 180, n = -90, e = -180;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]);
    } else c.forEach(walk);
  };
  walk(geometry.coordinates);
  return { lat: (s + n) / 2, lng: (w + e) / 2 };
}

/** Reads the GeoJSON lines into { shops: Overpass-shaped elements, places: [{ name, lat, lng }] }. */
export async function readExtract(file) {
  const shops = [];
  const places = [];
  const seen = new Set();
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (let line of rl) {
    line = line.replace(/^\x1e/, ''); // RFC 8142 record separator
    if (!line.trim()) continue;
    const f = JSON.parse(line);
    const tags = f.properties || {};
    if (!f.geometry) continue;
    const { lat, lng } = centre(f.geometry);
    if (tags.place && !tags.shop && !tags.amenity) {
      if (tags.name) places.push({ name: tags['name:en'] || tags.name, lat, lng });
      continue;
    }
    // Ids are "n123", "w456", "r789" (areas: "a" + 2×way id, or 2×relation id + 1).
    const m = /^([nwra])(\d+)$/.exec(String(f.id));
    if (!m) continue;
    let [, t, id] = m;
    if (t === 'a') {
      const n = BigInt(id);
      [t, id] = n % 2n ? ['r', String(n / 2n)] : ['w', String(n / 2n)];
    }
    const key = `${t}${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    shops.push({ type: TYPES[t], id, tags, center: { lat, lon: lng } });
  }
  return { shops, places };
}

/** Rows for one city box: shops inside it, localities from neighbourhood names near it. */
export function cityRows({ shops, places }, { bbox, city, includeChains = false }) {
  const pad = 0.03; // neighbourhood names just outside the box still label shops near its edge
  const near = places.filter((p) => inBox([bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad], p.lat, p.lng));
  const rows = new Map();
  for (const el of shops) {
    if (!inBox(bbox, el.center.lat, el.center.lon)) continue;
    const row = toRow(el, { city, places: near, includeChains });
    if (row) rows.set(row.source_ref, row);
  }
  return [...rows.values()];
}
