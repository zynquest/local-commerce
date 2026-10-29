// Web push to store owners: subscribe, a notification per new order (in the subscriber's language), expired
// subscriptions removed, and one on approval. The network call is replaced by a recorder.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { setPushSender } from '../src/push.js';

const run = Date.now().toString(36);
const slug = `push-${run}`;
let server;
let base;
let owner;
let admin;
let ownerId;
let storeId;
let adminId = null;
const tokens = [];
const sent = [];
let failWith = null;

function client(cookies) {
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}
async function session(type, id) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  tokens.push(hash);
  await query(`INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')`, [hash, type, id]);
  return token;
}
const waitFor = async (fn) => {
  for (let i = 0; i < 40 && !fn(); i++) await new Promise((r) => setTimeout(r, 25));
};

before(async () => {
  await migrate({ log: () => {} });
  Object.assign(config, { vapidPublicKey: 'test-public-key', vapidPrivateKey: 'test-private-key' });
  setPushSender(async (sub, payload) => {
    if (failWith) {
      const err = new Error('gone');
      err.statusCode = failWith;
      throw err;
    }
    sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) });
  });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  let { rows } = await query(`INSERT INTO users (username) VALUES ($1) RETURNING id`, [`push${run}`]);
  ownerId = rows[0].id;
  ({ rows } = await query(
    `INSERT INTO stores (owner_id, slug, name, status, whatsapp_number) VALUES ($1, $2, $3, 'pending_review', $4) RETURNING id`,
    [ownerId, slug, `Push Test ${run}`, `9198${String(Date.now()).slice(-8)}`],
  ));
  storeId = rows[0].id;
  await query(`INSERT INTO products (store_id, sku_id, name, mrp, offer_price) VALUES ($1, 'P0001', 'Butter Bun', 30, 25)`, [storeId]);
  owner = client({ vfl_owner: await session('user', ownerId) });
  ({ rows } = await query(`SELECT id FROM users WHERE role = 'platform_admin'`));
  if (!rows[0]) {
    ({ rows } = await query(`INSERT INTO users (username, password_hash, role) VALUES ($1, 'x', 'platform_admin') RETURNING id`, [`pushadmin${run}`]));
    adminId = rows[0].id;
  }
  admin = client({ vfl_admin: await session('admin', rows[0].id) });
});

after(async () => {
  await query('DELETE FROM sessions WHERE token_hash = ANY($1)', [tokens]);
  await query('DELETE FROM users WHERE id = $1', [ownerId]);
  if (adminId) await query('DELETE FROM users WHERE id = $1', [adminId]);
  server.close();
  await pool.end();
});

const sub = (n) => ({ endpoint: `https://push.example.test/${run}/${n}`, keys: { p256dh: 'BPublicKeyExample', auth: 'authSecret' } });

describe('web push', () => {
  test('the public key is published; owners subscribe (anonymous users cannot)', async () => {
    assert.equal((await client({})('GET', '/api/config')).body.vapidPublicKey, 'test-public-key');
    assert.equal((await client({})('POST', '/api/merchant/push/subscribe', { subscription: sub(1) })).status, 401);
    assert.equal((await owner('POST', '/api/merchant/push/subscribe', { subscription: sub(1), language: 'hi' })).status, 200);
    assert.equal((await owner('POST', '/api/merchant/push/subscribe', { subscription: { endpoint: 'http://insecure.test/x', keys: { p256dh: 'a', auth: 'b' } } })).status, 400);
  });

  test('approval notifies the owner', async () => {
    const r = await admin('POST', `/api/platform/stores/${storeId}/approve`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await waitFor(() => sent.some((s) => s.tag === 'store-approved'));
    const n = sent.find((s) => s.tag === 'store-approved');
    assert.ok(n, 'approval notification sent');
    assert.equal(n.url, '/merchant');
  });

  test('a new order notifies the owner once, in their language; a retry does not', async () => {
    const order = { order_code: `ORD-${run.toUpperCase().slice(-8).padStart(8, 'X')}`, items: [{ sku_id: 'P0001', quantity: 2, unit_price: 25 }], customer_name: 'Asha', notes: '' };
    const r = await client({})('POST', `/api/stores/${slug}/orders`, order);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await waitFor(() => sent.some((s) => s.tag === `order-${order.order_code}`));
    const n = sent.filter((s) => s.tag === `order-${order.order_code}`);
    assert.equal(n.length, 1);
    assert.match(n[0].title, new RegExp(order.order_code));
    assert.match(n[0].title, /नया ऑर्डर/, 'Hindi, the language the owner subscribed with');
    assert.match(n[0].body, /Asha/);
    assert.equal(n[0].url, '/merchant?tab=orders');
    await client({})('POST', `/api/stores/${slug}/orders`, order);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(sent.filter((s) => s.tag === `order-${order.order_code}`).length, 1, 'retry of the same order: no second push');
  });

  test('a subscription the push service reports gone is deleted; unsubscribe works', async () => {
    failWith = 410;
    await admin('POST', `/api/platform/stores/${storeId}/suspend`, { remarks: 'Testing push cleanup' });
    await admin('POST', `/api/platform/stores/${storeId}/reinstate`, {});
    await waitFor(() => false);
    const { rows } = await query('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [ownerId]);
    assert.equal(rows[0].n, 0);
    failWith = null;
    await owner('POST', '/api/merchant/push/subscribe', { subscription: sub(2) });
    assert.equal((await owner('POST', '/api/merchant/push/unsubscribe', { endpoint: sub(2).endpoint })).status, 200);
    const again = await query('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [ownerId]);
    assert.equal(again.rows[0].n, 0);
  });
});
