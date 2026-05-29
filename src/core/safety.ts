import { UUID_RE, ParsedIntent, Intent, MUTATION_INTENTS } from './adts.js';
import { globalRateLimiter } from './rate-limiter.js';
import { listEvents } from '../db/events.js';

export function validateUserId(userId: string): { valid: boolean; error?: string } {
  if (!userId || !UUID_RE.test(userId)) {
    return { valid: false, error: 'Invalid user ID' };
  }
  return { valid: true };
}

export function validateUtterance(utterance: string, maxLength: number): { valid: boolean; error?: string } {
  const trimmed = utterance?.trim();
  if (!trimmed) return { valid: false, error: 'Utterance is required' };
  if (trimmed.length > maxLength) return { valid: false, error: `Utterance too long (max ${maxLength} characters)` };
  return { valid: true };
}

export function isMutationIntent(intent: Intent): boolean {
  return MUTATION_INTENTS.includes(intent);
}

export function checkRateLimit(userId: string, intent: Intent): { allowed: boolean; retryAfterMs?: number } {
  if (!isMutationIntent(intent)) return { allowed: true };
  return globalRateLimiter.check(userId);
}

export async function computeBlastRadius(userId: string, rangeStart: string, rangeEnd: string): Promise<number> {
  const events = await listEvents(userId, rangeStart, rangeEnd);
  return events.filter((e) => e.status !== 'cancelled').length;
}

export function requiresConfirmationForTier(tier: number, destructive: boolean): boolean {
  if (tier === 0) return true;
  if (tier === 1 && destructive) return true;
  return false;
}

export interface PreflightResult {
  requiresConfirmation: boolean;
  blocked: boolean;
  blockReason?: string;
}

export async function preflightSafety(
  parsed: ParsedIntent,
  userId: string,
  blastRadius?: number,
): Promise<PreflightResult> {
  const destructive = !!parsed._destructivePreFilter ||
    ['FLUSH_RANGE', 'MODIFY_EVENT'].includes(parsed.intent);

  if (parsed.intent === 'FLUSH_RANGE' && (blastRadius ?? 0) > 5) {
    return { requiresConfirmation: true, blocked: false };
  }

  if (parsed._destructivePreFilter) {
    return { requiresConfirmation: true, blocked: false };
  }

  if (parsed.intent === 'FLUSH_RANGE') {
    return { requiresConfirmation: true, blocked: false };
  }

  if (destructive && parsed.params.tier === 0) {
    return { requiresConfirmation: true, blocked: false };
  }

  return { requiresConfirmation: false, blocked: false };
}
