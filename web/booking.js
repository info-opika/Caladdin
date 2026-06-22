/** v3 invitee screen — minimal slot select, find-next, preferred time, grant window */

function showBookingStatus(message, variant = 'info', { loading = false } = {}) {
  const el = document.getElementById('booking-status');
  if (!el) return;
  el.className = `booking-status is-visible is-${variant}`;
  el.innerHTML = loading
    ? `<span class="status-spinner" aria-hidden="true"></span><span>${message}</span>`
    : `<span>${message}</span>`;
  el.setAttribute('role', variant === 'error' ? 'alert' : 'status');
}

function hideBookingStatus() {
  const el = document.getElementById('booking-status');
  if (!el) return;
  el.className = 'booking-status';
  el.innerHTML = '';
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('is-loading', loading);
  btn.setAttribute('aria-busy', loading ? 'true' : 'false');
}

function getInviteeTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

function formatSlotLabelClient(isoStart, timeZone) {
  try {
    const opts = {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    };
    if (timeZone) opts.timeZone = timeZone;
    const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(new Date(isoStart));
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const text = parts
      .filter((p) => p.type !== 'timeZoneName')
      .map((p) => p.value)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (tzPart && !/^GMT[+-]/.test(tzPart)) {
      return `${text} ${tzPart}`.trim();
    }
    return text || isoStart;
  } catch {
    return isoStart;
  }
}

function formatHostTimeLine(isoStart, hostTz) {
  const label = formatSlotLabelClient(isoStart, hostTz);
  return label ? `Host: ${label}` : '';
}

function zonesDifferClient(a, b) {
  return Boolean(a && b && a !== b);
}

function slotButtonHtml(slot, index, { inviteeTz, hostTz, label, hostLine, busy }) {
  const dataAttrs = `data-index="${index}" data-start="${slot.start}" data-end="${slot.end}"`;
  if (busy) {
    return `
    <button type="button" class="slot-btn choose-btn is-busy" ${dataAttrs} disabled aria-label="${label} — You are busy at this hour">
      <span class="slot-btn-time">${label}</span>
      ${hostLine ? `<span class="slot-btn-host-time">${hostLine}</span>` : ''}
      <span class="slot-btn-busy-note">You're busy at this hour</span>
    </button>`;
  }
  return `
    <button type="button" class="slot-btn choose-btn" ${dataAttrs} aria-label="Select ${label}">
      <span class="slot-btn-time">${label}</span>
      ${hostLine ? `<span class="slot-btn-host-time">${hostLine}</span>` : ''}
    </button>`;
}

function renderSlotButtons(slots, { slotLabels, hostSlotLabels, slotMeta, hostTimezone } = {}) {
  const root = document.getElementById('booking-root');
  const grid = document.querySelector('.slot-grid');
  if (!grid || !slots?.length) return;

  const hostTz = hostTimezone || root?.dataset.timezone || '';
  const inviteeTz = root?.dataset.inviteeTimezone || getInviteeTimezone() || hostTz;
  if (root && inviteeTz) {
    root.dataset.inviteeTimezone = inviteeTz;
  }

  const showHostLine = root?.classList.contains('show-host-time');
  const buttons = slots.slice(0, 2).map((s, i) => {
    const label = slotLabels?.[i] ?? formatSlotLabelClient(s.start, inviteeTz);
    const hostLine =
      showHostLine && zonesDifferClient(inviteeTz, hostTz)
        ? hostSlotLabels?.[i] ?? formatHostTimeLine(s.start, hostTz)
        : '';
    const busy = slotMeta?.[i]?.inviteeConflict;
    return slotButtonHtml(s, i, { inviteeTz, hostTz, label, hostLine, busy });
  });

  grid.innerHTML =
    buttons.length === 2
      ? `${buttons[0]}<p class="slot-or-divider" aria-hidden="true">or</p>${buttons[1]}`
      : buttons.join('');

  updateHostTimeToggle(root, inviteeTz, hostTz);
  bindSlotButtons(root?.dataset.token);
}

function updateHostTimeToggle(root, inviteeTz, hostTz) {
  const toggle = document.getElementById('toggle-host-time');
  if (!toggle || !root) return;
  const differs = zonesDifferClient(inviteeTz, hostTz);
  toggle.hidden = !differs;
  toggle.textContent = root.classList.contains('show-host-time')
    ? "Hide host's time"
    : "Show host's time";
}

function relabelExistingSlotButtons() {
  const root = document.getElementById('booking-root');
  const grid = document.querySelector('.slot-grid');
  if (!root || !grid) return;

  const hostTz = root.dataset.timezone || '';
  const inviteeTz = root.dataset.inviteeTimezone || getInviteeTimezone() || hostTz;
  root.dataset.inviteeTimezone = inviteeTz;

  const slots = [];
  grid.querySelectorAll('.slot-btn.choose-btn').forEach((btn) => {
    if (btn.dataset.start && btn.dataset.end) {
      slots.push({ start: btn.dataset.start, end: btn.dataset.end });
    }
  });
  if (slots.length === 0) return;

  renderSlotButtons(slots, { hostTimezone: hostTz });
}

