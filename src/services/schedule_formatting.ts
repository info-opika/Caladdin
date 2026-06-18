import { DateTime } from 'luxon';

export function formatTimezoneLabel(tz: string): string {
  const sample = DateTime.now().setZone(tz);
  if (!sample.isValid) return tz.replace(/_/g, ' ');
  const short = sample.offsetNameShort;
  if (short) return short;
  return sample.toFormat('ZZZZ');
}

export function formatSlotLabel(slot: { start: string; end: string }, tz: string): string {
  const start = DateTime.fromISO(slot.start, { zone: tz });
  const end = DateTime.fromISO(slot.end, { zone: tz });
  if (!start.isValid) return slot.start;
  const tzLabel = formatTimezoneLabel(tz);
  return `${start.toFormat('cccc, MMM d')} · ${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')} (${tzLabel})`;
}

export function formatSlotButtonLabel(slot: { start: string; end: string }, tz: string): string {
  const start = DateTime.fromISO(slot.start, { zone: tz });
  if (!start.isValid) return slot.start;
  const tzLabel = formatTimezoneLabel(tz);
  return `${start.toFormat('ccc, h:mm a')} ${tzLabel}`;
}
