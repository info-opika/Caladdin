# Caladdin — Consolidated Technical Specification

**Version:** 1.0 (consolidated)  
**Date:** May 27, 2026  
**Status:** Backend-focused technical contract. For greenfield builds, frontend, deployment, and full production scope, use **[`CALADDIN_FULL_APPLICATION_SPEC.md`](./CALADDIN_FULL_APPLICATION_SPEC.md)** (supersedes this document as the canonical master spec). This file remains valid as a backend-only extract. Product behavior is anchored on [CALADDIN_MVP_SPEC_V4_1.md](./CALADDIN_MVP_SPEC_V4_1.md) and [CALADDIN_INTENT_ARCHITECTURE_V5.md](./CALADDIN_INTENT_ARCHITECTURE_V5.md); implementation contracts and operations are anchored on archived [CALADDIN_HARDENED_SPEC_V2_1.md](../archive/CALADDIN_HARDENED_SPEC_V2_1.md), [CALADDIN_HARDENED_SPEC_DELTAS.md](../archive/CALADDIN_HARDENED_SPEC_DELTAS.md), and [CALADDIN_PHASE_X_HARDENING.md](../archive/CALADDIN_PHASE_X_HARDENING.md).  

**Notation (from hardened spec):**

- **MUST** / **MUST NOT** — mandatory.
- **SHOULD** — strong default; deviations need a recorded reason (e.g. in `DECISIONS.md`).

---

## Document precedence (conflict resolution)

When documents disagree, apply this order:

1. **Product truth:** [CALADDIN_MVP_SPEC_V4_1.md](./CALADDIN_MVP_SPEC_V4_1.md), [CALADDIN_INTENT_ARCHITECTURE_V5.md](./CALADDIN_INTENT_ARCHITECTURE_V5.md).
2. **Technical contract:** [CALADDIN_HARDENED_SPEC_V2_1.md](../archive/CALADDIN_HARDENED_SPEC_V2_1.md) — but every **intent set**, handler routing list, schema enum, parser test matrix, security test, and degradation table **MUST** be updated from the legacy “8 intents” model to this document’s **10 user intents + `RESOLVE_MANUAL`**.
3. **Formal add-ons:** [CALADDIN_HARDENED_SPEC_DELTAS.md](../archive/CALADDIN_HARDENED_SPEC_DELTAS.md) (state machine, blast radius, payload hash verification, degradation templates).
4. **Production ops:** [CALADDIN_PHASE_X_HARDENING.md](../archive/CALADDIN_PHASE_X_HARDENING.md) (ordering, compensation queue, chaos adapters, telemetry, idempotency, sliding-window limits).
5. **Engineering backlog (normative summary):** [CALADDIN_F1F5_TOP1PCT_PROMPT.md](./CALADDIN_F1F5_TOP1PCT_PROMPT.md) — Appendix A below; supersede its user-facing **`/voice` requires `x-api-key`** stance with §3 (session-first users).

Vision and narrative-only content: [CALADDIN_PRODUCT_VISION_V2.md](./CALADDIN_PRODUCT_VISION_V2.md) — summarized in Appendix B, not duplicated as normative API rules.

---

## 1. Scope and definitions

### 1.1 What Caladdin is (MVP)

Caladdin is a scheduling assistant that accepts **voice or typed** natural language (**Cal-language**) and safely orchestrates reads and mutations against **Google Calendar** with **Supabase** as the system of record for policy, mirrored events where applicable, audit, confirmations, and failure telemetry.

### 1.2 Cal-language

Defined in MVP §4–§7. Summary:

- **In scope:** Plain English strictly about **time and calendar**.
- **Out of scope (off-topic):** **SHOULD NOT** become `RESOLVE_MANUAL`. Return a **warm redirect** (friendly nudge toward calendar/scheduling)** with no harsh error**.
- **`RESOLVE_MANUAL`:** Only for **ambiguous Cal-language**, multi-step bundles (v1: propose first step — Intent Architecture §Multi-step), or safety/confidence failures — not idle chat.

### 1.3 Non-goals (MVP)

