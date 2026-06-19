import { DateTime } from 'luxon';
import { ParsedIntentSchema } from '../../core/adts.js';
import { generateSlots } from '../../core/slot-scoring.js';
import { protectBlock } from '../../core/intents/protect-block.js';
import { ProtectBlockParamsSchema } from '../../core/adts.js';
import { createEventWithSync, listBusyFromGCal } from '../../services/calendar_api.js';
import { listEventsFromGCalSafe } from '../../services/calendar_api.js';
import { normalizeGCalRange } from '../../core/date-utils.js';
import { recordLastEvent } from '../../db/conversation-context.js';
import { upsertPolicy, getUserByEmail } from '../../db/users.js';
import { getOAuth2AuthForUser, getOAuthClientForUser } from '../../services/auth_service.js';
import { lookupInviteeAvailability } from '../../services/invitee_lookup.js';
import { checkSpecificSlot } from '../../services/mutual_slot_engine.js';
import {
  buildInviteeConflictWarnings,
  checkInviteeConflictsForSlots,
} from '../../services/invitee_slot_conflicts.js';
import { getCachedBusyFromGCal } from '../../services/freebusy-cache.js';
import { handleOfferSpecific } from '../../handlers/offer-specific.js';
import { handleModifyEvent } from '../../handlers/modify-event.js';
import { handleFlushRange } from '../../handlers/flush-range.js';
import { handleUndo } from '../../handlers/undo.js';
import {
  getSchedulingSessionByToken,
  getLatestOpenSessionForInvitee,
  replaceSessionOfferedSlots,
  type SlotSource,
} from '../../db/scheduling_sessions.js';
import { getGrantBySessionId } from '../../db/invite_calendar_grants.js';
import {
  agentSlotSourceFromSession,
  buildGrantUrl,
  buildInviteMessageTemplate,
  buildSchedulingLink,
  buildOfferedSlotsFromInviteInput,
  isMutualRecomputeAvailable,
  normalizeSessionToken,
  normalizeSlotPairs,
  resolveGrantStatus,
  sessionTokenFromSchedulingLink,
} from './invite-helpers.js';
import type { AgentContext, ToolResult } from '../types.js';
import type { ToolName } from './schemas.js';
import {
  FindAvailableSlotsInputSchema,
  CheckSpecificSlotInputSchema,
  CreateEventInputSchema,
  CreateRecurringBlockInputSchema,
  SendInviteInputSchema,
  GetInviteStatusInputSchema,
  UpdateSessionSlotsInputSchema,
  LookupUserInputSchema,
  GetCalendarSummaryInputSchema,
  UpdatePreferencesInputSchema,
  ModifyEventInputSchema,
  CancelEventsInRangeInputSchema,
  UndoLastActionInputSchema,
  getToolInputSchema,
} from './schemas.js';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function success<T>(data: T, honesty?: ToolResult<T>['honesty']): ToolResult<T> {
  return { ok: true, data, honesty };
}

function failure(error: string, honesty?: ToolResult['honesty']): ToolResult {
  return { ok: false, error, honesty };
}

