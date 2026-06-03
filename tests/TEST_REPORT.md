# STT Voice Test Report (Iteration 2 - Final)

- **Timestamp:** 2026-05-31 20:16:05 +05:30
- **Command:** `npx vitest run tests/unit/speech-input.test.ts tests/unit/voice-ui-stt.test.ts`
- **Scope:** Frontend Web Speech/STT tests only
- **Result:** `10 passed / 0 failed` (10 total)

## Per-test Status

| Test | File | Status | Failure Reason |
|---|---|---|---|
| detects speech support when constructor is missing vs present | `tests/unit/speech-input.test.ts` | PASS | — |
| maps known and unknown speech errors to friendly messages | `tests/unit/speech-input.test.ts` | PASS | — |
| routes interim text to onInterim and final text to onFinal | `tests/unit/speech-input.test.ts` | PASS | — |
| toggles start then stop during listening lifecycle | `tests/unit/speech-input.test.ts` | PASS | — |
| resolves language from navigator.language and falls back to en-US | `tests/unit/speech-input.test.ts` | PASS | — |
| maps recognition onerror values to user-facing messages | `tests/unit/speech-input.test.ts` | PASS | — |
| keeps review-first behavior: onFinal fills input without auto-posting /voice | `tests/unit/voice-ui-stt.test.ts` | PASS | — |
| blocks form submit while listening | `tests/unit/voice-ui-stt.test.ts` | PASS | — |
| disables mic while busy after submit starts | `tests/unit/voice-ui-stt.test.ts` | PASS | — |
| hides mic on unsupported browsers and shows fallback message on click | `tests/unit/voice-ui-stt.test.ts` | PASS | — |

## Resolution Note

Iteration 1 failures were caused by variable dynamic import in the UI harness (`import('../../web/main.js?ui-spec=...')`).  
Fixed by using static import (`import('../../web/main.js')`) with `vi.resetModules()` for per-test re-evaluation.
