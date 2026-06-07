import { addMinutes } from './date-utils.js';
import type { UserPolicyProfile } from './adts.js';

export interface WeeklyAvailabilityWindow {
  /** 0 = Sunday … 6 = Saturday (matches JavaScript Date#getDay) */
  day: number;
  start: string;
  end: string;
}

export interface EventTypeAvailabilityRules {
  workingHoursStart?: string;
  workingHoursEnd?: string;
  weeklySchedule?: WeeklyAvailabilityWindow[];
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  /** Shorthand applied to both sides when before/after omitted */
  bufferMinutes?: number;
  minimumNoticeMinutes?: number;
}

export interface ParsedAvailability {
  workingHoursStart: string;
  workingHoursEnd: string;
  weeklySchedule: WeeklyAvailabilityWindow[];
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
}

const TIME_RE = /^(\d{2}):(\d{2})$/;

function parseTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !TIME_RE.test(value)) return fallback;
  return value;
}

function parseMinutes(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function parseWeeklySchedule(raw: unknown): WeeklyAvailabilityWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: WeeklyAvailabilityWindow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const day = (entry as { day?: unknown }).day;
    const start = (entry as { start?: unknown }).start;
    const end = (entry as { end?: unknown }).end;
    if (typeof day !== 'number' || day < 0 || day > 6) continue;
    if (typeof start !== 'string' || typeof end !== 'string') continue;
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) continue;
    out.push({ day, start, end });
  }
  return out;
}

export function parseAvailabilityRules(
  rules: Record<string, unknown> | undefined,
  policyDefaults?: Pick<UserPolicyProfile, 'workingHoursStart' | 'workingHoursEnd' | 'defaultBufferMinutes'>,
): ParsedAvailability {
  const r = rules ?? {};
  const bufferMinutes = parseMinutes(r.bufferMinutes, policyDefaults?.defaultBufferMinutes ?? 0);
  const bufferBefore = parseMinutes(r.bufferBeforeMinutes, bufferMinutes);
  const bufferAfter = parseMinutes(r.bufferAfterMinutes, bufferMinutes);

  return {
    workingHoursStart: parseTime(r.workingHoursStart, policyDefaults?.workingHoursStart ?? '09:00'),
    workingHoursEnd: parseTime(r.workingHoursEnd, policyDefaults?.workingHoursEnd ?? '18:00'),
    weeklySchedule: parseWeeklySchedule(r.weeklySchedule),
    bufferBeforeMinutes: bufferBefore,
    bufferAfterMinutes: bufferAfter,
    minimumNoticeMinutes: parseMinutes(r.minimumNoticeMinutes, 0),
  };
}

export function applyAvailabilityToPolicy(
  policy: UserPolicyProfile,
  rules: Record<string, unknown> | undefined,
): UserPolicyProfile {
  const parsed = parseAvailabilityRules(rules, policy);
  return {
    ...policy,
    workingHoursStart: parsed.workingHoursStart,
    workingHoursEnd: parsed.workingHoursEnd,
    defaultBufferMinutes: Math.max(policy.defaultBufferMinutes ?? 0, parsed.bufferBeforeMinutes, parsed.bufferAfterMinutes),
  };
}

export function windowsForDay(
  day: Date,
  parsed: ParsedAvailability,
): Array<{ startH: number; startM: number; endH: number; endM: number }> {
  const dayOfWeek = day.getDay();

  if (parsed.weeklySchedule.length > 0) {
    return parsed.weeklySchedule
      .filter((w) => w.day === dayOfWeek)
      .map((w) => {
        const [startH, startM] = w.start.split(':').map(Number);
        const [endH, endM] = w.end.split(':').map(Number);
        return { startH, startM, endH, endM };
      });
  }

  const [startH, startM] = parsed.workingHoursStart.split(':').map(Number);
  const [endH, endM] = parsed.workingHoursEnd.split(':').map(Number);
  return [{ startH, startM, endH, endM }];
}

export function expandBusyWithBuffers<T extends { start: string; end: string }>(
  busy: T[],
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number,
): T[] {
  if (bufferBeforeMinutes <= 0 && bufferAfterMinutes <= 0) return busy;
  return busy.map((b) => ({
    ...b,
    start: addMinutes(new Date(b.start), -bufferBeforeMinutes).toISOString(),
    end: addMinutes(new Date(b.end), bufferAfterMinutes).toISOString(),
  }));
}

export function isAfterMinimumNotice(slotStart: Date, now: Date, minimumNoticeMinutes: number): boolean {
  if (minimumNoticeMinutes <= 0) return true;
  return slotStart.getTime() >= addMinutes(now, minimumNoticeMinutes).getTime();
}
