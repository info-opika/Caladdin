# Monitoring setup — Render log drain and alerts

Step-by-step guide to operationalize [LOG_SHIPPING.md](./LOG_SHIPPING.md) (P1-12). Complete this once per environment (staging, then production).

**Prerequisites:** Caladdin deployed on Render with services `caladdin`, `caladdin-session-expiry`, `caladdin-reminders`.

---

## Overview

| Step | What | Outcome |
|------|------|---------|
| 1 | Create aggregator dataset | Destination for JSON logs |
| 2 | Attach Render log drains | Web + cron logs forwarded |
| 3 | Verify JSON parsing | Fields `ts`, `level`, `message` indexed |
| 4 | Create 5xx / error monitor | Alert when error rate > 1% / 5 min |
| 5 | Smoke test + checklist | On-call can triage by `requestId` |

---

## Step 1 — Choose a log aggregator

Pick **one** provider. Both paths below are copied from LOG_SHIPPING.md with UI navigation filled in.

### Option A: Datadog (recommended if you already use Datadog)

1. Sign in to [Datadog](https://app.datadoghq.com/).
2. **Organization Settings** → **API Keys** → create or copy an **API key** (not Application key).
3. Note your site: `datadoghq.com` (US) or `datadoghq.eu` (EU).

### Option B: Axiom

1. Sign in to [Axiom](https://app.axiom.co/).
2. Create dataset: **Datasets** → **New dataset** → name `caladdin-prod` (and `caladdin-staging` if needed).
3. **Settings** → **Ingest tokens** → create token with ingest permission.

---

## Step 2 — Attach Render log drains

Repeat for **each** service: `caladdin`, `caladdin-session-expiry`, `caladdin-reminders`.

### 2a. Open log stream settings

1. [Render Dashboard](https://dashboard.render.com/) → select workspace.
2. Open service **caladdin** (web).
3. Go to **Integrations** → **Log Streams**  
   *(or **Observability** → **Log Drains** depending on Render UI version)*.
4. Click **Add log drain** / **Connect**.

### 2b. Datadog drain URL

Use HTTP intake (replace `KEY` and site if EU):

```
https://http-intake.logs.datadoghq.com/api/v2/logs?dd-api-key=KEY&ddsource=render&service=caladdin-web
```

| Service | `service=` query param |
|---------|------------------------|
| caladdin (web) | `caladdin-web` |
| caladdin-session-expiry | `caladdin-session-expiry` |
| caladdin-reminders | `caladdin-reminders` |

Paste URL into Render → save. Render begins forwarding stdout/stderr.

### 2c. Axiom drain

1. Axiom → dataset → **Settings** → **Ingest** → copy **HTTP ingest URL**.
2. Render → **Add log drain** → paste URL + bearer token per Axiom instructions.

### 2d. Confirm drain status

- Render log drain status should show **Connected** / **Active**.
- Trigger a deploy or `curl $CALADDIN_BASE_URL/health` to generate log lines.

---

## Step 3 — Verify JSON parsing

Caladdin logs one JSON object per line (`src/logger.ts`).

### Sample line (paste into aggregator test parser)

```json
{"ts":"2026-06-07T12:00:00.000Z","level":"error","message":"Voice orchestration failed","service":"caladdin-web","env":"production","requestId":"550e8400-e29b-41d4-a716-446655440000","userId":"6ba7b810-9dad-11d1-80b4-00c04fd430c8","error":"timeout"}
```

### Datadog pipeline

1. **Logs** → **Configuration** → **Pipelines**.
2. Add **JSON** parser on `message` if lines arrive as raw string; otherwise `@message` may already be parsed.
3. Map facets:
   - `@timestamp` ← `ts`
   - `status` ← `level`
   - `@message` ← `message`
4. **Indexes** → ensure `requestId`, `userId`, `intent`, `service`, `env` are facets.

**Search test:**

```
service:caladdin-web level:error
```

You should see the test line or real errors within minutes of deploy.

### Axiom query test

```apl
['caladdin-prod']
| where level == "error"
| take 10
```

---

## Step 4 — Create alert: 5xx error rate > 1% (5 min)

Goal: page when server errors exceed **1% of requests** over a **5-minute** window.

> **Note:** App logs today may not include `@http.status_code` on every line. Use Render HTTP metrics for the denominator until response middleware logs status codes (see LOG_SHIPPING.md). Below: Datadog log-based + Render fallback.

### 4a. Datadog monitor (log-based)

1. **Monitors** → **New Monitor** → **Logs**.
2. **Define the query:**
   - **a (errors):** `logs("service:caladdin-web status:error").rollup("count").last("5m")`  
     *(adjust if you index `level:error` instead of `status`)*
   - **b (total):** use Render integration metric or approximate with `logs("service:caladdin-web").rollup("count").last("5m")` if no HTTP metric yet.
3. **Set alert conditions:** Formula `(a / b) * 100` → **above 1** for **5 minutes**.
4. **Notify:** Slack `#caladdin-alerts` or PagerDuty on-call.
5. Name: `Caladdin — 5xx/error rate > 1% (5m)`.

**Supplemental monitors (recommended):**

| Monitor | Query / condition |
|---------|-------------------|
| Health check failing | Render metric: health check failures > 0 for 3 min |
| Cron job failure | `service:caladdin-session-expiry status:error` count > 0 in 15m |
| Reminder job failure | `service:caladdin-reminders status:error` count > 0 in 1h |

### 4b. Axiom monitor

1. **Monitors** → **New monitor**.
2. Query:

```apl
['caladdin-prod']
| where level == "error" or message contains "503"
| summarize error_count = count() by bin(_time, 5m)
```

3. Threshold: tune `error_count` against expected traffic; pair with Render **Metrics → 5xx rate** for denominator.
4. Notification: email, Slack webhook, or PagerDuty.

### 4c. Render-native fallback (until drain is live)

1. **caladdin** → **Metrics** → watch **5xx** rate.
2. **Notifications** (workspace or service) → enable:
   - Deploy failed
   - Instance failed health checks ( `/health` → 503 when `db: error` )
3. Document on-call: Dashboard → **Logs** is backup if drain fails.

---

## Step 5 — Health check correlation

`/health` returns **503** when Postgres is unreachable or Redis is unreachable (when `REDIS_URL` is set in production).

After setup, confirm alerts fire on:

- Repeated `GET /health` → 503 from Render health checker
- Log lines: `"message":"Session expiry job error"` or `"Voice orchestration failed"`

**Manual test (staging only):** temporarily set invalid `SUPABASE_URL` in a staging service, confirm 503 + alert, revert immediately.

---

## Step 6 — End-to-end smoke test

Run in order after drains and monitors are saved:

1. **Generate info log:** `curl -s "$CALADDIN_BASE_URL/health"` → 200.
2. **Generate error log (safe):** `curl -s -X POST "$CALADDIN_BASE_URL/jobs/reminders" -H "x-api-key: wrong"` → 401 (may not log as error; optional).
3. **Aggregator:** search `service:caladdin-web` — see lines within 2–5 min.
4. **Facets:** filter `requestId:*` on a voice request log if available.
5. **Monitor:** confirm monitor status **OK** (not alerting).
6. **Cron:** wait for next `caladdin-session-expiry` run (15 min) — verify logs in same index with `service:caladdin-session-expiry`.

---

## Completion checklist

Copy into your ops ticket when done:

- [ ] Log drain attached to **caladdin** (web)
- [ ] Log drain attached to **caladdin-session-expiry**
- [ ] Log drain attached to **caladdin-reminders**
- [ ] JSON parsing verified with sample line from LOG_SHIPPING.md
- [ ] Facets indexed: `requestId`, `userId`, `intent`, `service`, `env`
- [ ] 5xx / error-rate monitor active (> 1% over 5m or equivalent)
- [ ] Health-check / cron failure supplemental monitors configured
- [ ] Notification routed to on-call (Slack / PagerDuty)
- [ ] On-call runbook link: this file + [ROLLBACK.md](./ROLLBACK.md)
- [ ] Render Dashboard → Logs documented as fallback

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| No logs in aggregator | Render drain status; URL/token; EU vs US Datadog site |
| Logs as plain text, not JSON | Add JSON pipeline; confirm app uses `logger.info/error` not `console.log` |
| Monitor never fires | Denominator too low; use Render 5xx metric; lower threshold in staging |
| Cron logs missing | Separate drain per cron service; `CALADDIN_SERVICE_NAME` defaults to `caladdin` on web only |
| Too many false positives | Exclude health-check noise; require 5m sustained breach |

---

## Related docs

- [LOG_SHIPPING.md](./LOG_SHIPPING.md) — log format and alert recipes (reference)
- [DEPLOYMENT.md](../DEPLOYMENT.md) — env vars, cron schedules
- [ROLLBACK.md](./ROLLBACK.md) — rollback + post-incident health validation
