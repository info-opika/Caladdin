# Caladdin Test Run Log

---

## Run: 2026-05-30T02:08:34

**Agent:** Agent 2 (Test Reporter)  
**Status:** ❌ FAILURE  
**Test Files:** 51 failed | 9 passed (60 total)  
**Tests:** 16 failed | 63 passed (79 total)  
**Duration:** 29.56s  

### Top Failure Categories
1. **Missing source module** (ERR_MODULE_NOT_FOUND) — 45 test files blocked; most impactful missing files: `src/constants.ts`, `src/core/voice-intent-pipeline.ts`, `src/core/scheduling-link-prefilter.ts`, `src/db/node-supabase-client.ts`, `src/core/intents/*.ts`
2. **FK/DB constraint violation** (`user_policies_user_id_fkey`) — 8 individual tests; test user UUIDs not seeded in `users` table
3. **Missing export** (`checkMutation`/`validateUser` not a function) — 7 tests in `safety.test.ts`
4. **Missing npm package** (`luxon`) — 3 test files blocked
5. **Schema/enum mismatch** (`WARM_REDIRECT` not in `ParsedIntentSchema`) — 1 test

### Passing Suites
`param-extract`, `intent-result-shape`, `adts`, `gcal-time`, `conversation-context`, `parser`, `notifications`, `improvement-loop`, `red-team`

### Full Report
See [TEST_REPORT.md](./TEST_REPORT.md)

---
