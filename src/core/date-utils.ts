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
