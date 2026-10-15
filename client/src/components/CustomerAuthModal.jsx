import { useState } from 'react';
import { Loader2, UserRound, X } from 'lucide-react';
import MobileInput, { isMobile10 } from './MobileInput.jsx';
import OtpField from './OtpField.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { rich, useT } from '../i18n/index.jsx';

/** Optional shopper login / sign-up with a 10-digit mobile + OTP. Guests can always skip it. */
export default function CustomerAuthModal({ onClose, initialMode = 'login' }) {
  const t = useT();
  const { loginCustomer, registerCustomer } = useSession();
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: '', phone: '', code: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isMobile10(form.phone)) return setError(t('errors.validMobile10'));
    setBusy(true);
    try {
      if (mode === 'login') await loginCustomer({ phone: form.phone, code: form.code });
      else await registerCustomer({ name: form.name, phone: form.phone, code: form.code });
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
        <MobileInput id="customer-phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} label={t('auth.mobile10')} />
        <OtpField
          phone={form.phone}
          purpose={mode === 'login' ? 'customer_login' : 'customer_register'}
          code={form.code}
          onCode={(code) => setForm((f) => ({ ...f, code }))}
          name={mode === 'register' ? form.name : undefined}
        />
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
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
