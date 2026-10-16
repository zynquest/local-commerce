import { useEffect, useRef, useState } from 'react';
import { Camera, Copy, Loader2, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react';
import SmartImage from '../components/SmartImage.jsx';
import { del, get, post, put } from '../lib/api.js';
import { uploadImage } from '../services/imageService.js';
import { useI18n } from '../i18n/index.jsx';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULT_SCHEDULE = Object.fromEntries(DAYS.map((d) => [d, d === 'sun' ? [] : [['10:00', '19:00']]]));
const EMPTY = { name: '', title: '', photo_url: null, schedule: DEFAULT_SCHEDULE, service_ids: [], active: true };

/** Weekly working hours: each day off or up to two time ranges (e.g. 10:00–13:00 and 14:00–19:00). */
function ScheduleEditor({ value, onChange }) {
  const { t, dayName } = useI18n();
  const setDay = (day, ranges) => onChange({ ...value, [day]: ranges });
  return (
    <div className="space-y-2">
      {DAYS.map((day) => {
        const ranges = value[day] || [];
        const open = ranges.length > 0;
        return (
          <div key={day} className="flex flex-wrap items-center gap-2 rounded-xl bg-stone-50 p-2">
            <label className="flex w-28 flex-none items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={open} onChange={(e) => setDay(day, e.target.checked ? [['10:00', '19:00']] : [])} className="h-4 w-4 accent-[var(--brand)]" />
              {dayName(day)}
            </label>
            {!open && <span className="text-xs text-stone-400">{t('appt.dayOff')}</span>}
            {ranges.map(([start, end], i) => (
              <span key={i} className="flex items-center gap-1" dir="ltr">
                <input type="time" className="input w-28 px-2 py-1 text-sm" value={start} aria-label={t('appt.from')}
                  onChange={(e) => setDay(day, ranges.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
                <span className="text-stone-400">–</span>
                <input type="time" className="input w-28 px-2 py-1 text-sm" value={end} aria-label={t('appt.to')}
                  onChange={(e) => setDay(day, ranges.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
                {ranges.length > 1 && (
                  <button type="button" onClick={() => setDay(day, ranges.filter((_, j) => j !== i))} className="p-1 text-stone-400" aria-label={t('common.remove')}><X size={14} /></button>
                )}
              </span>
            ))}
            {open && ranges.length < 2 && (
              <button type="button" onClick={() => setDay(day, [...ranges, ['16:00', '20:00']])} className="text-xs font-semibold text-brand">{t('appt.addBreak')}</button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange(Object.fromEntries(DAYS.map((d) => [d, d === 'sun' || d === 'mon' ? value[d] || [] : (value.mon || []).map((r) => [...r])])))}
        className="flex items-center gap-1 text-xs font-semibold text-brand"
      >
        <Copy size={12} /> {t('appt.copyMonday')}
      </button>
    </div>
  );
}

function SpecialistForm({ specialist, services, onSave, onCancel }) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => (specialist ? { ...EMPTY, ...specialist } : { ...EMPTY, service_ids: services.map((s) => s.id) }));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const photoRef = useRef(null);

  const toggleService = (id) =>
    setForm((f) => ({ ...f, service_ids: f.service_ids.includes(id) ? f.service_ids.filter((x) => x !== id) : [...f.service_ids, id] }));

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setForm((f) => ({ ...f, photo_url: url }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.service_ids.length) return setError(t('appt.pickServices'));
    setBusy(true);
    setError('');
    try {
      await onSave(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-4" noValidate>
      <div className="flex items-center justify-between">
        <h3 className="font-bold">{specialist ? t('appt.editSpecialist') : t('appt.addSpecialist')}</h3>
        <button type="button" onClick={onCancel} className="p-1 text-stone-400" aria-label={t('common.cancel')}><X size={18} /></button>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={() => photoRef.current?.click()} className="relative flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-stone-300 bg-stone-50 text-stone-400" aria-label={t('appt.photo')}>
          {form.photo_url ? <SmartImage src={form.photo_url} alt="" className="h-full w-full object-cover" /> : <Camera size={20} />}
          {uploading && <span className="absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 className="animate-spin text-brand" /></span>}
        </button>
        <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
        <div className="flex-1 space-y-2">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('appt.specialistName')} aria-label={t('appt.specialistName')} maxLength={60} autoFocus />
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('appt.specialistTitlePlaceholder')} aria-label={t('appt.specialistTitle')} maxLength={80} />
        </div>
      </div>
      <div>
        <p className="label">{t('appt.servicesOffered')} <span className="text-rose-500">*</span></p>
        {services.length ? (
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <label key={s.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${form.service_ids.includes(s.id) ? 'border-brand bg-emerald-50 font-semibold text-brand' : 'border-stone-200'}`}>
                <input type="checkbox" className="sr-only" checked={form.service_ids.includes(s.id)} onChange={() => toggleService(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-amber-700">{t('appt.addServicesFirst')}</p>
        )}
      </div>
      <div>
        <p className="label">{t('appt.workingHours')}</p>
        <ScheduleEditor value={form.schedule} onChange={(schedule) => setForm({ ...form, schedule })} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-[var(--brand)]" /> {t('appt.specialistActive')}
      </label>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button disabled={busy || uploading} className="btn-brand w-full">{busy && <Loader2 size={16} className="animate-spin" />} {t('common.save')}</button>
    </form>
  );
}

/** Specialists (stylist, therapist, doctor): services they offer and weekly working hours. */
export default function SpecialistsPanel({ onChange }) {
  const { t, dayName } = useI18n();
  const [data, setData] = useState({ loading: true, specialists: [], services: [], error: '' });
  const [editing, setEditing] = useState(null);

  const load = () =>
    Promise.all([get('/merchant/specialists'), get('/merchant/services')])
      .then(([a, b]) => setData({ loading: false, specialists: a.specialists, services: b.services, error: '' }))
      .catch((err) => setData((d) => ({ ...d, loading: false, error: err.message })));
  useEffect(() => {
    load();
  }, []);

  const save = async (body) => {
    if (editing === 'new') await post('/merchant/specialists', body);
    else await put(`/merchant/specialists/${editing.id}`, body);
    setEditing(null);
    await load();
    onChange?.();
  };

  const remove = async (sp) => {
    if (!window.confirm(t('appt.confirmDeleteSpecialist', { name: sp.name }))) return;
    await del(`/merchant/specialists/${sp.id}`);
    await load();
    onChange?.();
  };

  if (editing) return <SpecialistForm specialist={editing === 'new' ? null : editing} services={data.services} onSave={save} onCancel={() => setEditing(null)} />;

  const serviceName = Object.fromEntries(data.services.map((s) => [s.id, s.name]));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-stone-600">{t('appt.specialistsIntro')}</p>
        <button onClick={() => setEditing('new')} className="btn-brand flex-none"><Plus size={16} /> {t('appt.addSpecialist')}</button>
      </div>
      {data.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{data.error}</p>}
      <ul className="card divide-y divide-stone-100">
        {data.specialists.map((sp) => (
          <li key={sp.id} className={`flex items-center gap-3 p-3 ${sp.active ? '' : 'opacity-50'}`}>
            {sp.photo_url ? (
              <SmartImage src={sp.photo_url} alt={sp.name} width={80} className="h-11 w-11 flex-none rounded-full object-cover" />
            ) : (
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-stone-100 text-stone-500"><UserRound size={20} /></span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{sp.name}{sp.title && <span className="font-normal text-stone-500"> · {sp.title}</span>}</p>
              <p className="truncate text-xs text-stone-500">{sp.service_ids.map((id) => serviceName[id]).filter(Boolean).join(', ') || '—'}</p>
              <p className="truncate text-[11px] text-stone-400">
                {DAYS.filter((d) => sp.schedule[d]?.length).map((d) => dayName(d, 'short')).join(' ') || t('appt.noHours')}
              </p>
            </div>
            <button onClick={() => setEditing(sp)} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label={t('common.edit')}><Pencil size={18} /></button>
            <button onClick={() => remove(sp)} className="rounded-lg p-2 text-stone-400 hover:bg-rose-50 hover:text-rose-600" aria-label={t('common.delete')}><Trash2 size={18} /></button>
          </li>
        ))}
        {data.loading && <li className="flex justify-center p-6"><Loader2 className="animate-spin text-stone-400" /></li>}
        {!data.loading && !data.specialists.length && <li className="p-8 text-center text-sm text-stone-500">{t('appt.noSpecialists')}</li>}
      </ul>
    </div>
  );
}