See MVP §1 and §16 (no autonomous Level-6 agent, no Calendly-clone framing, no 3+ person scheduling in MVP, no harvesting email bodies, etc.).

### 1.4 Acronyms

- **Fax Effect:** Recipient-facing scheduling page with exactly **two** offered slots where possible — personal, minimal AI branding — see MVP §12–§13.
- **Shadow block / proposed slot:** A **proposed** calendar hold representing an offered slot (MVP §10; Intent Architecture §Shadow blocks).

---

## 2. System architecture

### 2.1 High-level pipeline

Every user command flows:

1. **Ingress** — Authenticated caller (§3); validate body size and utterance bounds (§7).
2. **Parse / classify** — Single primary LLM classification pass (MVP §5). **Recommendation:** Claude **tool use** (`classify_intent`) with schema enforced by the API contract; **MUST** still run **Zod** validation on structured output ([CALADDIN_INTENT_ARCHITECTURE_V5.md](./CALADDIN_INTENT_ARCHITECTURE_V5.md)).
3. **Preflight safety** — Tier rules, destructive pre-flag, blast radius (§6 + Deltas §20).
4. **Orchestrate** — Route to exactly one intent handler; catch all handler errors; produce `IntentResult` (§4, §8).
5. **Persist — ordering** — For mutations: **Supabase first**, **Google Calendar second** ([CALADDIN_PHASE_X_HARDENING.md](../archive/CALADDIN_PHASE_X_HARDENING.md)). If GCal fails after a successful authoritative Supabase write, **MUST NOT** roll back Supabase solely for sync failure **SHOULD** enqueue **compensation** work (§8.4, Appendix A).
6. **Respond** — Fax-style `messageToUser` where applicable; HTTP envelope for API (§7).
7. **Audit & telemetry** — `audit_log` always; `failure_logs` where resolution or parse path requires it (hardened §15).

### 2.2 Trust boundaries

| Zone | Holds |
|------|--------|
| **Browser** | Session cookie for Caladdin identity; Google OAuth UX for Calendar scopes only. **MUST NOT** ship `CALADDIN_API_KEY` to browsers. |
| **App server** | LLM keys, DB credentials, OAuth client secret, signing keys, optional API key for machine routes. |
| **Public recipient** | Unauthenticated **`GET /s/:token`** (or product hostname equivalent) limited to scheduling session lifecycle only. |

### 2.3 External dependencies

- **Anthropic** — Classification (recommended: Haiku-class model per hardened §5 unless changed by policy).
- **Google Calendar API + OAuth** — Calendar truth on Google side; tokens stored per hardened §14 (+ Supabase migrations under `supabase/migrations/`).
- **Supabase Postgres** — Source of truth for policy, confirmations, audits, scheduling sessions, feedback, clarifications (see §8).
- **ntfy (or successor)** — Human confirmations and agent checkpoints ([CALADDIN_HARDENED_SPEC_V2_1](../archive/CALADDIN_HARDENED_SPEC_V2_1.md) §12; security caveat §10.5).

---

## 3. Authentication & authorization

### 3.1 Principles (canonical)

- **Human users interacting with the chat / web app:** authenticated via **Google Sign-In for Calendar OAuth** tied to an **opaque Caladdin user id** exposed as a **server-issued HTTP-only session binding** (the product intent described in `CALADDIN_MASTER_INDEX.md` Option 3: “no API key setup for humans”). Practical implementations **MAY** use `express-session` with a persistent store **OR** a signed opaque session cookie (current code uses cookie-based binding); both satisfy “browser session establishes identity”.
- **`CALADDIN_API_KEY`:** **MUST** be required for **machine-only** endpoints (background jobs, `ntfy` Action callbacks to `/confirm/...`, and any webhook-style integration). **MUST NOT** be the primary auth for `/voice` or host JSON APIs consumed by real users.

### 3.2 Route classes (logical)

