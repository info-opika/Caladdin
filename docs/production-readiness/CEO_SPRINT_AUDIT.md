# Caladdin CEO Sprint Audit — Agent 1

**Date:** 2026-06-07  
**Auditor:** Agent 1 (Code Auditor & Requirements Architect)  
**Inputs:** [FINAL_READINESS_REPORT.md](./FINAL_READINESS_REPORT.md), [AUDIT_REPORT.md](./AUDIT_REPORT.md), [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md), live codebase scan  
**Verification:** `npm test` — **345 passed / 2 skipped** (46 files + 1 skipped file) · `npm run build` pass  
**Verdict:** **Not ready for CEO handoff.** Phase 1 (P0) complete. Phase 2 ~40% done. **Cal.com parity ~38%** on scored features. **4–6 engineering weeks** remain for 100% handoff + 85%+ parity.

---

## Executive Summary

| Metric | Current | Sprint Target |
|--------|---------|---------------|
| CEO handoff criteria | **2 Pass · 8 Partial · 4 Fail** | 14 Pass |
| Cal.com feature parity (weighted) | **~38%** | **≥85%** |
| P0 items | 10/10 done | Maintain |
| P1 items | 4 done · 9 partial · 2 not started | 15/15 done |
| G2 gates | 2/11 pass | 11/11 pass |
| Test files (CI allowlist) | 47 | 80+ |
| Statement coverage | ~49% (Agent 7 baseline) | ≥80% |

**Top sprint themes:** (1) staging validation + E2E proof, (2) close P1 gaps (webhooks, guest TZ, propose-notify, event-type booking E2E), (3) coverage + Lighthouse + monitoring activation, (4) ops docs completion.

---

## 1. Cal.com Feature Parity Matrix

Scoring rubric: **0%** = not started · **25%** = schema/stub · **50%** = partial UX/API · **75%** = works in tests · **100%** = production-proven Cal.com equivalent.

| Feature | Score | Evidence (files) | Gap to 85%+ |
|---------|-------|------------------|-------------|
| **Event types** | **62%** | `supabase/migrations/022_event_types.sql`; CRUD `src/routes/event_types.ts`; host UI `web/event-types.js`; public metadata `src/routes/book_public.ts` (`GET /book/:username/:slug`); 12+ route tests `tests/integration/event-types-routes.test.ts` | `book_public.ts` returns JSON metadata only — **no slot generation or select from permanent URL**. Guest still books via ephemeral `/s/:token` from voice. Need bridge: event type → session → book. |
| **Availability** | **42%** | Working hours in `UserPolicyProfile` (`src/core/adts.ts`); editor in `web/event-types.js` (`workingHoursStart/End`); slot engine `src/core/slot-scoring.ts` respects policy + protected blocks | Caladdin **fax effect**: `selectTopSlots(..., 2)` — only **2 curated slots**, not day/week grid. No blocked-days UI, buffer rules UI, or minimum notice. |
| **Team / round-robin** | **0%** | No migration, routes, or handlers. Grep: zero team-scheduling code in `src/` | Out of sprint scope unless P2; document as known gap for CEO. |
| **Embeds** | **0%** | No iframe widget, embed script, or `embed` routes | P2 unless CEO demo requires embed; Cal.com parity blocker at 85%. |
| **Webhooks** | **0%** | P1-15 not started. No `webhook_subscriptions` migration. G2-Webhooks Fail | Full P1-15: migration + HMAC dispatcher on `booking.confirmed` / `cancelled`. |
| **Reminders** | **58%** | `supabase/migrations/024_booking_reminders.sql`; job `src/jobs/reminders.ts` (T-24h, T-1h); enqueue on confirm `schedule_public.ts`; cron `render.yaml` + `POST /jobs/reminders`; tests `tests/jobs/reminders.test.ts` | **No live Resend sandbox proof.** No SMS. Reminder skip paths not E2E on staging. |
| **Timezone** | **32%** | Host TZ on sessions (`schedule_public.ts:44,153`); onboarding TZ `web/main.js` + `PATCH /api/profile`; host profile `tests/integration/profile-api.test.ts` | **P1-14 not done:** `web/booking.js` has **no timezone selector**; slots shown in host TZ only. No dual guest/host display. |
| **Reschedule / cancel** | **72%** | Signed tokens `src/core/guest-action-token.ts`; routes in `schedule_public.ts`; tests `tests/integration/guest-lifecycle.test.ts`; UI `web/booking.js` (manage links); reminder emails include links `reminders.ts:36-47` | Live GCal update + Resend E2E not signed off on staging (G2-GuestLifecycle Partial). |
| **Payments (optional)** | **0%** | Spec non-goal. No Stripe integration | N/A for parity target unless monetization requested. |

