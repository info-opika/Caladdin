# Caladdin Agent Assignments — Phase 1 & Phase 2

**Chief Architect:** Agent 7  
**Date:** 2026-06-07  
**Binding decisions:** See [MASTER_PLAN.md](./MASTER_PLAN.md) Section 2

---

## Agent Roster

| Agent | Role | Phase 1 (P0) | Phase 2 (P1) |
|-------|------|--------------|--------------|
| **2** | Architecture & Performance | P0-01, P0-07, P0-08 | P1-10 |
| **3** | Frontend & UX | — | P1-01 UI, P1-02, P1-03 UI, P1-06, P1-07 UI, P1-14 |
| **4** | Backend | P0-04, P0-05, P0-06, P0-10 | P1-01 API, P1-03 API, P1-04, P1-05, P1-07 API, P1-08, P1-15 |
| **5** | Testing & QA | P0-03 | P1-09, P1-13 |
| **6** | Security & DevOps | P0-02, P0-09 | P1-11, P1-12 |

---

## Phase 1 — Foundation (Week 1–2)

### Agent 2: Architecture & Performance

#### P0-01: Persistent Session Store

| | |
|---|---|
| **Blockers** | None to start; must integrate with P0-02 before Phase 2 |
| **Depends on** | P0-02 RLS (soft — can use service role for session table initially) |

**Files to create/modify:**

| Action | Path | Task |
|--------|------|------|
| CREATE | `supabase/migrations/020_sessions.sql` | Table: `id`, `token_hash`, `user_id`, `email`, `created_at`, `expires_at`; index on `token_hash` |
| CREATE | `src/db/sessions.ts` | `createSession()`, `getSession()`, `deleteSession()`, `hashToken()` |
| MODIFY | `src/middleware/session.ts` | Replace in-memory `Map`; sign/verify HMAC; store hash in DB |
| MODIFY | `src/config.ts` | Enforce `SESSION_SECRET` length ≥ 32 in production |
| MODIFY | `src/routes/auth.ts` | Use new session create on OAuth callback |
| CREATE | `tests/integration/sessions-persistence.test.ts` | 2-process or sequential restart test |

**Acceptance criteria:**
- [ ] Cookie token = `payload.hmac`; invalid HMAC rejected
- [ ] `SESSION_SECRET` used; dev default rejected in `NODE_ENV=production`
- [ ] Session survives server restart (same cookie → same user)
- [ ] TTL 7 days; expired sessions return 401
- [ ] Two Node instances share session state via DB

---

#### P0-07: Distributed Rate Limiting

| | |
|---|---|
| **Blockers** | Redis URL required (`REDIS_URL` in `.env.example`) |
| **Depends on** | P0-03 CI (for test gate) |

**Files to create/modify:**

| Action | Path | Task |
|--------|------|------|
| CREATE | `src/services/redis.ts` | Singleton client; connect/disconnect helpers |
| MODIFY | `src/core/rate-limiter.ts` | Redis sliding window; keep intent 20/hr limit |
| MODIFY | `src/routes/voice.ts` | HTTP limit: 30 req/min per `userId` |
| MODIFY | `src/routes/schedule_public.ts` | HTTP limit: 10 req/min per token on `POST .../select` |
| MODIFY | `src/config.ts` | Add `redisUrl` optional; dev in-memory fallback |
| MODIFY | `.env.example` | Add `REDIS_URL=` |
| CREATE | `tests/unit/rate-limiter-redis.test.ts` | Mock Redis; verify 21st request blocked |

**Acceptance criteria:**
- [ ] Rate limit survives process restart
- [ ] Two instances share counters (integration test or documented manual procedure)
- [ ] `POST /voice` returns 429 with `retryAfterMs` when exceeded
- [ ] Intent-level 20/hr limit preserved on Redis backend
- [ ] Dev fallback in-memory only when `NODE_ENV=development` and no `REDIS_URL`

---

#### P0-08: Delete Dead Scheduling Router

| | |
|---|---|
| **Blockers** | None |
| **Depends on** | None |

**Files to create/modify:**

| Action | Path | Task |
|--------|------|------|
| DELETE | `src/routes/scheduling.ts` | After parity audit |
| MODIFY | `src/index.ts` | Remove any commented import if present |
| VERIFY | `src/routes/schedule_public.ts` | Port any unique logic from deleted file |

