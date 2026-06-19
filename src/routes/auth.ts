import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import {
  getAuthUrl,
  signOAuthState,
  verifyOAuthState,
  exchangeCodeForTokens,
  getGoogleUserInfo,
  persistTokensForUser,
  getOAuthClientForUser,
} from '../services/auth_service.js';
import { upsertUser, ensureDefaultPolicy } from '../db/users.js';
import { createSession, setSessionCookie, clearSessionCookie, destroySession, requireSession } from '../middleware/session.js';
import { generateCsrfToken, setCsrfCookie, clearCsrfCookie } from '../middleware/csrf.js';
import { auditSensitiveOperation } from '../middleware/sensitiveAudit.js';
import { logger } from '../logger.js';
import {
  checkPilotCapacity,
  isExistingPilotUser,
  isKillSwitchActive,
} from '../pilot/pilot_controls.js';
import { importEventsFromGCal } from '../services/calendar_api.js';
import { startOfWeek, addDays } from '../core/date-utils.js';
import { recordUsageEvent } from '../db/usage_events.js';
import { getPlatformInviteByToken, markPlatformInviteAccepted } from '../db/platform_invites.js';
import { clearPendingEmailConfirmation } from '../db/conversation-context.js';

export const authRouter = Router();

function buildOAuthState(extra?: Record<string, string>): string {
  const payload = Buffer.from(JSON.stringify({
    nonce: randomBytes(12).toString('base64url'),
    ...extra,
  })).toString('base64url');
  return signOAuthState(payload);
}

function parseOAuthState(state: string): Record<string, string> {
  const parts = state.split('.');
  if (parts.length !== 2) return {};
  try {
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

authRouter.get('/start', (req: Request, res: Response) => {
  const ref = req.query.ref as string | undefined;
  const token = req.query.token as string | undefined;
  const invite = req.query.invite as string | undefined;
  const mode = req.query.mode as string | undefined;
  const state = buildOAuthState({
    ref: ref ?? '',
    token: token ?? '',
    invite: invite ?? '',
    mode: mode === 'signup' || mode === 'signin' ? mode : '',
  });
  res.redirect(getAuthUrl(state));
});

authRouter.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    if (typeof code !== 'string' || typeof state !== 'string' || !verifyOAuthState(state)) {
      res.status(400).send('Invalid OAuth state. Please try signing in again.');
      return;
    }

    const stateMeta = parseOAuthState(state);
    const tokens = await exchangeCodeForTokens(code);
    const info = await getGoogleUserInfo(tokens.access_token);

    const existing = await isExistingPilotUser(info.email);
    if (!existing) {
      if (isKillSwitchActive()) {
        res.redirect('/?pilot=paused');
        return;
      }
      const cap = await checkPilotCapacity();
      if (!cap.allowed) {
        res.redirect('/?pilot=full');
        return;
      }
    }

    const user = await upsertUser({ email: info.email, display_name: info.name });
    await persistTokensForUser(user.id, tokens);
    await ensureDefaultPolicy(user.id);
    try {
      await clearPendingEmailConfirmation(user.id);
    } catch (clearErr) {
      logger.warn('clearPendingEmailConfirmation failed during sign-in', {
        userId: user.id,
        error: clearErr instanceof Error ? clearErr.message : String(clearErr),
      });
    }

    const cal = await getOAuthClientForUser(user.id);
    if (cal) {
      try {
        const weekStart = startOfWeek(new Date());
        const endOfNextWeek = addDays(weekStart, 14);
        await importEventsFromGCal(cal, user.id, weekStart.toISOString(), endOfNextWeek.toISOString());
      } catch (importErr) {
        logger.warn('Initial calendar import failed during sign-in', {
          userId: user.id,
          error: importErr instanceof Error ? importErr.message : String(importErr),
        });
      }
    }

    if (stateMeta.ref === 'scheduling' && stateMeta.token) {
      await recordUsageEvent(user.id, 'post_accept_signup', { sessionToken: stateMeta.token });
    }
    if (stateMeta.invite) {
      await markPlatformInviteAccepted(stateMeta.invite, user.id);
      await recordUsageEvent(user.id, 'platform_invite_signup', { inviteToken: stateMeta.invite });
    }

    const sessionToken = await createSession(user.id, user.email);
    setSessionCookie(res, sessionToken);
    setCsrfCookie(res, generateCsrfToken());
    res.redirect('/?welcome=1');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('OAuth callback failed', {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).send('Calendar connection failed. Please try again.');
  }
});

authRouter.delete('/session', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const token = req.cookies?.caladdin_session;
  if (token) await destroySession(token);
  await auditSensitiveOperation(req, session.userId, 'LOGOUT', 'success');
  clearSessionCookie(res);
  clearCsrfCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireSession, (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string; email: string } }).session;
  res.json({ userId: session.userId, email: session.email });
});
