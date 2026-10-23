import { useState } from 'react';
import { Loader2, Mail, UserRound, X } from 'lucide-react';
import OtpField from './OtpField.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { rich, useT } from '../i18n/index.jsx';

const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim());

/** Optional shopper login / sign-up with email + OTP. Guests can always skip it. */
export default function CustomerAuthModal({ onClose, initialMode = 'login' }) {
  const t = useT();
  const { loginCustomer, registerCustomer } = useSession();
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: '', email: '', code: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isEmail(form.email)) return setError(t('errors.validEmail'));
    const email = form.email.trim().toLowerCase();
    setBusy(true);
    try {
      if (mode === 'login') await loginCustomer({ email, code: form.code });
      else await registerCustomer({ name: form.name, email, code: form.code });
      onClose();
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
            <UserRound size={20} className="text-brand" /> {mode === 'login' ? t('auth.login') : t('auth.createAccount')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-full p-1.5 hover:bg-stone-100">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-stone-500">{t('auth.optionalHint')}</p>
        {mode === 'register' && (
          <input className="input" placeholder={t('cart.yourName')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" required />
        )}
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
        <OtpField
          email={form.email}
          purpose={mode === 'login' ? 'customer_login' : 'customer_register'}
          code={form.code}
          onCode={(code) => setForm((f) => ({ ...f, code }))}
          name={mode === 'register' ? form.name : undefined}
        />
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <p className="text-center text-[11px] text-stone-400">
          {rich(t('owner.consent'), { link: (x) => <a href="/privacy" target="_blank" rel="noopener" className="underline">{x}</a> })}
        </p>
        <button disabled={busy || form.code.length !== 6 || (mode === 'register' && !form.name.trim())} className="btn-brand w-full">
          {busy && <Loader2 size={16} className="animate-spin" />}
          {mode === 'login' ? t('auth.login') : t('auth.signUp')}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
          className="w-full text-center text-sm text-stone-600"
        >
          {mode === 'login'
            ? rich(t('auth.newHere'), { b: (x) => <b className="text-brand">{x}</b> })
            : rich(t('auth.haveAccount'), { b: (x) => <b className="text-brand">{x}</b> })}
        </button>
      </form>
    </div>
  );
}
