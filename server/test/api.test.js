// Integration tests against the real Postgres (docker compose). Creates uniquely-named fixtures and cleans up.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { adminPasswordProblems } from '../src/cli/admin.js';

const run = Date.now().toString(36);
const digits = String(Date.now()).slice(-8);
const phoneA = `91${'7'}${digits}0`.slice(0, 12); // 12 digits: 91 + 10-digit mobile
const phoneB = `91${'8'}${digits}1`.slice(0, 12);
const phoneShopper = `91${'6'}${digits}2`.slice(0, 12);
let server;
let base;
let createdAdminId = null;

/** Tiny cookie-jar client. */
function client(initialCookies = {}) {
  const cookies = { ...initialCookies };
  return async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (v) cookies[k] = v;
      else delete cookies[k];
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
}

const owner = client();
const other = client();
const shopper = client();
let admin;
let slug;
let storeId;

const product = (name, extra = {}) => ({ name, mrp: 100, list_price: 90, ...extra });

before(async () => {
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // Admin session without knowing any real password: use the existing admin or create a temporary one.
  let { rows } = await query(`SELECT id FROM users WHERE role = 'platform_admin'`);
  if (!rows[0]) {
    ({ rows } = await query(`INSERT INTO users (username, password_hash, role) VALUES ($1, 'x', 'platform_admin') RETURNING id`, [`tadmin${run}`]));
    createdAdminId = rows[0].id;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at) VALUES ($1, 'admin', $2, now() + interval '1 hour')`, [
    crypto.createHash('sha256').update(token).digest('hex'),
    rows[0].id,
  ]);
  admin = client({ vfl_admin: token });
});

after(async () => {
  await query(`DELETE FROM users WHERE phone = ANY($1) AND role = 'owner'`, [[phoneA, phoneB]]);
  await query(`DELETE FROM customers WHERE name = $1`, [`Tester ${run}`]);
  await query(`DELETE FROM otp_codes WHERE phone = ANY($1)`, [[phoneA, phoneB, phoneShopper, '919000011111']]);
  if (createdAdminId) await query('DELETE FROM users WHERE id = $1', [createdAdminId]);
  server.close();
  await pool.end();
});

/** Requests an OTP for `phone` and returns the code (local dev exposes it; the fixed provider uses 898989). */
async function otpFor(call, phone, purpose, extra = {}) {
  const r = await call('POST', '/api/otp/request', { phone, purpose, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.devCode, /^\d{6}$/, 'dev code exposed in development');
  return r.body.devCode;
}

describe('owner registration + login (10-digit mobile + OTP only)', () => {
  test('register needs store name, mobile and OTP; WhatsApp defaults to the (verified) mobile', async () => {
    const mobile = phoneA.slice(2);
    assert.equal((await owner('POST', '/api/auth/register', { storeName: `Gupta Kirana ${run}`, phone: mobile, code: '123' })).status, 400);
    const code = await otpFor(owner, mobile, 'owner_register', { name: `Gupta Kirana ${run}` });
    const wrong = code === '000000' ? '111111' : '000000';
    assert.equal((await owner('POST', '/api/auth/register', { storeName: `Gupta Kirana ${run}`, phone: mobile, code: wrong })).status, 400);
    const r = await owner('POST', '/api/auth/register', { storeName: `Gupta Kirana ${run}`, phone: mobile, code });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.user.store_status, 'draft');
    assert.equal(r.body.user.phone, phoneA);
    slug = r.body.user.store_slug;
    const s = await owner('GET', '/api/merchant/store');
    storeId = s.body.store.id;
    assert.equal(s.body.store.whatsapp_number, phoneA);
    assert.equal(s.body.store.whatsapp_verified, true);
    assert.equal(s.body.store.sku_limit, 50);
  });

  test('only 10-digit Indian mobiles are accepted', async () => {
    for (const phone of ['12345', '5123456789', '91712345678901', 'abcdefghij']) {
      assert.equal((await client()('POST', '/api/auth/login', { phone, code: '898989' })).status, 400, phone);
    }
  });

  test('duplicate mobile rejected; login with mobile + OTP; unknown mobile cannot log in', async () => {
    assert.equal((await other('POST', '/api/otp/request', { phone: phoneA, purpose: 'owner_register' })).status, 409, 'no code for a registered mobile');
    assert.equal((await other('POST', '/api/auth/register', { storeName: 'X Store', phone: phoneA, code: '898989' })).status, 400, 'no valid OTP for it either');

    const login = client();
    const code = await otpFor(login, phoneA.slice(2), 'owner_login');
    const ok = await login('POST', '/api/auth/login', { phone: phoneA.slice(2), code });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user.store_slug, slug);
    assert.equal((await login('POST', '/api/auth/login', { phone: phoneA.slice(2), code })).status, 400, 'code is single-use');
    assert.equal((await client()('POST', '/api/auth/login', { username: `t${run}a`, password: 'secret-pass-1' })).status, 400, 'no password login');

    const regCode = await otpFor(other, phoneB, 'owner_register');
    assert.equal((await other('POST', '/api/auth/register', { storeName: `Other ${run}`, phone: phoneB, code: regCode })).status, 201);
  });

  test('cross-site POST is blocked by origin guard', async () => {
    const r = await owner('POST', '/api/merchant/products', product('X1'), { Origin: 'https://evil.example' });
    assert.equal(r.status, 403);
  });
});

describe('WhatsApp number change requires OTP', () => {
  test('code goes to the new number; wrong code fails; right code updates + verifies', async () => {
    const newNo = '919000011111';
    const req = await owner('POST', '/api/otp/request', { phone: newNo, purpose: 'whatsapp_change' });
    assert.equal(req.status, 200, JSON.stringify(req.body));
    assert.match(req.body.devCode, /^\d{6}$/, 'dev code exposed in development');
    assert.equal((await owner('POST', '/api/merchant/store/whatsapp/verify', { phone: newNo, code: '000000' === req.body.devCode ? '111111' : '000000' })).status, 400);
    assert.equal((await other('POST', '/api/merchant/store/whatsapp/verify', { phone: newNo, code: req.body.devCode })).status, 400, 'other store cannot use it');
  });

  test('settings cannot change the WhatsApp number directly', async () => {
    await owner('PUT', '/api/merchant/store', { whatsapp_number: '919999999999', city: 'Pune' });
    const s = await owner('GET', '/api/merchant/store');
    assert.equal(s.body.store.whatsapp_number, phoneA);
    assert.equal(s.body.store.city, 'Pune');
  });

  test('verify with correct code', async () => {
    const newNo = '919000011111';
    const req = await owner('POST', '/api/otp/request', { phone: newNo, purpose: 'whatsapp_change' });
    const ok = await owner('POST', '/api/merchant/store/whatsapp/verify', { phone: newNo, code: req.body.devCode });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.store.whatsapp_number, newNo);
    assert.equal(ok.body.store.whatsapp_verified, true);
    assert.equal((await owner('POST', '/api/merchant/store/whatsapp/verify', { phone: newNo, code: req.body.devCode })).status, 400, 'code is single-use');
  });
});

describe('catalog: required fields, auto SKU, limits', () => {
  let id;
  test('only name, MRP and list price are required; SKU auto-assigned', async () => {
    const c = await owner('POST', '/api/merchant/products', product('Atta 5kg', { specs: 'Weight: 5 kg; Shelf life: 3 months', tags: 'Bestseller,New' }));
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.match(c.body.product.sku_id, /^P\d{4}$/);
    assert.equal(c.body.product.offer_price, 90);
    assert.deepEqual(c.body.product.specs, { Weight: '5 kg', 'Shelf life': '3 months' });
    id = c.body.product.id;
    const second = await owner('POST', '/api/merchant/products', product('Rice 1kg'));
    assert.notEqual(second.body.product.sku_id, c.body.product.sku_id);
    const missing = await owner('POST', '/api/merchant/products', { name: 'No price' });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.fields.mrp, 'MRP is required');
    assert.equal(missing.body.fields.offer_price, 'List price is required');
    const bad = await owner('POST', '/api/merchant/products', product('Too pricey', { list_price: 200 }));
    assert.equal(bad.body.fields.offer_price, 'List price cannot be more than MRP');
  });

  test('another store cannot edit; malformed ids 404', async () => {
    assert.equal((await other('PUT', `/api/merchant/products/${id}`, product('Hack'))).status, 404);
    assert.equal((await owner('PUT', '/api/merchant/products/not-a-uuid', product('X'))).status, 404);
  });

  test('import matches by name (no duplicates), validates rows, enforces plan limit', async () => {
    await query('UPDATE stores SET sku_limit = 4 WHERE id = $1', [storeId]);
    const bad = await owner('POST', '/api/merchant/products/import', { products: [product('A'), { name: 'B', mrp: 'abc', list_price: 1 }] });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.fields.rows[0].row, 2);
    const over = await owner('POST', '/api/merchant/products/import', { products: [product('Atta 5kg', { list_price: 80 }), product('Dal'), product('Oil'), product('Ghee')] });
    assert.equal(over.status, 409, '2 existing + 3 new > 4');
    const ok = await owner('POST', '/api/merchant/products/import', { products: [product('ATTA 5KG', { list_price: 80 }), product('Dal'), product('Oil')] });
    assert.deepEqual(ok.body, { inserted: 2, updated: 1 });
    const list = await owner('GET', '/api/merchant/products');
    assert.equal(list.body.products.length, 4);
    assert.equal(list.body.products.find((p) => p.id === id).offer_price, 80);
    assert.equal((await owner('POST', '/api/merchant/products', product('Fifth'))).status, 409);
    await query('UPDATE stores SET sku_limit = 50 WHERE id = $1', [storeId]);
  });
});

describe('catalog from a WhatsApp message', () => {
  const msg = 'Green Apple 4 pc\n200\n100\nTomatoes\n30\n28\nOnion\n40\nMilk,25,21|Wheat Flour,abc,69|Bread,40,35';

  test('dry run reports per product and saves nothing', async () => {
    const r = await other('POST', '/api/merchant/products/from-message', { text: msg, dryRun: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.summary, { created: 4, updated: 0, failed: 2 });
    assert.equal((await other('GET', '/api/merchant/products')).body.products.length, 0);
  });

  test('valid products are created; only the failed ones are rejected, with reason + lines', async () => {
    const r = await other('POST', '/api/merchant/products/from-message', { text: msg });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.summary, { created: 4, updated: 0, failed: 2 });
    const failed = r.body.results.filter((x) => x.status === 'failed');
    assert.deepEqual(failed.map((x) => [x.error, x.lines, x.source]), [
      ['missing_list_price', [7, 8], 'Onion\n40'],
      ['mrp_not_number', [9, 9], 'Wheat Flour,abc,69'],
    ]);
    const products = (await other('GET', '/api/merchant/products')).body.products;
    assert.deepEqual(products.map((p) => [p.name, p.mrp, p.offer_price]).sort(), [['Bread', 40, 35], ['Green Apple 4 pc', 200, 100], ['Milk', 25, 21], ['Tomatoes', 30, 28]]);
    assert.ok(products.every((p) => /^P\d{4}$/.test(p.sku_id)), 'auto item codes');
  });

  test('a product that already exists gets new prices (photos/category kept), not a duplicate', async () => {
    const r = await other('POST', '/api/merchant/products/from-message', { text: 'milk,26,22' });
    assert.deepEqual(r.body.summary, { created: 0, updated: 1, failed: 0 });
    const milk = (await other('GET', '/api/merchant/products')).body.products.filter((p) => p.name.toLowerCase() === 'milk');
    assert.equal(milk.length, 1);
    assert.equal(milk[0].offer_price, 22);
  });

  test('plan limit rejects only the products that do not fit', async () => {
    const { rows } = await query(`UPDATE stores SET sku_limit = 5 WHERE owner_id = (SELECT id FROM users WHERE phone = $1) RETURNING id`, [phoneB]);
    try {
      const r = await other('POST', '/api/merchant/products/from-message', { text: 'Salt,20,18|Sugar,50,45|Tea,120,110' });
      assert.deepEqual(r.body.summary, { created: 1, updated: 0, failed: 2 });
      assert.deepEqual(r.body.results.map((x) => x.error || x.status), ['created', 'sku_limit', 'sku_limit']);
    } finally {
      await query('UPDATE stores SET sku_limit = 50 WHERE id = $1', [rows[0].id]);
    }
  });

  test('empty / unparseable messages get a clear error', async () => {
    assert.equal((await other('POST', '/api/merchant/products/from-message', { text: '   ' })).body.error, 'Paste your product list first');
    const r = await other('POST', '/api/merchant/products/from-message', { text: '\n\n' });
    assert.equal(r.status, 400);
  });
});

describe('approval workflow', () => {
  test('draft store is hidden publicly but previewable by its owner', async () => {
    assert.equal((await shopper('GET', `/api/stores/${slug}`)).status, 404);
    const preview = await owner('GET', `/api/stores/${slug}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.store.preview, true);
    assert.equal(preview.body.store.accepting_orders, false);
    assert.equal((await shopper('POST', `/api/stores/${slug}/orders`, { order_code: 'ORD-AAAAAA', items: [], notes: 'x' })).status, 404);
  });

  test('submit requires checklist; then admin rejects with remarks; owner resubmits; admin approves', async () => {
    const early = await owner('POST', '/api/merchant/store/submit', {});
    assert.equal(early.status, 400, 'category missing');
    await owner('PUT', '/api/merchant/store', { category: 'Grocery', delivery_fee: 20 });
    const sub = await owner('POST', '/api/merchant/store/submit', { note: 'Please review' });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.equal(sub.body.store.status, 'pending_review');
    assert.equal((await owner('POST', '/api/merchant/store/submit', {})).status, 409, 'already pending');

    const queue = await admin('GET', '/api/platform/stores?status=pending_review');
    assert.ok(queue.body.stores.some((s) => s.id === storeId));
    assert.equal((await admin('POST', `/api/platform/stores/${storeId}/reject`, { remarks: 'no' })).status, 400, 'remarks too short');
    const rej = await admin('POST', `/api/platform/stores/${storeId}/reject`, { remarks: 'Please add a store logo and address' });
    assert.equal(rej.body.store.status, 'rejected');

    const seen = await owner('GET', '/api/merchant/store');
    assert.equal(seen.body.store.review_remarks, 'Please add a store logo and address');
    assert.equal(seen.body.store.reviews[0].action, 'rejected');
    assert.equal(seen.body.store.can_submit, true);

    await owner('PUT', '/api/merchant/store', { address_text: 'Shop 1, Main Road' });
    assert.equal((await owner('POST', '/api/merchant/store/submit', { note: 'Added address' })).body.store.status, 'pending_review');
    assert.equal((await admin('POST', `/api/platform/stores/${storeId}/suspend`, { remarks: 'not approved yet' })).status, 409, 'invalid transition');
    const ok = await admin('POST', `/api/platform/stores/${storeId}/approve`, {});
    assert.equal(ok.body.store.status, 'approved');
    assert.equal((await shopper('GET', `/api/stores/${slug}`)).status, 200);
  });

  test('admin endpoints need the admin session; owners cannot use them', async () => {
    assert.equal((await owner('GET', '/api/platform/stores')).status, 401);
    assert.equal((await shopper('GET', '/api/platform/stats')).status, 401);
    const stats = await admin('GET', '/api/platform/stats');
    assert.ok(stats.body.by_status.approved >= 1);
    const detail = await admin('GET', `/api/platform/stores/${storeId}`);
    assert.equal(detail.body.reviews.length, 4);
    const plan = await admin('PATCH', `/api/platform/stores/${storeId}/plan`, { plan: 'paid', sku_limit: 200 });
    assert.equal(plan.body.store.sku_limit, 200);
    assert.equal((await admin('PATCH', `/api/platform/stores/${storeId}/plan`, { plan: 'free' })).body.store.sku_limit, 50);
  });

  test('admin password policy', () => {
    assert.ok(adminPasswordProblems('Short1!').length > 0);
    assert.ok(adminPasswordProblems('Admin-Password-2026!').includes('must not contain common words'));
    assert.deepEqual(adminPasswordProblems('Kq7#vT2!mZp9@wLx', 'opsuser'), []);
  });
});

