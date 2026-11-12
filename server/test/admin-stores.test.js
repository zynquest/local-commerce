// The platform admin creates a store for an owner (owner's email + the code they read out) and edits stores in the
// owner screens ("admin mode"). Staff can do neither; admin mode ends with the admin's sign-out.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const run = Date.now().toString(36);
const emailNew = `admin-new-${run}@example.com`;
const emailExisting = `admin-old-${run}@example.com`;
let server;
let base;
let admin;
let staff;
let adminId = null;
let adminUsername;
let staffId = null;
const saved = config.ownerLogin;

function client(initialCookies = {}) {
  const cookies = { ...initialCookies };
  const call = async (method, path, body) => {
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
  call.cookies = cookies;
  return call;
}
const sessionFor = async (subjectId) => {
  const token = crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at) VALUES ($1, 'admin', $2, now() + interval '1 hour')`, [
    crypto.createHash('sha256').update(token).digest('hex'),
    subjectId,
  ]);
  return client({ vfl_admin: token });
};
let existingStoreId;

before(async () => {
  config.ownerLogin = 'email';
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  let { rows } = await query(`SELECT id, username FROM users WHERE role = 'platform_admin'`);
  if (!rows[0]) {
    ({ rows } = await query(`INSERT INTO users (username, password_hash, role) VALUES ($1, 'x', 'platform_admin') RETURNING id, username`, [`aadmin${run}`]));
    adminId = rows[0].id;
  }
  adminUsername = rows[0].username;
  admin = await sessionFor(rows[0].id);
  const code = `A${run}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-6).padStart(6, 'Y');
  ({ rows } = await query(`INSERT INTO users (username, password_hash, role, rep_code) VALUES ($1, 'x', 'staff', $2) RETURNING id`, [`astaff${run}`, code]));
  staffId = rows[0].id;
  staff = await sessionFor(staffId);
  // An owner who signed up themselves.
  const self = client();
  const devCode = (await self('POST', '/api/otp/request', { email: emailExisting, purpose: 'owner_login' })).body.devCode;
  const made = await self('POST', '/api/auth/email', { email: emailExisting, code: devCode, storeName: `Old Shop ${run}` });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  ({ rows } = await query('SELECT s.id FROM stores s JOIN users u ON u.id = s.owner_id WHERE u.email = $1', [emailExisting]));
  existingStoreId = rows[0].id;
});

after(async () => {
  config.ownerLogin = saved;
  await query('DELETE FROM users WHERE email = ANY($1)', [[emailNew, emailExisting]]);
  await query('DELETE FROM otp_codes WHERE phone = ANY($1)', [[emailNew, emailExisting]]);
  await query('DELETE FROM users WHERE id = ANY($1)', [[adminId, staffId].filter(Boolean)]);
  server.close();
  await pool.end();
});

describe('platform admin: new stores and admin mode', () => {
  test('new store: the code goes to the owner, their code creates the store and opens the owner screens', async () => {
    const taken = await admin('POST', '/api/platform/owners/otp', { email: emailExisting, storeName: 'Another' });
    assert.equal(taken.status, 409);
    assert.match(taken.body.fields.email, /already has a store/);

    const sent = await admin('POST', '/api/platform/owners/otp', { email: emailNew, storeName: `Admin Made ${run}` });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.ok(sent.body.devCode, 'local test code');
    const wrong = await admin('POST', '/api/platform/stores/new', { email: emailNew, code: '000000', storeName: `Admin Made ${run}` });
    assert.equal(wrong.status, 400);

    const made = await admin('POST', '/api/platform/stores/new', { email: emailNew, code: sent.body.devCode, storeName: `Admin Made ${run}`, businessType: 'shop' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.ok(admin.cookies.vfl_owner, 'owner screens open in this browser');
    const me = await admin('GET', '/api/auth/me');
    assert.equal(me.body.user.email, emailNew);
    assert.equal(me.body.user.store_status, 'draft', 'the normal setup and approval follow');
    assert.equal(me.body.user.acting_admin, adminUsername);
    assert.equal((await admin('GET', '/api/merchant/store')).status, 200);

    const { rows } = await query(`SELECT r.action FROM store_reviews r WHERE r.store_id = $1`, [made.body.store.id]);
    assert.deepEqual(rows.map((r) => r.action), ['created_by_admin']);
    const { rows: u } = await query('SELECT email_verified_at FROM users WHERE email = $1', [emailNew]);
    assert.ok(u[0].email_verified_at, 'the code proved the email');
  });

  test('edit as owner opens an existing store; the owner signing in themselves is not in admin mode', async () => {
    const opened = await admin('POST', `/api/platform/stores/${existingStoreId}/open-as-owner`, {});
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    const me = await admin('GET', '/api/auth/me');
    assert.equal(me.body.user.email, emailExisting);
    assert.equal(me.body.user.acting_admin, adminUsername);
    assert.equal((await admin('POST', '/api/platform/stores/00000000-0000-4000-8000-000000000000/open-as-owner', {})).status, 404);

    const self = client();
    const devCode = (await self('POST', '/api/otp/request', { email: emailExisting, purpose: 'owner_login' })).body.devCode;
    await self('POST', '/api/auth/email', { email: emailExisting, code: devCode });
    assert.equal((await self('GET', '/api/auth/me')).body.user.acting_admin, null);
  });

  test('staff can do neither; owners and shoppers are refused', async () => {
    for (const [path, body] of [
      ['/api/platform/owners/otp', { email: `x${run}@example.com` }],
      ['/api/platform/stores/new', { email: `x${run}@example.com`, code: '123456', storeName: 'Nope' }],
      [`/api/platform/stores/${existingStoreId}/open-as-owner`, {}],
    ]) {
      assert.equal((await staff('POST', path, body)).status, 403, path);
      assert.equal((await client()('POST', path, body)).status, 401, path);
    }
  });

  test("the admin's sign-out also closes the owner screens opened in admin mode", async () => {
    assert.equal((await admin('GET', '/api/auth/me')).status, 200);
    const ownerCookie = admin.cookies.vfl_owner;
    await admin('POST', '/api/platform/logout', {});
    const later = client({ vfl_owner: ownerCookie });
    assert.equal((await later('GET', '/api/auth/me')).status, 401);
  });
});
