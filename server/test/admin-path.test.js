// The admin console lives at an unguessable path (/motiveboss), not /admin; robots.txt must not reveal either.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await pool.end();
});

test('admin pages are served at /motiveboss (noindex); /admin is a plain 404; robots.txt names neither', async () => {
  for (const p of ['/motiveboss', '/motiveboss/login']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /noindex/, p);
  }
  for (const p of ['/admin', '/admin/login']) assert.equal((await fetch(base + p)).status, 404, p);
  const robots = await (await fetch(`${base}/robots.txt`)).text();
  assert.doesNotMatch(robots, /admin|motiveboss/);
});
