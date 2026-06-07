/** Public event-type booking page — /book/:username/:slug */

import { showToast, detectBrowserTimezone, COMMON_TIMEZONES } from './ui.js';
import { initTheme } from './theme.js';
import { createFocusTrap } from './a11y.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseBookPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'book' || parts.length < 3) return null;
  return { username: parts[1], slug: parts[2] };
}

function formatTime(iso, tz) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

function formatDateHeading(date, tz) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: tz,
    }).format(date);
  } catch {
    return date.toDateString();
  }
}

function dateKeyInTz(iso, tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(0, 10);
  }
}

function groupSlotsByDate(slots, tz) {
  const map = new Map();
  for (const slot of slots) {
    const key = dateKeyInTz(slot.start, tz);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(slot);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }
  return map;
}

function buildTimezoneOptions(selected, hostTz) {
  const detected = detectBrowserTimezone();
  const zones = [...new Set([detected, hostTz, selected, ...COMMON_TIMEZONES].filter(Boolean))];
  return zones
    .map((tz) => `<option value="${tz}">${tz.replace(/_/g, ' ')}</option>`)
    .join('');
}

function renderCalendarMonth(viewDate, slotsByDate, selectedKey, tz) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = dateKeyInTz(new Date().toISOString(), tz);

  let cells = '';
  for (let i = 0; i < startPad; i++) {
    cells += '<td class="cal-day cal-day-empty" aria-hidden="true"></td>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const key = dateKeyInTz(d.toISOString(), tz);
    const hasSlots = slotsByDate.has(key);
    const isSelected = key === selectedKey;
    const isToday = key === todayKey;
    const disabled = !hasSlots;
    cells += `<td class="cal-day${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${disabled ? ' is-disabled' : ''}">
      <button type="button" class="cal-day-btn" data-date="${key}" ${disabled ? 'disabled aria-disabled="true"' : ''} aria-label="${MONTHS[month]} ${day}${hasSlots ? ', times available' : ', no times'}">${day}</button>
    </td>`;
    if ((startPad + day) % 7 === 0 && day < daysInMonth) {
      cells += '</tr><tr>';
    }
  }

  return `
    <div class="cal-header">
      <button type="button" class="cal-nav-btn" id="cal-prev" aria-label="Previous month">&larr;</button>
      <h2 class="cal-month-label" id="cal-month-label">${MONTHS[month]} ${year}</h2>
      <button type="button" class="cal-nav-btn" id="cal-next" aria-label="Next month">&rarr;</button>
    </div>
    <table class="cal-table" role="grid" aria-labelledby="cal-month-label">
      <thead>
        <tr>${WEEKDAYS.map((d) => `<th scope="col" abbr="${d}">${d.charAt(0)}</th>`).join('')}</tr>
      </thead>
      <tbody><tr>${cells}</tr></tbody>
    </table>`;
}

function renderTimeGrid(slots, selectedSlot, tz) {
  if (!slots?.length) {
    return `<p class="book-no-slots" role="status">No times available this day. Try another date.</p>`;
  }
  return `
    <div class="time-grid" role="listbox" aria-label="Available times">
      ${slots
        .map((slot) => {
          const selected = selectedSlot?.start === slot.start;
          return `<button type="button" class="time-slot-btn${selected ? ' is-selected' : ''}" role="option" aria-selected="${selected}" data-start="${slot.start}" data-end="${slot.end}">${formatTime(slot.start, tz)}</button>`;
        })
        .join('')}
    </div>`;
}

function renderGuestForm(selectedSlot, tz) {
  const label = selectedSlot
    ? formatDateHeading(new Date(selectedSlot.start), tz) + ' · ' + formatTime(selectedSlot.start, tz)
    : '';
  return `
    <section class="guest-form-panel" aria-labelledby="guest-form-heading">
      <h2 id="guest-form-heading">Enter your details</h2>
      <p class="booking-sub">Selected: <strong>${label}</strong></p>
      <form id="guest-book-form" novalidate>
        <div class="form-field">
          <label for="guest-name">Name</label>
          <input type="text" id="guest-name" name="guestName" autocomplete="name" required aria-required="true" />
        </div>
        <div class="form-field">
          <label for="guest-email">Email</label>
          <input type="email" id="guest-email" name="guestEmail" autocomplete="email" required aria-required="true" />
        </div>
        <div class="form-field">
          <label for="guest-notes">Notes (optional)</label>
          <textarea id="guest-notes" name="guestNotes" rows="2"></textarea>
        </div>
        <div class="guest-form-actions">
          <button type="button" class="btn ghost" id="guest-back">Back</button>
          <button type="submit" class="btn primary" id="guest-submit">Confirm booking</button>
        </div>
      </form>
    </section>`;
}

