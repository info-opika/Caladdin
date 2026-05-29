import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import {
  ParsedIntent,
  ParsedIntentSchema,
  CLASSIFY_INTENT_TOOL,
  DESTRUCTIVE_VERB_RE,
  CALENDAR_TOPIC_RE,
  OFF_TOPIC_RE,
  IntentEnum,
  WARM_REDIRECT_MESSAGE,
} from './adts.js';
import { insertFailureLog } from '../db/failures.js';
import { logger } from '../logger.js';
import { enrichCreateParams, enrichModifyParams } from './param-extract.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey || 'sk-placeholder' });

const KEYWORD_INTENTS: Array<{ re: RegExp; intent: string; params?: Record<string, unknown> }> = [
  { re: /\bwhat'?s on|calendar today|my calendar\b/i, intent: 'QUERY_CALENDAR' },
  { re: /\bam i free|free (on|at|thursday|friday|monday)\b/i, intent: 'QUERY_CALENDAR' },
  { re: /\bblock\b/i, intent: 'PROTECT_BLOCK' },
  { re: /\bfind (time|slot)|schedule (time|with)\b/i, intent: 'OFFER_SPECIFIC' },
  { re: /\bput |add |create |schedule an event|dinner at\b/i, intent: 'CREATE_EVENT' },
  { re: /\brename|retitle|change the name\b/i, intent: 'MODIFY_EVENT' },
  { re: /\bmove |push \b/i, intent: 'MODIFY_EVENT' },
  { re: /\bcancel|clear|wipe\b/i, intent: 'FLUSH_RANGE' },
  { re: /\bundo\b/i, intent: 'UNDO' },
];

function enrichParamsForIntent(intent: string, params: Record<string, unknown>, utterance: string): Record<string, unknown> {
  if (intent === 'CREATE_EVENT') return enrichCreateParams(params, utterance);
  if (intent === 'MODIFY_EVENT') return enrichModifyParams(params, utterance);
  return params;
}

function degradedParse(utterance: string): ParsedIntent {
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

function applyConfidenceRouting(raw: {
  intent: string;
  confidence: number;
  params: Record<string, unknown>;
  mappingMethod: string;
}, utterance: string, destructive: boolean): ParsedIntent {
  let intent = raw.intent;
  let mappingMethod = raw.mappingMethod as 'direct' | 'fuzzy' | 'resolve_manual';

  if (raw.confidence < 0.6 || intent === 'RESOLVE_MANUAL') {
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
    params: raw.params ?? {},
    mappingMethod,
    rawUtterance: utterance,
    _destructivePreFilter: destructive,
  });
}

export function warmRedirectResult(utterance: string): ParsedIntent {
  return ParsedIntentSchema.parse({
    intent: 'RESOLVE_MANUAL',
    confidence: 1,
    params: {},
    mappingMethod: 'direct',
    rawUtterance: utterance,
    _warmRedirect: true,
  });
}

const STRONG_CALENDAR_RE = /\b(calendar|meetings?|schedule|block|free|busy|appointments?|cancel|move|protect|undo|decline|slots?|standup|deep work)\b/i;

export function isOffTopic(utterance: string): boolean {
  if (OFF_TOPIC_RE.test(utterance) && !STRONG_CALENDAR_RE.test(utterance)) {
    return true;
  }
  return !CALENDAR_TOPIC_RE.test(utterance);
}

export async function parseIntent(
  utterance: string,
  userId: string,
  requestId?: string,
): Promise<ParsedIntent> {
  const trimmed = utterance.trim();
  const destructive = DESTRUCTIVE_VERB_RE.test(trimmed);

  if (isOffTopic(trimmed)) {
    return warmRedirectResult(trimmed);
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
        content: `You classify calendar voice commands. Today is ${new Date().toISOString().split('T')[0]} (use local-style ISO datetimes for the user's timezone).

Rules:
- CREATE_EVENT: always set params.title, params.start, params.end. Parse times like "tomorrow at 8 AM" into ISO strings.
- MODIFY_EVENT for rename: set params.newTitle and params.eventTitle (existing name if mentioned). Do NOT set newStart/newEnd for renames.
- MODIFY_EVENT for move/reschedule: set params.newStart (and newEnd if given), params.eventTitle if specified.
- QUERY_CALENDAR: read-only; optional rangeStart/rangeEnd.
- Use confidence >= 0.9 when intent and params are clear.

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
