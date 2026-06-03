import { ParsedIntent, IntentResult, ParsedIntentSchema } from './adts.js';
import type { ConversationContext } from '../db/conversation-context.js';
import {
  getPendingEmailConfirmation,
  savePendingEmailConfirmation,
  clearPendingEmailConfirmation,
  type PendingEmailConfirmation,
} from '../db/conversation-context.js';
import { extractEmails } from './param-extract.js';
import { recordUsageEvent } from '../db/usage_events.js';

const CONFIRM_RE = /^(yes|yeah|yep|correct|that's right|that is right|confirm|ok|okay)\b/i;
const REJECT_RE = /^(no|nope|wrong|incorrect|not right)\b/i;
const SPELL_RE = /\b(spell|spelled|spelt)\b/i;

/** Short replies during the voice email-confirm step — not general chat. */
export function isEmailConfirmationReply(utterance: string): boolean {
  const t = utterance.trim();
  return CONFIRM_RE.test(t) || REJECT_RE.test(t) || SPELL_RE.test(t);
}

export function selectPrimaryEmail(utterance: string, emails: string[]): string {
  if (emails.length === 0) return '';
  if (emails.length === 1) return emails[0];
  return emails.reduce((best, e) => {
    const idx = utterance.toLowerCase().lastIndexOf(e);
    const bestIdx = utterance.toLowerCase().lastIndexOf(best);
    return idx >= bestIdx ? e : best;
  });
}

function emailConfirmPrompt(email: string, source: 'voice' | 'text'): string {
  if (source === 'text') {
    return `You entered ${email} — is that correct? Reply yes or no.`;
  }
  return `I heard ${email} — is that correct? Say yes, no, or spell it out.`;
}

export function collectEmailsFromIntent(parsed: ParsedIntent): string[] {
  const fromUtterance = extractEmails(parsed.rawUtterance);
  const params = parsed.params;
  const fromParams = [
    ...((params.participants as string[]) ?? []),
    ...((params.addInvitees as string[]) ?? []),
    params.recipientEmail as string,
    params.inviteeEmail as string,
    params.email as string,
  ].filter((e): e is string => typeof e === 'string' && e.includes('@'));

  return [...new Set([...fromUtterance, ...fromParams.map((e) => e.toLowerCase())])];
}

export function intentNeedsEmailConfirmation(parsed: ParsedIntent): boolean {
  if (parsed.intent === 'INVITE_PLATFORM') return true;
  if (parsed.intent === 'CREATE_EVENT' && collectEmailsFromIntent(parsed).length > 0) return true;
  if (parsed.intent === 'MODIFY_EVENT' && ((parsed.params.addInvitees as string[])?.length ?? 0) > 0) return true;
  if (parsed.intent === 'OFFER_SPECIFIC' && collectEmailsFromIntent(parsed).length > 0) return true;
  return false;
}

/** Voice spelled email only — not full sentences like "send a link to user@x.com". */
function spellOutEmail(utterance: string): string | null {
  const trimmed = utterance.trim();
  const extracted = extractEmails(trimmed);
  if (extracted.length === 1 && !/\b(at|dot)\b/i.test(trimmed)) {
    return null;
  }
  if (!/\b(at|dot)\b/i.test(trimmed)) {
    return null;
  }
  const spelled = trimmed
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s/g, '');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(spelled)) return spelled.toLowerCase();
  return null;
}

function mergePrimaryEmailIntoParsed(parsed: ParsedIntent, email: string): ParsedIntent {
  const params = { ...parsed.params };
  if (parsed.intent === 'CREATE_EVENT') {
    params.participants = [email];
  } else if (parsed.intent === 'MODIFY_EVENT') {
    params.addInvitees = [email];
  } else if (parsed.intent === 'OFFER_SPECIFIC') {
    params.recipientEmail = email;
  } else if (parsed.intent === 'INVITE_PLATFORM') {
    params.inviteeEmail = email;
    params.email = email;
  }
  return ParsedIntentSchema.parse({ ...parsed, params });
}

