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
  replaceSessionOfferedSlots,
  appendDismissedSlots,
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
import { getGrantBySessionId, revokeGrantForSession, type InviteCalendarGrantRow } from '../db/invite_calendar_grants.js';
import { listBusyFromGCal } from '../services/calendar_api.js';
import { findMutualSlots } from '../services/mutual_slot_engine.js';
import { migratePolicy } from '../core/adts.js';
import { getSupabase } from '../db/client.js';
import {
  formatSlotButtonLabelForInvitee,
  formatSlotHostTimeLine,
  formatSlotLabel,
  zonesDiffer,
} from '../services/schedule_formatting.js';
import { markGrantInviteeConflicts } from '../services/invitee_slot_conflicts.js';

const router = Router();

function isExpired(session: SchedulingSessionRow): boolean {
  return new Date(session.expires_at) < new Date();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseHourFromTime(hhmm: string, fallback: number): number {
  const m = /^(\d{1,2}):/.exec(hhmm);
  if (!m) return fallback;
  const h = parseInt(m[1], 10);
  return Number.isFinite(h) ? h : fallback;
}

const INVITE_HEAD = `
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="theme-color" content="#d97706"/>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23d97706'/%3E%3Ctext x='16' y='22' text-anchor='middle' fill='white' font-family='Georgia,serif' font-size='18' font-weight='600'%3EC%3C/text%3E%3C/svg%3E"/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Fraunces:wght@600&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="/tokens.css"/>
  <link rel="stylesheet" href="/invite.css"/>
`;

function guestActionLinksHtml(sessionToken: string): string {
  const cancelUrl = escapeHtml(guestActionUrl(sessionToken, 'cancel'));
  const rescheduleUrl = escapeHtml(guestActionUrl(sessionToken, 'reschedule'));
  return `
    <div class="booking-manage">
      <p class="invite-sub">Need to change plans?</p>
      <div class="booking-manage-actions">
        <a class="btn-secondary booking-manage-btn" href="${rescheduleUrl}">Reschedule</a>
        <a class="btn-secondary booking-manage-btn is-danger" href="${cancelUrl}">Cancel meeting</a>
      </div>
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

function bookingShell(content: string, { title = 'Meeting invite', script = true, rootAttrs = '' }: { title?: string; script?: boolean; rootAttrs?: string } = {}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${INVITE_HEAD}
  <title>${escapeHtml(title)} — Caladdin</title>
</head>
<body class="invite-page">
  <div class="invite-shell">
    <header class="invite-topbar">
      <div class="invite-brand">
        <div class="invite-brand-mark" aria-hidden="true">C</div>
        <p class="invite-brand-name">Caladdin</p>
      </div>
    </header>
    <main id="booking-root" ${rootAttrs}>${content}</main>
  </div>
  ${script ? '<script type="module" src="/booking.js"></script>' : ''}
</body>
</html>`;
}

function render404(): string {
  return bookingShell(`
    <div class="invite-empty">
      <h1>Link not found</h1>
      <p class="invite-sub">This link is invalid or expired. Please ask the sender for a new link.</p>
    </div>
  `, { title: 'Link not found', script: false });
}

function renderExpired(): string {
  return bookingShell(`
    <div class="invite-empty">
      <h1>This scheduling link has expired.</h1>
      <p class="invite-sub">Ask your host for a fresh link.</p>
    </div>
  `, { title: 'Link expired', script: false });
}

type SlotButtonMeta = { inviteeConflict?: boolean };

function slotPairsEqual(
  a: Array<{ start: string; end: string }>,
  b: Array<{ start: string; end: string }>,
): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.start === b[i]?.start && s.end === b[i]?.end);
}

