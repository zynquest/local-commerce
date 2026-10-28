// Seeded merchants: import → visible only nearby, browse-only, never indexed → claimed by the owner (registration
// with the listing's mobile, or hand-over by the admin) → removed on request and never re-imported.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { config as appConfig } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { importSeeds } from '../src/seed/importer.js';
import { dedupeRows, mobileOf, readCsv, sameName, simpleHours, writeCsv } from '../src/seed/util.js';

const run = Date.now().toString(36);
const digits = String(Date.now()).slice(-8);
const mobileA = `9${digits}1`.slice(0, 10); // listing's own mobile → self-claim on registration
const mobileB = `8${digits}2`.slice(0, 10); // owner's mobile handed over by the admin
// A quiet spot (Hesaraghatta lake area) so other test data isn't within the radius.
const HERE = { lat: 13.1402, lng: 77.4791 };
const rows = [
  { source: 'osm', source_ref: `osm:node/t${run}1`, name: `Lakshmi Kirana ${run}`, category: 'grocery', locality: 'Testpura', lat: '13.1405', lng: '77.4795', phone: `+91 ${mobileA}`, hours: '07:00-22:00' },
  { source: 'osm', source_ref: `osm:node/t${run}2`, name: `Shanthi Bakery ${run}`, category: 'bakery', locality: 'Testpura', lat: '13.1412', lng: '77.4788', phone: '080 2345 6789' },
  { source: 'osm', source_ref: `osm:node/t${run}3`, name: `Glow Salon ${run}`, category: 'salon', lat: '13.1400', lng: '77.4790' },
  { source: 'google_places', source_ref: `gplace:t${run}4`, name: `Shanthi Bakery ${run}`, category: 'bakery', lat: '13.14121', lng: '77.47881', phone: '' },
];
let server;
let base;
let admin;
let adminId = null;

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
    return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text };
  };
}
const shopper = client();
const near = (lat, lng) => shopper('GET', `/api/stores?lat=${lat}&lng=${lng}`);
const slugOf = async (ref) => (await query('SELECT slug, id FROM stores WHERE seed_ref = $1', [ref])).rows[0];

