import { useRef, useState } from 'react';
import { BadgeCheck, Camera, Check, Link2, Loader2, Save } from 'lucide-react';
import AddressPicker from '../components/AddressPicker.jsx';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import SmartImage from '../components/SmartImage.jsx';
import { put } from '../lib/api.js';
import { uploadImage } from '../services/imageService.js';
import { useT } from '../i18n/index.jsx';
import { LANGUAGES } from '../i18n/languages.js';
import { SupportNote } from './OnboardingWizard.jsx';
import MyStoreQr from './MyStoreQr.jsx';
import TemporaryClosure from './TemporaryClosure.jsx';

// Optional settings, filled with these until the owner changes them.
const DEFAULTS = { opening_hours: '09:00-21:00', closed_days: 'Sun', minimum_order: 0, theme_color: '#15803d', delivery_fee: 0 };
const APPT_DEFAULTS = { slot_minutes: 30, booking_days: 14, min_notice_minutes: 60 };
const EDITABLE = [
  'address_text', 'city', 'lat', 'lng', 'maps_url', 'place_id', 'order_language',
  'delivery_fee', 'free_delivery_above', 'logo_url', 'banner_url', 'opening_hours', 'closed_days', 'minimum_order',
  'instagram_handle', 'theme_color', 'description',
];

const pretty = (p) => (p ? `+91 ${p.slice(-10, -5)} ${p.slice(-5)}` : '—');

function Section({ title, children }) {
  return (
    <section className="card space-y-4 p-4 sm:p-6">
      <h2 className="font-bold">{title}</h2>
      {children}
    </section>
  );
}

const Detail = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">{label}</dt>
    <dd className="mt-0.5 text-sm font-semibold break-words">{children || '—'}</dd>
  </div>
);

/**
 * Settings of an approved store: the fixed details (support corrects those), location and order language, then the
 * optional extras (delivery, logo, hours, weekly off, minimum order, Instagram, colour).
 */
