# Caladdin — F1-F5 Hardening Prompt
# For: Cursor Cloud Agent / Sonnet 4.6 High
# Standard: Top 1% production engineering
# Branch: f1-f5-hardening (NEVER push to main directly)

---

## AGENT PRIME DIRECTIVE

You are a principal engineer, not a code monkey.
Your job is to make Caladdin production-worthy, not just test-passing.

Before writing a single line of code:
1. Read PROGRESS.md
2. Read all 5 skill files in .claude/skills/
3. Run `npm test` and record the EXACT current test count and pass rate
4. Produce a REPO_STATE.md snapshot (see Phase 0)

If the repo materially differs from what this prompt assumes,
write ADAPTATION_NOTES.md and stop. Do not guess. Do not invent.

---

## INVIOLABLE RULES

- NEVER push to main. Work on branch `f1-f5-hardening` only.
- NEVER invent a file, function, schema, or route that does not exist.
  If something is missing, document it in ADAPTATION_NOTES.md.
- NEVER weaken an existing validation to make a test pass.
- NEVER silence an error without logging it first.
- NEVER write a test that only passes in ideal conditions.
  Every test must handle the unhappy path explicitly.
- If npm test breaks at any point, STOP and fix before continuing.
  Do not accumulate broken tests.
- All pre-existing tests must remain green after every commit.
  New tests must all pass before the PR is opened.

---

## PHASE 0 — DISCOVERY (NON-NEGOTIABLE FIRST STEP)

Before any implementation, produce REPO_STATE.md containing:

```markdown
# Repo State — [timestamp]

## Test baseline
- Total tests: [N]
- Passing: [N]
- Failing: [N]
- Coverage: [N%]

## Actual file inventory
[list every file in src/ with its exported functions/classes]

## Actual route inventory
[list every Express route with method, path, auth requirement]

## Actual schema inventory
[list every Zod schema with its exported name]

## Actual DB tables
[list every table from migration files with column names and types]

## Dependency health
- Supabase client: [lazy/eager, where initialized]
- Anthropic client: [lazy/eager, where initialized]
- Google OAuth client: [lazy/eager, where initialized]
- ntfy: [fire-and-forget / awaited]

## Gaps found
[list anything this prompt assumes that does not exist in the repo]
```

Only proceed after REPO_STATE.md is complete.
Branch: `git checkout -b f1-f5-hardening`

---

## PHASE 1 — FOUNDATIONAL FIXES (prerequisite for F1-F5)

These are not optional. They fix architectural problems that will
cause every F1-F5 addition to fail or behave incorrectly.

### P1: Add requestId tracing to every request

Every voice request must generate a UUID requestId at entry.
Pass it through parser → orchestrator → handler → DB writes → ntfy calls.
Include it in every logger call as a structured field.
Return it in every HTTP response as `x-request-id` header.
This is how you debug production issues with real users.

Implementation:
- Add requestId generation in voice.ts at request entry
- Pass as part of OrchestratorContext
- Include in all logger.info/warn/error calls downstream
- Include in audit_log entries
- Return as response header

### P2: Define and implement graceful degradation for every external dependency

For each dependency, define explicit behavior when it is unavailable:

Anthropic API down:
  - Parser catches the error
  - Routes to RESOLVE_MANUAL with failureReason='LLM unavailable'
  - Logs to failure_logs
  - Returns messageToUser='I am temporarily unable to process requests. Please try again shortly.'
  - MUST NOT return a 500 to the caller — return 503 with retry-after header

Supabase down:
  - Any DB call catches the error
  - Returns 503 to caller with retry-after: 30
  - MUST NOT expose DB error details in response

Google Calendar API down:
  - gcal functions already return null on failure (this is correct)
  - Add explicit log entry when gcal call fails silently
  - Return success=true to user (the Supabase write succeeded)
  - Add messageToUser note: 'Saved to Caladdin. Google Calendar sync will retry.'

ntfy down:
  - All ntfy calls are already in try/catch (this is correct)
  - Verify: a failed ntfy call MUST NOT fail the parent operation

### P3: Define idempotency for all mutations

Every mutation must be safe to execute twice without side effects.