**Acceptance criteria:**
- [ ] `grep -r scheduling.ts` returns zero hits (except docs/changelog)
- [ ] All booking integration tests pass
- [ ] No duplicate booking code paths remain

---

### Agent 3: Frontend & UX

**Phase 1:** No P0 assignments. Agent 3 may read `web/` and prepare design token draft **locally only** — do not merge until Phase 1 gate passes.

**Phase 1 prep (non-blocking):**
- Audit `web/main.js`, `web/styles.css`, `web/index.html` for Phase 2 migration inventory
- Document component map in PR comment or scratch doc (not committed unless Week 3)

---

### Agent 4: Backend

#### P0-04: Wire Kill Switch to All Mutations

| | |
|---|---|
| **Blockers** | None |
| **Depends on** | None |

**Files to create/modify:**

| Action | Path | Task |
|--------|------|------|
| MODIFY | `src/core/orchestrator.ts` | Call `checkOperationAllowed('voice_mutation')` at start of `orchestrate()` |
| MODIFY | `src/routes/schedule_public.ts` | Call `checkOperationAllowed('calendar_write')` in select handler |
| MODIFY | `src/pilot/pilot_controls.ts` | Fix `pilot_full` reason label (L76) |
| CREATE | `tests/integration/kill-switch.test.ts` | Kill switch blocks voice + booking |

**Acceptance criteria:**
- [ ] `CALADDIN_KILL_SWITCH=1` → voice returns graceful failure message
- [ ] Kill switch blocks `POST /s/:token/select`
- [ ] `pilot_full` distinct from `kill_switch_active` in response payload
- [ ] No handler mutation occurs when blocked

---

#### P0-05: Fix Voice Route Silent Errors

| | |
|---|---|
| **Blockers** | None |
| **Depends on** | None |

**Files to create/modify:**

| Action | Path | Task |
|--------|------|------|
| MODIFY | `src/routes/voice.ts` | Replace empty `catch {}` at ~L97 with `logger.error` + structured 503 |
| CREATE/MODIFY | `tests/integration/voice-error-logging.test.ts` | Assert log + `x-request-id` header |

**Acceptance criteria:**
- [ ] 503 response includes `x-request-id`
- [ ] Log line contains `requestId`, `userId`, error message
- [ ] `Retry-After: 30` header present

---

#### P0-06: Schedule Session Expiry Job

| | |
|---|---|
| **Blockers** | None |
| **Depends on** | None |

**Files to create/modify:**

| Action | Path | Task |
|--------|------|------|
| MODIFY | `src/db/scheduling_sessions.ts` | Ensure `expireOpenSessions()` is exported and idempotent |
| CREATE | `src/jobs/session-expiry.ts` | Wrapper that logs expired count |
| MODIFY | `src/index.ts` | `setInterval` every 15 min calling expiry job |
| CREATE | `tests/integration/session-expiry.test.ts` | Seed expired session; assert status transition |

**Acceptance criteria:**
- [ ] Sessions past `expires_at` → `expired` within 15 min
- [ ] Log line reports count per run
- [ ] Job does not throw on empty result set

---

#### P0-10: Confirmation Re-exec Failure Handling

| | |
|---|---|
| **Blockers** | None |
| **Depends on** | None |

**Files to create/modify:**

| Action | Path | Task |
|--------|------|------|
| MODIFY | `src/core/confirmation-actions.ts` | On re-exec fail: return 500 or rollback to `pending`; log failure |
| MODIFY | `web/main.js` | Show failure state in confirm card (Phase 1 minimal UI fix) |
| CREATE | `tests/integration/confirmation-reexec-failure.test.ts` | Failed re-exec → retryable confirmation |

**Acceptance criteria:**
- [ ] Failed re-exec does not return bare `success: true`
- [ ] Confirmation status rollback to `pending` on failure
- [ ] Chat UI shows error message (not silent success)
- [ ] Log includes token, intent, error

---

### Agent 5: Testing & QA

#### P0-03: CI/CD Pipeline

| | |
|---|---|
| **Blockers** | None — **highest priority, land first** |
| **Depends on** | None |

**Files to create/modify:**

| Action | Path | Task |
|--------|------|------|
| CREATE | `.github/workflows/ci.yml` | Node 22, `npm ci`, `npm test`, `npm run build` |
| DELETE | `tests/tests/` (entire tree) | Remove duplicate + `__MACOSX` junk |
| MODIFY | `.gitignore` | Add `__MACOSX/`, `tests/tests/` |
| MODIFY | `package.json` | Ensure `build` script exists if missing |

