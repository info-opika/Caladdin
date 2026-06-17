import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireSession } from '../middleware/session.js';
import { generateCsrfToken, setCsrfCookie, clearCsrfCookie } from '../middleware/csrf.js';
import { auditSensitiveOperation } from '../middleware/sensitiveAudit.js';
import { listSessionsForHost } from '../db/scheduling_sessions.js';
import { ensureDefaultPolicy } from '../db/users.js';
import { hostAcceptProposal, hostIgnoreProposal } from '../services/proposal_host_actions.js';
import { logger } from '../logger.js';
import { insertFeedback } from '../db/feedback.js';
import { getUserProfileView, updateUserProfile, getUserById } from '../db/users.js';
import { exportUserData, deleteUserAccount } from '../db/user_data.js';
import { getOAuthClientForUser } from '../services/auth_service.js';
import { buildIcsCalendar } from '../services/ics.js';
import { listWeekEventsWithSource } from '../db/events.js';
import { WeekCalendarResponseSchema } from '../core/adts.js';

export const apiRouter = Router();

const TIME_RE = /^\d{2}:\d{2}$/;

const ProfilePatchSchema = z.object({
  timezone: z.string().min(1).max(64).optional(),
  privacyMode: z.enum(['private', 'trusted', 'open']).optional(),
  workingHoursStart: z.string().regex(TIME_RE).optional(),
  workingHoursEnd: z.string().regex(TIME_RE).optional(),
  defaultMeetingLengthMinutes: z.number().int().min(5).max(480).optional(),
  meetingTimePreference: z.enum(['morning', 'afternoon', 'flexible']).optional(),
  setupFieldAnswered: z.string().min(1).max(64).optional(),
});

const UserDataDeleteSchema = z.object({
  confirm: z.literal('DELETE'),
});

apiRouter.get('/csrf-token', requireSession, (req: Request, res: Response) => {
  const token = generateCsrfToken();
  setCsrfCookie(res, token);
  res.json({ csrfToken: token });
});

apiRouter.get('/user/data', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  try {
    const data = await exportUserData(session.userId);
    if (!data.user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    await auditSensitiveOperation(req, session.userId, 'GDPR_EXPORT', 'success');
    res.json(data);
  } catch {
    await auditSensitiveOperation(req, session.userId, 'GDPR_EXPORT', 'error');
    res.status(500).json({ error: 'Could not export user data' });
  }
});

apiRouter.delete('/user/data', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string; email: string } }).session;
  const parsed = UserDataDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Send { "confirm": "DELETE" } to permanently delete your account' });
    return;
  }

  try {
    await auditSensitiveOperation(req, session.userId, 'GDPR_DELETE', 'requested', {
      email: session.email,
    });
    await deleteUserAccount(session.userId);
    clearCsrfCookie(res);
    res.json({ ok: true, deleted: true });
  } catch {
    await auditSensitiveOperation(req, session.userId, 'GDPR_DELETE', 'error');
    res.status(500).json({ error: 'Could not delete account' });
  }
});

apiRouter.get('/profile', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const calendarConnected = Boolean(await getOAuthClientForUser(session.userId));
  const profile = await getUserProfileView(session.userId, calendarConnected);
  if (!profile) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(profile);
});

apiRouter.patch('/profile', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const parsed = ProfilePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid profile payload', details: parsed.error.flatten() });
    return;
  }
  if (
    !parsed.data.timezone &&
    !parsed.data.privacyMode &&
    !parsed.data.workingHoursStart &&
    !parsed.data.workingHoursEnd &&
    parsed.data.defaultMeetingLengthMinutes == null &&
    !parsed.data.meetingTimePreference &&
    !parsed.data.setupFieldAnswered
  ) {
    res.status(400).json({ error: 'Provide timezone, privacyMode, working hours, meeting length, or setup field' });
    return;
  }

  try {
    const updated = await updateUserProfile(session.userId, {
      timezone: parsed.data.timezone,
      privacyMode: parsed.data.privacyMode,
      workingHoursStart: parsed.data.workingHoursStart,
      workingHoursEnd: parsed.data.workingHoursEnd,
      defaultMeetingLengthMinutes: parsed.data.defaultMeetingLengthMinutes,
      meetingTimePreference: parsed.data.meetingTimePreference,
      appendSetupFieldAnswered: parsed.data.setupFieldAnswered,
      markOnboardingComplete: Boolean(parsed.data.timezone || parsed.data.privacyMode),
    });
    updated.calendarConnected = Boolean(await getOAuthClientForUser(session.userId));
    await auditSensitiveOperation(req, session.userId, 'PROFILE_UPDATE', 'success', {
      fields: Object.keys(parsed.data).filter((k) => parsed.data[k as keyof typeof parsed.data] !== undefined),
    });
    res.json(updated);
  } catch {
    await auditSensitiveOperation(req, session.userId, 'PROFILE_UPDATE', 'error');
    res.status(500).json({ error: 'Could not save profile' });
  }
});