PROTECT_BLOCK:
  - Before inserting block, check if identical block already exists in profile.protectedBlocks
  - Identical = same label + same daysOfWeek + same startTime + same endTime
  - If exists: return success=true with messageToUser='That block is already protected.'
  - Do NOT create duplicate GCal event

FLUSH_RANGE:
  - Before cancelling event, check current status
  - If already 'cancelled': skip, do not re-cancel, do not double-log audit entry

MODIFY_EVENT:
  - Before updating, compare new values to existing values
  - If no change: return success=true with messageToUser='No changes detected.'

GATEKEEP_RULE / SHAPE_RULES:
  - Upsert semantics already correct — idempotent by nature

### P4: Fix confirmation re-execution failure path

Current spec gap: what happens if the action re-executes on approval but FAILS?

Define this state machine addition:
  APPROVED → RE_EXECUTION_FAILED (new implicit state)
  
  On approval:
    1. Set status='approved' (do this FIRST before re-execution)
    2. Attempt re-execution via orchestrate()
    3. IF re-execution succeeds:
       - Write audit_log outcome='success'
       - Send ntfy 'Action completed successfully'
    4. IF re-execution fails:
       - Write audit_log outcome='failed'
       - Send ntfy 'Action approved but failed to execute: {reason}'
       - Return 200 to caller with { status: 'approved', executionStatus: 'failed', reason: string }
       - MUST NOT return 500 — the approval itself succeeded

### P5: Add schema version field to UserPolicyProfile

Add schemaVersion: z.number().int().default(1) to UserPolicyProfileSchema.

When loading a policy from Supabase:
  - IF schemaVersion is missing OR schemaVersion < current: 
    run migration function migratePolicy(raw) before Zod parse
  - migratePolicy adds missing fields with defaults
  - Save migrated policy back to Supabase
  - This prevents Zod from throwing on existing users when schema changes

Current schemaVersion: 1
Document in DECISIONS.md: 'Policy schema versioning added at schemaVersion=1'

---

## F1 — DECISION LOG (DEV UTILITY, NOT RUNTIME CODE)

Create scripts/log-decision.ts — a standalone CLI script, NOT imported by app code.

```typescript
// Usage: npx tsx scripts/log-decision.ts \
//   --category architecture \
//   --decision "Parser calls LLM before confidence routing" \
//   --reason "More accurate than regex for natural language" \
//   --alternatives "Pure regex (rejected: brittle), Rule tree (rejected: no NL handling)"

// Appends to DECISIONS.md — never called at runtime
// Never imported by src/ files
```

Create DECISIONS.md with these pre-populated entries:

1. Architecture: "Zod as single source of truth for TypeScript types"
   Reason: "Prevents type drift between compile-time and runtime validation"
   Alternatives: "Separate interfaces (rejected: silent drift), io-ts (rejected: complexity)"

2. Data model: "Tier stored in Supabase, not Google Calendar"
   Reason: "GCal has no native tier field. Description-based storage is fragile and visible to attendees"
   Alternatives: "GCal description (rejected: attendees can see), GCal extended properties (rejected: extra scope)"

3. Security: "Single CALADDIN_API_KEY for server auth, Google OAuth for user identity"
   Reason: "Prototype with 10 trusted users. Per-user tokens deferred to v2"
   Alternatives: "Per-user JWT (deferred to v2), Session cookies (deferred to v2)"

4. Architecture: "Dual token storage: Supabase primary, disk cache"
   Reason: "googleapis uses disk-based refresh natively. Supabase survives restarts"
   Alternatives: "Supabase only (rejected: requires rewriting googleapis auth)"

5. Tradeoff: "Confirmation re-execution reads payload from pending_confirmations"
   Reason: "Stateless re-execution — server restart between approval and execution is safe"
   Alternatives: "In-memory queue (rejected: lost on restart)"

6. Architecture: "requestId generated at voice route entry, propagated through all layers"
   Reason: "Enables full request tracing in production without distributed tracing infrastructure"
   Alternatives: "Correlation headers from client (rejected: client is curl/iPhone, no control)"

Commit: `feat: F1 decision log`

---

