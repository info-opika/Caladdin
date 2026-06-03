import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  calculateFaxEffectScore,
  computeEnergyScore,
  bufferViolation,
} from '../../src/core/intents/offer-specific.js';
import { type CandidateSlot, type UserPolicyProfile } from '../../src/core/adts.js';

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
    minBufferMinutes: 30,
    clusteringWeight: 0.35,
    energyWeight: 0.45,
    fragmentPenaltyWeight: 0.15,
    protectDeepWorkBlocks: true,
  },
  protectedBlocks: [],
  contactTiers: {},
};

function makeSlot(
  startISO: string,
  overrides: Partial<CandidateSlot> = {}
): CandidateSlot {
  const start = DateTime.fromISO(startISO).toISO() ?? startISO;
  const end = DateTime.fromISO(startISO).plus({ minutes: 60 }).toISO() ?? startISO;
  return {
    start,
    end,
    adjacentEventCount: 0,
    energyScore: 0.8,
    createsFragment: false,
    ...overrides,
  };
}

describe('Fax Effect — calculateFaxEffectScore', () => {
  it('returns -Infinity for buffer violation (slot duration < minBufferMinutes)', () => {
    const slot: CandidateSlot = {
      start: '2026-04-22T14:00:00-05:00',
      end: '2026-04-22T14:20:00-05:00',
      adjacentEventCount: 2,
      energyScore: 1.0,
      createsFragment: false,
    };
    const score = calculateFaxEffectScore(slot, BASE_PROFILE);
    expect(score).toBe(-Infinity);
  });

  it('applies clustering bonus for adjacent events', () => {
    const slotNoAdj = makeSlot('2026-04-22T14:00:00-05:00', { adjacentEventCount: 0, energyScore: 0.5, createsFragment: false });
    const slotWithAdj = makeSlot('2026-04-22T14:00:00-05:00', { adjacentEventCount: 2, energyScore: 0.5, createsFragment: false });

    const scoreNoAdj = calculateFaxEffectScore(slotNoAdj, BASE_PROFILE);
    const scoreWithAdj = calculateFaxEffectScore(slotWithAdj, BASE_PROFILE);

    expect(scoreWithAdj).toBeGreaterThan(scoreNoAdj);
  });

  it('penalizes fragmentation', () => {
    const slotNoFrag = makeSlot('2026-04-22T14:00:00-05:00', { createsFragment: false, energyScore: 0.8 });
    const slotFrag = makeSlot('2026-04-22T14:00:00-05:00', { createsFragment: true, energyScore: 0.8 });

    const scoreNoFrag = calculateFaxEffectScore(slotNoFrag, BASE_PROFILE);
    const scoreFrag = calculateFaxEffectScore(slotFrag, BASE_PROFILE);

    expect(scoreNoFrag).toBeGreaterThan(scoreFrag);
  });

  it('applies energy weight correctly', () => {
    const highEnergy = makeSlot('2026-04-22T14:00:00-05:00', { energyScore: 1.0, adjacentEventCount: 0, createsFragment: false });
    const lowEnergy = makeSlot('2026-04-22T14:00:00-05:00', { energyScore: 0.2, adjacentEventCount: 0, createsFragment: false });

    const scoreHigh = calculateFaxEffectScore(highEnergy, BASE_PROFILE);
    const scoreLow = calculateFaxEffectScore(lowEnergy, BASE_PROFILE);

    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it('score is finite for valid slot', () => {
    const slot = makeSlot('2026-04-22T14:00:00-05:00', { energyScore: 0.8, adjacentEventCount: 1, createsFragment: false });
    const score = calculateFaxEffectScore(slot, BASE_PROFILE);
    expect(isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });
});

describe('Fax Effect — computeEnergyScore', () => {
  it('morning chronotype at 9am returns energyScore 1.0', () => {
    const dt = DateTime.fromObject({ hour: 9 }, { zone: 'America/Chicago' });
    const score = computeEnergyScore(dt, 'morning');
    expect(score).toBe(1.0);
  });

  it('morning chronotype at 8am returns 1.0 (in 8-11 window)', () => {
    const dt = DateTime.fromObject({ hour: 8 }, { zone: 'America/Chicago' });
    const score = computeEnergyScore(dt, 'morning');
    expect(score).toBe(1.0);
  });

  it('morning chronotype at 7am returns 0.7', () => {
    const dt = DateTime.fromObject({ hour: 7 }, { zone: 'America/Chicago' });
    const score = computeEnergyScore(dt, 'morning');
    expect(score).toBe(0.7);
  });

  it('morning chronotype at 22:00 returns 0.2', () => {
    const dt = DateTime.fromObject({ hour: 22 }, { zone: 'America/Chicago' });
    const score = computeEnergyScore(dt, 'morning');
    expect(score).toBe(0.2);
  });

  it('evening chronotype at 16:00 returns 1.0', () => {
    const dt = DateTime.fromObject({ hour: 16 }, { zone: 'America/Chicago' });
    const score = computeEnergyScore(dt, 'evening');
    expect(score).toBe(1.0);
  });

  it('evening chronotype at 13:00 returns 0.7', () => {
    const dt = DateTime.fromObject({ hour: 13 }, { zone: 'America/Chicago' });
    const score = computeEnergyScore(dt, 'evening');
    expect(score).toBe(0.7);
  });

  it('flexible chronotype at 12:00 returns 0.75', () => {
    const dt = DateTime.fromObject({ hour: 12 }, { zone: 'America/Chicago' });
    const score = computeEnergyScore(dt, 'flexible');
    expect(score).toBe(0.75);
  });

  it('flexible chronotype at 20:00 returns 0.4', () => {
    const dt = DateTime.fromObject({ hour: 20 }, { zone: 'America/Chicago' });
    const score = computeEnergyScore(dt, 'flexible');
    expect(score).toBe(0.4);
  });
});

describe('Fax Effect — bufferViolation', () => {
  it('returns true when slot is shorter than minBufferMinutes', () => {
    const slot: CandidateSlot = {
      start: '2026-04-22T14:00:00-05:00',
      end: '2026-04-22T14:20:00-05:00',
      adjacentEventCount: 0,
      energyScore: 1.0,
      createsFragment: false,
    };
    expect(bufferViolation(slot, BASE_PROFILE)).toBe(true);
  });

  it('returns false when slot meets minBufferMinutes', () => {
    const slot: CandidateSlot = {
      start: '2026-04-22T14:00:00-05:00',
      end: '2026-04-22T14:30:00-05:00',
      adjacentEventCount: 0,
      energyScore: 1.0,
      createsFragment: false,
    };
    expect(bufferViolation(slot, BASE_PROFILE)).toBe(false);
  });
});