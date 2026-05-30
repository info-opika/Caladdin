import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { createEventWithSync } from '../services/calendar_api.js';
import { addDays, formatISO } from '../core/date-utils.js';
import { enrichCreateParams } from '../core/param-extract.js';
import { recordLastEvent } from '../db/conversation-context.js';
import { calendar_v3 } from 'googleapis';

export async function handleCreateEvent(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  cal: calendar_v3.Calendar | null,
): Promise<IntentResult> {
  const params = enrichCreateParams(parsed.params, parsed.rawUtterance);
  const title = (params.title as string) ?? 'New event';
  let start = params.start as string | undefined;
  let end = params.end as string | undefined;
  const participants = (params.participants as string[] | undefined) ?? [];

  if (!start) {
    const tomorrow = addDays(new Date(), 1);
    tomorrow.setHours(19, 0, 0, 0);
    start = formatISO(tomorrow);
    end = formatISO(new Date(tomorrow.getTime() + 60 * 60 * 1000));
  }
  if (!end) {
    end = formatISO(new Date(new Date(start).getTime() + 60 * 60 * 1000));
  }

  const event = await createEventWithSync(cal, ctx.userId, {
    title,
    start,
    end,
    tier: 2,
    status: 'confirmed',
    participants,
  });

  await recordLastEvent(ctx.userId, 'CREATE_EVENT', parsed.rawUtterance, {
    id: event.id,
    title: event.title,
    gcalEventId: event.gcalEventId,
    start: event.start,
    end: event.end,
    participants: event.participants,
  });

  const inviteNote = participants.length
    ? ` Invited ${participants.join(', ')}.`
    : '';

  return {
    intent: 'CREATE_EVENT',
    success: true,
    requiresConfirmation: false,
    messageToUser: `Created "${event.title}" on your calendar.${inviteNote}`,
    eventsAffected: 1,
    schemaVersion: 1,
  };
}
