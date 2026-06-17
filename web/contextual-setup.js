import { COMMON_TIMEZONES, detectBrowserTimezone } from './ui.js';

/**
 * MVP inline mini-form fallback inside a chat bubble (timezone select, time range, etc.).
 * @param {HTMLElement} messagesEl
 * @param {{ setupField?: string; formType?: string; pendingUtterance?: string }} data
 * @param {{ api: Function; onComplete: () => void | Promise<void> }} hooks
 */
export function mountContextualSetupForm(messagesEl, data, { api, onComplete }) {
  if (!messagesEl || !data?.setupField) return;

  const bubble = document.createElement('div');
  bubble.className = 'message bot contextual-setup-form';
  bubble.setAttribute('data-setup-field', data.setupField);

  const form = document.createElement('form');
  form.className = 'contextual-setup-inner';
  form.setAttribute('aria-label', 'Quick setup');

  const field = data.setupField;
  const formType = data.formType ?? field;

  if (formType === 'timezone') {
    const label = document.createElement('label');
    label.textContent = 'Timezone';
    const select = document.createElement('select');
    select.name = 'timezone';
    select.required = true;
    const detected = detectBrowserTimezone();
    const zones = [...new Set([detected, ...COMMON_TIMEZONES])];
    select.innerHTML = zones
      .map((tz) => `<option value="${tz}">${tz.replace(/_/g, ' ')}</option>`)
      .join('');
    select.value = detected;
    label.appendChild(select);
    form.appendChild(label);
  } else if (formType === 'timeRange') {
    const row = document.createElement('div');
    row.className = 'contextual-setup-row';
    const startLabel = document.createElement('label');
    startLabel.textContent = 'From';
    const start = document.createElement('input');
    start.type = 'time';
    start.name = 'workingHoursStart';
    start.value = '09:00';
    start.required = true;
    startLabel.appendChild(start);
    const endLabel = document.createElement('label');
    endLabel.textContent = 'To';
    const end = document.createElement('input');
    end.type = 'time';
    end.name = 'workingHoursEnd';
    end.value = '18:00';
    end.required = true;
    endLabel.appendChild(end);
    row.append(startLabel, endLabel);
    form.appendChild(row);
  } else if (formType === 'duration') {
    const label = document.createElement('label');
    label.textContent = 'Default meeting length (minutes)';
    const select = document.createElement('select');
    select.name = 'defaultMeetingLengthMinutes';
    select.required = true;
    for (const mins of [15, 30, 45, 60, 90]) {
      const opt = document.createElement('option');
      opt.value = String(mins);
      opt.textContent = `${mins} minutes`;
      if (mins === 30) opt.selected = true;
      select.appendChild(opt);
    }
    label.appendChild(select);
    form.appendChild(label);
  } else if (formType === 'preference') {
    const label = document.createElement('label');
    label.textContent = 'Meeting time preference';
    const select = document.createElement('select');
    select.name = 'meetingTimePreference';
    select.required = true;
    select.innerHTML = `
      <option value="morning">Morning</option>
      <option value="afternoon">Afternoon</option>
      <option value="flexible">Flexible</option>
    `;
    label.appendChild(select);
    form.appendChild(label);
  }

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn primary';
  submit.textContent = 'Save';
  form.appendChild(submit);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    submit.disabled = true;
    const body = { setupFieldAnswered: field };
    const fd = new FormData(form);
    if (field === 'timezone') body.timezone = String(fd.get('timezone') ?? '');
    if (field === 'workingHours') {
      body.workingHoursStart = String(fd.get('workingHoursStart') ?? '');
      body.workingHoursEnd = String(fd.get('workingHoursEnd') ?? '');
    }
    if (field === 'defaultMeetingLength') {
      body.defaultMeetingLengthMinutes = Number(fd.get('defaultMeetingLengthMinutes') ?? 30);
    }
    if (field === 'meetingTimePreference') {
      body.meetingTimePreference = String(fd.get('meetingTimePreference') ?? 'flexible');
    }

    try {
      const { res } = await api('/api/profile', { method: 'PATCH', body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Could not save setup');
      bubble.classList.add('contextual-setup-done');
      submit.textContent = 'Saved';
      await onComplete?.();
    } catch {
      submit.disabled = false;
      submit.textContent = 'Try again';
    }
  });

  bubble.appendChild(form);
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
