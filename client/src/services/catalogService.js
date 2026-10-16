// Store catalog cache: IndexedDB copy, valid for CATALOG_TTL_MS (30 min) then hard-expired.
// Every page load revalidates with the server when online (ETag → cheap 304 when unchanged).
import { CATALOG_TTL_MS } from '../config.js';
import { ApiError, api } from '../lib/api.js';
import { db } from '../lib/db.js';
import { getActiveT } from '../i18n/index.jsx';

export const isExpired = (entry) => !entry || Date.now() - entry.fetchedAt > CATALOG_TTL_MS;

/** { entry, expired }: entry only if still within the TTL; expired entries are deleted. */
export async function getCachedCatalog(slug) {
  const entry = await db.catalogs.get(slug);
  if (entry && isExpired(entry)) {
    await db.catalogs.delete(slug);
    return { entry: null, expired: true };
  }
  return { entry: entry || null, expired: false };
}

/** Fetches the latest catalog. Returns the fresh cache entry; throws ApiError (status 0 = offline). */
export async function fetchCatalog(slug, cached) {
  const res = await api(`/stores/${encodeURIComponent(slug)}`, {
    raw: true,
    headers: cached?.version ? { 'If-None-Match': cached.version } : {},
  }).catch((err) => {
    throw err instanceof ApiError ? err : new ApiError(0, 'Offline');
  });

  if (res.status === 304 && cached) {
    const entry = { ...cached, fetchedAt: Date.now() };
    await db.catalogs.put(entry);
    return entry;
  }
  if (res.status === 404) {
    await db.catalogs.delete(slug);
    throw new ApiError(404, getActiveT()('status.storeNotFound'));
  }
  if (!res.ok) throw new ApiError(res.status, getActiveT()('status.loadFailed'));
  const data = await res.json();
  const entry = {
    slug,
    store: data.store,
    products: data.products,
    services: data.services || [],
    specialists: data.specialists || [],
    version: data.version,
    fetchedAt: Date.now(),
  };
  await db.catalogs.put(entry);
  return entry;
}

/** Housekeeping for stores not visited in a day. (Recently-expired entries are left for
 * getCachedCatalog, so the UI can say "needs a refresh" rather than "never loaded".) */
export async function purgeStaleCatalogs() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  await db.catalogs.filter((c) => c.fetchedAt < cutoff).delete();
}
