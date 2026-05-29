# Supabase (Caladdin)

Database migrations live in `migrations/`. The CLI applies them in **filename order** (`001` → `014`).

**Remote project:** `fkikgtxhndkricywkirw` (from `SUPABASE_URL` in `.env`)

## One-time setup

```powershell
cd Caladdin
npm install

# Log in to Supabase (opens browser)
npx supabase login

# Link this repo to your cloud project
npm run db:link
# Enter database password when prompted (Supabase Dashboard → Project Settings → Database)
```

Link stores project metadata in `supabase/.temp/` (gitignored).

## Apply all migrations to cloud

**Option A — CLI (after login + link):**

```powershell
npx supabase login
npm run db:link
npm run db:push
```

**Option B — Direct apply (add `SUPABASE_DB_PASSWORD` to `.env`):**

```powershell
npm run db:apply
```

## Useful commands

| Command | What it does |
|---------|----------------|
| `npm run db:push` | Apply pending migrations to linked remote |
| `npm run db:status` | List local vs remote migration state |
| `npm run db:pull` | Pull remote schema as a new migration (use carefully) |
| `npm run db:reset` | **Local Docker only** — resets local DB and re-runs migrations |

## Migration order

1. `001_core.sql`
2. `002_google_tokens.sql`
3. `004_payload_hash.sql`
4. `007_scheduling_sessions.sql`
5. `008_feedback_logs.sql`
6. `011_usage_events.sql`
7. `013_clarification_frames.sql`
8. `014_phase_x.sql`

## Adding a new migration

```powershell
npx supabase migration new describe_your_change
# Edit the new file in migrations/, then:
npm run db:push
```

## Local Supabase (optional)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```powershell
npx supabase start   # local Postgres + Studio
npm run db:reset     # apply migrations locally
npx supabase stop
```

For MVP you can use **remote-only**: `db:link` + `db:push` without Docker.

## Why CLI vs manual SQL?

- **Repeatable** — same migrations on every machine and environment
- **Tracked** — Supabase records which migrations ran
- **Safer diffs** — `db diff` / `migration new` for schema changes
- **No copy-paste** — one command after link