function renderSuccessView(root, { slotLabel, actions }) {
  const cancelHref = actions?.cancelUrl ?? (actions?.cancelToken
    ? `/s/${root.dataset.token}/cancel?actionToken=${encodeURIComponent(actions.cancelToken)}`
    : null);
  const rescheduleHref = actions?.rescheduleUrl ?? (actions?.rescheduleToken
    ? `/s/${root.dataset.token}/reschedule?actionToken=${encodeURIComponent(actions.rescheduleToken)}`
    : null);

  const manageLinks = (cancelHref || rescheduleHref)
    ? `<div class="booking-manage">
        <p class="invite-sub">Need to change plans?</p>
        <div class="booking-manage-actions">
          ${rescheduleHref ? `<a class="btn-secondary booking-manage-btn" href="${rescheduleHref}">Reschedule</a>` : ''}
          ${cancelHref ? `<a class="btn-secondary booking-manage-btn is-danger" href="${cancelHref}">Cancel meeting</a>` : ''}
        </div>
      </div>`
    : '';

  root.innerHTML = `
    <div class="invite-confirmed">
      <h1>You&apos;re all set.</h1>
      ${slotLabel ? `<p class="invite-sub">${slotLabel}</p>` : ''}
      <p class="invite-sub">A calendar invite should follow shortly.</p>
      ${manageLinks}
    </div>`;
}

async function selectSlot(token, slotIndex, btn) {
  setButtonLoading(btn, true);
  hideBookingStatus();

  const root = document.getElementById('booking-root');
  const inviteeTimezone = root?.dataset.inviteeTimezone || getInviteeTimezone();
  const payload = { inviteeTimezone };
  if (btn?.dataset.start && btn?.dataset.end) {
    payload.start = btn.dataset.start;
    payload.end = btn.dataset.end;
  } else {
    payload.slotIndex = slotIndex;
  }

  try {
    const res = await fetch(`/s/${token}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;

    if (res.ok) {
      const slotLabel =
        body?.slotLabel ??
        btn?.querySelector('.slot-btn-time')?.textContent?.trim() ??
        '';
      if (root) {
        renderSuccessView(root, { slotLabel, actions: body?.actions });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      window.location.reload();
      return;
    }

    const messages = {
      name_required: 'We need your name to confirm.',
      email_required: 'We need your email to confirm.',
      email_invalid: 'Please use a valid email address.',
      invalid_slot: 'That time is no longer available. Try refreshing the page.',
    };
    showBookingStatus(
      messages[body?.error] ?? (res.status === 409
        ? 'That time is no longer available.'
        : 'Something went wrong. Please try again.'),
      'error',
    );
  } catch {
    showBookingStatus('Network error. Check your connection and try again.', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function bindSlotButtons(token) {
  if (!token) return;
  document.querySelectorAll('.slot-btn.choose-btn').forEach((btn) => {
    btn.replaceWith(btn.cloneNode(true));
  });
  document.querySelectorAll('.slot-btn.choose-btn:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index ?? '0', 10);
      selectSlot(token, index, btn);
    });
  });
}

async function findNextSlots(token, btn) {
  setButtonLoading(btn, true);
  hideBookingStatus();
  const root = document.getElementById('booking-root');
  const inviteeTimezone = root?.dataset.inviteeTimezone || getInviteeTimezone();
  try {
    const res = await fetch(`/s/${token}/next-slots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteeTimezone }),
    });
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (res.ok && body?.slots?.length) {
      renderSlotButtons(body.slots, {
        slotLabels: body.slotLabels,
        hostSlotLabels: body.hostSlotLabels,
        slotMeta: body.slotMeta,
        hostTimezone: body.hostTimezone ?? body.timezone,
      });
      showBookingStatus('Here are the next available times.', 'success');
      return;
    }
    if (res.status === 403 || body?.error === 'grant_required') {
      showBookingStatus('Share your availability below to find a common time.', 'info');
      return;
    }
    if (body?.error === 'no_more_slots') {
      showBookingStatus(
        body.message ?? 'No more times in this window. Try widening your dates or propose a time.',
        'error',
      );
      return;
    }
    showBookingStatus('No more times found right now. Try typing a preferred time.', 'error');
  } catch {
    showBookingStatus('Network error. Try again in a moment.', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function getTimeZoneOffsetMinutes(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] ?? '0', 10));
}

