// Google Sign-In for owners and shoppers. Tokens are signed here with a test RSA key that the verifier is pointed
// at, so the real checks run: RS256 signature, audience, issuer, expiry, verified email.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { setGoogleKeysForTests } from '../src/google.js';
import { migrate } from '../src/migrate.js';

const run = Date.now().toString(36);
const ownerEmail = `g-owner-${run}@gmail.com`;
const shopperEmail = `g-shopper-${run}@gmail.com`;
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = `test-${run}`;
const saved = { client: config.googleClientId, owner: config.ownerLogin, customer: config.customerLogin };
let server;
let base;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims = {}, { key = privateKey, kid = KID } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234567890', email_verified: true, iat: now, exp: now + 3600, ...claims });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

function client() {
  const cookies = {};
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

before(async () => {
  Object.assign(config, { googleClientId: CLIENT_ID, ownerLogin: 'email', customerLogin: 'email' });
  setGoogleKeysForTests([{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }]);
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Object.assign(config, { googleClientId: saved.client, ownerLogin: saved.owner, customerLogin: saved.customer });
  setGoogleKeysForTests(null);
  await query('DELETE FROM users WHERE email = $1', [ownerEmail]);
  await query('DELETE FROM customers WHERE email = $1', [shopperEmail]);
  server.close();
  await pool.end();
});

describe('Google Sign-In', () => {
  test('the client ID is published to the app', async () => {
    assert.equal((await client()('GET', '/api/config')).body.googleClientId, CLIENT_ID);
  });

  test('owner: new Google account is asked for the store, then created with a verified email; next time it logs straight in', async () => {
    const c = client();
    const credential = token({ email: ownerEmail.toUpperCase(), name: 'Ravi Kumar' });
    const first = await c('POST', '/api/auth/google', { credential });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.needsStore, true);
    assert.equal(first.body.email, ownerEmail, 'lowercased');
    const made = await c('POST', '/api/auth/google', { credential, storeName: `Google Kirana ${run}`, businessType: 'shop' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.user.email, ownerEmail);
    const { rows } = await query('SELECT email_verified_at FROM users WHERE email = $1', [ownerEmail]);
    assert.ok(rows[0].email_verified_at);
    const again = await client()('POST', '/api/auth/google', { credential: token({ email: ownerEmail }) });
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false);
    assert.equal(again.body.user.store_name, `Google Kirana ${run}`);
  });

  test('shopper: Google creates the account with the Google name in one step, then signs in', async () => {
    const c = client();
    const r = await c('POST', '/api/customer/google', { credential: token({ email: shopperEmail, name: 'Priya S' }) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.customer.name, 'Priya S');
    assert.equal(r.body.customer.email, shopperEmail);
    assert.equal((await c('GET', '/api/customer/me')).body.customer.email, shopperEmail, 'session set');
    const again = await client()('POST', '/api/customer/google', { credential: token({ email: shopperEmail, name: 'Someone' }) });
    assert.equal(again.status, 200);
    assert.equal(again.body.customer.name, 'Priya S', 'existing account unchanged');
  });

  test('rejects tokens for another app, expired, forged, from an unknown key, or with an unverified email', async () => {
    const c = client();
    const now = Math.floor(Date.now() / 1000);
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    for (const [why, credential] of [
      ['other audience', token({ email: shopperEmail, aud: 'someone-else.apps.googleusercontent.com' })],
      ['expired', token({ email: shopperEmail, exp: now - 3600 })],
      ['wrong issuer', token({ email: shopperEmail, iss: 'https://evil.example' })],
      ['forged signature', token({ email: shopperEmail }, { key: other })],
      ['unknown key id', token({ email: shopperEmail }, { kid: 'nope' })],
      ['unverified email', token({ email: shopperEmail, email_verified: false })],
      ['garbage', 'not.a.token-at-all'],
    ]) {
      const r = await c('POST', '/api/customer/google', { credential });
      assert.ok([400, 401].includes(r.status), `${why}: ${r.status} ${JSON.stringify(r.body)}`);
    }
  });
});
