/** Public booking page interactions — no alert() */

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

function clearFieldErrors(form) {
  form?.querySelectorAll('.field-error').forEach((el) => el.remove());
  form?.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
}

function showFieldError(input, message) {
  if (!input) return;
  input.classList.add('is-invalid');
  input.setAttribute('aria-invalid', 'true');
  const err = document.createElement('p');
  err.className = 'field-error';
  err.id = `${input.id}-error`;
  err.setAttribute('role', 'alert');
  err.textContent = message;
  input.setAttribute('aria-describedby', err.id);
  input.parentElement?.appendChild(err);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function guestValidationMessages() {
  return {
    name_required: 'Please enter your name.',
    email_required: 'Please enter your email.',
    email_invalid: 'Please enter a valid email address.',
  };
}

function validateGuestForm(form) {
  clearFieldErrors(form);
  const nameInput = form.querySelector('[name="guestName"]');
  const emailInput = form.querySelector('[name="guestEmail"]');
  const name = nameInput?.value?.trim() ?? '';
  const email = emailInput?.value?.trim() ?? '';
  let valid = true;

  if (!name) {
    showFieldError(nameInput, guestValidationMessages().name_required);
    valid = false;
  }
  if (!email) {
    showFieldError(emailInput, guestValidationMessages().email_required);
    valid = false;
  } else if (!isValidEmail(email)) {
    showFieldError(emailInput, guestValidationMessages().email_invalid);
    valid = false;
  }

  return valid ? { name, email, notes: form.querySelector('[name="guestNotes"]')?.value?.trim() || undefined } : null;
}

function errorMessageForSelect(status, body) {
  const guestErrors = guestValidationMessages();
  if (status === 400 && body?.error && guestErrors[body.error]) {
    return guestErrors[body.error];
  }
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (status === 503) return body?.message ?? 'Booking is temporarily unavailable.';
  if (status === 409) return 'That time is no longer available. Ask your host for a fresh link.';
  if (status === 502) return 'Could not add this to the calendar. Try another time.';
  return body?.error ?? 'Something went wrong. Please try again.';
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
        <p class="booking-sub">Need to change plans?</p>
        <div class="booking-manage-actions">
          ${rescheduleHref ? `<a class="btn-secondary booking-manage-btn" href="${rescheduleHref}">Reschedule</a>` : ''}
          ${cancelHref ? `<a class="btn-secondary booking-manage-btn is-danger" href="${cancelHref}">Cancel meeting</a>` : ''}
        </div>
        <p class="booking-tz-note">You&apos;ll also get reminder emails with these links.</p>
      </div>`
    : `<p class="booking-tz-note">Reminder emails will include links to reschedule or cancel.</p>`;

  root.innerHTML = `
    <div class="booking-confirmed">
      <h1>You&apos;re all set.</h1>
      ${slotLabel ? `<p class="booking-sub">${slotLabel}</p>` : ''}
      <p class="booking-sub">A calendar invite should follow shortly.</p>
      ${manageLinks}
    </div>`;
}

async function selectSlot(token, slotIndex, guest, btn, { slotLabel } = {}) {
  const form = btn?.closest('form');
  const card = btn?.closest('.slot-card');
  card?.classList.add('is-loading');
  setButtonLoading(btn, true);
  hideBookingStatus();

  try {
    const res = await fetch(`/s/${token}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotIndex, guest }),
    });
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;

    if (res.ok) {
      const root = document.getElementById('booking-root');
      if (root && (body?.actions || slotLabel)) {
        renderSuccessView(root, { slotLabel, actions: body?.actions });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      showBookingStatus('Confirmed! Updating your booking…', 'success', { loading: true });
      window.location.reload();
      return;
    }

    if (res.status === 400 && form && body?.error && guestValidationMessages()[body.error]) {
      const fieldMap = {
        name_required: '[name="guestName"]',
        email_required: '[name="guestEmail"]',
        email_invalid: '[name="guestEmail"]',
      };
      const input = form.querySelector(fieldMap[body.error]);
      if (input) {
        showFieldError(input, guestValidationMessages()[body.error]);
        input.focus();
      }
    } else {
      showBookingStatus(errorMessageForSelect(res.status, body), 'error');
    }
    card?.classList.remove('is-loading');
    setButtonLoading(btn, false);
  } catch {
    showBookingStatus('Network error. Check your connection and try again.', 'error');
    card?.classList.remove('is-loading');
    setButtonLoading(btn, false);
  }
}

