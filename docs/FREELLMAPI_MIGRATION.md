# Caladdin → FreeLLMAPI Open Routing Migration

Caladdin’s scheduling agent uses **FreeLLMAPI** with **open model routing** — no pinned model. The router selects the best available tool-capable model per request via `auto:caladdin-agent` (with `auto:smart` escalation on loop failure).

## Environment

```env
FREELLMAPI_BASE_URL=https://freellmapiserver-production-df6f.up.railway.app/v1
FREELLMAPI_API_KEY=<your key>
CALADDIN_AGENT_MODEL=auto:caladdin-agent
# Optional escalation on loop failure:
# CALADDIN_AGENT_ESCALATION_MODEL=auto:smart
```

Never commit `FREELLMAPI_API_KEY`. Set it in local `.env` and the Render Dashboard.

## Render deploy checklist

1. Connect the GitHub repo and apply `render.yaml` (Blueprint → select file).
2. In **Environment** for the `caladdin-core` group, set secrets (`sync: false`):
   - `FREELLMAPI_API_KEY` — from your FreeLLMAPI provider
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
   - `CALADDIN_BASE_URL` — your Render HTTPS URL (e.g. `https://caladdin.onrender.com`)
   - `CALADDIN_API_KEY`, `SESSION_SECRET`, `OAUTH_STATE_SECRET`, `RESEND_API_KEY`
   - Optional: `REDIS_URL`
3. Non-secret vars are pre-set in `render.yaml`:
   - `FREELLMAPI_BASE_URL`, `CALADDIN_AGENT_MODEL=auto:caladdin-agent`
   - `CALADDIN_AGENT_ENABLED=1`, `NODE_ENV=production`, `PORT=3000`
4. Set `GOOGLE_REDIRECT_URI` and `CALADDIN_BASE_URL` to match your Render service URL.
5. Apply Supabase migrations: `npm run db:push` from your machine.
6. Deploy and verify: `GET /health` returns 200.

Remove any legacy `ANTHROPIC_API_KEY` from Render if still present.

## Self-hosting FreeLLMAPI (optional)

Only if you run your own FreeLLMAPI instance (e.g. on Railway):

- Routing profile `caladdin-agent`: strategy **smartest**, tool-capable models only
- `FREELLMAPI_CONTEXT_HANDOFF=on_model_switch` on the FreeLLMAPI server
- Provider keys (Google, Groq, etc.) on the FreeLLMAPI side

Caladdin on Render only needs `FREELLMAPI_BASE_URL` + `FREELLMAPI_API_KEY` pointing at your hosted API.

## Caladdin architecture

| Layer | Mechanism |
|-------|-----------|
| Prefilters | `agent-prefilter.ts` — protect block, query, scheduling link, off-topic before LLM |
| Tool pruning | `selectToolsForUtterance` — 13 tools → 4–6 per turn; escalation uses full core 6 |
| Session stickiness | `X-Session-Id: caladdin:{userId}:{requestId}` on every agent round |
| Quality guards | `tool-call-guard`, `honesty-validator`, malformed-args retry |
| Escalation | One final attempt with `auto:smart` + `CORE_TOOL_NAMES` if primary loop exhausts |
| Streaming | SSE `completeStream()` on `/voice` stream requests; falls back to non-streaming on error |

## Manual eval — `scripts/agent-eval.mjs`

15-utterance checklist for sign-off:

```bash
# In-process (needs FREELLMAPI_API_KEY + npm run build first)
node scripts/agent-eval.mjs --direct

# Against local server (needs session cookie)
SESSION_COOKIE="sid=..." node scripts/agent-eval.mjs

# Against Render
CALADDIN_BASE_URL=https://your-app.onrender.com SESSION_COOKIE="sid=..." node scripts/agent-eval.mjs
```

## Live integration tests

Skipped unless both `FREELLMAPI_LIVE=1` and `FREELLMAPI_API_KEY` are set:

```bash
FREELLMAPI_LIVE=1 FREELLMAPI_API_KEY=sk-... npm test -- tests/agent/freellmapi-live.test.ts
```

Optional: `FREELLMAPI_LIVE_REPEATS=3` runs each scenario 3× (open-routing variance check). Pass if tool behavior is correct (not same `routedVia`).

## Observability

`command_logs.agent_trace` stores per request:

- `requestedModel`, `routedViaRounds`, `fallbackAttempts`, `toolSubset`, `prefilterBypass`

Tune upstream routing from `routedVia` failure telemetry.
