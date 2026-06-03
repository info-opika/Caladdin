import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { ensureDefaultPolicy, upsertPolicy } from '../db/users.js';
import { createEventWithSync } from '../services/calendar_api.js';
import { calendar_v3 } from 'googleapis';
import { savePendingClarification } from '../db/conversation-context.js';

export async function handleProtectBlock(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  cal: calendar_v3.Calendar | null,
): Promise<IntentResult> {
  const policy = await ensureDefaultPolicy(ctx.userId);
  const label = (parsed.params.label as string) ?? 'Protected time';
  let daysOfWeek = (parsed.params.daysOfWeek as number[]) ?? [];
  let startTime = (parsed.params.startTime as string) ?? '';
  let endTime = (parsed.params.endTime as string) ?? '';

  const vague =
    !startTime ||
    !endTime ||
    (/\b(every|weekday|daily|lunch|morning|afternoon)\b/i.test(parsed.rawUtterance) && daysOfWeek.length === 0);

  if (vague) {
    await savePendingClarification(ctx.userId, {
      pendingIntent: 'PROTECT_BLOCK',
      knownFields: { label },
      question: 'What time should I block, and which days? For example: weekdays 12pm to 1pm.',
    });
    return {
      intent: 'PROTECT_BLOCK',
      success: false,
      requiresConfirmation: false,
      messageToUser:
        'I need a bit more detail. What time should I block, and which days? For example: "Block lunch every weekday from 12 to 1."',
      schemaVersion: 1,
    };
  }

  if (daysOfWeek.length === 0) daysOfWeek = [new Date().getDay()];
  if (!startTime) startTime = '09:00';
  if (!endTime) endTime = '12:00';

  const duplicate = policy.protectedBlocks.some(
    (b) => b.label === label &&
      JSON.stringify(b.daysOfWeek) === JSON.stringify(daysOfWeek) &&
      b.startTime === startTime &&
      b.endTime === endTime,
  );

  if (duplicate) {
    return {
      intent: 'PROTECT_BLOCK',
      success: true,
      requiresConfirmation: false,
      messageToUser: 'That block is already protected.',
      eventsAffected: 0,
      schemaVersion: 1,
    };
  }

  policy.protectedBlocks.push({ label, daysOfWeek, startTime, endTime });
  await upsertPolicy(ctx.userId, policy);

  const now = new Date();
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const start = new Date(now);
  start.setHours(sh, sm, 0, 0);
  const end = new Date(now);
  end.setHours(eh, em, 0, 0);

  if (cal) {
    await createEventWithSync(cal, ctx.userId, {
      title: `[Protected] ${label}`,
      start: start.toISOString(),
      end: end.toISOString(),
      tier: 0,
      status: 'confirmed',
    });
  }

  return {
    intent: 'PROTECT_BLOCK',
    success: true,
    requiresConfirmation: false,
    messageToUser: `${label} is now protected on your calendar and won't be offered for meetings.`,
    eventsAffected: 1,
    schemaVersion: 1,
  };
}
