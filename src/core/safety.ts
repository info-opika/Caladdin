import { UUID_RE, ParsedIntent, Intent, MUTATION_INTENTS, CalendarEvent, UserPolicyProfile } from './adts.js';
import { globalRateLimiter } from './rate-limiter.js';
import { listEvents } from '../db/events.js';

export function validateUserId(userId: string): { valid: boolean; error?: string } {
  if (!userId || !UUID_RE.test(userId)) {
    return { valid: false, error: 'Invalid user ID' };
  }
  return { valid: true };
}

/**
 * Strict user-id guard used at the boundary before any DB access.
 * Throws on missing/blank/non-UUID input; returns the id otherwise.
 */
export function validateUser(userId: string | null | undefined): string {
  if (!userId || !userId.trim() || !UUID_RE.test(userId)) {
    throw new Error('Invalid user ID format');
  }
  return userId;
}

const DESTRUCTIVE_MUTATION_INTENTS: readonly Intent[] = ['FLUSH_RANGE', 'MODIFY_EVENT'];

export interface MutationCheckResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  blockedReason?: string;
}

/**
 * Tier-based mutation gate.
 * - Tier 0: never mutated without explicit confirmation (blocked).
 * - Tier 1 + destructive intent: requires confirmation (blocked).
 * - Otherwise: allowed.
 */
export function checkMutation(
  intent: Intent,
  event: CalendarEvent,
  _profile: UserPolicyProfile,
): MutationCheckResult {
  const destructive = DESTRUCTIVE_MUTATION_INTENTS.includes(intent);
  const tier = event.tier ?? 0;

  if (tier === 0) {
    return {
      allowed: false,
      requiresConfirmation: true,
      blockedReason: 'Tier 0 event cannot be mutated without confirmation',
    };
  }

  if (tier === 1 && destructive) {
    return {
      allowed: false,
      requiresConfirmation: true,
      blockedReason: 'Tier 1 destructive mutation requires confirmation',
    };
  }

  return { allowed: true, requiresConfirmation: false };
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
