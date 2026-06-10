import { type ParsedIntent, ParsedIntentSchema } from './adts.js';
import { detectUnsupportedSchedulingConstraints } from './scheduling-link-prefilter.js';

/**
 * Finalize SCHEDULING_LINK params after Haiku — no raw-utterance date/window inference (PCC4.2R).
 */
export function finalizeSchedulingLinkStructuredContract(
  utterance: string,
  _tz: string,
  draft: ParsedIntent
): ParsedIntent {
  if (draft.intent !== 'SCHEDULING_LINK') return draft;

  const unsupportedConstraints = detectUnsupportedSchedulingConstraints(utterance);
  if (unsupportedConstraints.length > 0) {
    const hintMail =
      typeof (draft.params as { inviteeEmail?: string }).inviteeEmail === 'string'
        ? (draft.params as { inviteeEmail: string }).inviteeEmail
        : undefined;
    return ParsedIntentSchema.parse({
      intent: 'RESOLVE_MANUAL',
      rawUtterance: utterance,
      confidence: 0.55,
      params: {
        reason: 'scheduling_constraints_need_clarification',
        unsupportedConstraints,
        ...(hintMail ? { inviteeHintEmail: hintMail } : {}),
      },
      mappingMethod: 'resolve_manual',
    });
  }

  const p = { ...(draft.params as Record<string, unknown>) };
  if (!Array.isArray(p['schedulingUnsupportedConstraints'])) {
    p['schedulingUnsupportedConstraints'] = [];
  }

  const pr = p['parsedSchedulingDateRange'];
  const hasRange =
    typeof pr === 'object' &&
    pr !== null &&
    typeof (pr as { start?: unknown }).start === 'string' &&
    typeof (pr as { end?: unknown }).end === 'string' &&
    (pr as { start: string }).start.length >= 8 &&
    (pr as { end: string }).end.length >= 8;

  if (!hasRange && p['schedulingDefaultSearchWindow'] !== true) {
    const hintMail =
      typeof (draft.params as { inviteeEmail?: string }).inviteeEmail === 'string'
        ? (draft.params as { inviteeEmail: string }).inviteeEmail
        : undefined;
    return ParsedIntentSchema.parse({
      intent: 'RESOLVE_MANUAL',
      rawUtterance: utterance,
      confidence: Math.min(draft.confidence, 0.55),
      params: {
        reason: 'scheduling_when_needed',
        ...(hintMail ? { inviteeHintEmail: hintMail } : {}),
      },
      mappingMethod: 'resolve_manual',
    });
  }

  return ParsedIntentSchema.parse({
    ...draft,
    params: p,
  });
}
