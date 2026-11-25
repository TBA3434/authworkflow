# Workvivo Launcher: login gate (POC)

Login → `/gate` checks the database → first incomplete step → Workvivo.

Steps, in the order Primerica's POL runs them:

| Step | Route | Rule |
|---|---|---|
| Service agreement | `/terms` | Must accept the current `TERMS_VERSION` (2025-09) |
| Personal info | `/verify/info` | Re-verify every 90 days |
| Office user IDs | `/verify/ids` | Re-verify every 90 days. "Remind me later" works 3 times, then it is required |
| Bill payment | `/pay` | `payment_status` must be `paid` |

## Run and test

```bash
npm install
npm test           # 21 tests: gate logic, full flow, 90-day expiry, reminders, logging, escaping, Postgres SQL
npm run dev        # http://localhost:3000, in-memory store, dev sign-in
```

Dev mode adds `/dev/seed` (set a user's steps), `/dev/age` (backdate verification to 91 days), and `/dev/reset`. None of them exist unless `MODE` is `dev`.

## Render setup

1. **Create Postgres:** New → PostgreSQL. Choose the same region as the web service. Use a paid plan. The free plan expires after 30 days.
2. **Create the web service:** Node, build `npm install`, start `npm start`, health check `/healthz`.
3. **Environment variables on the web service:**
   - `DATABASE_URL`: the Postgres **Internal Database URL**, from the database's Connections section. If you use the External URL instead, append `?sslmode=require`
   - `BASE_URL`: `https://<service>.onrender.com`
   - `MODE`: `dev` for the first deploy, `okta` later
   - `SESSION_SECRET`: a long random string
   - `LOGS_TOKEN`: a long random string, so `/logs?token=...` works when `MODE` is `okta`
   - `WORKVIVO_EMBED_LINK`, `OKTA_ISSUER`, `CLIENT_ID`, `CLIENT_SECRET`: when you have them
4. The tables are created on startup (`CREATE TABLE IF NOT EXISTS`).

## Before a customer sees this

- Sessions are in memory. A restart signs everyone out. Fine for a POC, not for production.
- The agreement, personal info, and user ID pages are placeholders. Legal must approve the agreement text. The real pages should be POL's, not rebuilt.
- The payment page is a demo button. Production needs a real payment processor.
- The database is a stand-in. It has to be replaced by, or synced from, Primerica's real status source (see the dependencies doc).
- `/logs` shows emails. Keep the token private.
- Okta-mode sign-in has not been tested against a tenant.