function buildExcludeSlots(session: SchedulingSessionRow): Array<{ start: string; end: string }> {
  const all = [...(session.dismissed_slots ?? []), ...(session.offered_slots ?? [])];
  const seen = new Set<string>();
  return all.filter((s) => {
    const key = `${s.start}|${s.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderSlotButtonHtml(
  slot: { start: string; end: string },
  index: number,
  hostTz: string,
  meta?: SlotButtonMeta,
  inviteeTz?: string,
): string {
  const displayTz = inviteeTz ?? hostTz;
  const label = formatSlotButtonLabelForInvitee(slot, displayTz);
  const hostLine = zonesDiffer(displayTz, hostTz) ? formatSlotHostTimeLine(slot, hostTz) : '';
  const dataAttrs = `data-index="${index}" data-start="${escapeHtml(slot.start)}" data-end="${escapeHtml(slot.end)}"`;
  if (meta?.inviteeConflict) {
    return `
    <button type="button" class="slot-btn choose-btn is-busy" ${dataAttrs} disabled aria-label="${escapeHtml(label)} — You are busy at this hour">
      <span class="slot-btn-time">${escapeHtml(label)}</span>
      ${hostLine ? `<span class="slot-btn-host-time">${escapeHtml(hostLine)}</span>` : ''}
      <span class="slot-btn-busy-note">You&apos;re busy at this hour</span>
    </button>`;
  }
  return `
    <button type="button" class="slot-btn choose-btn" ${dataAttrs} aria-label="Select ${escapeHtml(label)}">
      <span class="slot-btn-time">${escapeHtml(label)}</span>
      ${hostLine ? `<span class="slot-btn-host-time">${escapeHtml(hostLine)}</span>` : ''}
    </button>`;
}

function renderSlotGridHtml(
  slots: Array<{ start: string; end: string }>,
  hostTz: string,
  slotMeta: SlotButtonMeta[] = [],
  inviteeTz?: string,
): string {
  const buttons = slots
    .slice(0, 2)
    .map((s, i) => renderSlotButtonHtml(s, i, hostTz, slotMeta[i], inviteeTz));
  if (buttons.length === 2) {
    return `${buttons[0]}<p class="slot-or-divider" aria-hidden="true">or</p>${buttons[1]}`;
  }
  return buttons.join('');
}

function bookingRootAttrs(session: SchedulingSessionRow, grantConnected: boolean, tz: string): string {
  return [
    `data-token="${escapeHtml(session.token)}"`,
    `data-grant="${grantConnected ? 'active' : 'none'}"`,
    `data-timezone="${escapeHtml(tz)}"`,
  ].join(' ');
}

function grantSectionHtml(session: SchedulingSessionRow, grantConnected: boolean): string {
  if (grantConnected) {
    const tz = session.host_timezone ?? 'America/Chicago';
    const today = DateTime.now().setZone(tz).toISODate() ?? '';
    const defaultEnd = DateTime.now().setZone(tz).plus({ days: 7 }).toISODate() ?? '';
    return `
    <div class="grant-section" data-grant-active="true">
      <p class="invite-sub">Your calendar is connected for this meeting only.</p>
      <div id="grant-window-panel" class="grant-window-panel">
        <label for="grant-window-start">Available from</label>
        <input type="date" id="grant-window-start" value="${today}" />
        <label for="grant-window-end">Available until</label>
        <input type="date" id="grant-window-end" value="${defaultEnd}" />
        <button type="button" id="grant-window-save">Save availability window</button>
      </div>
    </div>`;
  }

  return `
    <div class="grant-section">
      <a class="grant-link" href="/s/${escapeHtml(session.token)}/grant/start">Share your availability for this meeting only</a>
    </div>`;
}

function renderPage(
  session: SchedulingSessionRow,
  grantConnected = false,
  slotMeta: SlotButtonMeta[] = [],
): string {
  const tz = session.host_timezone ?? 'America/Chicago';
  const host = session.host_name ?? 'Your host';
  const slots = session.offered_slots ?? [];

  if (session.status === 'cancelled') {
    return bookingShell(`
      <div class="invite-empty">
        <h1>This meeting was cancelled.</h1>
        <p class="invite-sub">Ask ${escapeHtml(host)} for a new link if you&apos;d like to reschedule.</p>
      </div>
    `, { title: 'Meeting cancelled', script: false });
  }

  if (session.status === 'confirmed' && session.selected_slot) {
    const label = escapeHtml(formatSlotLabel(session.selected_slot, tz));
    return bookingShell(`
      <div class="invite-confirmed">
        <h1>You\u2019re all set.</h1>
        <p class="invite-sub">${label}</p>
        <p class="invite-sub">A calendar invite should follow.</p>
        ${guestActionLinksHtml(session.token)}
      </div>
    `, { title: 'Booking confirmed', script: false });
  }

  if (isExpired(session)) return renderExpired();

  if (slots.length < 2) {
    return bookingShell(`
      <div class="invite-empty">
        <h1>These options are no longer available.</h1>
        <p class="invite-sub">Ask your host for a fresh link.</p>
        <div id="booking-status" class="booking-status" role="status"></div>
        <button type="button" id="find-next-slot" class="btn-secondary">Find next common slot</button>
        <form id="preferred-time-form" class="preferred-time-form">
          <label for="preferred-time" class="visually-hidden">Preferred time</label>
          <input type="text" id="preferred-time" name="preferredTime" placeholder="Type a preferred time" autocomplete="off" />
          <button type="submit">Send</button>
        </form>
        ${grantSectionHtml(session, grantConnected)}
      </div>
    `, { title: 'Options unavailable', rootAttrs: bookingRootAttrs(session, grantConnected, tz) });
  }

  const hostLine = session.host_name
    ? `${escapeHtml(host)} is inviting you to a meeting.`
    : 'You\u2019re invited to a meeting.';

  const slotButtons = renderSlotGridHtml(slots, tz, slotMeta);

  const hostToggle = `
    <button type="button" id="toggle-host-time" class="slot-host-toggle" hidden>
      Show host&apos;s time
    </button>`;

  return bookingShell(`
    <p class="invite-host-line">${hostLine}</p>
    <div id="booking-status" class="booking-status" role="status"></div>
    <div class="slot-grid">${slotButtons}</div>
    ${hostToggle}
    <button type="button" id="find-next-slot" class="btn-secondary">Find next common slot</button>
    <form id="preferred-time-form" class="preferred-time-form">
      <label for="preferred-time" class="visually-hidden">Preferred time</label>
      <input type="text" id="preferred-time" name="preferredTime" placeholder="Type a preferred time" autocomplete="off" />
      <button type="submit">Send</button>
    </form>
    ${grantSectionHtml(session, grantConnected)}
  `, { title: 'Pick a time', rootAttrs: bookingRootAttrs(session, grantConnected, tz) });
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
    <div class="invite-empty">
      <h1>Cancel this meeting?</h1>
      <p class="invite-sub">${label}</p>
      <p class="invite-sub">Your host will be notified and the calendar event will be removed.</p>
    </div>
    <div id="booking-status" class="booking-status" role="status"></div>
    <form id="action-form" class="action-panel">
      <button type="submit" class="choose-btn">Yes, cancel meeting</button>
    </form>
    <a class="invite-back-link" href="/s/${escapeHtml(session.token)}">Keep this meeting</a>
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
    <div class="invite-empty">
      <h1>Pick a new time</h1>
      <p class="invite-sub">Choose one of the options below. Your host will be notified.</p>
    </div>
    <div id="booking-status" class="booking-status" role="status"></div>
    <form id="action-form" class="action-panel">
      <div class="action-slot-options">${slotOptions || '<p class="invite-sub">No alternate times available. Contact your host.</p>'}</div>
      <button type="submit" class="choose-btn"${slots.length < 1 ? ' disabled' : ''}>Confirm new time</button>
    </form>
    <a class="invite-back-link" href="/s/${escapeHtml(session.token)}">← Back to booking</a>
  `, { title: 'Reschedule meeting', rootAttrs });
}

function renderInvalidActionLink(): string {
  return bookingShell(`
    <div class="invite-empty">
      <h1>This link is invalid or expired</h1>
      <p class="invite-sub">Use the latest link from your confirmation or reminder email.</p>
    </div>
  `, { title: 'Invalid link', script: false });
}

function renderCalendarAccessDenied(): string {
  return bookingShell(`
    <div class="invite-empty">
      <h1>Calendar view unavailable</h1>
      <p class="invite-sub">Your host has not shared their full calendar on this invite. Use the offered time options instead.</p>
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
    <div class="invite-empty">
      <h1>${escapeHtml(session.host_name ?? 'Host')}&apos;s availability</h1>
      <p class="invite-sub">Read-only view for the next two weeks. Private events show as Busy.</p>
    </div>
    <div class="calendar-table-wrap">
      <table class="calendar-table">
        <thead><tr><th scope="col">Day</th><th scope="col">Time</th><th scope="col">Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3">No events in this range</td></tr>'}</tbody>
      </table>
    </div>
    <a class="invite-back-link" href="/s/${escapeHtml(session.token)}">← Back to time options</a>
  `, { title: `${session.host_name ?? 'Host'} availability`, script: false }));
}