function renderConfirmed(data, slotLabel) {
  return `
    <div class="booking-confirmed" role="status">
      <h1>You&apos;re booked</h1>
      <p class="booking-sub">${slotLabel ?? ''}</p>
      <p class="booking-sub">A calendar invite will be sent to your email shortly.</p>
      ${data.host?.name ? `<p class="booking-tz-note">Meeting with ${escapeHtml(data.host.name)}</p>` : ''}
    </div>`;
}

function renderError(message) {
  return `
    <div class="booking-empty" role="alert">
      <h1>Unable to load booking page</h1>
      <p class="booking-sub">${escapeHtml(message)}</p>
      <a href="/" class="btn primary">Go to Caladdin</a>
    </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchBookingData(username, slug) {
  const headers = { Accept: 'application/json' };
  const metaRes = await fetch(`/book/${encodeURIComponent(username)}/${encodeURIComponent(slug)}?format=json`, {
    headers,
  });
  const meta = metaRes.headers.get('content-type')?.includes('json') ? await metaRes.json() : null;
  if (!metaRes.ok) {
    throw new Error(meta?.error ?? 'Booking page not found');
  }

  const slotsRes = await fetch(
    `/book/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/slots?daysAhead=30`,
    { headers },
  );
  const slotsBody = slotsRes.headers.get('content-type')?.includes('json') ? await slotsRes.json() : null;
  if (!slotsRes.ok) {
    throw new Error(slotsBody?.error ?? 'Could not load available times');
  }

  return {
    ...meta,
    slots: slotsBody?.slots ?? [],
  };
}

function initBookFlow(data) {
  const root = document.getElementById('booking-root');
  if (!root) return;

  const hostTz = data.host?.timezone ?? 'America/Chicago';
  let guestTz = detectBrowserTimezone();
  let viewDate = new Date();
  let selectedDateKey = null;
  let selectedSlot = null;
  let step = 'pick'; // pick | guest | done
  let releaseTrap = null;

  const slotsByDate = groupSlotsByDate(data.slots ?? [], guestTz);

  // First available date
  const sortedKeys = [...slotsByDate.keys()].sort();
  if (sortedKeys.length > 0) {
    selectedDateKey = sortedKeys[0];
    const [y, m] = selectedDateKey.split('-').map(Number);
    viewDate = new Date(y, m - 1, 1);
  }

  function render() {
    if (step === 'done') return;

    const duration = data.eventType?.durationMinutes ?? 30;
    const hostName = data.host?.name ?? data.host?.username ?? 'Host';
    const daySlots = selectedDateKey ? slotsByDate.get(selectedDateKey) ?? [] : [];

    if (step === 'guest' && selectedSlot) {
      root.innerHTML = `
        <div class="book-layout book-layout-single">
          <aside class="book-sidebar">
            <p class="book-host-label">${escapeHtml(hostName)}</p>
            <h1 class="book-event-title">${escapeHtml(data.eventType?.name ?? 'Meeting')}</h1>
            <p class="book-meta">${duration} min</p>
            ${data.eventType?.description ? `<p class="book-desc">${escapeHtml(data.eventType.description)}</p>` : ''}
          </aside>
          <div class="book-main-panel">${renderGuestForm(selectedSlot, guestTz)}</div>
        </div>`;
      bindGuestForm();
      const panel = root.querySelector('.guest-form-panel');
      if (panel) {
        releaseTrap?.();
        releaseTrap = createFocusTrap(panel);
      }
      return;
    }

    root.innerHTML = `
      <div class="book-layout">
        <aside class="book-sidebar" aria-label="Event details">
          <p class="book-host-label">${escapeHtml(hostName)}</p>
          <h1 class="book-event-title">${escapeHtml(data.eventType?.name ?? 'Meeting')}</h1>
          <p class="book-meta">${duration} min</p>
          ${data.eventType?.description ? `<p class="book-desc">${escapeHtml(data.eventType.description)}</p>` : ''}
          <div class="form-field book-tz-field">
            <label for="guest-tz">Timezone</label>
            <select id="guest-tz" aria-label="Your timezone">${buildTimezoneOptions(guestTz, hostTz)}</select>
          </div>
        </aside>
        <div class="book-main-panel">
          <div class="book-step-header">
            <h2 class="book-step-title">${selectedDateKey ? formatDateHeading(new Date(selectedDateKey + 'T12:00:00'), guestTz) : 'Select a date'}</h2>
          </div>
          <div class="book-picker-row">
            <div class="book-calendar-panel" aria-label="Calendar">
              ${renderCalendarMonth(viewDate, slotsByDate, selectedDateKey, guestTz)}
            </div>
            <div class="book-times-panel" aria-label="Available times">
              ${renderTimeGrid(daySlots, selectedSlot, guestTz)}
            </div>
          </div>
          <div class="book-continue-row">
            <button type="button" class="btn primary" id="book-continue" ${selectedSlot ? '' : 'disabled'}>Continue</button>
          </div>
        </div>
      </div>`;

    const tzSelect = document.getElementById('guest-tz');
    if (tzSelect) tzSelect.value = guestTz;

    tzSelect?.addEventListener('change', () => {
      guestTz = tzSelect.value;
      const regrouped = groupSlotsByDate(data.slots ?? [], guestTz);
      slotsByDate.clear();
      for (const [k, v] of regrouped) slotsByDate.set(k, v);
      selectedSlot = null;
      render();
    });

    root.querySelector('#cal-prev')?.addEventListener('click', () => {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
      render();
    });
    root.querySelector('#cal-next')?.addEventListener('click', () => {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
      render();
    });

    root.querySelectorAll('.cal-day-btn:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedDateKey = btn.dataset.date ?? null;
        selectedSlot = null;
        render();
      });
    });

    root.querySelectorAll('.time-slot-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedSlot = { start: btn.dataset.start, end: btn.dataset.end };
        render();
      });
    });

    root.querySelector('#book-continue')?.addEventListener('click', () => {
      if (!selectedSlot) return;
      step = 'guest';
      render();
    });
  }

  function bindGuestForm() {
    document.getElementById('guest-back')?.addEventListener('click', () => {
      releaseTrap?.();
      releaseTrap = null;
      step = 'pick';
      render();
    });

    document.getElementById('guest-book-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const name = form.guestName?.value?.trim();
      const email = form.guestEmail?.value?.trim();
      const notes = form.guestNotes?.value?.trim();

      form.querySelectorAll('.field-error').forEach((el) => el.remove());
      form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));

      let valid = true;
      if (!name) {
        showFieldError(form.guestName, 'Please enter your name.');
        valid = false;
      }
      if (!email) {
        showFieldError(form.guestEmail, 'Please enter your email.');
        valid = false;
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showFieldError(form.guestEmail, 'Please enter a valid email.');
        valid = false;
      }
      if (!valid) return;

      const submitBtn = document.getElementById('guest-submit');
      submitBtn.disabled = true;
      submitBtn.classList.add('is-loading');
      submitBtn.setAttribute('aria-busy', 'true');

      const path = parseBookPath();
      try {
        const res = await fetch(
          `/book/${encodeURIComponent(path.username)}/${encodeURIComponent(path.slug)}/select`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slotStart: selectedSlot.start,
              guest: { name, email, notes: notes || undefined },
            }),
          },
        );
        const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;

        if (res.ok) {
          releaseTrap?.();
          step = 'done';
          root.innerHTML = renderConfirmed(data, body?.slotLabel);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        const messages = {
          name_required: 'Please enter your name.',
          email_required: 'Please enter your email.',
          email_invalid: 'Please enter a valid email.',
          slot_unavailable: 'That time was just taken. Please pick another.',
          rate_limit_exceeded: 'Too many attempts. Wait a moment and try again.',
          paused: 'Booking is temporarily unavailable.',
          calendar_unavailable: 'Calendar is not connected. Contact your host.',
          gcal_failed: 'Could not create the calendar event. Try another time.',
        };
        const msg = messages[body?.error] ?? body?.message ?? 'Something went wrong. Please try again.';
        showToast(msg, 'error');
      } catch {
        showToast('Network error. Check your connection and try again.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-loading');
        submitBtn.setAttribute('aria-busy', 'false');
      }
    });
  }

  function showFieldError(input, message) {
    if (!input) return;
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    const err = document.createElement('p');
    err.className = 'field-error';
    err.setAttribute('role', 'alert');
    err.textContent = message;
    input.parentElement?.appendChild(err);
    input.focus();
  }

  render();
}

async function init() {
  initTheme();
  const path = parseBookPath();
  const root = document.getElementById('booking-root');
  if (!path || !root) {
    if (root) root.innerHTML = renderError('Invalid booking URL.');
    return;
  }

  try {
    const data = await fetchBookingData(path.username, path.slug);
    document.title = `${data.eventType?.name ?? 'Book'} — Caladdin`;
    initBookFlow(data);
  } catch (err) {
    root.innerHTML = renderError(err.message ?? 'Booking page not found.');
    showToast(err.message ?? 'Booking page not found', 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
