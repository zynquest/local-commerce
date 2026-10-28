// Generated SVG artwork for demo and seeded stores: product tiles, logos and banners from an emoji and a palette.
// Files are written under UPLOAD_DIR/<dir>/ with a short content hash in the name, so a changed picture always gets
// a new URL (images are cached for 30 days by the service worker and browsers).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const art = (emoji, [from, to]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><radialGradient id="g" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></radialGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="300" cy="320" r="190" fill="#ffffff" fill-opacity="0.35"/><text x="300" y="325" font-size="230" text-anchor="middle" dominant-baseline="central">${emoji}</text></svg>`;

export const banner = (emoji, name, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs><rect width="1200" height="400" fill="url(#g)"/><circle cx="1010" cy="200" r="250" fill="#ffffff" fill-opacity="0.08"/><circle cx="1010" cy="200" r="160" fill="#ffffff" fill-opacity="0.1"/><text x="1010" y="210" font-size="190" text-anchor="middle" dominant-baseline="central">${emoji}</text><text x="70" y="215" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="64" font-weight="800" fill="#ffffff">${esc(name)}</text></svg>`;

const sig = (content) => crypto.createHash('sha1').update(content).digest('hex').slice(0, 8);

/** Writes UPLOAD_DIR/<dir>/<stem>-<hash>.<ext> (skips the write when it already exists); returns its public URL. */
export async function writeFile(dir, stem, ext, content) {
  const folder = path.join(config.uploadDir, dir);
  await fs.mkdir(folder, { recursive: true });
  const name = `${stem}-${sig(content)}.${ext}`;
  const file = path.join(folder, name);
  await fs.access(file).catch(() => fs.writeFile(file, content));
  return `/uploads/${dir}/${name}`;
}

/** Removes files in UPLOAD_DIR/<dir>/ that are not in keptUrls (and their JPEG twins from images:share-jpegs). */
export async function pruneFiles(dir, keptUrls) {
  const folder = path.join(config.uploadDir, dir);
  const keep = new Set(keptUrls.map((u) => path.basename(u).replace(/\.\w+$/, '')));
  for (const f of await fs.readdir(folder)) {
    if (!keep.has(f.replace(/\.\w+$/, ''))) await fs.unlink(path.join(folder, f));
  }
}