router.get('/s/:token', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const session = await getSchedulingSessionByToken(token);
  if (!session) {
    res.status(404).type('html').send(render404());
    return;
  }
  const grant = await getGrantBySessionId(session.id);
  const grantConnected = Boolean(
    grant?.status === 'active' &&
      grant.oauth_access_token &&
      new Date(grant.expires_at) > new Date(),
  );
  let slotMeta: SlotButtonMeta[] = [];
  if (grantConnected && grant && (session.offered_slots?.length ?? 0) >= 2) {
    slotMeta = await markGrantInviteeConflicts(session, grant, session.offered_slots!.slice(0, 2));
  }
  res.type('html').send(renderPage(session, grantConnected, slotMeta));
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

function guestFromSession(session: SchedulingSessionRow): GuestIntakePayload | undefined {
  if (!session.invitee_email) return undefined;
  const local = session.invitee_email.split('@')[0] ?? 'Guest';
  return {
    name: session.invitee_label?.trim() || local,
    email: session.invitee_email,
  };
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

  const hostTz = session.host_timezone ?? 'America/Chicago';
  const inviteeTz =
    typeof req.body.inviteeTimezone === 'string' && req.body.inviteeTimezone.trim()
      ? req.body.inviteeTimezone.trim()
      : hostTz;

  let slotIndex = req.body.slotIndex as 0 | 1 | undefined;
  let selected = slotIndex != null ? session.offered_slots[slotIndex] : undefined;

  if (req.body.start && req.body.end) {
    const start = String(req.body.start);
    const end = String(req.body.end);
    const idx = session.offered_slots.findIndex((s) => s.start === start && s.end === end);
    if (idx < 0) {
      res.status(400).json({ error: 'invalid_slot' });
      return;
    }
    slotIndex = idx as 0 | 1;
    selected = session.offered_slots[slotIndex];
  } else if (slotIndex == null) {
    res.status(400).json({ error: 'slot_required' });
    return;
  }

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

  if (session.status !== 'pending' || !selected || slotIndex == null) {
    res.status(409).json({ error: 'unavailable' });
    return;
  }

  const fresh = await getSchedulingSessionByToken(token);
  if (!fresh || fresh.status !== 'pending') {
    res.status(409).json({ error: 'unavailable' });
    return;
  }
  selected = fresh.offered_slots[slotIndex];
  if (!selected || selected.start !== session.offered_slots[slotIndex]?.start) {
    res.status(409).json({ error: 'unavailable' });
    return;
  }

  const guestPayload = parseGuestPayload(req.body as Record<string, unknown>) ?? guestFromSession(session);
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

    await revokeGrantForSession(session.id).catch(() => {});

    const slotLabel = formatSlotButtonLabelForInvitee(selected, inviteeTz);
    res.json({ ok: true, actions: selectActionPayload(token), slotLabel });
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

  await revokeGrantForSession(session.id).catch(() => {});

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
    const note = String(req.body.note ?? req.body.preferredTime ?? '').trim();
    const proposedDate =
      req.body.proposedDate ??
      DateTime.now().setZone(session.host_timezone ?? 'America/Chicago').toISODate();
    await appendProposedAlternative(token, {
      proposedDate,
      proposedTimeWindow: req.body.proposedTimeWindow ?? 'flexible',
      note: note || undefined,
    });
    await sendHostBookingNotification({
      hostUserId: session.host_user_id,
      sessionToken: token,
      kind: 'proposed',
      proposedDate,
      proposedTimeWindow: req.body.proposedTimeWindow ?? 'flexible',
      note: note || undefined,
    });
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'propose_failed' });
  }
});

