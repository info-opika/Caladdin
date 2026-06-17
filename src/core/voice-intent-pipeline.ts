/**
 * LC10 Wave 1 v3 — /voice semantic path.
 * Haiku is the first and only semantic authority; no parser-brain prefilters for intent selection.
 */
import {
  type ParsedIntent,
  ParsedIntentSchema,
  ProtectBlockParamsSchema,
} from './adts.js';
import { prefilterDestructive } from './destructive-prefilter.js';
import { tryMatchQueryCalendar } from './query-prefilter.js';
import { validateHaikuMapperOutput } from './parsed-intent-validator.js';
import { classifyIntent, isCalendarRelated } from '../services/llm.js';
import type { ClassifiedIntent } from '../services/anthropic-config.js';
import { insertFailureLog } from '../db/failures.js';
import { logger } from '../logger.js';
import { hydrateModifyIntentContract } from './modify-event-target.js';
import { finalizeSchedulingLinkStructuredContract } from './scheduling-link-contract.js';
import { detectUnsupportedSchedulingConstraints } from './scheduling-link-prefilter.js';
import {
  extractProtectKnownFieldsFromUtterance,
  getPendingIntent,
  clearPendingIntent,
  storePendingForClarification,
  tryCompletePendingIntent,
} from './pending-intent-memory.js';
import { tryProtectBlockFromInfer } from './protect-block-prefilter.js';

const DESTRUCTIVE_VERB =
  /\b(delete|cancels?|remov(?:e|ing|ed|es)|clears?|flushes?|wipes?|erases?|moves?|reschedul(?:e|ing|es)|postpones?|shifts?)\b/i;

const VAGUE_SLOT_WORD =
  /\b(mornings?|afternoons?|evenings?|lunch(?:\s+time)?|dinners?|deep\s+work|family\b)\b/i;

const EXPLICIT_TIME_OR_NUMERIC_RANGE = new RegExp(
  String.raw`\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s*(am|pm))?\b|\b(\d{1,2}):(\d{2})\b`,
  'i'
);

function utteranceNeedsExplicitProtectTimes(utterance: string): ParsedIntent | null {
  if (EXPLICIT_TIME_OR_NUMERIC_RANGE.test(utterance)) return null;
  if (/\bfrom\s+\d/i.test(utterance)) return null;
  if (!/\b(block|protect|shield|reserve|hold|no-meeting)\b/i.test(utterance)) return null;
  const vaguePersonal =
    VAGUE_SLOT_WORD.test(utterance) ||
    /\b(personal\s+time|focus\s+time|me\s+time|quiet\s+time)\b/i.test(utterance) ||
    /\b(a|some)\s+(personal|focus|quiet)\b/i.test(utterance);
  if (!vaguePersonal) return null;
  return ParsedIntentSchema.parse({
    intent: 'RESOLVE_MANUAL',
    rawUtterance: utterance,
    confidence: 0.5,
    params: { reason: 'vague_protect_timing', attemptedIntent: 'PROTECT_BLOCK' },
    mappingMethod: 'resolve_manual',
  });
}

export type VoicePipelineMeta = {
  haikuCalled: boolean;
  usedPendingTemplate: boolean;
  storedPendingTemplate: boolean;
  /** Follow-up matched pending protect but hour span needs am/pm clarification. */
  ambiguousFollowUpTime: boolean;
};

export type VoicePipelineResult = {
  intent: ParsedIntent;
  meta: VoicePipelineMeta;
};

function finalizeProtectBlockIntentVoice(utterance: string, base: ParsedIntent): ParsedIntent {
  const paramsOnly = ProtectBlockParamsSchema.safeParse(base.params);
  if (paramsOnly.success) {
    return ParsedIntentSchema.parse({
      ...base,
      intent: 'PROTECT_BLOCK',
      params: { ...paramsOnly.data, rawUtterance: utterance },
    });
  }

  if (base.intent === 'PROTECT_BLOCK') {
    return ParsedIntentSchema.parse({
      intent: 'RESOLVE_MANUAL',
      rawUtterance: utterance,
      confidence: Math.min(base.confidence, 0.55),
      params: { reason: 'protect_block_incomplete', attemptedIntent: 'PROTECT_BLOCK' },
      mappingMethod: 'resolve_manual',
    });
  }

  return base;
}

