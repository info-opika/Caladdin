import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { insertFailureLog } from '../db/failures.js';
import { RESOLVE_MANUAL_MESSAGE } from '../core/adts.js';

function resolveManualMessage(parsed: ParsedIntent): string {
  const reason = parsed.params?.['reason'];
  if (reason === 'protect_followup_time_ambiguous') {
    const start = parsed.params?.['clarifyHourStart'];
    const end = parsed.params?.['clarifyHourEnd'];
    if (typeof start === 'number' && typeof end === 'number') {
      return `Did you mean ${start}am to ${end}am, or ${start}pm to ${end}pm?`;
    }
  }
  return RESOLVE_MANUAL_MESSAGE;
}

export async function handleResolveManual(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  _cal: unknown,
): Promise<IntentResult> {
  await insertFailureLog({
    userId: ctx.userId,
    rawUtterance: parsed.rawUtterance,
    attemptedIntent: parsed.intent,
    confidence: parsed.confidence,
    failureReason: 'resolve_manual',
    requestId: ctx.requestId,
  });

  return {
    intent: 'RESOLVE_MANUAL',
    success: true,
    requiresConfirmation: false,
    messageToUser: resolveManualMessage(parsed),
    schemaVersion: 1,
  };
}
