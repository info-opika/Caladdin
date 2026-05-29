# Repo State — 2026-05-27

## Test baseline

Run `npm test` after `npm install`. Target: all green.

## Routes

| Method | Path | Auth |
|--------|------|------|
| GET | /health | public |
| GET | /auth/start | public |
| GET | /auth/callback | public |
| DELETE | /auth/session | session |
| GET | /auth/me | session |
| POST | /voice | session |
| POST | /confirm/:token/approve | api-key |
| POST | /confirm/:token/reject | api-key |
| GET | /s/:token | public |
| POST | /s/:token/select | public |
| POST | /s/:token/propose | public |
| GET | /api/sessions | session |
| POST | /feedback | session |
| POST | /jobs/improvement-loop | api-key |

## Migrations

`supabase/migrations/001_core.sql` through `014_phase_x.sql`

## Handlers

`src/handlers/` — query-calendar, create-event, protect-block, flush-range, modify-event, offer-specific, shape-rules, gatekeep-rule, pivot-async, undo, resolve-manual