### Weighted parity score

| Bucket | Features | Avg score |
|--------|----------|-----------|
| Core scheduling (weight 70%) | Event types, availability, timezone, reschedule | **52%** |
| Integrations (weight 20%) | Webhooks, reminders | **29%** |
| Enterprise (weight 10%) | Team, embeds, payments | **0%** |
| **Overall** | All nine | **~38%** |

**Path to 85%:** Bring event types (→90%), availability (→70% with expanded slot window + calendar UI), timezone (→90%), webhooks (→80%), reminders (→85% live-proven), reschedule (→90% staging E2E). Defer team/embeds/payments or accept ~82% with explicit CEO note.

---

## 2. CEO Handoff — 14 Criteria

| # | Criterion | Status | File evidence | Remaining work |
|---|-----------|--------|---------------|----------------|
| 1 | **Critical bugs fixed** | **Partial** | P0 bugs B01–B05 fixed. Tests green. | **B08:** `POST /s/:token/propose` (`schedule_public.ts:680-701`) stores alternative via `appendProposedAlternative` but **does not call** `sendHostBookingNotification` (compare L532, L591, L676 on book/cancel/reschedule). **B07:** `shareAvailabilityOnInvite` in `src/core/adts.ts:61` — not enforced on `/s/:token/calendar`. **B06:** `posture` column (`007_scheduling_sessions.sql:9`) unused in `slot-scoring.ts`. |
| 2 | **80% test coverage** | **Fail** | `vitest.config.ts` allowlist = 47 files; Agent 7 baseline **49.31%** statements; CI uploads artifact (`.github/workflows/ci.yml:33-43`) but **no coverage gate** | Expand allowlist (P1-09); target 60% handlers gate then 80% overall. ~150 legacy tests outside CI. |
| 3 | **Responsive UI** | **Partial** | Breakpoints `web/tokens.css:51-58`, `web/styles.css:31-37`, `web/booking.css:480+`; booking uses `--content-max-wide` | Host chat still `--content-max: 480px`. No wide desktop polish. React migration (P1-02 plan) not started — vanilla SPA only. |
| 4 | **90% performance (Lighthouse)** | **Fail** | Small bundles (~14 KB legacy estimate). No Lighthouse artifacts in repo or CI. | Run Lighthouse on `/` and `/s/:token`; optimize; commit baseline JSON. Backend P99 tied to sync LLM (`src/core/parser.ts`). |
| 5 | **Security hardened** | **Partial** | RLS `019_rls_policies.sql`; HMAC sessions `020_sessions.sql`, `middleware/session.ts`; helmet `middleware/securityHeaders.ts`; Postgres rate limits `021_rate_limits.sql`; kill switch wired. Red team: 4 tests `tests/security/red-team.test.ts`. | RLS integration skipped without `SUPABASE_TEST_DATABASE_URL`. Service role still primary for user routes. Extend abuse tests. `npm audit` critical dev deps. |
| 6 | **Accessibility (a11y)** | **Partial** | Booking ARIA: `web/booking.js` (`role="alert"`, `aria-busy`, `aria-invalid`, `aria-expanded`). Host UI partial in `web/index.html`, `web/main.js` | No WCAG audit. No Lighthouse A11y score. No skip links / focus trap on confirm dialog. |
| 7 | **API documentation** | **Partial** | **Upgraded since Agent 7:** `docs/api/OPENAPI.yaml` (971 lines), `docs/api/README.md` with curl examples | Not linked from `README.md` or `DEPLOYMENT.md`. `/confirm/*` routes may be incomplete in OpenAPI. No published Swagger UI. |
| 8 | **Deployment documentation** | **Pass** | `docs/DEPLOYMENT.md` (migrations 019–024, env, cron, health); `render.yaml`; `Dockerfile` | Cross-link `docs/ops/ROLLBACK.md`. Staging sign-off record missing. |
| 9 | **Monitoring & alerting** | **Partial** | JSON logs `src/logger.ts`; runbooks `docs/ops/LOG_SHIPPING.md`, `docs/ops/MONITORING_SETUP.md` | Checklists **unchecked** — no evidence of live Render log drain or pager. P1-12 docs-only. |
| 10 | **Database migrations** | **Pass** | Migrations **019–024** present; apply order in `DEPLOYMENT.md`; tables: sessions, rate_limits, event_types, booking_responses, booking_reminders | Ops: apply + verify on staging/production Supabase before go-live. |
| 11 | **Edge cases covered** | **Partial** | `guest-lifecycle.test.ts`, `event-types-routes.test.ts`, kill switch, rate limits, health degradation | Missing: propose-notify test, webhooks, Playwright E2E, double-approve on public routes, extended red team. |
| 12 | **Production / staging tested** | **Fail** | `SMOKE_TEST.md` — **all items unchecked**. No staging URL or IC-7 sign-off in tracker. | Deploy Render staging; run smoke + G2 E2E booking demo; record in tracker. |
| 13 | **Rollback plan** | **Partial** | **Upgraded since Agent 7:** `docs/ops/ROLLBACK.md` (kill switch, Render rollback, migration policy) | Not referenced from `DEPLOYMENT.md` Related docs (L132-135). No executed rollback drill. |
| 14 | **Team documentation** | **Partial** | `README.md`, `caladdin_spec_docs/`, production-readiness pack (7 docs) | No `docs/TEAM.md`: onboarding, on-call, agent ownership, incident response, Phase 2 deviations (Postgres vs Redis). |

