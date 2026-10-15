import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, Info, Loader2, Upload } from 'lucide-react';
import { rich, useT } from '../i18n/index.jsx';

const CHUNK = 500; // the API accepts up to 500 rows per request
const MAX_ROWS = 2000;
const MAX_BYTES = 5 * 1024 * 1024;

/** Template columns (header names stay English — they're read by the importer). Only the first three are required.
 * Format hints come from imp.fmt.<key>. */
export const COLUMNS = [
  { key: 'name', label: 'name', required: true, example: 'Aashirvaad Atta 5kg' },
  { key: 'mrp', label: 'mrp', required: true, example: '260' },
  { key: 'list_price', label: 'list_price', required: true, example: '235' },
  { key: 'category', label: 'category', example: 'Grains & Flours' },
  { key: 'description', label: 'description', example: 'Whole wheat chakki atta' },
  { key: 'images', label: 'images', example: '' },
  { key: 'tags', label: 'tags', example: 'Bestseller' },
  { key: 'in_stock', label: 'in_stock', example: 'yes' },
  { key: 'details', label: 'details', example: 'Weight: 5 kg; Shelf life: 3 months' },
  { key: 'item_code', label: 'item_code', example: '' },
  { key: 'rating', label: 'rating', example: '' },
  { key: 'review_count', label: 'review_count', example: '' },
];
const LIGHT = COLUMNS.filter((c) => c.required);

