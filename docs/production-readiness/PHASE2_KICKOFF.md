# Phase 2 Kickoff — Agents 3 & 4 (Weeks 3–5)

**Orchestrator:** Agent 7  
**Date:** 2026-06-07  
**Prerequisite:** Phase 1 P0 complete (conditional gate — see [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) G1 checklist)  
**Binding decisions:** [MASTER_PLAN.md](./MASTER_PLAN.md) Section 2  
**Full specs:** [AGENT_ASSIGNMENTS.md](./AGENT_ASSIGNMENTS.md) Phase 2 sections

---

## Phase 1 Gate Status (Entry Criteria)

| Result | Detail |
|--------|--------|
| **Conditional pass** | 9/11 G1 gates green; 2 gaps remain |
| **Blockers for full exit** | G1-CleanRepo (`tests/tests/` deletion — Agent 5); G1-RLS CI coverage (Agent 5 + 6) |
| **Allowed now** | Agent 3 React scaffold (Week 3); Agent 4 finish P1-01 API (early scaffold exists) |
| **Not allowed until IC-5** | Agent 3 event-type UI, booking SPA consuming new APIs |

**Architectural note:** Rate limiting landed as Postgres `rate_limits` (migration `021_rate_limits.sql`), not Redis. P1-10 health check should probe Postgres rate-limit table availability, not Redis.

**Early work detected:** Agent 4 has partial P1-01 (`022_event_types.sql`, `src/db/event_types.ts`, `src/routes/event_types.ts`, `src/routes/book_public.ts`, `event-types-routes.test.ts`). Week 3 focus is **completion + IC-5 API freeze**, not greenfield.

---

## Integration Checkpoints (Agents 3 & 4)

| Checkpoint | When | Owner | Deliverable |
|------------|------|-------|-------------|
| **IC-5 Event Type API** | Week 3 Wed | Agent 4 → 3 | Frozen JSON shapes for CRUD + `GET /book/:username/:slug` |
| **IC-6 Booking SPA CSP** | Week 4 Wed | Agent 3 + 6 | CSP updated for Vite bundle; drop `'unsafe-inline'` on `/s/*` where possible |
| **Week 4 Fri sync** | Week 4 Fri | 3 + 4 | Booking SPA calls live intake + profile APIs |
| **Week 5 Tue** | Week 5 Tue | 3 + 4 + 6 | Guest lifecycle E2E on staging (prep for IC-7) |

---

## Agent 4 — Backend (Weeks 3–5)

### Week 3 — P1-01 Event Types API (finish + freeze)

**Goal:** Permanent public booking URLs; guest can book without voice.

**Status:** Scaffold exists — complete CRUD, RLS integration, public entry route, tests.

| Priority | Task | Files | Done when |
|----------|------|-------|-----------|
| P0 | Verify `022_event_types.sql` RLS policies match `019` pattern | `supabase/migrations/022_event_types.sql` | `setUserContext` scopes all CRUD |
| P0 | Complete `book_public.ts` — slot generation from event type rules | `src/routes/book_public.ts`, `src/handlers/offer-specific.ts` | `GET /book/:username/:slug` returns slots JSON |
| P0 | Wire public booking select to event-type flow (or bridge to existing `/s/:token`) | `src/routes/book_public.ts`, `src/routes/schedule_public.ts` | Guest selects slot → GCal event created |
| P1 | Username resolution for URLs | `src/db/users.ts` (`ensureUsername`) | Stable `/book/{username}/{slug}` |
| P1 | OpenAPI-style shape doc for Agent 3 | PR description or `docs/api/event-types.md` | IC-5 review complete |
| P2 | Host propose-notify **stub only** (prep P1-08) | `src/routes/schedule_public.ts` | No-op handler + TODO; no email yet |

**Acceptance (P1-01 API):**
- [ ] Authenticated CRUD: `GET/POST/PATCH/DELETE /api/event-types`
- [ ] Create event type → `publicUrl` in response
- [ ] Guest hits public URL → sees slots → books
- [ ] RLS: User A cannot read User B event types
- [ ] `event-types-routes.test.ts` green in CI

**Do not start:** P1-03 guest responses table, P1-04 cancel/reschedule, P1-05 reminders (Week 4–5).

---

### Week 4 — P1-03 API, P1-07 API, P1-08

**Goal:** Backend support for guest intake, onboarding persistence, host propose notifications.

| Item | Task | Files | Done when |
|------|------|-------|-----------|
| **P1-07 API** | `PATCH /api/profile` — timezone, privacy, working hours | `src/routes/api.ts`, `src/db/users.ts` | Fields persist to `user_policies` |
| **P1-03 API** | Guest responses on booking | `supabase/migrations/023_booking_responses.sql`, `src/db/booking_responses.ts` | Name, email, custom answers stored with session |
| **P1-03 API** | Extend select handler to accept guest payload | `src/routes/schedule_public.ts` or `book_public.ts` | Validation + storage before GCal write |
| **P1-08** | Host notify on guest propose alternative | `src/routes/schedule_public.ts`, `src/services/email.ts` | Resend email to host with proposed slot |

