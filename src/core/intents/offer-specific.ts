import { DateTime } from 'luxon';
import { type CandidateSlot, type UserPolicyProfile } from '../adts.js';
import { gcalGetFreeBusy } from '../../services/gcal.js';
import type { OAuth2Client } from 'google-auth-library';

export { gcalGetFreeBusy };

export function bufferViolation(slot: CandidateSlot, profile: UserPolicyProfile): boolean {
  const minMinutes = profile.faxEffectConfig?.minBufferMinutes ?? 15;
  const start = DateTime.fromISO(slot.start);
  const end = DateTime.fromISO(slot.end);
  if (!start.isValid || !end.isValid) return true;
  return end.diff(start, 'minutes').minutes < minMinutes;
}

export function computeEnergyScore(dt: DateTime, chronotype: string): number {
  const hour = dt.hour;
  if (chronotype === 'evening') {
    if (hour >= 15 && hour <= 18) return 1.0;
    if (hour >= 12 && hour < 15) return 0.7;
    if (hour >= 20) return 0.4;
    return 0.5;
  }
  if (chronotype === 'flexible') {
    if (hour >= 10 && hour <= 14) return 0.75;
    if (hour >= 20) return 0.4;
    return 0.6;
  }
  // morning default
  if (hour >= 8 && hour <= 11) return 1.0;
  if (hour === 7) return 0.7;
  if (hour >= 22 || hour < 7) return 0.2;
  return 0.5;
}

export function calculateFaxEffectScore(slot: CandidateSlot, profile: UserPolicyProfile): number {
  if (bufferViolation(slot, profile)) return -Infinity;

  const cfg = profile.faxEffectConfig ?? {
    clusteringWeight: 0.35,
    energyWeight: 0.45,
    fragmentPenaltyWeight: 0.15,
    minBufferMinutes: 15,
  };

  const clusteringBonus = Math.min(slot.adjacentEventCount ?? 0, 3) / 3;
  const energy = slot.energyScore ?? 0.5;
  const fragmentPenalty = slot.createsFragment ? 0.3 : 0;

  return (
    cfg.energyWeight * energy +
    cfg.clusteringWeight * clusteringBonus -
    cfg.fragmentPenaltyWeight * fragmentPenalty
  );
}

export function selectTopSlots(
  candidates: CandidateSlot[],
  profile: UserPolicyProfile,
  count = 2,
): CandidateSlot[] {
  return candidates
    .filter((s) => !bufferViolation(s, profile))
    .map((s) => ({ slot: s, score: calculateFaxEffectScore(s, profile) }))
    .filter((x) => isFinite(x.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.slot);
}

export interface OfferSpecificResult {
  success: boolean;
  intent: 'OFFER_SPECIFIC';
  slots?: CandidateSlot[];
  failureReason?: string;
  requiresConfirmation: boolean;
}

export async function offerSpecific(
  _intent: { rawUtterance: string },
  profile: UserPolicyProfile,
  candidates: CandidateSlot[],
  oauthClient: OAuth2Client | null,
): Promise<OfferSpecificResult> {
  if (!oauthClient) {
    return {
      success: false,
      intent: 'OFFER_SPECIFIC',
      failureReason: 'Google Calendar not connected. Please sign in again.',
      requiresConfirmation: false,
    };
  }

  const now = DateTime.now().toUTC().toISO()!;
  const later = DateTime.now().plus({ days: 14 }).toUTC().toISO()!;
  const busy = await gcalGetFreeBusy(oauthClient, now, later);

  const filtered = candidates.filter((slot) => {
    const ss = DateTime.fromISO(slot.start);
    const se = DateTime.fromISO(slot.end);
    return !busy.some((b) => {
      const bs = DateTime.fromISO(b.start);
      const be = DateTime.fromISO(b.end);
      return ss < be && se > bs;
    });
  });

  const top = selectTopSlots(filtered.length ? filtered : candidates, profile, 2);
  if (top.length === 0) {
    return {
      success: false,
      intent: 'OFFER_SPECIFIC',
      failureReason: 'No open slots found that work with your calendar.',
      requiresConfirmation: false,
    };
  }

  return {
    success: true,
    intent: 'OFFER_SPECIFIC',
    slots: top,
    requiresConfirmation: false,
  };
}
