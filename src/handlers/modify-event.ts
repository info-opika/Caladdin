import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { listEvents, updateEvent } from '../db/events.js';
import { syncEventToGCal } from '../services/calendar_api.js';
import { enrichModifyParams, isRenameUtterance } from '../core/param-extract.js';
import { calendar_v3 } from 'googleapis';

function findTargetEvent(
  events: Awaited<ReturnType<typeof listEvents>>,
  eventTitle?: string,
) {
  if (eventTitle) {
    const needle = eventTitle.toLowerCase();
    const match = events.find((e) => e.title.toLowerCase().includes(needle));
    if (match) return match;
  }
  return events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
}

export async function handleModifyEvent(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  cal: calendar_v3.Calendar | null,
): Promise<IntentResult> {
  const params = enrichModifyParams(parsed.params, parsed.rawUtterance);
  const events = await listEvents(ctx.userId);
  const titleMatch = params.eventTitle as string | undefined;
  const newTitle = params.newTitle as string | undefined;
  const newStart = params.newStart as string | undefined;
  const newEnd = params.newEnd as string | undefined;
  const renaming = Boolean(newTitle) || isRenameUtterance(parsed.rawUtterance);

  let target = findTargetEvent(events, titleMatch);
  if (!target && renaming) {
    target = findTargetEvent(events, 'New event');
  }

  if (!target) {
    return {
      intent: 'MODIFY_EVENT',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'I could not find an event to update. Which event did you mean?',
      schemaVersion: 1,
    };
  }

  if (renaming) {
    const title = newTitle ?? titleMatch;
    if (!title) {
      return {
        intent: 'MODIFY_EVENT',
        success: false,
        requiresConfirmation: false,
        messageToUser: 'What should I rename the event to?',
        schemaVersion: 1,
      };
    }
    if (title === target.title) {
      return {
        intent: 'MODIFY_EVENT',
        success: true,
        requiresConfirmation: false,
        messageToUser: `That event is already named "${title}".`,
        schemaVersion: 1,
      };
    }
    const updated = await updateEvent(target.id, { title });
    if (cal) await syncEventToGCal(cal, ctx.userId, updated, 'update');
    return {
      intent: 'MODIFY_EVENT',
      success: true,
      requiresConfirmation: false,
      messageToUser: `Renamed "${target.title}" to "${title}".`,
      eventsAffected: 1,
      schemaVersion: 1,
    };
  }

  if (!newStart && !newEnd) {
    return {
      intent: 'MODIFY_EVENT',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'Tell me how to change the event — e.g. "move it to 4pm" or "rename it to Team sync".',
      schemaVersion: 1,
    };
  }

  const patch: { start?: string; end?: string } = {};
  if (newStart) patch.start = newStart;
  if (newEnd) patch.end = newEnd;

  const updated = await updateEvent(target.id, patch);
  if (cal) await syncEventToGCal(cal, ctx.userId, updated, 'update');

  return {
    intent: 'MODIFY_EVENT',
    success: true,
    requiresConfirmation: false,
    messageToUser: `Updated "${target.title}".`,
    eventsAffected: 1,
    schemaVersion: 1,
  };
}