function deriveEndTimeFromDuration(startTime: string, durationMinutes: number): string {
  const parts = startTime.split(':');
  if (parts.length < 2) return startTime;
  const sh = Number(parts[0]);
  const sm = Number(parts[1]);
  const total = sh * 60 + sm + durationMinutes;
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

export async function executeFindAvailableSlots(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = FindAvailableSlotsInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const input = parsed.data;
  const duration = input.durationMinutes ?? ctx.policy.defaultMeetingLengthMinutes;
  let mutualChecked = false;
  let slotSource: 'mutual' | 'host-only' = 'host-only';

  if (input.inviteeEmail) {
    const invitee = await lookupInviteeAvailability(input.inviteeEmail);
    mutualChecked = true;
    if (invitee.isCaladdinUser && invitee.hasCalendarConnected) {
      slotSource = 'mutual';
    }
  }

  const posture = slotSource === 'mutual' ? 'mutual' : 'flexible';
  const slots = await generateSlots(ctx.userId, ctx.policy, duration, 7, {
    recipientEmail: input.inviteeEmail,
    cal: ctx.cal,
    posture,
    maxSlots: 5,
  });

  return success(
    {
      slots,
      scope: slotSource,
      durationMinutes: duration,
      inviteeEmail: input.inviteeEmail ?? null,
    },
    { mutualChecked, slotSource },
  );
}

export async function executeCheckSpecificSlot(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = CheckSpecificSlotInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const duration = parsed.data.durationMinutes ?? ctx.policy.defaultMeetingLengthMinutes;
  const start = DateTime.fromISO(parsed.data.start, { zone: ctx.timezone });
  if (!start.isValid) {
    return failure('Invalid start time');
  }
  const end = start.plus({ minutes: duration });
  const candidateStart = start.toISO()!;
  const candidateEnd = end.toISO()!;

  if (!ctx.cal) {
    return failure('Google Calendar is not connected');
  }

  const hostBusy = await listBusyFromGCal(ctx.cal, candidateStart, candidateEnd);

  let inviteeBusy: Array<{ start: string; end: string }> | undefined;
  let mutualChecked = false;
  if (parsed.data.inviteeEmail) {
    const invitee = await lookupInviteeAvailability(parsed.data.inviteeEmail);
    mutualChecked = true;
    if (invitee.hasCalendarConnected && invitee.userId) {
      const inviteeCal = await getOAuthClientForUser(invitee.userId);
      if (inviteeCal) {
        inviteeBusy = await getCachedBusyFromGCal(
          inviteeCal,
          invitee.userId,
          candidateStart,
          candidateEnd,
        );
      }
    }
  }

  const result = checkSpecificSlot({
    candidateStart,
    candidateEnd,
    hostBusy,
    inviteeBusy,
    timezone: ctx.timezone,
  });

  const slotSource: 'mutual' | 'host-only' =
    result.scope === 'mutual' ? 'mutual' : 'host-only';

  return success(result, { mutualChecked, slotSource });
}

export async function executeCreateEvent(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = CreateEventInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const input = parsed.data;
  if (input.attendeeEmail && !EMAIL_RE.test(input.attendeeEmail.trim())) {
    return failure(`Invalid attendee email: ${input.attendeeEmail}`);
  }

  const duration = input.durationMinutes ?? ctx.policy.defaultMeetingLengthMinutes;
  const start = DateTime.fromISO(input.start, { zone: ctx.timezone });
  if (!start.isValid) {
    return failure('Invalid start time');
  }
  const end = start.plus({ minutes: duration });

  try {
    const participants = input.attendeeEmail ? [input.attendeeEmail.trim().toLowerCase()] : [];
    const event = await createEventWithSync(ctx.cal, ctx.userId, {
      title: input.title,
      start: start.toISO()!,
      end: end.toISO()!,
      tier: 2,
      status: 'confirmed',
      participants,
      description: input.description ?? null,
      isRecurring: false,
      timeZone: ctx.timezone,
    });

    await recordLastEvent(ctx.userId, 'CREATE_EVENT', input.title, {
      id: event.id,
      title: event.title,
      gcalEventId: event.gcalEventId,
      start: event.start,
      end: event.end,
      participants: event.participants,
    });

    return success({
      eventId: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      gcalEventId: event.gcalEventId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return failure(msg);
  }
}

export async function executeCreateRecurringBlock(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = CreateRecurringBlockInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const input = parsed.data;
  const endTime =
    input.endTime ??
    (input.durationMinutes
      ? deriveEndTimeFromDuration(input.startTime, input.durationMinutes)
      : undefined);

  if (!endTime) {
    return failure('Provide endTime or durationMinutes for the recurring block');
  }

  const blockParams = ProtectBlockParamsSchema.safeParse({
    label: input.label,
    startTime: input.startTime,
    endTime,
    daysOfWeek: input.daysOfWeek,
    rangeEnd: input.rangeEnd,
    startDate: input.startDate,
    timezone: ctx.timezone,
    tier: 1,
  });

  if (!blockParams.success) {
    return failure(blockParams.error.message);
  }

  const duplicate = ctx.policy.protectedBlocks.some(
    (b) =>
      b.label === blockParams.data.label &&
      JSON.stringify(b.daysOfWeek) === JSON.stringify(blockParams.data.daysOfWeek) &&
      b.startTime === blockParams.data.startTime &&
      b.endTime === blockParams.data.endTime,
  );

  if (duplicate) {
    return success({
      alreadyProtected: true,
      message: 'That block is already protected.',
    });
  }

  const oauth = await getOAuth2AuthForUser(ctx.userId);
  const intent = ParsedIntentSchema.parse({
    intent: 'PROTECT_BLOCK',
    confidence: 1,
    params: blockParams.data,
    mappingMethod: 'direct',
    rawUtterance: `protect ${input.label}`,
  });

  const result = await protectBlock(
    intent,
    { ...ctx.policy, userId: ctx.userId },
    oauth,
    true,
  );

  if (!result.success) {
    return failure(result.messageToUser ?? 'Could not create recurring block');
  }

  return success({
    message: result.messageToUser,
    eventsAffected: result.eventsAffected,
  });
}

export async function executeSendInvite(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = SendInviteInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const input = parsed.data;
  const duration = input.durationMinutes ?? ctx.policy.defaultMeetingLengthMinutes;
  const offeredFromInput = buildOfferedSlotsFromInviteInput(input, duration);
  if (!offeredFromInput.ok) {
    return failure(offeredFromInput.error);
  }

  const invitee = await lookupInviteeAvailability(input.inviteeEmail);
  const mutualChecked = true;
  const slotSource: 'mutual' | 'host-only' =
    invitee.isCaladdinUser && invitee.hasCalendarConnected ? 'mutual' : 'host-only';

  let inviteeConflicts: Awaited<ReturnType<typeof checkInviteeConflictsForSlots>> | undefined;
  let preConflictWarning = '';
  if (
    offeredFromInput.slots &&
    offeredFromInput.slots.length > 0 &&
    invitee.isCaladdinUser &&
    invitee.hasCalendarConnected
  ) {
    inviteeConflicts = await checkInviteeConflictsForSlots(
      input.inviteeEmail,
      offeredFromInput.slots,
      { hostCal: ctx.cal, timezone: ctx.timezone },
    );
    preConflictWarning = buildInviteeConflictWarnings(
      input.inviteeEmail,
      inviteeConflicts,
      ctx.timezone,
    );
  }

  const meetingLabel = input.meetingTitle ?? input.context;

  const intent = ParsedIntentSchema.parse({
    intent: 'OFFER_SPECIFIC',
    confidence: 1,
    params: {
      recipientEmail: input.inviteeEmail,
      durationMinutes: duration,
      context: meetingLabel,
      offeredSlots: offeredFromInput.slots,
      posture: slotSource === 'mutual' ? 'mutual' : 'flexible',
    },
    mappingMethod: 'direct',
    rawUtterance: `invite ${input.inviteeEmail}`,
  });

  const result = await handleOfferSpecific(intent, {
    userId: ctx.userId,
    requestId: ctx.requestId,
    timezone: ctx.timezone,
    conversationContext: ctx.conversationContext,
  }, ctx.cal);

  const sessionSlotSource: SlotSource =
    result.slotSource ?? (slotSource === 'mutual' ? 'mutual_known_user' : 'host_only_pending_grant');
  const agentSlotSource = agentSlotSourceFromSession(sessionSlotSource);
  const sessionToken =
    result.sessionToken ??
    (result.schedulingLink ? sessionTokenFromSchedulingLink(result.schedulingLink) : null);
  const grantUrl = sessionToken ? buildGrantUrl(sessionToken) : undefined;
  const messageTemplate = buildInviteMessageTemplate({
    slotSource: sessionSlotSource,
    inviteeEmail: input.inviteeEmail,
    grantUrl,
    conflictWarning: preConflictWarning || undefined,
  });

  if (!result.success) {
    return failure(result.messageToUser ?? 'Failed to send invite', {
      mutualChecked,
      slotSource: agentSlotSource,
    });
  }

  const hostMessage = result.messageToUser;

  return success(
    {
      message: hostMessage,
      schedulingLink: result.schedulingLink,
      sessionToken,
      slots: result.slots,
      slotSource: sessionSlotSource,
      grantUrl: sessionSlotSource === 'host_only_pending_grant' ? grantUrl : undefined,
      grantLinkRequired: sessionSlotSource === 'host_only_pending_grant',
      messageTemplate,
      inviteeRecognized: invitee.isCaladdinUser && invitee.hasCalendarConnected,
      inviteeConflicts,
    },
    { mutualChecked, slotSource: agentSlotSource },
  );
}

export async function executeGetInviteStatus(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = GetInviteStatusInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const input = parsed.data;
  const sessionToken = input.sessionToken
    ? normalizeSessionToken(input.sessionToken)
    : null;
  if (input.sessionToken && !sessionToken) {
    return failure('Invalid sessionToken — use the bare token or full /s/... scheduling link');
  }

  let session = sessionToken ? await getSchedulingSessionByToken(sessionToken) : null;

  if (!session && input.inviteeEmail) {
    session = await getLatestOpenSessionForInvitee(ctx.userId, input.inviteeEmail);
  }

  if (!session) {
    return failure('Scheduling session not found');
  }

  if (session.host_user_id !== ctx.userId) {
    return failure('Session does not belong to this host');
  }

  const grant = await getGrantBySessionId(session.id);
  const grantStatus = resolveGrantStatus(grant);
  const sessionSlotSource = session.slot_source ?? 'host_only_pending_grant';
  const agentSlotSource = agentSlotSourceFromSession(sessionSlotSource);
  const mutualRecomputeAvailable = isMutualRecomputeAvailable(grant, session.status);

  return success(
    {
      sessionToken: session.token,
      schedulingLink: buildSchedulingLink(session.token),
      grantUrl: buildGrantUrl(session.token),
      grantStatus,
      slotSource: sessionSlotSource,
      offeredSlots: session.offered_slots ?? [],
      inviteeEmail: session.invitee_email,
      sessionStatus: session.status,
      mutualRecomputeAvailable,
      expiresAt: session.expires_at,
    },
    {
      mutualChecked: grantStatus === 'active' || sessionSlotSource === 'mutual_known_user',
      slotSource: agentSlotSource,
    },
  );
}

export async function executeUpdateSessionSlots(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = UpdateSessionSlotsInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const input = parsed.data;
  const sessionToken = normalizeSessionToken(input.sessionToken);
  if (!sessionToken) {
    return failure('Invalid sessionToken — use the bare token or full /s/... scheduling link');
  }

  const session = await getSchedulingSessionByToken(sessionToken);
  if (!session) {
    return failure('Scheduling session not found');
  }
  if (session.host_user_id !== ctx.userId) {
    return failure('Session does not belong to this host');
  }
  if (session.status !== 'pending') {
    return failure('Session is no longer open for slot updates');
  }

  const duration = session.duration_minutes ?? ctx.policy.defaultMeetingLengthMinutes;
  const normalized = normalizeSlotPairs(input.slots, { defaultDurationMinutes: duration });
  if (!normalized.ok) {
    return failure(normalized.error);
  }

  const updated = await replaceSessionOfferedSlots(sessionToken, normalized.slots);
  if (!updated) {
    return failure('Could not update offered slots');
  }

  return success({
    sessionToken,
    slots: normalized.slots,
    schedulingLink: buildSchedulingLink(sessionToken),
  });
}

export async function executeLookupUser(
  raw: unknown,
  _ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = LookupUserInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const info = await lookupInviteeAvailability(parsed.data.email);
  const user = await getUserByEmail(parsed.data.email.trim());
  return success({
    ...info,
    displayName: user?.display_name ?? undefined,
  });
}

export async function executeGetCalendarSummary(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = GetCalendarSummaryInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  if (!ctx.cal) {
    return failure('Google Calendar is not connected');
  }

  const { timeMin, timeMax } = normalizeGCalRange(
    parsed.data.rangeStart,
    parsed.data.rangeEnd,
    7,
  );

  const { events, error } = await listEventsFromGCalSafe(ctx.cal, timeMin, timeMax);
  if (error) {
    return failure(error);
  }

  return success({
    rangeStart: timeMin,
    rangeEnd: timeMax,
    events: events.map((e) => ({
      title: e.title,
      start: e.start,
      end: e.end,
    })),
  });
}

export async function executeUpdatePreferences(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = UpdatePreferencesInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const input = parsed.data;
  const answered = new Set(ctx.policy.setupFieldsAnswered ?? []);
  const patch = { ...ctx.policy };

  if (input.timezone) {
    patch.timezone = input.timezone;
    answered.add('timezone');
  }
  if (input.workingHoursStart) {
    patch.workingHoursStart = input.workingHoursStart;
    answered.add('workingHours');
  }
  if (input.workingHoursEnd) {
    patch.workingHoursEnd = input.workingHoursEnd;
    answered.add('workingHours');
  }
  if (input.defaultMeetingLengthMinutes) {
    patch.defaultMeetingLengthMinutes = input.defaultMeetingLengthMinutes;
    answered.add('defaultMeetingLength');
  }
  if (input.meetingTimePreference) {
    patch.meetingTimePreference = input.meetingTimePreference;
    answered.add('meetingTimePreference');
  }

  patch.setupFieldsAnswered = [...answered];
  await upsertPolicy(ctx.userId, patch);

  return success({ updated: input });
}

export async function executeModifyEvent(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = ModifyEventInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const input = parsed.data;
  if (input.addAttendeeEmail && !EMAIL_RE.test(input.addAttendeeEmail.trim())) {
    return failure(`Invalid attendee email: ${input.addAttendeeEmail}`);
  }

  const intent = ParsedIntentSchema.parse({
    intent: 'MODIFY_EVENT',
    confidence: 1,
    params: {
      eventTitle: input.eventTitle,
      newTitle: input.newTitle,
      newStart: input.newStart,
      newEnd: input.newEnd,
      participants: input.addAttendeeEmail ? [input.addAttendeeEmail] : undefined,
    },
    mappingMethod: 'direct',
    rawUtterance: 'modify event',
  });

  const result = await handleModifyEvent(intent, {
    userId: ctx.userId,
    requestId: ctx.requestId,
    timezone: ctx.timezone,
    conversationContext: ctx.conversationContext,
  }, ctx.cal);

  if (!result.success) {
    return failure(result.messageToUser ?? 'Modify failed');
  }

  return success({ message: result.messageToUser });
}

export async function executeCancelEventsInRange(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = CancelEventsInRangeInputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const intent = ParsedIntentSchema.parse({
    intent: 'FLUSH_RANGE',
    confidence: 1,
    params: {
      rangeStart: parsed.data.rangeStart,
      rangeEnd: parsed.data.rangeEnd,
      eventTitle: parsed.data.eventTitle,
    },
    mappingMethod: 'direct',
    rawUtterance: parsed.data.eventTitle
      ? `cancel ${parsed.data.eventTitle}`
      : 'cancel events in range',
  });

  const result = await handleFlushRange(intent, {
    userId: ctx.userId,
    requestId: ctx.requestId,
    timezone: ctx.timezone,
  }, ctx.cal);

  if (!result.success) {
    return failure(result.messageToUser ?? 'Cancel failed');
  }

  return success({
    message: result.messageToUser,
    eventsAffected: result.eventsAffected,
  });
}

export async function executeUndoLastAction(
  raw: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const parsed = UndoLastActionInputSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return failure(parsed.error.message);
  }

  const intent = ParsedIntentSchema.parse({
    intent: 'UNDO',
    confidence: 1,
    params: {},
    mappingMethod: 'direct',
    rawUtterance: 'undo',
  });

  const result = await handleUndo(intent, {
    userId: ctx.userId,
    requestId: ctx.requestId,
    timezone: ctx.timezone,
  }, ctx.cal);

  if (!result.success) {
    return failure(result.messageToUser ?? 'Nothing to undo');
  }

  return success({ message: result.messageToUser });
}

const EXECUTORS: Record<ToolName, (raw: unknown, ctx: AgentContext) => Promise<ToolResult>> = {
  find_available_slots: executeFindAvailableSlots,
  check_specific_slot: executeCheckSpecificSlot,
  create_event: executeCreateEvent,
  create_recurring_block: executeCreateRecurringBlock,
  send_invite: executeSendInvite,
  get_invite_status: executeGetInviteStatus,
  update_session_slots: executeUpdateSessionSlots,
  lookup_user: executeLookupUser,
  get_calendar_summary: executeGetCalendarSummary,
  update_preferences: executeUpdatePreferences,
  modify_event: executeModifyEvent,
  cancel_events_in_range: executeCancelEventsInRange,
  undo_last_action: executeUndoLastAction,
};

export async function executeAgentTool(
  name: string,
  input: unknown,
  ctx: AgentContext,
): Promise<ToolResult> {
  const executor = EXECUTORS[name as ToolName];
  if (!executor) {
    return failure(`Unknown tool: ${name}`);
  }

  const schema = getToolInputSchema(name as ToolName);
  const validated = schema.safeParse(input ?? {});
  if (!validated.success) {
    return failure(validated.error.message);
  }

  return executor(validated.data, ctx);
}