function openGuestIntake(slotIndex, slotLabel) {
  const panel = document.getElementById('guest-intake-panel');
  const slotGrid = document.querySelector('.slot-grid');
  if (!panel) return;

  panel.dataset.slotIndex = String(slotIndex);
  panel.dataset.slotLabel = slotLabel ?? '';
  const labelEl = document.getElementById('guest-intake-slot-label');
  if (labelEl) labelEl.textContent = slotLabel ?? '';

  slotGrid?.classList.add('hidden');
  document.getElementById('propose-toggle')?.closest('.booking-links')?.classList.add('hidden');
  panel.classList.remove('hidden');
  hideBookingStatus();
  clearFieldErrors(document.getElementById('guest-intake-form'));
  panel.querySelector('[name="guestName"]')?.focus();
}

function closeGuestIntake() {
  const panel = document.getElementById('guest-intake-panel');
  panel?.classList.add('hidden');
  document.querySelector('.slot-grid')?.classList.remove('hidden');
  document.getElementById('propose-toggle')?.closest('.booking-links')?.classList.remove('hidden');
  hideBookingStatus();
}

function initGuestIntake(token) {
  document.querySelectorAll('.choose-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index ?? '0', 10);
      const card = btn.closest('.slot-card');
      const slotLabel = card?.querySelector('.slot-time')?.textContent?.trim() ?? '';
      openGuestIntake(index, slotLabel);
    });
  });

  document.getElementById('guest-intake-cancel')?.addEventListener('click', closeGuestIntake);

  const form = document.getElementById('guest-intake-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const guest = validateGuestForm(form);
    if (!guest) return;

    const panel = document.getElementById('guest-intake-panel');
    const slotIndex = parseInt(panel?.dataset.slotIndex ?? '0', 10);
    const slotLabel = panel?.dataset.slotLabel ?? '';
    const submitBtn = form.querySelector('[type="submit"]');
    await selectSlot(token, slotIndex, guest, submitBtn, { slotLabel });
  });
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
          <div class="booking-confirmed">
            <h1>${heading}</h1>
            <p class="booking-sub">${detail}</p>
            <a class="cta" href="/s/${token}">Back to booking</a>
          </div>`;
        return;
      }

      const messages = {
        invalid_action_token: 'This link is invalid or expired. Use the link from your latest email.',
        not_cancellable: 'This meeting can no longer be cancelled.',
        not_reschedulable: 'This meeting can no longer be rescheduled.',
        gcal_failed: 'Could not update the calendar. Try again or contact your host.',
      };
      showBookingStatus(messages[body?.error] ?? 'Something went wrong. Please try again.', 'error');
    } catch {
      showBookingStatus('Network error. Check your connection and try again.', 'error');
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });
}

function initBookingPage() {
  const root = document.getElementById('booking-root');
  if (!root) return;

  if (root.dataset.page === 'action') {
    initActionPage();
    return;
  }

  const token = root.dataset.token;
  if (!token) return;

  initGuestIntake(token);

  const proposeToggle = document.getElementById('propose-toggle');
  const proposePanel = document.getElementById('propose-panel');
  const proposeCancel = document.getElementById('propose-cancel');
  const proposeForm = document.getElementById('propose-form');

  proposeToggle?.addEventListener('click', (e) => {
    e.preventDefault();
    closeGuestIntake();
    proposePanel?.classList.remove('hidden');
    proposeToggle.setAttribute('aria-expanded', 'true');
    proposePanel?.querySelector('input, select, textarea')?.focus();
  });

  proposeCancel?.addEventListener('click', () => {
    proposePanel?.classList.add('hidden');
    proposeToggle?.setAttribute('aria-expanded', 'false');
    hideBookingStatus();
  });

  proposeForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = proposeForm.querySelector('[type="submit"]');
    setButtonLoading(submitBtn, true);
    hideBookingStatus();

    const dateInput = proposeForm.querySelector('[name="proposedDate"]');
    const windowInput = proposeForm.querySelector('[name="proposedTimeWindow"]');
    const noteInput = proposeForm.querySelector('[name="note"]');

    try {
      const res = await fetch(`/s/${token}/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposedDate: dateInput?.value || new Date().toISOString().slice(0, 10),
          proposedTimeWindow: windowInput?.value || 'flexible',
          note: noteInput?.value?.trim() || undefined,
        }),
      });

      if (res.ok) {
        showBookingStatus('Your suggestion was sent to your host.', 'success');
        proposePanel?.classList.add('hidden');
        proposeToggle?.setAttribute('aria-expanded', 'false');
        proposeForm.reset();
      } else {
        const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
        showBookingStatus(body?.error === 'already_confirmed'
          ? 'This meeting is already confirmed.'
          : 'Could not send your suggestion. Try again.', 'error');
      }
    } catch {
      showBookingStatus('Network error. Try again in a moment.', 'error');
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBookingPage);
} else {
  initBookingPage();
}