async function buildNextSlotsPayload(
  session: SchedulingSessionRow,
  slots: Array<{ start: string; end: string }>,
  source: string,
  grant?: InviteCalendarGrantRow | null,
  grantActive = false,
  inviteeTimezone?: string,
) {
  const hostTz = session.host_timezone ?? 'America/Chicago';
  const inviteeTz = inviteeTimezone?.trim() || hostTz;
  const offered = slots.slice(0, 2);
  const slotLabels = offered.map((slot) => formatSlotButtonLabelForInvitee(slot, inviteeTz));
  const hostSlotLabels = zonesDiffer(inviteeTz, hostTz)
    ? offered.map((slot) => formatSlotHostTimeLine(slot, hostTz))
    : undefined;
  let slotMeta: Array<{ inviteeConflict: boolean }> | undefined;
  if (grantActive && grant) {
    slotMeta = await markGrantInviteeConflicts(session, grant, offered);
  }
  return {
    ok: true,
    slots: offered,
    slotLabels,
    hostSlotLabels,
    slotMeta,
    timezone: hostTz,
    hostTimezone: hostTz,
    inviteeTimezone: inviteeTz,
    source,
  };
}

async function persistAndLoadNextSlots(
  token: string,
  session: SchedulingSessionRow,
  next: Array<{ start: string; end: string }>,
): Promise<{ ok: true; session: SchedulingSessionRow } | { ok: false; error: string }> {
  if (slotPairsEqual(next, session.offered_slots ?? [])) {
    return { ok: false, error: 'no_more_slots' };
  }
  const dismissedOk = await appendDismissedSlots(token, session.offered_slots ?? []);
  if (!dismissedOk) {
    return { ok: false, error: 'slot_persist_failed' };
  }
  const saved = await replaceSessionOfferedSlots(token, next);
  if (!saved) {
    return { ok: false, error: 'slot_persist_failed' };
  }
  const refreshed = await getSchedulingSessionByToken(token);
  if (!refreshed) {
    return { ok: false, error: 'slot_persist_failed' };
  }
  return { ok: true, session: refreshed };
}

