import { Router, Request, Response, NextFunction } from 'express';
import { DateTime } from 'luxon';
import { getPublicEventTypeByUsernameSlug } from '../db/event_types.js';
import { pickRoundRobinHost } from '../db/event_type_members.js';
import { ensureDefaultPolicy } from '../db/users.js';
import { generatePublicBookingSlots } from '../core/slot-scoring.js';
import { getOAuthClientForUser, getAuthService } from '../services/auth_service.js';
import { validateGuestIntake, type GuestIntakePayload } from '../db/booking_responses.js';
import { createCalendarEvent } from '../services/calendar.js';
import { checkOperationAllowed } from '../pilot/pilot_controls.js';
import { bookingSelectRateLimiter } from '../core/rate-limiter.js';
import { recordUsageEvent } from '../db/usage_events.js';

export const bookPublicRouter = Router();

function wantsJson(req: Request): boolean {
  if (req.query.data === '1' || req.query.format === 'json') return true;
  const accept = req.get('accept') ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

function parseGuestPayload(body: Record<string, unknown>): GuestIntakePayload | undefined {
  const guest = (body.guest ?? body) as GuestIntakePayload;
  if (!guest?.name && !guest?.email) return undefined;
  return guest;
}

function formatSlotLabel(slot: { start: string; end: string }, tz: string): string {
  const start = DateTime.fromISO(slot.start, { zone: tz });
  const end = DateTime.fromISO(slot.end, { zone: tz });
  if (!start.isValid) return slot.start;
  return `${start.toFormat('cccc, MMM d')} · ${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`;
}

async function resolveHostUserId(eventType: { id: string; userId: string; schedulingMode?: string }) {
  return eventType.schedulingMode === 'round_robin'
    ? await pickRoundRobinHost(eventType.id, eventType.userId)
    : eventType.userId;
}

async function loadSlotsForEventType(
  eventType: {
    id: string;
    userId: string;
    durationMinutes: number;
    availabilityRules: Record<string, unknown>;
    schedulingMode?: string;
  },
  hostTimezone: string,
  daysAhead = 14,
) {
  const hostUserId = await resolveHostUserId(eventType);
  const policy = await ensureDefaultPolicy(hostUserId);
  const cal = await getOAuthClientForUser(hostUserId);
  const slots = await generatePublicBookingSlots(
    hostUserId,
    { ...policy, timezone: hostTimezone ?? policy.timezone },
    eventType.durationMinutes,
    daysAhead,
    {
      cal,
      availabilityRules: eventType.availabilityRules,
    },
  );
  return { hostUserId, slots };
}

bookPublicRouter.get('/:username/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const username = String(req.params.username).toLowerCase();
    const slug = String(req.params.slug).toLowerCase();
    const result = await getPublicEventTypeByUsernameSlug(username, slug);

    if (!result) {
      if (!wantsJson(req)) {
        res.status(404).redirect('/404.html');
        return;
      }
      res.status(404).json({ error: 'Booking page not found' });
      return;
    }

    const { eventType, hostName, hostTimezone } = result;

    if (!wantsJson(req)) {
      const webRoot = req.app.get('webRoot') as string;
      res.sendFile('book.html', { root: webRoot }, (err) => {
        if (err) next(err);
      });
      return;
    }

    res.json({
      host: {
        name: hostName,
        username,
        timezone: hostTimezone,
      },
      eventType: {
        name: eventType.name,
        slug: eventType.slug,
        durationMinutes: eventType.durationMinutes,
        description: eventType.description,
        availabilityRules: eventType.availabilityRules,
        schedulingMode: eventType.schedulingMode,
      },
    });
  } catch (err) {
    next(err);
  }
});

bookPublicRouter.get('/:username/:slug/slots', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const username = String(req.params.username).toLowerCase();
    const slug = String(req.params.slug).toLowerCase();
    const result = await getPublicEventTypeByUsernameSlug(username, slug);

    if (!result) {
      res.status(404).json({ error: 'Booking page not found' });
      return;
    }

    const { eventType, hostTimezone } = result;
    const daysAhead = Math.min(parseInt(String(req.query.daysAhead ?? '14'), 10) || 14, 60);
    const { hostUserId, slots } = await loadSlotsForEventType(eventType, hostTimezone, daysAhead);

    res.json({
      hostUserId,
      timezone: hostTimezone,
      durationMinutes: eventType.durationMinutes,
      slots,
    });
  } catch (err) {
    next(err);
  }
});

bookPublicRouter.post('/:username/:slug/select', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const opGate = await checkOperationAllowed('calendar_write');
    if (!opGate.allowed) {
      res.status(503).json({ error: 'paused', message: opGate.message });
      return;
    }

    const username = String(req.params.username).toLowerCase();
    const slug = String(req.params.slug).toLowerCase();
    const rateKey = `book:${username}/${slug}`;

    const selectRate = await bookingSelectRateLimiter.check(rateKey);
    if (!selectRate.allowed) {
      res.status(429).json({
        error: 'rate_limit_exceeded',
        retryAfterMs: selectRate.retryAfterMs,
      });
      return;
    }

    const result = await getPublicEventTypeByUsernameSlug(username, slug);
    if (!result) {
      res.status(404).json({ error: 'Booking page not found' });
      return;
    }

    const { eventType, hostName, hostTimezone } = result;
    const guestPayload = parseGuestPayload(req.body as Record<string, unknown>);
    const guestError = validateGuestIntake(guestPayload);
    if (guestError) {
      res.status(400).json({ error: guestError });
      return;
    }

    const slotStart = typeof req.body.slotStart === 'string' ? req.body.slotStart : undefined;
    const { hostUserId, slots } = await loadSlotsForEventType(eventType, hostTimezone);
    const selected = slotStart ? slots.find((s) => s.start === slotStart) : null;

    if (!selected) {
      res.status(409).json({ error: 'slot_unavailable' });
      return;
    }

    const auth = getAuthService();
    const oauth = await auth.getClientForUser(hostUserId);
    if (!oauth) {
      res.status(503).json({ error: 'calendar_unavailable' });
      return;
    }

    const cal = oauth as import('googleapis').calendar_v3.Calendar;
    const guestEmail = guestPayload!.email.trim().toLowerCase();
    const summary = `${eventType.name} with ${guestPayload!.name.trim()}`;
    const created = await createCalendarEvent(cal, {
      summary,
      start: selected.start,
      end: selected.end,
      attendees: [guestEmail],
      description: eventType.description ?? undefined,
    });

    await recordUsageEvent(null, 'public_booking_confirmed', {
      username,
      slug,
      eventTypeId: eventType.id,
      googleEventId: created.id,
    });

    res.json({
      ok: true,
      slotLabel: formatSlotLabel(selected, hostTimezone),
      googleEventId: created.id,
      hostName,
    });
  } catch (err) {
    next(err);
  }
});