// Header spellings people actually use in Excel sheets → canonical keys.
const ALIASES = {
  name: ['name', 'product name', 'product', 'item', 'item name', 'title', 'product_name'],
  mrp: ['mrp', 'm.r.p', 'm.r.p.', 'max retail price', 'maximum retail price'],
  list_price: ['list_price', 'list price', 'selling price', 'selling_price', 'offer price', 'offer_price', 'price', 'sale price', 'sp'],
  category: ['category', 'categories', 'type', 'department'],
  description: ['description', 'desc', 'about'],
  images: ['images', 'image', 'image url', 'image urls', 'photo', 'photos', 'image_url'],
  tags: ['tags', 'tag', 'labels', 'badges'],
  in_stock: ['in_stock', 'in stock', 'stock', 'available', 'availability'],
  details: ['details', 'specs', 'specifications', 'specs_json', 'attributes'],
  item_code: ['item_code', 'item code', 'sku', 'sku_id', 'code', 'product code'],
  rating: ['rating', 'stars'],
  review_count: ['review_count', 'reviews', 'review count', 'ratings count'],
};
const HEADER_MAP = Object.fromEntries(Object.entries(ALIASES).flatMap(([k, list]) => list.map((a) => [a, k])));
const canon = (h) => HEADER_MAP[String(h ?? '').replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ')] || null;

const price = (v) => {
  const raw = String(v ?? '').replace(/[₹,\s]|rs\.?/gi, '');
  return raw === '' ? null : Number(raw);
};
const YES = /^(yes|y|true|1|in stock|available)$/i;
const NO = /^(no|n|false|0|out of stock|unavailable|sold out)$/i;

/** Validates one row (same rules as the server). Returns { product } or { errors }. */
function validateRow(t, r) {
  const errors = [];
  const name = String(r.name ?? '').trim();
  if (!name) errors.push(t('imp.e.nameRequired'));
  else if (name.length > 100) errors.push(t('imp.e.nameLong'));

  const mrp = price(r.mrp);
  const list = price(r.list_price);
  if (mrp === null) errors.push(t('imp.e.mrpRequired'));
  else if (!Number.isFinite(mrp)) errors.push(t('imp.e.mrpNaN', { value: r.mrp }));
  else if (mrp < 0) errors.push(t('imp.e.mrpNegative'));
  if (list === null) errors.push(t('imp.e.listRequired'));
  else if (!Number.isFinite(list)) errors.push(t('imp.e.listNaN', { value: r.list_price }));
  else if (list < 0) errors.push(t('imp.e.listNegative'));
  if (Number.isFinite(mrp) && Number.isFinite(list) && list > mrp) errors.push(t('imp.e.listOverMrp', { list, mrp }));

  const images = String(r.images ?? '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (images.length > 8) errors.push(t('imp.e.tooManyImages'));
  images.forEach((u) => {
    if (!/^(https:\/\/|\/uploads\/)/i.test(u)) errors.push(t('imp.e.imageHttps', { url: u.slice(0, 40) }));
    else if (/(cdninstagram\.com|fbcdn\.net)/i.test(u)) errors.push(t('imp.e.instagram'));
  });

  const stockRaw = String(r.in_stock ?? '').trim();
  if (stockRaw && !YES.test(stockRaw) && !NO.test(stockRaw)) errors.push(t('imp.e.stock', { value: stockRaw }));

  const tags = String(r.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (tags.length > 10) errors.push(t('imp.e.tooManyTags'));
  if (tags.some((tag) => tag.length > 30)) errors.push(t('imp.e.tagLong'));

  const details = String(r.details ?? '').trim();
  if (details && !details.startsWith('{') && !details.split(/[;\n|]/).filter((p) => p.trim()).every((p) => p.includes(':'))) {
    errors.push(t('imp.e.details'));
  }
  if (details.startsWith('{')) {
    try {
      JSON.parse(details);
    } catch {
      errors.push(t('imp.e.detailsInvalid'));
    }
  }

  const code = String(r.item_code ?? '').trim();
  if (code && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(code)) errors.push(t('imp.e.itemCode', { code }));
  const rating = String(r.rating ?? '').trim();
  if (rating && !(Number(rating) >= 1 && Number(rating) <= 5)) errors.push(t('imp.e.rating'));
  const reviews = String(r.review_count ?? '').trim();
  if (reviews && !(Number.isInteger(Number(reviews)) && Number(reviews) >= 0)) errors.push(t('imp.e.reviews'));
  if (String(r.description ?? '').length > 5000) errors.push(t('imp.e.descriptionLong'));

  if (errors.length) return { errors };
  return {
    product: {
      ...(code ? { sku_id: code } : {}),
      name,
      mrp,
      list_price: list,
      category: String(r.category ?? '').trim(),
      description: String(r.description ?? '').trim(),
      images,
      tags,
      in_stock: stockRaw ? YES.test(stockRaw) : true,
      specs: details,
      rating: rating || null,
      review_count: reviews || 0,
    },
  };
}

function downloadTemplate(kind) {
  const cols = kind === 'light' ? LIGHT : COLUMNS;
  const rows =
    kind === 'light'
      ? [['Aashirvaad Atta 5kg', '260', '235'], ['Amul Butter 500g', '285', '275']]
      : [
          cols.map((c) => c.example),
          ['Amul Butter 500g', '285', '275', 'Dairy', 'Salted butter', '', 'Bestseller,New', 'yes', 'Weight: 500 g', '', '4.8', '2100'],
        ];
  const csv = Papa.unparse({ fields: cols.map((c) => c.label), data: rows });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); // BOM: Excel opens ₹ correctly
  a.download = kind === 'light' ? 'products-light-template.csv' : 'products-full-template.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Reads .csv or .xlsx into { headers, rows: string[][] }. */
async function readFile(file) {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    const data = await readSheet(file);
    const [headers = [], ...rows] = data;
    return { headers: headers.map((h) => String(h ?? '')), rows: rows.map((r) => r.map((c) => (c == null ? '' : String(c)))) };
  }
  const text = await file.text();
  const parsed = Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  const [headers = [], ...rows] = parsed.data;
  return { headers, rows };
}

/** Bulk import: Light (3 columns) or Full template, .csv or .xlsx, validated before upload. */
export default function CsvImport({ onUpload, existingProducts = [], skuUsed, skuLimit }) {
  const t = useT();
  const [parsed, setParsed] = useState(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  const existing = useMemo(
    () => ({
      names: new Map(existingProducts.map((p) => [p.name.toLowerCase(), p])),
      skus: new Map(existingProducts.map((p) => [p.sku_id, p])),
    }),
    [existingProducts],
  );

  const onFile = async (file) => {
    if (!file) return;
    setParsed(null);
    setProgress(null);
    setError('');
    if (!/\.(csv|xlsx)$/i.test(file.name)) return setError(t('imp.wrongType'));
    if (file.size > MAX_BYTES) return setError(t('imp.tooBig'));
    setReading(true);
    try {
      const { headers, rows } = await readFile(file);
      const keys = headers.map(canon);
      const unknown = headers.filter((h, i) => String(h).trim() && !keys[i]);
      const missing = LIGHT.filter((c) => !keys.includes(c.key)).map((c) => c.label);
      if (!headers.length || !rows.length) throw new Error(t('imp.noRows'));
      if (missing.length) throw new Error(t('imp.missingCols', { cols: missing.join(', ') }));
      if (rows.length > MAX_ROWS) throw new Error(t('imp.tooManyRows', { count: rows.length, max: MAX_ROWS }));

      const valid = [];
      const errors = [];
      const seen = new Map();
      rows.forEach((cells, i) => {
        const line = i + 2; // header is line 1
        const r = {};
        keys.forEach((k, j) => k && (r[k] = cells[j]));
        if (Object.values(r).every((v) => String(v ?? '').trim() === '')) return; // blank row
        const res = validateRow(t, r);
        if (res.errors) return errors.push({ line, name: r.name, problems: res.errors });
        const key = res.product.sku_id ? `sku:${res.product.sku_id}` : `name:${res.product.name.toLowerCase()}`;
        if (seen.has(key)) return errors.push({ line, name: r.name, problems: [t('imp.e.duplicateOf', { line: seen.get(key) })] });
        seen.set(key, line);
        const match = res.product.sku_id ? existing.skus.get(res.product.sku_id) : existing.names.get(res.product.name.toLowerCase());
        valid.push({ ...res.product, _update: Boolean(match && match.status === 'active') });
      });
      const newCount = valid.filter((v) => !v._update).length;
      setParsed({ name: file.name, valid, errors, unknown, newCount, updateCount: valid.length - newCount });
    } catch (err) {
      setError(err.message || t('imp.readFailed'));
    } finally {
      setReading(false);
    }
  };

  const room = Math.max(0, (skuLimit || 0) - (skuUsed || 0));
  const overLimit = parsed && skuLimit > 0 && parsed.newCount > room;

  const upload = async () => {
    const rows = parsed.valid.map(({ _update, ...p }) => p);
    const total = Math.ceil(rows.length / CHUNK);
    setError('');
    for (let i = 0; i < total; i++) {
      setProgress({ done: i, total });
      try {
        await onUpload(rows.slice(i * CHUNK, (i + 1) * CHUNK));
      } catch (err) {
        const rowErrors = err.fields?.rows?.map((e) => t('imp.rowError', { row: i * CHUNK + e.row, error: e.error })).slice(0, 5).join('; ');
        setError(t('imp.batchFailed', { n: i + 1, total, error: `${err.message}${rowErrors ? ` (${rowErrors})` : ''}` }));
        setProgress(null);
        return;
      }
    }
    setProgress({ done: total, total, finished: true });
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <FileUp size={18} className="text-brand" /> {t('imp.title')}
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-stone-200 p-4">
            <p className="flex items-center gap-2 font-semibold"><FileSpreadsheet size={16} className="text-brand" /> {t('imp.light')}</p>
            <p className="mt-1 text-xs text-stone-500">{rich(t('imp.lightBody'), { b: (x) => <b>{x}</b> })}</p>
            <button onClick={() => downloadTemplate('light')} className="btn-ghost mt-3 w-full py-2 text-xs">
              <Download size={14} /> {t('imp.downloadLight')}
            </button>
          </div>
          <div className="rounded-2xl border border-stone-200 p-4">
            <p className="flex items-center gap-2 font-semibold"><FileSpreadsheet size={16} className="text-brand" /> {t('imp.full')}</p>
            <p className="mt-1 text-xs text-stone-500">{rich(t('imp.fullBody', { count: COLUMNS.length }), { b: (x) => <b>{x}</b> })}</p>
            <button onClick={() => downloadTemplate('full')} className="btn-ghost mt-3 w-full py-2 text-xs">
              <Download size={14} /> {t('imp.downloadFull')}
            </button>
          </div>
        </div>

        <details className="rounded-xl bg-stone-50 p-3 text-xs">
          <summary className="cursor-pointer font-semibold">{t('imp.guide')}</summary>
          <table className="mt-2 w-full">
            <thead>
              <tr className="text-start text-stone-500"><th className="py-1">{t('imp.column')}</th><th>{t('imp.requiredCol')}</th><th>{t('imp.format')}</th></tr>
            </thead>
            <tbody>
              {COLUMNS.map((c) => (
                <tr key={c.key} className="border-t border-stone-200">
                  <td className="py-1 font-mono">{c.label}</td>
                  <td>{c.required ? <b className="text-rose-600">{t('common.yes')}</b> : t('common.no')}</td>
                  <td className="text-stone-600">{t(`imp.fmt.${c.key}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-stone-500">
            {rich(t('imp.matching'), { b: (x) => <b>{x}</b> })}
          </p>
        </details>

        {skuLimit > 0 && (
          <p className="text-xs text-stone-500">
            <Info size={14} className="me-1 inline align-[-2px]" />
            {rich(t('imp.usage', { used: skuUsed, limit: skuLimit, room }), { b: (x) => <b>{x}</b> })}
          </p>
        )}

        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-stone-300 p-6 text-sm text-stone-500 hover:border-brand">
          {reading ? <Loader2 className="animate-spin" /> : <Upload />}
          {reading ? t('imp.reading') : parsed ? parsed.name : t('imp.choose')}
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = '';
          }} />
        </label>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>

      {parsed && (
        <div className="card space-y-3 p-5">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">{t('imp.ready', { count: parsed.valid.length })}</span>
            <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">{t('imp.new', { count: parsed.newCount })}</span>
            <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-700">{t('imp.updates', { count: parsed.updateCount })}</span>
            {parsed.errors.length > 0 && <span className="rounded-full bg-rose-100 px-3 py-1 font-semibold text-rose-700">{t('imp.withErrors', { count: parsed.errors.length })}</span>}
          </div>
          {parsed.unknown.length > 0 && (
            <p className="text-xs text-amber-700">{t('imp.unknownCols', { cols: parsed.unknown.join(', ') })}</p>
          )}
          {parsed.errors.length > 0 && (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-900" aria-label={t('imp.rowsWithErrors')}>
              {parsed.errors.slice(0, 200).map((e) => (
                <li key={e.line} className="flex gap-1">
                  <AlertTriangle size={12} className="mt-0.5 flex-none" />
                  <span><b>{t('imp.row', { line: e.line })}</b>{e.name ? ` (${String(e.name).slice(0, 30)})` : ''}: {e.problems.join('; ')}</span>
                </li>
              ))}
            </ul>
          )}
          {overLimit && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t('imp.overLimit', { count: parsed.newCount, room, limit: skuLimit })}
            </p>
          )}
          {progress && (
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                <div className="h-full bg-brand transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <p className="mt-1 flex items-center gap-1 text-xs text-stone-500">
                {progress.finished ? (
                  <><CheckCircle2 size={14} className="text-emerald-600" /> {t('imp.imported', { count: parsed.valid.length })}</>
                ) : (
                  t('imp.uploadingBatch', { n: progress.done + 1, total: progress.total })
                )}
              </p>
            </div>
          )}
          <button onClick={upload} disabled={!parsed.valid.length || overLimit || (progress && !progress.finished)} className="btn-brand w-full">
            <Upload size={16} /> {t('imp.importValid', { count: parsed.valid.length })}
          </button>
        </div>
      )}
    </div>
  );
}
