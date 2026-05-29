# Caladdin — Progress

**Last updated:** 2026-05-27  
**Branch:** greenfield main

## Completed

- [x] Phase 0: Monorepo scaffold (Express, TypeScript, Vitest, web/, migrations)
- [x] Phase 1: Zod ADTs, DB accessors, migrations 001–014
- [x] Phase 2: OAuth routes, session + API key middleware
- [x] Phase 3: Parser (pre-LLM, degraded LLM, tool-use path), orchestrator, safety, rate limiter
- [x] Phase 4: All 10 intent handlers + POST /voice with oauthClient
- [x] Phase 5: Confirmations, payload hash, ntfy, re-exec with P4 semantics
- [x] Phase 6: OFFER_SPECIFIC, shadow blocks, scheduling sessions, /s/:token
- [x] Phase 7: Web onboarding + chat UI (Vite)
- [x] Phase 8: Degradation paths, compensation worker, error sanitization, 10kb body limit
- [x] Phase 9: Unit, contract, security, improvement-loop tests
- [x] Phase 10: DEPLOY.md, SMOKE_TEST.md, README

## Before first real user

- [ ] Apply migrations via **`npm run db:link`** then **`npm run db:push`** (see `supabase/README.md`)
- [ ] Fill `.env` from `.env.example`
- [ ] Google OAuth redirect URI matches `CALADDIN_BASE_URL`
- [ ] Run smoke test protocol (`SMOKE_TEST.md`)
- [ ] ngrok or prod HTTPS for ntfy confirm callbacks

## Spec reference

Canonical: `caladdin_spec_docs/CALADDIN_FULL_APPLICATION_SPEC.md`  
Build plan: `caladdin_spec_docs/CALADDIN_BUILD_PLAN.md`
