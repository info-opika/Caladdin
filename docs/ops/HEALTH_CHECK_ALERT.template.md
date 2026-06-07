# Health check alert template

Copy into Datadog, Axiom, or Render Notifications. Adjust thresholds for staging vs production traffic.

---

## Monitor 1 — Render health check failing

**Type:** Render native (recommended primary)

| Field | Value |
|-------|-------|
| Service | `caladdin` (or `caladdin-staging`) |
| Condition | Health check failures > 0 for **3 consecutive minutes** |
| Health path | `/health` |
| Notify | `#caladdin-alerts` / PagerDuty on-call |

**Meaning:** Postgres unreachable, or Redis required but down (`REDIS_URL` set in production).

**Runbook:** [ROLLBACK.md](./ROLLBACK.md) → verify Supabase status → rollback deploy if recent release.

---

## Monitor 2 — HTTP 503 from app logs

**Type:** Log monitor (Datadog)

**Query:**

```
logs("service:caladdin-web @message:*health* status:error").rollup("count").last("5m") > 3
```

Or broader:

```
logs("service:caladdin-web status:error").rollup("count").last("5m") > 10
```

| Field | Value |
|-------|-------|
| Threshold | > 3 health-related errors in 5m (tune per environment) |
| Notification | Same as Monitor 1 |

---

## Monitor 3 — Error rate > 1% (5 min window)

**Type:** Log or metric composite

**Datadog formula monitor:**

- **a:** `logs("service:caladdin-web status:error").rollup("count").last("5m")`
- **b:** Render HTTP request count (if integrated) OR log line count proxy
- **Alert when:** `(a / b) * 100 > 1` for 5 minutes

**Axiom APL (starting point):**

```apl
['caladdin-prod']
| where level == "error"
| summarize error_count = count() by bin(_time, 5m)
| where error_count > 5
```

Pair with Render **Metrics → 5xx rate** until response status is logged on every request.

---

## Monitor 4 — Cron job failure

| Service | Condition |
|---------|-----------|
| `caladdin-session-expiry` | Any `level:error` log in 15m window |
| `caladdin-reminders` | Any `level:error` log in 1h window |

**Datadog:**

```
logs("service:caladdin-session-expiry status:error").rollup("count").last("15m") > 0
```

---

## Test procedure (staging)

1. `node scripts/verify-log-drain.mjs --base-url $CALADDIN_BASE_URL`
2. Confirm health logs appear in aggregator within 5 minutes.
3. Temporarily break staging DB URL → confirm Monitor 1 fires → **revert immediately**.
4. Document alert IDs in ops ticket.

---

## Related

- [MONITORING_SETUP.md](./MONITORING_SETUP.md)
- [LOG_SHIPPING.md](./LOG_SHIPPING.md)
