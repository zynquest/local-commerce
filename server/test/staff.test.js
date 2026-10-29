// Staff (sales reps): the platform admin creates them (generated password + 6-character rep ID); owners enter the
// rep ID when submitting; staff sign in at the admin console and can only see, approve or reject those stores.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const run = Date.now().toString(36);
let server;
let base;
let admin;
let adminId = null;
const owners = [];
const stores = {};
const tokens = [];
const staffIds = [];

function client(cookies = {}) {
  const jar = { ...cookies };
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      jar[k] = v;
    }
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
/** A draft store ready to submit (name, WhatsApp, location, type, one product). */
async function draftStore(key) {
  const { rows } = await query(`INSERT INTO users (username) VALUES ($1) RETURNING id`, [`rep${key}${run}`]);
  owners.push(rows[0].id);
  const s = await query(
    `INSERT INTO stores (owner_id, slug, name, category, whatsapp_number, lat, lng, city)
     VALUES ($1, $2, $3, 'Bakery', $4, 12.97, 77.6, 'Indiranagar') RETURNING id`,
    [rows[0].id, `rep-${key}-${run}`, `Rep Test ${key} ${run}`, `91${String(7000000000 + Math.floor(Math.random() * 999999999)).slice(0, 10)}`],
  );
  await query(`INSERT INTO products (store_id, sku_id, name, mrp, offer_price) VALUES ($1, 'P0001', 'Bun', 30, 25)`, [s.rows[0].id]);
  stores[key] = { id: s.rows[0].id, owner: client({ vfl_owner: await session('user', rows[0].id) }) };
}

before(async () => {
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  let { rows } = await query(`SELECT id FROM users WHERE role = 'platform_admin'`);
  if (!rows[0]) {
    ({ rows } = await query(`INSERT INTO users (username, password_hash, role) VALUES ($1, 'x', 'platform_admin') RETURNING id`, [`repadmin${run}`]));
    adminId = rows[0].id;
  }
  admin = client({ vfl_admin: await session('admin', rows[0].id) });
  for (const k of ['a', 'b', 'c']) await draftStore(k);
});

after(async () => {
  await query('DELETE FROM sessions WHERE token_hash = ANY($1)', [tokens]);
  await query('DELETE FROM users WHERE id = ANY($1)', [[...owners, ...staffIds]]);
  if (adminId) await query('DELETE FROM users WHERE id = $1', [adminId]);
  server.close();
  await pool.end();
});

const reps = {};

