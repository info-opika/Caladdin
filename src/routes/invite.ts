import { Router, Request, Response } from 'express';
import { getPlatformInviteByToken } from '../db/platform_invites.js';

export const inviteRouter = Router();

inviteRouter.get('/:token', async (req: Request, res: Response) => {
  const invite = await getPlatformInviteByToken(String(req.params.token));
  if (!invite || new Date(invite.expires_at) < new Date()) {
    res.status(404).send('<h1>Invite not found or expired</h1>');
    return;
  }

  res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Join Caladdin</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem}
.btn{display:inline-block;margin-top:1rem;padding:.875rem 1.5rem;background:#d97706;color:#fff;text-decoration:none;border-radius:10px;font-weight:600}</style></head>
<body>
  <h1>You're invited to Caladdin</h1>
  <p>Talk to your calendar in plain English. Schedule meetings, protect your time, and skip the back-and-forth.</p>
  <a class="btn" href="/auth/start?invite=${invite.token}">Create your account with Google</a>
</body></html>`);
});
