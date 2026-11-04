import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Inbox, Loader2, Mail, RefreshCw, Sprout, X } from 'lucide-react';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { get, post } from '../lib/api.js';
import { whatsappLink } from '../services/whatsappService.js';

const ago = (d) => {
  if (!d) return '';
  const mins = Math.round((Date.now() - new Date(d)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const FILTERS = [
  ['pending', 'Waiting'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
];
const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-stone-100 text-stone-600',
};

function ClaimCard({ claim: c, onChanged }) {
  const [rejecting, setRejecting] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const act = async (action) => {
    if (action === 'approve' && !window.confirm(`Hand "${c.store_name}" to ${c.email} (WhatsApp +${c.phone})? They can then log in and take orders.`)) return;
    setBusy(action);
    setError('');
    try {
      await post(`/platform/claims/${c.id}/${action}`, action === 'reject' ? { remarks } : undefined);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <li className="space-y-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <span className="break-words">{c.store_name}</span>
            <a href={`/s/${c.store_slug}`} target="_blank" rel="noopener" className="text-stone-400 hover:text-stone-700" aria-label="Open listing"><ExternalLink size={14} /></a>
          </p>
          <p className="text-xs text-stone-500">
            {[c.store_category, c.store_locality, c.store_city].filter(Boolean).join(' · ') || '—'}
            {c.store_seed_phone && ` · listed phone ${c.store_seed_phone}`}
          </p>
          {c.store_address && <p className="text-xs text-stone-400">{c.store_address}</p>}
        </div>
        <span className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[c.status]}`}>
          {c.status === 'pending' ? 'Waiting' : c.status[0].toUpperCase() + c.status.slice(1)}
        </span>
      </div>
      <div className="grid gap-1 rounded-xl bg-stone-50 p-3 text-sm sm:grid-cols-3">
        <p><span className="text-xs text-stone-500">Code</span><br /><b className="font-mono tracking-wider">{c.code}</b></p>
        <p className="min-w-0"><span className="text-xs text-stone-500">Login email</span><br /><span className="flex items-center gap-1 break-all"><Mail size={13} className="flex-none text-stone-400" /> {c.email}</span></p>
        <p>
          <span className="text-xs text-stone-500">WhatsApp for orders</span><br />
          <a href={whatsappLink(c.phone)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-emerald-700">
            <WhatsAppIcon size={14} /> +{c.phone}
          </a>
        </p>
      </div>
      <p className="text-[11px] text-stone-400">
        Asked {ago(c.created_at)}
        {c.decided_at && ` · decided ${ago(c.decided_at)}${c.decided_by_username ? ` by ${c.decided_by_username}` : ''}`}
      </p>
      {c.remarks && <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">{c.remarks}</p>}
      {c.status === 'pending' && c.other_pending > 0 && (
        <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle size={14} className="flex-none" /> {c.other_pending} other {c.other_pending === 1 ? 'person also claims' : 'people also claim'} this shop. Approving this one rejects the others.
        </p>
      )}
      {c.status === 'pending' && (
        <>
          <p className="text-xs text-stone-500">
            Approve only after the owner sent, from <b>+{c.phone}</b> and quoting <b className="font-mono">{c.code}</b>: a photo of them at the shop with its name board, and one shop document.
          </p>
          {rejecting && (
            <textarea
              maxLength={1000}
              rows={2}
              className="input"
              placeholder="Reason, emailed to the owner (min 5 characters)"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              autoFocus
            />
          )}
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {!rejecting && (
              <button onClick={() => act('approve')} disabled={Boolean(busy)} className="btn-brand">
                {busy === 'approve' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Approve and hand over
              </button>
            )}
            {rejecting ? (
              <>
                <button onClick={() => act('reject')} disabled={Boolean(busy) || remarks.trim().length < 5} className="btn bg-rose-600 text-white hover:bg-rose-700">
                  {busy === 'reject' && <Loader2 size={16} className="animate-spin" />} Reject claim
                </button>
                <button onClick={() => setRejecting(false)} className="btn-ghost">Cancel</button>
              </>
            ) : (
              <button onClick={() => setRejecting(true)} disabled={Boolean(busy)} className="btn-ghost text-rose-700"><X size={16} /> Reject</button>
            )}
          </div>
        </>
      )}
    </li>
  );
}

/** Owners' requests to claim seeded listings: check the proof on WhatsApp, then approve (hand-over) or reject. */
export default function AdminClaims({ onChanged }) {
  const [filter, setFilter] = useState('pending');
  const [state, setState] = useState({ loading: true, claims: [], error: '' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const { claims } = await get(`/platform/claims?status=${filter}`);
      setState({ loading: false, claims, error: '' });
    } catch (err) {
      setState({ loading: false, claims: [], error: err.message });
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = () => {
    load();
    onChanged?.();
  };

  return (
    <div className="space-y-3">
      <p className="rounded-2xl bg-white px-4 py-3 text-sm text-stone-600 shadow-sm ring-1 ring-stone-200">
        <Sprout size={15} className="me-1 inline text-lime-700" />
        Owners who found their shop among the seeded listings. Each one messages the platform WhatsApp with their claim code and proof.
        Approving hands the listing to their login email and WhatsApp number.
      </p>
      <div className="flex items-center gap-2">
        <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`flex flex-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${filter === k ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700'}`}
            >
              {k === 'pending' && <Inbox size={14} />} {label}
            </button>
          ))}
        </div>
        <button onClick={load} className="btn-ghost px-3" aria-label="Refresh"><RefreshCw size={16} className={state.loading ? 'animate-spin' : ''} /></button>
      </div>
      {state.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>}
      <ul className="card divide-y divide-stone-100">
        {state.claims.map((c) => <ClaimCard key={c.id} claim={c} onChanged={changed} />)}
        {state.loading && !state.claims.length && <li className="flex justify-center p-8"><Loader2 className="animate-spin text-stone-400" /></li>}
        {!state.loading && !state.claims.length && (
          <li className="p-10 text-center text-sm text-stone-500">{filter === 'pending' ? 'No claims are waiting. 🎉' : 'No claims here.'}</li>
        )}
      </ul>
    </div>
  );
}
