# Coverage Roadmap — CEO Handoff (P1-09)

**Owner:** Agent 5 · **Updated:** 2026-06-07

## Current state

| Metric | Baseline (pre-Agent 5) | CI gate (now) | CEO target |
|--------|------------------------|---------------|------------|
| Statements | ~51% | **70.34%** enforced | **80%** |
| Active test files | 43 | **78+** | 80+ |
| Handlers (`src/handlers/*`) | ~22% | **~70–100%** per handler | ≥60% |

Run locally:

```bash
npm run test:coverage
```

Coverage HTML: `coverage/index.html` · CI uploads `coverage-report` artifact.

## What Agent 5 added

- `tests/unit/handlers/*` — vitest unit tests for all handler entry points
- `tests/unit/db/*` — mocked Supabase tests for audit, confirmations, events, users, scheduling sessions, webhooks
- `tests/integration/ceo-handoff-smoke.test.ts` — full in-process booking journey
- `tests/integration/{availability-engine,webhooks-dispatch,team-booking}.test.ts`
- `vitest.config.ts` — `coverage.thresholds.statements: 70`
- `.github/workflows/lighthouse.yml` — static JS budget + documented manual Lighthouse path

## Path to 80%

1. **Week 2 (Agent 5)** — Raise gate to 75% after `calendar_api`, `conversation-context` db, and `schedule_public` edge cases land
2. **Week 3** — Add Playwright smoke (G2-E2E-Booking); wire Lighthouse HTML artifacts from staging
3. **Week 4** — Enable 80% gate; triage remaining legacy tests under `tests/tests/` for modules that still exist

### High-yield remaining gaps

| Module | Notes |
|--------|-------|
| `src/services/calendar_api.ts` | Partial; expand delete-by-title + compensation paths |
| `src/db/conversation-context.ts` | In-memory + Supabase branches |
| `src/core/parser.ts` | LLM paths mocked; add fixture utterances |
| `src/routes/voice.ts` | Extend red-team + voice-route-errors |
| `src/jobs/compensation-worker.ts` | Worker loop with mocked queue |

### CI secrets

- `SUPABASE_TEST_DATABASE_URL` — enables `tests/integration/db/rls.integration.test.ts` (skipped without secret)

## Lighthouse / perf

CI runs **static JS budget** only (see `lighthouse.yml`). Target **≥90 Lighthouse performance** requires manual or staging runs documented in `docs/production-readiness/lighthouse/` before CEO demo.