const savedOwnerLogin = appConfig.ownerLogin;
before(async () => {
  appConfig.ownerLogin = 'mobile'; // these tests exercise the mobile-number owner flow (OWNER_LOGIN=mobile)
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  let { rows: a } = await query(`SELECT id FROM users WHERE role = 'platform_admin'`);
  if (!a[0]) {
    ({ rows: a } = await query(`INSERT INTO users (username, password_hash, role) VALUES ($1, 'x', 'platform_admin') RETURNING id`, [`sadmin${run}`]));
    adminId = a[0].id;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO sessions (token_hash, subject_type, subject_id, expires_at) VALUES ($1, 'admin', $2, now() + interval '1 hour')`, [
    crypto.createHash('sha256').update(token).digest('hex'),
    a[0].id,
  ]);
  admin = client({ vfl_admin: token });
});

after(async () => {
  appConfig.ownerLogin = savedOwnerLogin;
  await query(`DELETE FROM users u USING stores s WHERE s.owner_id = u.id AND s.seed_ref LIKE $1`, [`%t${run}%`]);
  await query(`DELETE FROM seed_optouts WHERE seed_ref LIKE $1`, [`%t${run}%`]);
  await query(`DELETE FROM otp_codes WHERE phone = ANY($1)`, [[`91${mobileA}`, `91${mobileB}`]]);
  if (adminId) await query('DELETE FROM users WHERE id = $1', [adminId]);
  server.close();
  await pool.end();
});

describe('seed helpers', () => {
  test('mobile detection, hours, name matching, CSV round trip and merging', async () => {
    assert.equal(mobileOf('+91 98450 12345'), '919845012345');
    assert.equal(mobileOf('080 2345 6789'), null, 'landlines cannot receive OTPs');
    assert.equal(mobileOf('080 2345 6789; 098450 12345'), '919845012345');
    assert.equal(simpleHours('Mo-Su 07:00-22:00'), '07:00-22:00');
    assert.equal(simpleHours('Mo-Fr 09:00-18:00; Sa 10:00-14:00'), '');
    assert.ok(sameName('Sri Lakshmi Stores', 'Lakshmi Store'));
    assert.ok(!sameName('Lakshmi Kirana', 'Ganesh Kirana'));
    const merged = dedupeRows(rows);
    assert.equal(merged.length, 3, 'the Google twin of the OSM bakery (same name, 1 m apart) merges into it');
    const file = `${process.env.TMPDIR || '/tmp'}/seed-${run}.csv`;
    writeCsv(file, [{ ...rows[0], name: 'Comma, "quoted" name' }]);
    assert.equal(readCsv(file)[0].name, 'Comma, "quoted" name');
  });
});

describe('seeded merchants', () => {
  test('import: approved browse-only listings with the starter catalog; salons skipped; duplicates merged', async () => {
    const stats = await importSeeds(rows, { city: 'Bengaluru' });
    assert.equal(stats.created, 2, JSON.stringify(stats));
    assert.equal(stats.skipped['category "salon" is not seeded'], 1);
    const again = await importSeeds(rows, { city: 'Bengaluru' });
    assert.equal(again.created, 0, 're-import creates nothing');
    assert.equal(again.updated, 2);
    const kirana = await slugOf(`osm:node/t${run}1`);
    const { rows: s } = await query('SELECT origin, status, whatsapp_number, claim_phone, opening_hours, locality FROM stores WHERE id = $1', [kirana.id]);
    assert.deepEqual(s[0], { origin: 'seed', status: 'approved', whatsapp_number: null, claim_phone: `91${mobileA}`, opening_hours: '07:00-22:00', locality: 'Testpura' });
    const products = await query('SELECT count(*)::int AS n FROM products WHERE store_id = $1', [kirana.id]);
    assert.ok(products.rows[0].n >= 15, 'grocery starter catalog');
  });

  test('shoppers see unclaimed listings only within the nearby radius, after real stores, with is_seed', async () => {
    const here = await near(HERE.lat, HERE.lng);
    const mine = here.body.stores.filter((s) => s.name.endsWith(run));
    assert.equal(mine.length, 2);
    assert.ok(mine.every((s) => s.is_seed && s.locality === 'Testpura'));
    const far = await near(12.9716, 77.5946); // central Bengaluru, ~19 km away
    assert.ok(!far.body.stores.some((s) => s.name.endsWith(run)), 'not visible outside the radius');
    const noLocation = await shopper('GET', `/api/stores?q=${run}`);
    assert.equal(noLocation.body.stores.length, 0, 'not listed without a location');
  });

  test('store page: browse-only, no private phone fields, never indexed; orders refused', async () => {
    const { slug } = await slugOf(`osm:node/t${run}1`);
    const r = await shopper('GET', `/api/stores/${slug}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.store.is_seed, true);
    assert.equal(r.body.store.accepting_orders, false);
    assert.ok(!('seed_phone' in r.body.store) && !('claim_phone' in r.body.store), 'listing phone stays private');
    const html = await shopper('GET', `/s/${slug}`);
    assert.match(html.body, /<meta name="robots" content="noindex/);
    const order = await shopper('POST', `/api/stores/${slug}/orders`, { order_code: `ORD-S${run.toUpperCase().slice(-5)}`, items: [], notes: 'hello' });
    assert.equal(order.status, 400);
    const sitemap = await shopper('GET', '/sitemap.xml');
    assert.ok(!String(sitemap.body).includes(slug));
  });

  test('registering with the listing mobile claims it instead of creating a second store', async () => {
    const owner = client();
    const otp = await owner('POST', '/api/otp/request', { phone: mobileA, purpose: 'owner_register' });
    assert.equal(otp.status, 200, JSON.stringify(otp.body));
    const reg = await owner('POST', '/api/auth/register', { storeName: `Lakshmi Kirana Stores ${run}`, phone: mobileA, code: otp.body.devCode, businessType: 'shop' });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    const { slug } = await slugOf(`osm:node/t${run}1`);
    assert.equal(reg.body.user.store_slug, slug, 'same listing, same link');
    const pub = await shopper('GET', `/api/stores/${slug}`);
    assert.equal(pub.body.store.is_seed, false);
    assert.equal(pub.body.store.accepting_orders, true);
    assert.equal(pub.body.store.name, `Lakshmi Kirana Stores ${run}`, "the owner's name for the shop wins");
    const listed = await shopper('GET', `/api/stores?q=${run}`);
    assert.equal(listed.body.stores.length, 1, 'a claimed listing is a normal store again');
    assert.equal((await importSeeds(rows, { city: 'Bengaluru' })).skipped['claimed by its owner'], 1, 're-import leaves it alone');
  });

  test('admin hands a listing to its owner, who then logs in with OTP', async () => {
    const { id } = await slugOf(`osm:node/t${run}2`);
    assert.equal((await admin('GET', '/api/platform/stores?status=seed')).body.stores.filter((s) => s.id === id).length, 1);
    assert.equal((await admin('GET', '/api/platform/stores?status=approved')).body.stores.filter((s) => s.id === id).length, 0, 'not in Live');
    const r = await admin('POST', `/api/platform/stores/${id}/claim`, { phone: mobileB });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await admin('POST', `/api/platform/stores/${id}/claim`, { phone: mobileB })).status, 409, 'only once');
    const owner = client();
    const otp = await owner('POST', '/api/otp/request', { phone: mobileB, purpose: 'owner_login' });
    const login = await owner('POST', '/api/auth/login', { phone: mobileB, code: otp.body.devCode });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.user.store_name, `Shanthi Bakery ${run}`);
  });

  test('removed listings are deleted and never re-imported', async () => {
    const extra = { source: 'osm', source_ref: `osm:node/t${run}5`, name: `Ganesh Flowers ${run}`, category: 'flowers', lat: '13.1398', lng: '77.4802' };
    await importSeeds([extra], { city: 'Bengaluru' });
    const { id } = await slugOf(extra.source_ref);
    const r = await admin('POST', `/api/platform/stores/${id}/remove-seed`, { remarks: 'Owner asked' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await slugOf(extra.source_ref), undefined);
    const again = await importSeeds([extra], { city: 'Bengaluru' });
    assert.equal(again.skipped['removed on request'], 1);
  });
});