**Acceptance criteria:**
- [ ] CI runs on push/PR to `main`
- [ ] Failing test blocks merge
- [ ] No `tests/tests/` paths in repo
- [ ] Green badge on default branch

**Phase 1 test additions (Agent 5, Week 2):**

| Test file | Covers |
|-----------|--------|
| `tests/integration/kill-switch.test.ts` | P0-04 (pair with Agent 4) |
| `tests/integration/voice-error-logging.test.ts` | P0-05 |
| `tests/integration/session-expiry.test.ts` | P0-06 |
| `tests/integration/confirmation-reexec-failure.test.ts` | P0-10 |
| `tests/integration/rls-cross-user.test.ts` | P0-02 (pair with Agent 6) |
| `tests/integration/sessions-persistence.test.ts` | P0-01 (pair with Agent 2) |
| `tests/integration/security-headers.test.ts` | P0-09 (pair with Agent 6) |

---

### Agent 6: Security & DevOps

#### P0-02: Supabase Row Level Security

| | |
|---|---|
| **Blockers** | None — **merge before db refactors** |
| **Depends on** | P0-03 CI recommended for test gate |

**Files to create/modify:**

| Action | Path | Task |
|--------|------|------|
| CREATE | `supabase/migrations/019_rls_policies.sql` | Enable RLS on: `users`, `events`, `user_policies`, `scheduling_sessions`, `google_tokens`, `pending_confirmations` |
| MODIFY | `src/db/client.ts` | Add `setUserContext(userId)`, `withServiceRole()` helpers |
| MODIFY | `src/db/*.ts` (incremental) | Wrap user-scoped queries with context (prioritize: `events`, `scheduling_sessions`, `user_policies`) |
| CREATE | `tests/integration/rls-cross-user.test.ts` | User A cannot read User B data |
| MODIFY | `.env.example` | Document `SUPABASE_SERVICE_ROLE_KEY` scope |

**RLS policy pattern (mandatory):**
```sql
CREATE POLICY "user_isolation_select" ON events
  FOR SELECT USING (user_id = current_setting('app.user_id', true)::uuid);
-- Repeat for INSERT, UPDATE, DELETE per table
```

**Acceptance criteria:**
- [ ] RLS enabled on all 6 tables listed above
- [ ] Cross-user read returns empty or error (integration test)
- [ ] Service role + `setUserContext` returns own rows only
- [ ] Worker/cron paths documented as service-role exceptions
- [ ] No new queries bypass RLS without Agent 7 approval

---

#### P0-09: Security Headers

| | |
|---|---|
| **Blockers** | None |
| **Depends on** | None |

**Files to create/modify:**

| Action | Path | Task |
|--------|------|------|
| MODIFY | `package.json` | Add `helmet` dependency |
| MODIFY | `src/index.ts` | `app.use(helmet({...}))` before routes |
| CREATE | `tests/integration/security-headers.test.ts` | Assert CSP, HSTS (prod), X-Frame-Options |
| MODIFY | `.env.example` | Note `NODE_ENV=production` enables HSTS |

**CSP allowances (Phase 1):**
- `style-src`: `'self' 'unsafe-inline'` (required for `/s/*` server HTML)
- `font-src`: `fonts.gstatic.com`
- `connect-src`: `'self' accounts.google.com`

**Acceptance criteria:**
- [ ] All responses include helmet headers
- [ ] HSTS only when `NODE_ENV=production`
- [ ] Google OAuth flow still works (manual or test)
- [ ] Public booking page renders with CSP enabled

---

## Phase 2 — Core Product (Week 3–6)

### Agent 2: Architecture & Performance

#### P1-10: Health Check Depth

**Files:**

| Action | Path | Task |
|--------|------|------|
| MODIFY | `src/index.ts` | Extend `GET /health`: `{ status, db, redis, version, uptime }` |
| MODIFY | `src/db/client.ts` | Add `pingDb()` → `SELECT 1` |
| MODIFY | `src/services/redis.ts` | Add `pingRedis()` |

**Acceptance criteria:**
- [ ] DB down → 503 with `{ db: 'error' }`
- [ ] Redis down → 503 in production (degraded ok in dev)
- [ ] Response includes app version from `package.json`

---

### Agent 3: Frontend & UX

#### P1-01 UI: Event Type Management

**Depends on:** Agent 4 P1-01 API (IC-5)

