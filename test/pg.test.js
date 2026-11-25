// Exercises PgStore's SQL against an in-memory Postgres emulator (pg-mem).
// This is not a real Postgres server; run once against Render to confirm.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { PgStore, nextStep, TERMS_VERSION } = require('../db');

async function makeStore() {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const store = new PgStore('postgres://unused', new Pool());
  await store.init();
  return store;
}

test('schema creates users and login_checks tables', async () => {
  const store = await makeStore();
  const r = await store.pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  const names = r.rows.map((x) => x.table_name);
  assert.ok(names.includes('users'));
  assert.ok(names.includes('login_checks'));
});

test('ensureUser creates a row once and returns defaults', async () => {
  const store = await makeStore();
  const a = await store.ensureUser('pg@t.test');
  const b = await store.ensureUser('pg@t.test');
  assert.equal(a.email, 'pg@t.test');
  assert.equal(a.payment_status, 'unpaid');
  assert.equal(b.email, 'pg@t.test');
  const count = await store.pool.query('SELECT count(*)::int AS n FROM users');
  assert.equal(count.rows[0].n, 1);
});

test('updateUser writes the three checks and the gate reads them back', async () => {
  const store = await makeStore();
  await store.ensureUser('flow@t.test');
  assert.equal(nextStep(await store.getUser('flow@t.test')), 'terms');
  await store.updateUser('flow@t.test', { terms_version: TERMS_VERSION, terms_accepted_at: new Date() });
  assert.equal(nextStep(await store.getUser('flow@t.test')), 'info');
  await store.updateUser('flow@t.test', { info_verified_at: new Date() });
  assert.equal(nextStep(await store.getUser('flow@t.test')), 'ids');
  await store.updateUser('flow@t.test', { ids_verified_at: new Date() });
  assert.equal(nextStep(await store.getUser('flow@t.test')), 'pay');
  await store.updateUser('flow@t.test', { payment_status: 'paid' });
  assert.equal(nextStep(await store.getUser('flow@t.test')), null);
});

test('addCheck and recentChecks return newest first', async () => {
  const store = await makeStore();
  await store.addCheck('a@t.test', 'BLOCK', 'terms');
  await store.addCheck('b@t.test', 'ALLOW', null);
  const rows = await store.recentChecks(10);
  assert.equal(rows[0].email, 'b@t.test');
  assert.equal(rows[1].step, 'terms');
});

test('payment_status rejects values outside paid and unpaid', async () => {
  const store = await makeStore();
  await store.ensureUser('check@t.test');
  await assert.rejects(store.updateUser('check@t.test', { payment_status: 'maybe' }));
});
