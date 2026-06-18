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

function formatSlotLabel(isoStart, timeZone) {
  try {
    const opts = {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    };
    if (timeZone) {
      opts.timeZone = timeZone;
      opts.timeZoneName = 'short';
    }
    return new Date(isoStart).toLocaleString(undefined, opts);
  } catch {
    return isoStart;
  }
}

function renderSlotButtons(slots, { slotLabels, slotMeta } = {}) {
  const root = document.getElementById('booking-root');
  const grid = document.querySelector('.slot-grid');
  if (!grid || !slots?.length) return;
  const timeZone = root?.dataset.timezone;
  grid.innerHTML = slots.slice(0, 2).map((s, i) => {
    const label = slotLabels?.[i] ?? formatSlotLabel(s.start, timeZone);
    const busy = slotMeta?.[i]?.inviteeConflict;
    if (busy) {
      return `
    <button type="button" class="slot-btn choose-btn is-busy" data-index="${i}" disabled aria-label="${label} — You are busy at this hour">
      <span class="slot-btn-time">${label}</span>
      <span class="slot-btn-busy-note">You're busy at this hour</span>
    </button>`;
    }
    return `
    <button type="button" class="slot-btn choose-btn" data-index="${i}" aria-label="Select ${label}">
      ${label}
    </button>`;
  }).join('');
  bindSlotButtons(root?.dataset.token);
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

  try {
    const res = await fetch(`/s/${token}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotIndex }),
    });
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;

    if (res.ok) {
      const root = document.getElementById('booking-root');
      const slotLabel = btn?.textContent?.trim() ?? '';
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
  try {
    const res = await fetch(`/s/${token}/next-slots`, { method: 'POST' });
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (res.ok && body?.slots?.length) {
      renderSlotButtons(body.slots, {
        slotLabels: body.slotLabels,
        slotMeta: body.slotMeta,
      });
      showBookingStatus('Here are the next available times.', 'success');
      return;
    }
    if (res.status === 403 || body?.error === 'grant_required') {
      showBookingStatus('Share your availability below to find a common time.', 'info');
      return;
    }
    showBookingStatus('No more times found right now. Try typing a preferred time.', 'error');
  } catch {
    showBookingStatus('Network error. Try again in a moment.', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function saveGrantWindow(token) {
  const startInput = document.getElementById('grant-window-start');
  const endInput = document.getElementById('grant-window-end');
  const saveBtn = document.getElementById('grant-window-save');
  if (!startInput?.value || !endInput?.value) {
    showBookingStatus('Choose a start and end date for your availability.', 'error');
    return;
  }

  const start = new Date(`${startInput.value}T09:00:00`).toISOString();
  const end = new Date(`${endInput.value}T17:00:00`).toISOString();
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

  const params = new URLSearchParams(window.location.search);
  if (params.get('grant') === 'connected') {
    showBookingStatus('Calendar connected for this meeting only.', 'success');
    window.history.replaceState({}, '', window.location.pathname);
  } else if (params.get('grant') === 'error') {
    showBookingStatus('Could not connect your calendar. Try again.', 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }

  bindSlotButtons(token);

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
