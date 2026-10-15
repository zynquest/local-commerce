import Dexie from 'dexie';

export const db = new Dexie('vocal-for-local');

// v1 (Google Sheets era) tables are dropped.
db.version(1).stores({ products: '[store+sku_id], store, category', configs: 'store', meta: 'key' });
db.version(2).stores({
  products: null,
  configs: null,
  meta: null,
  catalogs: 'slug', // { slug, store, products, version, fetchedAt }
  outbox: 'order_code, slug, createdAt', // orders waiting to reach the server
});
