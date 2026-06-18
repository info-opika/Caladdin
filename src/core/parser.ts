import {
  ParsedIntent,
  ParsedIntentSchema,
  DESTRUCTIVE_VERB_RE,
  CALENDAR_TOPIC_RE,
  OFF_TOPIC_RE,
  GENERAL_KNOWLEDGE_RE,
  WARM_REDIRECT_MESSAGE,
} from './adts.js';
import {
  enrichCreateParams,
  enrichModifyParams,
  enrichFlushParams,
  extractEmails,
  hasActionableParams,
  isCalendarInviteUtterance,
  isNewEventInviteUtterance,
  isSchedulingLinkUtterance,
} from './param-extract.js';
import { isEmailConfirmationReply } from './email-confirmation.js';

const KEYWORD_INTENTS: Array<{ re: RegExp; intent: string; params?: Record<string, unknown> }> = [
  { re: /\binvite .+ to (caladdin|the platform|this platform|the calendar)\b/i, intent: 'INVITE_PLATFORM' },
  { re: /\bwhat'?s on|calendar today|my calendar\b/i, intent: 'QUERY_CALENDAR' },
  { re: /\bam i free|free (on|at|thursday|friday|monday)\b/i, intent: 'QUERY_CALENDAR' },
  { re: /\bblock\b/i, intent: 'PROTECT_BLOCK' },
  { re: /\bfind (time|slot)|schedule (time|with)\b/i, intent: 'OFFER_SPECIFIC' },
  { re: /\b(booking|scheduling)\s+link\b/i, intent: 'OFFER_SPECIFIC' },
  { re: /\bsend\b.+\blink\b/i, intent: 'OFFER_SPECIFIC' },
  { re: /\bsend\s+(?:an?\s+)?invite\b/i, intent: 'CREATE_EVENT' },
  { re: /\b(?:recurring|every\s+weekday|weekdays?\b|monday\s+to\s+friday)\b/i, intent: 'CREATE_EVENT' },
  { re: /\bbook\b/i, intent: 'CREATE_EVENT' },
  { re: /\bschedule\b/i, intent: 'CREATE_EVENT' },
  { re: /\bset up\b/i, intent: 'CREATE_EVENT' },
  { re: /\bput |add |create |schedule an event|dinner at\b/i, intent: 'CREATE_EVENT' },
  { re: /\binvite .+ to (?:the |my )?(?:meeting|event)\b/i, intent: 'MODIFY_EVENT' },
  { re: /\binvite|invitee|guest|attendee|add .+@/i, intent: 'MODIFY_EVENT' },
  { re: /\brename|retitle|change the name\b/i, intent: 'MODIFY_EVENT' },
  { re: /\bmove |push |update|correct|fix|starting at|ending at|\d+\s*hour|make it|should be\b/i, intent: 'MODIFY_EVENT' },
  { re: /\b(remove|delete)\s+(?:the\s+)?/i, intent: 'FLUSH_RANGE' },
  { re: /\bcancel|clear|wipe\b/i, intent: 'FLUSH_RANGE' },
  { re: /\bundo\b/i, intent: 'UNDO' },
];

function enrichParamsForIntent(intent: string, params: Record<string, unknown>, utterance: string): Record<string, unknown> {
  if (intent === 'CREATE_EVENT') return enrichCreateParams(params, utterance);
  if (intent === 'MODIFY_EVENT') return enrichModifyParams(params, utterance);
  if (intent === 'FLUSH_RANGE') return enrichFlushParams(params, utterance);
  if (intent === 'INVITE_PLATFORM') {
    const emails = extractEmails(utterance);
    if (emails[0]) return { ...params, inviteeEmail: emails[0], email: emails[0] };
  }
  if (intent === 'OFFER_SPECIFIC') {
    const emails = extractEmails(utterance);
    if (emails[0]) return { ...params, recipientEmail: emails[0] };
  }
  return params;
}

function degradedParse(utterance: string): ParsedIntent {
  if (isNewEventInviteUtterance(utterance)) {
    const enriched = enrichParamsForIntent('CREATE_EVENT', {}, utterance);
    return ParsedIntentSchema.parse({
      intent: 'CREATE_EVENT',
      confidence: 0.7,
      params: enriched,
      mappingMethod: 'fuzzy',
      rawUtterance: utterance,
      _destructivePreFilter: DESTRUCTIVE_VERB_RE.test(utterance),
    });
  }
  for (const { re, intent, params } of KEYWORD_INTENTS) {
    if (re.test(utterance)) {
      const enriched = enrichParamsForIntent(intent, params ?? {}, utterance);
      return ParsedIntentSchema.parse({
        intent,
        confidence: 0.7,
        params: enriched,
        mappingMethod: 'fuzzy',
        rawUtterance: utterance,
        _destructivePreFilter: DESTRUCTIVE_VERB_RE.test(utterance),
      });
    }
  }
  return ParsedIntentSchema.parse({
    intent: 'RESOLVE_MANUAL',
    confidence: 0.3,
    params: {},
    mappingMethod: 'resolve_manual',
    rawUtterance: utterance,
  });
}

/** Keyword classification for scheduling-link requests (bypasses LLM mislabels). */
export function parseSchedulingLinkIntent(utterance: string): ParsedIntent | null {
  if (!isSchedulingLinkUtterance(utterance)) return null;
  const parsed = degradedParse(utterance);
  return parsed.intent !== 'RESOLVE_MANUAL' ? parsed : null;
}

function applyConfidenceRouting(raw: {
  intent: string;
  confidence: number;
  params: Record<string, unknown>;
  mappingMethod: string;
}, utterance: string, destructive: boolean): ParsedIntent {
  let intent = raw.intent;
  let mappingMethod = raw.mappingMethod as 'direct' | 'fuzzy' | 'resolve_manual';
  const params = raw.params ?? {};
  const actionable = hasActionableParams(intent, params);

  if ((raw.confidence < 0.6 || intent === 'RESOLVE_MANUAL') && !actionable) {
    const rescued = degradedParse(utterance);
    if (rescued.intent !== 'RESOLVE_MANUAL') {
      return rescued;
    }
    intent = 'RESOLVE_MANUAL';
    mappingMethod = 'resolve_manual';
  } else if (raw.confidence < 0.85) {
    mappingMethod = 'fuzzy';
  } else {
    mappingMethod = 'direct';
  }

  return ParsedIntentSchema.parse({
    intent,
    confidence: raw.confidence,
    params,
    mappingMethod,
    rawUtterance: utterance,
    _destructivePreFilter: destructive,
  });
}

export function offTopicResult(utterance: string): ParsedIntent {
  return ParsedIntentSchema.parse({
    intent: 'RESOLVE_MANUAL',
    confidence: 1,
    params: {},
    mappingMethod: 'direct',
    rawUtterance: utterance,
    _warmRedirect: true,
    _offTopic: true,
  });
}

export function warmRedirectResult(utterance: string): ParsedIntent {
  return offTopicResult(utterance);
}

const STRONG_CALENDAR_RE = /\b(calendar|meetings?|schedule|block|free|busy|appointments?|cancel|move|protect|undo|decline|slots?|standup|deep work|book|reschedule|availability|invite|invitee|guest|attendee|(?:booking|scheduling)\s+link)\b/i;

export function isCalendarRelated(utterance: string): boolean {
  return STRONG_CALENDAR_RE.test(utterance) || CALENDAR_TOPIC_RE.test(utterance);
}

export function isOffTopic(utterance: string): boolean {
  if (isEmailConfirmationReply(utterance)) return false;
  if (isCalendarInviteUtterance(utterance)) return false;
  if (isSchedulingLinkUtterance(utterance)) return false;
  const strongCalendar = STRONG_CALENDAR_RE.test(utterance);
  if (OFF_TOPIC_RE.test(utterance) && !strongCalendar) return true;
  if (GENERAL_KNOWLEDGE_RE.test(utterance) && !strongCalendar) return true;
  if (strongCalendar) return false;
  if (CALENDAR_TOPIC_RE.test(utterance)) return false;
  return true;
}

export async function parseIntent(
  utterance: string,
  userId: string,
  requestId?: string,
): Promise<ParsedIntent> {
  const trimmed = utterance.trim();
  const destructive = DESTRUCTIVE_VERB_RE.test(trimmed);

  if (isOffTopic(trimmed)) {
    return offTopicResult(trimmed);
  }

  // Keyword path before LLM — Haiku often mislabels "send a booking link to …" as off-domain.
  if (isSchedulingLinkUtterance(trimmed)) {
    const scheduling = degradedParse(trimmed);
    if (scheduling.intent !== 'RESOLVE_MANUAL') {
      return scheduling;
    }
  }

  // "Send an invite to X at 3 PM recurring weekdays" is CREATE_EVENT, not MODIFY_EVENT.
  if (isNewEventInviteUtterance(trimmed)) {
    const rescued = degradedParse(trimmed);
    return ParsedIntentSchema.parse({
      ...rescued,
      intent: 'CREATE_EVENT',
      confidence: Math.max(rescued.confidence, 0.85),
      params: enrichCreateParams(rescued.params ?? {}, trimmed),
      mappingMethod: 'direct',
    });
  }

  return degradedParse(trimmed);
}

export { WARM_REDIRECT_MESSAGE };
