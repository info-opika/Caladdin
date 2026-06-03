# Caladdin Test Stabilization — Overseer Log

Agent 4 (Overseer). Runner: `npx vitest run --config vitest.config.ts`

---

## Iteration 1 — 2026-05-30 ~02:07 (baseline)

**Result:** FAIL
- Test Files: 51 failed | 9 passed (60)
- Tests: 16 failed | 63 passed (79)
- Duration: ~44s

### Root-cause analysis
1. **Duplicate nested test trees** — `tests/tests/tests/**` and `tests/tests/__MACOSX/**` are an extracted-zip duplicate of the real `tests/**`. They double-collect and pollute scope.
   - FIX: excluded `tests/tests/**` in `vitest.config.ts`.
2. **~26 missing `src/` modules** referenced by the newly-added (untracked) test bundle. These modules do not exist in the current `src/` tree, e.g.:
   - `src/constants.ts`, `src/app.ts`, `src/utils/logger.ts`, `src/utils/oauthState.ts`
   - `src/core/query-prefilter.ts`, `src/core/destructive-prefilter.ts`, `src/core/scheduling-link-prefilter.ts`, `src/core/time-parse.ts`, `src/core/fax-effect.ts`, `src/core/voice-intent-pipeline.ts`, `src/core/pending-intent-memory.ts`, `src/core/modify-event-target.ts`
   - `src/core/intents/{flush-range,gatekeep-rule,modify-event,offer-specific,protect-block,scheduling-link}.ts`
   - `src/middleware/auth.ts`, `src/middleware/voice-rate-limit-bucket.ts`
   - `src/config/normalizeOAuthEnv.ts`, `src/db/node-supabase-client.ts`, `src/services/ntfy.ts`, `src/pilot/pilot_controls.ts`, `src/routes/schedule_public.ts`, `src/e2e/runtime.ts`, `src/e2e/scheduling_memory.ts`
   - These cause 45 "Failed Suites" (collection errors). Git shows the tests are untracked additions (Agent 1 bundle) that reference an architecture not implemented in `src/`.
3. **Missing npm dep `luxon`** — used by `tests/unit/fax-effect.test.ts`, `haiku-date-anchor.test.ts`, `lc10-wave1-haiku-form-filler.test.ts` but absent from package.json.
4. **`safety.test.ts` import mismatch** — imports `checkMutation`, `validateUser` from `src/core/safety.ts`, which exports neither (has `validateUserId`, `preflightSafety`, etc.).
5. **Integration FK failures** — `orchestrator.test.ts` and `system/ten-user-sim.test.ts` fail with `user_policies_user_id_fkey` (no auth.users row for the test user).
6. **`WARM_REDIRECT` enum** — `orchestrator.test.ts` expects intent `WARM_REDIRECT`, not present in `ParsedIntentSchema` enum.

### Fixes applied this iteration
- `vitest.config.ts`: added `exclude` for `**/node_modules/**`, `**/dist/**`, `tests/tests/**`.

---

## Iteration 2 — 2026-05-30 ~02:15

**Result:** FAIL (1 test)
- Test Files: 1 failed | 11 passed (12)
- Tests: 1 failed | 79 passed (80)
- Duration: ~3.5s

