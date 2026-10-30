// Helpers for the merchant seeding pipeline: CSV in/out, name matching, distances, phone normalisation.
import fs from 'node:fs';
import { CHAIN_NAMES } from './catalogs.js';

/** Columns of the seed CSV (the hand-editable file between fetching and importing). */
export const SEED_COLUMNS = ['source', 'source_ref', 'name', 'category', 'locality', 'address', 'pincode', 'lat', 'lng', 'phone', 'hours'];

const quote = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function writeCsv(file, rows, columns = SEED_COLUMNS) {
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => quote(r[c])).join(','))];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

/** RFC 4180 CSV → array of objects keyed by the header row. */
export function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const records = [];
  let field = '';
  let rec = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') rec.push(field), (field = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      rec.push(field), records.push(rec), (rec = []), (field = '');
    } else field += ch;
  }
  if (field || rec.length) rec.push(field), records.push(rec);
  const [header, ...body] = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const FILLER = new Set(['the', 'shop', 'store', 'stores', 'and', 'sri', 'shri', 'shree', 'new', 'bangalore', 'bengaluru', 'pvt', 'ltd']);
/** Name for matching: lowercase ASCII-ish words, filler words dropped. */
export const matchName = (name) =>
  String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9ऀ-෿ ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .join(' ');

/** Same business? Names match (or one contains the other, 4+ chars) — callers also check distance. */
export function sameName(a, b) {
  const x = matchName(a);
  const y = matchName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.includes(short);
}

export function isChain(name) {
  const n = String(name || '').toLowerCase().trim();
  return CHAIN_NAMES.some((c) => n === c || n.startsWith(`${c} `) || n.startsWith(`${c}'`) || n.startsWith(`${c}-`));
}

/** Great-circle distance in km. */
export function distanceKm(lat1, lng1, lat2, lng2) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// Landline written with its STD code set apart: "080 2345 6789", "+91 80 2345 6789", "(080) 23456789".
const LANDLINE = /^(?:\+?91[\s-]*|0)?\(?0?[1-8]\d{1,3}\)?[\s-]+\d{3,4}[\s-]?\d{4}$/;

/** First phone in a source string as 91XXXXXXXXXX when it is an Indian mobile; else null (landlines can't get OTPs). */
export function mobileOf(phone) {
  for (const part of String(phone || '').split(/[;,/]|\bor\b/)) {
    if (LANDLINE.test(part.trim())) continue;
    const d = part.replace(/\D/g, '').replace(/^0+/, '');
    if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
    if (/^91[6-9]\d{9}$/.test(d)) return d;
  }
  return null;
}

/** OSM opening_hours → our "HH:MM-HH:MM" when it's one daily range ("Mo-Su 08:00-22:00", "24/7"); else ''. */
export function simpleHours(value) {
  const v = String(value || '').trim();
  if (v === '24/7') return '00:00-23:59';
  const m = v.match(/^(?:(?:Mo-Su|Mo-Sa|Mo-Fr|PH)[ ,]*)?(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  return m ? `${m[1].padStart(5, '0')}-${m[2].padStart(5, '0')}` : '';
}

/** Merges rows that describe the same shop (same ref, or same name within 60 m); keeps phones from either. */
export function dedupeRows(rows) {
  const out = [];
  const byRef = new Map();
  for (const r of rows) {
    if (r.source_ref && byRef.has(r.source_ref)) {
      Object.assign(byRef.get(r.source_ref), Object.fromEntries(Object.entries(r).filter(([, v]) => v)));
      continue;
    }
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const twin = out.find((o) => sameName(o.name, r.name) && distanceKm(Number(o.lat), Number(o.lng), lat, lng) <= 0.06);
    if (twin) {
      for (const k of ['phone', 'locality', 'address', 'pincode', 'hours']) if (!twin[k] && r[k]) twin[k] = r[k];
      continue;
    }
    const copy = { ...r };
    out.push(copy);
    if (copy.source_ref) byRef.set(copy.source_ref, copy);
  }
  return out;
}

/**
 * Bounding boxes [south, west, north, east] of cities we seed. Boxes are rectangles and cities aren't, so where two
 * cities touch (Delhi, Noida, Gurugram), `exclude` drops shops that fall in the neighbour's box: each shop is listed
 * under one city only.
 */
export const CITY_BBOX = {
  bengaluru: { name: 'Bengaluru', bbox: [12.83, 77.46, 13.14, 77.78] },
  noida: { name: 'Noida', bbox: [28.46, 77.3, 28.63, 77.5] },
  pune: { name: 'Pune', bbox: [18.42, 73.73, 18.68, 74.0] },
  mumbai: { name: 'Mumbai', bbox: [18.89, 72.77, 19.28, 72.99] },
  delhi: { name: 'Delhi', bbox: [28.4, 76.84, 28.89, 77.34], exclude: ['noida', 'gurugram'] },
  hyderabad: { name: 'Hyderabad', bbox: [17.25, 78.3, 17.56, 78.62] },
  chennai: { name: 'Chennai', bbox: [12.9, 80.12, 13.24, 80.32] },
  gurugram: { name: 'Gurugram', bbox: [28.36, 76.93, 28.51, 77.12] },
};

/** True when the point lies inside a [south, west, north, east] box. */
export const inBox = ([s, w, n, e], lat, lng) => lat >= s && lat <= n && lng >= w && lng <= e;

/** Drops rows inside the boxes of the cities this one excludes (see CITY_BBOX). */
export function excludeNeighbours(rows, key) {
  const boxes = (CITY_BBOX[key]?.exclude || []).map((k) => CITY_BBOX[k].bbox);
  return boxes.length ? rows.filter((r) => !boxes.some((b) => inBox(b, Number(r.lat), Number(r.lng)))) : rows;
}
