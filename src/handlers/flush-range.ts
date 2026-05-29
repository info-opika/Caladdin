import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { listEvents, cancelEvent } from '../db/events.js';
import { cancelEventWithSync } from '../services/calendar_api.js';
import { parseRelativeTime } from '../core/date-utils.js';
import { calendar_v3 } from 'googleapis';

export async function handleFlushRange(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  cal: calendar_v3.Calendar | null,
): Promise<IntentResult> {
  let rangeStart = parsed.params.rangeStart as string | undefined;
  let rangeEnd = parsed.params.rangeEnd as string | undefined;

  if (!rangeStart || !rangeEnd) {
    const rel = parseRelativeTime(parsed.rawUtterance);
    if (rel) {
      rangeStart = rel.start;
      rangeEnd = rel.end;
    } else {
      rangeStart = new Date().toISOString();
      rangeEnd = new Date(Date.now() + 86400000).toISOString();
    }
  }

  const events = await listEvents(ctx.userId, rangeStart, rangeEnd);
  let cancelled = 0;

  for (const event of events) {
    if (event.status === 'cancelled') continue;
    if (event.tier === 0) continue;
    await cancelEventWithSync(cal, ctx.userId, event);
    cancelled++;
  }

  return {
    intent: 'FLUSH_RANGE',
    success: true,
    requiresConfirmation: false,
    messageToUser: cancelled > 0
      ? `Cancelled ${cancelled} event(s) in that range.`
      : 'No events to cancel in that range.',
    eventsAffected: cancelled,
    schemaVersion: 1,
  };
}
