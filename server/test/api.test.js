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
const emailShopper = `tester${digits}@example.com`;
const phoneC = `91${'9'}${digits}3`.slice(0, 12); // appointment business owner
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
  await query(`DELETE FROM users WHERE phone = ANY($1) AND role = 'owner'`, [[phoneA, phoneB, phoneC]]);
  await query(`DELETE FROM customers WHERE name = $1`, [`Tester ${run}`]);
  await query(`DELETE FROM otp_codes WHERE phone = ANY($1)`, [[phoneA, phoneB, phoneC, phoneShopper, emailShopper, '919000011111']]);
  if (createdAdminId) await query('DELETE FROM users WHERE id = $1', [createdAdminId]);
  server.close();
  await pool.end();
});

/** Requests an OTP for `phone` and returns the code (local dev exposes it; the fixed provider uses 898989). */
async function otpFor(call, to, purpose, extra = {}) {
  const r = await call('POST', '/api/otp/request', { ...(to.includes('@') ? { email: to } : { phone: to }), purpose, ...extra });
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

  test("order message language: new stores use the customer's language ('auto'); a fixed language can be chosen", async () => {
    assert.equal((await owner('GET', '/api/merchant/store')).body.store.order_language, 'auto');
    assert.equal((await owner('PUT', '/api/merchant/store', { order_language: 'kn' })).status, 200);
    assert.equal((await owner('GET', '/api/merchant/store')).body.store.order_language, 'kn');
    assert.equal((await owner('PUT', '/api/merchant/store', { order_language: 'xx' })).status, 400);
    assert.equal((await owner('PUT', '/api/merchant/store', { order_language: 'auto' })).status, 200);
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
    assert.equal(early.status, 400, 'category + map location missing');
    assert.match(early.body.error, /Location on the map/);
    await owner('PUT', '/api/merchant/store', { category: 'Grocery', delivery_fee: 20, lat: 12.9716, lng: 77.5946 });
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

  test('delivery fee is waived once the subtotal reaches free_delivery_above', async () => {
    const list = await shopper('GET', `/api/stores/${slug}`);
    const item = list.body.products.find((p) => p.name === 'Dal');
    const code = (n) => `ORD-FD${String(n)}${run.toUpperCase().slice(-3)}`.slice(0, 10);
    await owner('PUT', '/api/merchant/store', { delivery_fee: 20, free_delivery_above: 500 });
    const pub = await shopper('GET', `/api/stores/${slug}`);
    assert.equal(pub.body.store.free_delivery_above, 500);
    const small = await shopper('POST', `/api/stores/${slug}/orders`, { order_code: code(1), items: [{ sku_id: item.sku_id, quantity: 1, unit_price: 90 }] });
    assert.equal(small.status, 201, JSON.stringify(small.body));
    assert.equal(small.body.order.total, 110, '90 + ₹20 delivery');
    const big = await shopper('POST', `/api/stores/${slug}/orders`, { order_code: code(2), items: [{ sku_id: item.sku_id, quantity: 6, unit_price: 90 }] });
    assert.equal(big.body.order.total, 540, '540 subtotal, delivery waived');
    // Free delivery (fee 0) clears the threshold.
    const freed = await owner('PUT', '/api/merchant/store', { delivery_fee: 0 });
    assert.equal(freed.body.store.free_delivery_above, null);
    await owner('PUT', '/api/merchant/store', { delivery_fee: 20 });
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

  test('customer account: register with email + OTP, order is linked, history visible', async () => {
    const bad = await shopper('POST', '/api/otp/request', { phone: phoneShopper, purpose: 'customer_register' });
    assert.equal(bad.status, 400, 'customers identify by email, not mobile');
    const code = await otpFor(shopper, emailShopper.toUpperCase(), 'customer_register', { name: `Tester ${run}` });
    const reg = await shopper('POST', '/api/customer/register', { name: `Tester ${run}`, email: emailShopper, code });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.equal(reg.body.customer.email, emailShopper, 'stored lowercased');
    assert.equal((await shopper('POST', '/api/otp/request', { email: emailShopper, purpose: 'customer_register' })).status, 409);
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

  test('CUSTOMER_LOGIN=mobile: shoppers register and log in with a 10-digit mobile instead', async () => {
    const { config } = await import('../src/config.js');
    const saved = config.customerLogin;
    config.customerLogin = 'mobile';
    try {
      const c = client();
      assert.equal((await c('POST', '/api/otp/request', { email: emailShopper, purpose: 'customer_register' })).status, 400, 'email refused in mobile mode');
      const code = await otpFor(c, phoneShopper, 'customer_register', { name: `Tester ${run}` });
      const reg = await c('POST', '/api/customer/register', { name: `Tester ${run}`, phone: phoneShopper, code });
      assert.equal(reg.status, 201, JSON.stringify(reg.body));
      assert.equal(reg.body.customer.phone, phoneShopper);
      const login = await c('POST', '/api/customer/login', { phone: phoneShopper, code: await otpFor(client(), phoneShopper, 'customer_login') });
      assert.equal(login.status, 200, JSON.stringify(login.body));
    } finally {
      config.customerLogin = saved;
    }
  });

  test('shopper can log back in with email + OTP; unknown emails get the same reply', async () => {
    const again = client();
    const unknown = await again('POST', '/api/otp/request', { email: `nobody${digits}@example.com`, purpose: 'customer_login' });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.devCode, undefined, 'no code for an unregistered email');
    const code = await otpFor(again, emailShopper, 'customer_login');
    const r = await again('POST', '/api/customer/login', { email: emailShopper, code });
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

describe('demo stores', () => {
  test('always take orders on 919353095481, are noindex/out of the sitemap, and cannot change the number', async () => {
    const { rows } = await query(
      `UPDATE stores SET is_demo = true, status = 'approved', whatsapp_number = '919111111111'
        WHERE owner_id = (SELECT id FROM users WHERE phone = $1) RETURNING id, slug`,
      [phoneB],
    );
    const { id, slug: demoSlug } = rows[0];
    try {
      const pub = await shopper('GET', `/api/stores/${demoSlug}`);
      assert.equal(pub.body.store.whatsapp_number, '919353095481');
      assert.equal(pub.body.store.is_demo, true);
      const html = await fetch(`${base}/s/${demoSlug}`).then((r) => r.text());
      assert.match(html, /noindex/);
      assert.ok(html.includes('"telephone":"+919353095481"'));
      assert.ok(!(await fetch(`${base}/sitemap.xml`).then((r) => r.text())).includes(`/s/${demoSlug}<`));
      const change = await other('POST', '/api/otp/request', { phone: '9000022222', purpose: 'whatsapp_change' });
      assert.equal(change.status, 400);
      assert.match(change.body.error, /Demo stores always take orders/);
    } finally {
      await query(`UPDATE stores SET is_demo = false, status = 'draft', whatsapp_number = $2 WHERE id = $1`, [id, phoneB]);
    }
  });
});

describe('appointments: services, specialists, slots, WhatsApp bookings', () => {
  const pro = client();
  let apSlug;
  let apId;
  let cut;
  let spa;
  let spec;
  const tomorrow = () => new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10); // IST

  test('owner registers as an appointment business', async () => {
    const code = await otpFor(pro, phoneC, 'owner_register', { name: `Glow Salon ${run}` });
    const r = await pro('POST', '/api/auth/register', { storeName: `Glow Salon ${run}`, phone: phoneC, code, businessType: 'appointments' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.user.business_type, 'appointments');
    apSlug = r.body.user.store_slug;
    const s = await pro('GET', '/api/merchant/store');
    apId = s.body.store.id;
    assert.deepEqual(s.body.store.checklist.map((c) => c.key), ['name', 'whatsapp', 'location', 'category', 'services', 'specialists']);
  });

  test('services and specialists (schedule validated, services must be the store\'s own)', async () => {
    cut = (await pro('POST', '/api/merchant/services', { name: 'Hair Cut', category: 'Hair', duration_min: 30, price: 200 })).body.service;
    spa = (await pro('POST', '/api/merchant/services', { name: 'Hair Spa', category: 'Hair', duration_min: 60, price: 800 })).body.service;
    assert.equal(spa.duration_min, 60);
    assert.equal((await pro('POST', '/api/merchant/services', { name: 'X', duration_min: 2, price: 1 })).status, 400);
    const bad = await pro('POST', '/api/merchant/specialists', { name: 'Asha', schedule: { mon: [['18:00', '10:00']] }, service_ids: [cut.id] });
    assert.equal(bad.status, 400);
    const allWeek = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [['10:00', '18:00']]]));
    const r = await pro('POST', '/api/merchant/specialists', { name: 'Asha', title: 'Senior Stylist', schedule: allWeek, service_ids: [cut.id, spa.id] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    spec = r.body.specialist;
    assert.equal((await other('POST', '/api/merchant/specialists', { name: 'Hack', schedule: allWeek, service_ids: [cut.id] })).status, 400, 'other store cannot use these services');
  });

  test('location + category complete the checklist; admin approves', async () => {
    await pro('PUT', '/api/merchant/store', { category: 'Hair Salon', city: 'Bengaluru', address_text: 'MG Road', lat: 12.9756, lng: 77.6066 });
    const sub = await pro('POST', '/api/merchant/store/submit', {});
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.equal((await admin('POST', `/api/platform/stores/${apId}/approve`, {})).status, 200);
    const pub = await shopper('GET', `/api/stores/${apSlug}`);
    assert.equal(pub.body.store.business_type, 'appointments');
    assert.deepEqual(pub.body.services.map((s) => s.name), ['Hair Cut', 'Hair Spa']);
    assert.equal(pub.body.specialists[0].name, 'Asha');
    assert.equal(pub.body.specialists[0].schedule, undefined, 'working hours stay private');
  });

  test('availability: days summary and free times for a date', async () => {
    const days = await shopper('GET', `/api/stores/${apSlug}/availability?service=${spa.id}`);
    assert.equal(days.body.days.length, 14);
    const r = await shopper('GET', `/api/stores/${apSlug}/availability?service=${spa.id}&date=${tomorrow()}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.slots[0].time, '10:00');
    assert.equal(r.body.slots.at(-1).time, '17:00', '60-minute service must end by 18:00');
    assert.equal((await shopper('GET', `/api/stores/${apSlug}/availability?service=${spa.id}&date=2020-01-01`)).status, 400, 'past date');
  });

  test('booking holds the slot: same or overlapping time is refused; parallel requests cannot double-book', async () => {
    const book = (time, extra = {}) =>
      shopper('POST', `/api/stores/${apSlug}/appointments`, { service_id: spa.id, date: tomorrow(), time, name: `Tester ${run}`, phone: phoneShopper, language: 'hi', ...extra });
    const a = await book('10:00');
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.match(a.body.appointment.code, /^APT-[A-Z0-9]{6}$/);
    assert.deepEqual([a.body.appointment.time, a.body.appointment.end_time, a.body.appointment.specialist_name], ['10:00', '11:00', 'Asha']);
    assert.equal((await book('10:00')).status, 409);
    assert.equal((await book('10:30')).status, 409, 'overlaps 10:00–11:00');
    const free = await shopper('GET', `/api/stores/${apSlug}/availability?service=${cut.id}&date=${tomorrow()}`);
    assert.ok(!free.body.slots.some((s) => ['10:00', '10:30'].includes(s.time)) && free.body.slots.some((s) => s.time === '11:00'));
    const [x, y] = await Promise.all([book('14:00', { phone: '9876500001' }), book('14:00', { phone: '9876500002' })]);
    assert.deepEqual([x.status, y.status].sort(), [201, 409]);
  });

  test('merchant sees bookings, confirms/cancels; cancelling frees the slot; orders are refused', async () => {
    const list = await pro('GET', `/api/merchant/appointments?from=${tomorrow()}&to=${tomorrow()}`);
    assert.equal(list.body.appointments.length, 2);
    const first = list.body.appointments[0];
    assert.equal(first.status, 'requested');
    assert.equal((await pro('PATCH', `/api/merchant/appointments/${first.id}`, { status: 'confirmed' })).body.appointment.status, 'confirmed');
    assert.equal((await other('PATCH', `/api/merchant/appointments/${first.id}`, { status: 'cancelled' })).status, 404, 'other store');
    await pro('PATCH', `/api/merchant/appointments/${first.id}`, { status: 'cancelled' });
    const again = await shopper('GET', `/api/stores/${apSlug}/availability?service=${spa.id}&date=${tomorrow()}`);
    assert.equal(again.body.slots[0].time, '10:00');
    const stats = await pro('GET', '/api/merchant/stats');
    assert.equal(typeof stats.body.appointments_pending, 'number');
    assert.equal((await shopper('POST', `/api/stores/${apSlug}/orders`, { order_code: 'ORD-APPT01', items: [], notes: 'x' })).status, 400);
  });

  test('directory: only businesses within 5 km of the shopper (plus demo stores)', async () => {
    const near = await shopper('GET', '/api/stores?lat=12.9716&lng=77.5946');
    const hit = near.body.stores.find((s) => s.slug === apSlug);
    assert.ok(hit, 'MG Road salon is ~1.3 km from the city centre');
    assert.ok(hit.distance_km > 0.5 && hit.distance_km < 3, String(hit.distance_km));
    assert.equal(hit.business_type, 'appointments');
    const far = await shopper('GET', '/api/stores?lat=28.6139&lng=77.2090'); // Delhi
    assert.ok(!far.body.stores.some((s) => s.slug === apSlug));
    assert.ok(far.body.stores.every((s) => s.is_demo), 'only demo stores outside the radius');
    const typed = await shopper('GET', '/api/stores?lat=12.9716&lng=77.5946&type=shop');
    assert.ok(!typed.body.stores.some((s) => s.slug === apSlug));
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
