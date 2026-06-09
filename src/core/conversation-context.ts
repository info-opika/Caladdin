import { ParsedIntent, ParsedIntentSchema } from './adts.js';
import type { ConversationContext } from '../db/conversation-context.js';
import {
  enrichModifyParams,
  enrichCreateParams,
  extractEmails,
  isInviteUtterance,
  isNewEventInviteUtterance,
  isReferentialUtterance,
  isRenameUtterance,
  isCreateEventUtterance,
} from './param-extract.js';

/** Merge session memory into parsed intent for follow-up commands. */
export function applyConversationContext(
  parsed: ParsedIntent,
  context: ConversationContext | null,
): ParsedIntent {
  const utterance = parsed.rawUtterance;

  if (isCreateEventUtterance(utterance) || isNewEventInviteUtterance(utterance)) {
    return ParsedIntentSchema.parse({
      ...parsed,
      intent: 'CREATE_EVENT',
      confidence: Math.max(parsed.confidence, 0.85),
      params: enrichCreateParams(parsed.params, utterance),
      mappingMethod: parsed.intent === 'CREATE_EVENT' ? parsed.mappingMethod : 'fuzzy',
    });
  }

  if (!context?.lastEvent) return parsed;

  const params = { ...parsed.params };
  const referential = isReferentialUtterance(utterance);

  if (isInviteUtterance(utterance)) {
    const enriched = enrichModifyParams(params, utterance);
    if (!enriched.eventTitle && context.lastEvent) {
      enriched.eventTitle = context.lastEvent.title;
      enriched._useSessionEvent = true;
    }
    return ParsedIntentSchema.parse({
      ...parsed,
      intent: 'MODIFY_EVENT',
      params: enriched,
      mappingMethod: parsed.mappingMethod === 'resolve_manual' ? 'fuzzy' : parsed.mappingMethod,
    });
  }

  if (referential && parsed.intent === 'MODIFY_EVENT' && !params.eventTitle) {
    params.eventTitle = context.lastEvent.title;
    params._useSessionEvent = true;
    return ParsedIntentSchema.parse({
      ...parsed,
      params: enrichModifyParams(params, utterance),
    });
  }

  if (referential && parsed.intent === 'RESOLVE_MANUAL') {
    const enriched = enrichModifyParams(
      { eventTitle: context.lastEvent.title, _useSessionEvent: true },
      utterance,
    );
    if (isInviteUtterance(utterance) || enriched.newStart || enriched.newTitle || isRenameUtterance(utterance)) {
      return ParsedIntentSchema.parse({
        ...parsed,
        intent: 'MODIFY_EVENT',
        confidence: Math.max(parsed.confidence, 0.75),
        params: enriched,
        mappingMethod: 'fuzzy',
      });
    }
  }

  return parsed;
}

export function sessionEventRef(context: ConversationContext | null | undefined) {
  return context?.lastEvent ?? null;
}
