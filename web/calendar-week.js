/** Read-only Mon–Sun week grid with Caladdin event source color-coding. */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfWeekMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDayHeader(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTimeRange(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const opts = { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleTimeString(undefined, opts)} – ${end.toLocaleTimeString(undefined, opts)}`;
}

function dayIndexForEvent(eventStartIso, weekStart) {
  const eventDay = new Date(eventStartIso);
  eventDay.setHours(0, 0, 0, 0);
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const diff = Math.round((eventDay - start) / (24 * 60 * 60 * 1000));
  return diff >= 0 && diff < 7 ? diff : -1;
}

function displayTitle(title) {
  return title.replace(/^\[(Protected|Proposed)\]\s*/i, '').trim() || title;
}

export function createCalendarWeek({ container, fetchWeek }) {
  if (!container) {
    return { refresh: async () => {}, destroy: () => {} };
  }

  let weekStart = startOfWeekMonday(new Date());
  let loading = false;

  function renderShell() {
    container.innerHTML = `
      <div class="calendar-week-header">
        <button type="button" class="btn ghost calendar-week-nav" data-dir="prev" aria-label="Previous week">‹</button>
        <h3 class="calendar-week-title" id="calendar-week-title"></h3>
        <button type="button" class="btn ghost calendar-week-nav" data-dir="next" aria-label="Next week">›</button>
      </div>
      <div class="calendar-week-legend" aria-hidden="true">
        <span class="legend-item source-caladdin_block">Blocks</span>
        <span class="legend-item source-caladdin_invite">Meetings</span>
        <span class="legend-item source-external">Other</span>
      </div>
      <div class="calendar-week-scroll">
        <div class="calendar-week-grid" role="grid" aria-labelledby="calendar-week-title"></div>
      </div>
      <p class="calendar-week-empty hidden" role="status">No events this week.</p>
    `;

    container.querySelectorAll('.calendar-week-nav').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.dir;
        weekStart = addDays(weekStart, dir === 'prev' ? -7 : 7);
        void refresh();
      });
    });
  }

  function renderWeek(data) {
    const titleEl = container.querySelector('#calendar-week-title');
    const grid = container.querySelector('.calendar-week-grid');
    const emptyEl = container.querySelector('.calendar-week-empty');
    if (!grid) return;

    const start = new Date(data.start);
    weekStart = startOfWeekMonday(start);
    const end = addDays(weekStart, 6);
    if (titleEl) {
      titleEl.textContent = `${formatDayHeader(weekStart)} – ${formatDayHeader(end)}`;
    }

    const byDay = Array.from({ length: 7 }, () => []);
    for (const ev of data.events ?? []) {
      const idx = dayIndexForEvent(ev.start, weekStart);
      if (idx >= 0) byDay[idx].push(ev);
    }

    grid.innerHTML = DAY_LABELS.map((label, i) => {
      const dayDate = addDays(weekStart, i);
      const isToday = dayDate.toDateString() === new Date().toDateString();
      const events = byDay[i]
        .sort((a, b) => new Date(a.start) - new Date(b.start))
        .slice(0, 8);
      const overflow = byDay[i].length - events.length;
      const eventsHtml = events
        .map(
          (ev) => `
            <article class="calendar-week-event source-${ev.source}" title="${displayTitle(ev.title)}">
              <span class="calendar-week-event-time">${formatTimeRange(ev.start, ev.end)}</span>
              <span class="calendar-week-event-title">${displayTitle(ev.title)}</span>
            </article>
          `,
        )
        .join('');
      const moreHtml =
        overflow > 0
          ? `<p class="calendar-week-more">+${overflow} more</p>`
          : '';
      return `
        <div class="calendar-week-day${isToday ? ' is-today' : ''}" role="gridcell">
          <header class="calendar-week-day-head">
            <span class="calendar-week-day-name">${label}</span>
            <span class="calendar-week-day-date">${dayDate.getDate()}</span>
          </header>
          <div class="calendar-week-day-events">${eventsHtml}${moreHtml}</div>
        </div>
      `;
    }).join('');

    const hasEvents = (data.events ?? []).length > 0;
    emptyEl?.classList.toggle('hidden', hasEvents);
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    container.classList.add('is-loading');
    try {
      const data = await fetchWeek(weekStart.toISOString());
      renderWeek(data);
    } catch {
      const emptyEl = container.querySelector('.calendar-week-empty');
      if (emptyEl) {
        emptyEl.textContent = 'Could not load calendar.';
        emptyEl.classList.remove('hidden');
      }
    } finally {
      loading = false;
      container.classList.remove('is-loading');
    }
  }

  renderShell();
  void refresh();

  return {
    refresh,
    destroy() {
      container.innerHTML = '';
    },
  };
}