## F2 — CONTRACT TESTS

Create tests/contracts/ with 3 files.
Before writing tests, inspect actual exports from:
  src/core/parser.ts, src/core/orchestrator.ts, src/core/adts.ts,
  src/db/audit.ts, src/db/failures.ts, src/db/confirmations.ts

Bind tests to ACTUAL exported names. If exports differ from below, adapt.

### tests/contracts/parser-to-orchestrator.contract.test.ts

Test the exact shape contract between parser output and orchestrator input.

For each of the 8 intents, generate a synthetic ParsedIntent
and verify orchestrate() accepts it without throwing.

Additional contract tests:
- ParsedIntent.intent must be one of the 8 enum values (Zod enforces this)
- ParsedIntent.confidence must be 0-1
- ParsedIntent.rawUtterance must be non-empty, max 1000 chars
- ParsedIntent.mappingMethod must be 'direct' | 'fuzzy' | 'resolve_manual'
- ParsedIntent with _destructivePreFilter=true must result in
  requiresConfirmation=true in IntentResult (verify via orchestrator call)

Mock: LLM client, Supabase client, ntfy
Do NOT mock: Zod schemas, routing logic, safety checks

### tests/contracts/orchestrator-to-db.contract.test.ts

Test that DB write functions accept every valid IntentResult shape.

For each outcome type ('success', 'blocked', 'pending_confirmation', 'failed'):
  - Generate a synthetic IntentResult with that outcome
  - Call insertAuditLog() with the mapped fields
  - Verify: no throw, correct column mapping
  
Additional tests:
  - insertFailureLog() accepts null confidence (parser failed before LLM)
  - insertFailureLog() accepts null attemptedIntent (classification failed entirely)
  - insertPendingConfirmation() returns a valid UUID string
  - getPendingConfirmation() returns null for unknown token (not a throw)

Mock: Supabase client (capture exact insert arguments)
Assert: exact column names in insert call match actual DB schema

### tests/contracts/intent-result-shape.contract.test.ts

For each of the 8 intent handlers, call with minimal valid inputs.
Verify return value passes IntentResultSchema.parse() without throwing.
Verify intent field in result matches handler's intent name exactly.
Verify requiresConfirmation is always a boolean (never undefined).
Verify success is always a boolean (never undefined).

Also test the negative path for each handler:
  - Call with null/undefined event where applicable
  - Verify: returns IntentResult with success=false, NOT a throw

Mock: all external dependencies (Supabase, GCal, ntfy)

Commit: `test: F2 contract tests`

---

## F3 — SIMULATION BEFORE REAL USERS

Create tests/fixtures/synthetic-events.ts — 13 events:

```typescript
// Exact shapes — no approximations
export const SYNTHETIC_EVENTS = {
  tier0_family: CalendarEventSchema.parse({
    id: '00000000-0000-0000-0000-000000000010',
    title: 'Family Dinner',
    start: '2026-04-21T18:00:00-05:00',
    end: '2026-04-21T20:00:00-05:00',
    participants: [],
    tier: 0,
    isRecurring: false,
    status: 'confirmed',
  }),
  tier0_meditation: CalendarEventSchema.parse({...}),  // Tuesday 07:00-07:30
  tier1_investor: CalendarEventSchema.parse({...}),    // Monday 10:00-11:00
  tier1_board: CalendarEventSchema.parse({...}),       // Wednesday 14:00-15:00
  tier1_client: CalendarEventSchema.parse({...}),      // Thursday 09:00-10:00
  tier2_standup: CalendarEventSchema.parse({...}),     // Daily 09:30-09:45
  tier2_design: CalendarEventSchema.parse({...}),      // Tuesday 14:00-15:00
  tier2_review: CalendarEventSchema.parse({...}),      // Friday 15:00-16:00
  tier2_sync: CalendarEventSchema.parse({...}),        // Wednesday 11:00-11:30
  tier2_1on1: CalendarEventSchema.parse({...}),        // Thursday 14:00-14:30
  tier3_hold1: CalendarEventSchema.parse({...}),       // tentative
  tier3_hold2: CalendarEventSchema.parse({...}),       // tentative
  tier3_hold3: CalendarEventSchema.parse({...}),       // tentative
}
```

