import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Mail, Search, Sprout, Store } from 'lucide-react';
import BusinessTypePicker from '../components/BusinessTypePicker.jsx';
import ClaimShop, { ClaimSent } from '../components/ClaimShop.jsx';
import MobileInput, { isMobile10 } from '../components/MobileInput.jsx';
import OtpField from '../components/OtpField.jsx';
import GoogleSignIn from '../components/GoogleSignIn.jsx';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { rich, useI18n, useT } from '../i18n/index.jsx';
import { storeNameError } from '../i18n/errors.js';
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

function AuthShell({ isRegister, children, onSubmit, extra, title, subtitle }) {
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
          <h1 className="text-xl font-bold">{title || (isRegister ? t('owner.registerTitle') : t('nav.ownerLogin'))}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {subtitle || (isRegister ? t('owner.registerSubtitle', { limit: appConfig.freeSkuLimit }) : t('owner.loginSubtitle'))}
          </p>
        </div>
        {children}
      </form>
      <AuthLinks isRegister={isRegister}>{extra}</AuthLinks>
    </div>
  );
}

/** The second section under the sign-in card: other ways in, login/register switch, shop link, privacy. */
function AuthLinks({ isRegister, children }) {
  const t = useT();
  return (
    <div className="mt-3 w-full max-w-sm space-y-4 rounded-2xl border border-stone-200/80 bg-white/70 p-5 text-center">
      {children}
      <p className="text-sm text-stone-600">
        {isRegister
          ? rich(t('owner.alreadyRegistered'), { link: (x) => <Link to="/login" className="font-semibold text-brand">{x}</Link> })
          : rich(t('owner.newHere'), { link: (x) => <Link to="/register" className="font-semibold text-brand">{x}</Link> })}
      </p>
      <div className="space-y-1.5 border-t border-stone-200/80 pt-3">
        <p className="text-xs text-stone-500">
          {rich(t('owner.shopInstead'), { link: (x) => <Link to="/stores" className="underline">{x}</Link> })}
        </p>
        <p className="text-[11px] text-stone-400">
          {rich(t('owner.consent'), { link: (x) => <a href="/privacy" target="_blank" rel="noopener" className="underline">{x}</a> })}
        </p>
      </div>
    </div>
  );
}

/**
 * Google (icon button) or email + code. Existing account → dashboard; new account → store name + type (asked up front
 * on /register, after sign-in on /login). "I don't have a Google account" opens the email + code form.
 */
