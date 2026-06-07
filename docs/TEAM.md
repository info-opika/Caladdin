# Caladdin — Team Onboarding

Engineer guide for local development, ownership, and production operations. Complements [README.md](../README.md), [DEPLOYMENT.md](./DEPLOYMENT.md), and the [production-readiness pack](./production-readiness/CEO_PROGRESS_TRACKER.md).

## Quick local setup

```bash
cp .env.example .env
# Required: SUPABASE_*, GOOGLE_OAUTH_*, ANTHROPIC_API_KEY, CALADDIN_API_KEY, SESSION_SECRET

npm install
npm run db:link    # once — links Supabase project
npm run db:push    # apply migrations 001–024

npm run build:web
npm run dev        # http://localhost:3000
```

Run the active test suite:

```bash
npm test
npm run test:coverage   # enforces ≥80% statement coverage
```

See [supabase/README.md](../supabase/README.md) for migration workflow.

## Architecture (30-second map)

```
web/ (Vite SPA)  →  Express API (src/index.ts)
                         ├─ routes/voice.ts      host chat + orchestration
                         ├─ routes/schedule_public.ts   guest /s/:token booking
                         ├─ routes/book_public.ts       public event-type pages
                         └─ jobs/*                 cron: reminders, expiry, compensation

Parser (src/core/parser.ts) → Orchestrator → handlers/* → Supabase + Google Calendar
```

Policy and session state live in Postgres (Supabase). Optional `REDIS_URL` is pinged on `/health` only; **rate limits use Postgres** (`rate_limits` table) — see ADR below.

## Agent ownership (CEO handoff sprint)

| Agent | Focus | Key paths |
|-------|--------|-----------|
| **2** | Architecture, performance | `slot-scoring.ts`, caching, bundle size |
| **3** | Frontend / UX | `web/`, booking SPA, Lighthouse |
| **4** | Backend / bugs | `routes/*`, `handlers/*`, guest lifecycle |
| **5** | Testing / coverage | `tests/`, `vitest.config.ts`, CI |
| **6** | Security / DevOps | RLS, Render, monitoring, secrets |
| **7** | Readiness / docs | `docs/production-readiness/*`, CEO criteria |

Escalate P0 bugs to Agent 4; coverage gate failures to Agent 5; deploy/smoke to Agent 6.

## Environment secrets

| Secret | Where used | Rotation |
|--------|------------|----------|
| `SESSION_SECRET` | HMAC session cookies | Quarterly; invalidate all sessions on rotate |
| `OAUTH_STATE_SECRET` | Google OAuth CSRF | With OAuth client rotation |
| `SUPABASE_SERVICE_ROLE_KEY` | Server DB (bypasses RLS) | Supabase dashboard → API keys |
| `CALADDIN_API_KEY` | `/jobs/*`, `/confirm/*` cron | Render env group |
| `ANTHROPIC_API_KEY` | Voice intent parsing | Anthropic console |

Never commit `.env`. Production checklist: [DEPLOYMENT.md](./DEPLOYMENT.md).

## Kill switch & pilot controls

Set `CALADDIN_KILL_SWITCH=1` (or pilot cap via `MAX_PILOT_USERS`) to block calendar mutations. Wired through `checkOperationAllowed()` on voice orchestration and guest `POST /s/:token/select`.

Verify after deploy:

```bash
curl -s "$BASE_URL/health" | jq .
```

## On-call basics

1. **5xx spike** — Render logs → `docs/ops/MONITORING_SETUP.md`; check DB and Google OAuth token refresh.
2. **Guest booking broken** — Run [SMOKE_TEST.md](../SMOKE_TEST.md) against staging; inspect `scheduling_sessions` status.
3. **Voice 503** — Anthropic outage or Supabase; voice route logs `Voice pipeline failed` with `x-request-id`.
4. **Rollback** — [docs/ops/ROLLBACK.md](./ops/ROLLBACK.md); promote previous Render deploy.

Related: [DEPLOYMENT.md](./DEPLOYMENT.md) · [ROLLBACK.md](./ops/ROLLBACK.md) · [MONITORING_SETUP.md](./ops/MONITORING_SETUP.md)

## ADR: Postgres rate limits (not Redis)

**Decision:** Distributed rate limiting uses the `rate_limits` Postgres table (migration `021`), not Redis counters.

**Why:** Fewer moving parts for pilot; Supabase already required; adequate at ≤10 pilot users.

**Future:** `REDIS_URL` + `src/services/redis.ts` ping path exists for health checks; swap limiter backend when traffic exceeds Postgres write budget.

## Policy flags engineers should know

| Flag | Location | Behavior |
|------|----------|----------|
| `shareAvailabilityOnInvite` | `user_policies.profile` | When `false`, `GET /s/:token/calendar` returns 403 |
| `posture` | `scheduling_sessions.posture` | `strict` / `mutual` / `flexible` — controls guest calendar overlap in `generateSlots()` |

## Useful commands

| Command | Purpose |
|---------|---------|
| `npm run db:status` | Pending migrations |
| `npm run audit:deps` | Production dependency audit (high+) |
| `npm run log-decision "…"` | Append to DECISIONS.md |

## CEO handoff checklist (engineering)

- [ ] `npm run test:coverage` ≥ **80%** statements
- [ ] B06 posture wired · B07 calendar sharing enforced
- [ ] Staging smoke per [SMOKE_TEST.md](../SMOKE_TEST.md)
- [ ] Coverage artifact uploaded in CI (`.github/workflows/ci.yml`)

Questions: `#caladdin-eng` (internal) · on-call runbook in `docs/ops/`.
