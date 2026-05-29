# Agent Guidelines

1. Read `PROCESS_RULES.md`, `PROGRESS.md`, then `caladdin_spec_docs/CALADDIN_FULL_APPLICATION_SPEC.md` before coding.
2. Zod schemas in `src/core/adts.ts` are the source of truth — update enums to **10 intents**, never 8.
3. Supabase write before Google Calendar; use `compensation_queue` on GCal failure.
4. Session auth for `/voice` and `/api/*`; API key only for `/confirm/*` and `/jobs/*`.
5. Never weaken validation to pass tests.
6. All tests must pass before merge (`npm test`).
7. Hardening work on branch `f1-f5-hardening`, not `main`.
