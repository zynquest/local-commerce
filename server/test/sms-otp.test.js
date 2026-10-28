// SMS OTP provider (OTP_PROVIDER=sms) with Fast2SMS's OTP route stubbed (no network).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { assertOtpConfig, config } from '../src/config.js';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const digits = String(Date.now()).slice(-8);
const phone = `917${digits}3`.slice(0, 12);
let server;
let base;
const saved = { provider: config.otpProvider, apiKey: config.fast2sms.apiKey };
const sent = []; // requests our server made to the (stubbed) Fast2SMS API
let reply = () => new Response(JSON.stringify({ return: true, request_id: 'abc123', message: ['SMS sent successfully.'] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const realFetch = globalThis.fetch;
const api = (path, body) =>
  realFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

const savedOwnerLogin = config.ownerLogin;
before(async () => {
  config.ownerLogin = 'mobile'; // these tests exercise the mobile-number owner flow (OWNER_LOGIN=mobile)
  await migrate({ log: () => {} });
  config.otpProvider = 'sms';
  config.fast2sms.apiKey = 'test-key';
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://www.fast2sms.com/')) {
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
  config.fast2sms.apiKey = saved.apiKey;
  globalThis.fetch = realFetch;
  await query(`DELETE FROM users WHERE phone = $1`, [phone]);
  await query(`DELETE FROM otp_codes WHERE phone = $1`, [phone]);
  server.close();
  await pool.end();
});

describe('SMS OTP via Fast2SMS (OTP_PROVIDER=sms)', () => {
  test('the code goes out on the OTP route to the 10-digit number, and then works for registration', async () => {
    sent.length = 0;
    const r = await api('/api/otp/request', { phone: phone.slice(2), purpose: 'owner_register' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.delivery, 'sms');
    assert.equal(r.body.devCode, undefined, 'no dev code outside fixed/console');
    assert.equal(r.body.waNumber, undefined, 'no WhatsApp instructions in SMS mode');
    assert.equal(sent.length, 1);
    const req = sent[0];
    assert.equal(req.url, 'https://www.fast2sms.com/dev/bulkV2');
    assert.equal(req.headers.authorization, 'test-key');
    assert.equal(req.body.route, 'otp');
    assert.equal(req.body.numbers, phone.slice(2), '10 digits, no country code');
    assert.match(req.body.variables_values, /^\d{6}$/);

    const reg = await api('/api/auth/register', { storeName: `SMS Test ${digits}`, phone: phone.slice(2), code: req.body.variables_values, businessType: 'shop' });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
  });

  test('a Fast2SMS failure (wrong key, no balance) becomes a 502 and no code is exposed', async () => {
    sent.length = 0;
    reply = () => new Response(JSON.stringify({ return: false, status_code: 412, message: 'Invalid Authentication, Check Authorization Key' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    const r = await api('/api/otp/request', { phone: phone.slice(2), purpose: 'owner_login' });
    assert.equal(r.status, 502, JSON.stringify(r.body));
    assert.equal(sent.length, 1);
    assert.ok(!JSON.stringify(r.body).includes(sent[0].body.variables_values), 'the code never leaks in an error');
  });

  test('config: OTP_PROVIDER=sms refuses to start without FAST2SMS_API_KEY', () => {
    config.fast2sms.apiKey = '';
    assert.throws(assertOtpConfig, /FAST2SMS_API_KEY/);
    config.fast2sms.apiKey = 'test-key';
    assert.doesNotThrow(assertOtpConfig);
  });
});
