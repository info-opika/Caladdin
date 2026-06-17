import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParsedIntentSchema, type UserPolicyProfile } from '../../../src/core/adts.js';

const mockEnsurePolicy = vi.fn();
const mockGetUser = vi.fn();
const mockGenerateSlots = vi.fn();
const mockInsertEvent = vi.fn();
const mockCreateSession = vi.fn();
const mockSendEmail = vi.fn();
const mockLookupInvitee = vi.fn();

vi.mock('../../../src/db/users.js', () => ({
  ensureDefaultPolicy: (...a: unknown[]) => mockEnsurePolicy(...a),
  getUserById: (...a: unknown[]) => mockGetUser(...a),
}));

vi.mock('../../../src/core/slot-scoring.js', () => ({
  generateSlots: (...a: unknown[]) => mockGenerateSlots(...a),
}));

vi.mock('../../../src/services/invitee_lookup.js', () => ({
  lookupInviteeAvailability: (...a: unknown[]) => mockLookupInvitee(...a),
}));

vi.mock('../../../src/db/events.js', () => ({
  insertEvent: (...a: unknown[]) => mockInsertEvent(...a),
}));

vi.mock('../../../src/db/scheduling_sessions.js', () => ({
  createSchedulingSession: (...a: unknown[]) => mockCreateSession(...a),
}));

vi.mock('../../../src/services/email.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
  schedulingLinkEmailHtml: (name: string, link: string) => `<a href="${link}">${name}</a>`,
  schedulingLinkEmailText: (name: string, link: string) => `${name}: ${link}`,
}));

vi.mock('../../../src/config.js', () => ({
  config: { baseUrl: 'https://caladdin.test' },
}));

import { handleOfferSpecific } from '../../../src/handlers/offer-specific.js';

const ctx = { userId: 'user-1', timezone: 'America/Chicago' };

const POLICY: UserPolicyProfile = {
  userId: 'user-1',
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
  defaultMeetingLengthMinutes: 45,
  workingHoursStart: '09:00',
  workingHoursEnd: '17:00',
};

