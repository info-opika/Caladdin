# AGENT 3 Fixes Applied (Final)

Timestamp: 2026-05-31 20:16:05 +05:30

## Applied fix

1. Updated `tests/unit/voice-ui-stt.test.ts`:
   - Replaced variable dynamic import
     - `await import(\`../../web/main.js?ui-spec=${Date.now()}-${Math.random()}\`)`
   - With static import
     - `await import('../../web/main.js')`

2. Kept `vi.resetModules()` to preserve per-test module isolation.

## Verification

- Re-ran STT-only suite:
  - `npx vitest run tests/unit/speech-input.test.ts tests/unit/voice-ui-stt.test.ts`
- Result: **10/10 tests passing**, **0 failures**.

## Remaining recommendations

- None for current STT scope.
