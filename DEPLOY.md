# Deployment

**Full guide:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)  
**Render pilot checklist:** [docs/RENDER_SETUP.md](docs/RENDER_SETUP.md)

## Quick start (Render)

1. `npm run db:push` — apply Supabase migrations
2. Push to GitHub → Render **Blueprint** → [`render.yaml`](render.yaml)
3. Set secrets in `caladdin-core` env group (see RENDER_SETUP.md)
4. `CALADDIN_BASE_URL` = `https://<service>.onrender.com`
5. `GOOGLE_REDIRECT_URI` = `{CALADDIN_BASE_URL}/auth/callback`
6. Confirm `GET /health` returns `"status":"ok"`

## Production checklist

- [ ] Migrations applied (`001`–`028`)
- [ ] `SESSION_SECRET` / `OAUTH_STATE_SECRET` ≥ 32 chars
- [ ] Google OAuth redirect URI matches Render HTTPS URL
- [ ] `MAX_PILOT_USERS` set (default `10` in Blueprint)
- [ ] `GET /health` monitored

## Local production smoke test

```bash
npm run build
npm run start
# or Docker:
docker build -t caladdin .
docker run --env-file .env -p 3000:3000 caladdin
```
