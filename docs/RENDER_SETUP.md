# Render setup — pilot testing users

Step-by-step to deploy Caladdin for up to **10 pilot users** (configurable via `MAX_PILOT_USERS`).

## Before you deploy

### 1. Apply database migrations

From your machine (with `.env` containing `SUPABASE_URL` and `SUPABASE_DB_PASSWORD`):

```bash
npm run db:push
```

Verify all migrations through `028_claim_scheduling_slot_atomic.sql` are applied:

```bash
npm run db:status
```

### 2. Google OAuth

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials:

1. Create or edit your OAuth 2.0 Client (Web application) — the same client ID/secret used for `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
2. Add **Authorized redirect URIs** (after first deploy you'll know the URL):

   ```
   https://<your-service>.onrender.com/auth/callback
   https://<your-service>.onrender.com/s/grant/callback
   ```

   - `/auth/callback` — host Google sign-in
   - `/s/grant/callback` — invitee calendar grant (`calendar.freebusy` only; see `src/services/invitee_oauth.ts`)

   <!-- Google Cloud Console checklist (manual — not automatable):
        [ ] Same Web OAuth client as host auth
        [ ] Authorized redirect URI: {CALADDIN_BASE_URL}/auth/callback
        [ ] Authorized redirect URI: {CALADDIN_BASE_URL}/s/grant/callback
        [ ] Save credentials; URIs must match CALADDIN_BASE_URL exactly
   -->

3. OAuth consent screen: add test users **or** publish the app for external users.

Optional env `INVITEE_GRANT_REDIRECT_URI` overrides the grant callback; default is `{CALADDIN_BASE_URL}/s/grant/callback`. If set in Render, it must match the URI registered in Google Console and what `invitee_oauth.ts` expects.

### 3. Generate production secrets

Run locally (PowerShell):

```powershell
# SESSION_SECRET and OAUTH_STATE_SECRET (32+ chars each)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])

# CALADDIN_API_KEY (24+ chars)
[Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

Save these — you'll paste them into Render once.

## Deploy on Render

1. Push this repo to GitHub.
2. Render Dashboard → **New** → **Blueprint**.
3. Connect the repo; Render reads [`render.yaml`](../render.yaml).
4. Open the **caladdin-core** environment group and set:

| Variable | Example / notes |
|----------|-----------------|
| `CALADDIN_BASE_URL` | `https://caladdin.onrender.com` (your web service URL, no trailing slash) |
| `GOOGLE_REDIRECT_URI` | `https://caladdin.onrender.com/auth/callback` |
| `INVITEE_GRANT_REDIRECT_URI` | *(optional)* `https://caladdin.onrender.com/s/grant/callback` — omit to derive from `CALADDIN_BASE_URL` |
| `GOOGLE_OAUTH_CLIENT_ID` | From Google Console |
| `GOOGLE_OAUTH_CLIENT_SECRET` | From Google Console |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `ANTHROPIC_API_KEY` | Anthropic dashboard |
| `SESSION_SECRET` | 32+ random chars (see above) |
| `OAUTH_STATE_SECRET` | 32+ random chars |
| `CALADDIN_API_KEY` | 24+ random chars (cron + confirm routes) |
| `RESEND_API_KEY` | Resend dashboard |

Defaults already set in Blueprint: `MAX_PILOT_USERS=10`, `CALADDIN_KILL_SWITCH=0`, `NODE_ENV=production`.

5. Deploy the web service. Wait for **Live** status.
6. Confirm health:

   ```bash
   curl https://<your-service>.onrender.com/health
   ```

   Expected: `"status":"ok","db":"ok"`.

7. Sign in with Google on the production URL and complete onboarding.

## Pilot user limits

- New sign-ups are capped at `MAX_PILOT_USERS` (default **10**).
- When full, users see the waitlist (`/?pilot=full`).
- Set `CALADDIN_KILL_SWITCH=1` in Render to pause all calendar mutations instantly.

## Cron jobs

Blueprint creates two cron jobs that call your web service with `x-api-key: CALADDIN_API_KEY`:

- **caladdin-session-expiry** — every 15 minutes
- **caladdin-reminders** — hourly

Ensure `CALADDIN_BASE_URL` and `CALADDIN_API_KEY` are set before cron runs.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Service won't start | Check Render logs — often missing env var or weak `SESSION_SECRET` |
| `GOOGLE_REDIRECT_URI must be...` | `GOOGLE_REDIRECT_URI` must exactly match `{CALADDIN_BASE_URL}/auth/callback` |
| `INVITEE_GRANT_REDIRECT_URI must be...` | Must match `{CALADDIN_BASE_URL}/s/grant/callback` (or unset to use default) |
| Invitee grant OAuth error from Google | Add `{CALADDIN_BASE_URL}/s/grant/callback` to **Authorized redirect URIs** on the same Web OAuth client |
| Sign-in loop | Migrations not applied (`sessions` table missing) or OAuth redirect mismatch |
| `db: "error"` on `/health` | Wrong `SUPABASE_URL` or service role key |
| UI 500 "App UI not found" | Rebuild Docker image (needs `web/dist` in image — fixed in Dockerfile) |

## Local Docker smoke test

```bash
docker build -t caladdin .
docker run --env-file .env -e NODE_ENV=production -e CALADDIN_BASE_URL=https://example.onrender.com -e GOOGLE_REDIRECT_URI=https://example.onrender.com/auth/callback -p 3000:3000 caladdin
curl http://localhost:3000/health
```

Use real HTTPS URLs in env even for local Docker if `NODE_ENV=production`.
