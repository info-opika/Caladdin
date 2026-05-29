# Caladdin — Master Document Index
**Version:** 3.0 (Reboot)
**Date:** April 20, 2026
**Status:** Pre-build. Spec frozen pending PIVOT_ASYNC and auth updates.

> **For full app build, read [`CALADDIN_FULL_APPLICATION_SPEC.md`](./CALADDIN_FULL_APPLICATION_SPEC.md) first.**  
> It is the canonical master spec for a shippable MVP plus production operations. Use this index for infra checklist, prompts, and document inventory.

---

## WHAT THIS IS

Everything needed to build Caladdin from scratch at top 1% engineering standard.
**Start with** [`CALADDIN_FULL_APPLICATION_SPEC.md`](./CALADDIN_FULL_APPLICATION_SPEC.md) for the complete application contract, or [`CALADDIN_TECH_SPEC.md`](./CALADDIN_TECH_SPEC.md) for backend-only quick reference.
Read in order when diving into a specific layer. Each document builds on the previous.
Do not give experimental prompts to Cursor until Step 1 (spec freeze) is complete for that workstream.

---

## DOCUMENT INVENTORY

### 0. CALADDIN_FULL_APPLICATION_SPEC.md (canonical master)
**What it is:** The **single full-application specification** for building, deploying, testing, and operating a shippable 10-user MVP plus production hardening. Merges all other spec docs into Parts 0–12 with appendices (F1–F5, Phase X, blockers, agent workflow).

**Read this if:** You implement, review, or operate the full product — backend, frontend, OAuth, Fax Effect, ops.

**Path:** [`CALADDIN_FULL_APPLICATION_SPEC.md`](./CALADDIN_FULL_APPLICATION_SPEC.md)

---

### 0a. CALADDIN_BUILD_PLAN.md (implementation)
**What it is:** Greenfield build plan with phase checklist — how and when to implement the full app.

**Path:** [`CALADDIN_BUILD_PLAN.md`](./CALADDIN_BUILD_PLAN.md)

---

### 0b. CALADDIN_TECH_SPEC.md (backend extract)
**What it is:** The **single consolidated technical specification**. It merges
MVP (`CALADDIN_MVP_SPEC_V4_1.md`), Intent Architecture v5 (`CALADDIN_INTENT_ARCHITECTURE_V5.md`),
and implementation-grade material from `docs/archive/` (hardened spec v2.1, Phase X,
spec deltas). It defines **10 user intents + `RESOLVE_MANUAL`**, PIVOT_ASYNC modes A/B/C,
session-first user auth with `CALADDIN_API_KEY` only for machine routes, unified data model
(Grounded in current `supabase/migrations/` + Phase X backlog tables), degradation matrix,
and an Appendix summarizing F1-F5 hardening mapped to this auth model.

**Read this if:** You implement or review backend behavior, safety, APIs, schema, or tests.

**Path:** [`docs/spec/CALADDIN_TECH_SPEC.md`](./CALADDIN_TECH_SPEC.md)

---

### 1. CALADDIN_HARDENED_SPEC_V2.md (archive)
**What it is:** Deep implementation-ready spec (intent routing, orchestrator pseudocode,
Zod shapes, endpoints). Historical filename was `CALADDIN_HARDENED_SPEC_V2.md`; archived as
**[`docs/archive/CALADDIN_HARDENED_SPEC_V2_1.md`](../archive/CALADDIN_HARDENED_SPEC_V2_1.md)**.

**Note:** It still describes an **8-intent** era in places. For enum and route auth truth,
use **`CALADDIN_TECH_SPEC.md`** first; use the archive for extra procedural detail.

**Supplementary deltas:** [`docs/archive/CALADDIN_HARDENED_SPEC_DELTAS.md`](../archive/CALADDIN_HARDENED_SPEC_DELTAS.md)

---

### 2. CALADDIN_PHASE_X_HARDENING.md (archive)
**What it is:** Addendum covering production-grade hardening: operation ordering, chaos adapters,
compensating transactions, shadow traffic, telemetry, idempotency, sliding-window rate limiting,
and additional DB tables.

**Read this after:** `CALADDIN_TECH_SPEC.md` (integrated summary) — full detail lives in **[`docs/archive/CALADDIN_PHASE_X_HARDENING.md`](../archive/CALADDIN_PHASE_X_HARDENING.md)**.

**Status:** Reference; operational sections merged into consolidated tech spec with backlog flags.

---

### 3. CALADDIN_FINAL_AGENT_PROMPT.md (archive)
**What it is:** The master prompt that builds Phase 1 (all 8 modules) from scratch.

