// Printed QR codes: admin generates a pool, links a code to a store (by its link), removes it; scans of /q/<code>
// redirect to the store page (or show a "not linked yet" page) and are counted.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const run = Date.now().toString(36);
const slug = `qr-test-${run}`;
let server;
let base;
let admin;
let adminId = null;
let ownerId;
const made = [];

function client(cookies = {}) {
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* html */
    }
    return { status: res.status, body: json, text, location: res.headers.get('location') };
  };
}
const anon = client();

before(async () => {
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  let { rows } = await query(`SELECT id FROM users WHERE role = 'platform_admin'`);
  if (!rows[0]) {
    ({ rows } = await query(`INSERT INTO users (username, password_hash, role) VALUES ($1, 'x', 'platform_admin') RETURNING id`, [`qadmin${run}`]));
    adminId = rows[0].id;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at) VALUES ($1, 'admin', $2, now() + interval '1 hour')`, [
    crypto.createHash('sha256').update(token).digest('hex'),
    rows[0].id,
  ]);
  admin = client({ vfl_admin: token });
  ({ rows } = await query(`INSERT INTO users (username) VALUES ($1) RETURNING id`, [`qrowner${run}`]));
  ownerId = rows[0].id;
  await query(`INSERT INTO stores (owner_id, slug, name, status) VALUES ($1, $2, $3, 'approved')`, [ownerId, slug, `QR Test Store ${run}`]);
});

after(async () => {
  await query('DELETE FROM qr_codes WHERE code = ANY($1)', [made]);
  await query('DELETE FROM users WHERE id = $1', [ownerId]);
  if (adminId) await query('DELETE FROM users WHERE id = $1', [adminId]);
  server.close();
  await pool.end();
});

describe('printed QR codes', () => {
  test('only the admin can manage codes; batches are 1–500', async () => {
    assert.equal((await anon('POST', '/api/platform/qr', { count: 3 })).status, 401);
    assert.equal((await admin('POST', '/api/platform/qr', { count: 501 })).status, 400);
    assert.equal((await admin('POST', '/api/platform/qr', { count: 0 })).status, 400);
  });

  test('generates unique random 8-digit codes, listed as free', async () => {
    const r = await admin('POST', '/api/platform/qr', { count: 5 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.codes.length, 5);
    assert.equal(new Set(r.body.codes).size, 5);
    for (const c of r.body.codes) assert.match(c, /^[1-9]\d{7}$/);
    made.push(...r.body.codes);
    const list = await admin('GET', '/api/platform/qr?filter=free');
    for (const c of r.body.codes) assert.ok(list.body.codes.some((x) => x.code === c && !x.store_id));
    assert.equal(list.body.base, 'https://sonsari.in');
  });

  test('a free code shows the "not linked yet" page; an unknown code is a 404', async () => {
    const free = await anon('GET', `/q/${made[0]}`);
    assert.equal(free.status, 200);
    assert.match(free.text, /isn&#39;t linked|isn't linked/);
    assert.equal((await anon('GET', '/q/12345')).status, 404);
    assert.equal((await anon('GET', '/api/qr/99999999')).status, 404);
  });

  test('link by store link (any form), refuse a second link, scan redirects and is counted, remove frees it', async () => {
    const [a, b] = made;
    const bad = await admin('POST', `/api/platform/qr/${a}/assign`, { store: '/s/no-such-store-here' });
    assert.equal(bad.status, 404);
    const ok = await admin('POST', `/api/platform/qr/${a}/assign`, { store: `/s/${slug}` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.store.slug, slug);
    assert.equal((await admin('POST', `/api/platform/qr/${b}/assign`, { store: `https://sonsari.in/s/${slug}/` })).status, 200, 'full URL works; a store may have several codes');
    assert.equal((await admin('POST', `/api/platform/qr/${a}/assign`, { store: slug })).status, 409, 'already linked');

    // By the store's name (any case), as the admin types it; a name shared by two stores must be picked from the list.
    const [c] = made.slice(2);
    const byName = await admin('POST', `/api/platform/qr/${c}/assign`, { store: `qr test store ${run}` });
    assert.equal(byName.status, 200, JSON.stringify(byName.body));
    assert.equal(byName.body.store.slug, slug);
    assert.equal((await admin('POST', `/api/platform/qr/${c}/unassign`, {})).status, 200);
    const { rows: twinOwner } = await query(`INSERT INTO users (username) VALUES ($1) RETURNING id`, [`qrtwin${run}`]);
    await query(`INSERT INTO stores (owner_id, slug, name, status) VALUES ($1, $2, $3, 'approved')`, [twinOwner[0].id, `${slug}-two`, `QR Test Store ${run}`]);
    const twin = await admin('POST', `/api/platform/qr/${c}/assign`, { store: `QR Test Store ${run}` });
    assert.equal(twin.status, 409);
    assert.match(twin.body.fields?.store || twin.body.error, /2 stores are called/);
    await query('DELETE FROM users WHERE id = $1', [twinOwner[0].id]);
    assert.equal((await admin('POST', `/api/platform/qr/${c}/assign`, { store: 'No Such Shop Anywhere' })).status, 404);

    const scan = await anon('GET', `/q/${a}`);
    assert.equal(scan.status, 302);
    assert.equal(scan.location, `/s/${slug}`);
    const api = await anon('GET', `/api/qr/${a}`);
    assert.equal(api.body.slug, slug, 'in-app fallback');
    const { rows } = await query('SELECT scans, last_scanned_at FROM qr_codes WHERE code = $1', [a]);
    assert.equal(rows[0].scans, 3, 'the earlier scan while it was free counts too');
    assert.ok(rows[0].last_scanned_at);

    const linked = await admin('GET', `/api/platform/qr?filter=assigned&q=${encodeURIComponent(`QR Test Store ${run}`)}`);
    assert.deepEqual(linked.body.codes.map((c) => c.code).sort(), [a, b].sort());

    assert.equal((await admin('POST', `/api/platform/qr/${a}/unassign`, {})).status, 200);
    assert.equal((await anon('GET', `/q/${a}`)).status, 200, 'free again');
    assert.equal((await admin('POST', `/api/platform/qr/${a}/assign`, { store: slug })).status, 200, 'can be linked again');
  });

  test("the owner sees their store's linked codes (for printing and sharing); admins see the business type", async () => {
    const [a, b] = made;
    const token = crypto.randomBytes(32).toString('base64url');
    await query(`INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at) VALUES ($1, 'user', $2, now() + interval '1 hour')`, [
      crypto.createHash('sha256').update(token).digest('hex'),
      ownerId,
    ]);
    const owner = client({ vfl_owner: token });
    const mine = await owner('GET', '/api/merchant/qr');
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.deepEqual(mine.body.codes.map((c) => c.code).sort(), [a, b].sort());
    assert.equal(mine.body.base, 'https://sonsari.in');
    assert.equal((await anon('GET', '/api/merchant/qr')).status, 401);
    const linked = await admin('GET', `/api/platform/qr?filter=assigned&q=${a}`);
    assert.equal(linked.body.codes[0].store_business_type, 'shop');
  });

  test('deleting a store frees its codes', async () => {
    const [, b] = made;
    await query('DELETE FROM stores WHERE owner_id = $1', [ownerId]);
    const r = await anon('GET', `/q/${b}`);
    assert.equal(r.status, 200);
    const list = await admin('GET', '/api/platform/qr?filter=free');
    assert.ok(list.body.codes.some((x) => x.code === b));
  });
});
