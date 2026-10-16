import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  BadgeCheck, Check, ExternalLink, Inbox, Loader2, LogOut, MapPin, Phone, RefreshCw, RotateCcw, Search, ShieldCheck,
  ShieldOff, Store, X,
} from 'lucide-react';
import SmartImage from '../components/SmartImage.jsx';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { LoadingScreen } from '../components/StatusScreens.jsx';
import { StatusPill } from '../merchant/StoreStatusCard.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { get, patch, post } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';
import { useDebounce } from '../lib/hooks.js';
import { useSeo } from '../lib/seo.js';
import { whatsappLink } from '../services/whatsappService.js';

const FILTERS = [
  ['pending_review', 'Approval queue'],
  ['approved', 'Live'],
  ['rejected', 'Changes requested'],
  ['draft', 'Draft'],
  ['suspended', 'Suspended'],
  ['all', 'All'],
];

const ACTION_LABEL = { submitted: 'Submitted by owner', approved: 'Approved', rejected: 'Rejected', suspended: 'Suspended', reinstated: 'Reinstated' };

const ago = (d) => {
  if (!d) return '';
  const mins = Math.round((Date.now() - new Date(d)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};
const phoneText = (p) => (p ? `+${p}` : '—');

function StoreDetail({ id, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState('');
  const [plan, setPlan] = useState({ plan: 'free', sku_limit: 50 });

  const load = useCallback(async () => {
    try {
      const d = await get(`/platform/stores/${id}`);
      setData(d);
      setPlan({ plan: d.store.plan, sku_limit: d.store.sku_limit });
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (action) => {
    setBusy(action);
    setError('');
    try {
      await post(`/platform/stores/${id}/${action}`, { remarks: remarks || undefined });
      setRemarks('');
      await load();
      onChanged();
    } catch (err) {
      setError(err.fields?.remarks || err.message);
    } finally {
      setBusy('');
    }
  };

  const savePlan = async () => {
    setBusy('plan');
    setError('');
    try {
      await patch(`/platform/stores/${id}/plan`, plan);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const s = data?.store;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Store details">
      <div className="h-full w-full max-w-2xl animate-slide-in overflow-y-auto bg-stone-50">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
          <h2 className="truncate font-bold">{s?.name || 'Loading…'}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-stone-100"><X size={20} /></button>
        </header>
        {!data && !error && <Loader2 className="mx-auto mt-10 animate-spin text-stone-400" />}
        {error && <p className="m-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {s && (
          <div className="space-y-4 p-4">
            <div className="card overflow-hidden">
              <div className="relative h-28 bg-gradient-to-br from-brand to-emerald-900">
                {s.banner_url && <SmartImage src={s.banner_url} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="flex gap-3 p-4">
                <SmartImage src={s.logo_url} alt="" width={120} className="-mt-10 h-16 w-16 rounded-xl border-4 border-white bg-white object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={s.status} />
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold">{s.plan === 'paid' ? `Paid · ${s.sku_limit}` : `Free · ${s.sku_limit}`} products</span>
                  </div>
                  <p className="mt-1 text-sm text-stone-600">
                    <b>{s.business_type === 'appointments' ? 'Appointments' : 'Store'}</b> · {[s.category, s.city].filter(Boolean).join(' · ') || 'No category/city'}
                    {s.lat == null && <span className="ms-1 text-rose-600">· no map location</span>}
                  </p>
                  {s.address_text && <p className="flex gap-1 text-xs text-stone-500"><MapPin size={12} className="mt-0.5" /> {s.address_text}</p>}
                </div>
                <a href={`/s/${s.slug}`} target="_blank" rel="noreferrer" className="btn-ghost h-fit py-1.5 text-xs">
                  <ExternalLink size={14} /> Preview
                </a>
              </div>
              {s.description && <p className="border-t border-stone-100 px-4 py-3 text-sm text-stone-700">{s.description}</p>}
            </div>

            <div className="card grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-3">
              <div><p className="label">Owner</p><p className="font-semibold">{s.owner_username}</p></div>
              <div><p className="label">Registered mobile</p><p className="flex items-center gap-1"><Phone size={12} /> {phoneText(s.owner_phone)}</p></div>
              <div>
                <p className="label">WhatsApp orders</p>
                <p className="flex items-center gap-1">{phoneText(s.whatsapp_number)} {s.whatsapp_verified && <BadgeCheck size={14} className="text-emerald-600" aria-label="Verified" />}</p>
              </div>
              <div><p className="label">Products</p><p className="font-semibold">{data.counts.products}</p></div>
              <div><p className="label">Orders</p><p className="font-semibold">{data.counts.orders}</p></div>
              <div><p className="label">Fees</p><p>Min {formatMoney(s.minimum_order)} · Delivery {formatMoney(s.delivery_fee)}</p></div>
            </div>

            {/* Decision */}
            <div className="card space-y-3 p-4">
              <h3 className="font-bold">Decision</h3>
              <textarea
                className="input"
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={
                  s.status === 'pending_review'
                    ? 'Remarks for the owner (required to reject, optional to approve). E.g. "Please add a clear logo and your shop address."'
                    : s.status === 'approved'
                      ? 'Reason for suspension (required)'
                      : 'Remarks (optional)'
                }
              />
              <div className="flex flex-wrap gap-2">
                {s.status === 'pending_review' && (
                  <>
                    <button onClick={() => act('approve')} disabled={!!busy} className="btn-brand">
                      {busy === 'approve' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Approve
                    </button>
                    <button onClick={() => act('reject')} disabled={!!busy} className="btn bg-rose-600 text-white hover:bg-rose-700">
                      {busy === 'reject' ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />} Reject with remarks
                    </button>
                  </>
                )}
                {s.status === 'approved' && (
                  <button onClick={() => act('suspend')} disabled={!!busy} className="btn bg-rose-600 text-white hover:bg-rose-700">
                    <ShieldOff size={16} /> Suspend store
                  </button>
                )}
                {s.status === 'suspended' && (
                  <button onClick={() => act('reinstate')} disabled={!!busy} className="btn-brand">
                    <RotateCcw size={16} /> Reinstate
                  </button>
                )}
                {['draft', 'rejected'].includes(s.status) && (
                  <p className="text-sm text-stone-500">Waiting for the owner to {s.status === 'draft' ? 'submit' : 'resubmit'}.</p>
                )}
                {s.owner_phone && (
                  <a
                    href={whatsappLink(s.owner_phone, `Hi ${s.owner_username}, about your store "${s.name}" on our platform: ${remarks || s.review_remarks || ''}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost"
                  >
                    <WhatsAppIcon size={16} /> Message owner
                  </a>
                )}
              </div>
            </div>

            {/* Plan */}
            <div className="card flex flex-wrap items-end gap-2 p-4">
              <div>
                <label className="label" htmlFor="plan">Plan</label>
                <select id="plan" className="input" value={plan.plan} onChange={(e) => setPlan({ plan: e.target.value, sku_limit: e.target.value === 'free' ? 50 : Math.max(plan.sku_limit, 500) })}>
                  <option value="free">Free (50 products)</option>
                  <option value="paid">Paid (50+ products)</option>
                </select>
              </div>
              {plan.plan === 'paid' && (
                <div>
                  <label className="label" htmlFor="limit">Product limit</label>
                  <input id="limit" className="input w-28" type="number" min={51} value={plan.sku_limit} onChange={(e) => setPlan({ ...plan, sku_limit: Number(e.target.value) })} />
                </div>
              )}
              <button onClick={savePlan} disabled={!!busy} className="btn-ghost">{busy === 'plan' ? <Loader2 size={16} className="animate-spin" /> : 'Save plan'}</button>
            </div>

            {/* Products */}
            <div className="card p-4">
              <h3 className="mb-2 font-bold">Products ({data.counts.products})</h3>
              {data.products.length ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {data.products.map((p) => (
                    <div key={p.id} className="overflow-hidden rounded-lg border border-stone-200 bg-white text-xs">
                      <SmartImage src={p.images[0]} alt={p.name} width={200} className="aspect-square w-full object-cover" />
                      <p className="line-clamp-2 px-1.5 pt-1 font-medium">{p.name}</p>
                      <p className="px-1.5 pb-1.5 text-stone-500">{formatMoney(p.offer_price)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-stone-500">No products yet.</p>
              )}
            </div>

            {/* History */}
            <div className="card p-4">
              <h3 className="mb-2 font-bold">Review history</h3>
              {data.reviews.length ? (
                <ol className="space-y-2 border-l-2 border-stone-200 ps-3 text-sm">
                  {data.reviews.map((r, i) => (
                    <li key={i}>
                      <p className="font-semibold">{ACTION_LABEL[r.action]} <span className="font-normal text-stone-500">· {r.actor || '—'} · {new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></p>
                      {r.remarks && <p className="whitespace-pre-line text-stone-700">“{r.remarks}”</p>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-stone-500">No reviews yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Platform admin console: approval queue, store moderation, plans. */
export default function AdminConsole() {
  const { admin, loadAdmin, logoutAdmin } = useSession();
  const [filter, setFilter] = useState('pending_review');
  const [query, setQuery] = useState('');
  const q = useDebounce(query.trim(), 250);
  const [list, setList] = useState({ loading: true, stores: [], error: '' });
  const [stats, setStats] = useState(null);
  const [openId, setOpenId] = useState(null);
  useSeo({ title: 'Platform Admin', noindex: true });

  useEffect(() => {
    if (admin === undefined) loadAdmin();
  }, [admin, loadAdmin]);

  const load = useCallback(async () => {
    setList((l) => ({ ...l, loading: true }));
    try {
      const [r, st] = await Promise.all([get(`/platform/stores?status=${filter}&q=${encodeURIComponent(q)}`), get('/platform/stats')]);
      setList({ loading: false, stores: r.stores, error: '' });
      setStats(st);
    } catch (err) {
      setList({ loading: false, stores: [], error: err.message });
    }
  }, [filter, q]);

  useEffect(() => {
    if (admin) load();
  }, [admin, load]);

  if (admin === undefined) return <LoadingScreen label="Loading…" />;
  if (!admin) return <Navigate to="/admin/login" replace />;

  const count = (k) => (k === 'all' ? Object.values(stats?.by_status || {}).reduce((a, b) => a + b, 0) : stats?.by_status?.[k] || 0);

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="sticky top-0 z-20 bg-stone-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <p className="flex items-center gap-2 font-bold"><ShieldCheck size={20} className="text-emerald-400" /> Platform Admin</p>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-stone-400 sm:inline">{admin.username}</span>
            <button onClick={logoutAdmin} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/10"><LogOut size={16} /> Sign out</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-4">
        {stats && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Waiting for approval', count('pending_review'), 'text-amber-600'],
              ['Live stores', count('approved'), 'text-emerald-700'],
              ['Active products', stats.products, ''],
              ['Orders (7 days)', stats.orders_7d, ''],
            ].map(([k, v, cls]) => (
              <div key={k} className="card p-3">
                <p className="text-[11px] font-semibold text-stone-500 uppercase">{k}</p>
                <p className={`text-2xl font-bold ${cls}`}>{v}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
            {FILTERS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`flex flex-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${
                  filter === k ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700'
                }`}
              >
                {k === 'pending_review' && <Inbox size={14} />} {label}
                <span className={`rounded-full px-1.5 text-[11px] ${filter === k ? 'bg-white/20' : 'bg-stone-100'}`}>{count(k)}</span>
              </button>
            ))}
          </div>
          <label className="relative w-full sm:w-64">
            <Search size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
            <input className="input ps-9" placeholder="Search name, link, phone" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button onClick={load} className="btn-ghost px-3" aria-label="Refresh"><RefreshCw size={16} className={list.loading ? 'animate-spin' : ''} /></button>
        </div>

        {list.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{list.error}</p>}

        <ul className="card divide-y divide-stone-100">
          {list.stores.map((s) => (
            <li key={s.id}>
              <button onClick={() => setOpenId(s.id)} className="flex w-full items-center gap-3 p-3 text-start hover:bg-stone-50">
                <SmartImage src={s.logo_url} alt="" width={96} className="h-12 w-12 flex-none rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{s.name}</p>
                  <p className="truncate text-xs text-stone-500">
                    {s.business_type === 'appointments' ? 'Appointments · ' : ''}{[s.category, s.city].filter(Boolean).join(' · ') || '—'} · {s.product_count} products · owner {s.owner_username} ({phoneText(s.owner_phone)})
                  </p>
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                  <StatusPill status={s.status} />
                  <span className="text-[11px] text-stone-400">
                    {s.status === 'pending_review' ? `submitted ${ago(s.submitted_at)}` : `joined ${ago(s.created_at)}`}
                  </span>
                </div>
              </button>
            </li>
          ))}
          {!list.loading && !list.stores.length && (
            <li className="p-10 text-center text-sm text-stone-500">
              <Store size={32} className="mx-auto mb-2 text-stone-300" />
              {filter === 'pending_review' ? 'The approval queue is empty. 🎉' : 'No stores here.'}
            </li>
          )}
        </ul>
      </main>

      {openId && <StoreDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
