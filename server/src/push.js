// Web push notifications to store owners: new orders, new bookings, store approved. Needs a VAPID key pair
// (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, see `npm run push:keys` and Deployment.md); without it push is off and the
// app hides the "Turn on notifications" card.
import webpush from 'web-push';
import { config } from './config.js';
import { query } from './db.js';
import { makeServerT } from './i18n.js';

export const pushEnabled = () => Boolean(config.vapidPublicKey && config.vapidPrivateKey);

let configured = false;
let sender = (sub, payload) => {
  if (!configured) {
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
    configured = true;
  }
  return webpush.sendNotification(sub, payload, { TTL: 24 * 3600, urgency: 'high' });
};
/** Tests swap the network call for a recorder. */
export const setPushSender = (fn) => {
  sender = fn;
};

export async function saveSubscription(userId, sub, language, userAgent) {
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, language, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, language = $5, user_agent = $6`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, language, userAgent?.slice(0, 300) || null],
  );
}

export const removeSubscription = (userId, endpoint) => query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);

/**
 * Sends `build(t)` → { title, body, url, tag } to every phone of the store's owner, each in the language it
 * subscribed with. Subscriptions the push service reports gone (404/410) are deleted. Never throws: a failed
 * notification must not fail the order or booking that triggered it.
 */
export async function notifyStoreOwner(storeId, build) {
  if (!pushEnabled()) return 0;
  try {
    const { rows } = await query(
      `SELECT p.id, p.endpoint, p.p256dh, p.auth, p.language FROM push_subscriptions p
         JOIN stores s ON s.owner_id = p.user_id WHERE s.id = $1`,
      [storeId],
    );
    let sent = 0;
    await Promise.all(
      rows.map(async (r) => {
        const payload = JSON.stringify({ icon: '/icons/icon-192.png', ...build(makeServerT(r.language)) });
        try {
          await sender({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload);
          sent++;
          await query('UPDATE push_subscriptions SET last_ok_at = now() WHERE id = $1', [r.id]);
        } catch (err) {
          if (err?.statusCode === 404 || err?.statusCode === 410) await query('DELETE FROM push_subscriptions WHERE id = $1', [r.id]);
          else console.warn('[push] send failed:', err?.statusCode || err?.message);
        }
      }),
    );
    return sent;
  } catch (err) {
    console.warn('[push] notify failed:', err?.message);
    return 0;
  }
}
