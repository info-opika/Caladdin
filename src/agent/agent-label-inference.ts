/** Shared rules for inferring block labels from multi-turn user messages. */

export function isCalendarQueryTurn(text: string): boolean {
  const t = text.trim();
  if (/^(what|when|who|how|show|list|do i|am i|can i|is there)\b/i.test(t)) return true;
  if (/\?\s*$/.test(t)) return true;
  if (/\b(what.?s on|show my|calendar for|do i have|on my calendar)\b/i.test(t)) return true;
  return false;
}

export function isDurationOrRangeTurn(text: string): boolean {
  const t = text.trim();
  if (/^(for\s+)?the\s+next\s+(\d+|four|4)\s+weeks?\.?$/i.test(t)) return true;
  if (/^block\s+\d+\s+(minute|min|mins?|hour|hr|hrs?)\b/i.test(t)) return true;
  if (/^\d+\s+(minute|min|mins?|hour|hr|hrs?)\b/i.test(t)) return true;
  if (
    /\bfor\s+the\s+next\s+(\d+|four|4)\s+weeks?\b/i.test(t) &&
    t.split(/\s+/).length <= 8 &&
    !/\b(am|pm)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

export function isRecurrenceOnlyTurn(text: string): boolean {
  const t = text.trim();
  return /^(recurring\s+)?(every\s*day|everyday|daily|weekdays?)(\s+only)?$/i.test(t);
}

export function shouldSkipAsLabelCandidate(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 60) return true;
  if (isCalendarQueryTurn(t)) return true;
  if (isDurationOrRangeTurn(t)) return true;
  if (isRecurrenceOnlyTurn(t)) return true;
  if (/\b\d{1,2}\s*(?::\d{2})?\s*(am|pm)\b/i.test(t)) return true;
  if (/^(every\s*day|everyday|daily|weekdays?|recurring.*)$/i.test(t)) return true;
  if (/^(yes|no|ok|sure|thanks)$/i.test(t)) return true;
  if (/\b(every|recurring)\b/i.test(t) && /\b(am|pm|to)\b/i.test(t)) return true;
  if (/\bprotect\b/i.test(t) && /\b(weekdays?|every)\b/i.test(t)) return true;
  if (/\bfor\s+the\s+next\b/i.test(t)) return true;
  if (/\b\d+\s*(minute|min|mins?|hour|hr|hrs?)\b/i.test(t) && /\b(block|for)\b/i.test(t)) return true;
  return false;
}

/** Walk user turns newest-first; skip duration, recurrence, and calendar-query phrases. */
export function inferBlockLabelFromTurns(userTurns: string[]): string | null {
  for (let i = userTurns.length - 1; i >= 0; i -= 1) {
    const t = userTurns[i]!.trim();
    if (shouldSkipAsLabelCandidate(t)) continue;
    if (
      t.split(/\s+/).length <= 6 &&
      !/\b(block|minute|every|from|to|have|calendar|tomorrow|today)\b/i.test(t)
    ) {
      return t.replace(/\s+/g, ' ').slice(0, 80);
    }
  }

  const combined = userTurns.join(' ');
  if (/\bmeditation\b/i.test(combined)) return 'Meditation';

  const forNamed = combined.match(/\bfor\s+([a-z][\w\s]{2,40})/i);
  if (forNamed?.[1]) {
    const candidate = forNamed[1].trim().replace(/\s+/g, ' ');
    if (!shouldSkipAsLabelCandidate(candidate)) return candidate.slice(0, 80);
  }

  if (/\bdeep\s+work\b/i.test(combined)) return 'Deep Work';
  if (userTurns.some((turn) => /\bmorning\s+gym\b/i.test(turn))) return 'Morning Gym';

  return null;
}

export function extractInferredRangeWeeks(combined: string): number | null {
  const m = combined.match(/\bfor\s+(?:the\s+)?next\s+(four|4|\d+)\s+weeks?\b/i);
  if (!m?.[1]) return null;
  const token = m[1].toLowerCase();
  if (token === 'four') return 4;
  const n = parseInt(token, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