Create tests/fixtures/synthetic-profile.ts — exact UserPolicyProfile.

Create tests/simulation/pre-launch-sim.test.ts with these 8 cases.
Each case must assert EXACTLY what is expected — no vague "success" checks:

Case 1: "Block every Tuesday morning for deep work"
  Assert: intent='PROTECT_BLOCK', success=true, requiresConfirmation=false
  Assert: upsertUserPolicy was called with updated protectedBlocks containing new block
  Assert: no GCal write called (no oauthClient in simulation)
  Assert: audit_log insert called with outcome='success'

Case 2: "Clear my calendar Friday"
  Assert: intent='FLUSH_RANGE', requiresConfirmation=true
  Assert: NO updateEventStatus called (blocked before mutation)
  Assert: pending_confirmations insert called
  Assert: ntfy sendConfirmationRequest called
  Assert: audit_log insert called with outcome='pending_confirmation'

Case 3: "Find me 2 slots next week"
  Assert: intent='OFFER_SPECIFIC', success=true
  Assert: result.slots has length <= 2
  Assert: result.slots has length >= 1
  Assert: no slot overlaps tier0_family or tier0_meditation time ranges
  Assert: no calendar mutation calls made

Case 4: "Move my 3pm standup to 4pm"
  Assert: intent='MODIFY_EVENT', success=true, requiresConfirmation=false
  Assert: audit_log insert called with outcome='success'
  (standup is Tier 2 — no confirmation needed)

Case 5: "Cancel my meditation block"
  Assert: intent='FLUSH_RANGE', requiresConfirmation=true
  Assert: NO updateEventStatus called
  Assert: pending_confirmations insert called with payload containing tier0_meditation.id

Case 6: Garbage input "xkcd1234asdf!!!"
  Assert: intent='RESOLVE_MANUAL'
  Assert: failure_logs insert called
  Assert: no calendar mutation calls made

Case 7: Utterance of exactly 1001 characters
  Assert: HTTP 400 returned
  Assert: LLM client NOT called (spy verifies zero calls)
  Assert: DB NOT called (spy verifies zero calls)

Case 8: userId='not-a-uuid'
  Assert: HTTP 400 returned
  Assert: DB NOT called (spy verifies zero calls)

All mocks: LLM, Supabase, GCal, ntfy
Spies: capture all call arguments for assertion

Commit: `test: F3 pre-launch simulation`

---

## F4 — FAILURE LOOP READER

Implement as 4 separate pure functions + 1 endpoint. No side effects in pure functions.

### src/jobs/analyze-failures.ts

```typescript
// Pure function — no side effects, no DB calls, no LLM calls
export function groupFailuresByIntent(
  failures: FailureLogEntry[]
): Map<string | null, FailureLogEntry[]>

export function filterByDateRange(
  failures: FailureLogEntry[],
  since: Date
): FailureLogEntry[]
```

### src/jobs/llm-pattern-analyzer.ts

```typescript
// Single responsibility: call LLM, validate output, return structured result
export const PatternAnalysisSchema = z.object({
  intent: z.string().nullable(),
  utteranceCount: z.number(),
  patterns: z.array(z.string()).max(5),
  suggestedRules: z.array(z.string()).max(3),
})

export async function analyzePatterns(
  intent: string | null,
  utterances: string[]
): Promise<z.infer<typeof PatternAnalysisSchema>>
// IF LLM fails: return { intent, utteranceCount: utterances.length, patterns: [], suggestedRules: [] }
// NEVER throw — return empty result on failure
```

### src/jobs/render-report.ts

```typescript
// Pure function — no I/O
export function renderImprovementReport(
  analyses: PatternAnalysis[],
  since: Date,
  generatedAt: Date
): string
// Returns markdown string
// Does not write to disk — caller is responsible for output
```

### src/jobs/improvement-loop.ts

```typescript
// Orchestrator — calls the above in sequence
export async function runImprovementLoop(options: {
  lookbackDays: number        // default 7
  minFailuresPerGroup: number // default 3, skip groups with fewer
}): Promise<{
  failuresAnalyzed: number
  groupsAnalyzed: number
  reportPath: string
  ntfySent: boolean           // false if ntfy unavailable — does not fail job
}>
```