| Route class | Typical paths | Authentication |
|-------------|----------------|----------------|
| **Public health** | `GET /health` | None |
| **User OAuth** | `/auth/start`, `/auth/callback` | OAuth + signed `state`; session cookie cohesion as in implementation |
| **User command** | `POST /voice` (mounted at `/voice` in current app), host APIs under `/api/...`, `/feedback` | Valid Caladdin session (cookie); body `userId` if present **MUST** match session |
| **Recipient scheduling** | `GET /s/:token`, posting slot choice | Rate limit + abuse controls; optional future signed tokens |
| **Machine** | `/confirm/:token/(approve|reject)`, `POST /jobs/...`, future `POST /jobs/improvement-loop` | `CALADDIN_API_KEY` header (timing-safe compare) unless replaced by short-lived signing |
| **E2E** | gated by environment | Restricted |

**Note:** Hardened spec §16.4 Attack 1 (no API key → 401 on `/voice`) conflicts with §3 above; Appendix A retains that test intent as **mutation abuse protection** rerouted — e.g. **rate limit unauthenticated callers** rather than contradicting cookie session auth.

---

## 4. Canonical intents (normative)

### 4.1 Closed set

The classifier **MUST** output exactly one primary label among **10 intents** plus the safety valve:

| Intent | Mutates authoritative DB / GCal (typical) | Notes |
|--------|--------------------------------------------|-------|
| `PROTECT_BLOCK` | YES | Protected / recurring holds |
| `OFFER_SPECIFIC` | YES (`scheduling_sessions` + proposed holds) — read-heavy | Generates **≤ 2** slots + share link |
| `CREATE_EVENT` | YES | Explicit time placement |
| `FLUSH_RANGE` | YES | Cancel/clear windows |
| `MODIFY_EVENT` | YES | `scope`: `single` \| `this_and_future` \| `series` |
| `PIVOT_ASYNC` | MAY (messages / policy) | **Modes A / B / C** (§4.2) |
| `SHAPE_RULES` | YES (policy) | Time preferences |
| `GATEKEEP_RULE` | YES (policy) | Contact/domain tiering |
| `QUERY_CALENDAR` | NO | Read/summarize |
| `UNDO` | YES (reverse last eligible op, windowed) | See MVP §5 UNDO limits |
| `RESOLVE_MANUAL` | NO | Escalation / ambiguity — **never** mere off-topic chit-chat |

Classification failure (invalid tool output, failing Zod parse, contradictions): **route to `RESOLVE_MANUAL`** and log (`failure_logs`).

### 4.2 `PIVOT_ASYNC` modes

- **Mode A — Decline + reschedule:** polite decline semantics + **`OFFER_SPECIFIC`**-style alternate slots (automatic proposal path per MVP / Master Index).
- **Mode B — Decline only:** decline message scaffolding; **no** new slots.
- **Mode C — Block + silent:** apply `GATEKEEP_RULE`/`contactTier` blockage; **no** outbound message — request disappears from user’s obligation surface.

Explicit examples: MVP §5 — Master Index §Open Item 1.

### 4.3 `MODIFY_EVENT` scope

Defaults per MVP §5 — **infer `single`** unless user says **“always”, “from now on”, “all occurrences”**.

### 4.4 `GATEKEEP_RULE` parameters

Always extract **contact** (email or domain) + **tier** `0=sacred, 1=high, 2=standard, 3=flexible` — MVP §5.

### 4.5 Multi-step utterances

v1: Prompt user to execute step 1, then resume — Intent Architecture §Multi-step intents. Full executor **deferred** to post-MVP.

---

## 5. Parser & classification rules

### 5.1 Pre-LLM validation (MVP + hardened adaptation)

Given `utterance: string`, `userId`:

1. **`userId` format** — MUST be valid UUID canonical string; reject before DB (**400**) if malformed.
2. **Utterance** — nonempty, trim; max **1000** chars (attacks & cost); **reject before LLM** if too long (**400**) — hardened §5 / F5.
3. **Off-topic** — If clearly not calendar-related (**no** CAL-language), **Warm redirect handler** (**no LLM**) per MVP. **Exception:** if product chooses a cheap relevance gate, failures **must not** degrade to harsh errors — MVP §4 consistency.
4. **Destructive pre-filter** — `DESTRUCTIVE_VERB_RE = /\b(delete|cancel|remove|clear|drop|erase|wipe)\b/i` (per MVP §8). Match → set `_destructivePreFilter=true` → logged → **still classify** → orchestrator MUST force **`requiresConfirmation=true`** wherever mutation would proceed.

