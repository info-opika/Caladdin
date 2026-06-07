import { ParsedIntent, IntentResult, OrchestratorContext, UUID_RE } from '../core/adts.js';
import { listEvents, updateEvent, getEventByGcalId } from '../db/events.js';
import { syncEventToGCal, addInviteesToGCalEvent } from '../services/calendar_api.js';
import {
  enrichModifyParams,
  isRenameUtterance,
  isInviteUtterance,
  mergeTimeOntoEventDate,
} from '../core/param-extract.js';
import { sessionEventRef } from '../core/conversation-context.js';
import { recordLastEvent } from '../db/conversation-context.js';
import { calendar_v3 } from 'googleapis';

function findTargetEvent(
  events: Awaited<ReturnType<typeof listEvents>>,
  eventTitle?: string,
  utterance?: string,
) {
  if (eventTitle) {
    const needle = eventTitle.toLowerCase();
    const match = events.find((e) => e.title.toLowerCase().includes(needle));
    if (match) return match;
  }
  if (utterance) {
    const lower = utterance.toLowerCase();
    const byMention = events.find((e) => lower.includes(e.title.toLowerCase()));
    if (byMention) return byMention;
  }
  return events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
}

function formatTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleString(undefined, opts)} – ${end.toLocaleString(undefined, opts)}`;
}

async function resolveTargetForModify(
  ctx: OrchestratorContext,
  params: Record<string, unknown>,
  utterance: string,
) {
  const sessionEvent = sessionEventRef(ctx.conversationContext);
  const useSession = Boolean(params._useSessionEvent) && sessionEvent;

  if (useSession && sessionEvent?.gcalEventId) {
    const byGcal = await getEventByGcalId(ctx.userId, sessionEvent.gcalEventId);
    if (byGcal) return byGcal;
  }

  const events = await listEvents(ctx.userId);
  const titleMatch = params.eventTitle as string | undefined;
  let target: Awaited<ReturnType<typeof listEvents>>[number] | undefined = findTargetEvent(
    events,
    titleMatch,
    utterance,
  );

  if (!target && useSession && sessionEvent) {
    if (sessionEvent.id) {
      target = events.find((e) => e.id === sessionEvent.id) ?? undefined;
    }
    if (!target && sessionEvent.gcalEventId) {
      return {
        id: sessionEvent.id ?? sessionEvent.gcalEventId,
        userId: ctx.userId,
        title: sessionEvent.title,
        start: sessionEvent.start ?? new Date().toISOString(),
        end: sessionEvent.end ?? new Date().toISOString(),
        participants: sessionEvent.participants ?? [],
        tier: 2,
        isRecurring: false,
        status: 'confirmed' as const,
        gcalEventId: sessionEvent.gcalEventId,
        proposedForSession: null,
      };
    }
  }

  return target ?? null;
}

async function handleAddInvitees(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  cal: calendar_v3.Calendar | null,
  params: Record<string, unknown>,
): Promise<IntentResult> {
  const emails = (params.addInvitees as string[] | undefined) ?? [];
  if (emails.length === 0) {
    return {
      intent: 'MODIFY_EVENT',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'Who should I invite? Give me an email address, e.g. "invite alex@example.com".',
      schemaVersion: 1,
    };
  }

  if (!cal) {
    return {
      intent: 'MODIFY_EVENT',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'Your Google Calendar is not connected. Sign out and sign in again to reconnect.',
      schemaVersion: 1,
    };
  }

  const target = await resolveTargetForModify(ctx, params, parsed.rawUtterance);
  if (!target) {
    return {
      intent: 'MODIFY_EVENT',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'Which event should I add them to? Create an event first or name the event, e.g. "invite alex@example.com to Team sync".',
      schemaVersion: 1,
    };
  }

  if (!target.gcalEventId) {
    return {
      intent: 'MODIFY_EVENT',
      success: false,
      requiresConfirmation: false,
      messageToUser: `I found "${target.title}" but it is not linked to Google Calendar yet, so I cannot send invites.`,
      schemaVersion: 1,
    };
  }

  const { participants, added } = await addInviteesToGCalEvent(cal, target.gcalEventId, emails);

  let updated = target;
  if (UUID_RE.test(target.id)) {
    updated = await updateEvent(target.id, { participants });
  }

  await recordLastEvent(ctx.userId, 'MODIFY_EVENT', parsed.rawUtterance, {
    id: updated.id,
    title: updated.title,
    gcalEventId: updated.gcalEventId,
    start: updated.start,
    end: updated.end,
    participants,
  });

  const addedLabel = added.length > 0 ? added.join(', ') : emails.join(', ');
  const alreadyOn = added.length === 0;

  return {
    intent: 'MODIFY_EVENT',
    success: true,
    requiresConfirmation: false,
    messageToUser: alreadyOn
      ? `${addedLabel} ${emails.length === 1 ? 'is' : 'are'} already on "${updated.title}".`
      : `Invited ${addedLabel} to "${updated.title}". Calendar invites are on the way.`,
    eventsAffected: added.length || 1,
    schemaVersion: 1,
  };
}

export async function handleModifyEvent(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  cal: calendar_v3.Calendar | null,
): Promise<IntentResult> {
  const params = enrichModifyParams(parsed.params, parsed.rawUtterance);

  if (isInviteUtterance(parsed.rawUtterance) || params.addInvitees) {
    return handleAddInvitees(parsed, ctx, cal, params);
  }

  const events = await listEvents(ctx.userId);
  const titleMatch = params.eventTitle as string | undefined;
  let newTitle = params.newTitle as string | undefined;
  let newStart = params.newStart as string | undefined;
  let newEnd = params.newEnd as string | undefined;
  const newDescription = params.newDescription as string | undefined;
  const renaming = Boolean(newTitle) || isRenameUtterance(parsed.rawUtterance);

  let target: Awaited<ReturnType<typeof listEvents>>[number] | null | undefined;
  if (params._useSessionEvent) {
    target = await resolveTargetForModify(ctx, params, parsed.rawUtterance);
  }
  if (!target) {
    target = findTargetEvent(events, titleMatch, parsed.rawUtterance);
  }
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
    await recordLastEvent(ctx.userId, 'MODIFY_EVENT', parsed.rawUtterance, {
      id: updated.id,
      title: updated.title,
      gcalEventId: updated.gcalEventId,
      start: updated.start,
      end: updated.end,
      participants: updated.participants,
    });
    return {
      intent: 'MODIFY_EVENT',
      success: true,
      requiresConfirmation: false,
      messageToUser: `Renamed "${target.title}" to "${title}".`,
      eventsAffected: 1,
      schemaVersion: 1,
    };
  }

  if (newDescription) {
    const updated = await updateEvent(target.id, { description: newDescription });
    if (cal) await syncEventToGCal(cal, ctx.userId, updated, 'update');
    await recordLastEvent(ctx.userId, 'MODIFY_EVENT', parsed.rawUtterance, {
      id: updated.id,
      title: updated.title,
      gcalEventId: updated.gcalEventId,
      start: updated.start,
      end: updated.end,
      participants: updated.participants,
    });
    return {
      intent: 'MODIFY_EVENT',
      success: true,
      requiresConfirmation: false,
      messageToUser: `Updated the description on "${updated.title}".`,
      eventsAffected: 1,
      schemaVersion: 1,
    };
  }

  if (newStart) {
    newStart = mergeTimeOntoEventDate(newStart, target.start);
  }
  if (newEnd) {
    newEnd = mergeTimeOntoEventDate(newEnd, target.end);
  }

  if (!newStart && !newEnd) {
    return {
      intent: 'MODIFY_EVENT',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'Tell me how to change the event — e.g. "starting at 8 AM ending at 9 AM", "rename it to Team sync", or "invite alex@example.com".',
      schemaVersion: 1,
    };
  }

  const patch: { start?: string; end?: string } = {};
  if (newStart) patch.start = newStart;
  if (newEnd) patch.end = newEnd;
  if (newStart && !newEnd) {
    const durationMs = new Date(target.end).getTime() - new Date(target.start).getTime();
    patch.end = new Date(new Date(newStart).getTime() + durationMs).toISOString();
  }

  const updated = await updateEvent(target.id, patch);
  if (cal) await syncEventToGCal(cal, ctx.userId, updated, 'update');
  await recordLastEvent(ctx.userId, 'MODIFY_EVENT', parsed.rawUtterance, {
    id: updated.id,
    title: updated.title,
    gcalEventId: updated.gcalEventId,
    start: updated.start,
    end: updated.end,
    participants: updated.participants,
  });

  return {
    intent: 'MODIFY_EVENT',
    success: true,
    requiresConfirmation: false,
    messageToUser: `Updated "${updated.title}" to ${formatTimeRange(updated.start, updated.end)}.`,
    eventsAffected: 1,
    schemaVersion: 1,
  };
}
