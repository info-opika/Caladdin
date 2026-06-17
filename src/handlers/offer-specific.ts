import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { ensureDefaultPolicy, getPolicy, upsertPolicy } from '../db/users.js';
import { generateSlots } from '../core/slot-scoring.js';
import { createSchedulingSession } from '../db/scheduling_sessions.js';
import { insertEvent } from '../db/events.js';
import { config } from '../config.js';
import { calendar_v3 } from 'googleapis';
import { getUserById } from '../db/users.js';
import { generateFaxEffectMessage } from '../core/fax-effect.js';
import { sendEmail, schedulingLinkEmailHtml, schedulingLinkEmailText } from '../services/email.js';

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

  const slots = await generateSlots(ctx.userId, policy, duration, 7, {
    recipientEmail,
    cal,
    posture,
  });

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
    const ev = await insertEvent(ctx.userId, {
      title: `[Proposed] Slot for ${recipientName}`,
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

  return {
    intent: 'OFFER_SPECIFIC',
    success: true,
    requiresConfirmation: false,
    messageToUser: `${faxMsg} Share this link: ${link}`,
    slots,
    schedulingLink: link,
    eventsAffected: slots.length,
    schemaVersion: 1,
  };
}
