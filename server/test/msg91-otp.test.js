// WhatsApp OTP through MSG91 (OTP_PROVIDER=msg91_whatsapp) with MSG91's API stubbed (no network).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { assertOtpConfig, config } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const digits = String(Date.now()).slice(-8);
const phone = `918${digits}4`.slice(0, 12);
let server;
let base;
const saved = { provider: config.otpProvider, msg91: { ...config.msg91 } };
const sent = [];
let reply = () => new Response(JSON.stringify({ status: 'success', hasError: false, errors: [], data: { request_id: 'r1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const realFetch = globalThis.fetch;
const api = (path, body) =>
  realFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

const savedOwnerLogin = config.ownerLogin;
before(async () => {
  config.ownerLogin = 'mobile'; // these tests exercise the mobile-number owner flow (OWNER_LOGIN=mobile)
  await migrate({ log: () => {} });
  config.otpProvider = 'msg91_whatsapp';
  Object.assign(config.msg91, { authKey: 'test-authkey', whatsappNumber: '919353095481', template: 'login_code', templateLang: 'en', namespace: '' });
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://control.msg91.com/')) {
      sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return reply();
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
  Object.assign(config.msg91, saved.msg91);
  globalThis.fetch = realFetch;
  await query(`DELETE FROM users WHERE phone = $1`, [phone]);
  await query(`DELETE FROM otp_codes WHERE phone = $1`, [phone]);
  server.close();
  await pool.end();
});

describe('WhatsApp OTP via MSG91 (OTP_PROVIDER=msg91_whatsapp)', () => {
  test('the authentication template goes out with the code in the body and the copy button, then works for registration', async () => {
    sent.length = 0;
    const r = await api('/api/otp/request', { phone: phone.slice(2), purpose: 'owner_register' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.delivery, 'whatsapp');
    assert.equal(r.body.devCode, undefined);
    assert.equal(sent.length, 1);
    const req = sent[0];
    assert.equal(req.url, 'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/');
    assert.equal(req.headers.authkey, 'test-authkey');
    assert.equal(req.body.integrated_number, '919353095481');
    const tpl = req.body.payload.template;
    assert.equal(tpl.name, 'login_code');
    assert.equal(tpl.language.code, 'en');
    const entry = tpl.to_and_components[0];
    assert.deepEqual(entry.to, [phone]);
    const code = entry.components.body_1.value;
    assert.match(code, /^\d{6}$/);
    assert.equal(entry.components.button_1.value, code, 'copy-code button carries the code');

    const reg = await api('/api/auth/register', { storeName: `MSG91 WA ${digits}`, phone: phone.slice(2), code, businessType: 'shop' });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
  });

  test('an MSG91 failure reply becomes a 502 and no code is exposed', async () => {
    sent.length = 0;
    reply = () => new Response(JSON.stringify({ status: 'fail', hasError: true, errors: [{ message: 'Template not approved' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const r = await api('/api/otp/request', { phone: phone.slice(2), purpose: 'owner_login' });
    assert.equal(r.status, 502, JSON.stringify(r.body));
    assert.ok(!JSON.stringify(r.body).includes(sent[0].body.payload.template.to_and_components[0].components.body_1.value));
  });

  test('config: OTP_PROVIDER=msg91_whatsapp refuses to start without its settings', () => {
    config.msg91.template = '';
    assert.throws(assertOtpConfig, /MSG91_WHATSAPP_TEMPLATE/);
    config.msg91.template = 'login_code';
    assert.doesNotThrow(assertOtpConfig);
  });
});
