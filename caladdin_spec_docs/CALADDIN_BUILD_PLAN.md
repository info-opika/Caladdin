# Caladdin — Build Plan (Greenfield)

**Canonical spec:** [CALADDIN_FULL_APPLICATION_SPEC.md](./CALADDIN_FULL_APPLICATION_SPEC.md)

## Phase checklist

- [x] **Phase 0** — Scaffold (`package.json`, `src/`, `web/`, migrations, `.env.example`)
- [x] **Phase 1** — Data layer (Zod ADTs, `src/db/*`, migrations 001–014)
- [x] **Phase 2** — Auth (OAuth, session, API key middleware)
- [x] **Phase 3** — Parser + orchestrator + safety
- [x] **Phase 4** — 10 intent handlers + `/voice`
- [x] **Phase 5** — Confirmations + ntfy + re-exec
- [x] **Phase 6** — OFFER_SPECIFIC + Fax Effect `/s/:token`
- [x] **Phase 7** — Web UI (onboarding, chat)
- [x] **Phase 8** — Ops (compensation worker, degradation, sanitization)
- [x] **Phase 9** — Tests (unit, contract, security, jobs)
- [ ] **Phase 10** — Deploy + 10-user launch (requires live Supabase/OAuth)

## Pre-launch (human)

- [ ] Apply migrations to Supabase
- [ ] Configure `.env`
- [ ] Run `SMOKE_TEST.md`
- [ ] Founder 12-utterance manual pass
- [ ] Invite 10 users

See full phased detail in Cursor plan file `caladdin_build_plan_c4704a7c.plan.md`.