export async function handleEmailConfirmationGate(
  parsed: ParsedIntent,
  userId: string,
  _context: ConversationContext | null,
  source: 'voice' | 'text' = 'voice',
): Promise<{ proceed: true; parsed: ParsedIntent } | { proceed: false; result: IntentResult }> {
  const pending = await getPendingEmailConfirmation(userId);

  if (pending) {
    const utterance = parsed.rawUtterance.trim();

    if (CONFIRM_RE.test(utterance)) {
      await clearPendingEmailConfirmation(userId);
      await recordUsageEvent(userId, 'email_confirm_accepted', { email: pending.email });
      const merged = applyConfirmedEmail(pending, parsed);
      return { proceed: true, parsed: merged };
    }

    if (REJECT_RE.test(utterance) || SPELL_RE.test(utterance)) {
      await clearPendingEmailConfirmation(userId);
      await recordUsageEvent(userId, 'email_confirm_rejected', { email: pending.email });
      return {
        proceed: false,
        result: {
          intent: pending.originalIntent as ParsedIntent['intent'],
          success: false,
          requiresConfirmation: false,
          messageToUser: source === 'text'
            ? 'No problem. Type the correct email address.'
            : 'No problem. Please spell out the email address or type it in the chat.',
          schemaVersion: 1,
        },
      };
    }

    const spelled = spellOutEmail(utterance);
    if (spelled) {
      await savePendingEmailConfirmation(userId, {
        ...pending,
        email: spelled,
      });
      return {
        proceed: false,
        result: {
          intent: pending.originalIntent as ParsedIntent['intent'],
          success: false,
          requiresConfirmation: false,
          messageToUser: emailConfirmPrompt(spelled, source),
          schemaVersion: 1,
        },
      };
    }

    // Unrelated request (e.g. login calendar query) — drop stale pending and continue.
    await clearPendingEmailConfirmation(userId);
  }

  if (source === 'text' && !parsed.rawUtterance.includes('@')) {
    return { proceed: true, parsed };
  }

  if (!intentNeedsEmailConfirmation(parsed)) {
    return { proceed: true, parsed };
  }

  const emails = collectEmailsFromIntent(parsed);
  const primary = selectPrimaryEmail(parsed.rawUtterance, emails);
  if (!primary) return { proceed: true, parsed };

  if (source === 'text') {
    return { proceed: true, parsed: mergePrimaryEmailIntoParsed(parsed, primary) };
  }

  await savePendingEmailConfirmation(userId, {
    email: primary,
    originalIntent: parsed.intent,
    originalParams: parsed.params,
    originalUtterance: parsed.rawUtterance,
  });

  return {
    proceed: false,
    result: {
      intent: parsed.intent,
      success: false,
      requiresConfirmation: false,
      messageToUser: emailConfirmPrompt(primary, source),
      schemaVersion: 1,
    },
  };
}

function applyConfirmedEmail(pending: PendingEmailConfirmation, parsed: ParsedIntent): ParsedIntent {
  const params = { ...parsed.params, ...pending.originalParams };

  if (pending.originalIntent === 'CREATE_EVENT') {
    params.participants = [pending.email];
  } else if (pending.originalIntent === 'MODIFY_EVENT') {
    params.addInvitees = [pending.email];
  } else if (pending.originalIntent === 'OFFER_SPECIFIC') {
    params.recipientEmail = pending.email;
  } else if (pending.originalIntent === 'INVITE_PLATFORM') {
    params.inviteeEmail = pending.email;
    params.email = pending.email;
  }

  return ParsedIntentSchema.parse({
    ...parsed,
    intent: pending.originalIntent,
    params,
    confidence: Math.max(parsed.confidence, 0.9),
    mappingMethod: parsed.mappingMethod,
    rawUtterance: pending.originalUtterance ?? parsed.rawUtterance,
  });
}