router.post('/s/:token/next-slots', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const session = await getSchedulingSessionByToken(token);
  if (!session || session.status !== 'pending' || isExpired(session)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const inviteeTimezone =
    typeof req.body?.inviteeTimezone === 'string' ? req.body.inviteeTimezone : undefined;
  const excludeSlots = buildExcludeSlots(session);

  const grant = await getGrantBySessionId(session.id);
  const grantActive = Boolean(
    grant?.status === 'active' &&
      grant.oauth_access_token &&
      new Date(grant.expires_at) > new Date(),
  );

  if (grantActive && grant) {
    const { computeMutualSlotsForSession } = await import('./invite_grant_auth.js');
    const slots = await computeMutualSlotsForSession(session, grant, excludeSlots);
    if (slots.length >= 2) {
      const persisted = await persistAndLoadNextSlots(token, session, slots);
      if (!persisted.ok) {
        const status = persisted.error === 'no_more_slots' ? 409 : 500;
        res.status(status).json({
          error: persisted.error,
          message:
            persisted.error === 'no_more_slots'
              ? 'No more mutual times in your window — try widening dates or propose a time.'
              : undefined,
        });
        return;
      }
      res.json(
        await buildNextSlotsPayload(
          persisted.session,
          persisted.session.offered_slots,
          'mutual',
          grant,
          true,
          inviteeTimezone,
        ),
      );
      return;
    }
    res.status(409).json({
      error: 'no_more_slots',
      message: 'No more mutual times in your window — try widening dates or propose a time.',
    });
    return;
  }

  const tz = session.host_timezone ?? 'America/Chicago';
  const policy = migratePolicy(await getPolicy(session.host_user_id));
  const dayStart = parseHourFromTime(policy.workingHoursStart, 9);
  const dayEnd = parseHourFromTime(policy.workingHoursEnd, 18);
  const windowStart = DateTime.now().setZone(tz).plus({ hours: 1 }).toISO()!;
  const windowEnd = DateTime.now().setZone(tz).plus({ days: 14 }).toISO()!;

  const auth = getAuthService();
  const hostCal = await auth.getClientForUser(session.host_user_id);
  if (!hostCal) {
    res.status(502).json({ error: 'host_calendar_unavailable' });
    return;
  }

  const hostBusy = await listBusyFromGCal(hostCal, windowStart, windowEnd);
  const slots = findMutualSlots({
    hostBusy,
    inviteeBusy: [],
    windowStart,
    windowEnd,
    durationMinutes: session.duration_minutes ?? 30,
    timezone: tz,
    dayStartHour: dayStart,
    dayEndHour: dayEnd,
    excludeSlots,
  });

  if (slots.length < 1) {
    res.status(409).json({ error: 'no_slots' });
    return;
  }

  const next = slots.slice(0, 2);
  const persisted = await persistAndLoadNextSlots(token, session, next);
  if (!persisted.ok) {
    const status = persisted.error === 'no_more_slots' ? 409 : 500;
    res.status(status).json({ error: persisted.error });
    return;
  }
  res.json(
    await buildNextSlotsPayload(
      persisted.session,
      persisted.session.offered_slots,
      'host',
      grant,
      false,
      inviteeTimezone,
    ),
  );
});

export default router;
export { GCAL_CLAIMING_SENTINEL };
