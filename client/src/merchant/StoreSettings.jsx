import { useRef, useState } from 'react';
import { BadgeCheck, Camera, Check, Loader2, Pencil, Save, X } from 'lucide-react';
import AddressPicker from '../components/AddressPicker.jsx';
import MobileInput from '../components/MobileInput.jsx';
import OtpField from '../components/OtpField.jsx';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import SmartImage from '../components/SmartImage.jsx';
import { post, put } from '../lib/api.js';
import { uploadImage } from '../services/imageService.js';
import { useT } from '../i18n/index.jsx';
import { LANGUAGES } from '../i18n/languages.js';

const FIELDS = [
// Labels: settings.f.<field>; hints: settings.h.<field>; translatable placeholders: settings.p.<field>.
  ['name', { required: true, maxLength: 60 }],
  ['slug', { prefix: '/s/', hint: true }],
  ['category', { required: true, tPlaceholder: true }],
  ['city', { required: true, tPlaceholder: true }],
  ['description', { textarea: true, maxLength: 500 }],
  ['opening_hours', { placeholder: '09:00-21:00', hint: true }],
  ['closed_days', { placeholder: 'Sun' }],
  ['minimum_order', { type: 'number', min: 0, shopOnly: true }],
  ['delivery_fee', { type: 'number', min: 0, shopOnly: true }],
  ['instagram_handle', { placeholder: 'yourstore' }],
  ['theme_color', { type: 'color' }],
];

const formatPhone = (p) => (p ? `+${p.slice(0, p.length - 10)} ${p.slice(-10, -5)} ${p.slice(-5)}` : '—');

/** WhatsApp number for orders. Changing it requires an OTP sent to the new number. */
function WhatsAppNumber({ store, onSaved }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const verify = async () => {
    setBusy(true);
    setError('');
    try {
      const { store: updated } = await post('/merchant/store/whatsapp/verify', { phone, code });
      onSaved(updated, t('settings.waUpdated'));
      setEditing(false);
      setPhone('');
      setCode('');
    } catch (err) {
      setError(err.fields?.code || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-brand/30 bg-emerald-50/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="label">{t('settings.waLabel')} <span className="text-rose-500">*</span></p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold">
            <WhatsAppIcon size={18} className="text-whatsapp" />
            <span className="whitespace-nowrap">{formatPhone(store.whatsapp_number)}</span>
            {store.whatsapp_number &&
              (store.whatsapp_verified ? (
                <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                  <BadgeCheck size={12} /> {t('settings.verified')}
                </span>
              ) : (
                <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-semibold text-stone-600">{t('settings.registrationNumber')}</span>
              ))}
          </p>
          <p className="text-[11px] text-stone-500">{t('settings.waHint')}</p>
        </div>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="btn-ghost py-1.5 text-xs">
            <Pencil size={14} /> {t('settings.change')}
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-3 space-y-2 rounded-xl bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{t('settings.change')}</p>
            <button type="button" onClick={() => setEditing(false)} aria-label={t('common.cancel')} className="p-1 text-stone-400"><X size={16} /></button>
          </div>
          <MobileInput id="new-whatsapp" value={phone} onChange={setPhone} label={t('settings.newWa')} />
          <OtpField phone={phone} purpose="whatsapp_change" code={code} onCode={setCode} />
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <button type="button" onClick={verify} disabled={busy || code.length !== 6} className="btn-brand w-full">
            {busy && <Loader2 size={16} className="animate-spin" />} {t('settings.verifyUpdate')}
          </button>
        </div>
      )}
    </div>
  );
}

const APPT_DEFAULTS = { slot_minutes: 30, booking_days: 14, min_notice_minutes: 60 };

