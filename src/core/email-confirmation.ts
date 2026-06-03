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

function spellOutEmail(utterance: string): string | null {
  const spelled = utterance
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s/g, '');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(spelled)) return spelled.toLowerCase();
  return null;
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
          messageToUser: 'No problem. Please spell out the email address or type it in the chat.',
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
          messageToUser: `I heard ${spelled} — is that correct? Say yes or no.`,
          schemaVersion: 1,
        },
      };
    }

    return {
      proceed: false,
      result: {
        intent: pending.originalIntent as ParsedIntent['intent'],
        success: false,
        requiresConfirmation: false,
        messageToUser: `I heard ${pending.email} — is that correct? Say yes, no, or spell it out.`,
        schemaVersion: 1,
      },
    };
  }

  if (source === 'text' && !parsed.rawUtterance.includes('@')) {
    return { proceed: true, parsed };
  }

  if (!intentNeedsEmailConfirmation(parsed)) {
    return { proceed: true, parsed };
  }

  const emails = collectEmailsFromIntent(parsed);
  const primary = emails[0];
  if (!primary) return { proceed: true, parsed };

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
      messageToUser: `I heard ${primary} — is that correct? Say yes, no, or spell it out.`,
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