export default function StoreSettings({ store, onSaved }) {
  const t = useT();
  const appointments = store.business_type === 'appointments';
  const [form, setForm] = useState(() => ({
    ...Object.fromEntries(EDITABLE.map((k) => [k, store[k] ?? DEFAULTS[k] ?? (k === 'order_language' ? 'auto' : k === 'lat' || k === 'lng' ? null : '')])),
    ...Object.fromEntries(Object.entries(APPT_DEFAULTS).map(([k, d]) => [k, store[k] ?? d])),
  }));
  // Delivery: free by default (fee 0). Unticking reveals the fee and the optional "free above ₹X" rule.
  const [freeDelivery, setFreeDelivery] = useState(() => !(Number(store.delivery_fee) > 0));
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
      const payload = { ...form };
      if (!appointments) for (const k of Object.keys(APPT_DEFAULTS)) delete payload[k];
      if (appointments) delete payload.minimum_order;
      if (appointments || freeDelivery) Object.assign(payload, { delivery_fee: 0, free_delivery_above: null });
      const { store: saved } = await put('/merchant/store', payload);
      setStatus({ busy: false, error: '', saved: true });
      onSaved(saved, t('settings.saved'));
      setTimeout(() => setStatus((s) => ({ ...s, saved: false })), 2500);
    } catch (err) {
      setFields(err.fields || {});
      setStatus({ busy: false, error: err.message, saved: false });
    }
  };

  // Photo upload is on the paid plan; free stores use an image link (https://…).
  const canUpload = store.plan !== 'free';
  const imagePicker = (key, label, ref, className) => (
    <div>
      <span className="label">{label}</span>
      {!canUpload ? (
        <div className="space-y-1.5">
          <div className={`flex items-center justify-center overflow-hidden border-2 border-stone-200 bg-stone-50 text-stone-400 ${className}`}>
            {form[key] ? <SmartImage src={form[key]} alt="" className="h-full w-full object-cover" /> : <Link2 size={20} />}
          </div>
          <input
            className="input py-1.5 text-xs"
            type="url"
            inputMode="url"
            maxLength={1000}
            placeholder="https://"
            value={form[key] || ''}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value.trim() }))}
            aria-label={label}
          />
          {fields[key] && <p className="text-xs text-rose-600">{fields[key]}</p>}
        </div>
      ) : (
      <>
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
      </>
      )}
    </div>
  );

  const input = (key, opts = {}) => (
    <div className={opts.wide ? 'sm:col-span-2' : ''}>
      <label className="label" htmlFor={`st-${key}`}>{t(`settings.f.${key}`)}</label>
      {opts.textarea ? (
        <textarea id={`st-${key}`} rows={3} className="input" value={form[key] ?? ''} onChange={set(key)} maxLength={opts.maxLength} />
      ) : (
        <input
          id={`st-${key}`}
          maxLength={opts.maxLength}
          className={opts.type === 'color' ? 'h-10 w-16 cursor-pointer rounded-lg border border-stone-200' : 'input'}
          type={opts.type || 'text'}
          value={form[key] ?? ''}
          onChange={set(key)}
          placeholder={opts.placeholder}
          min={opts.min}
          inputMode={opts.inputMode}
        />
      )}
      {fields[key] ? (
        <p className="mt-1 text-xs text-rose-600">{fields[key]}</p>
      ) : (
        opts.hint && <p className="mt-1 text-[11px] text-stone-400">{opts.hint}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
    <TemporaryClosure store={store} onSaved={onSaved} />
    <MyStoreQr store={store} />
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Section title={t('setup.detailsTitle')}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label={t('biz.question')}>{t(appointments ? 'biz.appointments' : 'biz.shop')}</Detail>
          <Detail label={t('settings.f.category')}>{store.category}</Detail>
          <Detail label={appointments ? t('biz.businessName') : t('owner.storeName')}>{store.name}</Detail>
          <Detail label={t('settings.f.slug')}>
            <a href={`/s/${store.slug}`} target="_blank" rel="noreferrer" className="text-brand underline" dir="ltr">{window.location.host}/s/{store.slug}</a>
          </Detail>
          <Detail label={t('settings.waLabel')}>
            <span className="inline-flex flex-wrap items-center gap-2">
              <WhatsAppIcon size={16} className="text-whatsapp" />
              <span className="whitespace-nowrap">{pretty(store.whatsapp_number)}</span>
              {store.whatsapp_verified && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                  <BadgeCheck size={12} /> {t('settings.verified')}
                </span>
              )}
            </span>
          </Detail>
        </dl>
        <SupportNote store={store} />
      </Section>

      <Section title={t('loc.title')}>
        <AddressPicker value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} error={fields.lat || fields.address_text} />
        {input('city', { placeholder: t('settings.p.city'), maxLength: 60 })}
        <div>
          <label className="label" htmlFor="st-order_language">{t('settings.orderLanguage')}</label>
          <select id="st-order_language" className="input" value={form.order_language} onChange={set('order_language')}>
            <option value="auto">{t('settings.orderLanguageAuto')}</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name} — {l.english}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-stone-400">{t('settings.orderLanguageHint')}</p>
        </div>
      </Section>

      <Section title={t('setup.moreTitle')}>
        {!appointments && (
          <div className="space-y-3 rounded-2xl border border-stone-200 p-4">
            <p className="label mb-0">{t('settings.deliveryTitle')}</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={freeDelivery} onChange={(e) => setFreeDelivery(e.target.checked)} />
              {t('settings.freeDelivery')}
            </label>
            {!freeDelivery && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="st-delivery_fee">{t('settings.f.delivery_fee')} <span className="text-rose-500">*</span></label>
                  <input id="st-delivery_fee" className="input" type="number" min={1} step="1" inputMode="numeric" value={form.delivery_fee} onChange={set('delivery_fee')} required />
                  {fields.delivery_fee && <p className="mt-1 text-xs text-rose-600">{fields.delivery_fee}</p>}
                </div>
                {input('free_delivery_above', { type: 'number', min: 0, inputMode: 'numeric', hint: t('settings.h.free_delivery_above') })}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-4">
          {imagePicker('logo_url', t('settings.logo'), logoRef, 'h-24 w-24 rounded-2xl')}
          <div className="flex-1">{imagePicker('banner_url', t('settings.banner'), bannerRef, 'h-24 w-full rounded-2xl')}</div>
        </div>
        {!canUpload && <p className="-mt-2 text-[11px] text-stone-500">{t('pf.uploadPaid')}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          {input('opening_hours', { placeholder: '09:00-21:00', hint: t('settings.h.opening_hours'), maxLength: 11 })}
          {input('closed_days', { placeholder: 'Sun', maxLength: 40 })}
          {!appointments && input('minimum_order', { type: 'number', min: 0, inputMode: 'numeric' })}
          {input('instagram_handle', { placeholder: 'yourstore', maxLength: 31 })}
          {input('theme_color', { type: 'color' })}
          {input('description', { textarea: true, maxLength: 500, wide: true })}
        </div>

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
      </Section>

      {status.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{status.error}</p>}
      <button disabled={status.busy || !!uploading} className="btn-brand w-full">
        {status.busy ? <Loader2 size={16} className="animate-spin" /> : status.saved ? <Check size={16} /> : <Save size={16} />}
        {status.saved ? t('common.saved') : t('settings.save')}
      </button>
    </form>
    </div>
  );
}