### Summary counts

| Status | Count |
|--------|-------|
| **Pass** | 2 |
| **Partial** | 8 |
| **Fail** | 4 |

---

## 3. Prioritized Sprint Backlog (P0 / P1 / P2)

### P0 — CEO handoff blockers (this sprint, ~2 weeks)

| ID | Item | Agent | Est. | Rationale |
|----|------|-------|------|-----------|
| P0-S01 | **Staging deploy + smoke sign-off** | 6 | 3–5d | Criterion #12 Fail; G2-Deploy; unblocks all live proof |
| P0-S02 | **Fix B08 propose-notify** | 4 | 0.5d | Host silent on guest alternative; breaks trust |
| P0-S03 | **Event type → full booking E2E** | 4 + 3 | 2–3d | Parity: permanent URL must book without voice |
| P0-S04 | **P1-14 guest timezone display** | 3 | 2d | Parity 32%→90%; G2-UI partial |
| P0-S05 | **P1-15 webhooks (MVP)** | 4 + 5 | 3d | Parity 0%→80%; G2-Webhooks |
| P0-S06 | **Coverage expansion + 60% handlers gate** | 5 | 1–2w | Criterion #2 Fail; G2-Tests |
| P0-S07 | **Lighthouse baseline + fixes** | 3 | 2–3d | Criteria #4, #6; G2-UI-Quality |
| P0-S08 | **Activate monitoring (log drain + alert)** | 6 | 2–3d | Criterion #9; execute `MONITORING_SETUP.md` |
| P0-S09 | **API docs + rollback cross-links** | 6 | 0.5d | Criteria #7, #13 Partial → Pass |
| P0-S10 | **Create `docs/TEAM.md`** | 6 + 7 | 1–2d | Criterion #14 |

### P1 — Parity + quality (sprint weeks 2–4)

