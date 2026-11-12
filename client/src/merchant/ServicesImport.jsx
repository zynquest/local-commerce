import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, Loader2, Upload } from 'lucide-react';
import { get, post } from '../lib/api.js';
import { rich, useT } from '../i18n/index.jsx';
import { downloadCsv, readFile } from './CsvImport.jsx';

const MAX_ROWS = 500; // the API takes up to 500 services in one request
const MAX_BYTES = 5 * 1024 * 1024;

/** Template columns for appointment businesses (header names stay English; they're read by the importer).
 * The first three are required. Format hints come from imp.svc.fmt.<key>. */
const COLUMNS = [
  { key: 'name', label: 'service_name', required: true },
  { key: 'duration', label: 'duration_mins', required: true },
  { key: 'price', label: 'price', required: true },
  { key: 'category', label: 'category' },
  { key: 'description', label: 'description' },
];
const REQUIRED = COLUMNS.filter((c) => c.required);
const EXAMPLE = [
  ['Hair Cut', '30', '200', 'Hair', 'Wash, cut and style'],
  ['Beard Trim', '15', '100', 'Hair', ''],
  ['Facial', '60', '800', 'Skin', 'Cleanup and massage'],
];

// Header spellings people actually use in Excel sheets → canonical keys.
const ALIASES = {
  name: ['service_name', 'service name', 'service', 'name', 'services', 'treatment', 'item', 'title'],
  duration: ['duration_mins', 'duration mins', 'duration (mins)', 'duration (min)', 'duration_min', 'duration', 'mins', 'minutes', 'time', 'time (mins)'],
  price: ['price', 'rate', 'fee', 'fees', 'charges', 'charge', 'amount', 'cost', 'price (₹)', 'price (rs)'],
  category: ['category', 'categories', 'type', 'group'],
  description: ['description', 'desc', 'about', 'details'],
};
const HEADER_MAP = Object.fromEntries(Object.entries(ALIASES).flatMap(([k, list]) => list.map((a) => [a, k])));
const canon = (h) => HEADER_MAP[String(h ?? '').replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ')] || null;

const amount = (v) => {
  const raw = String(v ?? '').replace(/[₹,\s]|rs\.?/gi, '');
  return raw === '' ? null : Number(raw);
};

/** "30", "45 min", "1 hr", "1.5 h", "1h 30m", "90 minutes" → minutes; '' → null; unreadable → NaN. */
export function minutes(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.0+)?$/.test(s)) return Number(s);
  const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/);
  if (!m || (m[1] === undefined && m[2] === undefined)) return NaN;
  return Math.round(Number(m[1] || 0) * 60 + Number(m[2] || 0));
}

/** Same rules as the server's service check. Returns { service } or { errors }. */
function validateRow(t, r) {
  const errors = [];
  const name = String(r.name ?? '').trim();
  if (!name) errors.push(t('imp.svc.e.nameRequired'));
  else if (name.length > 80) errors.push(t('imp.svc.e.nameLong'));

  const mins = minutes(r.duration);
  if (mins === null) errors.push(t('imp.svc.e.durationRequired'));
  else if (!Number.isInteger(mins)) errors.push(t('imp.svc.e.durationNaN', { value: r.duration }));
  else if (mins < 5 || mins > 480) errors.push(t('imp.svc.e.durationRange'));

  const price = amount(r.price);
  if (price === null) errors.push(t('imp.svc.e.priceRequired'));
  else if (!Number.isFinite(price)) errors.push(t('imp.svc.e.priceNaN', { value: r.price }));
  else if (price < 0) errors.push(t('imp.svc.e.priceNegative'));

  const category = String(r.category ?? '').trim();
  if (category.length > 60) errors.push(t('imp.svc.e.categoryLong'));
  const description = String(r.description ?? '').trim();
  if (description.length > 1000) errors.push(t('imp.svc.e.descriptionLong'));

  if (errors.length) return { errors };
  return { service: { name, duration_min: mins, price, category, description } };
}

