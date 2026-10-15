// Offline-first order recording. Orders are written to an IndexedDB outbox, then POSTed to the API
// when online. The server is idempotent on order_code, so retries never create duplicates.
import { api } from '../lib/api.js';
import { db } from '../lib/db.js';

const listeners = new Set();
const emit = async () => {
  const count = await db.outbox.count();
  listeners.forEach((fn) => fn(count));
};

export function onOutboxChange(fn) {
  listeners.add(fn);
  emit();
  return () => listeners.delete(fn);
}

export async function queueOrder(slug, payload) {
  await db.outbox.put({ order_code: payload.order_code, slug, payload, createdAt: Date.now(), attempts: 0 });
  emit();
  return syncOutbox();
}

let syncing = null;

export function syncOutbox() {
  if (syncing) return syncing;
  syncing = (async () => {
    if (!navigator.onLine) return;
    const pending = await db.outbox.orderBy('createdAt').toArray();
    for (const entry of pending) {
      try {
        await api(`/stores/${encodeURIComponent(entry.slug)}/orders`, { method: 'POST', body: entry.payload });
        await db.outbox.delete(entry.order_code);
      } catch (err) {
        // Network/server/rate-limit errors: keep for retry. Other 4xx: the order can never succeed.
        if (err.status === 0 || err.status >= 500 || err.status === 429) {
          await db.outbox.update(entry.order_code, { attempts: (entry.attempts || 0) + 1 });
          if (err.status === 0) break;
        } else {
          console.warn('[outbox] dropping order', entry.order_code, err.message);
          await db.outbox.delete(entry.order_code);
        }
      }
    }
  })().finally(() => {
    syncing = null;
    emit();
  });
  return syncing;
}

/** Starts background sync: on load, when connectivity returns, and every minute. */
export function startOutboxSync() {
  syncOutbox();
  window.addEventListener('online', () => syncOutbox());
  setInterval(() => syncOutbox(), 60_000);
}
