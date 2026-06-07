/** Weekly availability visual editor */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_DAY = { enabled: true, start: '09:00', end: '18:00' };
const DEFAULT_WEEKEND = { enabled: false, start: '09:00', end: '18:00' };

/**
 * @param {Record<string, unknown>} rules
 * @param {{ start: string; end: string }} fallback
 */
export function parseWeeklyHours(rules, fallback) {
  const weekly = rules?.weeklyHours;
  if (weekly && typeof weekly === 'object') {
    return DAY_KEYS.reduce((acc, key) => {
      const row = weekly[key];
      if (row && typeof row === 'object') {
        acc[key] = {
          enabled: row.enabled !== false,
          start: typeof row.start === 'string' ? row.start : fallback.start,
          end: typeof row.end === 'string' ? row.end : fallback.end,
        };
      } else {
        acc[key] = key === 'sun' || key === 'sat' ? { ...DEFAULT_WEEKEND } : { ...DEFAULT_DAY, start: fallback.start, end: fallback.end };
      }
      return acc;
    }, {});
  }

  return DAY_KEYS.reduce((acc, key) => {
    acc[key] = key === 'sun' || key === 'sat'
      ? { ...DEFAULT_WEEKEND }
      : { enabled: true, start: fallback.start, end: fallback.end };
    return acc;
  }, {});
}

/**
 * @param {Record<string, { enabled: boolean; start: string; end: string }>} weeklyHours
 */
export function serializeWeeklyHours(weeklyHours) {
  return { weeklyHours };
}

/**
 * Derive global working hours from weekly schedule (earliest start / latest end on enabled days).
 * @param {Record<string, { enabled: boolean; start: string; end: string }>} weeklyHours
 */
export function deriveGlobalHours(weeklyHours) {
  const enabled = DAY_KEYS.map((k) => weeklyHours[k]).filter((d) => d?.enabled);
  if (enabled.length === 0) return { workingHoursStart: '09:00', workingHoursEnd: '18:00' };
  const starts = enabled.map((d) => d.start).sort();
  const ends = enabled.map((d) => d.end).sort();
  return { workingHoursStart: starts[0], workingHoursEnd: ends[ends.length - 1] };
}

/**
 * @param {HTMLElement} container
 * @param {{ weeklyHours: Record<string, { enabled: boolean; start: string; end: string }>; onChange?: () => void }} opts
 */
export function mountWeeklyAvailabilityEditor(container, { weeklyHours, onChange }) {
  container.innerHTML = '';
  container.className = 'weekly-hours-editor';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Weekly availability');

  const table = document.createElement('div');
  table.className = 'weekly-hours-grid';

  DAY_KEYS.forEach((key, index) => {
    const day = weeklyHours[key] ?? DEFAULT_DAY;
    const row = document.createElement('div');
    row.className = `weekly-hours-row${day.enabled ? '' : ' is-disabled'}`;
    row.innerHTML = `
      <label class="weekly-day-toggle">
        <input type="checkbox" data-day="${key}" ${day.enabled ? 'checked' : ''} aria-label="${DAY_LABELS[index]} available" />
        <span class="weekly-day-label">${DAY_LABELS[index]}</span>
      </label>
      <div class="weekly-day-times">
        <label class="sr-only" for="wh-start-${key}">${DAY_LABELS[index]} start</label>
        <input type="time" id="wh-start-${key}" data-day="${key}" data-field="start" value="${day.start}" ${day.enabled ? '' : 'disabled'} />
        <span aria-hidden="true">–</span>
        <label class="sr-only" for="wh-end-${key}">${DAY_LABELS[index]} end</label>
        <input type="time" id="wh-end-${key}" data-day="${key}" data-field="end" value="${day.end}" ${day.enabled ? '' : 'disabled'} />
      </div>`;
    table.appendChild(row);
  });

  container.appendChild(table);

  function syncFromDom() {
    container.querySelectorAll('.weekly-hours-row').forEach((row) => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      const key = checkbox?.dataset.day;
      if (!key) return;
      const enabled = checkbox.checked;
      weeklyHours[key] = {
        enabled,
        start: row.querySelector('[data-field="start"]')?.value ?? '09:00',
        end: row.querySelector('[data-field="end"]')?.value ?? '18:00',
      };
      row.classList.toggle('is-disabled', !enabled);
      row.querySelectorAll('input[type="time"]').forEach((input) => {
        input.disabled = !enabled;
      });
    });
    onChange?.();
  }

  container.addEventListener('change', (e) => {
    if (e.target.matches('input')) syncFromDom();
  });

  return {
    getWeeklyHours: () => weeklyHours,
    setWeeklyHours(next) {
      Object.assign(weeklyHours, next);
      mountWeeklyAvailabilityEditor(container, { weeklyHours, onChange });
    },
  };
}

/**
 * @param {HTMLElement} container
 * @param {{ start: string; end: string; weeklyHours: Record<string, unknown>; onChange?: () => void }} opts
 */
export function mountAvailabilityEditor(container, { start, end, weeklyHours, onChange }) {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'availability-editor';

  const weeklyWrap = document.createElement('div');
  wrap.appendChild(weeklyWrap);

  const parsed = parseWeeklyHours({ weeklyHours }, { start, end });
  mountWeeklyAvailabilityEditor(weeklyWrap, {
    weeklyHours: parsed,
    onChange: () => {
      const derived = deriveGlobalHours(parsed);
      onChange?.({ weeklyHours: parsed, ...derived });
    },
  });

  container.appendChild(wrap);

  return {
    getValue() {
      const derived = deriveGlobalHours(parsed);
      return { weeklyHours: parsed, ...derived };
    },
  };
}