### 5.2 LLM invocation

One primary LLM invocation per utterance (MVP). Timeouts SHOULD match MVP (§11): **≈10s** graceful user messaging unless kill-switch forbids hanging.

Recommended **tool** shape (abbreviated):

```typescript
// Contract name: classify_intent
{
  intent: enum[...10 intents + RESOLVE_MANUAL],
  confidence: number [0,1],
  params: object,
  mappingMethod: enum['direct','fuzzy','resolve_manual']
}
```

### 5.3 Confidence routing

- `confidence >= 0.85`, intent not `RESOLVE_MANUAL` → **`direct`**.
- `0.60 <= confidence < 0.85` (calendar-shaped) → **`fuzzy`** (log hint).
- `< 0.60` or forced manual → **`resolve_manual`** (override intent to `RESOLVE_MANUAL`).

`_destructivePreFilter` overrides neither label nor fuzzy routing but **still forces confirmation** downstream.

Multi-step/confidence split → `RESOLVE_MANUAL` with structured follow-up suggestion.

---

## 6. Safety, tiers, confirmations

### 6.1 Tier table

| Tier | Label | Mutation posture |
|------|-------|-------------------|
| 0 | Sacred / Immovable | **MUST NOT** mutate without explicit confirmation pathway |
| 1 | High-stakes | **MUST** confirm destructive intents (`FLUSH_RANGE`, destructive `MODIFY_EVENT`, etc.) |
| 2 | Standard | Allowed with audit |
| 3 | Flexible | Allowed with audit |

Defaults per MVP §7 (**imported calendar events tier 2** unless promoted). Blast radius guard: **>** **5** events affected → **confirmation required** irrespective of tiers (DELTAS §20).

### 6.2 Invariants

- **Destructive misunderstanding:** **`delete` NEVER becomes silent `create`**. MVP §8 invariant.
- **Explicit confirmations:** user **MUST** confirm with affirmative tokens (`yes`, `confirm`, **`ok`, `sure`**, tap Approve) — MVP §8; expiry **10 min** defaults (hardened §9).
- **`pending_confirmations` payload hashing** — recomputed at approve time (**409** stale state) — DELTAS §21; column exists per migration [`004_add_payload_hash.sql`](../../supabase/migrations/004_add_payload_hash.sql).

### 6.3 Confirmation state machine & re-execute

Baseline: hardened §9 with extensions:

**APPROVED path MUST:**

1. Mark row `approved`.
2. Reconstruct context from payload.
3. Set `_skipConfirmationGate=true` equivalent.
4. Call orchestrator re-entry.
5. On handler failure AFTER approval — **distinct execution status** (**200** semantic success of approval intent, surfaced as `executionStatus: 'failed'`) — F1-F5 **P4** Appendix A (**MUST NOT** spurious **500** only because execute failed after human intent to approve).

### 6.4 Rate limiting (target)

Rolling **60-minute** sliding window (**20 mutations / user**) — PHASE_X §X6 (supersedes fixed-window hardness). READ intents (`QUERY_CALENDAR`, qualifying `OFFER_SPECIFIC`/`PIVOT` read-only stretches) SHOULD NOT consume mutation budget — align test suite accordingly.

---

## 7. APIs (contract-level)

Responses **MUST NOT** leak stacks, paths, `"supabase"`, secrets (F5). JSON body caps SHOULD match **≤ 10 KB** hardened / F5.

### 7.1 `POST /voice`

**Auth:** Cookie session (**not** raw API key for humans).

Body (logical): `{ utterance: string }` optionally plus audio multipart where supported — MVP voice path; **implementation-specific fields** SHOULD stay backward compatible.

200 returns structured `IntentResult` (§8.1 schema conceptually).

Responses also include **`x-request-id`** header once implemented — Appendix A (P1).