export default function StoreSettings({ store, onSaved }) {
  const t = useT();
  const appointments = store.business_type === 'appointments';
  const [form, setForm] = useState(() => ({
    ...Object.fromEntries(
      [...FIELDS.map(([k]) => k), 'logo_url', 'banner_url', 'order_language', 'address_text', 'maps_url', 'place_id'].map((k) => [
        k,
        store[k] ?? (k === 'theme_color' ? '#15803d' : k === 'order_language' ? 'auto' : ''),
      ]),
    ),
    lat: store.lat ?? null,
    lng: store.lng ?? null,
    ...Object.fromEntries(Object.entries(APPT_DEFAULTS).map(([k, d]) => [k, store[k] ?? d])),
  }));
  const [fields, setFields] = useState({});
  const [status, setStatus] = useState({ busy: false, error: '', saved: false });
  const [uploading, setUploading] = useState('');
  const logoRef = useRef(null);
  const bannerRef = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const upload = async (key, file) => {
    if (!file) return;
    setUploading(key);
    try {
      const url = await uploadImage(file);
      setForm((f) => ({ ...f, [key]: url }));
    } catch (err) {
      setStatus((s) => ({ ...s, error: err.message }));
    } finally {
      setUploading('');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setStatus({ busy: true, error: '', saved: false });
    setFields({});
    try {
      const payload = appointments ? form : Object.fromEntries(Object.entries(form).filter(([k]) => !(k in APPT_DEFAULTS)));
      const { store: saved } = await put('/merchant/store', payload);
      setStatus({ busy: false, error: '', saved: true });
      onSaved(saved, t('settings.saved'));
      setTimeout(() => setStatus((s) => ({ ...s, saved: false })), 2500);
    } catch (err) {
      setFields(err.fields || {});
      setStatus({ busy: false, error: err.message, saved: false });
    }
  };

  const imagePicker = (key, label, ref, className) => (
    <div>
      <span className="label">{label}</span>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={`relative flex items-center justify-center overflow-hidden border-2 border-dashed border-stone-300 bg-stone-50 text-stone-400 hover:border-brand ${className}`}
      >
        {form[key] ? <SmartImage src={form[key]} alt="" className="h-full w-full object-cover" /> : <Camera size={22} />}
        {uploading === key && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="animate-spin text-brand" />
          </span>
        )}
      </button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => upload(key, e.target.files?.[0])} />
    </div>
  );

  return (
    <form onSubmit={submit} className="card space-y-5 p-4 sm:p-6">
      <div className="flex gap-4">
        {imagePicker('logo_url', t('settings.logo'), logoRef, 'h-24 w-24 rounded-2xl')}
        <div className="flex-1">{imagePicker('banner_url', t('settings.banner'), bannerRef, 'h-24 w-full rounded-2xl')}</div>
      </div>

      <WhatsAppNumber store={store} onSaved={onSaved} />

      <AddressPicker
        value={form}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        error={fields.lat || fields.address_text}
      />

      {appointments && (
        <div className="grid gap-4 rounded-2xl border border-stone-200 p-4 sm:grid-cols-3">
          <p className="label mb-0 sm:col-span-3">{t('appt.settingsTitle')}</p>
          <div>
            <label className="label" htmlFor="st-slot_minutes">{t('appt.slotMinutes')}</label>
            <select id="st-slot_minutes" className="input" value={form.slot_minutes} onChange={set('slot_minutes')}>
              {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{t('appt.minutes', { count: m })}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="st-booking_days">{t('appt.bookingDays')}</label>
            <select id="st-booking_days" className="input" value={form.booking_days} onChange={set('booking_days')}>
              {[3, 7, 14, 21, 30, 60].map((d) => <option key={d} value={d}>{t('appt.days', { count: d })}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="st-min_notice_minutes">{t('appt.minNotice')}</label>
            <select id="st-min_notice_minutes" className="input" value={form.min_notice_minutes} onChange={set('min_notice_minutes')}>
              {[0, 30, 60, 120, 240, 720, 1440].map((m) => (
                <option key={m} value={m}>{m === 0 ? t('appt.noNotice') : m < 60 ? t('appt.minutes', { count: m }) : t('appt.hours', { count: m / 60 })}</option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-stone-400 sm:col-span-3">{t('appt.settingsHint')}</p>
        </div>
      )}

      <div>
        <label className="label" htmlFor="st-order_language">{t('settings.orderLanguage')}</label>
        <select id="st-order_language" className="input" value={form.order_language} onChange={set('order_language')}>
          <option value="auto">{t('settings.orderLanguageAuto')}</option>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name} — {l.english}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-stone-400">{t('settings.orderLanguageHint')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.filter(([, opts]) => !(appointments && opts.shopOnly)).map(([key, opts]) => (
          <div key={key} className={opts.textarea || key === 'slug' ? 'sm:col-span-2' : ''}>
            <label className="label" htmlFor={`st-${key}`}>
              {t(`settings.f.${key}`)}
              {opts.required && <span className="text-rose-500"> *</span>}
            </label>
            {opts.textarea ? (
              <textarea id={`st-${key}`} rows={3} className="input" value={form[key]} onChange={set(key)} maxLength={opts.maxLength} />
            ) : (
              <div className="flex items-center gap-2">
                {opts.prefix && <span className="text-sm text-stone-500">{opts.prefix}</span>}
                <input
                  id={`st-${key}`}
                  className={opts.type === 'color' ? 'h-10 w-16 cursor-pointer rounded-lg border border-stone-200' : 'input'}
                  type={opts.type || 'text'}
                  value={form[key]}
                  onChange={set(key)}
                  inputMode={opts.inputMode}
                  placeholder={opts.tPlaceholder ? t(appointments && key === 'category' ? 'appt.categoryPlaceholder' : `settings.p.${key}`) : opts.placeholder}
                  min={opts.min}
                  maxLength={opts.maxLength}
                />
              </div>
            )}
            {fields[key] ? (
              <p className="mt-1 text-xs text-rose-600">{fields[key]}</p>
            ) : (
              opts.hint && <p className="mt-1 text-[11px] text-stone-400">{t(`settings.h.${key}`)}</p>
            )}
          </div>
        ))}
      </div>

      {status.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{status.error}</p>}
      <button disabled={status.busy || !!uploading} className="btn-brand w-full">
        {status.busy ? <Loader2 size={16} className="animate-spin" /> : status.saved ? <Check size={16} /> : <Save size={16} />}
        {status.saved ? t('common.saved') : t('settings.save')}
      </button>
    </form>
  );
}
