// Workvivo Launcher gateway.
// Flow: login -> /gate checks the database -> first incomplete step -> Workvivo.
// Steps in order: terms (agreement) -> info (personal info) -> ids (office user IDs) -> pay.
//
// MODE=okta : real OIDC login against Okta (OKTA_ISSUER, CLIENT_ID, CLIENT_SECRET)
// MODE=dev  : sign-in by typing an email. Adds /dev/* helpers. Never deploy with dev on.
// MODE=locked (default if MODE is unset or unrecognized): no sign-in at all. Safe for public URLs.
// DATABASE_URL set : Render Postgres. Unset : in-memory (tests and local runs).

const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const { MemoryStore, PgStore, nextStep, TERMS_VERSION, MAX_REMINDERS } = require('./db');

const STEP_PATH = { terms: '/terms', info: '/verify/info', ids: '/verify/ids', pay: '/pay' };

function createApp(config = {}, store = new MemoryStore()) {
  const cfg = {
    mode: 'dev',
    baseUrl: 'http://localhost:3000',
    workvivoUrl: 'https://example.com/workvivo-placeholder',
    sessionSecret: 'poc-' + crypto.randomBytes(8).toString('hex'),
    logsToken: null,
    ...config,
  };

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(session({
    secret: cfg.sessionSecret, resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  }));

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const page = (title, body) => `<!doctype html><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <body style="font-family:sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem">${body}</body>`;

  async function log(email, decision, step) {
    await store.addCheck(email, decision, step);
    console.log(`${new Date().toISOString()} | ${email} | ${decision} | step=${step || '-'}`);
  }

  // Single decision point: every entry into Workvivo goes through here.
  async function gate(req, res) {
    const email = req.session.user;
    if (!email) return res.redirect('/');
    const user = await store.ensureUser(email);
    const step = nextStep(user);
    if (!step) {
      await log(email, 'ALLOW', null);
      return res.redirect(cfg.workvivoUrl);
    }
    await log(email, 'BLOCK', step);
    return res.redirect(STEP_PATH[step]);
  }

  async function completeLogin(req, res, email) {
    req.session.user = email;
    await store.ensureUser(email);
    res.redirect('/gate');
  }

  // Requires a session; otherwise send to sign-in.
  const requireUser = (handler) => async (req, res, next) => {
    if (!req.session.user) return res.redirect('/');
    try { await handler(req, res); } catch (err) { next(err); }
  };

  // ---- Sign-in -------------------------------------------------------------
  if (cfg.mode === 'okta') {
    // eslint-disable-next-line global-require
    const { Issuer, generators } = require('openid-client');
    app.locals.setupOkta = async () => {
      const issuer = await Issuer.discover(cfg.oktaIssuer);
      app.locals.oidc = new issuer.Client({
        client_id: cfg.clientId, client_secret: cfg.clientSecret,
        redirect_uris: [`${cfg.baseUrl}/callback`], response_types: ['code'],
      });
      app.locals.generators = generators;
    };
    app.get('/', (req, res) => {
      const { oidc, generators } = app.locals;
      const verifier = generators.codeVerifier();
      // Okta requires state, and nonce is checked against the ID token.
      req.session.verifier = verifier;
      req.session.state = generators.state();
      req.session.nonce = generators.nonce();
      res.redirect(oidc.authorizationUrl({
        scope: 'openid profile email',
        state: req.session.state,
        nonce: req.session.nonce,
        code_challenge: generators.codeChallenge(verifier), code_challenge_method: 'S256',
      }));
    });
    app.get('/callback', async (req, res, next) => {
      try {
        const { oidc } = app.locals;
        const checks = {
          state: req.session.state,
          nonce: req.session.nonce,
          code_verifier: req.session.verifier,
        };
        // One-time values: clear them so a replayed callback cannot reuse them.
        delete req.session.state; delete req.session.nonce; delete req.session.verifier;
        if (!checks.state || !checks.code_verifier) return res.redirect('/');
        const tokens = await oidc.callback(`${cfg.baseUrl}/callback`, oidc.callbackParams(req), checks);
        await completeLogin(req, res, tokens.claims().email);
      } catch (err) { next(err); }
    });
  } else if (cfg.mode === 'dev') {
    app.get('/', (req, res) => res.send(page('Sign in', `<h2>Workvivo Launcher (dev)</h2>
      <form method="post" action="/dev/login">
        <label>Email <input name="email" value="agent@primerica.test" required></label>
        <button>Sign in</button></form>`)));
    app.post('/dev/login', async (req, res, next) => {
      try {
        const email = String(req.body.email || '').trim();
        if (!email) return res.status(400).send('email required');
        await completeLogin(req, res, email);
      } catch (err) { next(err); }
    });
  } else {
    // Locked: no sign-in path exists, so no one gets into the gate.
    app.get('/', (req, res) => res.status(503).send(page('Not available',
      '<h2>Sign-in is not configured yet.</h2><p>Contact the project team.</p>')));
  }

  // ---- The gate ------------------------------------------------------------
  app.get('/gate', requireUser(gate));

  // ---- Step 1: service agreement -------------------------------------------
  app.get('/terms', requireUser(async (req, res) => {
    res.send(page('Agreement', `<h2>Primerica Online Subscription Agreement</h2>
      <p>Revised September 2025 (version ${esc(TERMS_VERSION)}).</p>
      <p>Placeholder: insert the agreement text here. Legal must approve the final copy.</p>
      <form method="post" action="/terms">
        <button name="answer" value="agree">I Agree</button>
        <button name="answer" value="decline">I do not Agree</button>
      </form>`));
  }));
  app.post('/terms', requireUser(async (req, res) => {
    if (req.body.answer !== 'agree') {
      return res.send(page('Agreement', '<h2>You must agree to use Primerica Online.</h2>'));
    }
    await store.updateUser(req.session.user, { terms_version: TERMS_VERSION, terms_accepted_at: new Date() });
    res.redirect('/gate');
  }));

  // ---- Step 2: personal info (90-day verification) -------------------------
  app.get('/verify/info', requireUser(async (req, res) => {
    res.send(page('Verify personal information', `<h2>Verify your personal information</h2>
      <p>Every 90 days we ask you to confirm your information is still valid.</p>
      <p>Placeholder: email, cell phone and veteran fields go here.</p>
      <form method="post" action="/verify/info"><button>Submit</button></form>`));
  }));
  app.post('/verify/info', requireUser(async (req, res) => {
    await store.updateUser(req.session.user, { info_verified_at: new Date() });
    res.redirect('/gate');
  }));

  // ---- Step 3: office user IDs (90-day, remind later up to 3 times) --------
  app.get('/verify/ids', requireUser(async (req, res) => {
    const u = await store.getUser(req.session.user);
    const left = Math.max(0, MAX_REMINDERS - (u.ids_remind_count || 0));
    const remind = left > 0
      ? `<form method="post" action="/verify/ids/remind" style="display:inline">
           <button>Remind me later (${left} left)</button></form>`
      : '<p>You have used all reminders. Verification is now required.</p>';
    res.send(page('Verify user IDs', `<h2>Verify user IDs</h2>
      <p>The account owner must verify office user IDs every 90 days.</p>
      <p>Placeholder: the user ID table goes here.</p>
      <form method="post" action="/verify/ids" style="display:inline"><button>OK</button></form>
      ${remind}`));
  }));
  app.post('/verify/ids', requireUser(async (req, res) => {
    await store.updateUser(req.session.user, { ids_verified_at: new Date(), ids_remind_count: 0 });
    res.redirect('/gate');
  }));
  app.post('/verify/ids/remind', requireUser(async (req, res) => {
    const u = await store.getUser(req.session.user);
    if ((u.ids_remind_count || 0) >= MAX_REMINDERS) return res.redirect('/verify/ids');
    await store.updateUser(req.session.user, { ids_remind_count: (u.ids_remind_count || 0) + 1 });
    await log(req.session.user, 'REMIND_LATER', 'ids');
    res.redirect(cfg.workvivoUrl);
  }));

  // ---- Step 4: bill payment ------------------------------------------------
  app.get('/pay', requireUser(async (req, res) => {
    res.send(page('Payment due', `<h2>Account action required</h2>
      <p>Your subscription payment is outstanding.</p>
      <form method="post" action="/pay"><button>Pay now (demo)</button></form>`));
  }));
  app.post('/pay', requireUser(async (req, res) => {
    // Demo only. Production needs a real payment processor, not a button.
    await store.updateUser(req.session.user, { payment_status: 'paid' });
    res.redirect('/gate');
  }));

  // ---- Audit log -----------------------------------------------------------
  // Exposes emails, so it is only open in dev or with the LOGS_TOKEN query value.
  app.get('/logs', async (req, res, next) => {
    if (cfg.mode !== 'dev' && (!cfg.logsToken || req.query.token !== cfg.logsToken)) {
      return res.status(404).send('Not found');
    }
    try {
      const rows = await store.recentChecks(100);
      if (req.query.format === 'json') return res.json(rows);
      res.send(page('Login checks', `<h2>Login checks</h2><pre>${esc(rows.map((r) =>
        `${r.created_at} | ${r.email} | ${r.decision} | step=${r.step || '-'}`).join('\n'))}</pre>`));
    } catch (err) { next(err); }
  });

  app.get('/healthz', async (req, res) => {
    res.json({ ok: true, mode: cfg.mode, db: store instanceof PgStore ? 'postgres' : 'memory' });
  });

  // ---- Dev helpers (never enabled outside dev mode) ------------------------
  if (cfg.mode === 'dev') {
    app.post('/dev/reset', async (req, res, next) => {
      try { await store.reset(); req.session.destroy(() => res.json({ ok: true })); } catch (err) { next(err); }
    });
    // Seed a user partway through the steps. Fields: email, terms, info, ids, paid (each "1" or "0").
    app.post('/dev/seed', async (req, res, next) => {
      try {
        const email = String(req.body.email || '');
        const on = (k) => req.body[k] === '1';
        const now = new Date();
        await store.updateUser(email, {
          terms_version: on('terms') ? TERMS_VERSION : null,
          terms_accepted_at: on('terms') ? now : null,
          info_verified_at: on('info') ? now : null,
          ids_verified_at: on('ids') ? now : null,
          payment_status: on('paid') ? 'paid' : 'unpaid',
        });
        res.json(await store.getUser(email));
      } catch (err) { next(err); }
    });
    // Simulates a 90-day expiry by backdating the verification timestamps.
    app.post('/dev/age', async (req, res, next) => {
      try {
        const email = String(req.body.email || '');
        const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
        await store.updateUser(email, { info_verified_at: old, ids_verified_at: old });
        res.json(await store.getUser(email));
      } catch (err) { next(err); }
    });
  }

  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).send('Something went wrong. Access was not granted.');
  });

  return { app, cfg, store };
}

module.exports = { createApp };

if (require.main === module) {
  const env = process.env;
  // okta: real sign-in. dev: local testing only. Anything else (or unset): locked.
  const mode = ['okta', 'dev'].includes(env.MODE) ? env.MODE : 'locked';
  const port = Number(env.PORT || 3000);
  const store = env.DATABASE_URL ? new PgStore(env.DATABASE_URL) : new MemoryStore();
  const { app, cfg } = createApp({
    mode,
    baseUrl: env.BASE_URL || `http://localhost:${port}`,
    workvivoUrl: env.WORKVIVO_EMBED_LINK || 'https://example.com/workvivo-placeholder',
    oktaIssuer: env.OKTA_ISSUER, clientId: env.CLIENT_ID, clientSecret: env.CLIENT_SECRET,
    sessionSecret: env.SESSION_SECRET || undefined,
    logsToken: env.LOGS_TOKEN || null,
  }, store);
  (async () => {
    await store.init();
    if (mode === 'okta') await app.locals.setupOkta();
    app.listen(port, () => console.log(`Gateway (${mode}, db=${env.DATABASE_URL ? 'postgres' : 'memory'}) on ${cfg.baseUrl}`));
  })().catch((err) => { console.error('Startup failed:', err); process.exit(1); });
}
