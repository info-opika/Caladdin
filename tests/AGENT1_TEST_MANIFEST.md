# Agent 1 Test Manifest (recovery after subagent network failure)

## New MVP test files

| File | Coverage |
|------|----------|
| `tests/unit/pilot-controls.test.ts` | Kill switch, operation gates |
| `tests/unit/pilot-controls-capacity.test.ts` | Pilot cap edge cases |
| `tests/unit/waitlist-db.test.ts` | Waitlist DB |
| `tests/unit/email-confirmation.test.ts` | Email collect/detect |
| `tests/unit/email-confirmation-gate.test.ts` | Voice gate yes/no/spell |
| `tests/unit/slot-scoring-protected-blocks.test.ts` | Protected blocks in slots |
| `tests/unit/platform-invites-db.test.ts` | Platform invite tokens |
| `tests/unit/invite-platform-handler.test.ts` | INVITE_PLATFORM handler |
| `tests/unit/fax-effect.test.ts` | Fax scoring |
| `tests/unit/fax-effect-messages.test.ts` | Fax copy |
| `tests/unit/intents/offer-specific.test.ts` | selectTopSlots, offerSpecific |
| `tests/integration/waitlist-routes.test.ts` | POST/GET waitlist |
| `tests/integration/auth-oauth-mvp.test.ts` | OAuth import, pilot, attribution |
| `tests/integration/invite-routes.test.ts` | /invite/:token |
| `tests/integration/scheduling-public-routes.test.ts` | /s/:token public flow |

## vitest.config.ts

Broadened `include` to `tests/unit/**`, `tests/integration/**` (excludes duplicate `tests/tests/**` and db integration).

## Tracker

Failures and fixes: `tests/AGENT_TEST_TRACKER.csv`