function applyPostHaikuSafetyGuards(utterance: string, classified: ParsedIntent): ParsedIntent {
  if (
    DESTRUCTIVE_VERB.test(utterance) &&
    (classified.intent === 'CREATE_EVENT' ||
      classified.intent === 'OFFER_SPECIFIC' ||
      classified.intent === 'QUERY_CALENDAR' ||
      classified.intent === 'UNDO' ||
      classified.intent === 'SCHEDULING_LINK')
  ) {
    return ParsedIntentSchema.parse({
      intent: 'RESOLVE_MANUAL',
      rawUtterance: utterance,
      confidence: 0.55,
      params: { reason: 'destructive_misclass_guard' },
      mappingMethod: 'resolve_manual',
    });
  }

  if (
    /\b(protect|block|shield|reserve|hold|no-meeting)\b/i.test(utterance) &&
    classified.intent === 'OFFER_SPECIFIC'
  ) {
    return ParsedIntentSchema.parse({
      intent: 'RESOLVE_MANUAL',
      rawUtterance: utterance,
      confidence: 0.55,
      params: { reason: 'protect_block_misclass_guard' },
      mappingMethod: 'resolve_manual',
    });
  }

  if (
    /\b(maybe|idk|not sure|don't know|unsure|perhaps|might|what works|what's happening|reminder to)\b/i.test(
      utterance
    ) &&
    classified.intent === 'CREATE_EVENT'
  ) {
    return ParsedIntentSchema.parse({
      intent: 'RESOLVE_MANUAL',
      rawUtterance: utterance,
      confidence: 0.55,
      params: { reason: 'vague_create_guard' },
      mappingMethod: 'resolve_manual',
    });
  }

  if (classified.intent === 'SCHEDULING_LINK') {
    const unsupported = detectUnsupportedSchedulingConstraints(utterance);
    if (unsupported.length > 0) {
      const p = classified.params as Record<string, unknown>;
      return ParsedIntentSchema.parse({
        intent: 'RESOLVE_MANUAL',
        rawUtterance: utterance,
        confidence: 0.55,
        params: {
          reason: 'scheduling_constraints_need_clarification',
          unsupportedConstraints: unsupported,
          ...(typeof p['inviteeEmail'] === 'string' ? { inviteeHintEmail: p['inviteeEmail'] } : {}),
        },
        mappingMethod: 'resolve_manual',
      });
    }
  }

  return classified;
}

const PROTECT_PARAM_KEYS = new Set([
  'label',
  'daysOfWeek',
  'startDate',
  'rangeEnd',
  'timezone',
  'tier',
  'startTime',
  'endTime',
]);

function collectKnownProtectFields(
  utterance: string,
  tz: string,
  haikuParams: Record<string, unknown>
): Record<string, unknown> {
  const fromUtterance = extractProtectKnownFieldsFromUtterance(utterance, tz);
  const fromHaiku = Object.fromEntries(
    Object.entries(haikuParams).filter(([k]) => PROTECT_PARAM_KEYS.has(k))
  );
  return { ...fromUtterance, ...fromHaiku };
}

async function maybeStoreProtectPending(
  userId: string,
  utterance: string,
  tz: string,
  result: ParsedIntent,
  haikuParams: Record<string, unknown>
): Promise<ParsedIntent> {
  const reason = typeof result.params?.['reason'] === 'string' ? result.params['reason'] : '';
  const needsPending =
    reason === 'vague_protect_timing' ||
    reason === 'protect_block_incomplete' ||
    reason === 'haiku_missing_fields';

  if (!needsPending) return result;

  const attempted =
    typeof result.params?.['attemptedIntent'] === 'string'
      ? result.params['attemptedIntent']
      : 'PROTECT_BLOCK';

  if (attempted !== 'PROTECT_BLOCK' && reason !== 'vague_protect_timing') return result;

  const missingFromHaiku = haikuParams['missingFields'];
  const missingFields = Array.isArray(missingFromHaiku)
    ? missingFromHaiku.filter((x): x is string => typeof x === 'string')
    : ['startTime', 'endTime'];

  const knownFields = collectKnownProtectFields(utterance, tz, haikuParams);

  await storePendingForClarification(
    userId,
    ParsedIntentSchema.parse({
      intent: 'PROTECT_BLOCK',
      rawUtterance: utterance,
      confidence: 0.5,
      params: knownFields,
      mappingMethod: 'resolve_manual',
    }),
    missingFields.length > 0 ? missingFields : ['startTime', 'endTime'],
    knownFields
  );

  return ParsedIntentSchema.parse({
    intent: 'RESOLVE_MANUAL',
    rawUtterance: utterance,
    confidence: 0.5,
    params: {
      reason:
        reason === 'vague_protect_timing'
          ? 'vague_protect_timing'
          : reason === 'haiku_missing_fields'
            ? 'haiku_missing_fields'
            : 'protect_block_incomplete',
    },
    mappingMethod: 'resolve_manual',
  });
}

/**
 * Maps a /voice utterance to ParsedIntent using Haiku as sole semantic authority.
 *
 * @deprecated Hot path for users with agentEnabledFor(userId). Kept for legacy
 * rollout until the scheduling agent fully replaces the Haiku classifier.
 */