function zonedTimeToUtc(dateStr, hour, timeZone) {
  const [y, mo, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  let utc = Date.UTC(y, mo - 1, d, hour, 0, 0);
  for (let i = 0; i < 3; i++) {
    const offset = getTimeZoneOffsetMinutes(timeZone, new Date(utc));
    const next = Date.UTC(y, mo - 1, d, hour, 0, 0) - offset * 60 * 1000;
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc).toISOString();
}

/** Build ISO window boundaries at 9:00–17:00 in the host timezone. */
function hostWindowIso(dateStr, hour, hostTz) {
  return zonedTimeToUtc(dateStr, hour, hostTz);
}

async function saveGrantWindow(token) {
  const startInput = document.getElementById('grant-window-start');
  const endInput = document.getElementById('grant-window-end');
  const saveBtn = document.getElementById('grant-window-save');
  const root = document.getElementById('booking-root');
  const hostTz = root?.dataset.timezone || 'America/Chicago';

  if (!startInput?.value || !endInput?.value) {
    showBookingStatus('Choose a start and end date for your availability.', 'error');
    return;
  }

  const start = hostWindowIso(startInput.value, 9, hostTz);
  const end = hostWindowIso(endInput.value, 17, hostTz);
  setButtonLoading(saveBtn, true);
  try {
    const res = await fetch(`/s/${token}/grant/window`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end }),
    });
    if (res.ok) {
      showBookingStatus('Availability window saved. Finding common times…', 'info', { loading: true });
      const findBtn = document.getElementById('find-next-slot');
      await findNextSlots(token, findBtn);
      return;
    }
    showBookingStatus('Could not save your window. Try again.', 'error');
  } catch {
    showBookingStatus('Network error. Try again.', 'error');
  } finally {
    setButtonLoading(saveBtn, false);
  }
}

function initActionPage() {
  const root = document.getElementById('booking-root');
  if (!root || root.dataset.page !== 'action') return;

  const token = root.dataset.token;
  const action = root.dataset.action;
  const actionToken = root.dataset.actionToken;
  if (!token || !action || !actionToken) return;

  const form = document.getElementById('action-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('[type="submit"]');
    setButtonLoading(submitBtn, true);
    hideBookingStatus();

    const payload = { actionToken };
    if (action === 'reschedule') {
      const selected = form.querySelector('input[name="slotIndex"]:checked');
      if (!selected) {
        showBookingStatus('Please choose a new time.', 'error');
        setButtonLoading(submitBtn, false);
        return;
      }
      payload.slotIndex = parseInt(selected.value, 10);
    }

    try {
      const res = await fetch(`/s/${token}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;

      if (res.ok) {
        const heading = action === 'cancel' ? 'Meeting cancelled.' : 'Meeting rescheduled.';
        const detail = action === 'cancel'
          ? 'Your host has been notified.'
          : 'Your calendar invite will reflect the new time.';
        root.innerHTML = `
          <div class="invite-confirmed">
            <h1>${heading}</h1>
            <p class="invite-sub">${detail}</p>
          </div>`;
        return;
      }

      showBookingStatus('Something went wrong. Please try again.', 'error');
    } catch {
      showBookingStatus('Network error. Check your connection and try again.', 'error');
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });
}

function initInvitePage() {
  const root = document.getElementById('booking-root');
  if (!root) return;

  if (root.dataset.page === 'action') {
    initActionPage();
    return;
  }

  const token = root.dataset.token;
  if (!token) return;

  const inviteeTz = getInviteeTimezone();
  if (inviteeTz) {
    root.dataset.inviteeTimezone = inviteeTz;
  }
  relabelExistingSlotButtons();

  const params = new URLSearchParams(window.location.search);
  if (params.get('grant') === 'connected') {
    showBookingStatus('Calendar connected for this meeting only.', 'success');
    window.history.replaceState({}, '', window.location.pathname);
  } else if (params.get('grant') === 'error') {
    showBookingStatus('Could not connect your calendar. Try again.', 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }

  bindSlotButtons(token);

  document.getElementById('toggle-host-time')?.addEventListener('click', () => {
    root.classList.toggle('show-host-time');
    relabelExistingSlotButtons();
  });

  document.getElementById('find-next-slot')?.addEventListener('click', (e) => {
    findNextSlots(token, e.currentTarget);
  });

  document.getElementById('preferred-time-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.querySelector('[name="preferredTime"]');
    const submitBtn = form.querySelector('[type="submit"]');
    const text = input?.value?.trim();
    if (!text) {
      showBookingStatus('Type a preferred time first.', 'error');
      return;
    }

    setButtonLoading(submitBtn, true);
    hideBookingStatus();
    try {
      const res = await fetch(`/s/${token}/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: text,
          proposedTimeWindow: 'flexible',
          proposedDate: new Date().toISOString().slice(0, 10),
        }),
      });
      if (res.ok) {
        showBookingStatus('Your preference was sent to your host.', 'success');
        form.reset();
      } else {
        showBookingStatus('Could not send your message. Try again.', 'error');
      }
    } catch {
      showBookingStatus('Network error. Try again.', 'error');
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });

  document.getElementById('grant-window-save')?.addEventListener('click', () => {
    saveGrantWindow(token);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initInvitePage);
} else {
  initInvitePage();
}