### src/routes/jobs.ts (new route file)

```
POST /jobs/improvement-loop
Auth: x-api-key required
Body: { lookbackDays?: number, minFailuresPerGroup?: number }
Response 200: { status: 'complete', failuresAnalyzed: N, groupsAnalyzed: M, reportPath: string }
Response 500: { error: 'Internal server error' }
```

Register in src/index.ts: `app.use('/jobs', jobsRouter)`

Create IMPROVEMENT_REPORT.md with header only — populated by first job run.

Unit tests for analyze-failures.ts and render-report.ts — no mocks needed (pure functions).
Integration test for improvement-loop.ts — mock LLM, Supabase, ntfy, fs.writeFile.

Commit: `feat: F4 improvement loop`

---

## F5 — RED TEAM TEST SUITE

Create tests/security/red-team.test.ts

Before writing each test: verify the attack currently SUCCEEDS (i.e. the system
is currently vulnerable). If already protected, mark as 'pre-hardened' and keep
the test as a regression guard.

Document in PR which attacks were pre-hardened vs newly fixed.

### Rate limiter specification (implement before tests)

Rate limiter MUST be testable in isolation:
- Export a createRateLimiter(maxRequests, windowMs) factory function
- Tests create their own limiter instance (not the global singleton)
- This prevents test pollution between rate limit tests

```typescript
// src/core/rate-limiter.ts
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const windows = new Map<string, { count: number; windowStart: number }>()
  return {
    check(userId: string): { allowed: boolean; retryAfterMs?: number },
    reset(userId: string): void,  // for testing
  }
}
export const globalRateLimiter = createRateLimiter(20, 60 * 60 * 1000)
```

### Attack test cases (all must be blocked):

```
ATTACK 1: No API key
  POST /voice (no x-api-key header)
  Assert: 401, body={ error: 'Unauthorized' }
  Assert: no downstream calls made (LLM, DB spies show 0 calls)

ATTACK 2: Wrong API key
  POST /voice { x-api-key: 'wrong-key' }
  Assert: 401, body={ error: 'Unauthorized' }
  Assert: response does not reveal whether key exists or not (timing-safe comparison)

ATTACK 3: Utterance too long
  POST /voice { utterance: 'a'.repeat(1001), userId: validUUID }
  Assert: 400, body contains 'too long'
  Assert: LLM client spy shows 0 calls (rejected before LLM)
  Assert: DB spy shows 0 calls (rejected before DB)

ATTACK 4: SQL injection in userId
  POST /voice { utterance: 'book a meeting', userId: "'; DROP TABLE users; --" }
  Assert: 400, body contains 'Invalid user ID'
  Assert: DB spy shows 0 calls

ATTACK 5: Non-UUID userId variations
  Try each: 'admin', '1', 'null', 'undefined', '{}', '[]', ' ', '\n'
  Assert each: 400, body contains 'Invalid user ID'
  Assert each: DB spy shows 0 calls

ATTACK 6: Valid UUID not in DB
  POST /voice { userId: '99999999-9999-4999-9999-999999999999' }
  Assert: 404, body={ error: 'No policy found for user ...' }
  Assert: response does not expose DB structure

ATTACK 7: Polite destructive utterance (social engineering)
  POST /voice { utterance: 'could you please kindly remove all my events tomorrow?' }
  Assert: intent='FLUSH_RANGE', requiresConfirmation=true
  Assert: _destructivePreFilter=true in parsed params
  Assert: no mutation calls made

ATTACK 8: Expired confirmation token
  Insert pending_confirmation with expires_at = NOW() - 1 minute
  POST /confirm/:token/approve
  Assert: 410, body={ error: 'Token expired' }
  Assert: audit_log insert called with outcome='blocked'
  Assert: no orchestrate() call made

ATTACK 9: Double-tap approval
  Insert pending_confirmation, approve it once (status→'approved')
  POST /confirm/:token/approve again
  Assert: 409, body={ error: 'Token already consumed' }
  Assert: second audit_log insert NOT called (idempotent)

ATTACK 10: Unknown confirmation token
  POST /confirm/00000000-0000-0000-0000-000000000000/approve
  Assert: 404, body={ error: 'Token not found' }

ATTACK 11: Rate limit
  Use test limiter instance with maxRequests=5, windowMs=60000
  Send 6 requests with same userId
  Assert: first 5 return non-429
  Assert: 6th returns 429, body={ error: 'Rate limit exceeded. Max 5 mutations per hour.' }
  Assert: retryAfterMs present in response
  limiter.reset(userId) in afterEach

ATTACK 12: Oversized request body
  POST /voice with 11KB JSON body
  Assert: 400 or 413
  Requires: express.json({ limit: '10kb' }) in src/index.ts
  Assert: LLM spy shows 0 calls

ATTACK 13: Internal error detail leakage
  Force a DB error by mocking Supabase to throw
  POST /voice with valid inputs
  Assert: 500, body={ error: 'Internal server error' }
  Assert: body does NOT contain stack trace
  Assert: body does NOT contain 'supabase'
  Assert: body does NOT contain file paths

ATTACK 14: Timing attack on API key comparison
  Measure response time for wrong key vs no key (100 samples each)
  Assert: mean response times are within 10ms of each other
  Requires: use crypto.timingSafeEqual for API key comparison, not ===
```