describe('staff (sales reps)', () => {
  test('the admin creates staff with a generated password and a 6-character rep ID', async () => {
    for (const [key, extra] of [['ravi', { name: 'Ravi Kumar', phone: '9876512340' }], ['sita', {}]]) {
      const r = await admin('POST', '/api/platform/staff', { username: `${key}${run}`, ...extra });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.match(r.body.staff.rep_code, /^[A-Z0-9]{6}$/);
      assert.ok(r.body.password.length >= 12);
      staffIds.push(r.body.staff.id);
      reps[key] = { ...r.body.staff, password: r.body.password };
    }
    assert.equal(reps.ravi.name, 'Ravi Kumar');
    assert.equal(reps.ravi.phone, '919876512340');
    assert.notEqual(reps.ravi.rep_code, reps.sita.rep_code);
    assert.equal((await admin('POST', '/api/platform/staff', { username: `ravi${run}` })).status, 409, 'username taken');
    assert.equal((await admin('POST', '/api/platform/staff', { username: 'x' })).status, 400, 'username too short');
    const list = await admin('GET', '/api/platform/staff');
    assert.ok(list.body.staff.some((s) => s.username === `ravi${run}`));
  });

  test('owners submit with a rep ID (any case); an unknown ID is refused', async () => {
    const bad = await stores.a.owner('POST', '/api/merchant/store/submit', { sales_rep_code: 'ZZZZZZ' });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fields?.sales_rep_code);
    assert.equal((await stores.a.owner('POST', '/api/merchant/store/submit', { sales_rep_code: 'AB12' })).status, 400, 'format');
    const ok = await stores.a.owner('POST', '/api/merchant/store/submit', { sales_rep_code: reps.ravi.rep_code.toLowerCase() });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.store.sales_rep_code, reps.ravi.rep_code);
    assert.equal((await stores.b.owner('POST', '/api/merchant/store/submit', { sales_rep_code: reps.sita.rep_code })).status, 200);
    assert.equal((await stores.c.owner('POST', '/api/merchant/store/submit', {})).status, 200, 'no rep ID is fine');
  });

  test('staff sign in at the console and see only their own approval requests', async () => {
    const ravi = client();
    const login = await ravi('POST', '/api/platform/login', { username: `ravi${run}`, password: reps.ravi.password });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.deepEqual([login.body.admin.role, login.body.admin.rep_code], ['staff', reps.ravi.rep_code]);
    const list = await ravi('GET', '/api/platform/stores');
    assert.deepEqual(list.body.stores.map((s) => s.id), [stores.a.id]);
    const allMine = await ravi('GET', '/api/platform/stores?status=approved');
    assert.deepEqual(allMine.body.stores.map((s) => s.id), [stores.a.id], 'other filters fall back to their queue');
    assert.equal((await ravi('GET', `/api/platform/stores/${stores.a.id}`)).status, 200);
    assert.equal((await ravi('GET', `/api/platform/stores/${stores.b.id}`)).status, 404, "another rep's store");
    assert.equal((await ravi('GET', `/api/platform/stores/${stores.c.id}`)).status, 404, 'a store without a rep');
    reps.ravi.client = ravi;
  });

  test('staff can approve or reject only their stores, and nothing else', async () => {
    const ravi = reps.ravi.client;
    assert.equal((await ravi('POST', `/api/platform/stores/${stores.b.id}/approve`, {})).status, 404);
    const ok = await ravi('POST', `/api/platform/stores/${stores.a.id}/approve`, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.store.status, 'approved');
    const { rows } = await query(`SELECT u.username FROM store_reviews r JOIN users u ON u.id = r.actor_id WHERE r.store_id = $1 AND r.action = 'approved'`, [stores.a.id]);
    assert.equal(rows[0].username, `ravi${run}`, 'review history names the rep');
    for (const [method, path, body] of [
      ['POST', `/api/platform/stores/${stores.a.id}/suspend`, { remarks: 'not allowed for staff' }],
      ['GET', '/api/platform/stats'],
      ['GET', '/api/platform/qr'],
      ['GET', '/api/platform/staff'],
      ['POST', '/api/platform/staff', { username: `evil${run}` }],
      ['GET', '/api/platform/orders'],
      ['PATCH', `/api/platform/stores/${stores.a.id}/plan`, { plan: 'paid', sku_limit: 500 }],
      ['PATCH', `/api/platform/stores/${stores.a.id}/details`, { name: 'Hijacked' }],
    ]) {
      assert.equal((await ravi(method, path, body)).status, 403, `${method} ${path}`);
    }
    const sita = client();
    await sita('POST', '/api/platform/login', { username: `sita${run}`, password: reps.sita.password });
    const reject = await sita('POST', `/api/platform/stores/${stores.b.id}/reject`, { remarks: 'Please add a clear logo' });
    assert.equal(reject.body.store.status, 'rejected');
    assert.equal((await sita('GET', '/api/platform/stores')).body.stores.length, 0, 'queue empty once decided');
    assert.equal((await sita('GET', '/api/platform/stores?status=all')).body.stores.length, 1, 'their stores, any status');
  });

  test('the admin sees the rep on stores; reset and delete sign the rep out', async () => {
    const list = await admin('GET', '/api/platform/stores?q=Rep%20Test');
    const a = list.body.stores.find((s) => s.id === stores.a.id);
    assert.equal(a.sales_rep_code, reps.ravi.rep_code);
    assert.equal(a.sales_rep_name, 'Ravi Kumar');
    const reset = await admin('POST', `/api/platform/staff/${reps.ravi.id}/reset-password`, {});
    assert.ok(reset.body.password);
    assert.equal((await reps.ravi.client('GET', '/api/platform/me')).status, 401, 'old session ended');
    assert.equal((await admin('DELETE', `/api/platform/staff/${reps.sita.id}`)).status, 200);
    const login = await client()('POST', '/api/platform/login', { username: `sita${run}`, password: reps.sita.password });
    assert.equal(login.status, 401);
    const detail = await admin('GET', `/api/platform/stores/${stores.b.id}`);
    assert.equal(detail.body.store.sales_rep_code, reps.sita.rep_code, 'the store keeps the rep ID');
    assert.equal(detail.body.store.sales_rep_name, null);
  });
});
