import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { protectBlock } from '../../../src/core/intents/protect-block.js';
import { type UserPolicyProfile, type ParsedIntent } from '../../../src/core/adts.js';
import * as gcal from '../../../src/services/gcal.js';

vi.mock('../../../src/db/policies.js', () => ({
  upsertUserPolicy: vi.fn().mockResolvedValue(undefined),
}));
vi.spyOn(gcal, 'gcalCreateRecurringEvent').mockResolvedValue(undefined);
vi.spyOn(gcal, 'gcalListEvents').mockResolvedValue([]);
vi.spyOn(gcal, 'gcalDeleteEvent').mockResolvedValue(undefined);
vi.spyOn(gcal, 'gcalUpdateEvent').mockResolvedValue(undefined);

import { upsertUserPolicy } from '../../../src/db/policies.js';

const mockUpsert = vi.mocked(upsertUserPolicy);

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

const MIN_PB = (): Record<string, unknown> => ({
  label: 'Deep Work',
  daysOfWeek: [2],
  startTime: '09:00',
  endTime: '10:00',
  rangeEnd: '2026-07-04',
});

function makeIntent(params: Record<string, unknown> = {}, raw = ''): ParsedIntent {
  return {
    intent: 'PROTECT_BLOCK',
    confidence: 0.95,
    rawUtterance: raw || 'Block Tuesdays',
    params,
    mappingMethod: 'direct',
  };
}

