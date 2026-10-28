// Store owners on OWNER_LOGIN=email: one email + code flow for sign-up and login, the WhatsApp number given when
// submitting for approval, and approval marking that number verified.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { importSeeds } from '../src/seed/importer.js';

const run = Date.now().toString(36);
const digits = String(Date.now()).slice(-8);
const emailA = `owner-a-${run}@example.com`;
const emailB = `owner-b-${run}@example.com`;
const emailC = `owner-c-${run}@example.com`;
const waC = `6${digits}7`.slice(0, 10);
const waA = `9${digits}4`.slice(0, 10);
const waB = `8${digits}5`.slice(0, 10);
let server;
let base;
let admin;
let adminId = null;
const saved = config.ownerLogin;

function client(initialCookies = {}) {
  const cookies = { ...initialCookies };
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [k, v] = c.split(';')[0].split('=');
      if (v) cookies[k] = v;
      else delete cookies[k];
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}
const codeFor = async (c, email) => {
  const r = await c('POST', '/api/otp/request', { email, purpose: 'owner_login' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.devCode;
};
const ownerA = client();
const ownerB = client();

before(async () => {
  config.ownerLogin = 'email';
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  let { rows } = await query(`SELECT id FROM users WHERE role = 'platform_admin'`);
  if (!rows[0]) {
    ({ rows } = await query(`INSERT INTO users (username, password_hash, role) VALUES ($1, 'x', 'platform_admin') RETURNING id`, [`eadmin${run}`]));
    adminId = rows[0].id;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at) VALUES ($1, 'admin', $2, now() + interval '1 hour')`, [
    crypto.createHash('sha256').update(token).digest('hex'),
    rows[0].id,
  ]);
  admin = client({ vfl_admin: token });
});

after(async () => {
  config.ownerLogin = saved;
  await query('DELETE FROM users WHERE email = ANY($1)', [[emailA, emailB, emailC]]);
  await query('DELETE FROM otp_codes WHERE phone = ANY($1)', [[emailA, emailB, emailC]]);
  await query(`DELETE FROM users u USING stores s WHERE s.owner_id = u.id AND s.seed_ref = $1`, [`osm:node/e${run}`]);
  if (adminId) await query('DELETE FROM users WHERE id = $1', [adminId]);
  server.close();
  await pool.end();
});

describe('owners: email sign-up and login (OWNER_LOGIN=email)', () => {
  test('the app is told to use email; mobile codes are refused for owners', async () => {
    assert.equal((await ownerA('GET', '/api/config')).body.ownerLogin, 'email');
    const r = await ownerA('POST', '/api/otp/request', { phone: waA, purpose: 'owner_register' });
    assert.equal(r.status, 400);
  });

  test('new email: code → asked for the store → store created with a verified email and no WhatsApp yet', async () => {
    const code = await codeFor(ownerA, emailA.toUpperCase());
    const first = await ownerA('POST', '/api/auth/email', { email: emailA, code });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.needsStore, true, 'the code stays valid for the next call');
    const made = await ownerA('POST', '/api/auth/email', { email: emailA, code, storeName: `Email Kirana ${run}`, businessType: 'shop' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.created, true);
    assert.equal(made.body.user.email, emailA, 'stored lowercased');
    const { rows } = await query(
      'SELECT u.email_verified_at, u.phone, s.status, s.whatsapp_number FROM users u JOIN stores s ON s.owner_id = u.id WHERE u.email = $1',
      [emailA],
    );
    assert.ok(rows[0].email_verified_at, 'email verified by the code');
    assert.equal(rows[0].phone, null);
    assert.equal(rows[0].status, 'draft');
    assert.equal(rows[0].whatsapp_number, null);
  });

  test('existing email logs straight in; a store name sent by mistake is ignored', async () => {
    const again = client();
    const r = await again('POST', '/api/auth/email', { email: emailA, code: await codeFor(again, emailA), storeName: 'Something Else' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.created, false);
    assert.equal(r.body.user.store_name, `Email Kirana ${run}`);
  });
});

describe('owners: WhatsApp number on submission, verified on approval', () => {
  test('submit needs the WhatsApp number; it must not belong to another store', async () => {
    await ownerA('PUT', '/api/merchant/store', { category: 'Grocery', lat: 12.9716, lng: 77.5946, address_text: 'MG Road' });
    assert.equal((await ownerA('POST', '/api/merchant/products', { name: 'Dal', mrp: 100, list_price: 90 })).status, 201);
    const noWa = await ownerA('POST', '/api/merchant/store/submit', {});
    assert.equal(noWa.status, 400);
    assert.match(noWa.body.error, /WhatsApp/);

    // Another owner already uses waB for orders.
    await ownerB('POST', '/api/auth/email', { email: emailB, code: await codeFor(ownerB, emailB), storeName: `Email Bakery ${run}` });
    assert.equal((await ownerB('PUT', '/api/merchant/store/whatsapp', { phone: waB })).status, 200);
    const clash = await ownerA('POST', '/api/merchant/store/submit', { whatsapp_number: waB });
    assert.equal(clash.status, 409);
    assert.ok(clash.body.fields?.whatsapp_number);

    const ok = await ownerA('POST', '/api/merchant/store/submit', { whatsapp_number: waA, note: 'Please approve' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.store.status, 'pending_review');
    assert.equal(ok.body.store.whatsapp_number, `91${waA}`);
    assert.equal(ok.body.store.whatsapp_verified, false, 'verified only on approval');
  });

  test('approval marks the WhatsApp number verified and makes it the owner’s verified mobile', async () => {
    const { rows } = await query('SELECT s.id FROM stores s JOIN users u ON u.id = s.owner_id WHERE u.email = $1', [emailA]);
    const list = await admin('GET', `/api/platform/stores?status=pending_review&q=${encodeURIComponent(emailA)}`);
    assert.equal(list.body.stores[0]?.owner_email, emailA, 'admin can find the store by owner email');
    assert.equal((await admin('POST', `/api/platform/stores/${rows[0].id}/approve`, {})).status, 200);
    const after = await query(
      'SELECT s.whatsapp_verified, u.phone, u.phone_verified_at FROM stores s JOIN users u ON u.id = s.owner_id WHERE s.id = $1',
      [rows[0].id],
    );
    assert.equal(after.rows[0].whatsapp_verified, true);
    assert.equal(after.rows[0].phone, `91${waA}`);
    assert.ok(after.rows[0].phone_verified_at);
    const pub = await ownerA('GET', '/api/merchant/store');
    assert.equal(pub.body.store.status, 'approved');
  });

  test('after approval the owner cannot change the number (support corrects it)', async () => {
    const r = await ownerA('PUT', '/api/merchant/store/whatsapp', { phone: `7${digits}6`.slice(0, 10) });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(r.body.error, /can't be changed after approval/);
  });
});

describe('seeded listing handed over by email', () => {
  test('admin hands over with email + WhatsApp mobile; the owner logs in with the email and the store takes orders', async () => {
    await importSeeds([{ source: 'osm', source_ref: `osm:node/e${run}`, name: `Seed Sweets ${run}`, category: 'sweets', lat: '13.0101', lng: '77.5101' }]);
    const { rows } = await query('SELECT id FROM stores WHERE seed_ref = $1', [`osm:node/e${run}`]);
    const taken = await admin('POST', `/api/platform/stores/${rows[0].id}/claim`, { email: emailA });
    assert.equal(taken.status, 409, 'an email that already has a store is refused');
    const r = await admin('POST', `/api/platform/stores/${rows[0].id}/claim`, { email: emailC, phone: waC });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const owner = client();
    const login = await owner('POST', '/api/auth/email', { email: emailC, code: await codeFor(owner, emailC) });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.user.store_name, `Seed Sweets ${run}`);
    const store = (await owner('GET', '/api/merchant/store')).body.store;
    assert.equal(store.whatsapp_number, `91${waC}`);
    assert.equal(store.whatsapp_verified, true, 'handed over in person');
    assert.equal(store.status, 'approved');
  });
});
