# Caladdin PRD v4 — Rollout & Phase 10 Sign-off

**Branch:** `v4`  
**Last updated:** 2026-06-17 (M5 production readiness)

## Milestone status

| Milestone | Scope | Test evidence |
|-----------|--------|---------------|
| M0 | Grant OAuth docs + `validate-production` | `src/validate-production.ts`, `docs/DEPLOYMENT.md` |
| M1 | `invitee_lookup`, `checkSpecificSlot`, `slotSource`, OpenAPI | `tests/unit/invitee-lookup.test.ts`, `tests/unit/check-specific-slot.test.ts`, `tests/integration/next-slots-mutual.test.ts`, `tests/integration/check-slot-api.test.ts` |
| M2 | Agent tools + loop + harness + SSE | `tests/agent/*.test.ts`, `tests/agent/voice-agent-stream.test.ts` |
| M3 | Grant-aware invite tools + host notifications | `tests/agent/m3-invite-tools.test.ts` |
| M4 | `CALADDIN_AGENT_ENABLED` + pilot users | `tests/agent/agent-config.test.ts`, `tests/agent/classifier-vs-agent-pilot.test.ts` |
| M5 | Observability, docs, Phase 10 checklist | `tests/e2e/v4-phase10-checklist.test.ts`, migration `034_v4_agent_trace.sql` |

## Phase 10 E2E checklist

Automated in `tests/e2e/v4-phase10-checklist.test.ts`:

| # | Scenario | Status | Evidence |
|---|----------|--------|----------|
| 1 | Host chat create event (agent, mocked) | ✅ Auto | Agent harness + checklist #1 |
| 2 | Invite unknown → honest messaging | ✅ Auto | `invitee_lookup` + M3 tools |
| 3 | Invite known user mutual slots | ✅ Auto | `invitee_lookup` + `next-slots-mutual` |
| 4 | PROTECT_BLOCK no re-ask | ✅ Auto | `lc10-wave1-v4`, `parsed-intent-validator-no-reask` |
| 5 | Grant routes exist | ✅ Auto | `invite-grant.test.ts` + OpenAPI |
| 6 | Session/grant expiry job | ✅ Auto | `session-expiry.test.ts`, `jobs-routes.test.ts` |
| 7 | Kill switch | ✅ Auto | `pilot-controls.test.ts` |
| 8 | validate-production | ✅ Auto | Checklist #8 (test env skip) |
| 9 | Agent pilot flags | ✅ Auto | `agent-config.test.ts` |
| 10 | Agent harness scenarios | ✅ Auto | `agent-harness.test.ts` |

Manual (not automated in CI):

- Grant OAuth callback on production Google Console (`{BASE_URL}/s/grant/callback`)
- Mobile + desktop home layout smoke
- Staging deploy with `CALADDIN_AGENT_ENABLED=0` then pilot cohort enable

## Observability — `command_logs.agent_trace`

Migration `034_v4_agent_trace.sql` adds JSON:

```json
{
  "model": "claude-sonnet-4-20250514",
  "rounds": 2,
  "totalLatencyMs": 1840,
  "tools": [
    { "name": "lookup_user", "latencyMs": 42, "ok": true },
    { "name": "send_invite", "latencyMs": 310, "ok": true }
  ]
}
```

Written on agent-path `/voice` requests via `updateCommandLogAgentTrace`.

## Deploy steps (staging / production)

1. Merge `v4` → deploy Render web service
2. Apply migrations: `npm run db:apply` (includes `031`, `034`)
3. Register grant OAuth redirect in Google Console
4. Set env: `CALADDIN_AGENT_ENABLED=0`, add pilot IDs to `CALADDIN_AGENT_PILOT_USERS`
5. Run `npm test` + `npm run build` in CI
6. Enable agent for pilot cohort; monitor `agent_trace` tool error rate

## Production blockers

- Google Console grant redirect must be registered for each environment
- Supabase migrations `031` and `034` must be applied before agent observability works
- Production deploy requires Render secrets (`CALADDIN_BASE_URL`, API keys) — not automated from this repo
