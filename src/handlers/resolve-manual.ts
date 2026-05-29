import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { insertFailureLog } from '../db/failures.js';
import { RESOLVE_MANUAL_MESSAGE } from '../core/adts.js';

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
    messageToUser: RESOLVE_MANUAL_MESSAGE,
    schemaVersion: 1,
  };
}
