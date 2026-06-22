export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addMinutes(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMinutes(r.getMinutes() + n);
  return r;
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Start of ISO week (Monday) in local time */
export function startOfWeek(d: Date): Date {
  const r = startOfDay(d);
  const day = r.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + diff);
  return r;
}

/** Parse week anchor from `YYYY-MM-DD` (local) or ISO datetime without TZ drift on Mondays. */
export function parseWeekStartParam(startParam: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startParam.trim());
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    return startOfWeek(new Date(year, month - 1, day));
  }
  const parsed = new Date(startParam);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid week start');
  }
  return startOfWeek(parsed);
}

export function formatWeekStartDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function setHours(d: Date, h: number): Date {
  const r = new Date(d);
  r.setHours(h);
  return r;
}

export function setMinutes(d: Date, m: number): Date {
  const r = new Date(d);
  r.setMinutes(m);
  return r;
}

export function formatISO(d: Date): string {
  return d.toISOString();
}

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Map natural-language timezone phrases to IANA zones. */
export function extractTimezoneFromUtterance(utterance: string): string | undefined {
  const lower = utterance.toLowerCase();
  if (/\b(central time|central time zone|us central|america\/chicago)\b/.test(lower)) return 'America/Chicago';
  if (/\b(eastern time|eastern time zone|us eastern|america\/new_york)\b/.test(lower)) return 'America/New_York';
  if (/\b(pacific time|pacific time zone|us pacific|america\/los_angeles)\b/.test(lower)) return 'America/Los_Angeles';
  if (/\b(mountain time|mountain time zone|us mountain|america\/denver)\b/.test(lower)) return 'America/Denver';
  if (/\b(ct|cst|cdt)\b/.test(lower)) return 'America/Chicago';
  if (/\b(et|est|edt)\b/.test(lower)) return 'America/New_York';
  if (/\b(pt|pst|pdt)\b/.test(lower)) return 'America/Los_Angeles';
  if (/\b(mt|mst|mdt)\b/.test(lower)) return 'America/Denver';
  if (/\bcentral\b/.test(lower)) return 'America/Chicago';
  if (/\beastern\b/.test(lower)) return 'America/New_York';
  if (/\bpacific\b/.test(lower)) return 'America/Los_Angeles';
  if (/\bmountain\b/.test(lower)) return 'America/Denver';
  return undefined;
}

export function getLocalPartsInTimezone(date: Date, timeZone: string): {
  year: number; month: number; day: number; weekday: number; hour: number; minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const hour = parseInt(get('hour'), 10);
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    weekday: WEEKDAY_SHORT[get('weekday')] ?? 0,
    hour: hour === 24 ? 0 : hour,
    minute: parseInt(get('minute'), 10),
  };
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
export function zonedLocalToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  let guess = desired;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(guess))
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value]),
    );
    const shownHour = parseInt(parts.hour, 10);
    const shown = Date.UTC(
      parseInt(parts.year, 10),
      parseInt(parts.month, 10) - 1,
      parseInt(parts.day, 10),
      shownHour === 24 ? 0 : shownHour,
      parseInt(parts.minute, 10),
      parseInt(parts.second, 10),
    );
    guess += desired - shown;
  }
  return new Date(guess);
}

/** Format a UTC instant as a local datetime string for Google Calendar (no offset). */
export function formatZonedDateTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}`;
}

/** Next Mon–Fri occurrence at the given local time in `timeZone`. */
export function nextWeekdayOccurrence(
  ref: Date,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  for (let offset = 0; offset < 8; offset++) {
    const probe = addDays(ref, offset);
    const local = getLocalPartsInTimezone(probe, timeZone);
    const isWeekday = local.weekday >= 1 && local.weekday <= 5;
    if (!isWeekday) continue;
    const candidate = zonedLocalToUtcDate(local.year, local.month, local.day, hour, minute, timeZone);
    if (candidate.getTime() >= ref.getTime()) return candidate;
  }
  const fallback = getLocalPartsInTimezone(addDays(ref, 1), timeZone);
  return zonedLocalToUtcDate(fallback.year, fallback.month, fallback.day, hour, minute, timeZone);
}

export function parseRelativeTime(utterance: string, ref = new Date()): { start: string; end: string } | null {
  const lower = utterance.toLowerCase();
  const day = startOfDay(ref);
  if (lower.includes('tomorrow')) {
    const t = addDays(day, 1);
    return { start: formatISO(t), end: formatISO(addDays(t, 1)) };
  }
  if (lower.includes('today')) {
    return { start: formatISO(day), end: formatISO(addDays(day, 1)) };
  }
  if (lower.includes('friday')) {
    const d = new Date(ref);
    const diff = (5 - d.getDay() + 7) % 7 || 7;
    const fri = addDays(day, diff);
    return { start: formatISO(fri), end: formatISO(addDays(fri, 1)) };
  }
  return { start: formatISO(day), end: formatISO(addDays(day, 7)) };
}

export function parseISO(iso: string): Date {
  return new Date(iso);
}

export function parseOptionalIso(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Safe timeMin/timeMax for Google Calendar API (RFC3339). Ignores bad LLM params. */
export function normalizeGCalRange(
  rangeStart?: unknown,
  rangeEnd?: unknown,
  defaultDays = 7,
): { timeMin: string; timeMax: string } {
  const now = new Date();
  let start = parseOptionalIso(rangeStart) ?? now;
  let end = parseOptionalIso(rangeEnd) ?? addDays(now, defaultDays);

  if (end.getTime() <= start.getTime()) {
    end = addDays(start, defaultDays);
  }

  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

export function gcalErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const gaxios = err as { response?: { data?: unknown }; message?: string };
    if (gaxios.response?.data) {
      return JSON.stringify(gaxios.response.data);
    }
    if (gaxios.message) return gaxios.message;
  }
  return String(err);
}
