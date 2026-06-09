import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import {
  ParsedIntent,
  ParsedIntentSchema,
  CLASSIFY_INTENT_TOOL,
  DESTRUCTIVE_VERB_RE,
  CALENDAR_TOPIC_RE,
  OFF_TOPIC_RE,
  GENERAL_KNOWLEDGE_RE,
  IntentEnum,
  WARM_REDIRECT_MESSAGE,
} from './adts.js';
import { insertFailureLog } from '../db/failures.js';
import { logger } from '../logger.js';
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

const client = new Anthropic({ apiKey: config.anthropicApiKey || 'sk-placeholder' });

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

  if (!config.anthropicApiKey || config.anthropicApiKey === 'sk-placeholder') {
    return degradedParse(trimmed);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      tools: [{
        name: CLASSIFY_INTENT_TOOL.name,
        description: CLASSIFY_INTENT_TOOL.description,
        input_schema: CLASSIFY_INTENT_TOOL.input_schema,
      }],
      tool_choice: { type: 'tool', name: 'classify_intent' },
      messages: [{
        role: 'user',
        content: `You classify calendar/scheduling voice commands ONLY. You are NOT a general assistant.

BOUNDARY (critical):
- ONLY handle calendar, events, scheduling, availability, time blocks, and meeting preferences.
- If the utterance is general knowledge, trivia, politics, weather, news, coding, homework, or chit-chat with NO calendar intent → set intent RESOLVE_MANUAL, confidence 0.1, mappingMethod resolve_manual. Do NOT answer the question.
- Examples of REJECT: "who is the president", "tell me a joke", "what's the weather". Examples of ACCEPT: "what's on my calendar", "book lunch Friday".

Today is ${new Date().toISOString().split('T')[0]} (use local-style ISO datetimes for the user's timezone).

Rules:
- CREATE_EVENT: always set params.title, params.start, params.end. Parse times like "tomorrow at 8 AM" into ISO strings. If the user did not give a title, omit params.title (do NOT use placeholders like "<UNKNOWN>"). Set params.description when the user asks for event notes/description.
- CREATE_EVENT with guests: set params.participants to email array when user says invite/include/add/send invite with emails. Utterances that say "create a new event" or "send an invite" with invite emails are CREATE_EVENT, not MODIFY_EVENT.
- CREATE_EVENT recurring: set params.isRecurring true and params.recurrence to RRULE strings when user says recurring/repeats/every weekday/Monday to Friday/every Tuesday. Weekdays → RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR. Set params.timeZone to IANA (America/Chicago for Central Time, America/New_York for ET, America/Los_Angeles for PT).
- CREATE_EVENT "send an invite to X at 3 PM" with a new event title is CREATE_EVENT (not MODIFY_EVENT). Set params.participants to the invitee email(s).
- CREATE_EVENT recurring: when user says recurring/repeats/every weekday/Monday to Friday, set params.isRecurring true and params.recurrence to Google RRULE strings (weekdays: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"]). Still set params.start to the first occurrence datetime.
- CREATE_EVENT timezones: when user says Central Time/Eastern/Pacific, set params.timeZone to IANA (Central → America/Chicago, Eastern → America/New_York, Pacific → America/Los_Angeles) and interpret clock times in that zone.
- MODIFY_EVENT for rename: set params.newTitle and params.eventTitle (existing name if mentioned). Do NOT set newStart/newEnd for renames.
- MODIFY_EVENT for description: set params.newDescription when user adds or changes event notes/description.
- MODIFY_EVENT for move/reschedule/correction: set params.newStart, params.newEnd, and params.eventTitle when the user names the event. Examples: "starting at 8 AM ending at 9 AM", "make it 1 hour starting at 8 AM Central".
- FLUSH_RANGE for remove/delete/cancel ONE named event: set params.eventTitle to the event name (e.g. "Remove the Test event" → eventTitle: "Test"). Do NOT use MODIFY_EVENT for deletions.
- FLUSH_RANGE for bulk cancel (tomorrow, clear my afternoon): set params.rangeStart and params.rangeEnd.
- MODIFY_EVENT to add invitees: set params.addInvitees (email strings) and params.eventTitle when named. Examples: "invite kanthatbww@gmail.com", "add john@example.com to the meeting".
- OFFER_SPECIFIC for scheduling links and slot offers: set params.recipientEmail when an email is given. Examples: "send a booking link to alex@example.com", "find 2 slots for jane@example.com next week".
- Descriptive corrections ("The event is 1 hour starting at 8 AM...") are MODIFY_EVENT, not RESOLVE_MANUAL.
- QUERY_CALENDAR: read-only; optional rangeStart/rangeEnd.
- Use confidence >= 0.85 when intent and params are clear. Never below 0.7 if you extracted times or a title.

Utterance: "${trimmed}"`,
      }],
    }, { signal: controller.signal });

    clearTimeout(timeout);

    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('No tool use in LLM response');
    }

    const input = toolUse.input as {
      intent: string;
      confidence: number;
      params: Record<string, unknown>;
      mappingMethod: string;
    };

    IntentEnum.parse(input.intent);
    if (isOffTopic(trimmed)) {
      return offTopicResult(trimmed);
    }
    if (input.intent === 'RESOLVE_MANUAL' && input.confidence < 0.3) {
      const rescued = degradedParse(trimmed);
      if (rescued.intent !== 'RESOLVE_MANUAL') {
        return rescued;
      }
      if (!isSchedulingLinkUtterance(trimmed) && !isCalendarRelated(trimmed)) {
        return offTopicResult(trimmed);
      }
    }
    const enrichedParams = enrichParamsForIntent(input.intent, input.params ?? {}, trimmed);
    return applyConfidenceRouting({ ...input, params: enrichedParams }, trimmed, destructive);
  } catch (e) {
    logger.warn('LLM parse failed, using degraded mode', { requestId, error: String(e) });
    await insertFailureLog({
      userId,
      rawUtterance: trimmed,
      failureReason: 'LLM unavailable',
      requestId,
    }).catch(() => {});
    return degradedParse(trimmed);
  }
}

export { WARM_REDIRECT_MESSAGE };