| ID | Item | Agent | Est. |
|----|------|-------|------|
| P1-S01 | Reminders live proof (Resend sandbox) | 4 + 6 | 1d |
| P1-S02 | Dedicated availability settings page (P1-06 finish) | 3 | 2–3d |
| P1-S03 | Expand slot presentation (4–6 slots or mini calendar) | 2 + 3 | 3d |
| P1-S04 | `/confirm/*` API key test suite (P1-13 finish) | 5 | 1d |
| P1-S05 | Extended red team + public booking abuse | 5 | 2d |
| P1-S06 | Playwright E2E (OAuth mock → book) | 5 | 3d |
| P1-S07 | Enforce `shareAvailabilityOnInvite` (B07) | 4 | 1d |
| P1-S08 | RLS CI secret + full integration runs | 5 + 6 | 1d |
| P1-S09 | Link DEPLOYMENT ↔ ROLLBACK ↔ MONITORING | 6 | 0.5d |
| P1-S10 | CEO demo recording + IC-7/IC-8 sign-off | 7 | 1d |

### P2 — Post-handoff / 85%+ stretch

| ID | Item | Agent | Notes |
|----|------|-------|-------|
| P2-S01 | Embeddable booking widget | 3 | Required for 85%+ if team counted |
| P2-S02 | Team / round-robin | 4 | Enterprise; defer with CEO approval |
| P2-S03 | React migration (full P1-02 vision) | 3 | Optional if vanilla meets Lighthouse |
| P2-S04 | Async LLM voice pipeline | 2 | P99 latency |
| P2-S05 | GDPR export/delete | 6 | Enterprise compliance |
| P2-S06 | Stripe payments | 4 | Only if monetizing |

---

## 4. Agent Specs (Agents 2–6)

### Agent 2 — Architecture & Performance

**Sprint mission:** Support parity UX (more slots), keep health/infra green, optional perf baseline.

| Task | Files | Acceptance criteria |
|------|-------|---------------------|
| Health check maintenance | `src/index.ts`, `tests/integration/health.test.ts` | `/health` returns db + redis + version; 503 when DB down |
| Slot window expansion (support Agent 3) | `src/core/slot-scoring.ts`, `src/core/intents/offer-specific.ts` | Configurable top-N (default 2, booking page 6); P95 slot gen documented |
| GCal free/busy cache (optional) | `src/core/slot-scoring.ts`, `src/services/redis.ts` | 5-min TTL cache; <500ms P95 with warm cache |
| Event-type slot API (pair Agent 4) | `src/routes/book_public.ts` | `GET /book/:username/:slug/slots` returns scored slots JSON |
| Document Postgres rate-limit deviation | `docs/TEAM.md` or `MASTER_PLAN.md` | ADR: why Postgres not Redis |

**Do not:** Reintroduce `scheduling.ts`; break distributed rate limits.

---

### Agent 3 — Frontend & UX

**Sprint mission:** Guest timezone, booking polish, Lighthouse/a11y pass, availability settings.

| Task | Files | Acceptance criteria |
|------|-------|---------------------|
| **P1-14 Guest timezone** | `web/booking.js`, new `web/timezone.js` or extend `web/ui.js` | Browser TZ detected; selector changes slot labels; host TZ shown as secondary |
| Booking page Lighthouse | `web/booking.css`, `web/booking.js` | Performance ≥90, Accessibility ≥95; artifact committed under `docs/lighthouse/` |
| Availability settings page | `web/index.html`, new `web/settings.js` or extend `event-types.js` | Dedicated `/settings` or tab: working hours, buffers → `PATCH /api/profile` |
| Responsive desktop polish | `web/tokens.css`, `web/styles.css` | Chat usable at 1024px+; booking grid at 640px+ |
| Event-type public booking UI | `web/booking.js` + shell from `schedule_public.ts` | Guest completes book from `/book/:user/:slug` flow (once Agent 4 ships slots API) |
| a11y hardening | `web/booking.js`, `web/main.js` | Skip link; focus trap on guest intake modal; keyboard slot selection |

