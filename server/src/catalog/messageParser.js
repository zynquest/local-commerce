// Parses a product list pasted from WhatsApp into catalog items. Two formats (they can be mixed in one message):
//
//   1) Three lines per product          2) One line, products separated by "|"
//      Green Apple 4 pc                    Milk,25,21|Wheat Flour,71,69
//      200          ← MRP
//      100          ← list price
//
// Every product is parsed independently: a broken one is reported with an error code (+ the lines it came from)
// and never affects the others. Error codes are translated by the client (msgimp.e.<code>).

export const MAX_MESSAGE_CHARS = 20_000;
export const MAX_MESSAGE_ITEMS = 300;
const MAX_PRICE = 10_000_000;

// "[15/10/26, 9:41 PM] Ramesh: …" (iOS copy) or "15/10/26, 9:41 pm - Ramesh: …" (Android export)
const WHATSAPP_PREFIX = /^\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?\]?\s*(?:-\s*)?[^:]{1,40}:\s+/i;
const BULLET = /^(?:[-–•*·▪►➤✅✔☑️]+|\d{1,3}[.)])\s+/u;
const PRICE_LABEL = /^(?:m\.?\s?r\.?\s?p\.?|list\s*price|selling\s*price|sale\s*price|offer\s*price|offer|price|rate|lp|sp|rs\.?|inr|₹)\s*[:=-]?\s*/i;
const PRICE_SUFFIX = /\s*(?:\/-|\/=|rs\.?|rupees|only|inr)$/i;
const SEPARATOR = /[|｜¦]/;

/** Removes invisible characters and WhatsApp formatting from a line. */
function cleanLine(raw) {
  let s = String(raw)
    .replace(/[​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/ /g, ' ')
    .trim();
  s = s.replace(WHATSAPP_PREFIX, '');
  s = s.replace(BULLET, '');
  // *bold*, _italic_, ~strike~, ```mono``` wrappers
  s = s.replace(/^[*_~`]+|[*_~`]+$/g, '').trim();
  return s;
}

/** "₹ 1,250", "Rs. 200/-", "MRP: 200", "71.50" → number; anything else → null. */
export function parsePrice(value) {
  let s = String(value ?? '').trim();
  for (let i = 0; i < 3 && PRICE_LABEL.test(s); i++) s = s.replace(PRICE_LABEL, '');
  s = s.replace(PRICE_SUFFIX, '').replace(/₹/g, '').trim();
  if (/^\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, ''); // 1,250 · 1,25,000
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

const isPrice = (s) => parsePrice(s) !== null;

/** Checks name/prices and returns { name, mrp, list_price } or { error, params }. */
function validate(name, mrpRaw, listRaw) {
  const cleanName = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!cleanName) return { error: 'missing_name' };
  if (cleanName.length > 100) return { error: 'name_too_long', params: { max: 100 } };
  const mrp = parsePrice(mrpRaw);
  const list = parsePrice(listRaw);
  if (mrp === null) return { error: 'mrp_not_number', params: { value: String(mrpRaw ?? '').trim().slice(0, 30) } };
  if (list === null) return { error: 'list_not_number', params: { value: String(listRaw ?? '').trim().slice(0, 30) } };
  if (mrp > MAX_PRICE || list > MAX_PRICE) return { error: 'price_too_large' };
  if (list > mrp) return { error: 'list_over_mrp', params: { mrp, list } };
  return { name: cleanName, mrp, list_price: list };
}

/** One "Name, MRP, List price" entry (format 2). */
function parseEntry(text) {
  const parts = (text.includes('\t') ? text.split('\t') : text.split(',')).map((p) => p.trim());
  while (parts.length && !parts[parts.length - 1]) parts.pop();
  if (parts.length === 1) return { error: isPrice(parts[0]) ? 'missing_name' : 'missing_prices' };
  if (parts.length === 2) return { error: isPrice(parts[0]) ? 'missing_name' : 'missing_field' };
  const nameParts = parts.slice(0, -2);
  // "Milk,1,250,1,200": a comma used inside a number shifts every field.
  if (nameParts.length > 1 && nameParts.slice(1).some((p) => /^[\d.]+$/.test(p))) return { error: 'ambiguous_commas' };
  return validate(nameParts.join(', '), parts[parts.length - 2], parts[parts.length - 1]);
}

/** "Milk 25 21" written on one line with spaces → hint to use commas. */
const spacedOneLine = (s) => /^(.*\D)\s+\d+(?:\.\d{1,2})?\s+\d+(?:\.\d{1,2})?$/.test(s);

/**
 * Parses the whole message. Returns { items } in message order; each item has
 * { index, lines: [first, last], source, name?, mrp?, list_price?, error?, params? }.
 */
export function parseCatalogMessage(text) {
  const items = [];
  const push = (lines, source, result) => items.push({ index: items.length + 1, lines, source, ...result });

  let pending = null; // format 1: { name, line, prices: [{ value, line, raw }] }
  let orphans = null; // price lines with no product name above them

  const flushPending = () => {
    if (!pending) return;
    const { name, line, prices } = pending;
    const last = prices.length ? prices[prices.length - 1].line : line;
    const source = [name, ...prices.map((p) => p.raw)].join('\n');
    pending = null;
    if (prices.length === 0) {
      return push([line, last], source, { error: spacedOneLine(name) ? 'one_line_spaces' : 'missing_prices' });
    }
    if (prices.length === 1) return push([line, last], source, { error: 'missing_list_price', params: { mrp: prices[0].value } });
    push([line, last], source, validate(name, prices[0].raw, prices[1].raw));
  };
  const flushOrphans = () => {
    if (!orphans) return;
    push([orphans[0].line, orphans[orphans.length - 1].line], orphans.map((o) => o.raw).join('\n'), {
      error: 'price_without_name',
      params: { value: orphans.map((o) => o.raw).join(', ').slice(0, 40) },
    });
    orphans = null;
  };

  String(text ?? '')
    .split(/\r?\n/)
    .forEach((rawLine, i) => {
      const lineNo = i + 1;
      const line = cleanLine(rawLine);
      if (!line) return;

      if (isPrice(line)) {
        if (pending) {
          pending.prices.push({ value: parsePrice(line), line: lineNo, raw: line });
          if (pending.prices.length === 2) flushPending();
          return;
        }
        (orphans ||= []).push({ line: lineNo, raw: line });
        return;
      }

      const lastSegment = line.split(',').pop();
      const isEntryLine = SEPARATOR.test(line) || line.includes('\t') || (line.includes(',') && isPrice(lastSegment));
      if (isEntryLine) {
        flushPending();
        flushOrphans();
        line
          .split(SEPARATOR)
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((entry) => push([lineNo, lineNo], entry, parseEntry(entry)));
        return;
      }

      // A product name (format 1).
      flushPending();
      flushOrphans();
      pending = { name: line, line: lineNo, prices: [] };
    });
  flushPending();
  flushOrphans();

  // The same product twice in one message: keep the first, report the rest.
  const seen = new Map();
  for (const item of items) {
    if (item.error) continue;
    const key = item.name.toLowerCase();
    if (seen.has(key)) {
      const first = seen.get(key);
      Object.assign(item, { error: 'duplicate', params: { n: first.index } });
      delete item.name;
      delete item.mrp;
      delete item.list_price;
    } else seen.set(key, item);
  }
  return { items };
}
