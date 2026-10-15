// Validates translations:  node client/scripts/i18n-check.mjs [--strict]
//  1. every t('key') used in client/src exists in en.json (template keys checked by prefix)
//  2. every locale has every English key (plural variants _zero/_one/_two/_few/_many/_other may differ)
//  3. placeholders {name} and markup tags <b>…</b>, <link>…</link> are preserved; no empty strings
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src/i18n/locales');
const PLURAL = /_(zero|one|two|few|many|other)$/;

const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') flatten(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
};
const baseKey = (k) => k.replace(PLURAL, '');
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => [...String(s).matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort().join('');

const en = flatten(JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8')));
const enBase = new Set(Object.keys(en).map(baseKey));
const problems = [];

// 1. keys used in code
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const file of walk(path.join(root, 'src')).filter((f) => /\.(jsx?|mjs)$/.test(f))) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*(['"`])([^'"`]+)\1/g)) {
    const key = m[2];
    const rel = path.relative(root, file);
    if (m[1] === '`' && key.includes('${')) {
      const prefix = key.slice(0, key.indexOf('${'));
      if (![...enBase].some((k) => k.startsWith(prefix))) problems.push(`${rel}: no keys with prefix "${prefix}"`);
    } else if (!enBase.has(key)) {
      problems.push(`${rel}: missing key "${key}"`);
    }
  }
}

// 2 + 3. locales
const locales = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json');
const summary = [];
for (const f of locales) {
  const code = f.replace('.json', '');
  let data;
  try {
    data = flatten(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  } catch (err) {
    problems.push(`${code}: invalid JSON (${err.message})`);
    continue;
  }
  const base = new Set(Object.keys(data).map(baseKey));
  let missing = 0;
  for (const k of enBase) if (!base.has(k)) (missing++, problems.push(`${code}: missing "${k}"`));
  for (const k of base) if (!enBase.has(k)) problems.push(`${code}: unknown key "${k}"`);
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== 'string' || !v.trim()) {
      problems.push(`${code}: empty "${k}"`);
      continue;
    }
    const ref = en[k] ?? en[`${baseKey(k)}_other`] ?? en[baseKey(k)];
    if (ref === undefined) continue;
    // Plural "one" forms may legitimately drop {count} (e.g. "one item"); other placeholders must match.
    const want = placeholders(ref).split(',').filter((p) => !(PLURAL.test(k) && p === 'count')).join(',');
    const got = placeholders(v).split(',').filter((p) => !(PLURAL.test(k) && p === 'count')).join(',');
    if (want !== got) problems.push(`${code}: "${k}" placeholders {${got}} ≠ {${want}}`);
    if (tags(ref) !== tags(v)) problems.push(`${code}: "${k}" markup ${tags(v) || '(none)'} ≠ ${tags(ref)}`);
  }
  summary.push(`${code}: ${Object.keys(data).length} strings${missing ? `, ${missing} missing` : ''}`);
}

console.log(`en: ${Object.keys(en).length} strings · ${locales.length} other locales`);
summary.forEach((s) => console.log(`  ${s}`));
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  problems.slice(0, 200).forEach((p) => console.log(`  - ${p}`));
  process.exitCode = 1;
} else {
  console.log('\nAll translations valid.');
}
