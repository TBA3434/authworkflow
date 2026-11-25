// Data layer for the login gate. Two stores with the same methods:
//  - PgStore: Render Postgres (used when DATABASE_URL is set)
//  - MemoryStore: in-process, used by tests and local dev

const TERMS_VERSION = '2025-09';   // Primerica Online Subscription Agreement, "Revised September 2025"
const VERIFY_DAYS = 90;            // personal info and user IDs must be re-verified every 90 days
const MAX_REMINDERS = 3;           // "Remind me later" can be used three times, then verification is required

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  email             text PRIMARY KEY,
  terms_version     text,
  terms_accepted_at timestamptz,
  info_verified_at  timestamptz,
  ids_verified_at   timestamptz,
  ids_remind_count  integer NOT NULL DEFAULT 0,
  payment_status    text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('paid','unpaid')),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS login_checks (
  id         bigserial PRIMARY KEY,
  email      text NOT NULL,
  decision   text NOT NULL,
  step       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

function isFresh(ts, now = new Date()) {
  if (!ts) return false;
  return now - new Date(ts) < VERIFY_DAYS * 24 * 60 * 60 * 1000;
}

// Returns the first step the user still has to complete, or null if they can enter Workvivo.
function nextStep(u, now = new Date()) {
  if (!u || !u.terms_accepted_at || u.terms_version !== TERMS_VERSION) return 'terms';
  if (!isFresh(u.info_verified_at, now)) return 'info';
  if (!isFresh(u.ids_verified_at, now)) return 'ids';
  if (u.payment_status !== 'paid') return 'pay';
  return null;
}

class MemoryStore {
  constructor() { this.users = new Map(); this.checks = []; }
  async init() {}
  async ensureUser(email) {
    if (!this.users.has(email)) {
      this.users.set(email, { email, terms_version: null, terms_accepted_at: null,
        info_verified_at: null, ids_verified_at: null, ids_remind_count: 0, payment_status: 'unpaid' });
    }
    return { ...this.users.get(email) };
  }
  async getUser(email) { return this.users.has(email) ? { ...this.users.get(email) } : null; }
  async updateUser(email, fields) { await this.ensureUser(email); Object.assign(this.users.get(email), fields); }
  async addCheck(email, decision, step) {
    this.checks.unshift({ email, decision, step, created_at: new Date().toISOString() });
  }
  async recentChecks(limit = 100) { return this.checks.slice(0, limit); }
  async reset() { this.users.clear(); this.checks = []; }
}

class PgStore {
  // pool is injectable so tests can pass an emulated Postgres pool.
  constructor(connectionString, pool = null) {
    if (pool) { this.pool = pool; return; }
    // SSL comes from the URL (e.g. ?sslmode=require). The internal Render URL needs none.
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString });
  }
  async init() { await this.pool.query(SCHEMA); }
  async ensureUser(email) {
    await this.pool.query('INSERT INTO users (email) VALUES ($1) ON CONFLICT DO NOTHING', [email]);
    return this.getUser(email);
  }
  async getUser(email) {
    const r = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return r.rows[0] || null;
  }
  async updateUser(email, fields) {
    await this.ensureUser(email);
    // Field names come from this code only, never from user input.
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await this.pool.query(`UPDATE users SET ${sets}, updated_at = now() WHERE email = $1`,
      [email, ...keys.map((k) => fields[k])]);
  }
  async addCheck(email, decision, step) {
    await this.pool.query('INSERT INTO login_checks (email, decision, step) VALUES ($1, $2, $3)',
      [email, decision, step]);
  }
  async recentChecks(limit = 100) {
    const r = await this.pool.query('SELECT email, decision, step, created_at FROM login_checks ORDER BY id DESC LIMIT $1', [limit]);
    return r.rows;
  }
  async reset() { await this.pool.query('TRUNCATE users, login_checks'); }
}

module.exports = { MemoryStore, PgStore, nextStep, isFresh, TERMS_VERSION, VERIFY_DAYS, MAX_REMINDERS };
