# Caladdin → FreeLLMAPI Open Routing Migration

Caladdin’s scheduling agent uses **FreeLLMAPI on Railway** with **open model routing** — no pinned model. The router selects the best available tool-capable model per request via `auto:caladdin-agent` (with `auto:smart` escalation on loop failure).

## Environment

```env
FREELLMAPI_BASE_URL=https://freellmapiserver-production-df6f.up.railway.app/v1
FREELLMAPI_API_KEY=<from Railway Dashboard → Keys>
CALADDIN_AGENT_MODEL=auto:caladdin-agent
# Optional:
# CALADDIN_AGENT_ESCALATION_MODEL=auto:smart
```

Never commit `FREELLMAPI_API_KEY`. Set it in local `.env` and Render Dashboard.

## Railway FreeLLMAPI setup (manual)

1. **Routing profile `caladdin-agent`** (Dashboard → Routing Profiles):
   - Strategy: **smartest** (sort by `intelligence_rank`)
   - Include only tool-capable models (Gemini, GPT-OSS 120B, Llama 3.3 70B, etc.)
   - Exclude small / non-tool models

2. **Railway env on FreeLLMAPI server:**
   - `FREELLMAPI_CONTEXT_HANDOFF=on_model_switch` — injects prior turns when the router fails over to a different model mid-loop

3. **Provider keys:** Google, Groq (+ Cerebras if available) so the open router has multiple backends.

4. **Verify:**
   ```bash
   curl -s https://freellmapiserver-production-df6f.up.railway.app/api/ping
   curl -s -H "Authorization: Bearer $FREELLMAPI_API_KEY" \
     "$FREELLMAPI_BASE_URL/models" | head
   ```

## Caladdin architecture

| Layer | Mechanism |
|-------|-----------|
| Prefilters | `agent-prefilter.ts` — protect block, query, scheduling link, off-topic before LLM |
| Tool pruning | `selectToolsForUtterance` — 13 tools → 4–6 per turn |
| Session stickiness | `X-Session-Id: caladdin:{userId}:{requestId}` on every agent round |
| Quality guards | `tool-call-guard`, `honesty-validator`, malformed-args retry |
| Escalation | One final attempt with `auto:smart` if primary loop exhausts rounds |

## Render deploy

Update Render env group with `FREELLMAPI_*` vars (see `render.yaml`). Remove any legacy `ANTHROPIC_API_KEY`.

## Live eval (optional)

```bash
FREELLMAPI_LIVE=1 npm test -- tests/agent/freellmapi-live.test.ts
```

Runs harness scenarios 3× against Railway open routing; pass if tool behavior is correct (not same `routedVia`).

## Observability

Agent trace logs per request: `requestedModel`, `routedViaRounds`, `fallbackAttempts`, `toolSubset`, `prefilterBypass`.

Tune the `caladdin-agent` profile weekly from `routedVia` failure telemetry.
