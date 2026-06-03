import { Router, Request, Response } from 'express';
import { DateTime } from 'luxon';
import {
  getSchedulingSessionByToken,
  claimSessionSlotForGcal,
  finalizeSessionAfterGcal,
  revertSessionClaim,
  appendProposedAlternative,
  GCAL_CLAIMING_SENTINEL,
  type SchedulingSessionRow,
} from '../db/scheduling_sessions.js';
import { getAuthService } from '../services/auth_service.js';
import { createCalendarEvent } from '../services/calendar.js';
import { gcalDeleteEvent } from '../services/gcal.js';
import { config } from '../config.js';
import { listEvents } from '../db/events.js';
import { sendHostBookingNotification } from '../services/notifications.js';
import { recordUsageEvent } from '../db/usage_events.js';

const router = Router();

function isExpired(session: SchedulingSessionRow): boolean {
  return new Date(session.expires_at) < new Date();
}

function formatSlotLabel(slot: { start: string; end: string }, tz: string): string {
  const start = DateTime.fromISO(slot.start, { zone: tz });
  const end = DateTime.fromISO(slot.end, { zone: tz });
  if (!start.isValid) return slot.start;
  return `${start.toFormat('cccc, MMM d')} · ${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`;
}

function render404(): string {
  return `<!DOCTYPE html><html><body><h1>Link not found</h1><p>This link is invalid or expired. Please ask the sender for a new link.</p></body></html>`;
}

function renderExpired(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{font-family:system-ui,sans-serif;padding:1.5rem;max-width:480px;margin:0 auto;color:#1c1917}</style></head>
<body><h1>This scheduling link has expired.</h1><p>Ask your host for a fresh link.</p></body></html>`;
}

function renderPage(session: SchedulingSessionRow): string {
  const tz = session.host_timezone ?? 'America/Chicago';
  const host = session.host_name ?? 'Your host';
  const slots = session.offered_slots ?? [];
  const signupUrl = `/auth/start?ref=scheduling&token=${session.token}`;

  if (session.status === 'confirmed' && session.selected_slot) {
    const label = formatSlotLabel(session.selected_slot, tz);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{font-family:system-ui,sans-serif;padding:1.5rem;max-width:520px;margin:0 auto}.cta{display:inline-block;margin-top:1rem;padding:.75rem 1.25rem;background:#d97706;color:#fff;text-decoration:none;border-radius:8px}</style></head>
<body><h1>You\u2019re all set.</h1><p>${label} — ${host} will see this on the calendar.</p>
<p>A calendar invite should follow.</p>
<p><a class="cta" href="${signupUrl}">Create your Caladdin account</a></p></body></html>`;
  }

  if (isExpired(session)) return renderExpired();

  if (slots.length < 2) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body><h1>These options are no longer available.</h1><p>Ask your host for a fresh link.</p>
<p><a href="#" id="propose">Suggest another time</a></p></body></html>`;
  }

  const hero = session.host_name
    ? `${host} found two thoughtful times for you.`
    : 'Two thoughtful times, picked for you.';
  const sub = session.host_name
    ? `${host} used Caladdin to avoid the calendar back-and-forth.`
    : 'Your host used Caladdin to avoid the calendar back-and-forth.';

  const cards = slots.slice(0, 2).map((s, i) => `
    <div class="card slot-card">
      <strong>Option ${i + 1}</strong>
      <p>${formatSlotLabel(s, tz)}</p>
      <button type="button" class="choose-btn" data-index="${i}">Choose this time</button>
    </div>`).join('');

  const inviteeLine = session.invitee_email
    ? `<p class="invitee">Invitation for ${session.invitee_email}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Pick a time</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#fafaf9;color:#1c1917;margin:0;padding:1.25rem;max-width:520px;margin-inline:auto}
    h1{font-size:1.5rem;line-height:1.3}
    .sub{color:#78716c;margin-bottom:1rem}
    .card{border:2px solid #e7e5e4;border-radius:12px;padding:1rem;margin:.75rem 0;background:#fff}
    .choose-btn{width:100%;padding:.75rem;border:none;border-radius:8px;background:#d97706;color:#fff;font-size:1rem;cursor:pointer;margin-top:.5rem}
    .alt{margin-top:1.5rem}
    .alt a{color:#d97706}
    .calendar-link{display:block;margin-top:1rem;color:#57534e}
  </style>
</head>
<body>
  <h1>${hero}</h1>
  <p class="sub">${sub}</p>
  <p>Pick one, or suggest another time.</p>
  ${inviteeLine}
  ${cards}
  <div class="alt"><a href="/s/${session.token}/calendar">View ${host}'s calendar</a></div>
  <p class="alt"><a href="#" id="propose-link">Suggest another time</a></p>
  <script>
    const token = '${session.token}';
    document.querySelectorAll('.choose-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = await fetch('/s/' + token + '/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slotIndex: parseInt(btn.dataset.index) })
        });
        if (res.ok) location.reload();
        else alert('That time is no longer available.');
      });
    });
    document.getElementById('propose-link')?.addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/s/' + token + '/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposedDate: new Date().toISOString().slice(0,10), proposedTimeWindow: 'flexible' })
      });
      alert('Your host has been notified.');
    });
  </script>
</body>
</html>`;
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

  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{font-family:system-ui,sans-serif;padding:1rem}table{width:100%;border-collapse:collapse}td,th{padding:.5rem;border-bottom:1px solid #e7e5e4}</style></head>
<body><h1>${session.host_name ?? 'Host'}'s availability</h1>
<p>Read-only view for the next two weeks. Tier 0/1 details are hidden.</p>
<table><thead><tr><th>Day</th><th>Time</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No events in range</td></tr>'}</tbody></table>
<p><a href="/s/${session.token}">← Back to time options</a></p></body></html>`);
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

router.get('/s/:token/calendar', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const session = await getSchedulingSessionByToken(token);
  if (!session || isExpired(session)) {
    res.status(404).type('html').send(render404());
    return;
  }
  await renderCalendarView(session, res);
});

router.post('/s/:token/select', async (req: Request, res: Response) => {
  const token = String(req.params.token);
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
      res.json({ ok: true, idempotent: true });
      return;
    }
    res.status(409).json({ error: 'already_confirmed' });
    return;
  }

  if (session.status !== 'pending' || !selected) {
    res.status(409).json({ error: 'unavailable' });
    return;
  }

  const claimed = await claimSessionSlotForGcal({ token, slotIndex });
  if (!claimed) {
    const refreshed = await getSchedulingSessionByToken(token);
    if (refreshed?.status === 'confirmed') {
      res.json({ ok: true, idempotent: true });
      return;
    }
    res.status(409).json({ error: 'claim_failed' });
    return;
  }

  try {
    const auth = getAuthService();
    const oauth = await auth.getClientForUser(session.host_user_id);
    const cal = oauth as import('googleapis').calendar_v3.Calendar;
    const attendees = session.invitee_email ? [session.invitee_email] : [];
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

    await sendHostBookingNotification(session.host_user_id, token);
    await recordUsageEvent(null, 'scheduling_slot_accepted', { token, slotIndex });

    res.json({ ok: true });
  } catch {
    await revertSessionClaim(token);
    res.status(502).json({ error: 'gcal_failed' });
  }
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
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'propose_failed' });
  }
});

export default router;
export { GCAL_CLAIMING_SENTINEL };