describe('handleOfferSpecific', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsurePolicy.mockResolvedValue(POLICY);
    mockGetUser.mockResolvedValue({ display_name: 'Host', email: 'host@example.com' });
    mockSendEmail.mockResolvedValue({ ok: true });
    mockLookupInvitee.mockResolvedValue({ isCaladdinUser: false, hasCalendarConnected: false });
  });

  it('returns fax message when no slots available', async () => {
    mockGenerateSlots.mockResolvedValue([]);
    const parsed = ParsedIntentSchema.parse({
      intent: 'OFFER_SPECIFIC',
      confidence: 0.9,
      params: {},
      mappingMethod: 'direct',
      rawUtterance: 'offer times',
    });
    const result = await handleOfferSpecific(parsed, ctx, null);
    expect(result.success).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('uses policy defaultMeetingLengthMinutes when duration omitted', async () => {
    mockGenerateSlots.mockResolvedValue([]);
    const parsed = ParsedIntentSchema.parse({
      intent: 'OFFER_SPECIFIC',
      confidence: 0.9,
      params: { recipientName: 'Guest' },
      mappingMethod: 'direct',
      rawUtterance: 'offer guest two times',
    });
    await handleOfferSpecific(parsed, ctx, null);
    expect(mockGenerateSlots).toHaveBeenCalledWith(
      'user-1',
      POLICY,
      45,
      7,
      expect.any(Object),
    );
  });

  it('creates proposed events, session, and scheduling link', async () => {
    const slots = [
      { start: '2026-06-10T15:00:00-05:00', end: '2026-06-10T16:00:00-05:00', score: 0.9 },
      { start: '2026-06-11T10:00:00-05:00', end: '2026-06-11T11:00:00-05:00', score: 0.8 },
    ];
    mockGenerateSlots.mockResolvedValue(slots);
    mockInsertEvent.mockImplementation(async (_uid, ev) => ({ id: `ev-${ev.title}`, ...ev, userId: 'user-1' }));
    mockCreateSession.mockResolvedValue({ token: 'sess-tok-abc' });

    const parsed = ParsedIntentSchema.parse({
      intent: 'OFFER_SPECIFIC',
      confidence: 0.9,
      params: { recipientEmail: 'guest@example.com', recipientName: 'Guest' },
      mappingMethod: 'direct',
      rawUtterance: 'offer guest two times',
    });
    const result = await handleOfferSpecific(parsed, ctx, null);
    expect(result.success).toBe(true);
    expect(result.schedulingLink).toBe('https://caladdin.test/s/sess-tok-abc');
    expect(mockInsertEvent).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'guest@example.com' }),
    );
  });

  it('uses mutual slots for known Caladdin user with calendar', async () => {
    mockLookupInvitee.mockResolvedValue({
      isCaladdinUser: true,
      hasCalendarConnected: true,
      userId: 'invitee-1',
    });
    mockGenerateSlots.mockResolvedValue([
      { start: '2026-06-10T15:00:00-05:00', end: '2026-06-10T16:00:00-05:00', score: 0.9 },
    ]);
    mockInsertEvent.mockImplementation(async (_uid, ev) => ({ id: `ev-${ev.title}`, ...ev, userId: 'user-1' }));
    mockCreateSession.mockResolvedValue({ token: 'mutual-tok' });

    const parsed = ParsedIntentSchema.parse({
      intent: 'OFFER_SPECIFIC',
      confidence: 0.9,
      params: { recipientEmail: 'known@example.com', recipientName: 'Known' },
      mappingMethod: 'direct',
      rawUtterance: 'offer known user times',
    });
    const result = await handleOfferSpecific(parsed, ctx, null);

    expect(result.success).toBe(true);
    expect(result.slotSource).toBe('mutual_known_user');
    expect(mockGenerateSlots).toHaveBeenCalledWith(
      'user-1',
      POLICY,
      45,
      7,
      expect.objectContaining({
        recipientEmail: 'known@example.com',
        posture: 'mutual',
      }),
    );
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ slotSource: 'mutual_known_user' }),
    );
  });

  it('uses host-only slots for unknown invitee with honest metadata', async () => {
    mockLookupInvitee.mockResolvedValue({ isCaladdinUser: false, hasCalendarConnected: false });
    mockGenerateSlots.mockResolvedValue([
      { start: '2026-06-10T15:00:00-05:00', end: '2026-06-10T16:00:00-05:00', score: 0.9 },
    ]);
    mockInsertEvent.mockImplementation(async (_uid, ev) => ({ id: `ev-${ev.title}`, ...ev, userId: 'user-1' }));
    mockCreateSession.mockResolvedValue({ token: 'host-tok' });

    const parsed = ParsedIntentSchema.parse({
      intent: 'OFFER_SPECIFIC',
      confidence: 0.9,
      params: { recipientEmail: 'unknown@example.com', recipientName: 'Unknown' },
      mappingMethod: 'direct',
      rawUtterance: 'offer unknown guest times',
    });
    const result = await handleOfferSpecific(parsed, ctx, null);

    expect(result.success).toBe(true);
    expect(result.slotSource).toBe('host_only_pending_grant');
    expect(mockGenerateSlots).toHaveBeenCalledWith(
      'user-1',
      POLICY,
      45,
      7,
      expect.objectContaining({
        recipientEmail: undefined,
        posture: 'flexible',
      }),
    );
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ slotSource: 'host_only_pending_grant' }),
    );
  });

  it('skips generateSlots when offeredSlots are provided explicitly', async () => {
    const explicit = [
      { start: '2026-06-18T09:00:00-05:00', end: '2026-06-18T09:30:00-05:00' },
      { start: '2026-06-18T09:30:00-05:00', end: '2026-06-18T10:00:00-05:00' },
    ];
    mockInsertEvent.mockImplementation(async (_uid, ev) => ({ id: `ev-${ev.title}`, ...ev, userId: 'user-1' }));
    mockCreateSession.mockResolvedValue({ token: 'explicit-tok' });

    const parsed = ParsedIntentSchema.parse({
      intent: 'OFFER_SPECIFIC',
      confidence: 0.9,
      params: {
        recipientEmail: 'guest@example.com',
        context: 'Tester',
        offeredSlots: explicit,
      },
      mappingMethod: 'direct',
      rawUtterance: 'send two slots',
    });
    const result = await handleOfferSpecific(parsed, ctx, null);

    expect(result.success).toBe(true);
    expect(mockGenerateSlots).not.toHaveBeenCalled();
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'Tester',
        offeredSlots: expect.arrayContaining([
          expect.objectContaining({ start: explicit[0]!.start }),
        ]),
      }),
    );
    expect(mockInsertEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ title: '[Proposed] Tester' }),
    );
  });
});
