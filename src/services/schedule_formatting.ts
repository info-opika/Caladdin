import { DateTime } from 'luxon';

/** IANA zone abbreviation via Intl (IST, CST, CDT) — avoids GMT+offset fallbacks. */
export function formatTimezoneLabel(tz: string, at?: Date): string {
  const sample = at ?? new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(sample);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (name && !/^GMT[+-]/.test(name)) return name;
  } catch {
    // fall through
  }
  const dt = DateTime.fromJSDate(sample, { zone: tz });
  if (dt.isValid) {
    const short = dt.offsetNameShort;
    if (short && !/^GMT[+-]/.test(short)) return short;
  }
  return tz.replace(/_/g, ' ');
}

export function formatSlotLabel(slot: { start: string; end: string }, tz: string): string {
  const start = DateTime.fromISO(slot.start, { zone: tz });
  const end = DateTime.fromISO(slot.end, { zone: tz });
  if (!start.isValid) return slot.start;
  const tzLabel = formatTimezoneLabel(tz, start.toJSDate());
  return `${start.toFormat('cccc, MMM d')} · ${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')} (${tzLabel})`;
}

export function formatSlotButtonLabel(slot: { start: string; end: string }, tz: string): string {
  const start = DateTime.fromISO(slot.start, { zone: tz });
  if (!start.isValid) return slot.start;
  const tzLabel = formatTimezoneLabel(tz, start.toJSDate());
  return `${start.toFormat('ccc, h:mm a')} ${tzLabel}`;
}

/** Invitee-facing button label in the invitee's local timezone. */
export function formatSlotButtonLabelForInvitee(
  slot: { start: string; end: string },
  inviteeTz: string,
): string {
  return formatSlotButtonLabel(slot, inviteeTz);
}

/** Host time line shown when invitee expands "host's time" toggle. */
export function formatSlotHostTimeLine(
  slot: { start: string; end: string },
  hostTz: string,
): string {
  const start = DateTime.fromISO(slot.start, { zone: hostTz });
  if (!start.isValid) return '';
  const tzLabel = formatTimezoneLabel(hostTz, start.toJSDate());
  return `Host: ${start.toFormat('ccc, h:mm a')} ${tzLabel}`;
}

export function zonesDiffer(a: string, b: string): boolean {
  return a.trim() !== b.trim();
}
