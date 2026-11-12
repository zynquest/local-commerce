import { useEffect, useState } from 'react';
import { Loader2, Mail, Store, X } from 'lucide-react';
import BusinessTypePicker from '../components/BusinessTypePicker.jsx';
import { post } from '../lib/api.js';

const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

/** Opens the owner screens for the store just created (an owner session in admin mode). */
const goToOwnerScreens = () => window.location.assign('/merchant');

/**
 * Platform admin: create a store for an owner, the same way they would sign up. The code goes to the owner's email;
 * they read it out, which proves the email is theirs. Then the owner screens open on the setup wizard (admin mode),
 * and the store goes through the normal review once it is submitted.
 */
export default function AdminNewStore({ onClose }) {
  const [form, setForm] = useState({ email: '', storeName: '', businessType: 'shop', code: '' });
  const [sentTo, setSentTo] = useState('');
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }));
  const email = form.email.trim().toLowerCase();

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const fail = (err) => {
    setError(err.message);
    setFields(err.fields || {});
  };

  const sendCode = async () => {
    setFields({});
    setError('');
    if (!isEmail(email)) return setFields({ email: 'Enter a valid email address' });
    if (form.storeName.trim().length < 2) return setFields({ storeName: form.storeName.trim() ? 'Store name is too short' : 'Store name is mandatory' });
    setBusy('send');
    try {
      const r = await post('/platform/owners/otp', { email, storeName: form.storeName.trim() });
      setSentTo(email);
      setDevCode(r.devCode || '');
      setForm((f) => ({ ...f, code: '' }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy('');
    }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!sentTo) return sendCode();
    setFields({});
    setError('');
    if (!/^\d{6}$/.test(form.code.trim())) return setFields({ code: 'Enter the 6-digit code' });
    setBusy('create');
    try {
      await post('/platform/stores/new', { email: sentTo, code: form.code.trim(), storeName: form.storeName.trim(), businessType: form.businessType });
      goToOwnerScreens();
    } catch (err) {
      fail(err);
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="New store">
      <form onSubmit={create} className="max-h-[92vh] w-full max-w-md animate-fade-up space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Store size={20} className="text-brand" /> New store</h2>
          <button type="button" onClick={onClose} disabled={!!busy} className="rounded-full p-1.5 hover:bg-stone-100" aria-label="Close"><X size={18} /></button>
        </div>
        <p className="text-sm text-stone-600">
          Same as the owner signing up: a code goes to <b>their</b> email and they read it out to you. Then the setup steps open as the owner, and the store comes back to you for approval once it's submitted.
        </p>

        <div>
          <label className="label" htmlFor="ns-email">Owner's email (their login)</label>
          <input id="ns-email" type="email" inputMode="email" autoComplete="off" maxLength={120} className="input" value={form.email} onChange={(e) => { set('email')(e); setSentTo(''); }} disabled={!!busy} />
          {fields.email && <p className="mt-1 text-xs text-rose-600">{fields.email}</p>}
        </div>
        <BusinessTypePicker value={form.businessType} onChange={set('businessType')} disabled={!!busy} name="ns-type" />
        <div>
          <label className="label" htmlFor="ns-name">{form.businessType === 'appointments' ? 'Business name' : 'Store name'}</label>
          <input id="ns-name" maxLength={60} autoComplete="off" className="input" value={form.storeName} onChange={set('storeName')} disabled={!!busy} />
          {fields.storeName && <p className="mt-1 text-xs text-rose-600">{fields.storeName}</p>}
        </div>

        {sentTo ? (
          <div className="space-y-2 rounded-2xl bg-emerald-50 p-4">
            <p className="flex items-start gap-2 text-sm text-emerald-900">
              <Mail size={16} className="mt-0.5 flex-none" /> <span>Code sent to <b className="break-all">{sentTo}</b>. Ask the owner for it.</span>
            </p>
            {devCode && <p className="text-xs text-emerald-800">Local test code: <b className="font-mono">{devCode}</b></p>}
            <label className="label" htmlFor="ns-code">6-digit code</label>
            <input
              id="ns-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="input text-center font-mono text-lg tracking-[0.4em]"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, '') }))}
              disabled={busy === 'create'}
              autoFocus
            />
            {fields.code && <p className="text-xs text-rose-600">{fields.code}</p>}
            <button type="button" onClick={sendCode} disabled={!!busy} className="text-xs font-semibold text-emerald-800 underline">
              {busy === 'send' ? 'Sending…' : 'Send a new code'}
            </button>
          </div>
        ) : null}

        {error && !Object.keys(fields).length && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <button type="submit" disabled={!!busy} className="btn-brand w-full">
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          {sentTo ? 'Create store and open setup' : 'Send code to owner'}
        </button>
      </form>
    </div>
  );
}
