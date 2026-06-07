import { Router, Request, Response } from 'express';
import { DateTime } from 'luxon';
import {
  getSchedulingSessionByToken,
  claimSessionSlotForGcal,
  finalizeSessionAfterGcal,
  revertSessionClaim,
  appendProposedAlternative,
  cancelConfirmedSession,
  rescheduleConfirmedSession,
  GCAL_CLAIMING_SENTINEL,
  type SchedulingSessionRow,
} from '../db/scheduling_sessions.js';
import { upsertBookingResponse, validateGuestIntake, type GuestIntakePayload } from '../db/booking_responses.js';
import { enqueueRemindersForSession } from '../db/booking_reminders.js';
import {
  verifyGuestActionToken,
  signGuestActionToken,
  guestActionUrl,
} from '../core/guest-action-token.js';
import { getAuthService } from '../services/auth_service.js';
import { createCalendarEvent, updateCalendarEvent } from '../services/calendar.js';
import { gcalDeleteEvent } from '../services/gcal.js';
import { listEvents } from '../db/events.js';
import { getPolicy } from '../db/users.js';
import { sendHostBookingNotification } from '../services/notifications.js';
import { dispatchBookingWebhooks } from '../services/webhooks.js';
import { recordUsageEvent } from '../db/usage_events.js';
import { checkOperationAllowed } from '../pilot/pilot_controls.js';
import { bookingSelectRateLimiter } from '../core/rate-limiter.js';

const router = Router();

function isExpired(session: SchedulingSessionRow): boolean {
  return new Date(session.expires_at) < new Date();
}

function formatTimezoneLabel(tz: string): string {
  const sample = DateTime.now().setZone(tz);
  if (!sample.isValid) return tz.replace(/_/g, ' ');
  const short = sample.offsetNameShort;
  if (short) return short;
  return sample.toFormat('ZZZZ');
}

