// Owner claims for seeded listings (OWNER_LOGIN=email): a new owner signs in, finds their shop nearby, asks for it
// with their WhatsApp number, and the platform admin approves (hand-over) or rejects. Staff can't see claims.
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
const emailA = `claim-a-${run}@example.com`;
const emailB = `claim-b-${run}@example.com`;
const emailC = `claim-c-${run}@example.com`;
const waA = `9${digits}6`.slice(0, 10);
const waB = `8${digits}7`.slice(0, 10);
// Near Nandi Hills, away from other test data.
const HERE = { lat: 13.3702, lng: 77.6835 };
const refs = [`osm:node/c${run}1`, `osm:node/c${run}2`];
let server;
let base;
let admin;
let staff;
let adminId = null;
let staffId = null;
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
const codeFor = async (c, email) => (await c('POST', '/api/otp/request', { email, purpose: 'owner_login' })).body.devCode;
const sessionFor = async (subjectId) => {
  const token = crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at) VALUES ($1, 'admin', $2, now() + interval '1 hour')`, [
    crypto.createHash('sha256').update(token).digest('hex'),
    subjectId,
  ]);
  return client({ vfl_admin: token });
};
const ownerA = client();
const ownerB = client();
const ownerC = client();
let slug;
let otherSlug;

before(async () => {
  config.ownerLogin = 'email';
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  let { rows } = await query(`SELECT id FROM users WHERE role = 'platform_admin'`);
  if (!rows[0]) {
    ({ rows } = await query(`INSERT INTO users (username, password_hash, role) VALUES ($1, 'x', 'platform_admin') RETURNING id`, [`cadmin${run}`]));
    adminId = rows[0].id;
  }
  admin = await sessionFor(rows[0].id);
  const code = `C${run}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-6).padStart(6, 'Z');
  ({ rows } = await query(`INSERT INTO users (username, password_hash, role, rep_code) VALUES ($1, 'x', 'staff', $2) RETURNING id`, [`cstaff${run}`, code]));
  staffId = rows[0].id;
  staff = await sessionFor(staffId);
  await importSeeds([
    { source: 'osm', source_ref: refs[0], name: `Nandi Kirana ${run}`, category: 'grocery', locality: 'Testhalli', lat: String(HERE.lat + 0.001), lng: String(HERE.lng) },
    { source: 'osm', source_ref: refs[1], name: `Hill Sweets ${run}`, category: 'sweets', locality: 'Testhalli', lat: String(HERE.lat), lng: String(HERE.lng + 0.002) },
  ]);
  ({ rows } = await query('SELECT slug FROM stores WHERE seed_ref = ANY($1) ORDER BY seed_ref', [refs]));
  [slug, otherSlug] = rows.map((r) => r.slug);
});

after(async () => {
  config.ownerLogin = saved;
  await query('DELETE FROM users WHERE email = ANY($1)', [[emailA, emailB, emailC]]);
  await query('DELETE FROM otp_codes WHERE phone = ANY($1)', [[emailA, emailB, emailC]]);
  await query(`DELETE FROM users u USING stores s WHERE s.owner_id = u.id AND s.seed_ref = ANY($1)`, [refs]);
  await query('DELETE FROM users WHERE id = ANY($1)', [[adminId, staffId].filter(Boolean)]);
  server.close();
  await pool.end();
});