/** Bulk import of services (appointment businesses): one template, .csv or .xlsx, checked before upload. */
export default function ServicesImport({ onDone }) {
  const t = useT();
  const [existing, setExisting] = useState(new Set());
  const [parsed, setParsed] = useState(null);
  const [reading, setReading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  const loadExisting = () =>
    get('/merchant/services')
      .then((r) => setExisting(new Set(r.services.map((s) => s.name.toLowerCase()))))
      .catch(() => {});
  useEffect(() => {
    loadExisting();
  }, []);

  const onFile = async (file) => {
    if (!file) return;
    setParsed(null);
    setDone(null);
    setError('');
    if (!/\.(csv|xlsx)$/i.test(file.name)) return setError(t('imp.wrongType'));
    if (file.size > MAX_BYTES) return setError(t('imp.tooBig'));
    setReading(true);
    try {
      const { headers, rows } = await readFile(file);
      const keys = headers.map(canon);
      const unknown = headers.filter((h, i) => String(h).trim() && !keys[i]);
      const missing = REQUIRED.filter((c) => !keys.includes(c.key)).map((c) => c.label);
      if (!headers.length || !rows.length) throw new Error(t('imp.svc.noRows'));
      if (missing.length) throw new Error(t('imp.missingCols', { cols: missing.join(', ') }));
      if (rows.length > MAX_ROWS) throw new Error(t('imp.tooManyRows', { count: rows.length, max: MAX_ROWS }));

      const valid = [];
      const errors = [];
      const seen = new Map();
      rows.forEach((cells, i) => {
        const line = i + 2; // header is line 1
        const r = {};
        keys.forEach((k, j) => k && r[k] === undefined && (r[k] = cells[j]));
        if (Object.values(r).every((v) => String(v ?? '').trim() === '')) return; // blank row
        const res = validateRow(t, r);
        if (res.errors) return errors.push({ line, name: r.name, problems: res.errors });
        const key = res.service.name.toLowerCase();
        if (seen.has(key)) return errors.push({ line, name: r.name, problems: [t('imp.e.duplicateOf', { line: seen.get(key) })] });
        seen.set(key, line);
        valid.push(res.service);
      });
      const updateCount = valid.filter((s) => existing.has(s.name.toLowerCase())).length;
      setParsed({ name: file.name, valid, errors, unknown, newCount: valid.length - updateCount, updateCount });
    } catch (err) {
      setError(err.message || t('imp.readFailed'));
    } finally {
      setReading(false);
    }
  };

  const upload = async () => {
    setUploading(true);
    setError('');
    try {
      await post('/merchant/services/import', { services: parsed.valid });
      setDone(parsed.valid.length);
      await loadExisting();
      onDone?.();
    } catch (err) {
      const rowErrors = err.fields?.rows?.map((e) => t('imp.rowError', { row: e.row, error: e.error })).slice(0, 5).join('; ');
      setError(`${err.message}${rowErrors ? ` (${rowErrors})` : ''}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <FileUp size={18} className="text-brand" /> {t('imp.title')}
        </h2>

        <div className="rounded-2xl border border-stone-200 p-4">
          <p className="flex items-center gap-2 font-semibold"><FileSpreadsheet size={16} className="text-brand" /> {t('imp.svc.template')}</p>
          <p className="mt-1 text-xs text-stone-500">{rich(t('imp.svc.templateBody'), { b: (x) => <b>{x}</b> })}</p>
          <button onClick={() => downloadCsv('services-template.csv', COLUMNS.map((c) => c.label), EXAMPLE)} className="btn-ghost mt-3 w-full py-2 text-xs">
            <Download size={14} /> {t('imp.svc.download')}
          </button>
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
                  <td className="text-stone-600">{t(`imp.svc.fmt.${c.key}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-stone-500">{rich(t('imp.svc.matching'), { b: (x) => <b>{x}</b> })}</p>
        </details>

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
          {parsed.unknown.length > 0 && <p className="text-xs text-amber-700">{t('imp.unknownCols', { cols: parsed.unknown.join(', ') })}</p>}
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
          {done !== null && (
            <p className="flex items-center gap-1 text-sm text-emerald-700">
              <CheckCircle2 size={16} /> {t('imp.svc.imported', { count: done })}
            </p>
          )}
          <button onClick={upload} disabled={!parsed.valid.length || uploading || done !== null} className="btn-brand w-full">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {t('imp.svc.importValid', { count: parsed.valid.length })}
          </button>
        </div>
      )}
    </div>
  );
}
