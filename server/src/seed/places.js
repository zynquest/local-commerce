// Google Places API (New) — Nearby Search over a grid of circles, for listings with phone numbers.
// Needs a SERVER key (GOOGLE_PLACES_API_KEY) with "Places API (New)" enabled; the browser Maps key is
// referrer-restricted and won't work from the VM. Requesting phone numbers bills the Nearby Search *Enterprise* SKU.
// Every response is cached on disk, so re-running the same area costs nothing.
// Google's terms limit how long Places content may be stored; use this for the field team's visit list and let
// the owner's own details replace it once they claim the listing.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PLACES_TYPE_GROUPS, PLACES_TYPE_TO_CATEGORY } from './catalogs.js';
import { isChain } from './util.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.types', 'places.primaryType',
  'places.businessStatus', 'places.nationalPhoneNumber', 'places.addressComponents',
].join(',');
export const USD_PER_1000 = 35; // Nearby Search Enterprise list price; check https://mapsplatform.google.com/pricing/

/** Grid of circle centres covering [s, w, n, e], `spacingKm` apart (radius = 0.75 × spacing covers the gaps). */
export function grid([s, w, n, e], spacingKm) {
  const dLat = spacingKm / 111;
  const dLng = spacingKm / (111 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  const pts = [];
  for (let lat = s + dLat / 2; lat < n; lat += dLat) for (let lng = w + dLng / 2; lng < e; lng += dLng) pts.push([+lat.toFixed(5), +lng.toFixed(5)]);
  return pts;
}

const component = (place, ...types) => place.addressComponents?.find((c) => types.some((t) => c.types?.includes(t)))?.longText || '';

/**
 * Fetches listings around a grid of points. maxRequests caps billable (uncached) calls; a full response (20 places)
 * is split into four smaller circles, so dense areas are covered without guessing a spacing.
 */
export async function fetchPlaces({ bbox, city, apiKey, spacingKm = 1.5, maxRequests = 200, includeChains = false, cacheDir, log = console.log }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  let billable = 0;
  let cached = 0;
  const rows = new Map();

  async function search(lat, lng, radiusM, types, depth) {
    const body = { includedTypes: types, maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } } };
    const key = crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex');
    const file = path.join(cacheDir, `${key}.json`);
    let data;
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
      cached++;
    } else {
      if (billable >= maxRequests) return false;
      billable++;
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELDS },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Places ${res.status}: ${data.error?.message || 'request failed'}`);
      fs.writeFileSync(file, JSON.stringify(data));
    }
    const places = data.places || [];
    for (const p of places) {
      const type = [p.primaryType, ...(p.types || [])].find((t) => PLACES_TYPE_TO_CATEGORY[t]);
      const name = p.displayName?.text?.trim();
      if (!type || !name || p.businessStatus === 'CLOSED_PERMANENTLY') continue;
      if (!includeChains && isChain(name)) continue;
      const locality = component(p, 'sublocality_level_1', 'sublocality', 'neighborhood');
      rows.set(`gplace:${p.id}`, {
        source: 'google_places',
        source_ref: `gplace:${p.id}`,
        name: name.slice(0, 60),
        category: PLACES_TYPE_TO_CATEGORY[type],
        locality,
        address: (p.formattedAddress || '').slice(0, 300),
        pincode: component(p, 'postal_code'),
        lat: p.location.latitude.toFixed(6),
        lng: p.location.longitude.toFixed(6),
        phone: p.nationalPhoneNumber || '',
        hours: '',
      });
    }
    // Saturated: the circle holds more than Google returns at once. Split it (two levels deep at most).
    if (places.length >= 20 && depth < 2) {
      const r = radiusM / 2;
      const dLat = r / 111_000;
      const dLng = r / (111_000 * Math.cos((lat * Math.PI) / 180));
      for (const [a, b] of [[dLat, dLng], [dLat, -dLng], [-dLat, dLng], [-dLat, -dLng]]) {
        if ((await search(lat + a, lng + b, Math.round(r * 1.1), types, depth + 1)) === false) return false;
      }
    }
    return true;
  }

  const points = grid(bbox, spacingKm);
  const radiusM = Math.round(spacingKm * 750);
  log(`[places] ${points.length} points × ${PLACES_TYPE_GROUPS.length} type groups, radius ${radiusM} m, budget ${maxRequests} billable requests`);
  outer: for (const [i, [lat, lng]] of points.entries()) {
    for (const types of PLACES_TYPE_GROUPS) {
      if ((await search(lat, lng, radiusM, types, 0)) === false) {
        log(`[places] budget of ${maxRequests} requests reached at point ${i + 1}/${points.length}; re-run with a higher --max-requests to continue (cached calls are free)`);
        break outer;
      }
    }
    if ((i + 1) % 10 === 0) log(`[places] ${i + 1}/${points.length} points, ${rows.size} listings, ${billable} billable + ${cached} cached calls`);
  }
  log(`[places] done: ${rows.size} listings, ${billable} billable calls (≈ $${((billable * USD_PER_1000) / 1000).toFixed(2)} at list price), ${cached} cached`);
  return [...rows.values()].map((r) => ({ ...r, address: r.address || [r.locality, city].filter(Boolean).join(', ') }));
}