**Path:** **`docs/archive/CALADDIN_FINAL_AGENT_PROMPT_1.md`**  
Paste into a Cursor Cloud Agent to build Phase 1 from greenfield.

**Use when:** Starting a new agent session to build Phase 1.

**Prerequisites before pasting:**
- Skills deployed to .claude/skills/ in repo ✅
- PROGRESS.md exists in repo ✅
- .env has all required variables ✅
- Spec is frozen ← NOT YET

---

### 4. CALADDIN_F1F5_TOP1PCT_PROMPT.md
**What it is:** The hardening prompt. Builds F1-F5 plus Phase X additions
on top of Phase 1. Includes discovery phase, foundational fixes, contract tests,
simulation, improvement loop, and red team security suite.

**Use when:** Phase 1 is complete, all 8 modules green, basic app running.

**Prerequisites:**
- Phase 1 complete and passing ✅
- Integration bugs fixed (12 bugs from code review) ← NOT YET
- OAuth working end-to-end ← NOT YET

---

### 5. caladdin-skills.zip
**What it is:** The 5 agent skill files that shape every Cursor agent session.
Must be deployed to .claude/skills/ in the repo before any agent session starts.

**Skills included:**
- opika-skill-caladdin-adt-discipline
- opika-skill-caladdin-safety-guard
- opika-skill-caladdin-orchestrator
- opika-skill-caladdin-fax-effect-output
- opika-skill-caladdin-test-discipline

**Status:** Deployed to repo ✅

---

## WHAT IS DONE

### Infrastructure
- ✅ GitHub repo: github.com/kmiriyala/caladdin (private)
- ✅ Supabase project: fkikgtxhndkricywkirw.supabase.co
- ✅ 6 core DB tables created (users, user_policies, events, failure_logs, audit_log, pending_confirmations)
- ✅ google_tokens table created
- ✅ All 5 agent skills deployed to .claude/skills/
- ✅ PROGRESS.md and AGENT_GUIDELINES.md in repo
- ✅ .env has: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_REDIRECT_URI, CALADDIN_BASE_URL
- ✅ Google Calendar API enabled in Google Cloud Console (caladdin-beta project)
- ✅ ngrok installed and configured
- ✅ ntfy app on iPhone, subscribed to caladdin-agent and caladdin-fkikgtxh

### Code (Phase 1 — built by Cursor agent)
- ✅ All 28 source files built
- ✅ 95 tests passing
- ✅ 93.86% code coverage
- ✅ 10-user simulation: 100% utterance accuracy
- ✅ Merged to main via PR

### Partially working
- ⚠️ App runs locally (npm run dev)
- ⚠️ Voice endpoint responds correctly to PROTECT_BLOCK
- ⚠️ Parser classifies correctly (LLM working)
- ⚠️ Supabase connected and writing

### NOT working yet
- ❌ Google OAuth flow (/auth/start broken — env var naming fixed in code but not tested)
- ❌ Real Google Calendar writes (oauthClient never passed to orchestrator)
- ❌ Confirmation re-execution (approve does nothing to calendar)
- ❌ ntfy Approve/Reject buttons (need ngrok URL + API key in action headers)

---

## WHAT IS NOT DONE (PRIORITIZED)

### Must fix before first real user

1. **Spec freeze** — update PIVOT_ASYNC (3 modes) and auth (Option 3: Google Sign In)

2. **12 integration bugs** — from code review, give integration bug prompt to Cursor:
   - tokens.ts schema mismatch
   - voice.ts never loads oauthClient
   - offer-specific.ts IntentResult schema violation
   - protect-block.ts wrong datetime for GCal event
   - auth.ts singleton caches broken state
   - confirm.ts approve never re-executes action
   - No API key auth on endpoints
   - No rate limiting
   - Error messages leak internals
   - No utterance length limit
   - No UUID validation on userId
   - OAuth state not verified

3. **Google OAuth end-to-end** — complete the handshake with kanthatbww@gmail.com

4. **Pre-launch simulation** — F3 from the hardening prompt, against synthetic events

5. **First real user (you)** — kanthatbww@gmail.com calendar, 12 utterances manually

### After first real user works

6. F1-F5 + Phase X hardening (full hardening prompt)
7. 4 additional DB tables (migration 003_phase_x.sql)
8. Session-based auth (Option 3) for the other 9 users
9. Red team security suite
10. 10-user live test protocol

---

## DECISIONS LOG (KEY ARCHITECTURAL DECISIONS)

