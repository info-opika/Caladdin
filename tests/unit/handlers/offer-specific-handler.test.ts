import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParsedIntentSchema, type UserPolicyProfile } from '../../../src/core/adts.js';

const mockEnsurePolicy = vi.fn();
const mockGetUser = vi.fn();
const mockGenerateSlots = vi.fn();
const mockInsertEvent = vi.fn();
const mockCreateSession = vi.fn();
const mockSendEmail = vi.fn();

vi.mock('../../../src/db/users.js', () => ({
  ensureDefaultPolicy: (...a: unknown[]) => mockEnsurePolicy(...a),
  getUserById: (...a: unknown[]) => mockGetUser(...a),
}));

vi.mock('../../../src/core/slot-scoring.js', () => ({
  generateSlots: (...a: unknown[]) => mockGenerateSlots(...a),
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
});
