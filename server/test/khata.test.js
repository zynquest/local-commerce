// Khata (credit ledger) and the store's UPI ID: customers, credits and payments, balance, mark as paid, monthly
// totals, orders added to a khata once, and one store never seeing another's khata.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const run = Date.now().toString(36);
const digits = String(Date.now()).slice(-8);
const mobile = `9${digits}3`.slice(0, 10);
let server;
let base;
let owner;
let other;
const users = [];
const tokens = [];
let storeId;
let slug;

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

async function ownerOf(name) {
  const { rows } = await query(`INSERT INTO users (username) VALUES ($1) RETURNING id`, [`k${name}${run}`]);
  users.push(rows[0].id);
  const s = await query(`INSERT INTO stores (owner_id, slug, name, status, whatsapp_number) VALUES ($1, $2, $3, 'approved', NULL) RETURNING id, slug`, [
    rows[0].id,
    `khata-${name}-${run}`,
    `Khata ${name} ${run}`,
  ]);
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  tokens.push(hash);
  await query(`INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at) VALUES ($1, 'user', $2, now() + interval '1 hour')`, [hash, rows[0].id]);
  return { c: client({ vfl_owner: token }), store: s.rows[0] };
}

before(async () => {
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await ownerOf('a');
  owner = a.c;
  storeId = a.store.id;
  slug = a.store.slug;
  other = (await ownerOf('b')).c;
});

after(async () => {
  await query('DELETE FROM sessions WHERE token_hash = ANY($1)', [tokens]);
  await query('DELETE FROM users WHERE id = ANY($1)', [users]);
  server.close();
  await pool.end();
});

describe('khata (credit ledger)', () => {
  let customerId;

  test('customers: add with an optional mobile; a mobile is listed once per store', async () => {
    assert.equal((await owner('POST', '/api/merchant/khata/customers', { name: '' })).status, 400);
    const r = await owner('POST', '/api/merchant/khata/customers', { name: 'Ramesh Uncle', phone: mobile });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    customerId = r.body.customer.id;
    assert.equal(r.body.customer.phone, `91${mobile}`);
    assert.equal((await owner('POST', '/api/merchant/khata/customers', { name: 'Again', phone: mobile })).status, 409);
    assert.equal((await owner('POST', '/api/merchant/khata/customers', { name: 'No phone' })).status, 201);
  });

  test('credits and payments make the balance; future dates and bad amounts are refused', async () => {
    const add = (body) => owner('POST', `/api/merchant/khata/customers/${customerId}/entries`, body);
    assert.equal((await add({ kind: 'credit', amount: 500, note: 'Atta, dal' })).status, 201);
    assert.equal((await add({ kind: 'credit', amount: 200 })).status, 201);
    assert.equal((await add({ kind: 'payment', amount: 300, note: 'Cash' })).status, 201);
    assert.equal((await add({ kind: 'credit', amount: 0 })).status, 400);
    assert.equal((await add({ kind: 'gift', amount: 10 })).status, 400);
    assert.equal((await add({ kind: 'credit', amount: 10, entry_date: '2999-01-01' })).status, 400);
    const one = await owner('GET', `/api/merchant/khata/customers/${customerId}`);
    assert.equal(one.body.balance, 400);
    assert.equal(one.body.entries.length, 3);
    assert.equal(one.body.months[0].credit, 700);
    assert.equal(one.body.months[0].payment, 300);
    assert.equal(one.body.months[0].closing, 400);
    const list = await owner('GET', '/api/merchant/khata');
    assert.equal(list.body.total_due, 400);
    assert.equal(list.body.customers_due, 1);
    assert.equal(list.body.customers[0].id, customerId, 'most owed first');
  });

  test('mark as paid settles the whole balance; nothing left to settle afterwards', async () => {
    const r = await owner('POST', `/api/merchant/khata/customers/${customerId}/settle`);
    assert.equal(r.body.settled, 400);
    assert.equal((await owner('GET', `/api/merchant/khata/customers/${customerId}`)).body.balance, 0);
    assert.equal((await owner('POST', `/api/merchant/khata/customers/${customerId}/settle`)).status, 400);
  });

  test('an order goes into the khata of its mobile number once', async () => {
    const { rows } = await query(
      `INSERT INTO orders (store_id, order_code, customer_name, customer_phone, subtotal, total) VALUES ($1, $2, 'Ramesh', $3, 250, 250) RETURNING id`,
      [storeId, `ORD-K${digits.slice(-5)}`, mobile],
    );
    const r = await owner('POST', `/api/merchant/orders/${rows[0].id}/khata`);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.customer_id, customerId, 'same mobile, same khata');
    assert.equal((await owner('POST', `/api/merchant/orders/${rows[0].id}/khata`)).status, 409);
    assert.equal((await owner('GET', `/api/merchant/khata/customers/${customerId}`)).body.balance, 250);
    const orders = await owner('GET', '/api/merchant/orders?status=all');
    assert.equal(orders.body.orders.find((o) => o.id === rows[0].id).in_khata, true);
  });

  test("another store can't see or change this khata", async () => {
    assert.equal((await other('GET', `/api/merchant/khata/customers/${customerId}`)).status, 404);
    assert.equal((await other('POST', `/api/merchant/khata/customers/${customerId}/entries`, { kind: 'payment', amount: 1 })).status, 404);
    assert.equal((await other('GET', '/api/merchant/khata')).body.customers.length, 0);
    const entry = (await owner('GET', `/api/merchant/khata/customers/${customerId}`)).body.entries[0];
    assert.equal((await other('DELETE', `/api/merchant/khata/entries/${entry.id}`)).status, 404);
    assert.equal((await owner('DELETE', `/api/merchant/khata/entries/${entry.id}`)).status, 200);
    assert.equal((await owner('DELETE', `/api/merchant/khata/customers/${customerId}`)).status, 200);
  });
});

describe('UPI ID', () => {
  test('optional, validated, shown on the store page, and removable', async () => {
    assert.equal((await owner('PUT', '/api/merchant/store', { upi_id: 'not a upi' })).status, 400);
    assert.equal((await owner('PUT', '/api/merchant/store', { upi_id: 'gupta.kirana@okaxis' })).body.store.upi_id, 'gupta.kirana@okaxis');
    assert.equal((await owner('GET', `/api/stores/${slug}`)).body.store.upi_id, 'gupta.kirana@okaxis');
    assert.equal((await owner('PUT', '/api/merchant/store', { upi_id: '' })).body.store.upi_id, null);
  });
});