### 7.2 OAuth & scheduling

- `/auth/start` — initiates OAuth.
- `/auth/callback` — exchanges code → persists tokens (**Supabase authoritative + disk/cache** hardened §14 logic).

Scheduling link surface (canonical path in current codebase): **`/s/:token`** — GET renders Fax Effect recipient page MVP §12; POST endpoints select / propose alternate slots (`/s/:token/select`, `/s/:token/propose`).

### 7.3 `POST /confirm/:token/(approve|reject)`

**Auth:** `CALADDIN_API_KEY` via `ntfy` Action header until replaced by signed ephemeral tokens (**security debt** hardened §Known bugs bullet 5).

### 7.4 Host JSON endpoints (cookies)

`/api/sessions`, `/feedback`, `/api/sessions/:token/proposals/:index` patterns — authenticated via Caladdin user cookie cohesion (mirror `resolveHostUserId` semantics in codebase).

---

## 8. Data model

### 8.1 Schema philosophy

**Zod is source of truth** for structured TypeScript values derived at runtime (`UserPolicyProfile`, `CalendarEvent`, `ParsedIntent`, `IntentResult`, etc.) — extend hardened §4 enums to **10 intents**.

**Fax weight invariant bugfix:** hardened §8 / Known bugs → enforce **exactly 1.0** weighted sum (`energyWeight=0.50` correction baseline).

### 8.2 `ParsedIntent` (logical)

Extend hardened enum with: `CREATE_EVENT`, `QUERY_CALENDAR`, `UNDO` beside existing names; keep `mappingMethod`.

### 8.3 `IntentResult` (logical)

`intent` field enumerates executed **routing label** aligned with ParsedIntent intents; include optional **`slots`** (OFFER_SPECIFIC), **`eventsAffected`**, **`messageToUser`**, **`confirmationToken`** when gated.

Schema versioning SHOULD exist (`schemaVersion`) — Appendix A P5.

### 8.4 Tables (Postgres — grounded + backlog)

Implemented / evolving in repo migrations (subset described here — run `supabase/migrations/` for DDL truth):

Core (001): **`users`**, **`user_policies`**, **`events`**, **`failure_logs`**, **`audit_log`**, **`pending_confirmations`**.

Tokens: **`google_tokens`** migrations (002+).

Operational extensions already present:

| Table | Purpose |
|-------|---------|
| `scheduling_sessions` | Scheduling link Fax Effect payloads (007) token + offered slots JSON + lifecycle |
| `feedback_logs` | Thumbs weekly feedback MVP §15 (008 — note `user_id` stored as TEXT in migration) |
| `usage_events` | Analytics / instrumentation (011) |
| `pending_clarification_frames` | Durably stored multi-turn clarifications (013) |

Backlog additions (Phase X / Intent Architecture integration — migrate when prioritized):

| Table | Purpose |
|-------|---------|
| `compensation_queue` | Deferred GCal sync actions after successful Supabase write |
| `idempotency_keys` | Replay protection (5‑minute hashing bucket + 24h expiry) |
| `shadow_requests` / `shadow_diffs` | Staging replay only |
| Structural column | **`events.proposed_for_session`** (nullable FK → session) if event rows mirror each proposed shadow block distinctly |

Undo support SHOULD add **`audit_log.previous_state JSONB`** (Intent Architecture) when UNDO graduation requires reversible snapshots beyond current audits.

Telemetry JSON on `audit_log` — Phase X encourages embedding structured latency & deps.

---

## 9. Fax Effect scoring & slot generation

Formal scoring hardened §8; slot generation gap explicitly closed by prototype rule hardened §Known bug 3: **uniform 30m grid** inside **working hours (09–18)** in user TZ over **next ~7 days** excluding busy intervals.

Shadow blocks MVP §10: each offered slot SHOULD materialize **`status='proposed'`** markers on host timeline (conceptual link to scheduling session + proposed event ids arrays in Intent Architecture v5 sketch — integrate with migrated schema).

Expiry default **72h** MVP; align `scheduling_sessions.expires_at`.

---