describe('storefront + orders', () => {
  test('public catalog excludes archived items and supports ETag 304', async () => {
    const r = await shopper('GET', `/api/stores/${slug}`);
    assert.equal(r.status, 200);
    const etag = r.headers.get('etag');
    assert.equal((await shopper('GET', `/api/stores/${slug}`, undefined, { 'If-None-Match': etag })).status, 304);
    await owner('PATCH', `/api/merchant/products/${r.body.products[0].id}`, { status: 'archived' });
    const changed = await shopper('GET', `/api/stores/${slug}`, undefined, { 'If-None-Match': etag });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.products.length, r.body.products.length - 1);
  });

  test('guest order is idempotent and flags stale prices', async () => {
    const list = await shopper('GET', `/api/stores/${slug}`);
    const item = list.body.products.find((p) => p.name === 'Dal');
    const order = {
      order_code: `ORD-${run.toUpperCase().slice(-6).padStart(6, 'X')}`,
      items: [{ sku_id: item.sku_id, quantity: 2, unit_price: 85 }], // live price is 90 → mismatch
      notes: 'Ring bell',
      customer_name: 'Guest',
      placed_offline: true,
    };
    const a = await shopper('POST', `/api/stores/${slug}/orders`, order);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.order.total, 190);
    assert.equal(a.body.order.price_mismatch, true);
    const b = await shopper('POST', `/api/stores/${slug}/orders`, order);
    assert.equal(b.body.duplicate, true);
    const orders = await owner('GET', '/api/merchant/orders');
    assert.equal(orders.body.orders.filter((o) => o.order_code === order.order_code).length, 1);
    assert.equal((await other('GET', '/api/merchant/orders')).body.orders.length, 0);
  });

  test('customer account: register, order is linked, history visible', async () => {
    const code = await otpFor(shopper, phoneShopper, 'customer_register', { name: `Tester ${run}` });
    const reg = await shopper('POST', '/api/customer/register', { name: `Tester ${run}`, phone: phoneShopper, code });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    const list = await shopper('GET', `/api/stores/${slug}`);
    const item = list.body.products.find((p) => p.name === 'Oil');
    const o = await shopper('POST', `/api/stores/${slug}/orders`, {
      order_code: `ORD-C${run.toUpperCase().slice(-6)}`,
      items: [{ sku_id: item.sku_id, quantity: 1, unit_price: 90 }],
    });
    assert.equal(o.status, 201);
    assert.equal(o.body.order.price_mismatch, false);
    assert.equal((await shopper('GET', '/api/customer/orders')).body.orders.length, 1);
  });

  test('suspended store disappears from public and stops taking orders', async () => {
    await admin('POST', `/api/platform/stores/${storeId}/suspend`, { remarks: 'Customer complaints, please call us' });
    assert.equal((await shopper('GET', `/api/stores/${slug}`)).status, 404);
    const dir = await shopper('GET', '/api/stores');
    assert.ok(!dir.body.stores.some((s) => s.slug === slug));
    await admin('POST', `/api/platform/stores/${storeId}/reinstate`, {});
    assert.equal((await shopper('GET', `/api/stores/${slug}`)).status, 200);
  });

  test('shopper can log back in with mobile + OTP', async () => {
    const again = client();
    const code = await otpFor(again, phoneShopper, 'customer_login');
    const r = await again('POST', '/api/customer/login', { phone: phoneShopper, code });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await again('GET', '/api/customer/orders')).body.orders.length, 1);
  });

  test('owner logout ends only that session', async () => {
    const second = client();
    const code = await otpFor(second, phoneB, 'owner_login');
    assert.equal((await second('POST', '/api/auth/login', { phone: phoneB, code })).status, 200);
    assert.equal((await second('POST', '/api/auth/logout')).status, 200);
    assert.equal((await second('GET', '/api/auth/me')).status, 401);
    assert.equal((await other('GET', '/api/auth/me')).status, 200);
  });
});

