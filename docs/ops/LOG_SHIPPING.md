# Log shipping and observability (P1-12)

Caladdin emits **one JSON object per line** on stdout/stderr. Render captures these streams automatically; you can forward them to a log aggregator via a **log drain** or third-party integration.

## Log format

Each line is a single JSON object:

```json
{
  "ts": "2026-06-07T12:34:56.789Z",
  "level": "error",
  "message": "Voice orchestration failed",
  "service": "caladdin-web",
  "env": "production",
  "requestId": "abc-123",
  "userId": "uuid",
  "intent": "create_event"
}
```

| Field | Source |
|-------|--------|
| `ts` | ISO-8601 timestamp |
| `level` | `info`, `warn`, `error`, `debug` |
| `message` | Human-readable summary |
| `service` | `RENDER_SERVICE_NAME` or `CALADDIN_SERVICE_NAME` (default `caladdin`) |
| `env` | `NODE_ENV` |
| Other keys | Structured context (`requestId`, `userId`, errors, counts, etc.) |

Implementation: `src/logger.ts` — no sidecar required for basic shipping.

## Render log drain setup

1. **Render Dashboard** → your **caladdin** web service → **Integrations** → **Log Streams** (or **Observability** → add log drain).
2. Choose provider (Datadog, Axiom, Better Stack, etc.) and paste the ingest token / endpoint URL Render provides.
3. Apply the same drain to **cron** services (`caladdin-session-expiry`, `caladdin-reminders`) so job failures appear in the same index.
4. Confirm ingestion with a test deploy; search for `service:caladdin-web level:error`.

### Datadog

1. Datadog → **Integrations** → **Render** (or use HTTP log intake).
2. Log drain URL pattern: `https://http-intake.logs.datadoghq.com/api/v2/logs?dd-api-key=KEY&ddsource=render&service=caladdin`
3. Parse as JSON — map `@timestamp` ← `ts`, `status` ← `level`, `@message` ← `message`.
4. **Recommended facets**: `requestId`, `userId`, `intent`, `service`, `env`.

### Axiom

1. Axiom dataset e.g. `caladdin-prod`.
2. Render log drain → Axiom ingest URL with bearer token.
3. Query: `['caladdin-prod'] | where level == "error" | summarize count() by bin(_time, 5m)`.

## Sample log line (copy into aggregator “test parser”)

```json
{"ts":"2026-06-07T12:00:00.000Z","level":"error","message":"Voice orchestration failed","service":"caladdin-web","env":"production","requestId":"550e8400-e29b-41d4-a716-446655440000","userId":"6ba7b810-9dad-11d1-80b4-00c04fd430c8","error":"timeout"}
```

Expected parse: level=`error`, message=`Voice orchestration failed`, requestId present.

## Alert: 5xx error rate > 1%

Goal: page when server errors exceed **1% of requests** over a **5-minute** window.

### Datadog monitor

- **Metric/query** (log-based):
  - Errors: `logs("service:caladdin-web @http.status_code:5*").rollup("count").last("5m")`
  - Total: `logs("service:caladdin-web @http.status_code:*").rollup("count").last("5m")`
  - Or use ALB/Render request metrics if HTTP status is not in app logs yet.
- **Formula**: `100 * errors / total > 1`
- **Alert threshold**: `> 1` for 5 minutes
- **Notify**: PagerDuty / Slack `#caladdin-alerts`

### Axiom monitor

```apl
['caladdin-prod']
| where level == "error" or message contains "503"
| summarize error_count = count() by bin(_time, 5m)
| extend error_rate = error_count * 100.0 / 1000  // adjust denominator with request volume metric
```

Pair with Render **HTTP request metrics** or add middleware logging `statusCode` on response finish for accurate denominators.

### Render-native fallback

Until a drain is configured:

1. Render → **Metrics** → watch **5xx rate** on the web service.
2. **Notifications** → email/Slack when deploy fails or instance restarts repeatedly (health check failures on `/health`).

## Health check correlation

`/health` returns `503` when `db: "error"` (or Redis when `REDIS_URL` is set in production). Log drains should alert on:

- Repeated `GET /health` → 503 from Render health checker
- Log lines: `"message":"Session expiry job error"` or `"Voice orchestration failed"`

## Runbook checklist

- [ ] Log drain attached to web + cron services
- [ ] JSON parsing verified with sample line above
- [ ] 5xx / error-rate monitor active (> 1% over 5m)
- [ ] `requestId` indexed for incident triage
- [ ] On-call knows Render Dashboard → Logs is fallback if drain fails
