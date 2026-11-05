// Store setup: business type can change until approval; after approval the identifying details (type, store type,
// name, link, WhatsApp) are locked for the owner and only the platform team can correct them.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import sharp from 'sharp';

const run = Date.now().toString(36);
const slug = `onb-${run}`;
let server;
let base;
let owner;
let ownerToken;
let admin;
let ownerId;
let storeId;
let adminId = null;
const tokens = [];

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

before(async () => {
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  let { rows } = await query(`INSERT INTO users (username) VALUES ($1) RETURNING id`, [`onb${run}`]);
  ownerId = rows[0].id;
  ({ rows } = await query(`INSERT INTO stores (owner_id, slug, name) VALUES ($1, $2, $3) RETURNING id`, [ownerId, slug, `Onboarding Test ${run}`]));
  storeId = rows[0].id;
  ownerToken = await session('user', ownerId);
  owner = client({ vfl_owner: ownerToken });
  ({ rows } = await query(`SELECT id FROM users WHERE role = 'platform_admin'`));
  if (!rows[0]) {
    ({ rows } = await query(`INSERT INTO users (username, password_hash, role) VALUES ($1, 'x', 'platform_admin') RETURNING id`, [`onbadmin${run}`]));
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

describe('store onboarding', () => {
  test('a draft store can change business type, store type, name and link', async () => {
    const r = await owner('PUT', '/api/merchant/store', { business_type: 'appointments', category: 'Hair Salon', name: `Onboarding Salon ${run}`, slug: `${slug}-salon` });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.store.business_type, 'appointments');
    assert.equal(r.body.store.details_locked, false);
    assert.ok(r.body.store.checklist.some((c) => c.key === 'specialists'), 'appointments checklist');
    const back = await owner('PUT', '/api/merchant/store', { business_type: 'shop', slug });
    assert.equal(back.body.store.business_type, 'shop');
  });

  test('a taken store link is reported on the link field', async () => {
    const { rows } = await query(`SELECT slug FROM stores WHERE id <> $1 LIMIT 1`, [storeId]);
    const r = await owner('PUT', '/api/merchant/store', { slug: rows[0].slug });
    assert.equal(r.status, 409);
    assert.ok(r.body.fields?.slug);
  });

  test('after approval the owner cannot change the locked details; other settings still save', async () => {
    await query(`UPDATE stores SET status = 'approved', whatsapp_number = $2 WHERE id = $1`, [storeId, `91${String(6000000000 + (Date.now() % 999999999)).slice(0, 10)}`]);
    const me = await owner('GET', '/api/merchant/store');
    assert.equal(me.body.store.details_locked, true);

    for (const body of [{ name: 'Renamed Shop' }, { slug: `${slug}-new` }, { category: 'Bakery' }, { business_type: 'appointments' }]) {
      const r = await owner('PUT', '/api/merchant/store', body);
      assert.equal(r.status, 409, JSON.stringify(body));
      assert.match(r.body.error, /can't be changed after approval/);
    }
    assert.equal((await owner('PUT', '/api/merchant/store/whatsapp', { phone: '9876501234' })).status, 409);

    // The settings form sends the locked fields back unchanged: that's fine.
    const ok = await owner('PUT', '/api/merchant/store', { name: me.body.store.name, slug, opening_hours: '09:00-21:00', closed_days: 'Sun' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.store.opening_hours, '09:00-21:00');
  });

  test('photo upload works on the free plan: compressed WebP, very large photos capped at 1600 px; 5 MB limit', async () => {
    const send = (buffer, type = 'image/png') => {
      const form = new FormData();
      form.append('image', new Blob([buffer], { type }), 'x.png');
      return fetch(`${base}/api/merchant/uploads`, { method: 'POST', body: form, headers: { Cookie: `vfl_owner=${ownerToken}` } });
    };
    const png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#f59e0b' } }).png().toBuffer();
    const res = await send(png);
    assert.equal(res.status, 201);
    const { url } = await res.json();
    assert.match(url, /^\/uploads\/.+\.webp$/);
    const stored = await sharp(path.join(config.uploadDir, url.replace('/uploads/', ''))).metadata();
    assert.deepEqual([stored.format, stored.width, stored.height], ['webp', 1600, 800]);
    const small = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#10b981' } }).png().toBuffer();
    const kept = await sharp(path.join(config.uploadDir, (await (await send(small)).json()).url.replace('/uploads/', ''))).metadata();
    assert.deepEqual([kept.width, kept.height], [640, 480], 'smaller photos keep their size');

    const big = await send(Buffer.alloc(5 * 1024 * 1024 + 1));
    assert.equal(big.status, 413);
    assert.equal((await big.json()).error, 'Image must be under 5 MB');
    assert.equal((await send(Buffer.from('not really an image'))).status, 400);
    fs.rmSync(path.dirname(path.join(config.uploadDir, url.replace('/uploads/', ''))), { recursive: true, force: true });
  });

  test('the platform team can correct the locked details', async () => {
    const r = await admin('PATCH', `/api/platform/stores/${storeId}/details`, { name: `Corrected ${run}`, category: 'Bakery', slug: `${slug}-fixed` });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.store.name, `Corrected ${run}`);
    assert.equal(r.body.store.slug, `${slug}-fixed`);
    assert.equal((await owner('PATCH', `/api/platform/stores/${storeId}/details`, { name: 'x' })).status, 401, 'owners cannot use it');
  });
});
