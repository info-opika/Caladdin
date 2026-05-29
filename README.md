# Caladdin

Scheduling assistant that speaks Cal-language and protects your calendar.

**Spec:** [caladdin_spec_docs/CALADDIN_FULL_APPLICATION_SPEC.md](caladdin_spec_docs/CALADDIN_FULL_APPLICATION_SPEC.md)  
**Build plan:** [caladdin_spec_docs/CALADDIN_BUILD_PLAN.md](caladdin_spec_docs/CALADDIN_BUILD_PLAN.md)

## Quick start

```bash
cp .env.example .env
# Fill Supabase, Google OAuth, Anthropic, CALADDIN_API_KEY

# Database (recommended — Supabase CLI)
npm install
npx supabase login
npm run db:link          # project fkikgtxhndkricywkirw
npm run db:push          # apply all migrations

npm run build:web
npm run dev
```

See **[supabase/README.md](supabase/README.md)** for full DB workflow.

Manual alternative: paste each file in `supabase/migrations/` into Supabase SQL Editor (in order).

Open http://localhost:3000

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | API + hot reload |
| `npm test` | Vitest suite |
| `npm run build` | TypeScript + web build |
| `npm run log-decision` | Append to DECISIONS.md |
| `npm run db:link` | Link repo to Supabase cloud project |
| `npm run db:push` | Apply pending migrations to cloud |
| `npm run db:status` | Show migration status |

## Architecture

Express API → Parser (Anthropic tool use) → Orchestrator → 10 intent handlers → Supabase + Google Calendar.

## Deploy

See [DEPLOY.md](DEPLOY.md) and [SMOKE_TEST.md](SMOKE_TEST.md).