| Action | Path | Task |
|--------|------|------|
| CREATE | `web/src/pages/EventTypes.tsx` | CRUD list + form |
| CREATE | `web/src/pages/EventTypeEdit.tsx` | Duration, slug, description, availability rules |
| MODIFY | `web/src/router.tsx` | Route `/dashboard/event-types` |

**Acceptance criteria:**
- [ ] Create/edit/deactivate event type from UI
- [ ] Slug validation and uniqueness error displayed
- [ ] Copy public booking URL button works

---

#### P1-02: Public Booking SPA

**Depends on:** P0-09 CSP, P1-01 API optional for token-based flow first

| Action | Path | Task |
|--------|------|------|
| CREATE | `web/src/pages/BookingFlow.tsx` | Slot cards, calendar view, loading states |
| CREATE | `web/src/components/SlotCard.tsx`, `TimezoneSelector.tsx` | Shared components |
| MODIFY | `src/routes/schedule_public.ts` | Serve SPA shell or redirect; move logic to JSON API endpoints |
| DELETE | Inline HTML/CSS/JS in `schedule_public.ts` | After parity |

**Acceptance criteria:**
- [ ] Zero `alert()` calls
- [ ] Toast errors via design system
- [ ] Lighthouse Performance > 90, Accessibility > 95
- [ ] Loading states on slot selection

---

#### P1-03 UI, P1-06, P1-07 UI, P1-14

| Item | Key Files | Acceptance |
|------|-----------|------------|
| P1-03 Guest intake | `BookingFlow.tsx`, guest form components | Name, email, custom Qs submitted with booking |
| P1-06 Availability UI | `web/src/pages/Settings.tsx` | Working hours/buffers persist to `user_policies` |
| P1-07 Onboarding | `web/src/pages/Onboarding.tsx` | Timezone + privacy saved via `PATCH /api/profile` |
| P1-14 Timezone | `TimezoneSelector.tsx`, slot display utils | Browser TZ detected; slots shown in guest + host TZ |

---

### Agent 4: Backend

#### P1-01 API: Event Types + Persistent Booking URLs

**Depends on:** P0-02 RLS

| Action | Path | Task |
|--------|------|------|
| CREATE | `supabase/migrations/021_event_types.sql` | `event_types` table per audit spec |
| CREATE | `src/db/event_types.ts` | CRUD data access |
| CREATE | `src/routes/event_types.ts` | Authenticated CRUD |
| CREATE | `src/routes/book_public.ts` | `GET /book/:username/:slug` public booking entry |
| MODIFY | `src/index.ts` | Mount routes |

**Acceptance criteria:**
- [ ] Create event type → permanent public URL
- [ ] Guest books without voice command
- [ ] RLS: users can only CRUD own event types

---

#### P1-03 API, P1-04, P1-05, P1-07 API, P1-08, P1-15

| Item | Key Files | Acceptance |
|------|-----------|------------|
| P1-03 API | `022_booking_responses.sql`, `schedule_public.ts` | Guest responses stored |
| P1-04 Reschedule/cancel | `schedule_public.ts`, email token utils | Guest self-service with verification |
| P1-05 Reminders | `023_booking_reminders.sql`, `src/jobs/reminders.ts` | T-24h, T-1h emails via Resend |
| P1-07 API | `src/routes/api.ts` | `PATCH /api/profile` for timezone, privacy |
| P1-08 Propose notify | `schedule_public.ts` propose handler | Host notified on alternative time |
| P1-15 Webhooks | `024_webhook_subscriptions.sql`, webhook dispatcher | HMAC-signed `booking.confirmed`, `booking.cancelled` |

---

### Agent 5: Testing & QA

#### P1-09: Re-enable Legacy Tests

| Action | Path | Task |
|--------|------|------|
| MODIFY | `vitest.config.ts` | Expand include list incrementally |
| FIX | `tests/smoke/api-smoke.test.ts` | Update imports to current modules |
| DELETE | Tests referencing removed modules | After triage |
| MODIFY | `tests/AGENT1_TEST_MANIFEST.md`, `REPO_STATE.md` | Sync with reality |

**Acceptance criteria:**
- [ ] 60+ active test files by Week 5; 80+ target by Week 6
- [ ] CI green with expanded suite
- [ ] No tests for deleted `scheduling.ts`

---

#### P1-13: API Key Route Tests

