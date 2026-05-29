# Caladdin Decision Log

## architecture — 2026-05-27

**Decision:** Zod as single source of truth for TypeScript types

**Reason:** Prevents type drift between compile-time and runtime validation

**Alternatives considered:** Separate interfaces (rejected: silent drift), io-ts (rejected: complexity)

## data model — 2026-05-27

**Decision:** Tier stored in Supabase, not Google Calendar

**Reason:** GCal has no native tier field. Description-based storage is fragile and visible to attendees

**Alternatives considered:** GCal description (rejected), GCal extended properties (rejected: extra scope)

## security — 2026-05-27

**Decision:** Session cookies for humans; CALADDIN_API_KEY for machine routes only

**Reason:** Matches CALADDIN_FULL_APPLICATION_SPEC §3; no API key setup for trusted MVP users

**Alternatives considered:** Per-user JWT (deferred to v2)

## architecture — 2026-05-27

**Decision:** Dual token storage: Supabase primary for google_tokens

**Reason:** Survives restarts; googleapis refresh via stored credentials

**Alternatives considered:** Disk-only (rejected for cloud deploy)

## architecture — 2026-05-27

**Decision:** requestId generated at route entry, propagated through orchestrator

**Reason:** Enables production tracing without distributed tracing infrastructure

**Alternatives considered:** Client correlation headers (rejected: browser clients)