describe('SEO endpoints', () => {
  test('/register is an indexable, translated page (it is in the sitemap)', async () => {
    const res = await fetch(`${base}/register?lang=hi`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<meta name="robots" content="index, follow/);
    assert.match(html, /<link rel="canonical" href="[^"]*\/register\?lang=hi"/);
    assert.match(html, /hreflang="x-default" href="[^"]*\/register"/);
    assert.match(html, /<html lang="hi"/);
  });

  test('store pages: one canonical URL for every ?lang= variant, no hreflang; breadcrumbs present', async () => {
    const html = await fetch(`${base}/s/${slug}?lang=ta`).then((r) => r.text());
    assert.match(html, new RegExp(`<link rel="canonical" href="[^"]*/s/${slug}" />`));
    assert.ok(!html.includes('hreflang='));
    assert.ok(html.includes('"@type":"BreadcrumbList"'));
    for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(json);
  });

  test('home has hreflang for every language; private pages are noindex', async () => {
    const home = await fetch(`${base}/`).then((r) => r.text());
    assert.ok((home.match(/hreflang=/g) || []).length >= 23);
    assert.match(await fetch(`${base}/login`).then((r) => r.text()), /noindex/);
  });

  test('robots.txt and sitemap.xml list approved stores only', async () => {
    const robots = await fetch(`${base}/robots.txt`).then((r) => r.text());
    assert.match(robots, /Sitemap: .*\/sitemap\.xml/);
    assert.match(robots, /Disallow: \/merchant/);
    const xml = await fetch(`${base}/sitemap.xml`).then((r) => r.text());
    assert.ok(xml.includes(`/s/${slug}<`));
    const { rows } = await query(`SELECT slug FROM stores WHERE status <> 'approved' LIMIT 1`);
    if (rows[0]) assert.ok(!xml.includes(`/s/${rows[0].slug}<`));
  });
});
