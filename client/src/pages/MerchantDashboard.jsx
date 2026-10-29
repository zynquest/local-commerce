import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {
  Archive, ArchiveRestore, CalendarDays, DoorClosed, ExternalLink, FileUp, Loader2, LogOut, Package, Pencil, Plus, ReceiptText, Scissors, Search,
  Settings, Share2, Trash2, UserCog, Users,
} from 'lucide-react';
import AppointmentsPanel from '../merchant/AppointmentsPanel.jsx';
import ServicesPanel from '../merchant/ServicesPanel.jsx';
import SpecialistsPanel from '../merchant/SpecialistsPanel.jsx';
import ProductForm from '../merchant/ProductForm.jsx';
import CsvImport from '../merchant/CsvImport.jsx';
import OrdersPanel from '../merchant/OrdersPanel.jsx';
import StoreSettings from '../merchant/StoreSettings.jsx';
import AccountPanel from '../merchant/AccountPanel.jsx';
import StoreStatusCard, { StatusPill } from '../merchant/StoreStatusCard.jsx';
import OnboardingWizard from '../merchant/OnboardingWizard.jsx';
import PushOptIn from '../merchant/PushOptIn.jsx';
import SmartImage from '../components/SmartImage.jsx';
import { LoadingScreen } from '../components/StatusScreens.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { del, get, patch, post, put } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';
import { useDebounce } from '../lib/hooks.js';
import { useSeo } from '../lib/seo.js';
import { rich, useI18n } from '../i18n/index.jsx';
import { PLATFORM } from '../config.js';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';

// Appointment businesses (salon, spa, clinic) manage bookings, services and specialists instead of products.
const TABS_APPOINTMENTS = [
  { id: 'appointments', icon: CalendarDays },
  { id: 'services', icon: Scissors },
  { id: 'specialists', icon: Users },
  { id: 'settings', icon: Settings },
  { id: 'account', icon: UserCog },
];
const TABS = [
  { id: 'products', icon: Package },
  { id: 'orders', icon: ReceiptText },
  { id: 'import', icon: FileUp },
  { id: 'settings', icon: Settings },
  { id: 'account', icon: UserCog },
];