function formatSlotLabel(slot: { start: string; end: string }, tz: string): string {
  const start = DateTime.fromISO(slot.start, { zone: tz });
  const end = DateTime.fromISO(slot.end, { zone: tz });
  if (!start.isValid) return slot.start;
  const tzLabel = formatTimezoneLabel(tz);
  return `${start.toFormat('cccc, MMM d')} · ${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')} (${tzLabel})`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BOOKING_HEAD = `
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="theme-color" content="#d97706"/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Fraunces:wght@600&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="/tokens.css"/>
  <link rel="stylesheet" href="/booking.css"/>
`;

function guestActionLinksHtml(sessionToken: string): string {
  const cancelUrl = escapeHtml(guestActionUrl(sessionToken, 'cancel'));
  const rescheduleUrl = escapeHtml(guestActionUrl(sessionToken, 'reschedule'));
  return `
    <div class="booking-manage">
      <p class="booking-sub">Need to change plans?</p>
      <div class="booking-manage-actions">
        <a class="btn-secondary booking-manage-btn" href="${rescheduleUrl}">Reschedule</a>
        <a class="btn-secondary booking-manage-btn is-danger" href="${cancelUrl}">Cancel meeting</a>
      </div>
      <p class="booking-tz-note">Reminder emails include these links too.</p>
    </div>`;
}

function guestIntakePanelHtml(prefillEmail = ''): string {
  const emailValue = prefillEmail ? ` value="${escapeHtml(prefillEmail)}"` : '';
  return `
    <div id="guest-intake-panel" class="guest-intake-panel hidden" aria-labelledby="guest-intake-heading">
      <h2 id="guest-intake-heading">Almost there — your details</h2>
      <p class="booking-sub">We&apos;ll send a calendar invite to your email.</p>
      <p id="guest-intake-slot-label" class="guest-intake-slot"></p>
      <form id="guest-intake-form" novalidate>
        <label for="guest-name">Your name</label>
        <input type="text" id="guest-name" name="guestName" autocomplete="name" required />
        <label for="guest-email">Email</label>
        <input type="email" id="guest-email" name="guestEmail" autocomplete="email" required${emailValue} />
        <label for="guest-notes">Notes for your host (optional)</label>
        <textarea id="guest-notes" name="guestNotes" rows="2" placeholder="Anything helpful before you meet"></textarea>
        <div class="guest-intake-actions">
          <button type="submit" class="choose-btn">Confirm this time</button>
          <button type="button" id="guest-intake-cancel" class="btn-secondary">Back</button>
        </div>
      </form>
    </div>`;
}

function selectActionPayload(sessionToken: string) {
  return {
    cancelToken: signGuestActionToken(sessionToken, 'cancel'),
    rescheduleToken: signGuestActionToken(sessionToken, 'reschedule'),
    cancelUrl: guestActionUrl(sessionToken, 'cancel'),
    rescheduleUrl: guestActionUrl(sessionToken, 'reschedule'),
  };
}

function bookingShell(content: string, { title = 'Caladdin Booking', script = true, rootAttrs = '' }: { title?: string; script?: boolean; rootAttrs?: string } = {}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${BOOKING_HEAD}
  <title>${escapeHtml(title)}</title>
</head>
<body class="booking-page">
  <div class="booking-shell">
    <header class="booking-brand">
      <div class="booking-brand-mark" aria-hidden="true">C</div>
      <p class="booking-brand-name">Caladdin</p>
    </header>
    <div id="booking-root" ${rootAttrs}>${content}</div>
  </div>
  ${script ? '<script type="module" src="/booking.js"></script>' : ''}
</body>
</html>`;
}

function render404(): string {
  return bookingShell(`
    <div class="booking-empty">
      <h1>Link not found</h1>
      <p class="booking-sub">This link is invalid or expired. Please ask the sender for a new link.</p>
    </div>
  `, { title: 'Link not found', script: false });
}

function renderExpired(): string {
  return bookingShell(`
    <div class="booking-empty">
      <h1>This scheduling link has expired.</h1>
      <p class="booking-sub">Ask your host for a fresh link.</p>
    </div>
  `, { title: 'Link expired', script: false });
}

function renderPage(session: SchedulingSessionRow): string {
  const tz = session.host_timezone ?? 'America/Chicago';
  const host = session.host_name ?? 'Your host';
  const slots = session.offered_slots ?? [];
  const signupUrl = `/auth/start?ref=scheduling&token=${session.token}`;

  if (session.status === 'cancelled') {
    return bookingShell(`
      <div class="booking-empty">
        <h1>This meeting was cancelled.</h1>
        <p class="booking-sub">Ask ${escapeHtml(host)} for a new link if you&apos;d like to reschedule.</p>
      </div>
    `, { title: 'Meeting cancelled', script: false });
  }

  if (session.status === 'confirmed' && session.selected_slot) {
    const label = escapeHtml(formatSlotLabel(session.selected_slot, tz));
    return bookingShell(`
      <div class="booking-confirmed">
        <h1>You\u2019re all set.</h1>
        <p class="booking-sub">${label} — ${escapeHtml(host)} will see this on the calendar.</p>
        <p class="booking-sub">A calendar invite should follow.</p>
        ${guestActionLinksHtml(session.token)}
        <a class="cta" href="${signupUrl}">Create your Caladdin account</a>
      </div>
    `, { title: 'Booking confirmed', script: false });
  }

  if (isExpired(session)) return renderExpired();

  if (slots.length < 2) {
    const proposeSection = `
    <div class="booking-links">
      <a href="#" id="propose-toggle" aria-expanded="false">Suggest another time</a>
    </div>
    <div id="propose-panel" class="propose-panel hidden">
      <form id="propose-form">
        <label for="proposed-date">Preferred date</label>
        <input type="date" id="proposed-date" name="proposedDate" value="${DateTime.now().toISODate() ?? ''}" required />
        <label for="proposed-window">Time preference</label>
        <select id="proposed-window" name="proposedTimeWindow">
          <option value="morning">Morning</option>
          <option value="afternoon">Afternoon</option>
          <option value="evening">Evening</option>
          <option value="flexible" selected>Flexible</option>
        </select>
        <label for="proposed-note">Note (optional)</label>
        <textarea id="proposed-note" name="note" rows="2" placeholder="Any details for your host"></textarea>
        <div class="propose-actions">
          <button type="submit" class="choose-btn">Send suggestion</button>
          <button type="button" id="propose-cancel" class="btn-secondary">Cancel</button>
        </div>
      </form>
    </div>`;
    return bookingShell(`
      <div class="booking-empty">
        <h1>These options are no longer available.</h1>
        <p class="booking-sub">Ask your host for a fresh link.</p>
        <div id="booking-status" class="booking-status" role="status"></div>
        ${proposeSection}
      </div>
    `, { title: 'Options unavailable', rootAttrs: `data-token="${escapeHtml(session.token)}"` });
  }

  const hero = session.host_name
    ? `${host} found two thoughtful times for you.`
    : 'Two thoughtful times, picked for you.';
  const sub = session.host_name
    ? `${host} used Caladdin to avoid the calendar back-and-forth.`
    : 'Your host used Caladdin to avoid the calendar back-and-forth.';

  const cards = slots.slice(0, 2).map((s, i) => `
    <div class="card slot-card">
      <span class="slot-label">Option ${i + 1}</span>
      <p class="slot-time">${escapeHtml(formatSlotLabel(s, tz))}</p>
      <button type="button" class="choose-btn" data-index="${i}" aria-label="Choose option ${i + 1}">Choose this time</button>
    </div>`).join('');

  const inviteeLine = session.invitee_email
    ? `<p class="booking-invitee">Invitation for ${escapeHtml(session.invitee_email)}</p>`
    : '';

  const proposeSection = `
    <div class="booking-links">
      <a href="/s/${escapeHtml(session.token)}/calendar">View ${escapeHtml(host)}&apos;s calendar</a>
      <a href="#" id="propose-toggle" aria-expanded="false">Suggest another time</a>
    </div>
    <div id="propose-panel" class="propose-panel hidden">
      <form id="propose-form">
        <label for="proposed-date">Preferred date</label>
        <input type="date" id="proposed-date" name="proposedDate" value="${DateTime.now().toISODate() ?? ''}" required />
        <label for="proposed-window">Time preference</label>
        <select id="proposed-window" name="proposedTimeWindow">
          <option value="morning">Morning</option>
          <option value="afternoon">Afternoon</option>
          <option value="evening">Evening</option>
          <option value="flexible" selected>Flexible</option>
        </select>
        <label for="proposed-note">Note (optional)</label>
        <textarea id="proposed-note" name="note" rows="2" placeholder="Any details for your host"></textarea>
        <div class="propose-actions">
          <button type="submit" class="choose-btn">Send suggestion</button>
          <button type="button" id="propose-cancel" class="btn-secondary">Cancel</button>
        </div>
      </form>
    </div>`;

  return bookingShell(`
    <div class="booking-hero">
      <h1>${escapeHtml(hero)}</h1>
      <p class="booking-sub">${escapeHtml(sub)}</p>
      <p class="booking-sub">Pick one, or suggest another time.</p>
      <p class="booking-tz-note">Times shown in ${escapeHtml(formatTimezoneLabel(tz))} (${escapeHtml(tz.replace(/_/g, ' '))})</p>
    </div>
    ${inviteeLine}
    <div id="booking-status" class="booking-status" role="status"></div>
    <div class="slot-grid">${cards}</div>
    ${guestIntakePanelHtml(session.invitee_email ?? '')}
    ${proposeSection}
  `, { title: 'Pick a time', rootAttrs: `data-token="${escapeHtml(session.token)}"` });
}

function renderCancelPage(session: SchedulingSessionRow, actionToken: string): string {
  const tz = session.host_timezone ?? 'America/Chicago';
  const label = session.selected_slot
    ? escapeHtml(formatSlotLabel(session.selected_slot, tz))
    : 'your meeting';
  const rootAttrs = [
    `data-page="action"`,
    `data-token="${escapeHtml(session.token)}"`,
    `data-action="cancel"`,
    `data-action-token="${escapeHtml(actionToken)}"`,
  ].join(' ');

  return bookingShell(`
    <div class="booking-hero">
      <h1>Cancel this meeting?</h1>
      <p class="booking-sub">${label}</p>
      <p class="booking-sub">Your host will be notified and the calendar event will be removed.</p>
    </div>
    <div id="booking-status" class="booking-status" role="status"></div>
    <form id="action-form" class="action-panel">
      <button type="submit" class="choose-btn">Yes, cancel meeting</button>
    </form>
    <div class="booking-links">
      <a href="/s/${escapeHtml(session.token)}">Keep this meeting</a>
    </div>
  `, { title: 'Cancel meeting', rootAttrs });
}

function renderReschedulePage(session: SchedulingSessionRow, actionToken: string): string {
  const tz = session.host_timezone ?? 'America/Chicago';
  const slots = session.offered_slots ?? [];
  const current = session.selected_slot;
  const rootAttrs = [
    `data-page="action"`,
    `data-token="${escapeHtml(session.token)}"`,
    `data-action="reschedule"`,
    `data-action-token="${escapeHtml(actionToken)}"`,
  ].join(' ');

  const slotOptions = slots.slice(0, 2).map((s, i) => {
    const isCurrent =
      current?.start === s.start && current?.end === s.end;
    const disabled = isCurrent ? ' disabled' : '';
    const checked = !isCurrent && i === (current ? 1 : 0) ? ' checked' : '';
    return `
      <label class="action-slot-option">
        <input type="radio" name="slotIndex" value="${i}"${checked}${disabled} />
        <span>${escapeHtml(formatSlotLabel(s, tz))}${isCurrent ? ' (current)' : ''}</span>
      </label>`;
  }).join('');

  return bookingShell(`
    <div class="booking-hero">
      <h1>Pick a new time</h1>
      <p class="booking-sub">Choose one of the options below. Your host will be notified.</p>
    </div>
    <div id="booking-status" class="booking-status" role="status"></div>
    <form id="action-form" class="action-panel">
      <div class="action-slot-options">${slotOptions || '<p class="booking-sub">No alternate times available. Contact your host.</p>'}</div>
      <button type="submit" class="choose-btn"${slots.length < 1 ? ' disabled' : ''}>Confirm new time</button>
    </form>
    <div class="booking-links">
      <a href="/s/${escapeHtml(session.token)}">← Back to booking</a>
    </div>
  `, { title: 'Reschedule meeting', rootAttrs });
}

function renderInvalidActionLink(): string {
  return bookingShell(`
    <div class="booking-empty">
      <h1>This link is invalid or expired</h1>
      <p class="booking-sub">Use the latest link from your confirmation or reminder email.</p>
    </div>
  `, { title: 'Invalid link', script: false });
}

function renderCalendarAccessDenied(): string {
  return bookingShell(`
    <div class="booking-empty">
      <h1>Calendar view unavailable</h1>
      <p class="booking-sub">Your host has not shared their full calendar on this invite. Use the offered time options instead.</p>
    </div>
  `, { title: 'Calendar unavailable', script: false });
}

async function renderCalendarView(session: SchedulingSessionRow, res: Response): Promise<void> {
  const tz = session.host_timezone ?? 'America/Chicago';
  const now = DateTime.now().setZone(tz);
  const end = now.plus({ days: 14 });
  const events = await listEvents(session.host_user_id, now.toUTC().toISO()!, end.toUTC().toISO()!);

  const rows = events
    .filter((e) => e.status === 'confirmed')
    .map((e) => {
      const redacted = (e.tier ?? 2) <= 1;
      const label = redacted ? 'Busy' : e.title;
      const start = DateTime.fromISO(e.start, { zone: tz });
      return `<tr><td>${start.toFormat('ccc MMM d')}</td><td>${start.toFormat('h:mm a')}</td><td>${label}</td></tr>`;
    })
    .join('');

  res.send(bookingShell(`
    <div class="booking-hero">
      <h1>${escapeHtml(session.host_name ?? 'Host')}&apos;s availability</h1>
      <p class="booking-sub">Read-only view for the next two weeks. Private events show as Busy.</p>
    </div>
    <div class="calendar-table-wrap">
      <table class="calendar-table">
        <thead><tr><th scope="col">Day</th><th scope="col">Time</th><th scope="col">Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3">No events in this range</td></tr>'}</tbody>
      </table>
    </div>
    <div class="booking-links">
      <a href="/s/${escapeHtml(session.token)}">← Back to time options</a>
    </div>
  `, { title: `${session.host_name ?? 'Host'} availability`, script: false }));
}

router.get('/s/:token', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const session = await getSchedulingSessionByToken(token);
  if (!session) {
    res.status(404).type('html').send(render404());
    return;
  }
  res.type('html').send(renderPage(session));
});

router.get('/s/:token/cancel', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const actionToken = String(req.query.actionToken ?? '');
  if (!verifyGuestActionToken(token, 'cancel', actionToken)) {
    res.status(403).type('html').send(renderInvalidActionLink());
    return;
  }
  const session = await getSchedulingSessionByToken(token);
  if (!session || session.status !== 'confirmed' || !session.google_event_id) {
    res.status(404).type('html').send(render404());
    return;
  }
  res.type('html').send(renderCancelPage(session, actionToken));
});

router.get('/s/:token/reschedule', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const actionToken = String(req.query.actionToken ?? '');
  if (!verifyGuestActionToken(token, 'reschedule', actionToken)) {
    res.status(403).type('html').send(renderInvalidActionLink());
    return;
  }
  const session = await getSchedulingSessionByToken(token);
  if (!session || session.status !== 'confirmed' || !session.google_event_id) {
    res.status(404).type('html').send(render404());
    return;
  }
  res.type('html').send(renderReschedulePage(session, actionToken));
});

router.get('/s/:token/calendar', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const session = await getSchedulingSessionByToken(token);
  if (!session || isExpired(session)) {
    res.status(404).type('html').send(render404());
    return;
  }
  const policy = await getPolicy(session.host_user_id);
  if (policy?.shareAvailabilityOnInvite === false) {
    res.status(403).type('html').send(renderCalendarAccessDenied());
    return;
  }
  await renderCalendarView(session, res);
});

function parseGuestPayload(body: Record<string, unknown>): GuestIntakePayload | undefined {
  const guest = (body.guest ?? body) as GuestIntakePayload;
  if (!guest?.name && !guest?.email) return undefined;
  return guest;
}

router.post('/s/:token/select', async (req: Request, res: Response) => {
  const opGate = await checkOperationAllowed('calendar_write');
  if (!opGate.allowed) {
    res.status(503).json({ error: 'paused', message: opGate.message });
    return;
  }

  const token = String(req.params.token);

  const selectRate = await bookingSelectRateLimiter.check(token);
  if (!selectRate.allowed) {
    res.status(429).json({
      error: 'rate_limit_exceeded',
      retryAfterMs: selectRate.retryAfterMs,
    });
    return;
  }

  const session = await getSchedulingSessionByToken(token);
  if (!session) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const slotIndex = req.body.slotIndex as 0 | 1;
  const selected = session.offered_slots[slotIndex];

  if (session.status === 'confirmed' && session.selected_slot && session.google_event_id) {
    const same =
      session.selected_slot.start === selected?.start &&
      session.selected_slot.end === selected?.end;
    if (same && slotIndex === session.offered_slots.findIndex((s) => s.start === selected?.start)) {
      res.json({ ok: true, idempotent: true, actions: selectActionPayload(token) });
      return;
    }
    res.status(409).json({ error: 'already_confirmed' });
    return;
  }

  if (session.status !== 'pending' || !selected) {
    res.status(409).json({ error: 'unavailable' });
    return;
  }

  const guestPayload = parseGuestPayload(req.body as Record<string, unknown>);
  const guestError = validateGuestIntake(guestPayload);
  if (guestError) {
    res.status(400).json({ error: guestError });
    return;
  }

  try {
    await upsertBookingResponse({ sessionId: session.id, guest: guestPayload! });
  } catch {
    res.status(500).json({ error: 'guest_store_failed' });
    return;
  }

  const claimed = await claimSessionSlotForGcal({ token, slotIndex });
  if (!claimed) {
    const refreshed = await getSchedulingSessionByToken(token);
    if (refreshed?.status === 'confirmed') {
      res.json({ ok: true, idempotent: true, actions: selectActionPayload(token) });
      return;
    }
    res.status(409).json({ error: 'claim_failed' });
    return;
  }

  try {
    const auth = getAuthService();
    const oauth = await auth.getClientForUser(session.host_user_id);
    const cal = oauth as import('googleapis').calendar_v3.Calendar;
    const attendees = session.invitee_email
      ? [session.invitee_email]
      : guestPayload?.email
        ? [guestPayload.email.trim().toLowerCase()]
        : [];
    const created = await createCalendarEvent(cal, {
      summary: session.host_name ? `Meeting with ${session.host_name}` : 'Meeting',
      start: selected.start,
      end: selected.end,
      attendees,
    });

    const finalized = await finalizeSessionAfterGcal({ token, googleEventId: created.id });
    if (!finalized) {
      await gcalDeleteEvent(cal, created.id).catch(() => {});
      await revertSessionClaim(token);
      res.status(409).json({ error: 'finalize_failed' });
      return;
    }

    await sendHostBookingNotification({ hostUserId: session.host_user_id, sessionToken: token, kind: 'booked' });
    await dispatchBookingWebhooks(session.host_user_id, 'booking.confirmed', {
      sessionToken: token,
      sessionId: session.id,
      hostUserId: session.host_user_id,
      guestEmail: guestPayload?.email ?? session.invitee_email,
      slot: selected,
    }).catch(() => {});
    await recordUsageEvent(null, 'scheduling_slot_accepted', { token, slotIndex });

    const finalizedSession = await getSchedulingSessionByToken(token);
    if (finalizedSession) {
      await enqueueRemindersForSession(finalizedSession).catch(() => {});
    }

    res.json({ ok: true, actions: selectActionPayload(token) });
  } catch {
    await revertSessionClaim(token);
    res.status(502).json({ error: 'gcal_failed' });
  }
});

router.post('/s/:token/cancel', async (req: Request, res: Response) => {
  const opGate = await checkOperationAllowed('calendar_write');
  if (!opGate.allowed) {
    res.status(503).json({ error: 'paused', message: opGate.message });
    return;
  }

  const token = String(req.params.token);
  const actionToken = (req.body.actionToken ?? req.query.actionToken) as string | undefined;
  if (!verifyGuestActionToken(token, 'cancel', actionToken)) {
    res.status(403).json({ error: 'invalid_action_token' });
    return;
  }

  const session = await getSchedulingSessionByToken(token);
  if (!session) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (session.status === 'cancelled') {
    res.json({ ok: true, idempotent: true });
    return;
  }
  if (session.status !== 'confirmed' || !session.google_event_id) {
    res.status(409).json({ error: 'not_cancellable' });
    return;
  }

  try {
    const auth = getAuthService();
    const oauth = await auth.getClientForUser(session.host_user_id);
    const cal = oauth as import('googleapis').calendar_v3.Calendar;
    await gcalDeleteEvent(cal, session.google_event_id);
  } catch {
    res.status(502).json({ error: 'gcal_failed' });
    return;
  }

  const cancelled = await cancelConfirmedSession(token);
  if (!cancelled) {
    res.status(409).json({ error: 'cancel_failed' });
    return;
  }

  await sendHostBookingNotification({ hostUserId: session.host_user_id, sessionToken: token, kind: 'cancelled' });
  await dispatchBookingWebhooks(session.host_user_id, 'booking.cancelled', {
    sessionToken: token,
    sessionId: session.id,
    hostUserId: session.host_user_id,
    guestEmail: session.invitee_email,
    slot: session.selected_slot,
  }).catch(() => {});
  res.json({ ok: true });
});

router.post('/s/:token/reschedule', async (req: Request, res: Response) => {
  const opGate = await checkOperationAllowed('calendar_write');
  if (!opGate.allowed) {
    res.status(503).json({ error: 'paused', message: opGate.message });
    return;
  }

  const token = String(req.params.token);
  const actionToken = (req.body.actionToken ?? req.query.actionToken) as string | undefined;
  if (!verifyGuestActionToken(token, 'reschedule', actionToken)) {
    res.status(403).json({ error: 'invalid_action_token' });
    return;
  }

  const session = await getSchedulingSessionByToken(token);
  if (!session) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (session.status !== 'confirmed' || !session.google_event_id || !session.selected_slot) {
    res.status(409).json({ error: 'not_reschedulable' });
    return;
  }

  let newSlot = session.selected_slot;
  const slotIndex = req.body.slotIndex as number | undefined;
  if (slotIndex != null) {
    const candidate = session.offered_slots[slotIndex as 0 | 1];
    if (!candidate) {
      res.status(400).json({ error: 'invalid_slot' });
      return;
    }
    newSlot = candidate;
  } else if (req.body.start && req.body.end) {
    newSlot = {
      start: String(req.body.start),
      end: String(req.body.end),
      adjacentEventCount: 0,
      energyScore: 0.5,
      createsFragment: false,
    };
  } else {
    res.status(400).json({ error: 'slot_required' });
    return;
  }

  if (
    newSlot.start === session.selected_slot.start &&
    newSlot.end === session.selected_slot.end
  ) {
    res.json({ ok: true, idempotent: true });
    return;
  }

  try {
    const auth = getAuthService();
    const oauth = await auth.getClientForUser(session.host_user_id);
    const cal = oauth as import('googleapis').calendar_v3.Calendar;
    const attendees = session.invitee_email ? [session.invitee_email] : [];
    await updateCalendarEvent(cal, session.google_event_id, {
      summary: session.host_name ? `Meeting with ${session.host_name}` : 'Meeting',
      start: newSlot.start,
      end: newSlot.end,
      attendees,
    });
  } catch {
    res.status(502).json({ error: 'gcal_failed' });
    return;
  }

  const updated = await rescheduleConfirmedSession({ token, slot: newSlot });
  if (!updated) {
    res.status(409).json({ error: 'reschedule_failed' });
    return;
  }

  const refreshed = await getSchedulingSessionByToken(token);
  if (refreshed) {
    await enqueueRemindersForSession(refreshed).catch(() => {});
  }

  await sendHostBookingNotification({ hostUserId: session.host_user_id, sessionToken: token, kind: 'rescheduled' });
  res.json({ ok: true, slot: newSlot });
});

router.post('/s/:token/propose', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const session = await getSchedulingSessionByToken(token);
  if (!session) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (session.status === 'confirmed') {
    res.status(409).json({ error: 'already_confirmed' });
    return;
  }
  try {
    await appendProposedAlternative(token, {
      proposedDate: req.body.proposedDate,
      proposedTimeWindow: req.body.proposedTimeWindow,
      note: req.body.note,
    });
    await sendHostBookingNotification({
      hostUserId: session.host_user_id,
      sessionToken: token,
      kind: 'proposed',
      proposedDate: req.body.proposedDate,
      proposedTimeWindow: req.body.proposedTimeWindow,
      note: req.body.note,
    });
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'propose_failed' });
  }
});

export default router;
export { GCAL_CLAIMING_SENTINEL };