**Acceptance:**
- [ ] `PATCH /api/profile` returns updated policy; RLS-scoped
- [ ] Booking select with `{ name, email, answers }` persists to `booking_responses`
- [ ] Propose alternative triggers host email (test with Resend sandbox mock)

**Dependency:** Agent 3 needs P1-07 API by **Week 4 Wed** for onboarding UI; P1-03 API by **Week 4 Fri** for intake form.

---

### Week 5 — P1-04, P1-05, P1-08 (harden)

**Goal:** Guest self-service lifecycle + reminder cron.

| Item | Task | Files | Done when |
|------|------|-------|-----------|
| **P1-04** | Guest cancel via signed email link | `src/routes/schedule_public.ts`, token utils | Cancel updates session + deletes GCal event |
| **P1-04** | Guest reschedule via signed link | same | New slot selected; GCal event updated |
| **P1-05** | Reminder job T-24h and T-1h | `supabase/migrations/024_booking_reminders.sql`, `src/jobs/reminders.ts` | Emails queued/sent for confirmed bookings |
| **P1-05** | Cron entry prep for Agent 6 | `src/routes/jobs.ts` | `POST /jobs/reminders` idempotent, API-key gated |
| **P1-08** | Harden propose notify (retries, logging) | `src/services/email.ts` | Failure logged; does not block guest action |

**Acceptance:**
- [ ] Cancel link in email → booking cancelled; host notified
- [ ] Reschedule link → slot updated in DB + GCal
- [ ] Reminder job sends test emails in sandbox for booking 24h/1h out
- [ ] All mutations respect kill switch + rate limits

**Dependency:** P1-05 cron wiring in `render.yaml` is Agent 6 (P1-11); Agent 4 ships job + HTTP trigger only.

---

## Agent 3 — Frontend & UX (Weeks 3–5)

### Week 3 — React Scaffold (no booking flow)

**Goal:** Vite + React foundation in `web/`; design tokens; shadcn init. **Zero backend contract changes.**

| Priority | Task | Files | Done when |
|----------|------|-------|-----------|
| P0 | Migrate build to `web/src/` React entry | `web/src/main.tsx`, `web/src/App.tsx`, `web/vite.config.ts` | `npm run build:web` produces React bundle |
| P0 | Preserve voice/STT — do not break `speech-input` | `web/speech-input.ts` or port to `web/src/lib/speech-input.ts` | Existing voice tests still pass |
| P0 | Design tokens (colors, spacing, typography) | `web/src/styles/tokens.css`, Tailwind config | Matches current brand; dark/light if applicable |
| P1 | shadcn/ui init + Button, Toast, Input, Card | `web/src/components/ui/*` | Toast replaces future `alert()` usage |
| P1 | Router scaffold (no feature pages yet) | `web/src/router.tsx` | Routes stubbed: `/`, `/dashboard/*`, `/s/:token` |
| P2 | Component inventory doc (PR comment) | — | Maps `main.js` functions → React components |

**Acceptance:**
- [ ] `npm run build:web` succeeds
- [ ] `npm test` still green (voice/STT tests unaffected)
- [ ] No `alert()` in new React code
- [ ] **Do not merge booking flow** until IC-5 (Week 3 Wed)

**Allowed in parallel with Agent 4** — no API dependency this week.

---

### Week 4 — P1-02 Booking SPA + P1-14 Timezone

**Goal:** Replace server-rendered `/s/:token` HTML with React SPA; timezone-aware slot display.

**Depends on:** IC-5 event-type API shapes (even if booking still uses session tokens initially).

| Priority | Task | Files | Done when |
|----------|------|-------|-----------|
| P0 | `BookingFlow.tsx` — slot list, loading, error states | `web/src/pages/BookingFlow.tsx` | Fetches slots from JSON API |
| P0 | `SlotCard.tsx` — select, disabled, selected states | `web/src/components/SlotCard.tsx` | Keyboard accessible |
| P0 | `TimezoneSelector.tsx` + slot display utils | `web/src/components/TimezoneSelector.tsx`, `web/src/lib/timezone.ts` | Browser TZ detected; slots in guest + host TZ (P1-14) |
| P0 | Toast errors (no `alert()`) | `web/src/components/ui/toast` | All booking errors use toast |
| P1 | Server serves SPA shell for `/s/:token` | Coordinate with Agent 4 on `schedule_public.ts` | HTML shell loads React bundle |
| P1 | Lighthouse pass | — | Performance > 90, Accessibility > 95 on booking page |
| P2 | Loading skeletons | `web/src/components/SlotSkeleton.tsx` | Perceived perf on slow networks |

