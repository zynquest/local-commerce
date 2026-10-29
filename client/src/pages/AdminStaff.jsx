import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Plus, RefreshCw, Trash2, UserPlus, Users, X } from 'lucide-react';
import MobileInput, { isMobile10 } from '../components/MobileInput.jsx';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { del, get, post } from '../lib/api.js';
import { whatsappLink } from '../services/whatsappService.js';

const ago = (d) => {
  if (!d) return 'never';
  const mins = Math.round((Date.now() - new Date(d)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

/** The sign-in details to hand to a staff member (shown once, after creating or resetting). */
function Credentials({ creds, onClose }) {
  const [copied, setCopied] = useState(false);
  const login = `${window.location.origin}/motiveboss/login`;
  const text = `Vocal For Local staff login\n${login}\nUsername: ${creds.username}\nPassword: ${creds.password}\nYour sales rep ID: ${creds.rep_code}\n(Shop owners enter this ID when they submit their store for approval.)`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* copy blocked: the details are on screen */
    }
  };
  return (
    <div className="card space-y-3 border-2 border-emerald-300 bg-emerald-50 p-4">
      <div className="flex items-center justify-between">
        <p className="font-bold text-emerald-900">{creds.reset ? 'New password' : 'Staff member added'}</p>
        <button onClick={onClose} className="p-1 text-stone-500" aria-label="Close"><X size={18} /></button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-stone-500">Username</dt>
        <dd className="font-mono font-semibold break-all">{creds.username}</dd>
        <dt className="text-stone-500">Password</dt>
        <dd className="font-mono font-semibold break-all">{creds.password}</dd>
        <dt className="text-stone-500">Sales rep ID</dt>
        <dd className="font-mono text-base font-bold tracking-widest">{creds.rep_code}</dd>
      </dl>
      <p className="text-xs text-emerald-900">This password is shown only now. Copy it or send it to them, then close this box.</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={copy} className="btn-brand py-1.5 text-sm">{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy details'}</button>
        {creds.phone && (
          <a href={whatsappLink(creds.phone, text)} target="_blank" rel="noopener noreferrer" className="btn-whatsapp py-1.5 text-sm">
            <WhatsAppIcon size={15} /> Send on WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Platform admin: staff (sales reps). Each gets a username, a generated password and a 6-character rep ID (capital
 * letters and digits, not editable). Staff sign in at /motiveboss and can only approve or reject the stores
 * submitted with their ID.
 */
export default function AdminStaff() {
  const [data, setData] = useState({ loading: true, staff: [], error: '' });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ username: '', name: '', phone: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [creds, setCreds] = useState(null);

  const load = useCallback(async () => {
    setData((d) => ({ ...d, loading: true }));
    try {
      const r = await get('/platform/staff');
      setData({ loading: false, staff: r.staff, error: '' });
    } catch (err) {
      setData((d) => ({ ...d, loading: false, error: err.message }));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    if (form.phone && !isMobile10(form.phone)) return setError('Enter a valid 10-digit mobile, or leave it empty');
    setBusy('create');
    setError('');
    try {
      const r = await post('/platform/staff', { username: form.username.trim(), name: form.name.trim() || undefined, phone: form.phone || undefined });
      setCreds({ ...r.staff, password: r.password });
      setForm({ username: '', name: '', phone: '' });
      setAdding(false);
      await load();
    } catch (err) {
      setError(err.fields?.username || err.fields?.phone || err.message);
    } finally {
      setBusy('');
    }
  };

  const reset = async (s) => {
    if (!window.confirm(`Make a new password for ${s.username}? They are signed out and need the new one.`)) return;
    setBusy(`reset:${s.id}`);
    try {
      const r = await post(`/platform/staff/${s.id}/reset-password`, {});
      setCreds({ ...s, password: r.password, reset: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const remove = async (s) => {
    if (!window.confirm(`Delete ${s.name || s.username} (${s.rep_code})? They can't sign in any more. Stores they brought in keep the ID.`)) return;
    setBusy(`del:${s.id}`);
    try {
      await del(`/platform/staff/${s.id}`);
      if (creds?.id === s.id) setCreds(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Users size={20} className="text-brand" /> Staff</h2>
          <div className="flex gap-2">
            <button onClick={load} className="btn-ghost px-3" aria-label="Refresh"><RefreshCw size={16} className={data.loading ? 'animate-spin' : ''} /></button>
            {!adding && (
              <button onClick={() => setAdding(true)} className="btn-brand"><UserPlus size={16} /> Add staff</button>
            )}
          </div>
        </div>
        <p className="text-sm text-stone-600">
          Sales reps sign in at <b>/motiveboss</b> with the username and password made here. Shop owners enter the rep's ID when they submit for approval;
          the rep then sees only those requests and can approve or reject them.
        </p>
      </div>

      {creds && <Credentials creds={creds} onClose={() => setCreds(null)} />}

      {adding && (
        <form onSubmit={create} className="card space-y-3 p-4" noValidate>
          <div className="flex items-center justify-between">
            <h3 className="font-bold">New staff member</h3>
            <button type="button" onClick={() => setAdding(false)} className="p-1 text-stone-400" aria-label="Cancel"><X size={18} /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="st-username">Username <span className="text-rose-500">*</span></label>
              <input id="st-username" className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s+/g, '') })} maxLength={32} autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="ravi.k" />
              <p className="mt-1 text-[11px] text-stone-400">3–32 letters, digits, dot, dash or underscore.</p>
            </div>
            <div>
              <label className="label" htmlFor="st-name">Name (optional)</label>
              <input id="st-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} placeholder="Ravi Kumar" />
            </div>
            <div className="sm:col-span-2">
              <MobileInput id="st-phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} label="Mobile number (optional)" />
            </div>
            <div>
              <p className="label">Password</p>
              <p className="rounded-xl bg-stone-50 px-3 py-2.5 text-sm text-stone-500">Generated when you save</p>
            </div>
            <div>
              <p className="label">Sales rep ID</p>
              <p className="rounded-xl bg-stone-50 px-3 py-2.5 text-sm text-stone-500">6 letters/digits, generated when you save</p>
            </div>
          </div>
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <button disabled={busy === 'create' || form.username.trim().length < 3} className="btn-brand w-full">
            {busy === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Create staff login
          </button>
        </form>
      )}

      {!adding && error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {data.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{data.error}</p>}

      <ul className="card divide-y divide-stone-100">
        {data.staff.map((s) => (
          <li key={s.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <div className="flex-none rounded-xl bg-stone-900 px-3 py-2 text-center">
              <p className="text-[9px] font-semibold tracking-wide text-stone-400 uppercase">ID</p>
              <p className="font-mono text-sm font-bold tracking-widest text-white">{s.rep_code}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words">{s.name || s.username}</p>
              <p className="text-xs text-stone-500">
                @{s.username}{s.phone ? ` · +${s.phone.slice(0, 2)} ${s.phone.slice(2, 7)} ${s.phone.slice(7)}` : ''} · last sign-in {ago(s.last_login_at)}
              </p>
              <p className="text-xs text-stone-500">
                {s.stores} store{s.stores === 1 ? '' : 's'} brought in{s.pending ? <b className="text-amber-700"> · {s.pending} waiting</b> : ''}
              </p>
            </div>
            <div className="col-span-2 flex justify-end gap-1 sm:col-span-1">
              <button onClick={() => reset(s)} disabled={!!busy} className="btn-ghost py-1.5 text-xs" title="New password">
                {busy === `reset:${s.id}` ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Reset password
              </button>
              <button onClick={() => remove(s)} disabled={!!busy} className="rounded-lg p-2 text-stone-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${s.username}`}>
                {busy === `del:${s.id}` ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              </button>
            </div>
          </li>
        ))}
        {data.loading && !data.staff.length && <li className="flex justify-center p-6"><Loader2 className="animate-spin text-stone-400" /></li>}
        {!data.loading && !data.staff.length && (
          <li className="p-10 text-center text-sm text-stone-500">
            <Users size={32} className="mx-auto mb-2 text-stone-300" />
            No staff yet. Add your first sales rep.
          </li>
        )}
      </ul>
    </div>
  );
}