**Defer unless time:** Full React migration (`web/src/` scaffold per PHASE2_KICKOFF.md).

---

### Agent 4 — Backend

**Sprint mission:** Close P1 gaps — propose notify, event-type booking chain, webhooks, reminders proof.

| Task | Files | Acceptance criteria |
|------|-------|---------------------|
| **P1-08 Fix B08** | `src/routes/schedule_public.ts:680-701` | After `appendProposedAlternative`, call `sendHostBookingNotification(session.host_user_id, token)`; test in `scheduling-public-routes.test.ts` |
| **Event-type booking E2E** | `src/routes/book_public.ts`, `src/handlers/offer-specific.ts`, `src/db/scheduling_sessions.ts` | `POST /book/:username/:slug/select` creates session + GCal event; or creates `/s/:token` redirect |
| **P1-15 Webhooks MVP** | NEW `supabase/migrations/025_webhook_subscriptions.sql`, `src/db/webhooks.ts`, `src/services/webhook-dispatcher.ts` | CRUD `/api/webhooks`; HMAC-SHA256 sign; fire on confirm + cancel; retry 3x; test with mock HTTP server |
| **P1-05 Reminders proof** | `src/jobs/reminders.ts`, `tests/jobs/reminders.test.ts` | Document Resend sandbox send; staging cron log screenshot in tracker |
| **B07 shareAvailabilityOnInvite** | `src/routes/schedule_public.ts` (calendar view handler) | When policy false, `/s/:token/calendar` returns 403 or masked view |
| OpenAPI sync | `docs/api/OPENAPI.yaml` | All new routes documented |

---

### Agent 5 — Testing & QA

**Sprint mission:** 80% coverage path, CI gates, E2E, abuse tests.

| Task | Files | Acceptance criteria |
|------|-------|---------------------|
| **P1-09 Expand allowlist** | `vitest.config.ts` | 60+ files by week 2; 80+ target; triage legacy under `tests/integration/` not in `tests/tests/` |
| **Coverage gate** | `.github/workflows/ci.yml` | Fail if `src/handlers/` statements < 60%; artifact retained |
| **P1-13 Confirm routes** | NEW `tests/integration/api-key-routes.test.ts` | 401 without key; 200 with key on `/jobs/*`, `/confirm/*` |
| Propose-notify test | `tests/integration/scheduling-public-routes.test.ts` | Assert `sendHostBookingNotification` called on propose |
| Webhook tests | `tests/integration/webhooks.test.ts` | HMAC signature verification; delivery on booking |
| **Playwright E2E** | NEW `tests/e2e/booking.spec.ts` | Mock OAuth → create event type → guest books → assert confirmed (CI with `continue-on-error` until stable) |
| Extended red team | `tests/security/red-team.test.ts` | Rate limit bypass, double-approve, 100 rapid selects |
| Fix coverage run flakes | `tests/unit/voice-ui-stt.test.ts`, `web/event-types.js` | `npm run test:coverage` green locally + CI |

---

### Agent 6 — Security & DevOps

**Sprint mission:** Staging deploy, monitoring live, ops docs complete.

| Task | Files | Acceptance criteria |
|------|-------|---------------------|
| **IC-7 Staging deploy** | `render.yaml`, `docs/DEPLOYMENT.md` | Staging URL live; `/health` 200; migrations 019–024 applied; sign-off in PROGRESS_TRACKER |
| **P1-12 Monitoring activation** | Execute `docs/ops/MONITORING_SETUP.md` | Log drains on 3 services; 5xx alert configured; checklist checked |
| **Rollback linkage** | `docs/DEPLOYMENT.md` | Add Related: `ops/ROLLBACK.md`, `ops/MONITORING_SETUP.md` |
| **docs/TEAM.md** | NEW | Local dev, env secrets, agent roster, on-call, kill switch, rollback pointer |
| **SMOKE_TEST.md execution** | `SMOKE_TEST.md` | All boxes checked with staging URL + date |
| RLS CI secret | GitHub repo settings | `SUPABASE_TEST_DATABASE_URL` set; RLS tests not skipped in CI |
| `npm audit` | `package.json` | Resolve or document critical vitest dev-deps |