/** Merchant console: catalog CRUD, orders, CSV import, store settings, account. */
export default function MerchantDashboard() {
  const { owner, loadOwner, logoutOwner } = useSession();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const setTab = (t) => setParams({ tab: t }, { replace: true });

  const [store, setStore] = useState(null);
  const [stats, setStats] = useState(null);
  const [products, setProducts] = useState({ loading: true, items: [], error: '' });
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query.trim().toLowerCase(), 150);
  const [editing, setEditing] = useState(null); // null | 'new' | product
  const [toast, setToast] = useState('');

  const { t, formatDay } = useI18n();
  useSeo({ title: t('merchant.seoTitle'), noindex: true });

  useEffect(() => {
    if (owner === undefined) loadOwner();
  }, [owner, loadOwner]);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const loadAll = useCallback(async () => {
    try {
      const [s, st, p] = await Promise.all([get('/merchant/store'), get('/merchant/stats'), get('/merchant/products')]);
      setStore(s.store);
      setStats(st);
      setProducts({ loading: false, items: p.products, error: '' });
    } catch (err) {
      setProducts({ loading: false, items: [], error: err.message });
    }
  }, []);

  const refreshStats = useCallback(async () => {
    const [s, st] = await Promise.all([get('/merchant/store'), get('/merchant/stats')]).catch(() => []);
    if (s) setStore(s.store);
    if (st) setStats(st);
  }, []);

  useEffect(() => {
    if (owner) loadAll();
  }, [owner, loadAll]);

  const upsertLocal = (p) =>
    setProducts((s) => {
      const exists = s.items.some((x) => x.id === p.id);
      return { ...s, items: exists ? s.items.map((x) => (x.id === p.id ? p : x)) : [...s.items, p] };
    });

  const saveProduct = async (payload, isNew) => {
    const { product } = isNew ? await post('/merchant/products', payload) : await put(`/merchant/products/${editing.id}`, payload);
    upsertLocal(product);
    setEditing(null);
    refreshStats();
    flash(isNew ? t('merchant.added', { name: product.name }) : t('merchant.savedProduct', { name: product.name }));
  };

  const quickPatch = async (p, body, message) => {
    try {
      const { product } = await patch(`/merchant/products/${p.id}`, body);
      upsertLocal(product);
      refreshStats();
      if (message) flash(message);
    } catch (err) {
      flash(err.message);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(t('merchant.confirmDelete', { name: p.name }))) return;
    try {
      await del(`/merchant/products/${p.id}`);
      setProducts((s) => ({ ...s, items: s.items.filter((x) => x.id !== p.id) }));
      refreshStats();
      flash(t('merchant.deleted'));
    } catch (err) {
      flash(err.message);
    }
  };

  const importChunk = async (rows) => {
    await post('/merchant/products/import', { products: rows });
  };

  const shareStore = async () => {
    const url = `${window.location.origin}/s/${store.slug}`;
    try {
      if (navigator.share) await navigator.share({ title: store.name, text: t('merchant.shareText', { name: store.name }), url });
      else {
        await navigator.clipboard.writeText(url);
        flash(t('merchant.linkCopied'));
      }
    } catch {
      /* cancelled */
    }
  };

  const categories = useMemo(() => [...new Set(products.items.map((p) => p.category))].sort(), [products.items]);
  const existingSkus = useMemo(() => new Set(products.items.map((p) => p.sku_id)), [products.items]);
  const filtered = useMemo(
    () =>
      products.items.filter(
        (p) => !debounced || `${p.name} ${p.category} ${p.tags.join(' ')}`.toLowerCase().includes(debounced),
      ),
    [products.items, debounced],
  );

  if (owner === undefined) return <LoadingScreen label={t('common.loading')} />;
  if (!owner) return <Navigate to="/login" replace />;
  if (!store) return products.error ? <p className="p-6 text-rose-600">{products.error}</p> : <LoadingScreen label={t('common.loading')} />;

  const cur = store.currency_symbol;
  const isAppt = store.business_type === 'appointments';
  // New stores (and stores the team sent back) go through the setup steps; the console tabs come after submitting.
  const inSetup = store.status === 'draft' || store.status === 'rejected';
  // Store Settings (delivery, hours, logo…) open once the store is approved.
  const settingsOpen = store.status === 'approved' || store.status === 'suspended';
  const tabs = (isAppt ? TABS_APPOINTMENTS : TABS).filter((x) => x.id !== 'settings' || settingsOpen);
  const tab = tabs.some((x) => x.id === tabParam) ? tabParam : tabs[0].id;
  const atLimit = stats && stats.sku_used >= stats.sku_limit;

  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white">
        {/* Row 1: logo · name (full, wraps) · actions. Row 2: the status pill, which may run under the actions. */}
        <div className="mx-auto grid max-w-5xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 pt-3 pb-2">
          <SmartImage src={store.logo_url} alt={store.name} kind={isAppt ? 'appointments' : 'shop'} hint={store.category} width={80} className="row-span-2 h-11 w-11 rounded-xl object-cover" />
          <p className="self-end text-base leading-tight font-bold break-words">{store.name}</p>
          <div className="flex items-center gap-0.5 self-center">
            {/* Phones: icon-only, so the store name and status keep their room. */}
            <LanguageSwitcher variant="compact" className="sm:hidden" />
            <LanguageSwitcher className="me-1 hidden sm:block" />
            <button onClick={shareStore} className="rounded-lg p-2 text-stone-600 hover:bg-stone-100" aria-label={t('merchant.shareLink')}>
              <Share2 size={18} />
            </button>
            <a href={`/s/${store.slug}`} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-stone-600 hover:bg-stone-100" aria-label={t('merchant.viewStore')}>
              <ExternalLink size={18} />
            </a>
            <button onClick={logoutOwner} className="rounded-lg p-2 text-stone-600 hover:bg-stone-100" aria-label={t('common.logOut')}>
              <LogOut size={18} />
            </button>
          </div>
          <div className="col-span-2 min-w-0"><StatusPill status={store.status} /></div>
        </div>
        {!inSetup && <nav className="no-scrollbar mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
          {tabs.map(({ id, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                setTab(id);
                setEditing(null);
              }}
              className={`flex flex-none items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold ${
                tab === id ? 'border-brand text-brand' : 'border-transparent text-stone-500'
              }`}
            >
              <Icon size={16} /> {t(`merchant.tabs.${id}`)}
              {id === 'orders' && stats?.orders_pending > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{stats.orders_pending}</span>
              )}
              {id === 'appointments' && stats?.appointments_pending > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{stats.appointments_pending}</span>
              )}
            </button>
          ))}
        </nav>}
      </header>

      {inSetup ? (
        <main className="mx-auto max-w-2xl space-y-4 p-4">
          <OnboardingWizard store={store} onStoreChange={setStore} onCatalogChange={loadAll} />
        </main>
      ) : (
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <StoreStatusCard store={store} onChange={(s) => setStore(s)} />
        <PushOptIn store={store} />
        {store.closed_now && (
          <button
            onClick={() => setTab('settings')}
            className="flex w-full items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-start text-sm font-semibold text-amber-900"
          >
            <DoorClosed size={18} className="flex-none text-amber-700" />
            <span className="flex-1">
              {store.reopens_on
                ? t('closure.ownerBannerUntil', { date: formatDay(store.reopens_on, { weekday: 'long', day: 'numeric', month: 'long' }) })
                : t('closure.ownerBanner')}
            </span>
            <span className="flex-none text-xs underline">{t('closure.reopenNow')}</span>
          </button>
        )}

        {stats && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(isAppt ? [
              [t('appt.stats.today'), stats.appointments_today],
              [t('appt.stats.pending'), stats.appointments_pending],
            ] : [
              [t('merchant.stats.products'), `${stats.sku_used}/${stats.sku_limit}`],
              [t('merchant.stats.ordersToday'), stats.orders_today],
              [t('merchant.stats.newOrders'), stats.orders_pending],
              [t('merchant.stats.sales7d'), formatMoney(stats.revenue_7d, cur)],
            ]).map(([k, v]) => (
              <div key={k} className="card p-3">
                <p className="text-[11px] font-semibold text-stone-500 uppercase">{k}</p>
                <p className="mt-0.5 text-lg font-bold">{v}</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'products' &&
          (editing ? (
            <ProductForm
              product={editing === 'new' ? null : editing}
              categories={categories}
              existingSkus={existingSkus}
              onSave={saveProduct}
              onCancel={() => setEditing(null)}
              canUpload={store.plan !== 'free'}
              onBulk={() => {
                setEditing(null);
                setTab('import');
              }}
            />
          ) : (
            <>
              <div className="flex gap-2">
                <label className="relative flex-1">
                  <Search size={18} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
                  <input maxLength={60} className="input ps-10" placeholder={t('merchant.searchProducts')} value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <button onClick={() => setEditing('new')} disabled={atLimit} className="btn-brand" title={atLimit ? t('merchant.limitReachedShort') : ''}>
                  <Plus size={16} /> {t('merchant.addProduct')}
                </button>
              </div>
              {atLimit && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {rich(t('merchant.limitReached', { limit: stats.sku_limit }), {
                    link: (x) => <button onClick={() => setTab('account')} className="font-semibold underline">{x}</button>,
                  })}
                </p>
              )}
              {products.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{products.error}</p>}
              <ul className="card divide-y divide-stone-100">
                {filtered.map((p) => (
                  <li key={p.id} className={`flex items-center gap-3 p-3 ${p.status === 'archived' ? 'opacity-50' : ''}`}>
                    <SmartImage src={p.images[0]} alt={p.name} hint={store.category} width={120} className="h-14 w-14 flex-none rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="truncate text-xs text-stone-500">
                        {p.category} · {formatMoney(p.offer_price, cur)}
                        {p.mrp > p.offer_price && <span className="line-through"> {formatMoney(p.mrp, cur)}</span>}
                      </p>
                      <div className="mt-1 flex gap-1">
                        {p.status === 'archived' ? (
                          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-bold text-stone-600">{t('merchant.archivedBadge')}</span>
                        ) : (
                          <button
                            onClick={() => quickPatch(p, { in_stock: !p.in_stock })}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.in_stock ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}
                          >
                            {p.in_stock ? t('merchant.inStockBadge') : t('merchant.outOfStockBadge')}
                          </button>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setEditing(p)} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label={t('merchant.editItem', { name: p.name })}>
                      <Pencil size={18} />
                    </button>
                    <button
                      onClick={() =>
                        quickPatch(p, { status: p.status === 'archived' ? 'active' : 'archived' }, p.status === 'archived' ? t('merchant.restored') : t('merchant.archived'))
                      }
                      className="rounded-lg p-2 text-stone-500 hover:bg-stone-100"
                      aria-label={p.status === 'archived' ? t('merchant.restore') : t('merchant.archive')}
                      title={p.status === 'archived' ? t('merchant.restore') : t('merchant.archive')}
                    >
                      {p.status === 'archived' ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                    </button>
                    {p.status === 'archived' && (
                      <button onClick={() => remove(p)} className="rounded-lg p-2 text-stone-400 hover:bg-rose-50 hover:text-rose-600" aria-label={t('common.delete')}>
                        <Trash2 size={18} />
                      </button>
                    )}
                  </li>
                ))}
                {products.loading && (
                  <li className="flex justify-center p-6"><Loader2 className="animate-spin text-stone-400" /></li>
                )}
                {!products.loading && !filtered.length && (
                  <li className="p-8 text-center text-sm text-stone-500">
                    {products.items.length ? t('merchant.noMatches') : t('merchant.noProducts')}
                  </li>
                )}
              </ul>
            </>
          ))}

        {tab === 'orders' && <OrdersPanel currency={cur} onChange={refreshStats} />}
        {tab === 'appointments' && <AppointmentsPanel store={store} currency={cur} onChange={refreshStats} />}
        {tab === 'services' && <ServicesPanel currency={cur} onChange={() => { refreshStats(); setTimeout(() => get('/merchant/store').then((r) => setStore(r.store)), 0); }} />}
        {tab === 'specialists' && <SpecialistsPanel canUpload={store.plan !== 'free'} onChange={() => get('/merchant/store').then((r) => setStore(r.store))} />}
        {tab === 'import' && (
          <CsvImport
            existingProducts={products.items}
            skuUsed={stats?.sku_used || 0}
            skuLimit={stats?.sku_limit || 0}
            onUpload={async (rows) => {
              await importChunk(rows);
              await loadAll();
            }}
          />
        )}
        {tab === 'settings' && (
          <StoreSettings
            store={store}
            onSaved={(s, message) => {
              setStore((prev) => ({ ...prev, ...s }));
              flash(message || t('common.saved'));
            }}
          />
        )}
        {tab === 'account' && <AccountPanel store={{ ...store, sku_used: stats?.sku_used ?? store.sku_used }} phone={owner.phone} email={owner.email} />}
      </main>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <p className="animate-fade-up rounded-xl bg-stone-900 px-4 py-2.5 text-sm text-white shadow-lg">{toast}</p>
        </div>
      )}
      <p className="pb-4 text-center text-xs text-stone-400">
        <Link to="/" className="hover:text-stone-600">{PLATFORM.name}</Link> · {t('merchant.signedInAs', { user: owner.phone ? `+91 ${owner.phone.slice(-10)}` : owner.username })}
      </p>
    </div>
  );
}
