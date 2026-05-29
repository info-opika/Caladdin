import { Router, Request, Response } from 'express';
import { getSessionByToken, updateSessionStatus } from '../db/scheduling_sessions.js';
import { getEventById, updateEvent, cancelEvent } from '../db/events.js';
import { createEventWithSync } from '../services/calendar_api.js';
import { getOAuthClientForUser } from '../services/auth_service.js';
import { config } from '../config.js';

export const schedulingRouter = Router();

function renderRecipientPage(session: {
  host_name: string | null;
  context: string | null;
  slots: Array<{ start: string; end: string }>;
  token: string;
  status: string;
}): string {
  const slotsHtml = session.slots.map((s, i) => {
    const start = new Date(s.start);
    const label = start.toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return `<button class="slot-btn" data-index="${i}">${label}</button>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pick a time — ${session.host_name ?? 'Host'}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=Fraunces:wght@600&display=swap" rel="stylesheet" />
  <style>
    :root { --stone: #78716c; --amber: #d97706; --bg: #fafaf9; }
    body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: #1c1917; margin: 0; padding: 1.5rem; }
    h1 { font-family: 'Fraunces', serif; font-size: 1.75rem; }
    .note { color: var(--stone); margin-bottom: 1.5rem; }
    .slot-btn { display: block; width: 100%; padding: 1rem; margin: 0.5rem 0; border: 2px solid #e7e5e4; border-radius: 12px; background: white; font-size: 1rem; cursor: pointer; text-align: left; }
    .slot-btn:hover { border-color: var(--amber); }
    .confirmed { background: #ecfdf5; border-color: #10b981; padding: 1.5rem; border-radius: 12px; display: none; }
    .viral { margin-top: 2rem; font-size: 0.9rem; color: var(--stone); }
    .viral a { color: var(--amber); }
  </style>
</head>
<body>
  <h1>${session.host_name ?? 'Someone'} invited you to meet</h1>
  ${session.context ? `<p class="note">${session.context}</p>` : ''}
  <p class="note">Pick one of these times:</p>
  <div id="slots">${slotsHtml}</div>
  <div id="confirmed" class="confirmed">
    <strong>You're all set!</strong> Your time is confirmed.
    <p class="viral">Want this for your own calendar? <a href="/">Join Caladdin</a></p>
  </div>
  <script>
    const token = '${session.token}';
    document.querySelectorAll('.slot-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await fetch('/s/' + token + '/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slotIndex: parseInt(btn.dataset.index) })
        });
        if (res.ok) {
          document.getElementById('slots').style.display = 'none';
          document.getElementById('confirmed').style.display = 'block';
        } else {
          alert('These times are no longer available. The host will send new options shortly.');
        }
      });
    });
  </script>
</body>
</html>`;
}

schedulingRouter.get('/:token', async (req: Request, res: Response) => {
  const session = await getSessionByToken(req.params.token);
  if (!session) {
    res.status(404).send('This scheduling link is not valid.');
    return;
  }
  if (session.status === 'expired' || new Date(session.expires_at) < new Date()) {
    await updateSessionStatus(session.token, 'expired');
    res.status(410).send('This scheduling link has expired.');
    return;
  }
  if (session.status === 'booked') {
    res.send(renderRecipientPage({ ...session, slots: session.slots as never, status: 'booked' }));
    return;
  }
  res.send(renderRecipientPage({
    host_name: session.host_name,
    context: session.context,
    slots: session.slots as Array<{ start: string; end: string }>,
    token: session.token,
    status: session.status,
  }));
});

schedulingRouter.post('/:token/select', async (req: Request, res: Response) => {
  const session = await getSessionByToken(req.params.token);
  if (!session || session.status !== 'open') {
    res.status(409).json({ error: 'Session unavailable' });
    return;
  }

  const slotIndex = req.body.slotIndex as number;
  const slots = session.slots as Array<{ start: string; end: string }>;
  const selected = slots[slotIndex];
  if (!selected) {
    res.status(400).json({ error: 'Invalid slot' });
    return;
  }

  const cal = await getOAuthClientForUser(session.host_user_id);
  const title = `Meeting with guest`;
  await createEventWithSync(cal, session.host_user_id, {
    title,
    start: selected.start,
    end: selected.end,
    tier: 2,
    status: 'confirmed',
  });

  for (const id of session.proposed_event_ids ?? []) {
    const ev = await getEventById(id);
    if (ev && ev.start !== selected.start) {
      await cancelEvent(id);
    } else if (ev) {
      await updateEvent(id, { status: 'confirmed', title });
    }
  }

  await updateSessionStatus(session.token, 'booked');
  res.json({ ok: true, selected });
});

schedulingRouter.post('/:token/propose', async (req: Request, res: Response) => {
  res.json({ ok: true, message: 'Host notified' });
});
