import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Store } from 'lucide-react';
import MobileInput, { isMobile10 } from '../components/MobileInput.jsx';
import OtpField from '../components/OtpField.jsx';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { rich, useT } from '../i18n/index.jsx';
import { PLATFORM } from '../config.js';
import { useSeo } from '../lib/seo.js';

/** Store-owner registration (store name + mobile + OTP) and login (mobile + OTP). No passwords. */
export default function OwnerAuth({ mode }) {
  const isRegister = mode === 'register';
  const t = useT();
  const navigate = useNavigate();
  const { owner, loadOwner, appConfig, registerOwner, loginOwner } = useSession();
  const [form, setForm] = useState({ storeName: '', phone: '', code: '' });
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
    if (isRegister && form.storeName.trim().length < 2) return setFields({ storeName: t('errors.storeNameShort') });
    if (!isMobile10(form.phone)) return setFields({ phone: t('errors.validMobile10') });
    setBusy(true);
    submitted.current = true;
    try {
      if (isRegister) await registerOwner({ storeName: form.storeName, phone: form.phone, code: form.code });
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
          <div>
            <label className="label" htmlFor="storeName">{t('owner.storeName')}</label>
            <input id="storeName" className="input" value={form.storeName} onChange={set('storeName')} placeholder="Gupta Kirana Store" maxLength={60} required />
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
      </form>
    </div>
  );
}
