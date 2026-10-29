import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  BadgeCheck, Check, ExternalLink, Inbox, Loader2, LogOut, MapPin, Pencil, Phone, RefreshCw, RotateCcw, Search, ShieldCheck,
  QrCode, ShieldOff, Sprout, Store, Trash2, UserCheck, X,
} from 'lucide-react';

const AdminQrCodes = lazy(() => import('./AdminQrCodes.jsx'));
import MobileInput, { isMobile10 } from '../components/MobileInput.jsx';
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
import { categoriesFor } from '../businessCategories.js';

const FILTERS = [
  ['pending_review', 'Approval queue'],
  ['approved', 'Live'],
  ['rejected', 'Changes requested'],
  ['draft', 'Draft'],
  ['suspended', 'Suspended'],
  ['seed', 'Seeded (unclaimed)'],
  ['seed_claimed', 'Seeds claimed'],
  ['all', 'All'],
];

const SEED_SOURCE = { osm: 'OpenStreetMap', google_places: 'Google Places', manual: 'Field survey / manual' };

const ACTION_LABEL = { submitted: 'Submitted by owner', approved: 'Approved', rejected: 'Rejected', suspended: 'Suspended', reinstated: 'Reinstated' };

const ago = (d) => {
  if (!d) return '';
  const mins = Math.round((Date.now() - new Date(d)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};
const phoneText = (p) => (p ? `+${p}` : '—');

/**
 * Support corrections of what owners can't change after approval: name, store link, business type, store type and
 * WhatsApp number (a number set here counts as verified).
 */
function EditDetails({ store, onSaved }) {
  const [open, setOpen] = useState(false);
  const initial = () => ({
    name: store.name || '',
    slug: store.slug || '',
    business_type: store.business_type || 'shop',
    category: store.category || '',
    whatsapp_number: (store.whatsapp_number || '').replace(/^91(?=\d{10}$)/, ''),
  });
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: typeof e === 'string' ? e : e.target.value }));

  const save = async () => {
    const before = initial();
    const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== before[k]));
    if (!Object.keys(changed).length) return setOpen(false);
    if (changed.whatsapp_number !== undefined && !isMobile10(changed.whatsapp_number)) return setError('Enter a valid 10-digit WhatsApp number');
    setBusy(true);
    setError('');
    try {
      await patch(`/platform/stores/${store.id}/details`, changed);
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(Object.values(err.fields || {})[0] || err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => { setForm(initial()); setOpen(true); }} className="btn-ghost w-full text-sm">
        <Pencil size={14} /> Edit name, link, type or WhatsApp (owner asked support)
      </button>
    );
  }
  return (
    <div className="card space-y-3 p-4">
      <h3 className="font-bold">Correct store details</h3>
      <p className="text-xs text-stone-500">Owners can't change these after approval. Changing the link breaks old links and printed QR codes that use it directly (QR stickers from the QR codes tab keep working).</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="fix-name">Store name</label>
          <input id="fix-name" className="input" value={form.name} onChange={set('name')} maxLength={60} />
        </div>
        <div>
          <label className="label" htmlFor="fix-slug">Store link (/s/…)</label>
          <input id="fix-slug" className="input" value={form.slug} onChange={(e) => set('slug')(e.target.value.toLowerCase())} maxLength={60} />
        </div>
        <div>
          <label className="label" htmlFor="fix-type">Business type</label>
          <select id="fix-type" className="input" value={form.business_type} onChange={set('business_type')}>
            <option value="shop">Store</option>
            <option value="appointments">Appointments</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="fix-category">Store type</label>
          <input id="fix-category" className="input" list="fix-categories" value={form.category} onChange={set('category')} maxLength={40} />
          <datalist id="fix-categories">
            {categoriesFor(form.business_type).map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="sm:col-span-2">
          <MobileInput id="fix-wa" value={form.whatsapp_number} onChange={set('whatsapp_number')} label="WhatsApp number for orders" />
        </div>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="btn-brand">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save changes</button>
        <button onClick={() => setOpen(false)} disabled={busy} className="btn-ghost">Cancel</button>
      </div>
    </div>
  );
}