describe('protectBlock intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gcal.gcalListEvents).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds bounded recurring policy + sync when params valid', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-08T17:00:00.000Z'));

    const intent = makeIntent(MIN_PB());
    const oauth = {} as unknown as import('google-auth-library').OAuth2Client;

    const result = await protectBlock(intent, BASE_PROFILE, oauth, false);

    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/Done — I blocked.*Deep Work/);
    expect(result.messageToUser).not.toMatch(/Heads-up: overlapping/);
    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(gcal.gcalCreateRecurringEvent).toHaveBeenCalled();
    expect(gcal.gcalDeleteEvent).not.toHaveBeenCalled();
    expect(gcal.gcalUpdateEvent).not.toHaveBeenCalled();
    const gcalCalls = vi.mocked(gcal.gcalCreateRecurringEvent).mock.calls;
    expect(gcalCalls[0]?.[1]).toEqual(
      expect.objectContaining({
        title: 'Deep Work',
        untilUtcRfc: expect.stringMatching(/^\d{8}T\d{6}Z$/),
      }),
    );
  });

  it('rejects incomplete params safely (no policy write)', async () => {
    const result = await protectBlock(makeIntent({}), BASE_PROFILE);

    expect(result.success).toBe(false);
    expect(result.failureReason).toMatch(/title|start|weekdays|end date/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('requires confirmation before large weekday blast (hours or count)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-06T17:00:00.000Z'));

    const intent = makeIntent({
      label: 'Resperate breathing session',
      startTime: '07:00',
      endTime: '19:30',
      daysOfWeek: [1, 2, 3, 4, 5],
      rangeEnd: '2026-05-04',
      tier: 1,
    });
    const r = await protectBlock(intent, BASE_PROFILE);

    expect(r.success).toBe(false);
    expect(r.requiresConfirmation).toBe(true);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('preserves Tier 0 as confirmation-gated blast', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-08T17:00:00.000Z'));

    const intent = makeIntent({
      ...MIN_PB(),
      tier: 0,
    });
    const r = await protectBlock(intent, BASE_PROFILE);

    expect(r.requiresConfirmation).toBe(true);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('runs after approved confirmation regardless of blast', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-06T17:00:00.000Z'));

    const intent = makeIntent({
      label: 'Resperate breathing session',
      startTime: '07:00',
      endTime: '19:30',
      daysOfWeek: [1, 2, 3, 4, 5],
      rangeEnd: '2026-05-04',
      tier: 1,
    });

    await protectBlock(intent, BASE_PROFILE, null, true);

    expect(mockUpsert).toHaveBeenCalledOnce();
  });

  it('returns validated IntentResult shape', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-08T17:00:00.000Z'));

    const result = await protectBlock(makeIntent(MIN_PB()), BASE_PROFILE);

    expect(result.success).toBeDefined();
    expect(result.intent).toBeDefined();
    expect(result.requiresConfirmation).toBeDefined();
    expect(result.atomicOp).toBeDefined();
    expect(result.eventsAffected).toBeDefined();
  });

  it('exact protect block with overlaps still writes policy and lists conflicts (no delete/update)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-08T17:00:00.000Z'));

    vi.mocked(gcal.gcalListEvents).mockResolvedValue([
      {
        id: 'overlap-1',
        summary: 'Sales call',
        start: { dateTime: '2026-06-09T09:30:00-05:00', timeZone: 'America/Chicago' },
        end: { dateTime: '2026-06-09T09:45:00-05:00', timeZone: 'America/Chicago' },
      },
    ]);

    const intent = makeIntent(MIN_PB());
    const oauth = {} as unknown as import('google-auth-library').OAuth2Client;
    const result = await protectBlock(intent, BASE_PROFILE, oauth, false);

    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/Done — I blocked/);
    expect(result.messageToUser).toMatch(/Heads-up: overlapping calendar events/);
    expect(result.messageToUser).toMatch(/Sales call/);
    expect(result.messageToUser).toMatch(/can't move, cancel, delete, hide, or repair/);
    expect(result.messageToUser).toMatch(/Caladdin tech team/);
    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(gcal.gcalDeleteEvent).not.toHaveBeenCalled();
    expect(gcal.gcalUpdateEvent).not.toHaveBeenCalled();
  });

  it('lists several conflicts with count when many overlap instances exist', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-08T17:00:00.000Z'));

    vi.mocked(gcal.gcalListEvents).mockResolvedValue(
      Array.from({ length: 14 }, (_, i) => ({
        id: `e-${i}`,
        summary: `Meeting ${i}`,
        start: { dateTime: '2026-06-09T09:15:00-05:00', timeZone: 'America/Chicago' },
        end: { dateTime: '2026-06-09T09:20:00-05:00', timeZone: 'America/Chicago' },
      }))
    );

    const intent = makeIntent(MIN_PB());
    const oauth = {} as unknown as import('google-auth-library').OAuth2Client;
    const result = await protectBlock(intent, BASE_PROFILE, oauth, false);

    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/\n…and \d+ more/);
  });

  it('large recurring with overlaps still requires confirmation before write', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-06T17:00:00.000Z'));

    vi.mocked(gcal.gcalListEvents).mockResolvedValue([
      {
        id: 'dent',
        summary: 'Dentist',
        start: { dateTime: '2026-04-07T07:30:00-05:00', timeZone: 'America/Chicago' },
        end: { dateTime: '2026-04-07T07:45:00-05:00', timeZone: 'America/Chicago' },
      },
    ]);

    const intent = makeIntent({
      label: 'Resperate breathing session',
      startTime: '07:00',
      endTime: '19:30',
      daysOfWeek: [1, 2, 3, 4, 5],
      rangeEnd: '2026-05-04',
      tier: 1,
    });
    const oauth = {} as unknown as import('google-auth-library').OAuth2Client;
    const r = await protectBlock(intent, BASE_PROFILE, oauth, false);

    expect(r.requiresConfirmation).toBe(true);
    expect(r.failureReason).toMatch(/approve to apply/i);
    expect(r.failureReason).toMatch(/Heads-up: overlapping calendar events/i);
    expect(r.failureReason).toMatch(/Dentist|overlapping/);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(gcal.gcalCreateRecurringEvent).not.toHaveBeenCalled();
    expect(gcal.gcalDeleteEvent).not.toHaveBeenCalled();
  });

  it('next-week protect block does not surface current-week conflicts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-28T12:00:00.000Z'));

    vi.mocked(gcal.gcalListEvents).mockResolvedValue([
      {
        id: 'curr-week',
        summary: 'Sync with 0',
        start: { dateTime: '2026-04-30T09:00:00-05:00', timeZone: 'America/Chicago' },
        end: { dateTime: '2026-04-30T09:45:00-05:00', timeZone: 'America/Chicago' },
      },
    ]);

    const intent = makeIntent({
      label: 'focus time on project-25',
      startTime: '09:00',
      endTime: '10:00',
      daysOfWeek: [2],
      rangeEnd: '2026-05-05',
      tier: 1,
    });
    const oauth = {} as unknown as import('google-auth-library').OAuth2Client;
    const result = await protectBlock(intent, BASE_PROFILE, oauth, false);

    expect(result.success).toBe(true);
    expect(result.messageToUser).not.toMatch(/Sync with 0/);
  });
});