## 10. Degradation, reliability, UX

Unified matrix (merged MVP §11 + Phase X failure table + Deltas §19). HTTP families choose **truthful emptiness**:

| Dependency state | Behavior | Typical HTTP |
|------------------|-----------|---------------|
| **Supabase unreachable** | No durable audit path — MUST fail safely | **503** + Retry-After 30 (`Caladdin unavailable…`) MVP |
| **LLM unreachable / errored mid-parse** | **DEGRADED_LLM**: deterministic keyword shim **ONLY** → low-risk intents MVP §11; escalate unknowns safely | Prefer **503** OR **200** with limited-mode copy **only if** deterministic parse succeeded — document chosen policy in `DECISIONS.md` once fixed |
| **GCal unreachable after Supabase OK** | queue compensation (`compensation_queue` when shipped) — user copy: “Saved locally; Calendar sync retries” MVP §11 | **200**/success semantics with flag |
| **ntfy unreachable** | log + proceed if core op succeeded hardened | Non-blocking |
| **OAuth revoked / missing** | detect on GCal probe; reconnect banner MVP §11 | **401**/409 style host guidance |
| **Utterance LLM stall** | timeout + friendly retry prompt MVP §11 | Possibly **504** gated |

SAFE_MODE tightening (DELTAS) SHOULD restrict simultaneous LLM outage + Calendar outage combos to safest read-only intents.

---

## 11. Privacy

MVP §14 table is canonical: LLM input is **utterance text** for classification — **MUST NOT** ship raw calendar blobs on the default path. Future explicit opt-in expansion requires spec bump.

---

## 12. Observability & improvement loop

- **Structured logging** with `requestId` — Appendix A P1.
- **`failure_logs` + `audit_log`** — immutable narrative of trust.
- **Improvement job** (F4 summary): batch failure grouping + optional LLM pattern digest + markdown report + optional ntfy — authenticated job route.

---

## 13. Non-functional requirements (summary)

Included fully in **Appendix A**. Highlights:

| Area | Requirement |
|------|----------------|
| Idempotency | Safe double-submit semantics for listed intents + optional HTTP idempotency key store — Phase X & F1-F5 P3 |
| Security regression tests | Expanded red-team `/voice` abuses adapt auth model (cookie session + optional internal header for automation only) |
| Parser properties | Prefer property tests “parser never throws” — F5 Phase 2 |
| Chaos adapters | Behind env + non-prod guards — PHASE_X X1 |

---

## 14. Phased delivery

Follow MVP §18 build order (**core loop**, then Fax Effect viral layer). Hardening tranche Appendix A SHOULD land after stable OAuth → calendar mutations → confirmations path (per `CALADDIN_MASTER_INDEX.md` sequencing).

Parser golden utterances hardened §16.1 **MUST** be extended with coverage for **`CREATE_EVENT`**, **`QUERY_CALENDAR`**, **`UNDO`** before declaring classification module frozen.

Success criteria KPI table — MVP §17.

---

## 15. Known limitations & intentional MVP gaps

Merged from hardened §Known bugs & Master Index realism:

| # | Gap | MVP handling |
|---|-----|----------------|
| 1 | Pivot external channel delivery undefined | Fax-style copy **manual send** hardened §17 bullet 2 — disclose to testers |
| 2 | ntfy public topic header exposure (`x-api-key`) | Accept prototype risk; roadmap: private relay or signed action URLs |
| 3 | Tier derivation for imported remote events coarse | Tier 2 default + explicit promotion hardened §17 bullet 4 |
| 4 | Phase X DDL not all merged | Operational truth = migrations; Appendix tables backlog explicit |

---

## Appendix A — Hardening & quality backlog (F1–F5 + Phase-X alignment)

Derived from [CALADDIN_F1F5_TOP1PCT_PROMPT.md](./CALADDIN_F1F5_TOP1PCT_PROMPT.md) — **adapt auth language** per §3.

**Phase 0 discovery:** Maintain `REPO_STATE.md`-style inventories before large refactors (test counts, route map, schemas, adapters).

