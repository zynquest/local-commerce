// Server-side access to the client's locale catalogs (client/src/i18n/locales/*.json), used for SEO tags.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGE_CODES } from './schemas.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/src/i18n/locales');
export const RTL = new Set(['ur', 'ks', 'sd']);
const catalogs = {};

function load(code) {
  if (catalogs[code] !== undefined) return catalogs[code];
  try {
    catalogs[code] = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
  } catch {
    catalogs[code] = null; // not translated yet → English fallback
  }
  return catalogs[code];
}

const lookup = (obj, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

/** Languages that have a catalog on disk (English always). */
export const availableLanguages = () => LANGUAGE_CODES.filter((c) => c === 'en' || load(c));

export function pickLanguage(value) {
  const code = String(value || '').toLowerCase();
  return code !== 'en' && LANGUAGE_CODES.includes(code) && load(code) ? code : 'en';
}

export function makeServerT(code) {
  const cat = load(code) || {};
  const en = load('en') || {};
  return (key, vars) => {
    const msg = lookup(cat, key) ?? lookup(en, key) ?? key;
    return typeof msg === 'string' && vars ? msg.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : msg;
  };
}

/** For tests / hot reload. */
export const clearLocaleCache = () => Object.keys(catalogs).forEach((k) => delete catalogs[k]);
