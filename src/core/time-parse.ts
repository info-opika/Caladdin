import { DateTime } from 'luxon';

/** Collapse "p m" / "a m" variants so downstream regexes match. */
export function normalizeSpacedAmPm(text: string): string {
  return text.replace(/\b([ap])\s*m\b/gi, (_, a: string) => `${a.toLowerCase()}m`);
}

/**
 * Parse a compact time token like "3:30pm", "2:00pm", "10:30am", "1pm", "3", "15:00" → 24h hour + minute.
 * P0 FIX: Now also handles time-of-day phrases (morning/afternoon/evening/night).
 * Returns null if not a readable clock time.
 */
export function parseClockTimeToken(token: string): { hour: number; minute: number } | null {
  const t = normalizeSpacedAmPm(token.toLowerCase().trim()).replace(/\s+/g, '');
  if (!t) return null;

  // P0 FIX: Recognize time-of-day phrases as deterministic time ranges
  // These should NOT require LLM classification
  if (t === 'morning') return { hour: 9, minute: 0 };  // 9am representative
  if (t === 'afternoon') return { hour: 14, minute: 0 };  // 2pm representative
  if (t === 'evening') return { hour: 18, minute: 0 };  // 6pm representative
  if (t === 'night') return { hour: 20, minute: 0 };  // 8pm representative

  const hmAmPm = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (hmAmPm) {
    let h = parseInt(hmAmPm[1]!, 10);
    const m = hmAmPm[2] ? parseInt(hmAmPm[2]!, 10) : 0;
    if (m >= 60) return null;
    const ap = hmAmPm[3]!;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || h < 0) return null;
    return { hour: h, minute: m };
  }

  if (/^\d{1,2}$/.test(t)) {
    const h = parseInt(t, 10);
    if (h === 12) return { hour: 12, minute: 0 };
    if (h >= 1 && h <= 11) return { hour: h + 12, minute: 0 };
    if (h === 0) return { hour: 0, minute: 0 };
    return null;
  }

  const h24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const h = parseInt(h24[1]!, 10);
    const m = parseInt(h24[2]!, 10);
    if (h >= 0 && h <= 23 && m >= 0 && m < 60) return { hour: h, minute: m };
  }

  return null;
}

export type AvailabilityDayAnchor = 'today' | 'tomorrow';

/** Detect which day availability refers to (default today). */
export function inferAvailabilityDayFromUtterance(rawNorm: string): AvailabilityDayAnchor {
  const n = rawNorm.toLowerCase();
  if (/\btomorrow\b|\btmrw\b|\bnext\s+day\b/.test(n)) return 'tomorrow';
  return 'today';
}

/** 
 * One-hour window starting at parsed local time on the given anchor day.
 * P0 FIX: For time-of-day phrases (morning/afternoon/evening/night), uses appropriate time ranges.
 */
export function availabilityHourWindowUtcMillis(
  anchor: AvailabilityDayAnchor,
  hm: { hour: number; minute: number },
  userTz: string
): { s: number; e: number } | null {
  const base =
    anchor === 'tomorrow'
      ? DateTime.now().setZone(userTz).plus({ days: 1 }).startOf('day')
      : DateTime.now().setZone(userTz).startOf('day');
  const start = base.set({ hour: hm.hour, minute: hm.minute, second: 0, millisecond: 0 });
  if (!start.isValid) return null;
  
  // P0 FIX: For time-of-day phrases, expand to cover the entire period
  // morning: 8am-12pm (4 hours), afternoon: 12pm-5pm (5 hours), evening: 5pm-9pm (4 hours), night: 8pm-11pm (3 hours)
  let durationHours = 1;
  if (hm.hour === 9 && hm.minute === 0) durationHours = 4; // morning
  else if (hm.hour === 14 && hm.minute === 0) durationHours = 5; // afternoon
  else if (hm.hour === 18 && hm.minute === 0) durationHours = 4; // evening
  else if (hm.hour === 20 && hm.minute === 0) durationHours = 3; // night
  
  return { s: start.toMillis(), e: start.plus({ hours: durationHours }).toMillis() };
}