| Decision | Rationale |
|----------|-----------|
| Zod as single source of truth for types | Prevents type drift between compile-time and runtime |
| Tier stored in Supabase, not GCal | GCal has no native tier field |
| Supabase first, GCal second in all mutations | Supabase is source of truth, GCal is sync target |
| Sliding window rate limiter | Fixed window allows burst at window boundary |
| Chaos adapter pattern, not scattered maybeFail() | Production code stays clean |
| 5-minute idempotency bucket | Captures retries, not intentional repeats |
| Shadow replay in staging only | Production replay creates real calendar events |
| Google Sign In for user auth (Option 3) | No technical setup for users |
| Single CALADDIN_API_KEY for server auth | Prototype with 10 trusted users, per-user tokens deferred to v2 |

---

## SPEC OPEN ITEMS (RESOLVE BEFORE CURSOR TOUCHES CODE)

### Open Item 1: PIVOT_ASYNC three modes
**Spec status:** Modes A/B/C are defined in [`CALADDIN_TECH_SPEC.md`](./CALADDIN_TECH_SPEC.md) and [`CALADDIN_MVP_SPEC_V4_1.md`](./CALADDIN_MVP_SPEC_V4_1.md). Remaining gap is **full product implementation** (channels, UX).

Current spec: "decline and suggest async alternative"
Correct spec: three distinct modes:

Mode A — Decline + Reschedule:
  Caladdin sends decline to original requester
  Caladdin calls OFFER_SPECIFIC to generate 2 new slots
  Sends new slot proposal to requester automatically
  Requester: informed, given alternatives

Mode B — Decline only:
  Caladdin sends decline to original requester
  No new times offered
  Requester: informed, no alternatives

Mode C — Block + Silent:
  Caladdin blocks contact via GATEKEEP_RULE (sets contactTier to blocked)
  No message sent to requester
  Request disappears
  Requester: not informed

User selects mode via voice command context:
  "Tell John I can't make it, find him other times" → Mode A
  "Decline the call from Sarah" → Mode B
  "Block this person, don't tell them anything" → Mode C

### Open Item 2: Authentication (Option 3)
**Spec status:** Session-first users + `CALADDIN_API_KEY` for machine routes are specified in [`CALADDIN_TECH_SPEC.md`](./CALADDIN_TECH_SPEC.md). Remaining gap is **code + tests** fully matching that split (some routes may still evolve).

Replace API key auth for users with Google Sign In (historical wording).
Users go to caladdin.app, click Sign in with Google, they're in.
No API key. No setup. Session-based.

Required additions to spec:
  - express-session with Supabase session store
  - Session created on /auth/callback success
  - Session cookie sent to browser automatically
  - All protected routes check session, not x-api-key header
  - CALADDIN_API_KEY retained for server-to-server (admin, jobs, ntfy callbacks)
  - Logout endpoint: DELETE /auth/session

---

## HOW TO REBOOT CORRECTLY

### For a new Cursor agent session (Phase 1 rebuild):
1. Ensure skills are in .claude/skills/ ✅
2. Read [`CALADDIN_TECH_SPEC.md`](./CALADDIN_TECH_SPEC.md); freeze MVP + implementation deltas for your milestone
3. Update PROGRESS.md to reflect current state
4. Paste [`docs/archive/CALADDIN_FINAL_AGENT_PROMPT_1.md`](../archive/CALADDIN_FINAL_AGENT_PROMPT_1.md) into new Cursor agent
5. Agent reads PROGRESS.md first and resumes — does not rebuild what's done

### For hardening (F1-F5 + Phase X):
1. Phase 1 must be complete and green ✅
2. Integration bugs must be fixed ← NOT YET
3. OAuth must work end-to-end ← NOT YET
4. Paste CALADDIN_F1F5_TOP1PCT_PROMPT.md into new Cursor agent
5. Agent creates branch f1-f5-hardening, never pushes to main

### For a complete from-scratch rebuild:
1. Delete all src/ files except src/services/auth_service.ts and src/services/calendar_api.ts
   (these are from legacy opika-caladdin and are worth preserving)
2. Freeze the spec
3. Follow Phase 1 rebuild above

---

## TEST CREDENTIALS (SAFE TO SHARE INTERNALLY)

- Test userId: 77a22c75-4e6b-47ca-aee6-2f4ace21be53
- Test email: test2@caladdin.com (in Supabase)
- Test Google account for calendar testing: kanthatbww@gmail.com
- ntfy topic for build: caladdin-agent
- ntfy topic for user confirmations: caladdin-fkikgtxh
- Supabase project: fkikgtxhndkricywkirw
- Google Cloud project: caladdin-beta
