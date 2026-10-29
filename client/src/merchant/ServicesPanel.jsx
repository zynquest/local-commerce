import { useEffect, useState } from 'react';
import { Clock, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { del, get, post, put } from '../lib/api.js';
import SmartImage from '../components/SmartImage.jsx';
import { formatMoney } from '../lib/format.js';
import { useT } from '../i18n/index.jsx';

const DURATIONS = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];
const EMPTY = { name: '', category: '', duration_min: 30, price: '', description: '', active: true };

function ServiceForm({ service, onSave, onCancel }) {
  const t = useT();
  const [form, setForm] = useState(() => (service ? { ...EMPTY, ...service, price: String(service.price) } : EMPTY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      await onSave({ ...form, duration_min: Number(form.duration_min), price: form.price === '' ? '' : Number(form.price) });
    } catch (err) {
      setError(err.message);
      setFields(err.fields || {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3 p-4" noValidate>
      <div className="flex items-center justify-between">
        <h3 className="font-bold">{service ? t('appt.editService') : t('appt.addService')}</h3>
        <button type="button" onClick={onCancel} className="p-1 text-stone-400" aria-label={t('common.cancel')}><X size={18} /></button>
      </div>
      <div>
        <label className="label" htmlFor="sv-name">{t('appt.serviceName')} <span className="text-rose-500">*</span></label>
        <input id="sv-name" className="input" value={form.name} onChange={set('name')} placeholder={t('appt.serviceNamePlaceholder')} maxLength={80} autoFocus />
        {fields.name && <p className="mt-1 text-xs text-rose-600">{fields.name}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="sv-duration">{t('appt.duration')} <span className="text-rose-500">*</span></label>
          <select id="sv-duration" className="input" value={form.duration_min} onChange={set('duration_min')}>
            {[...new Set([...DURATIONS, Number(form.duration_min)])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>{m < 60 || m % 60 ? t('appt.minutes', { count: m }) : t('appt.hours', { count: m / 60 })}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sv-price">{t('appt.price')} <span className="text-rose-500">*</span></label>
          <input id="sv-price" className="input" type="number" min="0" inputMode="decimal" value={form.price} onChange={set('price')} placeholder="300" />
          {fields.price && <p className="mt-1 text-xs text-rose-600">{fields.price}</p>}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="sv-category">{t('appt.serviceCategory')}</label>
        <input id="sv-category" className="input" value={form.category} onChange={set('category')} placeholder={t('appt.serviceCategoryPlaceholder')} maxLength={60} />
      </div>
      <div>
        <label className="label" htmlFor="sv-description">{t('appt.serviceDescription')}</label>
        <textarea id="sv-description" className="input" rows={2} value={form.description} onChange={set('description')} maxLength={1000} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.active} onChange={set('active')} className="h-4 w-4 accent-[var(--brand)]" /> {t('appt.serviceActive')}
      </label>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button disabled={busy} className="btn-brand w-full">{busy && <Loader2 size={16} className="animate-spin" />} {t('common.save')}</button>
    </form>
  );
}

/** Services an appointment business offers: name, duration, price (e.g. Hair Cut · 30 min · ₹200). */
export default function ServicesPanel({ currency, onChange }) {
  const t = useT();
  const [list, setList] = useState({ loading: true, items: [], error: '' });
  const [editing, setEditing] = useState(null); // null | 'new' | service

  const load = () =>
    get('/merchant/services')
      .then((r) => setList({ loading: false, items: r.services, error: '' }))
      .catch((err) => setList({ loading: false, items: [], error: err.message }));
  useEffect(() => {
    load();
  }, []);

  const save = async (body) => {
    if (editing === 'new') await post('/merchant/services', body);
    else await put(`/merchant/services/${editing.id}`, body);
    setEditing(null);
    await load();
    onChange?.();
  };

  const remove = async (s) => {
    if (!window.confirm(t('appt.confirmDeleteService', { name: s.name }))) return;
    await del(`/merchant/services/${s.id}`);
    await load();
    onChange?.();
  };

  if (editing) return <ServiceForm service={editing === 'new' ? null : editing} onSave={save} onCancel={() => setEditing(null)} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-stone-600">{t('appt.servicesIntro')}</p>
        <button onClick={() => setEditing('new')} className="btn-brand flex-none"><Plus size={16} /> {t('appt.addService')}</button>
      </div>
      {list.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{list.error}</p>}
      <ul className="card divide-y divide-stone-100">
        {list.items.map((s) => (
          <li key={s.id} className={`flex items-center gap-3 p-3 ${s.active ? '' : 'opacity-50'}`}>
            <SmartImage alt={s.name} kind="service" className="h-10 w-10 flex-none rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{s.name}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                <span className="flex items-center gap-1"><Clock size={11} /> {t('appt.minutes', { count: s.duration_min })}</span>
                <span className="font-semibold text-stone-700">{formatMoney(s.price, currency)}</span>
                {s.category && s.category !== 'Other' && <span>{s.category}</span>}
                {!s.active && <span className="rounded-full bg-stone-200 px-1.5 text-[10px] font-bold">{t('appt.hidden')}</span>}
              </p>
            </div>
            <button onClick={() => setEditing(s)} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label={t('common.edit')}><Pencil size={18} /></button>
            <button onClick={() => remove(s)} className="rounded-lg p-2 text-stone-400 hover:bg-rose-50 hover:text-rose-600" aria-label={t('common.delete')}><Trash2 size={18} /></button>
          </li>
        ))}
        {list.loading && <li className="flex justify-center p-6"><Loader2 className="animate-spin text-stone-400" /></li>}
        {!list.loading && !list.items.length && <li className="p-8 text-center text-sm text-stone-500">{t('appt.noServices')}</li>}
      </ul>
    </div>
  );
}
