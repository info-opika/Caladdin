# Caladdin scheduling agent architecture (v4)

## Overview

POST `/voice` supports two execution paths:

| Path | When | Pipeline |
|------|------|----------|
| **Agent** | `agentEnabledFor(userId)` | `runSchedulingAgent` → tools → SSE or JSON |
| **Legacy** | Everyone else | Haiku `mapVoiceUtteranceToIntent` → orchestrator |

The legacy Haiku classifier remains in the codebase but is **not** invoked for agent-enabled users.

## Feature flags

| Variable | Effect |
|----------|--------|
| `CALADDIN_AGENT_ENABLED=1` | Agent path for **all** users |
| `CALADDIN_AGENT_PILOT_USERS` | Comma-separated user UUIDs — agent path for listed users only (works with `CALADDIN_AGENT_ENABLED=0`) |

Helper: `agentEnabledFor(userId)` in `src/config.ts` — returns true when either condition matches.

## Pilot procedure

1. **Pick pilot users** — internal testers with stable Google OAuth + policy rows.
2. **Set env on Render** (or local `.env`):
   ```env
   CALADDIN_AGENT_ENABLED=0
   CALADDIN_AGENT_PILOT_USERS=<uuid-1>,<uuid-2>
   ```
3. **Deploy** and verify pilot user gets agent replies (check `agentRounds` / `agentToolCalls` in JSON or SSE `done` event).
4. **Compare behavior** — run the side-by-side harness (tests only):
   ```bash
   npm test -- tests/agent/classifier-vs-agent-pilot.test.ts
   ```
5. **Expand** — add UUIDs to `CALADDIN_AGENT_PILOT_USERS` or flip `CALADDIN_AGENT_ENABLED=1` for full rollout.
6. **Rollback** — remove user from pilot list or set `CALADDIN_AGENT_ENABLED=0`; legacy Haiku path resumes instantly.

## SSE streaming

When the client sends `Accept: text/event-stream` or `stream: true`:

- Agent users: tokens stream from the agent reply; `done` payload includes `agentRounds` and `agentToolCalls`.
- Legacy users: orchestrator `messageToUser` is chunked into SSE tokens (stub stream).

## Side-by-side comparison harness

`tests/agent/classifier-vs-agent-pilot.test.ts` documents expected behavioral differences between the legacy classifier and the agent for key prompts. It does **not** dual-run in production — tests only.

Scenarios covered:

- **"book a slot on my calendar"** — agent asks a clarifying question; classifier may emit `RESOLVE_MANUAL`.
- **OFFER_SPECIFIC / unknown invitee** — agent uses `lookup_user` + `send_invite` with honesty metadata.
- **PROTECT_BLOCK duplicate** — agent returns `alreadyProtected` without re-asking.

## Honesty rules

The agent system prompt and tool executors enforce honesty (no false success claims, host-only invite framing, etc.). See `tests/agent/agent-harness.test.ts`.