function EmailOwnerAuth({ mode }) {
  const isRegister = mode === 'register';
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { owner, loadOwner, authOwnerEmail, authOwnerGoogle, appConfig } = useSession();
  const [form, setForm] = useState({ storeName: '', email: '', code: '', businessType: 'shop' });
  const [needsStore, setNeedsStore] = useState(false); // signed in, new account: ask for the store
  const [googleCredential, setGoogleCredential] = useState(''); // kept to finish a Google sign-up with the store
  const [emailChosen, setEmailChosen] = useState(false); // "I don't have a Google account"
  const [googleDown, setGoogleDown] = useState(false); // Google couldn't load (offline / blocked)
  // "My shop is already listed": find a seeded listing and claim it instead of creating a store. A listing's
  // "Claim it free" link opens /register?claim=<slug>.
  const [params] = useSearchParams();
  const claimSlug = params.get('claim') || '';
  const [claimMode, setClaimMode] = useState(Boolean(claimSlug));
  const [claim, setClaim] = useState(null); // { claim, fresh }: the request just sent, or one still open
  const [googleEmail, setGoogleEmail] = useState(''); // the Google account's email, for the claim screens
  const emailForm = emailChosen || googleDown || !appConfig.googleClientId;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const submitted = useRef(false);
  const askStore = (isRegister || needsStore) && !claimMode;
  const showGoogleUnavailable = useCallback(() => setGoogleDown(true), []);

  useEffect(() => {
    if (owner === undefined) loadOwner();
    else if (owner && !submitted.current) navigate('/merchant', { replace: true });
  }, [owner, loadOwner, navigate]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: typeof e === 'string' ? e : e.target.value }));
  const storeBody = () => (askStore && form.storeName.trim().length >= 2 && form.businessType ? { storeName: form.storeName.trim(), businessType: form.businessType } : {});

  /** Runs a sign-in call; handles "new account, tell us the store" and errors. */
  const run = async (call) => {
    setError('');
    setFields({});
    setBusy(true);
    submitted.current = true;
    try {
      const r = await call();
      if (r.needsStore) {
        submitted.current = false;
        setNeedsStore(true);
        if (r.email) setGoogleEmail(r.email);
        if (r.claim) return setClaim({ claim: r.claim, fresh: false });
        if (isRegister && !claimMode) setFields({ storeName: storeNameError(t, form.storeName), businessType: form.businessType ? undefined : t('biz.pickType') });
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

  const onGoogle = (credential) => {
    setGoogleCredential(credential);
    run(() => authOwnerGoogle({ credential, ...storeBody() }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (needsStore && (claimMode || claim)) return; // the claim screens have their own buttons
    if (needsStore && !form.businessType) return setFields({ businessType: t('biz.pickType') });
    if (needsStore && storeNameError(t, form.storeName)) return setFields({ storeName: storeNameError(t, form.storeName) });
    if (googleCredential) return run(() => authOwnerGoogle({ credential: googleCredential, ...storeBody() }));
    if (!isEmail(form.email)) return setFields({ email: t('errors.validEmail') });
    // On /register the store fields are filled first; they're only used if the email is new.
    return run(() => authOwnerEmail({ email: form.email.trim().toLowerCase(), code: form.code, ...storeBody() }));
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
  const showSubmit = needsStore ? !claimMode && !claim : emailForm;
  const signedInEmail = googleEmail || form.email.trim().toLowerCase();
  // Back from the claim screens to "create a new store". A claim just sent used up the email code: sign in again.
  const leaveClaim = () => {
    if (claim?.fresh && !googleCredential) setNeedsStore(false);
    setClaim(null);
    setClaimMode(false);
  };
  const claimCallout = (
    <div className="rounded-xl border border-lime-200 bg-lime-50 p-3 text-sm text-lime-950">
      <p className="flex items-center gap-1.5 font-bold"><Sprout size={16} className="flex-none" /> {t('claim.ctaTitle')}</p>
      <p className="mt-0.5 text-lime-900">{t('claim.ctaBody', { brand: PLATFORM.name })}</p>
      <button type="button" onClick={() => setClaimMode(true)} className="mt-2 inline-flex items-center gap-1 font-bold text-lime-800 underline">
        <Search size={14} /> {t('claim.ctaButton')}
      </button>
    </div>
  );

  return (
    <AuthShell
      isRegister={isRegister || needsStore}
      onSubmit={submit}
      title={claimMode || claim ? t('claim.confirmTitle') : undefined}
      subtitle={claimMode || claim ? t('claim.ctaBody', { brand: PLATFORM.name }) : undefined}
      extra={
        !needsStore && appConfig.googleClientId && !emailForm && (
          <button type="button" onClick={() => setEmailChosen(true)} className="btn-ghost w-full py-2.5 text-sm">
            <Mail size={16} /> {t('auth.noGoogle')}
          </button>
        )
      }
    >
      {claim ? (
        <ClaimSent claim={claim.claim} email={signedInEmail} fresh={claim.fresh} onNewStore={leaveClaim} />
      ) : needsStore && claimMode ? (
        <ClaimShop
          proof={googleCredential ? { credential: googleCredential } : { email: signedInEmail, code: form.code }}
          initialSlug={claimSlug}
          onClaimed={(c) => {
            setClaim({ claim: c, fresh: true });
            if (!googleCredential) setForm((f) => ({ ...f, code: '' }));
          }}
          onNewStore={() => setClaimMode(false)}
        />
      ) : (
        <>
          {needsStore && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t('owner.newStoreBody')}</p>}
          {(isRegister || needsStore) && !claimMode && claimCallout}
          {claimMode && (
            <p className="rounded-lg bg-lime-50 px-3 py-2 text-sm text-lime-950">
              {t('claim.signInFirst')}{' '}
              <button type="button" onClick={() => setClaimMode(false)} className="font-semibold underline">{t('claim.newStoreInstead')}</button>
            </p>
          )}
        </>
      )}
      {askStore && !claim && storeFields}
      {!needsStore && appConfig.googleClientId && (
        <GoogleSignIn clientId={appConfig.googleClientId} onCredential={onGoogle} onUnavailable={showGoogleUnavailable} lang={lang} />
      )}
      {!needsStore && emailForm && (
        <>
          <div>
            <label className="label" htmlFor="owner-email">{t('auth.email')}</label>
            <div className="relative" dir="ltr">
              <Mail size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
              <input maxLength={254}
                id="owner-email"
                className="input ps-9"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={form.email}
                onChange={set('email')}
                required
                autoFocus={Boolean(appConfig.googleClientId)}
              />
            </div>
            <p className="mt-1 text-[11px] text-stone-400">{t('owner.emailHint')}</p>
            {fieldError('email')}
          </div>
          <OtpField email={form.email} purpose="owner_login" code={form.code} onCode={set('code')} name={form.storeName || undefined} />
          {fieldError('code')}
        </>
      )}
      {busy && !showSubmit && <Loader2 className="mx-auto animate-spin text-brand" />}
      {error && !Object.values(fields).some(Boolean) && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {showSubmit && (
        <button disabled={busy || (!googleCredential && form.code.length !== 6)} className="btn-brand w-full py-3">
          {busy && <Loader2 size={16} className="animate-spin" />}
          {needsStore || (isRegister && form.storeName) ? t('owner.createStore') : t('auth.continue')}
        </button>
      )}
    </AuthShell>
  );
}

/** OWNER_LOGIN=mobile: registration (store name + mobile + OTP) and login (mobile + OTP). */
function MobileOwnerAuth({ mode }) {
  const isRegister = mode === 'register';
  const t = useT();
  const navigate = useNavigate();
  const { owner, loadOwner, appConfig, registerOwner, loginOwner } = useSession();
  const [form, setForm] = useState({ storeName: '', phone: '', code: '', businessType: 'shop' });
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
    if (isRegister && storeNameError(t, form.storeName)) return setFields({ storeName: storeNameError(t, form.storeName) });
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
          <BusinessTypePicker value={form.businessType} onChange={(v) => setForm((f) => ({ ...f, businessType: v }))} error={fields.businessType} />
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
      </form>
      <AuthLinks isRegister={isRegister} />
    </div>
  );
}
