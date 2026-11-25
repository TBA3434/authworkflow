// Run with: npm test
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { MemoryStore, nextStep, TERMS_VERSION } = require('../db');

const WORKVIVO = 'https://workvivo.example/launch';
const DAY = 24 * 60 * 60 * 1000;
let server, base, store;

before(async () => {
  store = new MemoryStore();
  const { app } = createApp({ mode: 'dev', workvivoUrl: WORKVIVO }, store);
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});
after(() => server.close());
beforeEach(async () => { await store.reset(); });

// Keeps the session cookie across requests, like a browser.
function browser() {
  let cookie = '';
  return {
    async req(url, opts = {}) {
      const res = await fetch(base + url, {
        redirect: 'manual', ...opts,
        headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) },
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return res;
    },
    async signIn(email) {
      return this.req('/dev/login', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email }),
      });
    },
    async post(url, fields = {}) {
      return this.req(url, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });
    },
  };
}
const loc = (res) => res.headers.get('location');
const seed = (email, f = {}) => store.updateUser(email, {
  terms_version: f.terms ? TERMS_VERSION : null,
  terms_accepted_at: f.terms ? new Date() : null,
  info_verified_at: f.info ? new Date() : null,
  ids_verified_at: f.ids ? new Date() : null,
  payment_status: f.paid ? 'paid' : 'unpaid',
});

// ---- Pure logic (db.js) ----------------------------------------------------
test('nextStep: a new user starts at the agreement', () => {
  assert.equal(nextStep(null), 'terms');
});
test('nextStep: an agreement on an older version is asked again', () => {
  assert.equal(nextStep({ terms_version: '2020-01', terms_accepted_at: new Date(), payment_status: 'paid',
    info_verified_at: new Date(), ids_verified_at: new Date() }), 'terms');
});
test('nextStep: all steps done means access', () => {
  const now = new Date();
  assert.equal(nextStep({ terms_version: TERMS_VERSION, terms_accepted_at: now,
    info_verified_at: now, ids_verified_at: now, payment_status: 'paid' }), null);
});

// ---- Full flow through the site ---------------------------------------------
test('new user is walked through agreement, info, IDs and payment, then into Workvivo', async () => {
  const b = browser();
  assert.equal(loc(await b.signIn('new@primerica.test')), '/gate');
  assert.equal(loc(await b.req('/gate')), '/terms');
  assert.equal(loc(await b.post('/terms', { answer: 'agree' })), '/gate');
  assert.equal(loc(await b.req('/gate')), '/verify/info');
  assert.equal(loc(await b.post('/verify/info')), '/gate');
  assert.equal(loc(await b.req('/gate')), '/verify/ids');
  assert.equal(loc(await b.post('/verify/ids')), '/gate');
  assert.equal(loc(await b.req('/gate')), '/pay');
  assert.equal(loc(await b.post('/pay')), '/gate');
  assert.equal(loc(await b.req('/gate')), WORKVIVO);
});

test('declining the agreement keeps the user out', async () => {
  const b = browser();
  await b.signIn('decline@primerica.test');
  const res = await b.post('/terms', { answer: 'decline' });
  assert.equal(res.status, 200);
  assert.equal(loc(await b.req('/gate')), '/terms');
});

test('a user with everything done except payment is sent to the pay page', async () => {
  await seed('unpaid@primerica.test', { terms: true, info: true, ids: true });
  const b = browser();
  await b.signIn('unpaid@primerica.test');
  assert.equal(loc(await b.req('/gate')), '/pay');
});

test('personal info older than 90 days must be verified again', async () => {
  await seed('stale@primerica.test', { terms: true, info: true, ids: true, paid: true });
  await store.updateUser('stale@primerica.test', { info_verified_at: new Date(Date.now() - 91 * DAY) });
  const b = browser();
  await b.signIn('stale@primerica.test');
  assert.equal(loc(await b.req('/gate')), '/verify/info');
});

