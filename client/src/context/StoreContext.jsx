import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG_TTL_MS } from '../config.js';
import { db } from '../lib/db.js';
import { fetchCatalog, getCachedCatalog, isExpired } from '../services/catalogService.js';
import { loadCatalog } from '../i18n/index.jsx';

const StoreContext = createContext(null);

/**
 * Loads a store catalog.
 *  - Cached copy (< 30 min old) renders instantly and keeps the store fully usable offline.
 *  - Every page load / refresh revalidates with the server when online.
 *  - At 30 minutes the cache hard-expires: refetched if online, otherwise the store is blocked
 *    with a "connect to refresh" screen.
 *
 * status: loading | ready | expired | offline | notfound | error
 * `basePath` is "/s/<slug>" for path routing and "" on a custom domain.
 */
export function StoreProvider({ slug, basePath, children }) {
  const [state, setState] = useState({ status: 'loading', entry: null, error: null });
  const [refreshing, setRefreshing] = useState(false);
  const entryRef = useRef(null);

  const apply = (entry) => {
    entryRef.current = entry;
    setState({ status: 'ready', entry, error: null });
  };

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      apply(await fetchCatalog(slug, entryRef.current));
    } catch (err) {
      const cached = entryRef.current && !isExpired(entryRef.current) ? entryRef.current : null;
      if (err.status === 404) setState({ status: 'notfound', entry: null, error: null });
      else if (cached) setState({ status: 'ready', entry: cached, error: null }); // keep serving the valid cache
      else if (err.status === 0) setState({ status: navigator.onLine ? 'error' : 'offline', entry: null, error: err.message });
      else setState({ status: 'error', entry: null, error: err.message });
    } finally {
      setRefreshing(false);
    }
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    entryRef.current = null;
    setState({ status: 'loading', entry: null, error: null });
    (async () => {
      const { entry: cached, expired } = await getCachedCatalog(slug);
      if (cancelled) return;
      if (cached) apply(cached);
      if (navigator.onLine) refresh();
      else if (!cached) setState({ status: expired ? 'expired' : 'offline', entry: null, error: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, refresh]);

  // Enforce the TTL while the page stays open, and refetch when connectivity returns.
  useEffect(() => {
    const check = async () => {
      const entry = entryRef.current;
      if (!entry || !isExpired(entry)) return;
      if (navigator.onLine) return refresh();
      await db.catalogs.delete(slug);
      entryRef.current = null;
      setState({ status: 'expired', entry: null, error: null });
    };
    const onOnline = () => {
      if (!entryRef.current || isExpired(entryRef.current)) refresh();
    };
    const timer = setInterval(check, 30_000);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', check);
    };
  }, [slug, refresh]);

  const store = state.entry?.store || null;

  useEffect(() => {
    if (store?.order_language && !['en', 'auto'].includes(store.order_language)) loadCatalog(store.order_language).catch(() => {});
  }, [store?.order_language]);

  useEffect(() => {
    const color = store?.theme_color;
    if (color) {
      document.documentElement.style.setProperty('--brand', color);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    }
    if (store?.name) document.title = `${store.name} — Order on WhatsApp`;
    return () => document.documentElement.style.removeProperty('--brand');
  }, [store]);

  const value = useMemo(
    () => ({
      status: state.status,
      error: state.error,
      slug,
      store,
      products: state.entry?.products || [],
      fetchedAt: state.entry?.fetchedAt || null,
      expiresAt: state.entry ? state.entry.fetchedAt + CATALOG_TTL_MS : null,
      refreshing,
      refresh,
      basePath,
      link: (path = '') => `${basePath}${path}` || '/',
    }),
    [state, slug, store, refreshing, refresh, basePath],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
