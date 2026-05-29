import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import {
  getAuthUrl,
  signOAuthState,
  verifyOAuthState,
  exchangeCodeForTokens,
  getGoogleUserInfo,
  persistTokensForUser,
} from '../services/auth_service.js';
import { upsertUser, ensureDefaultPolicy } from '../db/users.js';
import { createSession, setSessionCookie, clearSessionCookie, destroySession, requireSession } from '../middleware/session.js';
import { logger } from '../logger.js';

export const authRouter = Router();

authRouter.get('/start', (_req: Request, res: Response) => {
  const payload = randomBytes(16).toString('base64url');
  const state = signOAuthState(payload);
  res.redirect(getAuthUrl(state));
});

authRouter.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    if (typeof code !== 'string' || typeof state !== 'string' || !verifyOAuthState(state)) {
      res.status(400).send('Invalid OAuth state. Please try signing in again.');
      return;
    }
    const tokens = await exchangeCodeForTokens(code);
    const info = await getGoogleUserInfo(tokens.access_token);
    const user = await upsertUser({ email: info.email, display_name: info.name });
    await persistTokensForUser(user.id, tokens);
    await ensureDefaultPolicy(user.id);
    const sessionToken = createSession(user.id, user.email);
    setSessionCookie(res, sessionToken);
    res.redirect('/?welcome=1');
  } catch (err) {
    logger.error('OAuth callback failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).send('Calendar connection failed. Please try again.');
  }
});

authRouter.delete('/session', requireSession, (req: Request, res: Response) => {
  const token = req.cookies?.caladdin_session;
  if (token) destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireSession, (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string; email: string } }).session;
  res.json({ userId: session.userId, email: session.email });
});
