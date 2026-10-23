import { useState } from 'react';
import { Loader2, Mail, UserRound, X } from 'lucide-react';
import MobileInput, { isMobile10 } from './MobileInput.jsx';
import OtpField from './OtpField.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { rich, useT } from '../i18n/index.jsx';

const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim());

/**
 * Optional shopper sign-in, one flow for new and returning shoppers: email (or mobile, per the server's
 * CUSTOMER_LOGIN) → code → if the account exists they're in, otherwise we ask for a name and create it.
 * Guests can always skip it.
 */
export default function CustomerAuthModal({ onClose }) {
  const t = useT();
  const { authCustomer, appConfig } = useSession();
  const byEmail = appConfig.customerLogin !== 'mobile';
  const [form, setForm] = useState({ name: '', email: '', phone: '', code: '' });
  const [needsName, setNeedsName] = useState(false); // code verified, no account yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (byEmail && !isEmail(form.email)) return setError(t('errors.validEmail'));
    if (!byEmail && !isMobile10(form.phone)) return setError(t('errors.validMobile10'));
    const identity = byEmail ? { email: form.email.trim().toLowerCase() } : { phone: form.phone };
    setBusy(true);
    try {
      const r = await authCustomer({ ...identity, code: form.code, ...(needsName ? { name: form.name.trim() } : {}) });
      if (r.needsName) setNeedsName(true);
      else onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-sm animate-fade-up space-y-3 overflow-y-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl" noValidate>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <UserRound size={20} className="text-brand" /> {needsName ? t('auth.createAccount') : t('account.loginOrSignup')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-full p-1.5 hover:bg-stone-100">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-stone-500">{t('auth.optionalHint')}</p>

        {needsName ? (
          <>
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t('auth.newAccountName')}</p>
            <input className="input" placeholder={t('cart.yourName')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" autoFocus required />
          </>
        ) : (
          <>
            {!byEmail && <MobileInput id="customer-phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} label={t('auth.mobile10')} />}
            {byEmail && (
              <div>
                <label className="label" htmlFor="customer-email">{t('auth.email')}</label>
                <div className="relative" dir="ltr">
                  <Mail size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
                  <input
                    id="customer-email"
                    className="input ps-9"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </div>
              </div>
            )}
            <OtpField {...(byEmail ? { email: form.email } : { phone: form.phone })} purpose="customer_login" code={form.code} onCode={(code) => setForm((f) => ({ ...f, code }))} />
          </>
        )}

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <p className="text-center text-[11px] text-stone-400">
          {rich(t('owner.consent'), { link: (x) => <a href="/privacy" target="_blank" rel="noopener" className="underline">{x}</a> })}
        </p>
        <button disabled={busy || form.code.length !== 6 || (needsName && !form.name.trim())} className="btn-brand w-full">
          {busy && <Loader2 size={16} className="animate-spin" />}
          {needsName ? t('auth.createAccount') : t('auth.continue')}
        </button>
      </form>
    </div>
  );
}
