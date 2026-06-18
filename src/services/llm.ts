import { mapUtteranceWithHaiku } from '../core/haiku-intent-mapper.js';
import { getPendingIntent } from '../core/pending-intent-memory.js';
import type { ClassifiedIntent } from './intent-types.js';

export type { ClassifiedIntent } from './intent-types.js';

export type ClassifyIntentContext = {
  timezone?: string;
  userId?: string;
};

export async function classifyIntent(
  utterance: string,
  context: ClassifyIntentContext = {},
): Promise<ClassifiedIntent> {
  const tz = context.timezone?.trim() || 'America/Chicago';
  const pendingTemplate =
    context.userId && context.userId.trim()
      ? await getPendingIntent(context.userId.trim())
      : null;
  const uid = context.userId?.trim();
  return mapUtteranceWithHaiku(utterance, {
    timezone: tz,
    pendingTemplate,
    ...(uid ? { userId: uid } : {}),
  });
}

export function isCalendarRelated(
  utterance: string,
  options?: { activeAgentSession?: boolean },
): boolean {
  const lower = utterance.toLowerCase();
  if (/\bwhat\s+is\s+the\s+capital\s+of\b/.test(lower)) return false;
  if (/\bwhat\s+time\s+is\s+it\s+in\b/.test(lower)) return false;
  if (/\bwhat\s+('?s| is)\s+the\s+weather\b/.test(lower)) return false;
  if (/\bweather\b/.test(lower) && !/\b(calendar|schedule|meeting|meetings?|appointments?|events?|busy|free|appointment)\b/.test(lower)) {
    return false;
  }
  if (/\bpoem\b/.test(lower) && !/\b(calendar|schedule|meeting|appointments?|events?|appointment|event)\b/.test(lower)) {
    return false;
  }
  if (/\bcancel\s+culture\b/.test(lower)) return false;
  if (/\b(nba|nfl|ncaa|playoff|playoffs|super\s+bowl|world\s+cup|olympic)\b/i.test(lower) && /\b(schedule|game|games|match|season)\b/.test(lower)) {
    return false;
  }
  if (/\b(flights?|flying|airline|itinerar)\b/.test(lower) && /\b(tomorrow|today|this\s+week|next\s+week)\b/.test(lower) && !/\b(my|me)\s+calendar\b/.test(lower) && !/\b(meet|meeting|appointment)\b/.test(lower)) {
    return false;
  }

  if (/\bfor\s+the\s+next\s+(\d+|four|4)\s+weeks?\b/i.test(lower)) return true;

  const keywords = [
    'calendar', 'meet', 'schedule', 'scheduling', 'time', 'block', 'protect', 'shield',
    'reserve', 'hold', 'cancel', 'move', 'book', 'appointment', 'call', 'lunch', 'evening',
    'tomorrow', 'tmrw', 'friday', 'tuesday', 'monday', 'wednesday', 'thursday', 'saturday',
    'sunday', 'morning', 'afternoon', 'push', 'flush', 'session', 'gym', 'events',
    'recurring', 'everyday', 'every day', 'daily', 'weekday', 'meditation', 'minutes',
    'minute', 'am', 'pm', 'texas', 'central', 'label', 'weeks', 'week', 'next', 'deep',
    'work', 'hour', 'hours',
  ];
  if (keywords.some((kw) => lower.includes(kw))) return true;

  // Short follow-ups during an active agent session ("Meditation Time", "Recurring every day").
  if (options?.activeAgentSession && utterance.trim().length <= 120) {
    return true;
  }

  return false;
}
