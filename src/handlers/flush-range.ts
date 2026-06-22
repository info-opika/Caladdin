import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { listEvents } from '../db/events.js';
import { cancelEventWithSync, deleteEventByTitle } from '../services/calendar_api.js';
import { parseRelativeTime } from '../core/date-utils.js';
import { enrichFlushParams, extractEventReference } from '../core/param-extract.js';
import { calendar_v3 } from 'googleapis';

export async function handleFlushRange(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  cal: calendar_v3.Calendar | null,
): Promise<IntentResult> {
  const params = enrichFlushParams(parsed.params, parsed.rawUtterance);
  const eventTitle = (params.eventTitle as string | undefined) ?? extractEventReference(parsed.rawUtterance);
  const singleDelete = Boolean(eventTitle?.trim());

  if (singleDelete && eventTitle) {
    const { deleted, message } = await deleteEventByTitle(cal, ctx.userId, eventTitle, parsed.rawUtterance);
    return {
      intent: 'FLUSH_RANGE',
      success: deleted,
      requiresConfirmation: false,
      messageToUser: message,
      eventsAffected: deleted ? 1 : 0,
      schemaVersion: 1,
    };
  }

  let rangeStart = params.rangeStart as string | undefined;
  let rangeEnd = params.rangeEnd as string | undefined;

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