---

## 5. Top 15 Critical Items (Ranked)

| Rank | ID | Item | Owner | Impact | Effort |
|------|-----|------|-------|--------|--------|
| **1** | P0-S01 | Staging deploy + smoke sign-off | 6 | Unblocks CEO criterion #12; all live proof | 3–5d |
| **2** | P0-S06 | Test coverage 49%→60%+ with CI gate | 5 | CEO criterion #2; G2-Tests | 1–2w |
| **3** | P0-S03 | Event type URL → full guest booking | 4+3 | Parity 62%→90%; G2-E2E-Booking | 2–3d |
| **4** | P0-S02 | Fix B08 propose-notify | 4 | Critical bug; host blind to alternatives | 0.5d |
| **5** | P0-S05 | Webhooks MVP (P1-15) | 4+5 | Parity 0%→80%; G2-Webhooks | 3d |
| **6** | P0-S04 | Guest timezone (P1-14) | 3 | Parity 32%→90% | 2d |
| **7** | P0-S07 | Lighthouse P≥90, A11y≥95 | 3 | CEO criteria #4, #6 | 2–3d |
| **8** | P0-S08 | Live monitoring + alerts | 6 | CEO criterion #9 | 2–3d |
| **9** | P1-S01 | Reminders Resend sandbox proof | 4+6 | G2-Reminders; parity 58%→85% | 1d |
| **10** | P1-S06 | Playwright booking E2E | 5 | G2-E2E; staging confidence | 3d |
| **11** | P0-S09 | API docs + rollback cross-links | 6 | Criteria #7, #13 → Pass | 0.5d |
| **12** | P0-S10 | `docs/TEAM.md` engineer onboarding | 6 | Criterion #14 | 1–2d |
| **13** | P1-S05 | Extended red team / abuse tests | 5 | Criterion #5, #11; G2-Spec | 2d |
| **14** | P1-S02 | Availability settings page (P1-06) | 3 | Parity 42%→70% | 2–3d |
| **15** | P1-S03 | Expand slot UI (4–6 slots / mini calendar) | 2+3 | Parity 42%→70%; Cal.com UX gap | 3d |

---

## 6. Sprint Exit Criteria (Definition of Done)

### CEO handoff (100%)

- [ ] All 14 criteria **Pass** (or documented CEO-approved exceptions for team/embeds/payments)
- [ ] `SMOKE_TEST.md` fully checked with staging URL
- [ ] IC-7 and IC-8 signed in PROGRESS_TRACKER
- [ ] G2: 11/11 gates pass

### Cal.com parity (≥85%)

- [ ] Event types ≥90% (permanent URL books end-to-end)
- [ ] Availability ≥70% (expanded slots + settings UI)
- [ ] Timezone ≥90% (guest selector + dual display)
- [ ] Reschedule ≥90% (staging E2E with GCal)
- [ ] Reminders ≥85% (live Resend proof)
- [ ] Webhooks ≥80% (HMAC + 2 event types)
- [ ] Team / embeds / payments: documented deferral or implemented

---

## 7. Related Documents

- [FINAL_READINESS_REPORT.md](./FINAL_READINESS_REPORT.md) — Agent 7 scorecard
- [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) — Live P0/P1 + G1/G2
- [AGENT_ASSIGNMENTS.md](./AGENT_ASSIGNMENTS.md) — File-level task specs
- [PHASE2_KICKOFF.md](./PHASE2_KICKOFF.md) — Agents 3 & 4 contract freeze
- [docs/DEPLOYMENT.md](../DEPLOYMENT.md) · [docs/ops/ROLLBACK.md](../ops/ROLLBACK.md) · [docs/api/README.md](../api/README.md)

---

*Generated by Agent 1. Codebase scan 2026-06-07. No application code changed during this audit.*
