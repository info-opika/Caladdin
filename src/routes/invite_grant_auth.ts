import { Router, Request, Response } from 'express';
import { DateTime } from 'luxon';
import {
  getSchedulingSessionByToken,
  type SchedulingSessionRow,
} from '../db/scheduling_sessions.js';
import {
  getGrantBySessionId,
  upsertInviteGrant,
  updateGrantPreferredWindow,
  type InviteCalendarGrantRow,
} from '../db/invite_calendar_grants.js';
import {
  exchangeInviteeGrantCode,
  getInviteeCalendarClient,
  getInviteeGrantAuthUrl,
  parseGrantState,
} from '../services/invitee_oauth.js';
import { getGoogleUserInfo } from '../services/auth_service.js';
import { getAuthService } from '../services/auth_service.js';
import { listBusyFromGCal } from '../services/calendar_api.js';
import { getPolicy } from '../db/users.js';
import { findMutualSlots } from '../services/mutual_slot_engine.js';
import { migratePolicy } from '../core/adts.js';

const router = Router();

function isExpired(session: SchedulingSessionRow): boolean {
  return new Date(session.expires_at) < new Date();
}

function parseHourFromTime(hhmm: string, fallback: number): number {
  const m = /^(\d{1,2}):/.exec(hhmm);
  if (!m) return fallback;
  const h = parseInt(m[1], 10);
  return Number.isFinite(h) ? h : fallback;
}

async function loadOpenSession(token: string): Promise<SchedulingSessionRow | null> {
  const session = await getSchedulingSessionByToken(token);
  if (!session || session.status !== 'pending' || isExpired(session)) return null;
  return session;
}

async function loadActiveGrant(session: SchedulingSessionRow): Promise<InviteCalendarGrantRow | null> {
  const grant = await getGrantBySessionId(session.id);
  if (!grant || grant.status !== 'active') return null;
  if (new Date(grant.expires_at) < new Date()) return null;
  if (!grant.oauth_access_token) return null;
  return grant;
}

function defaultSearchWindow(session: SchedulingSessionRow): { start: string; end: string } {
  const tz = session.host_timezone ?? 'America/Chicago';
  const start = DateTime.now().setZone(tz).plus({ hours: 1 });
  const end = start.plus({ days: 14 });
  return { start: start.toISO()!, end: end.toISO()! };
}

function grantSearchWindow(
  grant: InviteCalendarGrantRow,
  session: SchedulingSessionRow,
): { start: string; end: string } {
  if (grant.preferred_window_start && grant.preferred_window_end) {
    return { start: grant.preferred_window_start, end: grant.preferred_window_end };
  }
  return defaultSearchWindow(session);
}

async function computeMutualSlotsForSession(
  session: SchedulingSessionRow,
  grant: InviteCalendarGrantRow,
  excludeOffered = true,
): Promise<Array<{ start: string; end: string }>> {
  const tz = session.host_timezone ?? 'America/Chicago';
  const policy = migratePolicy(await getPolicy(session.host_user_id));
  const dayStart = parseHourFromTime(policy.workingHoursStart, 9);
  const dayEnd = parseHourFromTime(policy.workingHoursEnd, 18);
  const { start: windowStart, end: windowEnd } = grantSearchWindow(grant, session);

  const hostAuth = getAuthService();
  const hostCal = await hostAuth.getClientForUser(session.host_user_id);
  const inviteeCal = await getInviteeCalendarClient(grant);

  if (!hostCal || !inviteeCal) return [];

  const [hostBusy, inviteeBusy] = await Promise.all([
    listBusyFromGCal(hostCal, windowStart, windowEnd),
    listBusyFromGCal(inviteeCal, windowStart, windowEnd),
  ]);

  return findMutualSlots({
    hostBusy,
    inviteeBusy,
    windowStart,
    windowEnd,
    durationMinutes: session.duration_minutes ?? 30,
    timezone: tz,
    dayStartHour: dayStart,
    dayEndHour: dayEnd,
    excludeSlots: excludeOffered ? session.offered_slots ?? [] : [],
  });
}

async function handleGrantCallback(req: Request, res: Response, expectedToken?: string): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  if (!code || !state) {
    res.status(400).send('Missing OAuth parameters.');
    return;
  }

  const parsed = parseGrantState(state);
  if (!parsed) {
    res.status(400).send('Invalid or expired authorization. Please try again from your invite link.');
    return;
  }

  if (expectedToken && parsed.token !== expectedToken) {
    res.status(403).send('Authorization does not match this invite.');
    return;
  }

  const session = await loadOpenSession(parsed.token);
  if (!session) {
    res.status(404).send('This invite is no longer available.');
    return;
  }

  try {
    const tokens = await exchangeInviteeGrantCode(code);
    let inviteeEmail = session.invitee_email ?? undefined;
    try {
      const info = await getGoogleUserInfo(tokens.access_token);
      inviteeEmail = info.email;
    } catch {
      /* optional — grant still works without email */
    }

    await upsertInviteGrant({
      schedulingSessionId: session.id,
      inviteeEmail,
      oauthAccessToken: tokens.access_token,
      oauthRefreshToken: tokens.refresh_token,
      oauthExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    });
  } catch {
    res.redirect(`/s/${parsed.token}?grant=error`);
    return;
  }

  res.redirect(`/s/${parsed.token}?grant=connected`);
}

router.get('/s/:token/grant/start', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const session = await loadOpenSession(token);
  if (!session) {
    res.status(404).send('Invite not found or expired.');
    return;
  }
  res.redirect(getInviteeGrantAuthUrl(token));
});

router.get('/s/grant/callback', (req: Request, res: Response) => {
  void handleGrantCallback(req, res);
});

router.get('/s/:token/grant/callback', (req: Request, res: Response) => {
  void handleGrantCallback(req, res, String(req.params.token));
});

router.post('/s/:token/grant/window', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const session = await loadOpenSession(token);
  if (!session) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const grant = await loadActiveGrant(session);
  if (!grant) {
    res.status(403).json({ error: 'grant_required' });
    return;
  }

  const start = String(req.body.start ?? '');
  const end = String(req.body.end ?? '');
  if (!start || !end || new Date(end) <= new Date(start)) {
    res.status(400).json({ error: 'invalid_window' });
    return;
  }

  await updateGrantPreferredWindow(grant.id, { start, end });
  res.json({ ok: true });
});

router.get('/s/:token/grant/slots', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const session = await loadOpenSession(token);
  if (!session) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const grant = await loadActiveGrant(session);
  if (!grant) {
    res.status(403).json({ error: 'grant_required' });
    return;
  }

  const slots = await computeMutualSlotsForSession(session, grant);
  res.json({ ok: true, slots });
});

export default router;
export { computeMutualSlotsForSession, loadActiveGrant };
