import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, Loader2, Mail, ShoppingBag, Store } from 'lucide-react';
import MobileInput, { isMobile10 } from '../components/MobileInput.jsx';
import OtpField from '../components/OtpField.jsx';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { rich, useT } from '../i18n/index.jsx';
import { PLATFORM } from '../config.js';
import { useSeo } from '../lib/seo.js';

const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim());

/**
 * Store-owner sign-up and login, no passwords.
 *   OWNER_LOGIN=email (default): email + emailed code; one flow for both — an existing account logs in, a new email
 *     gives the store name and type (asked up front on /register, after the code on /login).
 *   OWNER_LOGIN=mobile: store name + mobile + OTP to register, mobile + OTP to log in.
 */
export default function OwnerAuth({ mode }) {
  const { appConfig } = useSession();
  return appConfig.ownerLogin === 'mobile' ? <MobileOwnerAuth mode={mode} /> : <EmailOwnerAuth mode={mode} />;
}

function BusinessTypePicker({ value, onChange, error }) {
  const t = useT();
  return (
    <fieldset>
      <legend className="label">{t('biz.question')}</legend>
      <div className="grid grid-cols-2 gap-2">
        {[
          ['shop', ShoppingBag, 'biz.shop', 'biz.shopHint'],
          ['appointments', CalendarClock, 'biz.appointments', 'biz.appointmentsHint'],
        ].map(([v, Icon, title, hint]) => (
          <label
            key={v}
            className={`flex cursor-pointer flex-col gap-1 rounded-2xl border-2 p-3 text-sm ${value === v ? 'border-brand bg-emerald-50' : 'border-stone-200 hover:border-stone-300'}`}
          >
            <input type="radio" name="businessType" value={v} checked={value === v} onChange={() => onChange(v)} className="sr-only" />
            <Icon size={20} className={value === v ? 'text-brand' : 'text-stone-500'} />
            <span className="font-bold">{t(title)}</span>
            <span className="text-[11px] leading-snug text-stone-500">{t(hint)}</span>
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </fieldset>
  );
}

function AuthShell({ isRegister, children, onSubmit }) {
  const t = useT();
  const { appConfig } = useSession();
  useSeo({
    title: isRegister ? t('owner.seoRegister', { brand: PLATFORM.name }) : t('owner.seoLogin', { brand: PLATFORM.name }),
    description: t('owner.seoDesc'),
    path: isRegister ? '/register' : undefined,
    image: '/og-image.png',
    noindex: !isRegister,
    localized: true,
  });
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-emerald-50 to-stone-50 px-4 py-10">
      <LanguageSwitcher className="absolute top-4 end-4" />
      <Link to="/" className="mb-6 flex items-center gap-2 text-lg font-extrabold">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
          <Store size={20} />
        </span>
        {PLATFORM.name}
      </Link>
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-6 shadow-sm" noValidate>
        <div>
          <p className="text-[11px] font-bold tracking-wider text-brand uppercase">{t('nav.forOwners')}</p>
          <h1 className="text-xl font-bold">{isRegister ? t('owner.registerTitle') : t('nav.ownerLogin')}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {isRegister ? t('owner.registerSubtitle', { limit: appConfig.freeSkuLimit }) : t('owner.loginSubtitle')}
          </p>
        </div>
        {children}
        <p className="text-center text-sm text-stone-600">
          {isRegister
            ? rich(t('owner.alreadyRegistered'), { link: (x) => <Link to="/login" className="font-semibold text-brand">{x}</Link> })
            : rich(t('owner.newHere'), { link: (x) => <Link to="/register" className="font-semibold text-brand">{x}</Link> })}
        </p>
        <p className="text-center text-xs text-stone-400">
          {rich(t('owner.shopInstead'), { link: (x) => <Link to="/stores" className="underline">{x}</Link> })}
        </p>
        <p className="text-center text-[11px] text-stone-400">
          {rich(t('owner.consent'), { link: (x) => <a href="/privacy" target="_blank" rel="noopener" className="underline">{x}</a> })}
        </p>
      </form>
    </div>
  );
}

/** Email + code. Existing account → dashboard; new email → store name + type (up front on /register). */
function EmailOwnerAuth({ mode }) {
  const isRegister = mode === 'register';
  const t = useT();
  const navigate = useNavigate();
  const { owner, loadOwner, authOwnerEmail } = useSession();
  const [form, setForm] = useState({ storeName: '', email: '', code: '', businessType: '' });
  const [needsStore, setNeedsStore] = useState(false); // code verified, new email: ask for the store
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const submitted = useRef(false);
  const askStore = isRegister || needsStore;

  useEffect(() => {
    if (owner === undefined) loadOwner();
    else if (owner && !submitted.current) navigate('/merchant', { replace: true });
  }, [owner, loadOwner, navigate]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: typeof e === 'string' ? e : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setFields({});
    if (!isEmail(form.email)) return setFields({ email: t('errors.validEmail') });
    // On /register the store fields are filled first; they're only used if the email is new.
    const withStore = askStore && form.storeName.trim().length >= 2 && form.businessType;
    if (needsStore && !form.businessType) return setFields({ businessType: t('biz.pickType') });
    if (needsStore && form.storeName.trim().length < 2) return setFields({ storeName: t('errors.storeNameShort') });
    setBusy(true);
    submitted.current = true;
    try {
      const r = await authOwnerEmail({
        email: form.email.trim().toLowerCase(),
        code: form.code,
        ...(withStore ? { storeName: form.storeName.trim(), businessType: form.businessType } : {}),
      });
      if (r.needsStore) {
        submitted.current = false;
        setNeedsStore(true);
        if (isRegister) setFields({ storeName: form.storeName.trim().length < 2 ? t('errors.storeNameShort') : undefined, businessType: form.businessType ? undefined : t('biz.pickType') });
        return;
      }
      navigate(r.created ? '/merchant?welcome=1' : '/merchant', { replace: true });
    } catch (err) {
      submitted.current = false;
      setError(err.message);
      setFields(err.fields || {});
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (k) => fields[k] && <p className="mt-1 text-xs text-rose-600">{fields[k]}</p>;
  const storeFields = (
    <>
      <BusinessTypePicker value={form.businessType} onChange={(v) => setForm((f) => ({ ...f, businessType: v }))} error={fields.businessType} />
      <div>
        <label className="label" htmlFor="storeName">{form.businessType === 'appointments' ? t('biz.businessName') : t('owner.storeName')}</label>
        <input id="storeName" className="input" value={form.storeName} onChange={set('storeName')} placeholder={form.businessType === 'appointments' ? 'Glow Hair & Beauty Studio' : 'Gupta Kirana Store'} maxLength={60} required autoFocus={needsStore} />
        {fieldError('storeName')}
      </div>
    </>
  );

  return (
    <AuthShell isRegister={isRegister || needsStore} onSubmit={submit}>
      {needsStore && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t('owner.newStoreBody')}</p>}
      {askStore && storeFields}
      {!needsStore && (
        <>
          <div>
            <label className="label" htmlFor="owner-email">{t('auth.email')}</label>
            <div className="relative" dir="ltr">
              <Mail size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
              <input
                id="owner-email"
                className="input ps-9"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={form.email}
                onChange={set('email')}
                required
              />
            </div>
            <p className="mt-1 text-[11px] text-stone-400">{t('owner.emailHint')}</p>
            {fieldError('email')}
          </div>
          <OtpField email={form.email} purpose="owner_login" code={form.code} onCode={set('code')} name={form.storeName || undefined} />
          {fieldError('code')}
        </>
      )}
      {error && !Object.values(fields).some(Boolean) && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button disabled={busy || form.code.length !== 6} className="btn-brand w-full py-3">
        {busy && <Loader2 size={16} className="animate-spin" />}
        {needsStore || (isRegister && form.storeName) ? t('owner.createStore') : t('auth.continue')}
      </button>
    </AuthShell>
  );
}

/** OWNER_LOGIN=mobile: registration (store name + mobile + OTP) and login (mobile + OTP). */
function MobileOwnerAuth({ mode }) {
  const isRegister = mode === 'register';
  const t = useT();
  const navigate = useNavigate();
  const { owner, loadOwner, appConfig, registerOwner, loginOwner } = useSession();
  const [form, setForm] = useState({ storeName: '', phone: '', code: '', businessType: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const submitted = useRef(false); // submit() navigates itself; skip the already-logged-in redirect

  useSeo({
    title: isRegister ? t('owner.seoRegister', { brand: PLATFORM.name }) : t('owner.seoLogin', { brand: PLATFORM.name }),
    description: t('owner.seoDesc'),
    path: isRegister ? '/register' : undefined,
    image: '/og-image.png',
    noindex: !isRegister,
    localized: true,
  });

  useEffect(() => {
    if (owner === undefined) loadOwner();
    else if (owner && !submitted.current) navigate('/merchant', { replace: true });
  }, [owner, loadOwner, navigate]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: typeof v === 'string' ? v : v.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setFields({});
    if (isRegister && !form.businessType) return setFields({ businessType: t('biz.pickType') });
    if (isRegister && form.storeName.trim().length < 2) return setFields({ storeName: t('errors.storeNameShort') });
    if (!isMobile10(form.phone)) return setFields({ phone: t('errors.validMobile10') });
    setBusy(true);
    submitted.current = true;
    try {
      if (isRegister) await registerOwner({ storeName: form.storeName, phone: form.phone, code: form.code, businessType: form.businessType });
      else await loginOwner({ phone: form.phone, code: form.code });
      navigate(isRegister ? '/merchant?welcome=1' : '/merchant', { replace: true });
    } catch (err) {
      submitted.current = false;
      setError(err.message);
      setFields(err.fields || {});
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (k) => fields[k] && <p className="mt-1 text-xs text-rose-600">{fields[k]}</p>;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-emerald-50 to-stone-50 px-4 py-10">
      <LanguageSwitcher className="absolute top-4 end-4" />
      <Link to="/" className="mb-6 flex items-center gap-2 text-lg font-extrabold">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
          <Store size={20} />
        </span>
        {PLATFORM.name}
      </Link>
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6 shadow-sm" noValidate>
        <div>
          <p className="text-[11px] font-bold tracking-wider text-brand uppercase">{t('nav.forOwners')}</p>
          <h1 className="text-xl font-bold">{isRegister ? t('owner.registerTitle') : t('nav.ownerLogin')}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {isRegister ? t('owner.registerSubtitle', { limit: appConfig.freeSkuLimit }) : t('owner.loginSubtitle')}
          </p>
        </div>

        {isRegister && (
          <fieldset>
            <legend className="label">{t('biz.question')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['shop', ShoppingBag, 'biz.shop', 'biz.shopHint'],
                ['appointments', CalendarClock, 'biz.appointments', 'biz.appointmentsHint'],
              ].map(([value, Icon, title, hint]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer flex-col gap-1 rounded-2xl border-2 p-3 text-sm ${form.businessType === value ? 'border-brand bg-emerald-50' : 'border-stone-200 hover:border-stone-300'}`}
                >
                  <input type="radio" name="businessType" value={value} checked={form.businessType === value} onChange={() => setForm((f) => ({ ...f, businessType: value }))} className="sr-only" />
                  <Icon size={20} className={form.businessType === value ? 'text-brand' : 'text-stone-500'} />
                  <span className="font-bold">{t(title)}</span>
                  <span className="text-[11px] leading-snug text-stone-500">{t(hint)}</span>
                </label>
              ))}
            </div>
            {fieldError('businessType')}
          </fieldset>
        )}

        {isRegister && (
          <div>
            <label className="label" htmlFor="storeName">{form.businessType === 'appointments' ? t('biz.businessName') : t('owner.storeName')}</label>
            <input id="storeName" className="input" value={form.storeName} onChange={set('storeName')} placeholder={form.businessType === 'appointments' ? 'Glow Hair & Beauty Studio' : 'Gupta Kirana Store'} maxLength={60} required />
            {fieldError('storeName')}
          </div>
        )}

        <MobileInput
          value={form.phone}
          onChange={set('phone')}
          error={fields.phone}
          label={t('auth.mobile10')}
          hint={isRegister ? t('owner.phoneHintOtp') : t('owner.loginHint')}
        />
        <OtpField
          phone={form.phone}
          purpose={isRegister ? 'owner_register' : 'owner_login'}
          code={form.code}
          onCode={set('code')}
          name={isRegister ? form.storeName : undefined}
        />
        {fieldError('code')}

        {error && !Object.keys(fields).length && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <button disabled={busy || form.code.length !== 6} className="btn-brand w-full py-3">
          {busy && <Loader2 size={16} className="animate-spin" />}
          {isRegister ? t('owner.createStore') : t('auth.login')}
        </button>
        <p className="text-center text-sm text-stone-600">
          {isRegister
            ? rich(t('owner.alreadyRegistered'), { link: (x) => <Link to="/login" className="font-semibold text-brand">{x}</Link> })
            : rich(t('owner.newHere'), { link: (x) => <Link to="/register" className="font-semibold text-brand">{x}</Link> })}
        </p>
        <p className="text-center text-xs text-stone-400">
          {rich(t('owner.shopInstead'), { link: (x) => <Link to="/stores" className="underline">{x}</Link> })}
        </p>
        <p className="text-center text-[11px] text-stone-400">
          {rich(t('owner.consent'), { link: (x) => <a href="/privacy" target="_blank" rel="noopener" className="underline">{x}</a> })}
        </p>
      </form>
    </div>
  );
}