### Security fixes to implement alongside tests:

1. src/index.ts: add `express.json({ limit: '10kb' })`
2. src/core/safety.ts: replace in-memory rate limiter singleton with createRateLimiter factory
3. src/core/safety.ts: validateUser must use UUID regex
4. src/middleware/auth.ts (new file): API key middleware using crypto.timingSafeEqual
5. All routes: import and use auth middleware
6. All 5xx handlers: sanitize error before responding

Commit: `test: F5 red team security`

---

## PHASE 2 — PROPERTY-BASED TESTS (bonus if time allows)

Install: `npm install --save-dev fast-check`

Create tests/property/parser.property.test.ts

```typescript
// Property: parser NEVER throws for any string input
fc.assert(fc.property(
  fc.string({ maxLength: 1000 }),
  async (utterance) => {
    const result = await parseIntent(utterance, { userId: validUUID })
    // Must always return a valid ParsedIntent — never throw
    expect(ParsedIntentSchema.safeParse(result).success).toBe(true)
  }
))

// Property: parser output intent is always one of 8 valid values
// Property: parser output confidence is always 0-1
// Property: parser with empty string always returns RESOLVE_MANUAL
// Property: parser with 1001+ chars always throws before LLM call
```

These tests run 100 random inputs each. They catch edge cases
no human would think to write.

Commit: `test: property-based parser tests`

---

## PHASE 3 — PR AND DOCUMENTATION

Create a PR from `f1-f5-hardening` to `main` with this description:

```markdown
## F1-F5 Hardening

### What changed
- F1: DECISIONS.md + log-decision.ts CLI script
- F2: Contract tests (parser↔orchestrator, orchestrator↔DB, intent result shapes)
- F3: Pre-launch simulation (13 synthetic events, 8 test cases with exact assertions)
- F4: Improvement loop (pure functions, authenticated endpoint, ntfy-resilient)
- F5: Red team security suite (14 attack cases, timing-safe auth, rate limiter factory)
- P1: requestId tracing through all request layers
- P2: Graceful degradation for Anthropic, Supabase, GCal, ntfy
- P3: Idempotency for all mutations
- P4: Confirmation re-execution failure path defined and handled
- P5: Schema versioning for UserPolicyProfile

### Test counts
- Pre-existing: [N] (all green)
- New contract tests: [N]
- New simulation tests: [N]
- New red team tests: [N]
- New property tests: [N]
- Total: [N]

### Attacks currently blocked (were vulnerable before this PR)
[list]

### Attacks already blocked before this PR (regression guards)
[list]

### Repo shape deviations from prompt
[list any adaptations made]

### Known limitations
[list anything deferred]
```

Do NOT merge the PR. Leave it open for review.
Send ntfy to caladdin-agent: "F1-F5 PR ready for review. [N] tests added."