function StoreDetail({ id, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState('');
  const [plan, setPlan] = useState({ plan: 'free', sku_limit: 50 });
  const [ownerMobile, setOwnerMobile] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');

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

  // Seeded listing → its owner: their mobile becomes the login + WhatsApp number; they log in with OTP and edit prices.
  const handOver = async () => {
    const email = ownerEmail.trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError('Enter a valid email');
    if (ownerMobile && !isMobile10(ownerMobile)) return setError('Enter a valid 10-digit mobile');
    if (!email && !ownerMobile) return setError("Enter the owner's email (they log in with it) and/or mobile");
    setBusy('claim');
    setError('');
    try {
      await post(`/platform/stores/${id}/claim`, { email: email || undefined, phone: ownerMobile || undefined });
      setOwnerMobile('');
      setOwnerEmail('');
      await load();
      onChanged();
    } catch (err) {
      setError(err.fields?.email || err.fields?.phone || err.message);
    } finally {
      setBusy('');
    }
  };

  const removeSeed = async () => {
    if (!window.confirm('Remove this listing? It is deleted and future imports skip it.')) return;
    setBusy('remove');
    setError('');
    try {
      await post(`/platform/stores/${id}/remove-seed`, { remarks: remarks || undefined });
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
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
          <h2 className="min-w-0 leading-tight font-bold break-words">{s?.name || 'Loading…'}</h2>
          <div className="flex flex-none items-center gap-1">
            {s && (
              <a href={`/s/${s.slug}`} target="_blank" rel="noreferrer" className="btn-ghost py-1.5 text-xs">
                <ExternalLink size={14} /> Preview
              </a>
            )}
            <button onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-stone-100"><X size={20} /></button>
          </div>
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
                <SmartImage src={s.logo_url} alt={s.name} kind={s.business_type === 'appointments' ? 'appointments' : 'shop'} hint={s.category} width={120} className="relative z-10 -mt-10 h-16 w-16 flex-none rounded-xl border-4 border-white bg-white object-cover shadow-sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={s.status} />
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold">{s.plan === 'paid' ? `Paid · ${s.sku_limit}` : `Free · ${s.sku_limit}`} products</span>
                  </div>
                  <p className="mt-1 text-sm text-stone-600">
                    <b>{s.business_type === 'appointments' ? 'Appointments' : 'Store'}</b> · {[s.category, s.city].filter(Boolean).join(' · ') || 'No category/city'}
                    {s.lat == null && <span className="ms-1 text-rose-600">· no map location</span>}
                  </p>
                  {s.address_text && <p className="flex gap-1 text-xs text-stone-500"><MapPin size={12} className="mt-0.5 flex-none" /> {s.address_text}</p>}
                </div>
              </div>
              {s.description && <p className="border-t border-stone-100 px-4 py-3 text-sm text-stone-700">{s.description}</p>}
            </div>

            {s.origin === 'seed' && (
              <div className="card space-y-3 border-2 border-lime-300 p-4">
                <p className="flex items-center gap-2 font-semibold">
                  <Sprout size={18} className="text-lime-700" /> Seeded listing
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.claimed_at ? 'bg-emerald-100 text-emerald-800' : 'bg-lime-100 text-lime-800'}`}>
                    {s.claimed_at ? `Claimed ${ago(s.claimed_at)}` : 'Not claimed yet'}
                  </span>
                </p>
                <p className="text-xs text-stone-600">
                  From {SEED_SOURCE[s.seed_source] || s.seed_source || '—'}
                  {s.locality ? ` · ${s.locality}` : ''}
                  {s.seed_phone ? ` · listed phone ${s.seed_phone}` : ' · no phone listed'}
                </p>
                {!s.claimed_at && (
                  <>
                    <p className="text-sm text-stone-700">
                      At the shop: enter the owner's email (they log in at <b>/login</b> with it and an emailed code) and their WhatsApp mobile (orders go there; marked verified since you're with them). They adjust prices and the shop is live.
                    </p>
                    <div>
                      <label className="label" htmlFor="seed-owner-email">Owner's email (login)</label>
                      <input maxLength={254} id="seed-owner-email" className="input" type="email" inputMode="email" placeholder="owner@example.com" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
                    </div>
                    <MobileInput id="seed-owner" value={ownerMobile} onChange={setOwnerMobile} label="Owner's WhatsApp mobile" />
                    <button onClick={handOver} disabled={!!busy} className="btn-brand w-full">
                      {busy === 'claim' ? <Loader2 size={16} className="animate-spin" /> : <UserCheck size={16} />} Hand over to owner
                    </button>
                    <button onClick={removeSeed} disabled={!!busy} className="flex items-center gap-1 text-xs font-semibold text-rose-700 hover:underline">
                      <Trash2 size={13} /> Remove listing (owner asked / closed down) — uses the remarks below as the reason
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="card grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-3">
              <div><p className="label">Owner</p><p className="font-semibold">{s.owner_username}</p></div>
              <div>
                <p className="label">Login email</p>
                <p className="flex items-center gap-1 break-all">{s.owner_email || '—'} {s.owner_email_verified_at && <BadgeCheck size={14} className="flex-none text-emerald-600" aria-label="Verified" />}</p>
              </div>
              <div>
                <p className="label">Owner mobile</p>
                <p className="flex items-center gap-1"><Phone size={12} /> {phoneText(s.owner_phone)} {s.owner_phone_verified_at && <BadgeCheck size={14} className="text-emerald-600" aria-label="Verified" />}</p>
              </div>
              <div>
                <p className="label">WhatsApp orders</p>
                <p className="flex items-center gap-1">{phoneText(s.whatsapp_number)} {s.whatsapp_verified && <BadgeCheck size={14} className="text-emerald-600" aria-label="Verified" />}</p>
              </div>
              <div><p className="label">Products</p><p className="font-semibold">{data.counts.products}</p></div>
              <div><p className="label">Orders</p><p className="font-semibold">{data.counts.orders}</p></div>
              <div><p className="label">Fees</p><p>Min {formatMoney(s.minimum_order)} · Delivery {s.delivery_fee > 0 ? `${formatMoney(s.delivery_fee)}${s.free_delivery_above != null ? ` (free above ${formatMoney(s.free_delivery_above)})` : ''}` : 'free'}</p></div>
            </div>

            <EditDetails
              key={`${s.id}:${s.name}:${s.slug}:${s.category}:${s.business_type}:${s.whatsapp_number}`}
              store={s}
              onSaved={async () => {
                await load();
                onChanged();
              }}
            />

            {/* Decision */}
            <div className="card space-y-3 p-4">
              <h3 className="font-bold">Decision</h3>
              <textarea maxLength={1000}
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
                    <p className="w-full text-xs text-stone-600">
                      {s.whatsapp_number
                        ? <>Approve once their WhatsApp message arrives from <b>{phoneText(s.whatsapp_number)}</b>: approving marks that number verified.</>
                        : 'No WhatsApp number yet.'}
                    </p>
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
                      <SmartImage src={p.images[0]} alt={p.name} hint={s.category} width={200} className="aspect-square w-full object-cover" />
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
/** Recent orders across all stores (from the "Orders (7 days)" tile). Tapping one opens its store. */
function RecentOrders({ onClose, onOpenStore }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    get('/platform/orders?days=7').then(setData, (err) => setError(err.message));
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Recent orders">
      <div className="h-full w-full max-w-2xl animate-slide-in overflow-y-auto bg-stone-50">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
          <h2 className="font-bold">Orders · last 7 days</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-stone-100"><X size={20} /></button>
        </header>
        {!data && !error && <Loader2 className="mx-auto mt-10 animate-spin text-stone-400" />}
        {error && <p className="m-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {data && (
          <ul className="card m-4 divide-y divide-stone-100">
            {data.orders.map((o) => (
              <li key={o.id}>
                <button onClick={() => onOpenStore(o.store_id)} className="flex w-full items-start gap-3 p-3 text-start hover:bg-stone-50">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words">{o.store_name}</p>
                    <p className="text-xs text-stone-500">
                      #{o.order_code} · {ago(o.created_at)} · {o.items} item{o.items === 1 ? '' : 's'}
                      {o.customer_name ? ` · ${o.customer_name}` : ''}{o.placed_offline ? ' · placed offline' : ''}
                    </p>
                  </div>
                  <div className="flex flex-none flex-col items-end gap-1">
                    <span className="font-bold">{formatMoney(o.total, o.currency_symbol)}</span>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold capitalize">{o.status.replace(/_/g, ' ')}</span>
                  </div>
                </button>
              </li>
            ))}
            {!data.orders.length && <li className="p-10 text-center text-sm text-stone-500">No orders in the last 7 days.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AdminConsole() {
  const { admin, loadAdmin, logoutAdmin } = useSession();
  const [section, setSection] = useState('stores'); // 'stores' | 'qr'
  const [filter, setFilter] = useState('pending_review');
  const [sort, setSort] = useState(''); // 'products' from the Active products tile
  const [ordersOpen, setOrdersOpen] = useState(false);
  const listRef = useRef(null);
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
      const [r, st] = await Promise.all([get(`/platform/stores?status=${filter}&q=${encodeURIComponent(q)}${sort ? `&sort=${sort}` : ''}`), get('/platform/stats')]);
      setList({ loading: false, stores: r.stores, error: '' });
      setStats(st);
    } catch (err) {
      setList({ loading: false, stores: [], error: err.message });
    }
  }, [filter, q, sort]);

  useEffect(() => {
    if (admin) load();
  }, [admin, load]);

  if (admin === undefined) return <LoadingScreen label="Loading…" />;
  if (!admin) return <Navigate to="/motiveboss/login" replace />;

  const count = (k) =>
    k === 'all' ? Object.values(stats?.by_status || {}).reduce((a, b) => a + b, 0)
      : k === 'seed_claimed' ? stats?.seeds_claimed || 0
        : stats?.by_status?.[k] || 0;
  // Stat tiles open the matching list (and scroll to it).
  const show = (f, s = '') => {
    setFilter(f);
    setSort(s);
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

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
        {/* Stores (approval, seeded listings, …) and printed QR codes */}
        <div className="flex gap-1 rounded-full bg-white p-1 shadow-sm ring-1 ring-stone-200 sm:w-fit" role="tablist">
          {[
            ['stores', 'Stores', Store],
            ['qr', 'QR codes', QrCode],
          ].map(([k, label, Icon]) => (
            <button
              key={k}
              role="tab"
              aria-selected={section === k}
              onClick={() => setSection(k)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold sm:flex-none ${section === k ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100'}`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {section === 'qr' ? (
          <Suspense fallback={<Loader2 className="mx-auto mt-10 animate-spin text-stone-400" />}>
            <AdminQrCodes />
          </Suspense>
        ) : (
          <>
        {stats && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Waiting for approval', count('pending_review'), 'text-amber-600', () => show('pending_review')],
              ['Live stores', count('approved'), 'text-emerald-700', () => show('approved')],
              ['Seeded, unclaimed', count('seed'), 'text-lime-700', () => show('seed')],
              ['Seeds claimed', stats.seeds_claimed, 'text-lime-700', () => show('seed_claimed')],
              ['Active products', stats.products, '', () => show('approved', 'products')],
              ['Orders (7 days)', stats.orders_7d, '', () => setOrdersOpen(true)],
            ].map(([k, v, cls, onClick]) => (
              <button key={k} type="button" onClick={onClick} className="card p-3 text-start transition hover:border-stone-400 hover:shadow-sm">
                <p className="text-[11px] font-semibold text-stone-500 uppercase">{k}</p>
                <p className={`text-2xl font-bold ${cls}`}>{Number(v || 0).toLocaleString('en-IN')}</p>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
            {FILTERS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  setFilter(k);
                  setSort('');
                }}
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
            <input maxLength={60} className="input ps-9" placeholder="Search name, link, phone" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button onClick={load} className="btn-ghost px-3" aria-label="Refresh"><RefreshCw size={16} className={list.loading ? 'animate-spin' : ''} /></button>
        </div>

        {list.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{list.error}</p>}

        {sort === 'products' && (
          <p className="flex items-center justify-between text-xs text-stone-500">
            Sorted by number of products.
            <button onClick={() => setSort('')} className="font-semibold text-stone-700 underline">Clear</button>
          </p>
        )}
        <ul ref={listRef} className="card scroll-mt-20 divide-y divide-stone-100">
          {list.stores.map((s) => (
            <li key={s.id}>
              <button onClick={() => setOpenId(s.id)} className="flex w-full items-start gap-3 p-3 text-start hover:bg-stone-50">
                <SmartImage src={s.logo_url} alt={s.name} kind={s.business_type === 'appointments' ? 'appointments' : 'shop'} hint={s.category} width={96} className="h-12 w-12 flex-none rounded-xl object-cover" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="leading-snug font-semibold break-words">{s.name}</p>
                  <p className="text-xs break-words text-stone-500">
                    {s.origin === 'seed' && !s.claimed_at
                      ? `${[s.category, s.locality || s.city].filter(Boolean).join(' · ') || '—'} · ${s.product_count} products${s.seed_phone ? ` · listed phone ${s.seed_phone}` : ''}`
                      : `${s.business_type === 'appointments' ? 'Appointments · ' : ''}${[s.category, s.city].filter(Boolean).join(' · ') || '—'} · ${s.product_count} products · owner ${s.owner_email || s.owner_username} · WhatsApp ${phoneText(s.whatsapp_number)}`}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {s.origin === 'seed' && !s.claimed_at ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-lime-100 px-2.5 py-0.5 text-xs font-bold text-lime-800">
                        <Sprout size={12} /> Seeded · not claimed
                      </span>
                    ) : (
                      <StatusPill status={s.status} />
                    )}
                    <span className="text-[11px] text-stone-400">
                      {s.status === 'pending_review' ? `submitted ${ago(s.submitted_at)}` : s.claimed_at ? `claimed ${ago(s.claimed_at)}` : `added ${ago(s.created_at)}`}
                    </span>
                  </p>
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
          </>
        )}
      </main>

      {openId && <StoreDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {ordersOpen && !openId && <RecentOrders onClose={() => setOrdersOpen(false)} onOpenStore={(id) => setOpenId(id)} />}
    </div>
  );
}