apiRouter.get('/sessions', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const sessions = await listSessionsForHost(session.userId);
  res.json({ sessions });
});

apiRouter.post('/sessions/:token/proposals/:index', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const token = String(req.params.token ?? '');
  const index = Number(req.params.index);
  const action = req.body?.action;
  if (action !== 'accept' && action !== 'ignore') {
    res.status(400).json({ error: 'action must be accept or ignore' });
    return;
  }
  if (!Number.isInteger(index) || index < 0) {
    res.status(400).json({ error: 'invalid index' });
    return;
  }
  try {
    const profile = await ensureDefaultPolicy(session.userId);
    const oauth = await getOAuthClientForUser(session.userId);
    if (!oauth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (action === 'ignore') {
      const r = await hostIgnoreProposal(token, index, session.userId);
      if (!r.ok) {
        const status = r.code === 'not_found' ? 404 : r.code === 'bad_index' ? 400 : 409;
        res.status(status).json({ error: r.code, message: r.message });
        return;
      }
      res.json({
        ok: true,
        idempotent: 'idempotent' in r && r.idempotent === true,
        message: r.message,
      });
      return;
    }

    const r = await hostAcceptProposal(token, index, session.userId, oauth, profile);
    if (!r.ok) {
      const status =
        r.code === 'not_found' ? 404
          : r.code === 'bad_index' ? 400
            : r.code === 'race_lost' || r.code === 'in_progress' ? 409
              : r.code === 'needs_clarification' ? 422
                : 502;
      res.status(status).json({ error: r.code, message: r.message });
      return;
    }
    res.json({
      ok: true,
      idempotent: 'idempotent' in r && r.idempotent === true,
      googleEventId: 'googleEventId' in r ? r.googleEventId : undefined,
      message: r.message,
    });
  } catch (err) {
    logger.error('proposal action failed', { err: String(err), token });
    res.status(500).json({ error: 'failed' });
  }
});

apiRouter.get('/calendar/week', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const startParam = typeof req.query.start === 'string' ? req.query.start : undefined;
  if (startParam) {
    const parsed = new Date(startParam);
    if (Number.isNaN(parsed.getTime())) {
      res.status(400).json({ error: 'Invalid start parameter — use an ISO 8601 date' });
      return;
    }
  }
  try {
    const week = await listWeekEventsWithSource(session.userId, startParam);
    const payload = WeekCalendarResponseSchema.parse(week);
    res.json(payload);
  } catch (err) {
    logger.error('calendar week failed', { err: String(err) });
    res.status(500).json({ error: 'Could not load calendar week' });
  }
});

apiRouter.get('/calendar.ics', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  const user = await getUserById(session.userId);
  const sessions = await listSessionsForHost(session.userId);

  const events = sessions
    .filter((s) => s.status === 'confirmed' && s.selected_slot)
    .map((s) => ({
      uid: `caladdin-session-${s.token}@caladdin.app`,
      summary: s.host_name ? `Meeting with ${s.host_name}` : 'Caladdin booking',
      description: s.context ?? undefined,
      start: s.selected_slot!.start,
      end: s.selected_slot!.end,
      status: 'CONFIRMED' as const,
    }));

  const ics = buildIcsCalendar(events, user?.display_name ?? user?.email ?? 'Caladdin');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="caladdin.ics"');
  res.send(ics);
});

export const feedbackRouter = Router();

feedbackRouter.post('/', requireSession, async (req: Request, res: Response) => {
  const session = (req as Request & { session: { userId: string } }).session;
  await insertFeedback({
    userId: session.userId,
    rating: req.body.rating,
    stars: req.body.stars,
    intent: req.body.intent,
    comment: req.body.comment,
  });
  await auditSensitiveOperation(req, session.userId, 'FEEDBACK', 'success');
  res.json({ ok: true });
});
