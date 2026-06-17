import { ParsedIntent, IntentResult, OrchestratorContext, CALENDAR_ONLY_MESSAGE } from './adts.js';
import { preflightSafety, checkRateLimit, computeBlastRadius } from './safety.js';
import { insertAuditLog } from '../db/audit.js';
import { insertPendingConfirmation } from '../db/confirmations.js';
import { sendConfirmationRequest } from '../services/notifications.js';
import { getOAuthClientForUser } from '../services/auth_service.js';
import { ensureDefaultPolicy } from '../db/users.js';
import { logger } from '../logger.js';
import { checkOperationAllowed } from '../pilot/pilot_controls.js';
import { prepareParsedForExecution, normalizeStoredParsed } from './param-extract.js';
import { getConversationContext } from '../db/conversation-context.js';
import { generateConfirmationCopy } from './confirmation-copy.js';

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
import { handleInvitePlatform } from '../handlers/invite-platform.js';

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
  SCHEDULING_LINK: handleOfferSpecific,
  SHAPE_RULES: handleShapeRules,
  GATEKEEP_RULE: handleGatekeepRule,
  PIVOT_ASYNC: handlePivotAsync,
  UNDO: handleUndo,
  RESOLVE_MANUAL: handleResolveManual,
  INVITE_PLATFORM: handleInvitePlatform,
};

function pickHandler(parsed: ParsedIntent): HandlerFn {
  if (parsed.intent === 'FLUSH_RANGE') {
    return handleFlushRange;
  }
  return HANDLERS[parsed.intent] ?? handleResolveManual;
}

export async function orchestrate(
  parsedInput: ParsedIntent,
  ctx: OrchestratorContext,
): Promise<IntentResult> {
  if (parsedInput.intent === 'WARM_REDIRECT' || parsedInput._warmRedirect) {
    return {
      intent: 'WARM_REDIRECT',
      success: true,
      requiresConfirmation: false,
      isWarmRedirect: true,
      messageToUser: CALENDAR_ONLY_MESSAGE,
      schemaVersion: 1,
    };
  }

  const parsed = prepareParsedForExecution(parsedInput);
  const { userId, requestId, _skipConfirmationGate } = ctx;

  if (parsed._warmRedirect || parsed._offTopic) {
    return {
      intent: 'RESOLVE_MANUAL',
      success: true,
      requiresConfirmation: false,
      messageToUser: CALENDAR_ONLY_MESSAGE,
      schemaVersion: 1,
    };
  }

  const pilotGate = await checkOperationAllowed('voice_mutation');
  if (!pilotGate.allowed) {
    return {
      intent: parsed.intent,
      success: false,
      requiresConfirmation: false,
      messageToUser: pilotGate.message ?? 'Caladdin is temporarily unavailable.',
      schemaVersion: 1,
    };
  }

  const rate = await checkRateLimit(userId, parsed.intent);
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
    const policy = await ensureDefaultPolicy(userId);
    const confirmCopy = generateConfirmationCopy(parsed, policy.timezone ?? ctx.timezone ?? 'America/Chicago');
    const token = await insertPendingConfirmation({
      userId,
      intent: parsed.intent,
      payload: { parsed, requestId, ...(ctx.commandLogId ? { commandLogId: ctx.commandLogId } : {}) },
    });
    await sendConfirmationRequest(token, confirmCopy);
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
      messageToUser: `${confirmCopy} This cannot be undone. Use Approve below (phone notification is optional).`,
      schemaVersion: 1,
    };
  }

  const cal = await getOAuthClientForUser(userId);
  await ensureDefaultPolicy(userId);

  const handler = pickHandler(parsed);

  try {
    logger.info('Executing intent', {
      intent: parsed.intent,
      requestId,
      utterance: parsed.rawUtterance.slice(0, 80),
      eventTitle: parsed.params.eventTitle,
      skipGate: _skipConfirmationGate,
    });
    const result = await handler(parsed, ctx, cal);
    const eventsAffected = Array.isArray(result.eventsAffected)
      ? result.eventsAffected.length
      : (result.eventsAffected ?? 0);
    await insertAuditLog({
      userId,
      intent: parsed.intent,
      outcome: result.success ? 'success' : 'failed',
      eventsAffected,
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
  payload: { parsed: unknown; requestId: string },
  userId: string,
): Promise<IntentResult> {
  const normalized = normalizeStoredParsed(payload.parsed);
  const prepared = prepareParsedForExecution(normalized);
  const cal = await getOAuthClientForUser(userId);
  const ctx: OrchestratorContext = {
    userId,
    requestId: payload.requestId,
    oauthClient: cal,
    conversationContext: await getConversationContext(userId),
    _skipConfirmationGate: true,
  };
  return orchestrate(prepared, ctx);
}

