import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { handleOfferSpecific } from './offer-specific.js';
import { handleGatekeepRule } from './gatekeep-rule.js';

export async function handlePivotAsync(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  cal: unknown,
): Promise<IntentResult> {
  const mode = (parsed.params.mode as string) ?? inferMode(parsed.rawUtterance);

  if (mode === 'C') {
    return handleGatekeepRule({
      ...parsed,
      intent: 'GATEKEEP_RULE',
      params: {
        contact: parsed.params.contact ?? 'blocked@contact.com',
        tier: 0,
      },
    }, ctx, cal);
  }

  if (mode === 'A') {
    const offer = await handleOfferSpecific(parsed, ctx, cal as never);
    return {
      ...offer,
      intent: 'PIVOT_ASYNC',
      messageToUser: `Decline noted. ${offer.messageToUser}`,
    };
  }

  return {
    intent: 'PIVOT_ASYNC',
    success: true,
    requiresConfirmation: false,
    messageToUser: 'Decline message drafted. Copy and send to the requester when ready.',
    schemaVersion: 1,
  };
}

function inferMode(utterance: string): string {
  if (/\bblock\b/i.test(utterance) && /\bdon'?t tell\b/i.test(utterance)) return 'C';
  if (/\bfind|other time|reschedule|slot\b/i.test(utterance)) return 'A';
  return 'B';
}
