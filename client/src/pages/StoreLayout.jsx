import { Outlet, useParams } from 'react-router-dom';
import { RefreshCw, WifiOff } from 'lucide-react';
import { StoreProvider, useStore } from '../context/StoreContext.jsx';
import { CartProvider } from '../context/CartContext.jsx';
import CartDrawer from '../components/CartDrawer.jsx';
import { LoadingScreen, MessageScreen, OfflineBanner } from '../components/StatusScreens.jsx';
import { rich, useT } from '../i18n/index.jsx';

function StoreGate() {
  const t = useT();
  const { status, error, slug, store, expiresAt, refresh, refreshing } = useStore();
  const retry = (
    <button onClick={refresh} disabled={refreshing} className="btn-brand mt-4">
      <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {t('common.tryAgain')}
    </button>
  );

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'notfound')
    return (
      <MessageScreen title={t('status.storeNotFound')}>
        {rich(t('status.storeNotFoundBody', { slug }), { b: (x) => <b>{x}</b> })}
      </MessageScreen>
    );
  if (status === 'expired' || status === 'offline')
    return (
      <MessageScreen title={status === 'expired' ? t('status.expiredTitle') : t('status.offlineTitle')} action={false}>
        <WifiOff size={32} className="mx-auto mb-2 text-stone-400" />
        {status === 'expired'
          ? t('status.expiredBody')
          : t('status.offlineBody')}
        <div>{retry}</div>
      </MessageScreen>
    );
  if (status === 'error')
    return (
      <MessageScreen title={t('status.loadFailed')} action={false}>
        {error}
        <div>{retry}</div>
      </MessageScreen>
    );
  return (
    <CartProvider key={slug} slug={slug} store={store}>
      <OfflineBanner expiresAt={expiresAt} />
      <Outlet />
      <CartDrawer />
    </CartProvider>
  );
}

/** Path routing: /s/:storeSlug/* */
export function PathStoreLayout() {
  const { storeSlug } = useParams();
  return (
    <StoreProvider key={storeSlug} slug={storeSlug} basePath={`/s/${storeSlug}`}>
      <StoreGate />
    </StoreProvider>
  );
}

/** Custom-domain routing: the store is served at the domain root. */
export function DomainStoreLayout({ slug }) {
  return (
    <StoreProvider slug={slug} basePath="">
      <StoreGate />
    </StoreProvider>
  );
}
