# Voice Pipeline — Hot Path & Async Patterns

## Request flow (`POST /voice`)

```
requireSession → validate → rate limit
  → parallel prefetch (policy, conversation context, pending email, OAuth client)
  → parseIntent (LLM — dominant latency)
  → email confirmation gate
  → orchestrate → handler
```

## Parallelized prefetch (implemented)

Independent I/O runs concurrently before `parseIntent`:

| Fetch | Purpose |
|-------|---------|
| `getPolicy` | User scheduling policy |
| `getConversationContext` | Multi-turn slot/email state |
| `getPendingEmailConfirmation` | Email gate bypass |
| `getOAuthClientForUser` | GCal client for orchestrator |

This removes ~3 sequential DB round-trips from the critical path.

## What stays sequential (by design)

1. **`parseIntent`** — Anthropic LLM call; cannot parallelize with utterance-dependent work.
2. **`handleEmailConfirmationGate`** — Depends on parsed intent + context.
3. **`orchestrate`** — Safety, rate limits, and handler dispatch depend on parsed intent.

## Slot generation (`generateSlots`)

When `OFFER_SPECIFIC` or public booking runs slot generation:

- `listEvents` (DB), host GCal free/busy, and recipient free/busy run in **parallel** via `Promise.all`.
- GCal free/busy uses **`getCachedBusyFromGCal`** (5-min in-memory TTL, in-flight dedupe).

Target: P95 slot generation &lt; 500ms with warm cache.

## Future async upgrades (not blocking MVP)

- Return `202` + webhook/SSE for long-running intents (large flush ranges).
- Edge-cache static booking pages; voice remains origin-bound for auth.
- Redis-backed free/busy cache when `REDIS_URL` is set (Postgres fallback path exists via rate_limits pattern).
