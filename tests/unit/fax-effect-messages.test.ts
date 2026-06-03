import { describe, it, expect } from 'vitest';
import { generateFaxEffectMessage } from '../../src/core/fax-effect.js';
import { type CandidateSlot, type CalendarEvent, type UserPolicyProfile } from '../../src/core/adts.js';

const BASE_PROFILE: UserPolicyProfile = {
  userId: '8b616ceb-7e77-4886-9361-92a534374fac',
  schemaVersion: 1,
  timezone: 'America/Chicago',
  chronotype: 'morning',
  defaultBufferMinutes: 15,
  clusteringPreference: 'balanced',
  maxFragmentsPerDay: 4,
  faxEffectConfig: {
    targetSlotsPerOffer: 2,
    minBufferMinutes: 15,
    clusteringWeight: 0.35,
    energyWeight: 0.45,
    fragmentPenaltyWeight: 0.15,
    protectDeepWorkBlocks: true,
  },
  protectedBlocks: [],
  contactTiers: {},
};

function makeSlot(hour: number): CandidateSlot {
  return {
    start: `2026-04-22T${String(hour).padStart(2, '0')}:15:00-05:00`,
    end: `2026-04-22T${String(hour + 1).padStart(2, '0')}:15:00-05:00`,
    adjacentEventCount: 1,
    energyScore: 0.8,
    createsFragment: false,
  };
}

function makeEvent(tier: 0 | 1 | 2 | 3, title = 'Test Event'): CalendarEvent {
  return {
    id: 'eebb589c-429c-4a36-a7bb-ee2652832aaa',
    title,
    start: '2026-04-22T09:00:00-05:00',
    end: '2026-04-22T10:00:00-05:00',
    participants: [],
    tier,
    isRecurring: false,
    status: 'confirmed',
  };
}

describe('generateFaxEffectMessage', () => {
  it('OFFER_SPECIFIC with 2 slots — mentions both times', () => {
    const slots = [makeSlot(14), makeSlot(16)];
    const msg = generateFaxEffectMessage('OFFER_SPECIFIC', slots, [], BASE_PROFILE);
    expect(msg).toContain('2:15 PM');
    expect(msg).toContain('4:15 PM');
    expect(msg.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(40);
  });

  it('OFFER_SPECIFIC with 1 slot — mentions one time', () => {
    const slots = [makeSlot(10)];
    const msg = generateFaxEffectMessage('OFFER_SPECIFIC', slots, [], BASE_PROFILE);
    expect(msg).toContain('10:15 AM');
    expect(msg.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(40);
  });

  it('OFFER_SPECIFIC with no slots — returns no-slot message', () => {
    const msg = generateFaxEffectMessage('OFFER_SPECIFIC', [], [], BASE_PROFILE);
    expect(msg).toContain('No suitable');
  });

  it('PIVOT_ASYNC returns Loom message', () => {
    const msg = generateFaxEffectMessage('PIVOT_ASYNC', [], [], BASE_PROFILE);
    expect(msg).toContain('Loom');
    expect(msg.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(40);
  });

  it('FLUSH_RANGE with Tier 1 events mentions event names', () => {
    const events = [makeEvent(1, 'Sarah Chen Call')];
    const msg = generateFaxEffectMessage('FLUSH_RANGE', [], events, BASE_PROFILE);
    expect(msg).toContain('Sarah Chen Call');
  });

  it('FLUSH_RANGE with no protected events — confirmation message', () => {
    const events = [makeEvent(2)];
    const msg = generateFaxEffectMessage('FLUSH_RANGE', [], events, BASE_PROFILE);
    expect(msg).toContain('cancelled');
  });

  it('PROTECT_BLOCK returns confirmation message', () => {
    const msg = generateFaxEffectMessage('PROTECT_BLOCK', [], [], BASE_PROFILE);
    expect(msg).toContain('protected');
    expect(msg.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(40);
  });

  it('MODIFY_EVENT mentions the event name', () => {
    const events = [makeEvent(2, 'Team Standup')];
    const msg = generateFaxEffectMessage('MODIFY_EVENT', [], events, BASE_PROFILE);
    expect(msg).toContain('Team Standup');
  });

  it('SHAPE_RULES confirms preferences updated', () => {
    const msg = generateFaxEffectMessage('SHAPE_RULES', [], [], BASE_PROFILE);
    expect(msg).toContain('preferences');
  });

  it('GATEKEEP_RULE confirms contact priority', () => {
    const msg = generateFaxEffectMessage('GATEKEEP_RULE', [], [], BASE_PROFILE);
    expect(msg).toContain('priority');
  });

  it('RESOLVE_MANUAL asks for clarification', () => {
    const msg = generateFaxEffectMessage('RESOLVE_MANUAL', [], [], BASE_PROFILE);
    expect(msg).toContain('clarify');
  });

  it('WARM_REDIRECT stays friendly and on-scope', () => {
    const msg = generateFaxEffectMessage('WARM_REDIRECT', [], [], BASE_PROFILE);
    expect(msg).toMatch(/scheduling|calendar/i);
  });

  it('unknown intent returns Done', () => {
    const msg = generateFaxEffectMessage('UNKNOWN_INTENT', [], [], BASE_PROFILE);
    expect(msg).toBe('Done.');
  });

  it('all messages respect 40-word limit', () => {
    const intents = [
      'PROTECT_BLOCK', 'OFFER_SPECIFIC', 'FLUSH_RANGE', 'PIVOT_ASYNC',
      'MODIFY_EVENT', 'SHAPE_RULES', 'GATEKEEP_RULE', 'RESOLVE_MANUAL', 'WARM_REDIRECT', 'SCHEDULING_LINK',
    ];
    for (const intent of intents) {
      const msg = generateFaxEffectMessage(intent, [makeSlot(14), makeSlot(16)], [], BASE_PROFILE);
      const wordCount = msg.split(/\s+/).filter(Boolean).length;
      expect(wordCount, `${intent} exceeded 40 words: "${msg}"`).toBeLessThanOrEqual(40);
    }
  });
});
