import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { orchestrate } from '../../src/core/orchestrator.js';
import { type ParsedIntent, type UserPolicyProfile } from '../../src/core/adts.js';

const { mockGetOAuthClientForUser, mockListEventsFromGCalSafe, mockCreateEventWithSync } = vi.hoisted(() => ({
  mockGetOAuthClientForUser: vi.fn(),
  mockListEventsFromGCalSafe: vi.fn(),
  mockCreateEventWithSync: vi.fn(),
}));

vi.mock('../../src/db/users.js', () => ({
  ensureDefaultPolicy: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    protectedBlocks: [],
    shapeRules: {},
    gatekeepRules: [],
    timezone: 'America/Chicago',
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
  }),
  upsertPolicy: vi.fn().mockResolvedValue(undefined),
  getPolicy: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/db/audit.js', () => ({
  insertAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: mockGetOAuthClientForUser,
}));

vi.mock('../../src/services/calendar_api.js', () => ({
  listEventsFromGCalSafe: mockListEventsFromGCalSafe,
  createEventWithSync: mockCreateEventWithSync.mockResolvedValue(undefined),
}));

const mockCheckOperationAllowed = vi.fn();

vi.mock('../../src/pilot/pilot_controls.js', () => ({
  checkOperationAllowed: (...args: unknown[]) => mockCheckOperationAllowed(...args),
}));

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

/** Few Tuesdays ≤6h/day within range — skips confirmation blast gate. */
const SMALL_PROTECT: ParsedIntent = {
  intent: 'PROTECT_BLOCK',
  confidence: 1,
  rawUtterance: 'protect',
  mappingMethod: 'direct',
  params: {
    label: 'Weekly focus',
    startTime: '09:00',
    endTime: '10:30',
    daysOfWeek: [2],
    rangeEnd: '2026-06-30',
    tier: 1,
    rawUtterance: 'Weekly focus Tuesdays',
    timezone: 'America/Chicago',
  },
};

const CTX = { userId: BASE_PROFILE.userId, profile: BASE_PROFILE, requestId: 'test-req' };

function makeIntent(intent: ParsedIntent['intent']): ParsedIntent {
  return { intent, confidence: 0.9, rawUtterance: 'test', params: {}, mappingMethod: 'direct' };
}

describe('Orchestrator', () => {
  beforeEach(() => {
    mockGetOAuthClientForUser.mockReset();
    mockListEventsFromGCalSafe.mockReset();
    mockCreateEventWithSync.mockReset();
    mockCheckOperationAllowed.mockReset();
    mockGetOAuthClientForUser.mockResolvedValue({} as any);
    mockListEventsFromGCalSafe.mockResolvedValue({ events: [] });
    mockCreateEventWithSync.mockResolvedValue(undefined);
    mockCheckOperationAllowed.mockResolvedValue({ allowed: true });
  });

  it('bounded PROTECT_BLOCK applies without blast confirmation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'));
    try {
      const result = await orchestrate(SMALL_PROTECT, CTX);
      expect(result.success).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('WARM redirect returns calendar-only guidance', async () => {
    const result = await orchestrate(
      {
        ...makeIntent('RESOLVE_MANUAL'),
        _warmRedirect: true,
        _offTopic: true,
      },
      CTX,
    );
    expect(result.success).toBe(true);
    expect(result.intent).toBe('WARM_REDIRECT');
    expect((result as { isWarmRedirect?: boolean }).isWarmRedirect).toBe(true);
    expect(result.messageToUser).toMatch(/scheduling|calendar/i);
    expect(mockCheckOperationAllowed).not.toHaveBeenCalled();
  });

  it('blocks orchestration when kill switch is active', async () => {
    mockCheckOperationAllowed.mockResolvedValueOnce({
      allowed: false,
      reason: 'kill_switch_active',
      message: 'Caladdin is temporarily paused. Calendar operations are unavailable.',
    });
    const result = await orchestrate(makeIntent('CREATE_EVENT'), CTX);
    expect(result.success).toBe(false);
    expect(result.messageToUser).toMatch(/temporarily paused/i);
    expect(mockCheckOperationAllowed).toHaveBeenCalledWith('voice_mutation');
    expect(mockGetOAuthClientForUser).not.toHaveBeenCalled();
  });

  describe('QUERY_CALENDAR', () => {
    const ev = (title: string, start: string, end: string) => ({
      title,
      start,
      end,
      gcalEventId: `gcal-${title}`,
    });
    const qIntent = (raw: string): ParsedIntent => ({
      intent: 'QUERY_CALENDAR',
      confidence: 1,
      rawUtterance: raw,
      params: {},
      mappingMethod: 'direct',
    });

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-26T15:00:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('lists events from Google Calendar response', async () => {
      mockListEventsFromGCalSafe.mockResolvedValueOnce({
        events: [
          ev('Dentist', '2026-04-26T14:00:00-05:00', '2026-04-26T14:30:00-05:00'),
          ev('Sync', '2026-04-26T16:00:00-05:00', '2026-04-26T16:30:00-05:00'),
        ],
      });
      const result = await orchestrate(qIntent("What's on my calendar today?"), CTX);
      expect(result.messageToUser).toMatch(/Dentist/i);
      expect(result.messageToUser).toMatch(/Sync/i);
      expect(result.messageToUser).toMatch(/Google Calendar/i);
    });

    it('returns clear-calendar message when no events found', async () => {
      mockListEventsFromGCalSafe.mockResolvedValueOnce({ events: [] });
      const result = await orchestrate(qIntent('q'), CTX);
      expect(result.messageToUser).toBe('Your Google Calendar looks clear for the next week.');
    });

    it('returns reconnect message when OAuth is missing', async () => {
      mockGetOAuthClientForUser.mockResolvedValueOnce(null);
      const result = await orchestrate(qIntent('q'), CTX);
      expect(result.success).toBe(false);
      expect(result.messageToUser).toMatch(/not connected/i);
    });

    it('returns graceful error when Google Calendar read fails', async () => {
      mockListEventsFromGCalSafe.mockResolvedValueOnce({
        events: [],
        error: 'temporarily unavailable',
      });
      const result = await orchestrate(qIntent('q'), CTX);
      expect(result.success).toBe(false);
      expect(result.messageToUser).toMatch(/could not read your Google Calendar/i);
    });
  });
});
