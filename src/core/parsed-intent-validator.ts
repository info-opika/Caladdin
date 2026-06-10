import { type ParsedIntent, ParsedIntentSchema, ProtectBlockParamsSchema, VALID_INTENTS } from './adts.js';
import type { ClassifiedIntent } from '../services/anthropic-config.js';
import { logger } from '../logger.js';

const ALLOWED_TOP_LEVEL = new Set([
  'intent',
  'confidence',
  'params',
  'mappingMethod',
  'rawUtterance',
  'missingFields',
  'parseRisk',
]);

const VAGUE_SLOT_WORD =
  /\b(mornings?|afternoons?|evenings?|lunch(?:\s+time)?|dinners?|deep\s+work|family\b)\b/i;

const EXPLICIT_TIME_OR_NUMERIC_RANGE = new RegExp(
  String.raw`\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s*(am|pm))?\b|\b(\d{1,2}):(\d{2})\b`,
  'i'
);

function isValidIntent(intent: string): intent is (typeof VALID_INTENTS)[number] {
  return (VALID_INTENTS as readonly string[]).includes(intent);
}

function utteranceHasVagueTimeOnly(utterance: string): boolean {
  if (!VAGUE_SLOT_WORD.test(utterance)) return false;
  return !EXPLICIT_TIME_OR_NUMERIC_RANGE.test(utterance);
}

function resolveManual(
  utterance: string,
  reason: string,
  confidence = 0.5,
  extraParams: Record<string, unknown> = {}
): ParsedIntent {
  return ParsedIntentSchema.parse({
    intent: 'RESOLVE_MANUAL',
    rawUtterance: utterance,
    confidence,
    params: { reason, ...extraParams },
    mappingMethod: 'resolve_manual',
  });
}

function stripUnknownTopLevel(raw: Record<string, unknown>): {
  cleaned: Record<string, unknown>;
  strippedKeys: string[];
} {
  const strippedKeys: string[] = [];
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (ALLOWED_TOP_LEVEL.has(k)) cleaned[k] = v;
    else strippedKeys.push(k);
  }
  return { cleaned, strippedKeys };
}

/**
 * Strict gate for untrusted Haiku output before orchestrator / finalize helpers.
 */
export function validateHaikuMapperOutput(
  utterance: string,
  raw: ClassifiedIntent | Record<string, unknown> | null | undefined
): ParsedIntent {
  if (!raw || typeof raw !== 'object') {
    logger.warn({ utterancePreview: utterance.slice(0, 80) }, 'Haiku validator: empty mapper output');
    return resolveManual(utterance, 'haiku_mapper_invalid_output', 0);
  }

  const asRecord = raw as Record<string, unknown>;
  const { cleaned, strippedKeys } = stripUnknownTopLevel(asRecord);
  if (strippedKeys.length > 0) {
    logger.warn({ strippedKeys, utterancePreview: utterance.slice(0, 80) }, 'Haiku validator stripped unknown top-level keys');
  }

  const intentRaw = typeof cleaned.intent === 'string' ? cleaned.intent : '';
  if (!isValidIntent(intentRaw)) {
    return resolveManual(utterance, 'haiku_invalid_intent', 0, {
      attemptedIntent: intentRaw || 'unknown',
    });
  }

  const confidence =
    typeof cleaned.confidence === 'number' && Number.isFinite(cleaned.confidence)
      ? Math.min(1, Math.max(0, cleaned.confidence))
      : 0;

  const params =
    typeof cleaned.params === 'object' && cleaned.params !== null && !Array.isArray(cleaned.params)
      ? { ...(cleaned.params as Record<string, unknown>) }
      : {};

  const missingFields = params['missingFields'];
  const hasMissing =
    Array.isArray(missingFields) && missingFields.length > 0;

  let mappingMethod =
    cleaned.mappingMethod === 'direct' ||
    cleaned.mappingMethod === 'fuzzy' ||
    cleaned.mappingMethod === 'resolve_manual'
      ? cleaned.mappingMethod
      : 'direct';

  let intent = intentRaw;

  if (confidence < 0.6 || hasMissing) {
    return resolveManual(utterance, hasMissing ? 'haiku_missing_fields' : 'haiku_low_confidence', confidence, {
      ...(hasMissing ? { missingFields } : {}),
      attemptedIntent: intent,
    });
  }

  if (
    intent === 'PROTECT_BLOCK' &&
    utteranceHasVagueTimeOnly(utterance) &&
    ProtectBlockParamsSchema.safeParse(params).success
  ) {
    return resolveManual(utterance, 'vague_protect_timing');
  }

  if (intent === 'WARM_REDIRECT') {
    return ParsedIntentSchema.parse({
      intent: 'WARM_REDIRECT',
      rawUtterance: utterance,
      confidence: Math.max(confidence, 0.85),
      params: {},
      mappingMethod: 'direct',
    });
  }

  if (confidence < 0.85) {
    mappingMethod = 'fuzzy';
  }

  return ParsedIntentSchema.parse({
    intent,
    confidence,
    rawUtterance: utterance,
    params,
    mappingMethod,
  });
}

/** Test helper: parse raw JSON string through the same gate as malformed Haiku output. */
export function validateHaikuJsonString(utterance: string, jsonText: string): ParsedIntent {
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return validateHaikuMapperOutput(utterance, {
      intent: String(parsed.intent ?? ''),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      params: (parsed.params as Record<string, unknown>) ?? {},
      mappingMethod: parsed.mappingMethod as ClassifiedIntent['mappingMethod'],
      rawUtterance: utterance,
    });
  } catch {
    return resolveManual(utterance, 'haiku_mapper_invalid_output', 0);
  }
}
