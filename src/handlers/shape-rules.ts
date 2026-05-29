import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { ensureDefaultPolicy, upsertPolicy } from '../db/users.js';

export async function handleShapeRules(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  _cal: unknown,
): Promise<IntentResult> {
  const policy = await ensureDefaultPolicy(ctx.userId);
  const rules = parsed.params.rules ?? parsed.params;
  policy.shapeRules = { ...policy.shapeRules, ...(rules as Record<string, unknown>) };

  if (parsed.params.noMeetingsBefore) {
    policy.workingHoursStart = String(parsed.params.noMeetingsBefore);
  }
  if (parsed.params.bufferMinutes) {
    policy.shapeRules.bufferMinutes = parsed.params.bufferMinutes;
  }

  await upsertPolicy(ctx.userId, policy);

  return {
    intent: 'SHAPE_RULES',
    success: true,
    requiresConfirmation: false,
    messageToUser: 'Your scheduling preferences have been updated.',
    schemaVersion: 1,
  };
}
