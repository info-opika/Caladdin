# Staging deploy — Render step-by-step

Deploy Caladdin to a **staging** environment before production cohort or CEO demo. Pair with [SMOKE_TEST.md](../../SMOKE_TEST.md) and [MONITORING_SETUP.md](./MONITORING_SETUP.md).

**Estimated time:** 45–90 minutes (first deploy).

---

## Prerequisites

| Item | Action |
|------|--------|
| GitHub repo | Push latest `main` (includes `render.yaml`, `Dockerfile`) |
| Supabase | Staging project **or** separate schema; migrations **001–027** applied |
| Google OAuth | Redirect URI: `https://<staging-host>/auth/callback` |
| Resend | API key + verified `EMAIL_FROM` domain |
| Secrets | Generate `SESSION_SECRET`, `OAUTH_STATE_SECRET`, `CALADDIN_API_KEY` (≥ 32 chars each) |

See [DEPLOYMENT.md](../DEPLOYMENT.md) for migration order and env var reference.

---

## Step 1 — Apply database migrations

```bash
# From repo root, with staging Supabase credentials in .env
npm run db:apply
npm run db:status
```

Confirm migrations through `027_team_scheduling.sql` (or latest in `supabase/migrations/`).

---

## Step 2 — Create Render Blueprint (staging)

1. Open [Render Dashboard](https://dashboard.render.com/) → **Blueprints** → **New Blueprint Instance**.
2. Connect the Caladdin GitHub repository.
3. Select branch `main` (or staging branch).
4. Render reads [`render.yaml`](../../render.yaml) and proposes:
   - Web service: `caladdin`
   - Cron: `caladdin-session-expiry` (every 15 min)
   - Cron: `caladdin-reminders` (hourly)
5. **Rename for staging (recommended):** edit service names to `caladdin-staging`, `caladdin-staging-session-expiry`, `caladdin-staging-reminders` before first apply — or use a separate Render project.

---

## Step 3 — Configure environment group

In Render → **Environment Groups** → `caladdin-core` (created by blueprint), set **sync: false** secrets:

| Variable | Staging value |
|----------|---------------|
| `CALADDIN_BASE_URL` | `https://caladdin-staging.onrender.com` (your URL) |
| `GOOGLE_REDIRECT_URI` | `{CALADDIN_BASE_URL}/auth/callback` |
| `SUPABASE_URL` | Staging Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging service role key |
| `ANTHROPIC_API_KEY` | Staging or shared dev key |
| `GOOGLE_OAUTH_CLIENT_ID` / `SECRET` | OAuth client with staging redirect |
| `CALADDIN_API_KEY` | Random secret for `/jobs/*`, `/confirm/*` |
| `SESSION_SECRET` | Random ≥ 32 chars |
| `OAUTH_STATE_SECRET` | Random ≥ 32 chars |
| `RESEND_API_KEY` | Resend key |
| `EMAIL_FROM` | e.g. `Caladdin Staging <staging@yourdomain.com>` |
| `NODE_ENV` | `production` (already in blueprint) |
| `CALADDIN_SERVICE_NAME` | `caladdin-staging-web` (override on web service for log facets) |

Optional: `REDIS_URL` if using Render Key Value for rate limits.

---

## Step 4 — Deploy web service

1. Blueprint apply triggers first Docker build.
2. Watch **Logs** for `Caladdin listening on …`.
3. Confirm health check: **Settings** → Health Check Path = `/health`.

```bash
export CALADDIN_BASE_URL=https://caladdin-staging.onrender.com
curl -sS "$CALADDIN_BASE_URL/health" | jq .
# Expect: { "status": "ok", "db": "ok", ... }
```

If `503` with `"db": "error"`, verify `SUPABASE_URL` and network access.

---

## Step 5 — Verify cron jobs

Cron services call the web service with `x-api-key`:

```bash
curl -sS -X POST "$CALADDIN_BASE_URL/jobs/session-expiry" \
  -H "x-api-key: $CALADDIN_API_KEY"
# Expect JSON success body

curl -sS -X POST "$CALADDIN_BASE_URL/jobs/reminders" \
  -H "x-api-key: $CALADDIN_API_KEY"
```

In Render → each cron service → **Logs**, confirm hourly/15-min runs after schedule fires.

---

## Step 6 — OAuth smoke (manual)

1. Visit `$CALADDIN_BASE_URL/auth/start`.
2. Complete Google consent with a **test account**.
3. Land on chat UI; confirm session cookie `caladdin_session` and CSRF cookie `caladdin_csrf`.

---

## Step 7 — Run automated smoke script

```bash
export CALADDIN_BASE_URL=https://caladdin-staging.onrender.com
export CALADDIN_API_KEY=your-staging-api-key
bash scripts/smoke-staging.sh
```

Fix any failing step before IC-7 sign-off.

---

## Step 8 — Attach log drain (staging)

Follow [MONITORING_SETUP.md](./MONITORING_SETUP.md) using staging dataset name (e.g. `caladdin-staging`). Verify with:

```bash
node scripts/verify-log-drain.mjs --base-url "$CALADDIN_BASE_URL"
```

---

## Step 9 — Sign-off record

Create a ticket or note with:

- Staging URL
- Deploy ID / commit SHA
- `npm test` + `scripts/smoke-staging.sh` output (paste)
- Completed checklist from [SMOKE_TEST.md](../../SMOKE_TEST.md)
- Date and owner

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails on Docker | Check `Dockerfile`; run `npm run build` locally |
| OAuth redirect mismatch | Google Console redirect must match `GOOGLE_REDIRECT_URI` exactly |
| 403 on POST /voice or /api/* | CSRF: client must send `x-csrf-token` matching `caladdin_csrf` cookie |
| Cron 401 | `CALADDIN_API_KEY` mismatch between cron env and web env group |
| Health 503 redis | Set `REDIS_URL` or unset in staging if Redis not provisioned |

---

## Related

- [DEPLOYMENT.md](../DEPLOYMENT.md) — production runbook
- [ROLLBACK.md](./ROLLBACK.md) — rollback procedure
- [render.yaml](../../render.yaml) — infrastructure blueprint
