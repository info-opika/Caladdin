import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { ensureDefaultPolicy } from '../db/users.js';
import { generateSlots } from '../core/slot-scoring.js';
import { createSchedulingSession } from '../db/scheduling_sessions.js';
import { insertEvent } from '../db/events.js';
import { config } from '../config.js';
import { calendar_v3 } from 'googleapis';
import { getUserById } from '../db/users.js';

export async function handleOfferSpecific(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  _cal: calendar_v3.Calendar | null,
): Promise<IntentResult> {
  const policy = await ensureDefaultPolicy(ctx.userId);
  const duration = (parsed.params.durationMinutes as number) ?? 30;
  const recipientName = (parsed.params.recipientName as string) ?? 'Guest';
  const slots = await generateSlots(ctx.userId, policy, duration);

  if (slots.length === 0) {
    return {
      intent: 'OFFER_SPECIFIC',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'I could not find open slots in the next week. Try a different range?',
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
    proposedEventIds: proposedIds,
  });

  const link = `${config.baseUrl.replace(/\/$/, '')}/s/${session.token}`;

  return {
    intent: 'OFFER_SPECIFIC',
    success: true,
    requiresConfirmation: false,
    messageToUser: `I found ${slots.length} slot(s) for ${recipientName}. Share this link: ${link}`,
    slots,
    schedulingLink: link,
    eventsAffected: slots.length,
    schemaVersion: 1,
  };
}
