import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import StoreHome from './pages/StoreHome.jsx';
import ProductDetail from './pages/ProductDetail.jsx';
import { DomainStoreLayout, PathStoreLayout } from './pages/StoreLayout.jsx';
import InstallBanner from './components/InstallBanner.jsx';
import { LoadingScreen, MessageScreen } from './components/StatusScreens.jsx';
import { PLATFORM } from './config.js';
import { get } from './lib/api.js';
import { useT } from './i18n/index.jsx';

// Shoppers only download the storefront; everything else loads on demand.
const Landing = lazy(() => import('./pages/Landing.jsx'));
const StoreDirectory = lazy(() => import('./pages/StoreDirectory.jsx'));
const OwnerAuth = lazy(() => import('./pages/OwnerAuth.jsx'));
const MerchantDashboard = lazy(() => import('./pages/MerchantDashboard.jsx'));
const AdminLogin = lazy(() => import('./pages/AdminLogin.jsx'));
const AdminConsole = lazy(() => import('./pages/AdminConsole.jsx'));
const CustomerAccount = lazy(() => import('./pages/CustomerAccount.jsx'));
const QrRedirect = lazy(() => import('./pages/QrRedirect.jsx'));

const isPlatformHost = (host) =>
  PLATFORM.hosts.includes(host) || PLATFORM.hostSuffixes.some((s) => host.endsWith(s)) || /^\d+\.\d+\.\d+\.\d+$/.test(host);

/**
 * New pages open at the top (React Router keeps the old scroll position otherwise, so a store opened from far down
 * the home page showed its bottom). Back/forward (POP) is left to the browser so returning keeps your place, and
 * #anchor links still jump to their section.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navType = useNavigationType();
  useEffect(() => {
    if (navType !== 'POP' && !hash) window.scrollTo(0, 0);
  }, [pathname, hash, navType]);
  return null;
}

function NotFound() {
  const t = useT();
  return <MessageScreen title={t('status.pageNotFound')}>{t('status.pageNotFoundBody')}</MessageScreen>;
}

const storeRoutes = (
  <>
    <Route index element={<StoreHome />} />
    <Route path="p/:skuId" element={<ProductDetail />} />
  </>
);

/**
 * Routing:
 *  - Platform hosts: "/" landing, "/stores", "/register", "/login", "/merchant" (store owners),
 *    "/admin" (platform admin), "/account" (shoppers), "/s/:storeSlug/…"
 *  - Custom domains (custom-store plan): the mapped store is served at "/".
 */
export default function App() {
  const host = window.location.hostname.toLowerCase();
  const platform = isPlatformHost(host);
  const [domainSlug, setDomainSlug] = useState(platform ? null : undefined);

  useEffect(() => {
    if (platform) return;
    const key = `domain:${host}`;
    get(`/domains/${encodeURIComponent(host)}`)
      .then(({ slug }) => {
        localStorage.setItem(key, slug);
        setDomainSlug(slug);
      })
      .catch((err) => setDomainSlug(err.status === 0 ? localStorage.getItem(key) : null)); // offline: last known mapping
  }, [host, platform]);

  if (domainSlug === undefined) return <LoadingScreen />;

  return (
    <BrowserRouter>
      <ScrollToTop />
      {/* "Install the app" bar on phones. Not on merchants' custom domains: the manifest is the platform's. */}
      <InstallBanner enabled={platform} />
      <Suspense fallback={<LoadingScreen label="Loading…" />}>
        <Routes>
          {domainSlug ? (
            <Route path="/" element={<DomainStoreLayout slug={domainSlug} />}>
              {storeRoutes}
            </Route>
          ) : (
            <Route path="/" element={<Landing />} />
          )}
          <Route path="/stores" element={<StoreDirectory />} />
          <Route path="/register" element={<OwnerAuth mode="register" />} />
          <Route path="/login" element={<OwnerAuth mode="login" />} />
          <Route path="/merchant" element={<MerchantDashboard />} />
          <Route path="/admin" element={<AdminConsole />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/account" element={<CustomerAccount />} />
          <Route path="/q/:code" element={<QrRedirect />} />
          <Route path="/s/:storeSlug" element={<PathStoreLayout />}>
            {storeRoutes}
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