describe('owner claims for seeded listings', () => {
  test('search finds unclaimed listings near the owner, by name too; a location is required', async () => {
    const all = await ownerA('GET', `/api/auth/claimable?lat=${HERE.lat}&lng=${HERE.lng}`);
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.stores.filter((s) => [slug, otherSlug].includes(s.slug)).map((s) => s.slug).sort(), [slug, otherSlug].sort());
    const named = await ownerA('GET', `/api/auth/claimable?lat=${HERE.lat}&lng=${HERE.lng}&q=${encodeURIComponent(`Nandi Kirana ${run}`)}`);
    assert.deepEqual(named.body.stores.map((s) => s.slug), [slug]);
    assert.equal((await ownerA('GET', '/api/auth/claimable?q=kirana')).status, 400, 'no location');
    const far = await ownerA('GET', `/api/auth/claimable?lat=28.6&lng=77.2&q=${encodeURIComponent(run)}`);
    assert.equal(far.body.stores.length, 0, 'only within the nearby radius');
  });

  test('a claim needs proof of the email; nothing is created; signing in again shows it pending', async () => {
    assert.equal((await ownerA('POST', '/api/auth/claim', { slug, phone: waA, email: emailA, code: '000000' })).status, 400);
    const code = await codeFor(ownerA, emailA);
    const ask = await ownerA('POST', '/api/auth/email', { email: emailA, code });
    assert.deepEqual(ask.body, { needsStore: true, claim: null });
    const r = await ownerA('POST', '/api/auth/claim', { slug, phone: waA, email: emailA, code, language: 'hi' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.claim.code, /^CLM-[A-Z0-9]{6}$/);
    assert.equal(r.body.claim.store.slug, slug);
    assert.equal(r.body.claim.phone, `91${waA}`);
    assert.equal((await query('SELECT count(*)::int AS n FROM users WHERE email = $1', [emailA])).rows[0].n, 0, 'no account yet');
    assert.equal((await ownerA('POST', '/api/auth/claim', { slug, phone: waA, email: emailA, code })).status, 400, 'the code was used up');

    const again = await ownerA('POST', '/api/auth/email', { email: emailA, code: await codeFor(ownerA, emailA) });
    assert.equal(again.body.needsStore, true);
    assert.equal(again.body.claim.code, r.body.claim.code);
    assert.equal(again.body.claim.status, 'pending');
  });

  test('asking again replaces the open request; the WhatsApp number must be free', async () => {
    const first = await ownerB('POST', '/api/auth/claim', { slug: otherSlug, phone: waB, email: emailB, code: await codeFor(ownerB, emailB) });
    assert.equal(first.status, 201);
    const second = await ownerB('POST', '/api/auth/claim', { slug, phone: waB, email: emailB, code: await codeFor(ownerB, emailB) });
    assert.equal(second.status, 201);
    const { rows } = await query(`SELECT status FROM store_claims WHERE email = $1 ORDER BY created_at`, [emailB]);
    assert.deepEqual(rows.map((x) => x.status), ['cancelled', 'pending']);
    const taken = await ownerC('POST', '/api/auth/claim', { slug, phone: '9353095481', email: emailC, code: await codeFor(ownerC, emailC) });
    if (taken.status !== 201) assert.equal(taken.status, 409);
    else await query(`DELETE FROM store_claims WHERE email = $1`, [emailC]); // the number happens to be free in this database
  });

  test('staff cannot see or decide claims; the admin sees the queue with the stats count', async () => {
    assert.equal((await staff('GET', '/api/platform/claims')).status, 403);
    const list = await admin('GET', '/api/platform/claims');
    assert.equal(list.status, 200);
    const mine = list.body.claims.filter((c) => c.store_slug === slug);
    assert.deepEqual(mine.map((c) => c.email).sort(), [emailA, emailB].sort());
    assert.equal(mine[0].other_pending, 1, 'shows that another person claims the same shop');
    assert.equal((await staff('POST', `/api/platform/claims/${mine[0].id}/approve`)).status, 403);
    assert.ok((await admin('GET', '/api/platform/stats')).body.claims_pending >= 2);
  });

  test('approving hands the listing to the claimant; the other claim is rejected; their email logs into the shop', async () => {
    const { claims } = (await admin('GET', '/api/platform/claims')).body;
    const a = claims.find((c) => c.email === emailA);
    const b = claims.find((c) => c.email === emailB);
    assert.equal((await admin('POST', `/api/platform/claims/${b.id}/reject`, { remarks: 'no' })).status, 400, 'remarks needed');
    assert.equal((await admin('POST', `/api/platform/claims/${a.id}/approve`)).status, 200);
    assert.equal((await admin('POST', `/api/platform/claims/${a.id}/approve`)).status, 409, 'already decided');
    const { rows } = await query(`SELECT email, status, remarks FROM store_claims WHERE id = ANY($1)`, [[a.id, b.id]]);
    assert.equal(rows.find((x) => x.email === emailA).status, 'approved');
    assert.equal(rows.find((x) => x.email === emailB).status, 'rejected');
    assert.match(rows.find((x) => x.email === emailB).remarks, /Another claim/);

    const login = await ownerA('POST', '/api/auth/email', { email: emailA, code: await codeFor(ownerA, emailA) });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.user.store_slug, slug);
    const store = (await ownerA('GET', '/api/merchant/store')).body.store;
    assert.equal(store.whatsapp_number, `91${waA}`);
    assert.equal(store.whatsapp_verified, true);
    assert.ok(store.claimed_at);
    assert.equal((await ownerC('GET', `/api/auth/claimable?lat=${HERE.lat}&lng=${HERE.lng}&q=${encodeURIComponent(`Nandi Kirana ${run}`)}`)).body.stores.length, 0, 'no longer claimable');
  });

  test('rejecting needs remarks; creating a store of your own withdraws an open claim', async () => {
    const c = await ownerC('POST', '/api/auth/claim', { slug: otherSlug, phone: `7${digits}8`.slice(0, 10), email: emailC, code: await codeFor(ownerC, emailC) });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const id = (await admin('GET', '/api/platform/claims')).body.claims.find((x) => x.email === emailC).id;
    assert.equal((await admin('POST', `/api/platform/claims/${id}/reject`, { remarks: 'Photo does not show the shop board' })).status, 200);
    assert.equal((await query('SELECT status FROM store_claims WHERE id = $1', [id])).rows[0].status, 'rejected');

    // A fresh open claim (inserted directly: the OTP limit allows only a few codes per email in a row).
    await query(`INSERT INTO store_claims (code, store_id, email, phone) SELECT 'CLM-WDRAW2', id, $1, $2 FROM stores WHERE slug = $3`, [emailC, `917${digits}8`.slice(0, 12), otherSlug]);
    const created = await ownerC('POST', '/api/auth/email', { email: emailC, code: await codeFor(ownerC, emailC), storeName: `Own Store ${run}` });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { rows } = await query(`SELECT status FROM store_claims WHERE email = $1 ORDER BY created_at DESC LIMIT 1`, [emailC]);
    assert.equal(rows[0].status, 'cancelled');
  });
});
