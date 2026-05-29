import { ParsedIntent, IntentResult, OrchestratorContext, RESOLVE_MANUAL_MESSAGE, WARM_REDIRECT_MESSAGE } from './adts.js';
import { preflightSafety, checkRateLimit, computeBlastRadius } from './safety.js';
import { insertAuditLog } from '../db/audit.js';
import { insertPendingConfirmation } from '../db/confirmations.js';
import { sendConfirmationRequest } from '../services/notifications.js';
import { getOAuthClientForUser } from '../services/auth_service.js';
import { ensureDefaultPolicy } from '../db/users.js';
import { logger } from '../logger.js';

import { handleQueryCalendar } from '../handlers/query-calendar.js';
import { handleCreateEvent } from '../handlers/create-event.js';
import { handleProtectBlock } from '../handlers/protect-block.js';
import { handleFlushRange } from '../handlers/flush-range.js';
import { handleModifyEvent } from '../handlers/modify-event.js';
import { handleOfferSpecific } from '../handlers/offer-specific.js';
import { handleShapeRules } from '../handlers/shape-rules.js';
import { handleGatekeepRule } from '../handlers/gatekeep-rule.js';
import { handlePivotAsync } from '../handlers/pivot-async.js';
import { handleUndo } from '../handlers/undo.js';
import { handleResolveManual } from '../handlers/resolve-manual.js';

type HandlerFn = (
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  cal: Awaited<ReturnType<typeof getOAuthClientForUser>>,
) => Promise<IntentResult>;

const HANDLERS: Record<string, HandlerFn> = {
  QUERY_CALENDAR: handleQueryCalendar,
  CREATE_EVENT: handleCreateEvent,
  PROTECT_BLOCK: handleProtectBlock,
  FLUSH_RANGE: handleFlushRange,
  MODIFY_EVENT: handleModifyEvent,
  OFFER_SPECIFIC: handleOfferSpecific,
  SHAPE_RULES: handleShapeRules,
  GATEKEEP_RULE: handleGatekeepRule,
  PIVOT_ASYNC: handlePivotAsync,
  UNDO: handleUndo,
  RESOLVE_MANUAL: handleResolveManual,
};

export async function orchestrate(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
): Promise<IntentResult> {
  const { userId, requestId, _skipConfirmationGate } = ctx;

  if (parsed._warmRedirect) {
    return {
      intent: 'RESOLVE_MANUAL',
      success: true,
      requiresConfirmation: false,
      messageToUser: WARM_REDIRECT_MESSAGE,
      schemaVersion: 1,
    };
  }

  const rate = checkRateLimit(userId, parsed.intent);
  if (!rate.allowed) {
    return {
      intent: parsed.intent,
      success: false,
      requiresConfirmation: false,
      messageToUser: `Rate limit exceeded. Max 20 mutations per hour. Try again in ${Math.ceil((rate.retryAfterMs ?? 60000) / 60000)} minutes.`,
      schemaVersion: 1,
    };
  }

  let blastRadius: number | undefined;
  if (parsed.intent === 'FLUSH_RANGE' && parsed.params.rangeStart && parsed.params.rangeEnd) {
    blastRadius = await computeBlastRadius(
      userId,
      parsed.params.rangeStart as string,
      parsed.params.rangeEnd as string,
    );
  }

  const preflight = await preflightSafety(parsed, userId, blastRadius);

  if (!_skipConfirmationGate && preflight.requiresConfirmation) {
    const token = await insertPendingConfirmation({
      userId,
      intent: parsed.intent,
      payload: { parsed, requestId },
    });
    await sendConfirmationRequest(token, `Confirm: ${parsed.intent} — "${parsed.rawUtterance.slice(0, 80)}"`);
    await insertAuditLog({
      userId,
      intent: parsed.intent,
      outcome: 'pending_confirmation',
      requestId,
    });
    return {
      intent: parsed.intent,
      success: false,
      requiresConfirmation: true,
      confirmationToken: token,
      messageToUser: `This action needs your confirmation. Check your notification to approve.`,
      schemaVersion: 1,
    };
  }

  const cal = await getOAuthClientForUser(userId);
  await ensureDefaultPolicy(userId);

  const handler = HANDLERS[parsed.intent] ?? handleResolveManual;

  try {
    const result = await handler(parsed, ctx, cal);
    await insertAuditLog({
      userId,
      intent: parsed.intent,
      outcome: result.success ? 'success' : 'failed',
      eventsAffected: result.eventsAffected ?? 0,
      requestId,
    });
    return result;
  } catch (e) {
    logger.error('Handler failed', { intent: parsed.intent, requestId, error: String(e) });
    return {
      intent: parsed.intent,
      success: false,
      requiresConfirmation: false,
      messageToUser: 'Something went wrong processing that request. Please try again.',
      schemaVersion: 1,
    };
  }
}

export async function reExecuteFromConfirmation(
  payload: { parsed: ParsedIntent; requestId: string },
  userId: string,
): Promise<IntentResult> {
  const cal = await getOAuthClientForUser(userId);
  const ctx: OrchestratorContext = {
    userId,
    requestId: payload.requestId,
    oauthClient: cal,
    _skipConfirmationGate: true,
  };
  return orchestrate(payload.parsed, ctx);
}
