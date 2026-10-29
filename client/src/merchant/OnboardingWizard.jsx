import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import AddressPicker from '../components/AddressPicker.jsx';
import BusinessTypePicker from '../components/BusinessTypePicker.jsx';
import MobileInput, { isMobile10 } from '../components/MobileInput.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { categoriesFor, slugify } from '../businessCategories.js';
import { PLATFORM } from '../config.js';
import { LANGUAGES } from '../i18n/languages.js';
import { useI18n } from '../i18n/index.jsx';
import { del, get, post, put } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';
import { whatsappLink } from '../services/whatsappService.js';
import { DAYS, DEFAULT_SCHEDULE, ScheduleEditor } from './SpecialistsPanel.jsx';

const national = (n) => (n ? String(n).replace(/^91(?=\d{10}$)/, '') : '');
const pretty = (n) => (n ? `+91 ${national(n).slice(0, 5)} ${national(n).slice(5)}` : '—');
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DURATIONS = [10, 15, 20, 30, 45, 60, 75, 90, 120];
// The pages that add catalog items, and the API list each one edits.
const ITEM_API = { product: 'products', services: 'services', team: 'specialists' };
const EMPTY_ITEM = { name: '', mrp: '', offer_price: '', duration_min: 30, price: '' };
const EMPTY_MEMBER = { name: '', title: '', schedule: DEFAULT_SCHEDULE };

/** Support contact shown wherever locked details are mentioned. */
export function SupportNote({ store }) {
  const { t } = useI18n();
  const phone = `+91 ${PLATFORM.whatsappNumber.slice(2, 7)} ${PLATFORM.whatsappNumber.slice(7)}`;
  const msg = t('setup.supportMsg', { name: store.name, link: `${window.location.origin}/s/${store.slug}` });
  return (
    <div className="space-y-2 rounded-xl bg-stone-100 px-3 py-2.5 text-xs text-stone-700">
      <p className="flex gap-2">
        <Lock size={14} className="mt-0.5 flex-none text-stone-500" />
        <span>{t('setup.lockedNote', { phone })}</span>
      </p>
      <a href={whatsappLink(PLATFORM.whatsappNumber, msg)} target="_blank" rel="noopener noreferrer" className="ms-6 inline-flex items-center gap-1 font-semibold text-emerald-700 underline">
        <WhatsAppIcon size={14} /> {t('setup.contactSupport')}
      </a>
    </div>
  );
}

const Field = ({ id, label, required, error, hint, children }) => (
  <div>
    {label && (
      <label className="label" htmlFor={id}>
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </label>
    )}
    {children}
    {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : hint && <p className="mt-1 text-[11px] text-stone-400">{hint}</p>}
  </div>
);

const ReadOnly = ({ label, value }) => (
  <div>
    <p className="label">{label}</p>
    <p className="rounded-xl bg-stone-50 px-3 py-2.5 text-sm font-semibold break-words text-stone-700">{value || '—'}</p>
  </div>
);

/**
 * New store setup, one page at a time, ending with "Submit for approval". Shown while the store is a draft or after
 * the team asked for changes. Each Next saves that page, so the owner can leave and come back where they stopped.
 */
