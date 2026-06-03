import { describe, it, expect, vi, beforeEach } from 'vitest';
import { schedulingLink } from '../../src/core/intents/scheduling-link.js';
import type { ParsedIntent, UserPolicyProfile } from '../../src/core/adts.js';
import type { OAuth2Client } from 'google-auth-library';
import { DateTime } from 'luxon';

vi.mock('../../src/services/gcal.js', () => ({
  gcalListEvents: vi.fn().mockResolvedValue([]),
  gcalGetFreeBusy: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  insertSchedulingSession: vi.fn().mockResolvedValue({ token: 'deadbeefdeadbeefdeadbeefdeadbeef', id: 'sess-1' }),
  getActiveHoldIntervalsForHost: vi.fn().mockResolvedValue([]),
}));

import { gcalListEvents, gcalGetFreeBusy } from '../../src/services/gcal.js';
import { insertSchedulingSession, getActiveHoldIntervalsForHost } from '../../src/db/scheduling_sessions.js';

const profile: UserPolicyProfile = {
  userId: '11111111-1111-4111-8111-111111111111',
  schemaVersion: 1,
  timezone: 'America/Chicago',
  chronotype: 'flexible',
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

describe('schedulingLink intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CALADDIN_BASE_URL = 'http://localhost:3000';
  });

  it('creates session and returns public /s/ URL with two slots', async () => {
    const oauth = { request: vi.fn() } as unknown as OAuth2Client;
    const nwStart = DateTime.now().setZone('America/Chicago').plus({ weeks: 1 }).startOf('week');
    const nwEnd = nwStart.endOf('week');
    const intent: ParsedIntent = {
      intent: 'SCHEDULING_LINK',
      confidence: 0.95,
      rawUtterance: 'Schedule 30 minutes with guest1@example.test next week 9am to 5pm',
      params: {
        durationMinutes: 30,
        windowStartHourLocal: 9,
        windowEndHourLocal: 17,
        inviteeEmail: 'guest1@example.test',
        parsedSchedulingDateRange: { start: nwStart.toISODate()!, end: nwEnd.toISODate()! },
        schedulingUnsupportedConstraints: [],
      },
      mappingMethod: 'direct',
    };

    const result = await schedulingLink(intent, profile, profile.userId, oauth);

    expect(result.success).toBe(true);
    expect(insertSchedulingSession).toHaveBeenCalled();
    const call = vi.mocked(insertSchedulingSession).mock.calls[0]![0];
    expect(call.offeredSlots.length).toBe(2);
    expect(call.hostTimezone).toBe('America/Chicago');
    expect(call.inviteeEmail).toBe('guest1@example.test');
    const range = result.parsedSchedulingDateRange!;
    const start = DateTime.fromISO(range.start, { zone: 'America/Chicago' }).startOf('day');
    const end = DateTime.fromISO(range.end, { zone: 'America/Chicago' }).endOf('day');
    expect(
      call.offeredSlots.every((s) => {
        const dt = DateTime.fromISO(s.start, { zone: 'America/Chicago' });
        return dt >= start && dt <= end;
      })
    ).toBe(true);
    expect(result.schedulingUrl).toMatch(/\/s\/deadbeefdeadbeefdeadbeefdeadbeef$/);
    expect(result.parsedSchedulingDateRange).toBeTruthy();
    expect(result.offeredSlotDates?.length).toBeGreaterThan(0);
    expect(result.allSlotsInsideRequestedRange).toBe(true);
    expect(gcalListEvents).toHaveBeenCalled();
    expect(gcalGetFreeBusy).toHaveBeenCalled();
  });

  it('does not create session when soft holds block all availability', async () => {
    vi.mocked(getActiveHoldIntervalsForHost).mockResolvedValueOnce([
      { start: '2020-01-01T00:00:00.000Z', end: '2035-01-01T00:00:00.000Z' },
    ]);
    const oauth = { request: vi.fn() } as unknown as OAuth2Client;
    const intent: ParsedIntent = {
      intent: 'SCHEDULING_LINK',
      confidence: 1,
      rawUtterance: 'meet guest2@example.test 9am to 5pm',
      params: {
        windowStartHourLocal: 9,
        windowEndHourLocal: 17,
        inviteeEmail: 'guest2@example.test',
        schedulingUnsupportedConstraints: [],
        schedulingDefaultSearchWindow: true,
      },
      mappingMethod: 'direct',
    };
    const result = await schedulingLink(intent, profile, profile.userId, oauth);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('insufficient_slots');
    expect(insertSchedulingSession).not.toHaveBeenCalled();
  });

  it('fails gracefully when not authenticated', async () => {
    const intent: ParsedIntent = {
      intent: 'SCHEDULING_LINK',
      confidence: 1,
      rawUtterance: 'book with guest2@example.test 9am to 5pm',
      params: {
        windowStartHourLocal: 9,
        windowEndHourLocal: 17,
        inviteeEmail: 'guest2@example.test',
        schedulingUnsupportedConstraints: [],
        schedulingDefaultSearchWindow: true,
      },
      mappingMethod: 'direct',
    };
    const result = await schedulingLink(intent, profile, profile.userId, null);
    expect(result.success).toBe(false);
    expect(insertSchedulingSession).not.toHaveBeenCalled();
  });

  it('does not insert scheduling session when window bounds missing (defensive)', async () => {
    const oauth = { request: vi.fn() } as unknown as OAuth2Client;
    const intent: ParsedIntent = {
      intent: 'SCHEDULING_LINK',
      confidence: 1,
      rawUtterance: 'find time guest1@example.test next week',
      params: { inviteeEmail: 'guest1@example.test' },
      mappingMethod: 'direct',
    };
    const result = await schedulingLink(intent, profile, profile.userId, oauth);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('scheduling_structured_incomplete');
    expect(insertSchedulingSession).not.toHaveBeenCalled();
  });
});