export async function mapVoiceUtteranceToIntent(
  utterance: string,
  context: { userId: string; timezone: string }
): Promise<VoicePipelineResult> {
  const meta: VoicePipelineMeta = {
    haikuCalled: false,
    usedPendingTemplate: false,
    storedPendingTemplate: false,
    ambiguousFollowUpTime: false,
  };

  const t = utterance.trim();
  const tz = context.timezone.trim() || 'America/Chicago';

  const fromPending = await tryCompletePendingIntent(context.userId, t, tz);
  if (fromPending) {
    const pendingReason =
      typeof fromPending.params?.['reason'] === 'string' ? fromPending.params['reason'] : '';
    if (pendingReason === 'protect_followup_time_ambiguous') {
      meta.ambiguousFollowUpTime = true;
    } else {
      meta.usedPendingTemplate = true;
    }
    return { intent: fromPending, meta };
  }

  const destructive = prefilterDestructive(t);
  if (destructive.use === 'manual') {
    return {
      intent: ParsedIntentSchema.parse({
        intent: 'RESOLVE_MANUAL',
        rawUtterance: t,
        confidence: 0.5,
        params: { reason: 'destructive_or_ambiguous' },
        mappingMethod: 'resolve_manual',
      }),
      meta,
    };
  }
  if (destructive.use === 'intent') {
    return { intent: destructive.intent, meta };
  }

  const protectInfer = tryProtectBlockFromInfer(t, tz);
  if (protectInfer) {
    return { intent: protectInfer, meta };
  }

  const queryHit = tryMatchQueryCalendar(t);
  if (queryHit) {
    return {
      intent: ParsedIntentSchema.parse({
        intent: 'QUERY_CALENDAR',
        rawUtterance: t,
        confidence: 1,
        params: { ...queryHit },
        mappingMethod: 'direct',
      }),
      meta,
    };
  }

  if (/\bmars\b/i.test(t) && /\bcalendar/i.test(t)) {
    return {
      intent: ParsedIntentSchema.parse({
        intent: 'WARM_REDIRECT',
        rawUtterance: t,
        confidence: 1,
        params: {},
        mappingMethod: 'direct',
      }),
      meta,
    };
  }

  const activePending = await getPendingIntent(context.userId);
  if (!isCalendarRelated(t)) {
    if (activePending) {
      await clearPendingIntent(context.userId);
    }
    return {
      intent: ParsedIntentSchema.parse({
        intent: 'WARM_REDIRECT',
        rawUtterance: t,
        confidence: 1,
        params: {},
        mappingMethod: 'direct',
      }),
      meta,
    };
  }

  const vagueGate = utteranceNeedsExplicitProtectTimes(t);
  if (vagueGate) {
    const stored = await maybeStoreProtectPending(context.userId, t, tz, vagueGate, {});
    meta.storedPendingTemplate = true;
    return { intent: stored, meta };
  }

  let classifiedRaw: ClassifiedIntent;
  try {
    classifiedRaw = await classifyIntent(t, { timezone: tz, userId: context.userId.trim() });
    meta.haikuCalled = true;
  } catch (classifyErr) {
    logger.error('Voice Haiku classifier failed', { err: String(classifyErr), utterance: t });
    return {
      intent: ParsedIntentSchema.parse({
        intent: 'RESOLVE_MANUAL',
        rawUtterance: t,
        confidence: 0,
        params: { reason: 'llm_unavailable', llmUnavailableKind: 'classifier_unreachable' },
        mappingMethod: 'resolve_manual',
      }),
      meta,
    };
  }

  const haikuParams =
    typeof classifiedRaw.params === 'object' && classifiedRaw.params !== null
      ? { ...classifiedRaw.params }
      : {};

  let draft = validateHaikuMapperOutput(t, classifiedRaw);
  draft = applyPostHaikuSafetyGuards(t, draft);

  if (draft.intent === 'MODIFY_EVENT') {
    draft = hydrateModifyIntentContract(draft);
  }

  draft = finalizeProtectBlockIntentVoice(t, draft);
  draft = finalizeSchedulingLinkStructuredContract(t, tz, draft);

  const beforePending = draft;
  draft = await maybeStoreProtectPending(context.userId, t, tz, draft, haikuParams);
  if (draft !== beforePending) meta.storedPendingTemplate = true;

  if (
    classifiedRaw.confidence >= 0.6 &&
    classifiedRaw.confidence < 0.85 &&
    draft.intent !== 'RESOLVE_MANUAL' &&
    draft.intent !== 'WARM_REDIRECT'
  ) {
    await insertFailureLog({
      userId: context.userId,
      rawUtterance: t,
      attemptedIntent: draft.intent,
      confidence: classifiedRaw.confidence,
      failureReason: 'low_confidence_fuzzy',
    });
  }

  return { intent: draft, meta };
}