export default function OnboardingWizard({ store, onStoreChange, onCatalogChange }) {
  const { t, formatDate, dayName } = useI18n();
  const { owner, appConfig } = useSession();
  const locked = store.details_locked;
  const appt = store.business_type === 'appointments';
  const steps = appt ? ['business', 'contact', 'location', 'services', 'team', 'submit'] : ['business', 'contact', 'location', 'product', 'submit'];
  const done = Object.fromEntries(store.checklist.map((c) => [c.key, c.done]));

  const [form, setForm] = useState(() => ({
    business_type: store.business_type || 'shop',
    category: store.category || '',
    name: store.name || '',
    slug: store.slug || '',
    whatsapp: national(store.whatsapp_number),
    order_language: store.order_language || 'auto',
    address_text: store.address_text || '',
    city: store.city || '',
    lat: store.lat ?? null,
    lng: store.lng ?? null,
    maps_url: store.maps_url || '',
    place_id: store.place_id || '',
    note: '',
  }));
  const [item, setItem] = useState(EMPTY_ITEM);
  const [member, setMember] = useState(EMPTY_MEMBER);
  const [list, setList] = useState({ items: [], loading: false }); // what the product / service / team page has added
  const [editing, setEditing] = useState(null); // null | 'new' | the product, service or team member being edited
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const firstOpen = () => {
    const complete = {
      business: Boolean(store.business_type && store.category && store.name),
      contact: Boolean(store.slug && store.whatsapp_number),
      location: Boolean(done.location && store.city),
      product: Boolean(done.products),
      services: Boolean(done.services),
      team: Boolean(done.specialists),
    };
    const i = steps.findIndex((s) => s !== 'submit' && !complete[s]);
    return i === -1 ? steps.length - 1 : i;
  };
  const [step, setStep] = useState(firstOpen);
  const key = steps[Math.min(step, steps.length - 1)];

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const categories = useMemo(() => categoriesFor(form.business_type), [form.business_type]);

  const go = (i) => {
    setErrors({});
    // Coming to the link page with an untouched link that doesn't follow the (possibly edited) name: suggest one.
    if (steps[i] === 'contact' && !locked && !slugTouched) {
      const s = slugify(form.name);
      if (s && !form.slug.startsWith(s)) setForm((f) => ({ ...f, slug: s }));
    }
    setStep(i);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Runs a save; field errors from the server land next to their fields. Returns true when it went through. */
  const save = async (fn) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      return true;
    } catch (err) {
      setErrors({ ...(err.fields || {}), _: err.fields && Object.keys(err.fields).length ? '' : err.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const loadList = useCallback(async (k) => {
    const r = await get(`/merchant/${ITEM_API[k]}`);
    const items = (r.products || r.services || r.specialists || []).filter((x) => k !== 'product' || x.status === 'active');
    setList({ items, loading: false });
    return items;
  }, []);

  // Entering a product / service / team page: show what's there; with nothing yet, open the form straight away.
  useEffect(() => {
    if (!ITEM_API[key]) return;
    let live = true;
    setList({ items: [], loading: true });
    setEditing(null);
    loadList(key)
      .then((items) => live && setEditing(items.length ? null : 'new'))
      .catch(() => live && (setList({ items: [], loading: false }), setEditing('new')));
    return () => {
      live = false;
    };
  }, [key, loadList]);

  const startNew = () => {
    setItem(EMPTY_ITEM);
    setMember(EMPTY_MEMBER);
    setErrors({});
    setEditing('new');
  };
  const startEdit = (x) => {
    setErrors({});
    if (key === 'product') setItem({ ...EMPTY_ITEM, name: x.name, mrp: String(x.mrp), offer_price: String(x.offer_price) });
    if (key === 'services') setItem({ ...EMPTY_ITEM, name: x.name, duration_min: x.duration_min, price: String(x.price) });
    if (key === 'team') setMember({ name: x.name, title: x.title || '', schedule: x.schedule });
    setEditing(x);
  };
  const formFilled = () =>
    key === 'team' ? Boolean(member.name.trim()) : Boolean(item.name.trim() || item.price !== '' || (key === 'product' && (item.mrp !== '' || item.offer_price !== '')));

  /** Adds the new item or saves the one being edited. Returns true when saved. */
  const saveItem = async () => {
    if (key === 'product' && (!item.name.trim() || item.mrp === '' || item.offer_price === '')) return setErrors({ _: t('setup.needProduct') }), false;
    if (key === 'services' && (!item.name.trim() || item.price === '')) return setErrors({ _: t('setup.needService') }), false;
    if (key === 'team' && (!member.name.trim() || !Object.values(member.schedule).some((r) => r.length))) return setErrors({ _: t('setup.needTeam') }), false;
    const isNew = editing === 'new';
    return save(async () => {
      if (key === 'product') {
        // An edit sends the whole product back (photos, description…), with the new name and prices.
        const body = { ...(isNew ? {} : editing), name: item.name.trim(), mrp: Number(item.mrp), offer_price: Number(item.offer_price) };
        if (isNew) await post('/merchant/products', body);
        else await put(`/merchant/products/${editing.id}`, body);
      } else if (key === 'services') {
        const body = { category: '', description: '', active: true, ...(isNew ? {} : editing), name: item.name.trim(), duration_min: Number(item.duration_min), price: Number(item.price) };
        if (isNew) await post('/merchant/services', body);
        else await put(`/merchant/services/${editing.id}`, body);
      } else {
        const serviceIds = isNew ? (await get('/merchant/services')).services.filter((sv) => sv.active).map((sv) => sv.id) : editing.service_ids;
        const body = { name: member.name.trim(), title: member.title.trim(), schedule: member.schedule, service_ids: serviceIds, active: isNew ? true : editing.active, ...(isNew || !editing.photo_url ? {} : { photo_url: editing.photo_url }) };
        if (isNew) await post('/merchant/specialists', body);
        else await put(`/merchant/specialists/${editing.id}`, body);
      }
      await loadList(key);
      await onCatalogChange();
      setItem(EMPTY_ITEM);
      setMember(EMPTY_MEMBER);
      setEditing(null);
    });
  };

  const removeItem = async (x) => {
    if (!window.confirm(t('setup.confirmRemove', { name: x.name }))) return;
    await save(async () => {
      await del(`/merchant/${ITEM_API[key]}/${x.id}`);
      const items = await loadList(key);
      await onCatalogChange();
      if (editing && editing !== 'new' && editing.id === x.id) setEditing(null);
      if (!items.length) startNew();
    });
  };

  const saveStore = async (body) => {
    const { store: s } = await put('/merchant/store', body);
    onStoreChange(s);
    return s;
  };

  const next = async () => {
    const e = {};
    if (key === 'business' && locked) return go(step + 1);
    if (key === 'business') {
      if (!form.category.trim()) e.category = t('setup.pickCategory');
      if (form.name.trim().length < 2) e.name = t('errors.storeNameShort');
      if (Object.keys(e).length) return setErrors(e);
      const ok = await save(() => saveStore({ business_type: form.business_type, category: form.category.trim(), name: form.name.trim() }));
      if (ok) go(step + 1);
      return;
    }
    if (key === 'contact') {
      if (!locked && !SLUG_RE.test(form.slug)) e.slug = t('setup.linkInvalid');
      if (!locked && !isMobile10(form.whatsapp)) e.whatsapp_number = t('errors.validMobile10');
      if (Object.keys(e).length) return setErrors(e);
      const ok = await save(async () => {
        if (!locked && national(store.whatsapp_number) !== form.whatsapp) {
          const { store: s } = await put('/merchant/store/whatsapp', { phone: form.whatsapp });
          onStoreChange(s);
        }
        await saveStore({ order_language: form.order_language, ...(locked ? {} : { slug: form.slug }) });
      });
      if (ok) go(step + 1);
      return;
    }
    if (key === 'location') {
      if (form.lat == null || form.lng == null) e.lat = t('setup.needPin');
      if (!form.city.trim()) e.city = t('setup.needCity');
      if (Object.keys(e).length) return setErrors(e);
      const { address_text, city, lat, lng, maps_url, place_id } = form;
      const ok = await save(() => saveStore({ address_text, city: city.trim(), lat, lng, maps_url, place_id }));
      if (ok) go(step + 1);
      return;
    }
    if (ITEM_API[key]) {
      // An open form with something typed in is saved first; an empty one is just left behind.
      if (editing && formFilled()) {
        if (await saveItem()) go(step + 1);
        return;
      }
      if (list.items.length) return go(step + 1);
      return setErrors({ _: t(key === 'product' ? 'setup.needProduct' : key === 'services' ? 'setup.needService' : 'setup.needTeam') });
    }
  };

  const approvalLink = (s) =>
    whatsappLink(
      PLATFORM.whatsappNumber,
      t(s.business_type === 'appointments' ? 'review.waApprovalMsgAppt' : 'review.waApprovalMsg', { brand: PLATFORM.name, name: s.name, link: `${window.location.origin}/s/${s.slug}`, phone: pretty(s.whatsapp_number), email: owner?.email || '—' }),
    );

  const submit = async () => {
    // WhatsApp is opened from the click itself (phones block pop-ups opened later), then pointed at the message.
    const win = window.open('', '_blank');
    const ok = await save(async () => {
      const { store: s } = await post('/merchant/store/submit', { note: form.note.trim() || undefined, whatsapp_number: form.whatsapp || undefined });
      onStoreChange(s);
      const url = approvalLink(s);
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else window.location.href = url;
    });
    if (!ok) win?.close();
  };

  const host = window.location.host;

  const title = t(`setup.steps.${key}`);
  const isResubmit = store.status === 'rejected' || store.status === 'suspended';

  return (
    <section className="space-y-3" aria-label={t('review.title')}>
      {step === 0 && !isResubmit && <p className="text-sm text-stone-600">{t('setup.intro')}</p>}
      {store.review_remarks && isResubmit && (
        <div className="card border-rose-200 bg-rose-50 p-4 text-sm">
          <p className="text-[11px] font-bold tracking-wide text-rose-800 uppercase">{t('review.remarks')}</p>
          <p className="mt-1 whitespace-pre-line text-stone-800">{store.review_remarks}</p>
        </div>
      )}

      <div className="card overflow-visible">
        <div className="space-y-2 border-b border-stone-100 p-4">
          <p className="text-xs font-semibold text-stone-500">{t('setup.stepOf', { n: step + 1, total: steps.length })}</p>
          <div className="flex gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand' : 'bg-stone-200'}`} />
            ))}
          </div>
          <h2 className="text-lg font-bold">{title}</h2>
        </div>

        <div className="space-y-4 p-4">
          {key === 'business' && (
            <>
              {locked && <SupportNote store={store} />}
              <BusinessTypePicker
                value={form.business_type}
                disabled={locked}
                onChange={(v) => setForm((f) => ({ ...f, business_type: v, category: categoriesFor(v).includes(f.category) || !categoriesFor(f.business_type).includes(f.category) ? f.category : '' }))}
              />
              {locked ? (
                <>
                  <ReadOnly label={t('settings.f.category')} value={form.category} />
                  <ReadOnly label={form.business_type === 'appointments' ? t('biz.businessName') : t('owner.storeName')} value={form.name} />
                </>
              ) : (
                <>
                  <Field id="wz-category" label={t('settings.f.category')} required error={errors.category}>
                    <SearchSelect
                      id="wz-category"
                      value={form.category}
                      onChange={(v) => {
                        setForm((f) => ({ ...f, category: v }));
                        setErrors((x) => ({ ...x, category: undefined }));
                      }}
                      options={categories}
                      placeholder={form.business_type === 'appointments' ? t('setup.serviceTypeSearch') : t('setup.storeTypeSearch')}
                      customLabel={(text) => t('setup.useCustom', { text })}
                      invalid={!!errors.category}
                      maxLength={40}
                    />
                  </Field>
                  <Field id="wz-name" label={form.business_type === 'appointments' ? t('biz.businessName') : t('owner.storeName')} required error={errors.name}>
                    <input id="wz-name" className="input" value={form.name} onChange={set('name')} maxLength={60} />
                  </Field>
                </>
              )}
            </>
          )}

          {key === 'contact' && (
            <>
              {locked ? (
                <>
                  <SupportNote store={store} />
                  <ReadOnly label={t('settings.f.slug')} value={`${host}/s/${form.slug}`} />
                  <ReadOnly label={t('review.waLabel')} value={pretty(store.whatsapp_number)} />
                </>
              ) : (
                <>
                  <Field id="wz-slug" label={t('settings.f.slug')} required error={errors.slug} hint={t('setup.linkHint')}>
                    <div className="flex items-stretch overflow-hidden rounded-xl border border-stone-200 focus-within:border-brand" dir="ltr">
                      <span className="flex items-center bg-stone-50 px-3 text-sm text-stone-500">{host}/s/</span>
                      <input
                        id="wz-slug"
                        className="min-w-0 flex-1 px-3 py-2.5 text-sm outline-none"
                        value={form.slug}
                        onChange={(e) => {
                          setSlugTouched(true);
                          setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') }));
                        }}
                        maxLength={60}
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                    </div>
                  </Field>
                  {appConfig.ownerLogin === 'mobile' && store.whatsapp_verified ? (
                    <ReadOnly label={t('review.waLabel')} value={pretty(store.whatsapp_number)} />
                  ) : (
                    <MobileInput id="wz-whatsapp" value={form.whatsapp} onChange={set('whatsapp')} label={t('review.waLabel')} hint={t('review.waHint')} error={errors.whatsapp_number} />
                  )}
                </>
              )}
              <Field id="wz-lang" label={`${t('settings.orderLanguage')} (${t('common.optional')})`} hint={t('settings.orderLanguageHint')}>
                <select id="wz-lang" className="input" value={form.order_language} onChange={set('order_language')}>
                  <option value="auto">{t('settings.orderLanguageAuto')}</option>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.name} — {l.english}</option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {key === 'location' && (
            <div className="space-y-4">
              <AddressPicker value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} error={errors.lat || errors.address_text} />
              <Field id="wz-city" label={t('settings.f.city')} required error={errors.city}>
                <input id="wz-city" className="input" value={form.city} onChange={set('city')} placeholder={t('settings.p.city')} maxLength={60} />
              </Field>
            </div>
          )}

          {ITEM_API[key] && (
            <>
              <p className="text-sm text-stone-600">{t(key === 'product' ? 'setup.productHint' : key === 'services' ? 'setup.serviceHint' : 'setup.teamHint')}</p>
              {key === 'product' && list.items.length > 0 && (
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <CheckCircle2 size={16} /> {t('setup.productsAdded', { count: list.items.length })}
                </p>
              )}
              {list.loading && <Loader2 className="mx-auto animate-spin text-stone-400" />}
              {list.items.length > 0 && (
                <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200">
                  {list.items.map((x) => (
                    <li key={x.id} className={`flex items-center gap-2 px-3 py-2.5 ${editing?.id === x.id ? 'bg-emerald-50' : ''}`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold break-words">{x.name}</p>
                        <p className="text-xs text-stone-500">
                          {key === 'product' && (
                            <>
                              {formatMoney(x.offer_price, store.currency_symbol)}
                              {x.mrp > x.offer_price && <span className="ms-1 line-through">{formatMoney(x.mrp, store.currency_symbol)}</span>}
                            </>
                          )}
                          {key === 'services' && `${t('appt.minutes', { count: x.duration_min })} · ${formatMoney(x.price, store.currency_symbol)}`}
                          {key === 'team' && [x.title, DAYS.filter((d) => x.schedule?.[d]?.length).map((d) => dayName(d, 'short')).join(' ')].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <button type="button" onClick={() => startEdit(x)} disabled={busy} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label={`${t('common.edit')}: ${x.name}`}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" onClick={() => removeItem(x)} disabled={busy} className="rounded-lg p-2 text-stone-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`${t('common.remove')}: ${x.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {!editing && !list.loading && (
                <button type="button" onClick={startNew} className="btn-ghost text-sm"><Plus size={16} /> {t('setup.addAnother')}</button>
              )}

              {editing && (
                <div className="space-y-3 rounded-2xl border-2 border-brand/30 p-3 sm:p-4">
                  {list.items.length > 0 && (
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold">{editing === 'new' ? t('setup.addAnother') : `${t('common.edit')}: ${editing.name}`}</p>
                      <button type="button" onClick={() => setEditing(null)} className="p-1 text-stone-400" aria-label={t('common.cancel')}><X size={16} /></button>
                    </div>
                  )}
                  {key === 'product' && (
                    <>
                      <Field id="wz-pname" label={t('pf.name')} required>
                        <input id="wz-pname" className="input" value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} placeholder={t('pf.namePlaceholder')} maxLength={100} />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field id="wz-mrp" label={t('pf.mrp')} required error={errors.mrp}>
                          <input id="wz-mrp" className="input" type="number" min="0" inputMode="decimal" value={item.mrp} onChange={(e) => setItem({ ...item, mrp: e.target.value })} />
                        </Field>
                        <Field id="wz-price" label={t('setup.listPrice')} required error={errors.offer_price}>
                          <input id="wz-price" className="input" type="number" min="0" inputMode="decimal" value={item.offer_price} onChange={(e) => setItem({ ...item, offer_price: e.target.value })} />
                        </Field>
                      </div>
                    </>
                  )}
                  {key === 'services' && (
                    <>
                      <Field id="wz-sname" label={t('appt.serviceName')} required>
                        <input id="wz-sname" className="input" value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} placeholder={t('appt.serviceNamePlaceholder')} maxLength={80} />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field id="wz-duration" label={t('appt.duration')} required>
                          <select id="wz-duration" className="input" value={item.duration_min} onChange={(e) => setItem({ ...item, duration_min: e.target.value })}>
                            {[...new Set([...DURATIONS, Number(item.duration_min)])].sort((a, b) => a - b).map((m) => (
                              <option key={m} value={m}>{m < 60 || m % 60 ? t('appt.minutes', { count: m }) : t('appt.hours', { count: m / 60 })}</option>
                            ))}
                          </select>
                        </Field>
                        <Field id="wz-sprice" label={t('appt.price')} required error={errors.price}>
                          <input id="wz-sprice" className="input" type="number" min="0" inputMode="decimal" value={item.price} onChange={(e) => setItem({ ...item, price: e.target.value })} placeholder="300" />
                        </Field>
                      </div>
                    </>
                  )}
                  {key === 'team' && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field id="wz-mname" label={t('appt.specialistName')} required>
                          <input id="wz-mname" className="input" value={member.name} onChange={(e) => setMember({ ...member, name: e.target.value })} maxLength={60} />
                        </Field>
                        <Field id="wz-mtitle" label={`${t('appt.specialistTitle')} (${t('common.optional')})`}>
                          <input id="wz-mtitle" className="input" value={member.title} onChange={(e) => setMember({ ...member, title: e.target.value })} placeholder={t('appt.specialistTitlePlaceholder')} maxLength={80} />
                        </Field>
                      </div>
                      <div>
                        <p className="label">{t('appt.workingHours')} <span className="text-rose-500">*</span></p>
                        <ScheduleEditor value={member.schedule} onChange={(schedule) => setMember({ ...member, schedule })} />
                      </div>
                      {editing === 'new' && <p className="text-[11px] text-stone-500">{t('setup.teamAllServices')}</p>}
                    </>
                  )}
                  {list.items.length > 0 && (
                    <button type="button" onClick={saveItem} disabled={busy} className="btn-brand w-full">
                      {busy && <Loader2 size={16} className="animate-spin" />} {t('common.save')}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {key === 'submit' && (
            <>
              <p className="text-sm text-stone-600">{t('setup.reviewHint')}</p>
              <dl className="divide-y divide-stone-100 rounded-2xl border border-stone-200 text-sm">
                {[
                  [t('biz.question'), t(form.business_type === 'appointments' ? 'biz.appointments' : 'biz.shop'), 0],
                  [t('settings.f.category'), store.category, 0],
                  [form.business_type === 'appointments' ? t('biz.businessName') : t('owner.storeName'), store.name, 0],
                  [t('settings.f.slug'), `${host}/s/${store.slug}`, 1],
                  [t('review.waLabel'), pretty(store.whatsapp_number), 1],
                  [t('loc.address'), [store.address_text, store.city].filter(Boolean).join(', '), 2],
                  ...(appt
                    ? [[t('merchant.tabs.services'), done.services ? '✓' : '—', 3], [t('merchant.tabs.specialists'), done.specialists ? '✓' : '—', 4]]
                    : [[t('merchant.tabs.products'), String(store.sku_used), 3]]),
                ].map(([label, value, target]) => (
                  <div key={label} className="flex items-start gap-3 px-3 py-2.5">
                    <dt className="w-28 flex-none text-xs font-semibold text-stone-500 sm:w-36">{label}</dt>
                    <dd className="min-w-0 flex-1 font-medium break-words">{value || '—'}</dd>
                    <button type="button" onClick={() => go(target)} className="flex-none text-stone-400 hover:text-brand" aria-label={`${t('common.edit')}: ${label}`}>
                      <Pencil size={14} />
                    </button>
                  </div>
                ))}
              </dl>
              <Field id="wz-note" label={`${t('setup.noteLabel')} (${t('common.optional')})`}>
                <textarea maxLength={500}
                  id="wz-note"
                  className="input"
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value.slice(0, 500) }))}
                  placeholder={isResubmit ? t('review.notePlaceholderResubmit') : ''}
                />
              </Field>
              {store.submitted_at && store.status === 'rejected' && (
                <p className="text-[11px] text-stone-400">{t('setup.lastSubmitted', { date: formatDate(store.submitted_at) })}</p>
              )}
            </>
          )}

          {errors._ && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{errors._}</p>}
        </div>

        <div className="flex gap-2 border-t border-stone-100 p-4">
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1)} disabled={busy} className="btn-ghost">
              <ArrowLeft size={16} className="rtl:rotate-180" /> {t('setup.back')}
            </button>
          )}
          {key === 'submit' ? (
            <button type="button" onClick={submit} disabled={busy} className="btn-brand flex-1">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <WhatsAppIcon size={16} />}
              {isResubmit ? t('review.resubmit') : t('review.submit')}
            </button>
          ) : (
            <button type="button" onClick={next} disabled={busy} className="btn-brand flex-1">
              {busy && <Loader2 size={16} className="animate-spin" />}
              {t('setup.next')} <ArrowRight size={16} className="rtl:rotate-180" />
            </button>
          )}
        </div>
        {key === 'submit' && <p className="px-4 pb-4 text-center text-[11px] text-stone-500">{t('review.sendOnWhatsApp')}</p>}
      </div>
    </section>
  );
}
