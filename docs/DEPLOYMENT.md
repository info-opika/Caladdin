# Caladdin deployment guide

Production deployment target: **Render** (Blueprint: [`render.yaml`](../render.yaml)). Database: **Supabase Postgres**.

## Prerequisites

- Supabase project with migrations applied (see below)
- Google OAuth client with redirect URIs:
  - Host sign-in: `{CALADDIN_BASE_URL}/auth/callback`
  - Invitee calendar grant: `{CALADDIN_BASE_URL}/s/grant/callback` (same OAuth client; see [Google Cloud Console checklist](#google-cloud-console-checklist-invitee-grant-oauth))
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
| `029_v3_command_logs.sql` | NL command audit trail |
| `030_v3_invite_calendar_grants.sql` | Invitee calendar grant OAuth tokens |
| `031_v4_slot_source.sql` | `slot_source` on scheduling sessions (mutual vs host-only honesty) |
| `034_v4_agent_trace.sql` | `agent_trace` JSON on `command_logs` for agent observability |

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
| `INVITEE_GRANT_REDIRECT_URI` | no | Defaults to `{CALADDIN_BASE_URL}/s/grant/callback`; set only if you override the grant callback path (must match `invitee_oauth.ts` and Google Console) |
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
| `CALADDIN_AGENT_ENABLED` | `0` | `1` routes all users through the scheduling agent on `/voice` |
| `CALADDIN_AGENT_PILOT_USERS` | — | Comma-separated user UUIDs for agent pilot when global flag is off |
| `ANTHROPIC_AGENT_MODEL` | `claude-sonnet-4-20250514` | Model for scheduling agent tool loop |
| `CALADDIN_SERVICE_NAME` | `caladdin` | Log field `service` |

Copy local template: [`.env.example`](../.env.example)

### Invitee grant OAuth callback

When an invitee shares calendar availability, Caladdin redirects them through Google OAuth with scope `calendar.freebusy` only (`src/services/invitee_oauth.ts`). After consent, Google redirects to:

```
{CALADDIN_BASE_URL}/s/grant/callback
```

`INVITEE_GRANT_REDIRECT_URI` is optional; when unset, the app derives the URI above from `CALADDIN_BASE_URL`. In production, `validate-production.ts` fails fast if `INVITEE_GRANT_REDIRECT_URI` is set to anything other than that derived value.

### Google Cloud Console checklist (invitee grant OAuth)

Manual step — cannot be automated in code. On the **same** OAuth 2.0 Web client used for host sign-in (`GOOGLE_OAUTH_CLIENT_ID`):

- [ ] APIs & Services → Credentials → your Web application client
- [ ] Under **Authorized redirect URIs**, add host sign-in (if not already): `{CALADDIN_BASE_URL}/auth/callback`
- [ ] Add invitee grant callback: `{CALADDIN_BASE_URL}/s/grant/callback`
- [ ] Save; redeploy is not required on Render, but env `CALADDIN_BASE_URL` / `INVITEE_GRANT_REDIRECT_URI` must match the registered URIs exactly (scheme, host, path, no trailing slash on base URL)

Without the grant redirect URI registered, invitees see a Google OAuth error when starting the calendar-grant flow.

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
