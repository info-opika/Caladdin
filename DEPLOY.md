# Deployment

## Environment variables

All variables from `.env.example` are required in production.

- `CALADDIN_BASE_URL` — HTTPS public URL (e.g. https://caladdin.app)
- `GOOGLE_REDIRECT_URI` — `{CALADDIN_BASE_URL}/auth/callback`
- `SESSION_SECRET` — strong random string
- `CALADDIN_API_KEY` — for ntfy Action callbacks to `/confirm/*`

## Hosting options

1. **Render / Railway** — Node web service, `npm run build && npm start`
2. **Split** — API on Render; static `web/dist` on Vercel/Cloudflare Pages (proxy API routes)

## Production checklist

- [ ] HTTPS only
- [ ] Migrations applied
- [ ] Google OAuth consent screen published (or test users added)
- [ ] `GET /health` monitored
- [ ] ntfy Action URLs point to `{CALADDIN_BASE_URL}/confirm/.../approve` with `x-api-key` header
- [ ] Cookie `Secure` flag (automatic when `NODE_ENV=production`)

## Compensation worker

Runs in-process every 60s via `startCompensationWorker()`. For scale, extract to a cron job calling an internal endpoint.