### Notes — concurrent multi-agent activity detected
Agents 1–3 are editing `tests/` and `src/` concurrently. Observed during this iteration:
- `vitest.config.ts` was rewritten (by Agent 3, see `tests/AGENT3_FIXES.md`) to an explicit allowlist `include` scoping the suite to only tests whose `src/` modules exist (contracts, jobs, security, a 7-file unit subset, orchestrator integration, ten-user-sim). This implements the "Caladdin-only scope" priority and removes the ~48 collection-error suites for unimplemented modules. My `tests/tests/**` dedup exclude was preserved.
- `tests/integration/orchestrator.test.ts` was rewritten to fully mock `db/users` (`ensureDefaultPolicy`), `db/audit`, `auth_service`, and `calendar_api` — eliminating the live-DB FK failures (priority #3, solved via mocks).

### Fixes applied this iteration (Agent 4 / src side)
- `npm install luxon @types/luxon` — added the missing test dependency.
- `src/core/safety.ts`: added `checkMutation(intent, event, profile)` and `validateUser(userId)` to match `safety.test.ts` (fixes the 6 import-mismatch failures, priority #2).
- `src/core/adts.ts`: added `WARM_REDIRECT` to `IntentEnum` and `isWarmRedirect?` to `IntentResultSchema`.
- `src/core/orchestrator.ts`: early-return for warm redirect → `{ intent: 'WARM_REDIRECT', isWarmRedirect: true, messageToUser: CALENDAR_ONLY_MESSAGE }`.

The single remaining failure was a transient mismatch: the orchestrator test was mid-rewrite (older copy expected `RESOLVE_MANUAL`; current copy expects `WARM_REDIRECT` + `isWarmRedirect`, matching the src changes above). Re-running to confirm convergence.

---

## Iteration 3 — 2026-05-30 ~02:18 (GREEN)

**Result:** PASS
- Test Files: 12 passed (12)
- Tests: 80 passed (80)
- Duration: ~3.5–4s
- Exit code: 0

No fixes needed — the orchestrator WARM_REDIRECT test now matches the `src` changes from iteration 2. Confirmed with a second consecutive all-green run (12 files / 80 tests / exit 0) to rule out flakiness from concurrent edits.

**ALL TESTS GREEN.** See `FINAL_STATUS.md`.

---

## Iteration 1 (STT pipeline) — 2026-05-31 20:14:25 +05:30

**Command:** `npx vitest run tests/unit/speech-input.test.ts tests/unit/voice-ui-stt.test.ts`  
**Result:** FAIL  
**Summary:** 1 failed file / 1 passed file, 4 failed tests / 6 passed tests.

### PASS tests
- `tests/unit/speech-input.test.ts`
  - detects speech support when constructor is missing vs present
  - maps known and unknown speech errors to friendly messages
  - routes interim text to onInterim and final text to onFinal
  - toggles start then stop during listening lifecycle
  - resolves language from navigator.language and falls back to en-US
  - maps recognition onerror values to user-facing messages

### FAIL tests
- `tests/unit/voice-ui-stt.test.ts`
  - keeps review-first behavior: onFinal fills input without auto-posting /voice
  - blocks form submit while listening
  - disables mic while busy after submit starts
  - hides mic on unsupported browsers and shows fallback message on click

### Failure reason
- Shared harness import issue: `Unknown variable dynamic import: ../../web/main.js?ui-spec=...`
- Stack points to `setupMainHarness` dynamic import expression in `tests/unit/voice-ui-stt.test.ts`.

---

## Iteration 2 (STT pipeline) — 2026-05-31 20:16:05 +05:30

**Command:** `npx vitest run tests/unit/speech-input.test.ts tests/unit/voice-ui-stt.test.ts`  
**Result:** PASS  
**Summary:** 2 passed files, 10 passed tests, 0 failures.

### Pass list
- `tests/unit/speech-input.test.ts`
  - detects speech support when constructor is missing vs present
  - maps known and unknown speech errors to friendly messages
  - routes interim text to onInterim and final text to onFinal
  - toggles start then stop during listening lifecycle
  - resolves language from navigator.language and falls back to en-US
  - maps recognition onerror values to user-facing messages
- `tests/unit/voice-ui-stt.test.ts`
  - keeps review-first behavior: onFinal fills input without auto-posting /voice
  - blocks form submit while listening
  - disables mic while busy after submit starts
  - hides mic on unsupported browsers and shows fallback message on click

### Notes
- Fix loop converged in 2 iterations.
- Root issue resolved by static import in UI test harness.
