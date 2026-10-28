import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useSession } from '../context/SessionContext.jsx';
import { useSeo } from '../lib/seo.js';

/** Platform admin sign-in. Not linked from any public page; the account is created via CLI only. */
export default function AdminLogin() {
  const navigate = useNavigate();
  const { admin, loadAdmin, loginAdmin } = useSession();
  const [form, setForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useSeo({ title: 'Admin', noindex: true });

  useEffect(() => {
    if (admin === undefined) loadAdmin();
    else if (admin) navigate('/motiveboss', { replace: true });
  }, [admin, loadAdmin, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await loginAdmin(form);
      setForm({ username: '', password: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-900 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
        <div className="text-center">
          <ShieldCheck size={36} className="mx-auto text-brand" />
          <h1 className="mt-2 text-lg font-bold">Platform Admin</h1>
          <p className="text-xs text-stone-500">Authorised personnel only. Sessions expire after 12 hours.</p>
        </div>
        <input className="input" placeholder="Username" autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        <input className="input" type="password" placeholder="Password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <button disabled={busy} className="btn-brand w-full">
          {busy && <Loader2 size={16} className="animate-spin" />} Sign in
        </button>
      </form>
    </div>
  );
}
