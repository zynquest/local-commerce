// Media helpers. Uploads go to the API (resized to WebP server-side); pasted URLs must be https.
// Instagram CDN URLs are rejected: their signed `oe`/`oh` tokens expire within 24–72 hours.
import { api } from '../lib/api.js';
import { getActiveT } from '../i18n/index.jsx';

export const isInstagramCdn = (url) => /(cdninstagram\.com|fbcdn\.net)/i.test(url || '');

/** Converts Google Drive share links to a stable thumbnail URL. */
export function normalizeImageUrl(url) {
  const u = String(url || '').trim();
  const drive = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/);
  if (drive) return `https://lh3.googleusercontent.com/d/${drive[1]}`;
  return u;
}

/** Display-time optimisation for known CDNs (Cloudinary, Google Drive). */
export function optimizeImage(url, width = 600) {
  const u = normalizeImageUrl(url);
  if (/res\.cloudinary\.com\/.+\/image\/upload\//.test(u) && !/\/upload\/[^/]*[fqw]_/.test(u)) {
    return u.replace('/image/upload/', `/image/upload/f_auto,q_auto,w_${width}/`);
  }
  if (/lh3\.googleusercontent\.com\/d\/[\w-]+$/.test(u)) return `${u}=w${width}`;
  return u;
}

export async function uploadImage(file) {
  const t = getActiveT();
  if (!file?.type?.startsWith('image/')) throw new Error(t('errors.chooseImage'));
  if (file.size > 8 * 1024 * 1024) throw new Error(t('errors.imageTooBig'));
  const form = new FormData();
  form.append('image', file);
  const { url } = await api('/merchant/uploads', { method: 'POST', body: form });
  return url;
}

/** Inline SVG used when a product has no image or its image fails to load. */
export function placeholderImage(label = '', emoji = '🛒', [from, to, ink] = ['#ecfdf5', '#d1fae5', '#047857'], showLabel = true) {
  const text = showLabel ? String(label).slice(0, 22).replace(/[<>&"]/g, '') : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><text x="300" y="${text ? 300 : 320}" font-size="${text ? 180 : 230}" text-anchor="middle" dominant-baseline="central">${emoji}</text>${text ? `<text x="300" y="500" font-family="system-ui,sans-serif" font-size="34" fill="${ink}" text-anchor="middle">${text}</text>` : ''}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
