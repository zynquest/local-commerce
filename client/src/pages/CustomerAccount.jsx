import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, LogOut, ReceiptText, Save, UserRound } from 'lucide-react';
import CustomerAuthModal from '../components/CustomerAuthModal.jsx';
import { LoadingScreen } from '../components/StatusScreens.jsx';
import { ORDER_STATUSES } from '../merchant/OrdersPanel.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { get } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';
import SiteHeader from '../components/SiteHeader.jsx';
import { useSeo } from '../lib/seo.js';
import { rich, useI18n } from '../i18n/index.jsx';

const statusMeta = Object.fromEntries(ORDER_STATUSES.map(([k, , cls]) => [k, { cls }]));

/** Optional shopper account: profile + order history across all stores. */
export default function CustomerAccount() {
  const { customer, updateCustomer, logoutCustomer } = useSession();
  const [orders, setOrders] = useState(null);
  const [profile, setProfile] = useState({ name: '', default_address: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const { t, formatDate } = useI18n();
  useSeo({ title: t('account.seoTitle'), noindex: true });

  useEffect(() => {
    if (!customer) return;
    setProfile({ name: customer.name, default_address: customer.default_address || '' });
    get('/customer/orders').then((r) => setOrders(r.orders), () => setOrders([]));
  }, [customer]);

  if (customer === undefined) return <LoadingScreen label={t('common.loading')} />;

  const back = <p className="text-[11px] font-bold tracking-wider text-stone-400 uppercase">{t('nav.forShoppers')}</p>;

  if (!customer) {
    return (
      <>
      <SiteHeader />
      <div className="mx-auto max-w-md px-4 py-8">
        {back}
        <div className="card mt-6 space-y-3 p-6 text-center">
          <UserRound size={40} className="mx-auto text-brand" />
          <h1 className="text-lg font-bold">{t('account.trackTitle')}</h1>
          <p className="text-sm text-stone-600">
            {rich(t('account.trackBody'), { b: (x) => <b>{x}</b> })}
          </p>
          <p className="text-xs text-stone-400">
            {rich(t('account.ownShop'), { link: (x) => <Link to="/login" className="underline">{x}</Link> })}
          </p>
          <button onClick={() => setAuthOpen(true)} className="btn-brand w-full">{t('account.loginOrSignup')}</button>
        </div>
        {authOpen && <CustomerAuthModal onClose={() => setAuthOpen(false)} />}
      </div>
      </>
    );
  }

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateCustomer(profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <SiteHeader />
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        {back}
        <button onClick={logoutCustomer} className="btn-ghost py-1.5 text-xs">
          <LogOut size={14} /> {t('common.logOut')}
        </button>
      </div>

      <form onSubmit={save} className="card space-y-3 p-5">
        <h1 className="text-lg font-bold">{t('account.hi', { name: customer.name })}</h1>
        <p className="text-xs text-stone-500">{t('account.mobile', { phone: `+${customer.phone}` })}</p>
        <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder={t('account.name')} required />
        <textarea
          className="input"
          rows={2}
          value={profile.default_address}
          onChange={(e) => setProfile({ ...profile, default_address: e.target.value })}
          placeholder={t('account.defaultAddress')}
        />
        <button disabled={saving} className="btn-brand w-full">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {saved ? t('common.saved') : t('account.saveDetails')}
        </button>
      </form>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-bold">
          <ReceiptText size={18} className="text-brand" /> {t('nav.myOrders')}
        </h2>
        {orders === null && <Loader2 className="mx-auto animate-spin text-stone-400" />}
        {orders?.length === 0 && <p className="card p-6 text-center text-sm text-stone-500">{t('account.noOrders')}</p>}
        {orders?.map((o) => (
          <article key={o.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Link to={`/s/${o.store_slug}`} className="font-semibold hover:text-brand">{o.store_name}</Link>
                <p className="text-xs text-stone-500">
                  #{o.order_code} · {formatDate(o.created_at)}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusMeta[o.status]?.cls}`}>
                {t(`orders.status.${o.status}`)}
              </span>
            </div>
            <p className="mt-2 text-sm text-stone-600">
              {o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ') || o.notes}
            </p>
            <p className="mt-1 text-end font-bold">{formatMoney(o.total, o.currency_symbol)}</p>
          </article>
        ))}
      </section>
    </div>
    </>
  );
}