**Acceptance (P1-02 + P1-14):**
- [ ] Guest completes booking in React UI
- [ ] Zero `alert()` in booking flow
- [ ] Timezone selector changes displayed slot times
- [ ] Lighthouse targets met
- [ ] IC-6 CSP update coordinated with Agent 6 before merge

**Dependency timeline:**
- **Wed Week 4:** Need JSON slot API stable (Agent 4)
- **Fri Week 4:** Need guest intake API shape for form wiring (prep Week 5 UI)

---

### Week 5 — P1-03 UI, P1-06 Availability, P1-07 UI

**Goal:** Guest intake form on booking flow; settings/onboarding screens.

| Item | Task | Files | Done when |
|------|------|-------|-----------|
| **P1-03 UI** | Guest intake form on booking confirm step | `web/src/pages/BookingFlow.tsx`, `GuestIntakeForm.tsx` | Name, email, custom Qs submitted with select |
| **P1-07 UI** | Onboarding wizard | `web/src/pages/Onboarding.tsx` | Timezone + privacy saved via `PATCH /api/profile` |
| **P1-06** | Availability admin in settings | `web/src/pages/Settings.tsx` | Working hours + buffers edit; persists to `user_policies` |
| **P1-06** | Wire settings to slot preview (optional) | `web/src/components/AvailabilityEditor.tsx` | Changes reflect in host's slot generation |

**Acceptance:**
- [ ] Guest cannot book without required intake fields
- [ ] Onboarding saves timezone; subsequent bookings use it
- [ ] Working hours change affects generated slots (verify with Agent 4)
- [ ] All forms use toast validation errors

**Dependency:** P1-07 API (Week 4), P1-03 API (Week 4), P1-01 API (Week 3) for event-type-aware settings.

---

## Cross-Agent Contract Freeze (IC-5)

Agent 4 publishes these shapes **before Agent 3 builds CRUD UI (Week 6)** or booking URL flows:

### Event Type (authenticated)

```json
{
  "id": "uuid",
  "name": "30-min Intro Call",
  "slug": "intro-call",
  "durationMinutes": 30,
  "description": "optional",
  "availabilityRules": {},
  "active": true,
  "publicUrl": "https://caladdin.example/book/jane/intro-call",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

### Public booking entry

```
GET /book/:username/:slug        → { eventType, slots[], hostTimezone }
POST /book/:username/:slug/select → { slotIndex, guest: { name, email, answers? } }
```

### Profile patch (P1-07)

```
PATCH /api/profile
{ "timezone": "America/Chicago", "privacy": "...", "workingHoursStart": "09:00", "workingHoursEnd": "17:00" }
```

Agent 3 must not invent fields outside this contract. Changes require Agent 7 approval.

---

## Week-by-Week Summary

| Week | Agent 4 | Agent 3 | Sync |
|------|---------|---------|------|
| **3** | Finish P1-01 API; IC-5 freeze | React scaffold + tokens + shadcn | Wed: IC-5 API review |
| **4** | P1-07, P1-03, P1-08 APIs | P1-02 SPA + P1-14 timezone | Wed: IC-6 CSP; Fri: intake API wired |
| **5** | P1-04, P1-05, P1-08 harden | P1-03, P1-06, P1-07 UI | Tue: guest lifecycle demo with Agent 6 |

---

## Out of Scope (Weeks 3–5)

Handled by other agents — do not touch without Agent 7 redirect:

| Item | Agent | When |
|------|-------|------|
| P1-01 Event Type **admin UI** | 3 | Week 6 |
| P1-09 Legacy test triage | 5 | Weeks 3–5 |
| P1-10 Health check depth | 2 | Week 3 |
| P1-11 render.yaml / Dockerfile | 6 | Weeks 3–4 |
| P1-13 API key route tests | 5 | Week 4 |
| P1-15 Webhooks | 4 | Week 6 |

---

## Risk Watchlist (Agents 3 & 4)

| Risk | Mitigation |
|------|------------|
| React migration breaks voice/STT | Run `speech-input.test.ts` + voice integration tests before every PR |
| CSP blocks Vite HMR or bundle | IC-6 with Agent 6 before booking SPA merge |
| Duplicate `tests/tests/` causes Agent 3 confusion | Use `web/src/` only; ignore duplicate tree |
| Event type migration number drift | `022_event_types.sql` already claimed; next is `023_booking_responses.sql` |
| Booking SPA + server HTML coexist | Feature flag or route-level shell swap; delete inline HTML only after parity test |

---

## PR Naming (Phase 2)

```
[Agent-3][P1-02] Booking SPA slot selection
[Agent-4][P1-01] Event types CRUD + public book route
```

---

## Related Documents

- [MASTER_PLAN.md](./MASTER_PLAN.md) — Full timeline Weeks 3–6
- [AGENT_ASSIGNMENTS.md](./AGENT_ASSIGNMENTS.md) — Acceptance criteria detail
- [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) — Live status + G1/G2 gates
