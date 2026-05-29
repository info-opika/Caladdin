import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { getLastAuditForUser } from '../db/audit.js';
import { getEventById, updateEvent } from '../db/events.js';
import { config } from '../config.js';

export async function handleUndo(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  _cal: unknown,
): Promise<IntentResult> {
  const last = await getLastAuditForUser(ctx.userId);
  if (!last) {
    return {
      intent: 'UNDO',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'Nothing recent to undo.',
      schemaVersion: 1,
    };
  }

  const created = new Date(last.created_at as string).getTime();
  if (Date.now() - created > config.undoWindowMinutes * 60 * 1000) {
    return {
      intent: 'UNDO',
      success: false,
      requiresConfirmation: false,
      messageToUser: `Undo is only available within ${config.undoWindowMinutes} minutes of an action.`,
      schemaVersion: 1,
    };
  }

  const allowed = ['CREATE_EVENT', 'MODIFY_EVENT', 'PROTECT_BLOCK'];
  if (!allowed.includes(last.intent as string)) {
    return {
      intent: 'UNDO',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'That action cannot be undone automatically.',
      schemaVersion: 1,
    };
  }

  const prev = last.previous_state as { eventId?: string; snapshot?: Record<string, unknown> } | null;
  if (prev?.eventId && prev.snapshot) {
    await updateEvent(prev.eventId, prev.snapshot as never);
  }

  return {
    intent: 'UNDO',
    success: true,
    requiresConfirmation: false,
    messageToUser: 'Undid your last action.',
    schemaVersion: 1,
  };
}