**P1 Request tracing:** UUID `requestId` at ingress (`voice` / primary API), propagate through parser → orchestrator → persistence → notifications; echo `x-request-id`.

**P2 Dependency degradation:** Implement §10 matrix with explicit logging; never bare 500s for benign external faults.

**P3 Mutation idempotency:** PROTECT_BLOCK dedupe markers; FLUSH_RANGE skip canceled; MODIFY_EVENT noop detect; UPSERT intents naturally idempotent — F1 prompt detail.

**P4 Confirmation re-exec failures:** Separate **approval accepted** vs **handler execution failure** auditing + notifications.

**P5 Profile schema versioning:** `schemaVersion` + `migratePolicy` path.

**F1 Decision journaling:** CLI `scripts/log-decision.ts` + `DECISIONS.md` upkeep.

**F2 Contract tests:** Parser ↔ orchestrator, orchestrator ↔ DB writers, IntentResult handlers — update enumerations beyond legacy “8 intents”.

**F3 Pre-launch simulation:** Synthetic calendars + enumerated assertion cases (`tests/simulation/...`) — regenerate expected intents incl. **`QUERY_CALENDAR`**, **`CREATE_EVENT`**, **`UNDO`**.

**F4 Improvement loop endpoint:** Authenticated **`POST /jobs/improvement-loop`** + pure analysis helpers.

**F5 Security suite:** UUID validation, oversized bodies, polite destructive coercion, replay & double-approve confirmations, sanitized 500 surfaces, sliding rate limit harness, timing-safe equality for API paths — remap “no API key” attack to **`401` unauthorized session** analogue for `/voice`.

**Phase X merges:** Operational ordering diagrams, adapters, **`compensation_queue`**, **`idempotency_keys`**, shadow infra (staging only), telemetry queries.

---

## Appendix B — Vision snapshot (non-normative)

Caladdin is the **trust-first scheduling substrate** evolving toward broader life orchestration ONLY after retention & delight proven — distilled from Product Vision §What Caladdin is / Fax Effect / network compounding narratives. Pricing & distant agent layers remain **non-binding** vs this MVP tech contract.

---

## Appendix C — Agent workflow

Agents **MUST** read, in order, before substantive code changes ([CURSOR_PROMPT_TEMPLATE.md](./CURSOR_PROMPT_TEMPLATE.md)):

1. [`PROCESS_RULES.md`](../../PROCESS_RULES.md)  
2. [`AGENT_GUIDELINES.md`](../../AGENT_GUIDELINES.md)  
3. [`PROGRESS.md`](../../PROGRESS.md)  
4. [`docs/spec/CALADDIN_MASTER_INDEX.md`](./CALADDIN_MASTER_INDEX.md)  

Then **THIS** document replaces piecemeal hopping across scattered spec drafts.

---

## Appendix D — Related files index

| File | Role |
|------|------|
| [CALADDIN_MVP_SPEC_V4_1.md](./CALADDIN_MVP_SPEC_V4_1.md) | Product MVP |
| [CALADDIN_INTENT_ARCHITECTURE_V5.md](./CALADDIN_INTENT_ARCHITECTURE_V5.md) | Intent catalog & ADR excerpts |
| [CALADDIN_F1F5_TOP1PCT_PROMPT.md](./CALADDIN_F1F5_TOP1PCT_PROMPT.md) | Executable hardening playbook |
| [CALADDIN_MASTER_INDEX.md](./CALADDIN_MASTER_INDEX.md) | Legacy meta index (still useful for infra checklist) |
| [../archive/CALADDIN_HARDENED_SPEC_V2_1.md](../archive/CALADDIN_HARDENED_SPEC_V2_1.md) | Deep implementation detail |
| [../archive/CALADDIN_PHASE_X_HARDENING.md](../archive/CALADDIN_PHASE_X_HARDENING.md) | Ops & reliability |
| [../archive/CALADDIN_HARDENED_SPEC_DELTAS.md](../archive/CALADDIN_HARDENED_SPEC_DELTAS.md) | Formal state machine & safety deltas |

---

**End of consolidated technical specification.**
