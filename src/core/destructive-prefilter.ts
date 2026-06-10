import { type ParsedIntent, ParsedIntentSchema } from './adts.js';

const LOWER = (s: string) => s.toLowerCase();

const DESTRUCTIVE_VERB =
  /\b(delete|cancels?|remov(?:e|ing|ed|es)|clears?|flushes?|wipes?|erases?|moves?|reschedul(?:e|ing|es)|postpones?|shifts?)\b/i;

const HAS_RANGE_OR_BULK = /\b(next\s+week|all\s+week|rest\s+of|entire|everything|all\s+events|all\s+my|all\s+day|all\s+tomorrow|this\s+week|next\s+month|except)\b/i;

/** Strong bulk: wide calendar clears / cancel-everything — not a single "delete X tomorrow" event. */
const FLUSH_CANCEL_OR_DELETE_BULK = /\b(completely|everything|entire|rest\s+of|all\s+my|all\s+events|all\s+day|all\s+tomorrow|next\s+week|this\s+week|next\s+month|clear my calendar|wipe (my |the )?calendar|cancel all)\b|(?=.*\b(cancel|delete|remove)\b).*\b(whole|entire) (day|week)\b/i;

const HAS_EVENT_REF =
  /\b(appointment|meeting|call|lunch|event|interview|dentist|block|slot|sync|standup|workshop|review|hold|3\s*pm|2\s*pm|\d{1,2}:\d{2}|am\b|pm\b|friday|monday|tuesday|wednesday|thursday|saturday|sunday|today|tomorrow|calendar|usual)\b/i;

/** Wider GCal list horizon hint for downstream confirmation (not executable intent). */
function flushHorizonHintDays(utterance: string): number | undefined {
  const t = LOWER(utterance);
  if (/\bnext\s+month\b/.test(t)) return 45;
  if (/\bnext\s+week\b/.test(t)) return 14;
  if (/\bthis\s+week\b/.test(t)) return 7;
  return undefined;
}

/** For delete/remove/cancel: bare weekday/day words are ambiguous → clarify (destructive safety). */
const STRONG_DELETE_ANCHOR =
  /\b(?:appointments?|meetings?|calls?|lunch(?:es)?|events?|sessions?|\b(?:sync|slot|standup)s?|interview|dentists?|\bvisit\b|\breviews?|workshops?\b|(?:recurring\s+)?holds?|\b\d\s*-\s*\d\b|\b\d{1,2}\s*-\s*\d{1,2}(?:am|pm)?\b|'[^'\n]{1,140}'|"[^"\n]{1,140}"|\b\d{1,2}\s*:\s*\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b|\b(?:called|named|titled)\s+[^\s.]+)/i;

export type DestructivePrefilterResult = { use: 'none' } | { use: 'manual' } | { use: 'intent'; intent: ParsedIntent };

function safetyManual(
  utterance: string,
  reason: string,
  extraParams: Record<string, unknown> = {},
  confidence = 0.95
): DestructivePrefilterResult {
  return {
    use: 'intent',
    intent: ParsedIntentSchema.parse({
      intent: 'RESOLVE_MANUAL',
      confidence,
      rawUtterance: utterance,
      params: { reason, ...extraParams },
      mappingMethod: 'resolve_manual',
    }),
  };
}

/**
 * Safety-only gate before Haiku — never emits executable FLUSH_RANGE / MODIFY_EVENT / CREATE.
 * Blocks unbounded deletes, bulk clears, and ambiguous destructive phrasing.
 */
export function prefilterDestructive(utterance: string): DestructivePrefilterResult {
  if (!DESTRUCTIVE_VERB.test(utterance)) {
    return { use: 'none' };
  }

  const t = LOWER(utterance);
  if (/\bcancel\s+culture\b/.test(t)) {
    return { use: 'none' };
  }

  const hasException = /\b(except|but not|other than|skip)\b/.test(t);
  if (hasException && (/\bclear\b|\bflush\b|\bwipe\b|\bdelete\s+all\b/.test(t) || HAS_RANGE_OR_BULK.test(t))) {
    return { use: 'manual' };
  }

  if (/\b(delete|cancel|clear|wipe|remove|flush)\s+(everything|all)\b/i.test(utterance) && !/\b(tomorrow|today|week|month|after|before|morning|afternoon|evening|weekend)\b/i.test(utterance)) {
    return safetyManual(utterance, 'unbounded_delete');
  }

  if (/\b(move|reschedule|postpone|shift)\s+(everything|all)\b/i.test(utterance)) {
    return safetyManual(utterance, 'bulk_move_unsupported');
  }

  const hasClearFamily = /\b(clear|flush|wipe|erase)\b/i.test(utterance);
  const hasCancelDeleteRemove = /\b(cancel|delete|remove)\b/i.test(utterance);
  const isClearFamilyBulk = hasClearFamily && HAS_RANGE_OR_BULK.test(utterance);
  const isCancelDeleteRemoveBulk = hasCancelDeleteRemove && FLUSH_CANCEL_OR_DELETE_BULK.test(utterance);
  const isBulkOrRange = isClearFamilyBulk || isCancelDeleteRemoveBulk;

  if (isBulkOrRange) {
    const horizon = flushHorizonHintDays(utterance);
    return safetyManual(utterance, 'destructive_bulk_requires_confirmation', {
      attemptedIntent: 'FLUSH_RANGE',
      ...(horizon != null ? { flushGcalListHorizonDays: horizon } : {}),
    });
  }

  if (/\b(delete|cancel|remove)\b/i.test(utterance) && !STRONG_DELETE_ANCHOR.test(utterance)) {
    return { use: 'manual' };
  }

  if (/\b(clear|flush|wipe|erase)\b/i.test(utterance)) {
    if (!HAS_EVENT_REF.test(utterance) && !/\b(week|range|day|afternoon|morning)\b/i.test(utterance)) {
      return { use: 'manual' };
    }
  }

  // Event-scoped destructive language — Haiku is semantic authority (no pre-Haiku MODIFY_EVENT).
  return { use: 'none' };
}
