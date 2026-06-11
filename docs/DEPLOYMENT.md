# Caladdin deployment guide

Production deployment target: **Render** (Blueprint: [`render.yaml`](../render.yaml)). Database: **Supabase Postgres**.

## Prerequisites

- Supabase project with migrations applied (see below)
- Google OAuth client with redirect URI `{CALADDIN_BASE_URL}/auth/callback`
- Resend API key (invites, scheduling links, booking reminders)
- Anthropic API key (voice orchestration)

## Database migrations — apply order

All files in `supabase/migrations/` must be applied in filename order. Key migrations for production:

| File | Purpose |
|------|---------|
| `019_rls_policies.sql` | Row Level Security on user-scoped tables |
| `020_sessions.sql` | Persistent auth sessions (`sessions` table) — **required for sign-in** |
| `021_rate_limits.sql` | Postgres-backed distributed rate limits |
| `022_event_types.sql` | Event types + public booking slugs |
| `023_booking_responses.sql` | Guest intake responses on bookings |
| `024_booking_reminders.sql` | Reminder queue (T-24h, T-1h) |
| `025`–`028` | Indexes, webhooks, team scheduling, atomic slot claim |

Earlier migrations (`001`–`018`) must already be applied on the project.

### Apply commands

```bash
# Recommended: applies all pending files in supabase/migrations/
npm run db:apply

# Or Supabase CLI (linked project)
npm run db:push
```

Requires in `.env` (or CI secrets):

- `SUPABASE_URL`
- `SUPABASE_DB_PASSWORD` (or `DATABASE_URL`)

Verify: `npm run db:status`

## Required environment variables

Set via Render **env group** `caladdin-core` (see `render.yaml`) or Dashboard → Environment.

| Variable | Required | Notes |
|----------|----------|-------|
| `NODE_ENV` | yes | `production` |
| `PORT` | yes | `3000` (Render sets automatically if omitted) |
| `ANTHROPIC_API_KEY` | yes | Claude API |
| `SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only; bypasses RLS for workers/cron |
| `GOOGLE_OAUTH_CLIENT_ID` | yes | |
| `GOOGLE_OAUTH_CLIENT_SECRET` | yes | |
| `GOOGLE_REDIRECT_URI` | yes | `{CALADDIN_BASE_URL}/auth/callback` |
| `CALADDIN_BASE_URL` | yes | Public URL, e.g. `https://caladdin.onrender.com` |
| `CALADDIN_API_KEY` | yes | Protects `/jobs/*`, `/confirm/*` (cron uses `x-api-key` header) |
| `SESSION_SECRET` | yes | ≥ 32 chars in production |
| `OAUTH_STATE_SECRET` | yes | OAuth CSRF signing |
| `RESEND_API_KEY` | yes | Email delivery |
| `EMAIL_FROM` | yes | e.g. `Caladdin <onboarding@caladdin.app>` |

### Optional

| Variable | Default | Notes |
|----------|---------|-------|
| `REDIS_URL` | — | If set, `/health` pings Redis; 503 when unreachable in production |
| `NTFY_TOPIC` | `caladdin-agent` | Agent notifications |
| `NTFY_USER_TOPIC` | `caladdin-user` | User notifications |
| `MAX_PILOT_USERS` | `10` | Pilot cap |
| `CALADDIN_KILL_SWITCH` | `0` | `1` blocks mutations |
| `CALADDIN_SERVICE_NAME` | `caladdin` | Log field `service` |

Copy local template: [`.env.example`](../.env.example)

## Render Blueprint deploy

See **[RENDER_SETUP.md](./RENDER_SETUP.md)** for a full pilot checklist.

1. Push repo to GitHub; connect in Render.
2. **New → Blueprint** → point at `render.yaml`.
3. Fill **sync: false** secrets in Dashboard for `caladdin-core` (`CALADDIN_BASE_URL`, `GOOGLE_REDIRECT_URI`, API keys, secrets).
4. Deploy web service; confirm **Health Check** passes on `GET /health`:

   ```json
   {"status":"ok","db":"ok","redis":"skipped","version":"1.0.0","uptime":42}
   ```

5. Attach [log drain](ops/LOG_SHIPPING.md) for production observability.

### Docker local smoke test

```bash
docker build -t caladdin .
docker run --env-file .env -p 3000:3000 caladdin
curl http://localhost:3000/health
```

## Background jobs / cron

The web process also runs an in-process session expiry worker every **15 minutes** (`startSessionExpiryWorker`). Render cron jobs provide a **durable, single-flight** trigger and match production runbooks.

| Job | Schedule | Endpoint | Auth |
|-----|----------|----------|------|
| Session expiry | `*/15 * * * *` | `POST /jobs/session-expiry` | Header `x-api-key: CALADDIN_API_KEY` |
| Booking reminders | `0 * * * *` | `POST /jobs/reminders` | Same |

Defined in `render.yaml` as `caladdin-session-expiry` and `caladdin-reminders`.

### Manual trigger (staging)

```bash
curl -X POST "$CALADDIN_BASE_URL/jobs/session-expiry" \
  -H "x-api-key: $CALADDIN_API_KEY"

curl -X POST "$CALADDIN_BASE_URL/jobs/reminders" \
  -H "x-api-key: $CALADDIN_API_KEY"
```

Expected: `200` with `{"status":"complete",...}`.

## Health checks

- **Render**: `healthCheckPath: /health` in Blueprint.
- **Docker**: `HEALTHCHECK` in `Dockerfile`.
- **Failure modes**: `503` when Postgres unreachable (`db: "error"`) or Redis unreachable when `REDIS_URL` is set in production.

## Service role exceptions

Cron and workers use **Supabase service role** (no per-user RLS context). See comments in `019_rls_policies.sql` for: session expiry, compensation worker, public booking token lookup, waitlist.

## Related docs

- [LOG_SHIPPING.md](ops/LOG_SHIPPING.md) — Datadog/Axiom drains, 5xx alert
- [production-readiness/AGENT_ASSIGNMENTS.md](production-readiness/AGENT_ASSIGNMENTS.md) — P1-10–P1-12 acceptance criteria
