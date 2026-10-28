// WhatsApp OTP providers, with Meta's Cloud API stubbed (no network): template mode and the free reply mode
// (user messages us → signed webhook → we reply with the code → code works for registration).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const digits = String(Date.now()).slice(-8);
const phone = `91${'8'}${digits}7`.slice(0, 12);
const other = `91${'8'}${digits}8`.slice(0, 12);
let server;
let base;
const saved = { provider: config.otpProvider, wa: { ...config.whatsapp } };
const sent = []; // messages our server sent to the (stubbed) Graph API
const realFetch = globalThis.fetch;

const sign = (body) => `sha256=${crypto.createHmac('sha256', config.whatsapp.appSecret).update(body).digest('hex')}`;
const webhook = (from, text, signature) => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ from, id: crypto.randomUUID(), type: 'text', text: { body: text } }] } }] }] });
  return realFetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature ?? sign(body) }, body });
};
const api = (path, body) =>
  realFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const settle = () => new Promise((r) => setTimeout(r, 150)); // webhook answers 200 first, then processes

const savedOwnerLogin = config.ownerLogin;
before(async () => {
  config.ownerLogin = 'mobile'; // these tests exercise the mobile-number owner flow (OWNER_LOGIN=mobile)
  await migrate({ log: () => {} });
  Object.assign(config.whatsapp, { phoneNumberId: '1234567890', accessToken: 'test-token', appSecret: 'test-secret', verifyToken: 'verify-me', businessNumber: '919353095481', otpTemplate: 'login_code', otpTemplateLang: 'en' });
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://graph.facebook.com/')) {
      sent.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  config.ownerLogin = savedOwnerLogin;
  config.otpProvider = saved.provider;
  Object.assign(config.whatsapp, saved.wa);
  globalThis.fetch = realFetch;
  await query(`DELETE FROM users WHERE phone = ANY($1)`, [[phone, other]]);
  await query(`DELETE FROM customers WHERE phone = ANY($1)`, [[phone, other]]);
  await query(`DELETE FROM otp_codes WHERE phone = ANY($1)`, [[phone, other]]);
  await query(`DELETE FROM otp_wa_requests WHERE phone = ANY($1)`, [[phone, other]]);
  server.close();
  await pool.end();
});

describe('WhatsApp OTP — template mode (OTP_PROVIDER=whatsapp)', () => {
  test('code is pushed with the approved authentication template', async () => {
    config.otpProvider = 'whatsapp';
    sent.length = 0;
    const r = await api('/api/otp/request', { phone: phone.slice(2), purpose: 'owner_register' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.delivery, 'whatsapp');
    assert.equal(r.body.devCode, undefined, 'no dev code outside fixed/console');
    assert.equal(sent.length, 1);
    const msg = sent[0];
    assert.match(msg.url, /graph\.facebook\.com\/v[\d.]+\/1234567890\/messages$/);
    assert.equal(msg.auth, 'Bearer test-token');
    assert.equal(msg.body.to, phone);
    assert.equal(msg.body.template.name, 'login_code');
    const code = msg.body.template.components[0].parameters[0].text;
    assert.match(code, /^\d{6}$/);
    assert.equal(msg.body.template.components[1].parameters[0].text, code, 'copy-code button carries the code');
  });
});

describe('WhatsApp OTP — free reply mode (OTP_PROVIDER=whatsapp_reply)', () => {
  test('webhook verification handshake and signature check', async () => {
    const ok = await realFetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42abc`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '42abc');
    assert.equal((await realFetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status, 403);
    assert.equal((await webhook(phone, 'hi', 'sha256=deadbeef')).status, 401, 'unsigned / forged posts are rejected');
  });

  test('request → user sends the WhatsApp message → we reply with the code → registration works', async () => {
    config.otpProvider = 'whatsapp_reply';
    sent.length = 0;
    const r = await api('/api/otp/request', { phone: phone.slice(2), purpose: 'owner_register', language: 'hi' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.delivery, 'whatsapp_reply');
    assert.equal(r.body.waNumber, '919353095481');
    assert.match(r.body.waText, /#[A-HJ-NP-Z2-9]{6}/);
    assert.equal(sent.length, 0, 'nothing is sent until the user messages us (that keeps it free)');

    // Someone else forwards the message from their own number → refused, no code.
    assert.equal((await webhook(other, r.body.waText)).status, 200);
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.to, other);
    assert.ok(!/\d{6}/.test(sent[0].body.text.body), 'no code to the wrong number');

    // The real owner sends it.
    await webhook(phone, `  ${r.body.waText.toLowerCase()} `);
    await settle();
    assert.equal(sent.length, 2);
    const reply = sent[1].body;
    assert.equal(reply.to, phone);
    assert.equal(reply.type, 'text');
    const code = reply.text.body.match(/\d{6}/)[0];

    const reg = await api('/api/auth/register', { storeName: `WA Test ${digits}`, phone: phone.slice(2), code, businessType: 'shop' });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));

    // The request token is single-use.
    await webhook(phone, r.body.waText);
    await settle();
    assert.ok(!/\d{6}/.test(sent.at(-1).body.text.body), 'reused token gets an "expired" reply, not a code');
  });

  test('login for an unknown number: same response (no account leak); the owner is told on WhatsApp', async () => {
    sent.length = 0;
    const r = await api('/api/otp/request', { phone: other.slice(2), purpose: 'owner_login' });
    assert.equal(r.status, 200);
    assert.equal(r.body.delivery, 'whatsapp_reply');
    await webhook(other, r.body.waText);
    await settle();
    assert.equal(sent.length, 1);
    assert.ok(!/\d{6}/.test(sent[0].body.text.body));
    assert.equal((await api('/api/otp/request', { phone: phone.slice(2), purpose: 'owner_register' })).status, 409, 'registered number cannot register again');
  });

  test('ordinary chat messages are left alone', async () => {
    sent.length = 0;
    assert.equal((await webhook(phone, 'Do you deliver to HSR Layout?')).status, 200);
    await settle();
    assert.equal(sent.length, 0);
  });

  test('shoppers (CUSTOMER_LOGIN=mobile): any number can request a code; new ones are asked for a name', async () => {
    const saved = config.customerLogin;
    config.customerLogin = 'mobile';
    sent.length = 0;
    try {
      const r = await api('/api/otp/request', { phone: other.slice(2), purpose: 'customer_login', language: 'en' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.delivery, 'whatsapp_reply');
      await webhook(other, r.body.waText);
      await settle();
      const code = sent.at(-1).body.text.body.match(/\d{6}/)?.[0];
      assert.ok(code, 'unknown number still gets a code (sign-up happens after it is verified)');
      const first = await api('/api/customer/auth', { phone: other.slice(2), code });
      assert.equal(first.body.needsName, true);
      const made = await api('/api/customer/auth', { phone: other.slice(2), code, name: 'WA Shopper' });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      assert.equal(made.body.customer.phone, other);
    } finally {
      config.customerLogin = saved;
    }
  });

  test('config: WhatsApp providers refuse to start without their Meta settings', async () => {
    const { assertOtpConfig } = await import('../src/config.js');
    const keep = { ...config.whatsapp };
    config.otpProvider = 'whatsapp_reply';
    config.whatsapp.appSecret = '';
    assert.throws(() => assertOtpConfig(), /WHATSAPP_APP_SECRET/);
    config.otpProvider = 'whatsapp';
    config.whatsapp.otpTemplate = '';
    assert.throws(() => assertOtpConfig(), /WHATSAPP_OTP_TEMPLATE/);
    Object.assign(config.whatsapp, keep);
  });
});