test('user IDs older than 90 days must be verified again', async () => {
  await seed('stale-ids@primerica.test', { terms: true, info: true, ids: true, paid: true });
  await store.updateUser('stale-ids@primerica.test', { ids_verified_at: new Date(Date.now() - 91 * DAY) });
  const b = browser();
  await b.signIn('stale-ids@primerica.test');
  assert.equal(loc(await b.req('/gate')), '/verify/ids');
});

test('a fully verified and paid user goes straight into Workvivo', async () => {
  await seed('ok@primerica.test', { terms: true, info: true, ids: true, paid: true });
  const b = browser();
  await b.signIn('ok@primerica.test');
  assert.equal(loc(await b.req('/gate')), WORKVIVO);
});

test('remind me later can be used three times, then verification is required', async () => {
  await seed('remind@primerica.test', { terms: true, info: true, paid: true });
  const b = browser();
  await b.signIn('remind@primerica.test');
  assert.equal(loc(await b.req('/gate')), '/verify/ids');
  for (let i = 0; i < 3; i += 1) {
    assert.equal(loc(await b.post('/verify/ids/remind')), WORKVIVO, `reminder ${i + 1} lets the user in`);
  }
  const fourth = await b.post('/verify/ids/remind');
  assert.equal(loc(fourth), '/verify/ids', 'fourth attempt is blocked');
});

test('verifying user IDs resets the reminder count', async () => {
  await seed('reset@primerica.test', { terms: true, info: true, paid: true });
  const b = browser();
  await b.signIn('reset@primerica.test');
  await b.post('/verify/ids/remind');
  await b.post('/verify/ids');
  assert.equal((await store.getUser('reset@primerica.test')).ids_remind_count, 0);
});

test('a visitor without a session cannot reach the gate or pay page', async () => {
  const b = browser();
  assert.equal(loc(await b.req('/gate')), '/');
  assert.equal(loc(await b.req('/pay')), '/');
  assert.equal(loc(await b.post('/pay')), '/');
  const u = await store.getUser('nobody@primerica.test');
  assert.equal(u, null);
});

// ---- Audit log ---------------------------------------------------------------
test('every gate decision is recorded with the step it blocked on', async () => {
  const b = browser();
  await b.signIn('log@primerica.test');
  await b.req('/gate');
  await b.post('/terms', { answer: 'agree' });
  await b.req('/gate');
  const rows = await store.recentChecks(10);
  assert.equal(rows[0].decision, 'BLOCK');
  assert.equal(rows[0].step, 'info');
  assert.equal(rows[1].step, 'terms');
});

test('the log page is hidden outside dev mode without the token', async () => {
  const { app } = createApp({ mode: 'okta', logsToken: 'secret-token' }, new MemoryStore());
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${url}/logs`)).status, 404);
    assert.equal((await fetch(`${url}/logs?token=wrong`)).status, 404);
    assert.equal((await fetch(`${url}/logs?token=secret-token`)).status, 200);
  } finally { srv.close(); }
});

test('email addresses are HTML-escaped on the log page', async () => {
  await store.addCheck('<img src=x>@t.test', 'BLOCK', 'terms');
  const b = browser();
  await b.signIn('admin@t.test');
  const html = await (await b.req('/logs')).text();
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test('health check reports the store in use', async () => {
  const body = await (await fetch(`${base}/healthz`)).json();
  assert.deepEqual(body, { ok: true, mode: 'dev', db: 'memory' });
});

test('locked mode has no sign-in path and no dev helpers', async () => {
  const { app } = createApp({ mode: 'locked' }, new MemoryStore());
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${url}/`)).status, 503);
    assert.equal((await fetch(`${url}/dev/login`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${url}/dev/seed`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${url}/dev/reset`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${url}/logs`)).status, 404);
    const health = await (await fetch(`${url}/healthz`)).json();
    assert.equal(health.mode, 'locked');
  } finally { srv.close(); }
});
