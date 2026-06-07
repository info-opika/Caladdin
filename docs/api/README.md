# Caladdin API reference

Machine-readable spec: **[OPENAPI.yaml](./OPENAPI.yaml)** (OpenAPI 3.1).

## Route groups

| Prefix | Auth | Purpose |
|--------|------|---------|
| `/api/*` | Session cookie (`caladdin_session`) | Host profile, event types, session list |
| `/book/*` | None | Public booking page JSON metadata |
| `/s/*` | Guest action tokens (cancel/reschedule only) | Guest scheduling HTML + JSON lifecycle |
| `/jobs/*` | `x-api-key: CALADDIN_API_KEY` | Cron-triggered background jobs |

## Quick examples

### Public booking metadata

```bash
curl "$CALADDIN_BASE_URL/book/jane-doe/30-min-intro"
```

### Host event types (authenticated)

```bash
curl -b caladdin_session=$SESSION "$CALADDIN_BASE_URL/api/event-types"
```

### Cron job (staging)

```bash
curl -X POST "$CALADDIN_BASE_URL/jobs/reminders" \
  -H "x-api-key: $CALADDIN_API_KEY"
```

### Guest slot selection

```bash
curl -X POST "$CALADDIN_BASE_URL/s/$TOKEN/select" \
  -H "Content-Type: application/json" \
  -d '{"slotIndex":0,"guest":{"name":"Alex","email":"alex@example.com"}}'
```

## Related routes (not in OpenAPI scope)

These are documented in [DEPLOYMENT.md](../DEPLOYMENT.md) and the host SPA:

- `GET /health` — Render health check
- `/auth/*` — Google OAuth
- `/voice/*` — AI orchestration (session required)
- `/confirm/*` — Email confirmation actions (API key)
- `/waitlist/*`, `/invite/*`, `/feedback/*`

## Viewing the spec

- [Swagger Editor](https://editor.swagger.io/) — paste `OPENAPI.yaml`
- VS Code — OpenAPI extension preview
- `npx @redocly/cli preview-docs docs/api/OPENAPI.yaml`

## Source of truth

Route handlers live under `src/routes/`. Mount order is in `src/index.ts`.
