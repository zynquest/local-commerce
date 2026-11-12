// Link-preview image for a store (WhatsApp, Facebook, X): a 1200×630 card with the store's own logo (or initials),
// name, store type and city, so a shared store link previews as that store rather than the platform's own card.
// Shapes are SVG; text is drawn by Pango (sharp's text input), which wraps lines and handles Indian scripts when the
// fonts are installed (deploy/deploy.sh installs Noto). Cards are cached on disk, keyed by what they show.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { query } from './db.js';
import { notFound } from './errors.js';

const W = 1200;
const H = 630;
const VERSION = 1; // bump when the design changes, so cached cards and previews refresh
const FONT = 'Noto Sans, DejaVu Sans, Helvetica, Arial, sans-serif';
const DIR = () => path.join(config.uploadDir, '_share');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** What the card shows; its hash names the cached file and versions the image URL. */
const cardFields = (store) => ({
  v: VERSION,
  slug: store.slug,
  name: String(store.name || '').trim(),
  category: store.category && store.category !== 'Other' ? store.category : '',
  place: store.locality || store.city || '',
  logo: /^\/uploads\/[\w-]+\/[\w-]+\.(webp|jpg|jpeg|png)$/.test(store.logo_url || '') ? store.logo_url : '',
  appt: store.business_type === 'appointments',
  host: (config.publicUrl || 'https://sonsari.in').replace(/^https?:\/\//, '').replace(/\/$/, ''),
});
export const cardKey = (store) => crypto.createHash('sha1').update(JSON.stringify(cardFields(store))).digest('hex').slice(0, 12);

/** Absolute og:image URL of a store's card. */
// Next to the store page rather than under /api/, which robots.txt closes to crawlers (WhatsApp/Facebook respect it).
export const cardUrl = (base, store) => `${base}/s/${encodeURIComponent(store.slug)}/card.jpg?v=${cardKey(store)}`;

/** Renders Pango markup to a transparent PNG; returns { data, width, height }. */
async function text(markup, { size, width, align = 'left', weight = 'normal' }) {
  const { data, info } = await sharp({
    text: { text: `<span font_family="${FONT}" font_weight="${weight}">${markup}</span>`, font: `sans ${size}`, width, dpi: 72, rgba: true, wrap: 'word-char', align },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** The store name at the largest size that fits two lines in the column (very long names are shortened). */
async function nameBlock(name, width) {
  for (const size of [84, 72, 62, 54, 48]) {
    const t = await text(`<span foreground="#ffffff">${esc(name)}</span>`, { size, width, weight: 'bold' });
    if (t.height <= size * 1.32 * 2) return t;
  }
  let cut = name;
  for (;;) {
    cut = cut.slice(0, -4).trimEnd();
    const t = await text(`<span foreground="#ffffff">${esc(cut)}…</span>`, { size: 48, width, weight: 'bold' });
    if (t.height <= 48 * 1.32 * 2 || cut.length < 8) return t;
  }
}

const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('')
    .toUpperCase();

async function logoTile(f, size) {
  if (f.logo) {
    try {
      const file = path.join(config.uploadDir, f.logo.replace(/^\/uploads\//, ''));
      const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.16}" fill="#fff"/></svg>`);
      return await sharp(file)
        .resize(size, size, { fit: 'contain', background: '#ffffff' })
        .flatten({ background: '#ffffff' })
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    } catch {
      // missing or unreadable logo: initials instead
    }
  }
  const tile = sharp(Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.16}" fill="#ecfdf5"/></svg>`));
  const t = await text(`<span foreground="#047857">${esc(initials(f.name))}</span>`, { size: Math.round(size * 0.36), width: size, align: 'center', weight: 'bold' });
  return tile
    .composite([{ input: t.data, top: Math.max(0, Math.round((size - t.height) / 2)), left: Math.max(0, Math.round((size - t.width) / 2)) }])
    .png()
    .toBuffer();
}

/** Builds the card JPEG for these fields. */
async function render(f) {
  const col = 640; // text column width
  const left = 72;
  const tileSize = 300;
  const cta = f.appt ? 'Book on WhatsApp' : 'Order on WhatsApp';
  const [name, sub, pill, url, brand, tile] = await Promise.all([
    nameBlock(f.name, col),
    text(`<span foreground="#a7f3d0">${esc([f.category, f.place].filter(Boolean).join(' · '))}</span>`, { size: 34, width: col }),
    text(`<span foreground="#ffffff">${esc(cta)}</span>`, { size: 30, width: 500, weight: 'bold' }),
    text(`<span foreground="#d1fae5">${esc(`${f.host}/s/${f.slug}`)}</span>`, { size: 26, width: col }),
    text(`<span foreground="#6ee7b7">${esc(config.platformName)}</span>`, { size: 24, width: 400, align: 'right', weight: 'bold' }),
    logoTile(f, tileSize),
  ]);
  const pillW = pill.width + 64;
  const pillH = 64;
  const hasSub = Boolean(f.category || f.place);
  // Name block vertically centred with what follows it.
  const blockH = name.height + (hasSub ? 18 + sub.height : 0) + 40 + pillH;
  let y = Math.max(60, Math.round((H - 70 - blockH) / 2));
  const layers = [{ input: name.data, top: y, left }];
  y += name.height;
  if (hasSub) {
    layers.push({ input: sub.data, top: y + 18, left });
    y += 18 + sub.height;
  }
  y += 40;
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#047857"/><stop offset="1" stop-color="#022c22"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
<circle cx="${W - 230}" cy="${H / 2}" r="270" fill="#ffffff" fill-opacity="0.07"/>
<rect x="${left}" y="${y}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="#16a34a"/>
<rect x="0" y="${H - 8}" width="${W}" height="8" fill="#22c55e"/>
</svg>`;
  layers.push({ input: pill.data, top: y + Math.round((pillH - pill.height) / 2), left: left + 32 });
  layers.push({ input: url.data, top: H - 40 - url.height, left });
  layers.push({ input: brand.data, top: H - 40 - brand.height, left: W - 72 - brand.width });
  layers.push({ input: tile, top: Math.round((H - tileSize) / 2) - 10, left: W - 230 - tileSize / 2 });
  return sharp(Buffer.from(bg)).composite(layers).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

const building = new Map(); // one render per card at a time

/** Path of the store's card on disk, rendering it the first time. */
export async function storeCardFile(store) {
  const f = cardFields(store);
  const key = cardKey(store);
  const file = path.join(DIR(), `${store.id}-${key}.jpg`);
  try {
    await fs.access(file);
    return file;
  } catch {
    // not rendered yet
  }
  if (!building.has(file)) {
    building.set(
      file,
      (async () => {
        const jpg = await render(f);
        await fs.mkdir(DIR(), { recursive: true });
        // Older cards of this store are replaced.
        for (const old of (await fs.readdir(DIR())).filter((n) => n.startsWith(`${store.id}-`))) await fs.rm(path.join(DIR(), old), { force: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, jpg);
        await fs.rename(tmp, file);
        return file;
      })().finally(() => building.delete(file)),
    );
  }
  return building.get(file);
}

/** GET /s/:slug/card.jpg: an approved store's card. The URL carries ?v=<key>, so the current one is cached for long. */
export async function storeCardHandler(req, res) {
  const { rows } = await query(`SELECT * FROM stores WHERE slug = $1 AND status = 'approved'`, [req.params.slug]);
  if (!rows[0]) throw notFound('Store not found');
  const file = await storeCardFile(rows[0]);
  const current = req.query.v === cardKey(rows[0]);
  res.set('Cache-Control', current ? 'public, max-age=2592000, immutable' : 'public, max-age=3600').type('jpg').sendFile(file);
}
