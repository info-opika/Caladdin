import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { ensureDefaultPolicy, getPolicy, upsertPolicy } from '../db/users.js';
import { generateSlots, type SchedulingPosture } from '../core/slot-scoring.js';
import { createSchedulingSession } from '../db/scheduling_sessions.js';
import { insertEvent } from '../db/events.js';
import { config } from '../config.js';
import { calendar_v3 } from 'googleapis';
import { getUserById } from '../db/users.js';
import { generateFaxEffectMessage } from '../core/fax-effect.js';
import { sendEmail, schedulingLinkEmailHtml, schedulingLinkEmailText } from '../services/email.js';
import { lookupInviteeAvailability } from '../services/invitee_lookup.js';
import type { SlotSource } from '../db/scheduling_sessions.js';
import {
  buildInviteeConflictWarnings,
  checkInviteeConflictsForSlots,
} from '../services/invitee_slot_conflicts.js';

export async function handleOfferSpecific(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  cal: calendar_v3.Calendar | null,
): Promise<IntentResult> {
  const policy = await ensureDefaultPolicy(ctx.userId);
  const duration =
    typeof parsed.params.durationMinutes === 'number'
      ? parsed.params.durationMinutes
      : policy.defaultMeetingLengthMinutes;
  const recipientName = (parsed.params.recipientName as string) ?? 'Guest';
  const recipientEmail = (parsed.params.recipientEmail as string) ?? undefined;
  const postureRaw = parsed.params.posture as string | undefined;
  const posture =
    postureRaw === 'strict' || postureRaw === 'flexible' || postureRaw === 'mutual'
      ? postureRaw
      : 'mutual';

  let slotSource: SlotSource = 'host_only_pending_grant';
  let slotPosture: SchedulingPosture = posture;
  let mutualRecipientEmail: string | undefined;

  if (recipientEmail) {
    const invitee = await lookupInviteeAvailability(recipientEmail);
    if (invitee.isCaladdinUser && invitee.hasCalendarConnected) {
      slotSource = 'mutual_known_user';
      mutualRecipientEmail = recipientEmail;
      if (posture !== 'flexible') {
        slotPosture = 'mutual';
      }
    } else {
      slotSource = 'host_only_pending_grant';
      slotPosture = posture === 'strict' ? 'strict' : 'flexible';
      mutualRecipientEmail = undefined;
    }
  }

  const explicitRaw = parsed.params.offeredSlots;
  const explicitSlots = Array.isArray(explicitRaw)
    ? explicitRaw.filter(
        (s): s is { start: string; end: string } =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as { start?: unknown }).start === 'string' &&
          typeof (s as { end?: unknown }).end === 'string',
      )
    : [];

  let slots;
  let conflictWarning = '';
  if (explicitSlots.length > 0) {
    slots = explicitSlots.map((s) => ({
      start: s.start,
      end: s.end,
      score: 1,
      adjacentEventCount: 0,
      energyScore: 0.5,
      createsFragment: false,
    }));
    if (slotSource === 'mutual_known_user' && recipientEmail) {
      const conflicts = await checkInviteeConflictsForSlots(recipientEmail, explicitSlots, {
        hostCal: cal,
        timezone: policy.timezone,
      });
      conflictWarning = buildInviteeConflictWarnings(recipientEmail, conflicts, policy.timezone);
    }
  } else {
    slots = await generateSlots(ctx.userId, policy, duration, 7, {
      recipientEmail: mutualRecipientEmail,
      cal,
      posture: slotPosture,
    });
  }

  if (slots.length === 0) {
    return {
      intent: 'OFFER_SPECIFIC',
      success: false,
      requiresConfirmation: false,
      messageToUser: generateFaxEffectMessage('OFFER_SPECIFIC', [], [], policy),
      schemaVersion: 1,
    };
  }

  const proposedIds: string[] = [];
  for (const slot of slots) {
    const meetingLabel = (parsed.params.context as string | undefined)?.trim();
    const ev = await insertEvent(ctx.userId, {
      title: meetingLabel
        ? `[Proposed] ${meetingLabel}`
        : `[Proposed] Slot for ${recipientName}`,
      start: slot.start,
      end: slot.end,
      tier: 3,
      status: 'proposed',
    });
    proposedIds.push(ev.id);
  }

  const user = await getUserById(ctx.userId);
  const session = await createSchedulingSession({
    hostUserId: ctx.userId,
    slots,
    hostName: user?.display_name ?? user?.email ?? 'Host',
    context: parsed.params.context as string | undefined,
    posture,
    proposedEventIds: proposedIds,
    inviteeEmail: recipientEmail,
    hostTimezone: policy.timezone,
    durationMinutes: duration,
    offeredSlots: slots.map((s) => ({
      start: s.start,
      end: s.end,
      adjacentEventCount: 0,
      energyScore: s.score ?? 0.5,
      createsFragment: false,
    })),
    slotSource,
  });

  const link = `${config.baseUrl.replace(/\/$/, '')}/s/${session.token}`;

  if (recipientEmail) {
    await sendEmail({
      to: recipientEmail,
      subject: `${user?.display_name ?? 'Someone'} picked two times to meet`,
      html: schedulingLinkEmailHtml(user?.display_name ?? 'Your host', link),
      text: schedulingLinkEmailText(user?.display_name ?? 'Your host', link),
    });
  }

  const faxMsg = generateFaxEffectMessage(
    'OFFER_SPECIFIC',
    slots.map((s) => ({
      start: s.start,
      end: s.end,
      adjacentEventCount: 0,
      energyScore: s.score ?? 0.5,
      createsFragment: false,
    })),
    [],
    policy,
  );

  const warningPrefix = conflictWarning ? `${conflictWarning} ` : '';
  return {
    intent: 'OFFER_SPECIFIC',
    success: true,
    requiresConfirmation: false,
    messageToUser: `${warningPrefix}${faxMsg} Share this link: ${link}`,
    slots,
    schedulingLink: link,
    sessionToken: session.token,
    slotSource,
    eventsAffected: slots.length,
    schemaVersion: 1,
  };
}