| Action | Path | Task |
|--------|------|------|
| CREATE | `tests/integration/api-key-routes.test.ts` | 401 without key; 200 with valid key on `/jobs/*`, `/confirm/*` |

**Acceptance criteria:**
- [ ] Missing key → 401
- [ ] Wrong key → 401 (timing-safe)
- [ ] Valid `CALADDIN_API_KEY` → 200

---

### Agent 6: Security & DevOps

#### P1-11: Deploy Blueprint

| Action | Path | Task |
|--------|------|------|
| CREATE | `render.yaml` | Web service, env groups, health check `/health` |
| CREATE | `Dockerfile` | Multi-stage Node 22 Alpine, non-root user |
| MODIFY | `render.yaml` | Cron: session expiry (15 min), reminders (hourly) |

**Acceptance criteria:**
- [ ] Staging deploy succeeds from Blueprint
- [ ] Health check passes post-deploy
- [ ] Cron jobs invoke correct endpoints/commands

---

#### P1-12: Structured Log Shipping

| Action | Path | Task |
|--------|------|------|
| CREATE | `docs/ops/LOG_SHIPPING.md` | Datadog/Axiom setup, alert on 5xx > 1% |
| VERIFY | `src/logger.ts` | JSON stdout compatible with aggregators |

**Acceptance criteria:**
- [ ] Runbook documented
- [ ] Sample log line parsed correctly by chosen aggregator
- [ ] Alert rule defined for error rate

---

## Cross-Agent Dependency Matrix

| Item | Blocked By | Blocks |
|------|------------|--------|
| P0-03 CI | — | All PR quality gates; P1-09, P1-13 |
| P0-02 RLS | — | P0-01 full integration; P1-01; safe db refactors |
| P0-01 Sessions | P0-02 (soft) | P1-02; 2-instance deploy |
| P0-07 Rate limit | P0-03 | P1-09 abuse tests |
| P0-04 Kill switch | — | P1-09 abuse tests |
| P0-09 Headers | — | P1-02 SPA CSP update |
| P0-06 Expiry job | — | P1-05 reminders cron pattern |
| P1-01 Event types API | P0-02 | P1-01 UI, P1-02, P1-06 |
| P1-02 Booking SPA | P0-09, P1-01 API | P1-03, P1-14 |
| P1-11 Deploy | P0-03, P0-06 | P1-05 cron, P1-12 monitoring |
| P1-07 Onboarding | P1-07 API | P1-06 (timezone in scoring) |

---

## P0 Acceptance Criteria — Quick Reference

| ID | One-Line Done Definition |
|----|--------------------------|
| P0-01 | Signed session in DB; survives restart; 2 instances share state |
| P0-02 | RLS on 6 tables; cross-user read fails integration test |
| P0-03 | GitHub Actions green; no duplicate test tree |
| P0-04 | Kill switch blocks voice + public booking select |
| P0-05 | Voice 503 logged with requestId |
| P0-06 | Expired sessions transition within 15 min |
| P0-07 | Redis rate limits survive restart; 429 on exceed |
| P0-08 | `scheduling.ts` deleted; booking tests pass |
| P0-09 | Helmet headers on all routes; OAuth works |
| P0-10 | Confirmation re-exec failure is retryable, not silent success |

---

## P1 Acceptance Criteria — Quick Reference

| ID | One-Line Done Definition |
|----|--------------------------|
| P1-01 | Event type → permanent URL → guest books without voice |
| P1-02 | React booking SPA; Lighthouse A11y > 95; no alert() |
| P1-03 | Guest name/email/custom Qs stored on booking |
| P1-04 | Guest cancel/reschedule via email-verified link |
| P1-05 | Reminder emails at T-24h and T-1h in test env |
| P1-06 | Working hours UI writes to user_policies |
| P1-07 | Onboarding timezone + privacy persist to DB |
| P1-08 | Host notified when guest proposes alternative time |
| P1-09 | 60–80+ active test files; CI green |
| P1-10 | /health returns db + redis status; 503 if DB down |
| P1-11 | render.yaml staging deploy succeeds |
| P1-12 | Log shipping runbook + error rate alert |
| P1-13 | API key routes tested (401/200) |
| P1-14 | Slots displayed in guest + host timezone |
| P1-15 | Webhooks fire with HMAC on booking events |

---

## Escalation

If an agent needs to modify a file owned by another agent, comment on the blocking PR with `@Agent-N` and tag the item ID. Agent 7 resolves at next IC or within 4 hours for P0 blockers.
