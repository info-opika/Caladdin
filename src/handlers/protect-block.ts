import { ParsedIntent, IntentResult, OrchestratorContext, ProtectBlockParamsSchema } from '../core/adts.js';
import { ensureDefaultPolicy } from '../db/users.js';
import { calendar_v3 } from 'googleapis';
import { savePendingClarification } from '../db/conversation-context.js';
import { protectBlock } from '../core/intents/protect-block.js';
import { getOAuth2AuthForUser } from '../services/auth_service.js';

function stripMissingFields(params: Record<string, unknown>): Record<string, unknown> {
  const { missingFields: _mf, ...rest } = params;
  return rest;
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

function hasParsedProtectTiming(params: Record<string, unknown>): boolean {
  const startTime = params.startTime as string | undefined;
  const endTime = params.endTime as string | undefined;
  const durationMinutes = params.durationMinutes as number | undefined;
  if (!startTime?.trim()) return false;
  if (endTime?.trim()) return true;
  return typeof durationMinutes === 'number' && durationMinutes > 0;
}

export async function handleProtectBlock(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  _cal: calendar_v3.Calendar | null,
): Promise<IntentResult> {
  const policy = await ensureDefaultPolicy(ctx.userId);
  const cleanParams = stripMissingFields(parsed.params);
  const fromApprovedConfirmation = ctx._skipConfirmationGate ?? false;

  const structured = ProtectBlockParamsSchema.safeParse({
    ...cleanParams,
    rawUtterance: parsed.rawUtterance,
  });

  if (structured.success) {
    const block = structured.data;
    const duplicate = policy.protectedBlocks.some(
      (b) =>
        b.label === block.label &&
        JSON.stringify(b.daysOfWeek) === JSON.stringify(block.daysOfWeek) &&
        b.startTime === block.startTime &&
        b.endTime === block.endTime,
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

    const oauth = await getOAuth2AuthForUser(ctx.userId);
    const result = await protectBlock(
      { ...parsed, params: structured.data },
      { ...policy, userId: ctx.userId },
      oauth,
      fromApprovedConfirmation,
    );
    return {
      ...result,
      schemaVersion: 1,
      eventsAffected: Array.isArray(result.eventsAffected)
        ? result.eventsAffected.length
        : (result.eventsAffected ?? 0),
    };
  }

  const label = (cleanParams.label as string) ?? '';
  const hasLabel = label.trim().length > 0;
  const hasTiming = hasParsedProtectTiming(cleanParams);

  if (!hasLabel || !hasTiming) {
    await savePendingClarification(ctx.userId, {
      pendingIntent: 'PROTECT_BLOCK',
      knownFields: { label: label || undefined },
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

  const oauth = await getOAuth2AuthForUser(ctx.userId);
  let startTime = (cleanParams.startTime as string) ?? '';
  let endTime = (cleanParams.endTime as string) ?? '';
  if (!endTime && typeof cleanParams.durationMinutes === 'number') {
    endTime = deriveEndTimeFromDuration(startTime, cleanParams.durationMinutes);
  }

  const mergedParams = {
    ...cleanParams,
    label,
    startTime,
    endTime,
    rawUtterance: parsed.rawUtterance,
  };

  const retryStructured = ProtectBlockParamsSchema.safeParse(mergedParams);
  if (retryStructured.success) {
    const result = await protectBlock(
      { ...parsed, params: retryStructured.data },
      { ...policy, userId: ctx.userId },
      oauth,
      fromApprovedConfirmation,
    );
    return {
      ...result,
      schemaVersion: 1,
      eventsAffected: Array.isArray(result.eventsAffected)
        ? result.eventsAffected.length
        : (result.eventsAffected ?? 0),
    };
  }

  return {
    intent: 'PROTECT_BLOCK',
    success: false,
    requiresConfirmation: false,
    messageToUser:
      'I need the title, daily start and end time, weekdays, and an end date for the block before recurring calendar protection.',
    schemaVersion: 1,
  };
}
