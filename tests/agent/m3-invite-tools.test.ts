import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserPolicyProfile } from '../../src/core/adts.js';
import type { AgentContext } from '../../src/agent/types.js';
import { executeAgentTool } from '../../src/agent/tools/registry.js';
import {
  buildGrantUrl,
  buildInviteMessageTemplate,
  resolveGrantStatus,
} from '../../src/agent/tools/invite-helpers.js';
import type { InviteCalendarGrantRow } from '../../src/db/invite_calendar_grants.js';

const mockLookupInvitee = vi.fn();
const mockHandleOfferSpecific = vi.fn();
const mockGetSession = vi.fn();
const mockGetLatestSession = vi.fn();
const mockGetGrant = vi.fn();
const mockReplaceSlots = vi.fn();

vi.mock('../../src/services/invitee_lookup.js', () => ({
  lookupInviteeAvailability: (...a: unknown[]) => mockLookupInvitee(...a),
}));

vi.mock('../../src/handlers/offer-specific.js', () => ({
  handleOfferSpecific: (...a: unknown[]) => mockHandleOfferSpecific(...a),
}));

vi.mock('../../src/db/scheduling_sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/scheduling_sessions.js')>();
  return {
    ...actual,
    getSchedulingSessionByToken: (...a: unknown[]) => mockGetSession(...a),
    getLatestOpenSessionForInvitee: (...a: unknown[]) => mockGetLatestSession(...a),
    replaceSessionOfferedSlots: (...a: unknown[]) => mockReplaceSlots(...a),
  };
});

vi.mock('../../src/db/invite_calendar_grants.js', () => ({
  getGrantBySessionId: (...a: unknown[]) => mockGetGrant(...a),
}));

const BASE_POLICY: UserPolicyProfile = {
  schemaVersion: 1,
  protectedBlocks: [],
  shapeRules: {},
  gatekeepRules: [],
  timezone: 'America/Chicago',
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
  chronotype: 'morning',
  defaultBufferMinutes: 15,
  clusteringPreference: 'balanced',
  maxFragmentsPerDay: 4,
  contactTiers: {},
  shareAvailabilityOnInvite: true,
  onboardingComplete: true,
  defaultMeetingLengthMinutes: 30,
  setupFieldsAnswered: ['timezone', 'workingHours', 'defaultMeetingLength'],
};

const AGENT_CTX: AgentContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-1',
  timezone: 'America/Chicago',
  cal: {} as import('googleapis').calendar_v3.Calendar,
  policy: BASE_POLICY,
  conversationContext: null,
};

function activeGrant(): InviteCalendarGrantRow {
  return {
    id: 'grant-1',
    scheduling_session_id: 'sess-1',
    invitee_email: 'jane@example.com',
    oauth_access_token: 'access',
    oauth_refresh_token: 'refresh',
    oauth_expiry: new Date(Date.now() + 3600000).toISOString(),
    preferred_window_start: null,
    preferred_window_end: null,
    status: 'active',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    created_at: new Date().toISOString(),
  };
}

describe('M3 invite helpers', () => {
  it('buildGrantUrl points at grant/start', () => {
    expect(buildGrantUrl('tok-abc')).toMatch(/\/s\/tok-abc\/grant\/start$/);
  });

  it('message template states host_only_pending_grant explicitly', () => {
    const msg = buildInviteMessageTemplate({
      slotSource: 'host_only_pending_grant',
      inviteeEmail: 'jane@example.com',
      grantUrl: 'http://localhost:3000/s/tok/grant/start',
    });
    expect(msg).toContain('host_only_pending_grant');
    expect(msg).toContain('host-only');
  });

  it('resolveGrantStatus returns expired for past TTL', () => {
    const grant = activeGrant();
    grant.expires_at = new Date(Date.now() - 1000).toISOString();
    expect(resolveGrantStatus(grant)).toBe('expired');
  });
});

describe('M3 agent tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLookupInvitee.mockResolvedValue({
      isCaladdinUser: false,
      hasCalendarConnected: false,
    });
    mockHandleOfferSpecific.mockResolvedValue({
      success: true,
      intent: 'OFFER_SPECIFIC',
      requiresConfirmation: false,
      messageToUser: 'Invite sent.',
      schedulingLink: 'http://localhost:3000/s/tok-invite',
      sessionToken: 'tok-invite',
      slotSource: 'host_only_pending_grant',
      slots: [{ start: '2026-06-18T15:00:00.000-05:00', end: '2026-06-18T15:30:00.000-05:00' }],
      schemaVersion: 1,
    });
  });

  it('send_invite returns grantUrl, slotSource, and messageTemplate', async () => {
    const result = await executeAgentTool(
      'send_invite',
      { inviteeEmail: 'jane@example.com', durationMinutes: 30 },
      AGENT_CTX,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      slotSource: 'host_only_pending_grant',
      sessionToken: 'tok-invite',
      grantLinkRequired: true,
    });
    expect(result.data?.grantUrl).toMatch(/\/grant\/start$/);
    expect(result.data?.messageTemplate).toMatch(/host_only_pending_grant/);
    expect(result.honesty?.slotSource).toBe('host-only');
    expect(result.honesty?.mutualChecked).toBe(true);
  });

  it('send_invite passes proposedSlots and meetingTitle to handleOfferSpecific', async () => {
    const proposedSlots = [
      { start: '2026-06-18T09:00:00-05:00', end: '2026-06-18T09:30:00-05:00' },
      { start: '2026-06-18T09:30:00-05:00', end: '2026-06-18T10:00:00-05:00' },
    ];

    await executeAgentTool(
      'send_invite',
      {
        inviteeEmail: 'ashes.kr.de@gmail.com',
        meetingTitle: 'Tester',
        proposedSlots,
        durationMinutes: 30,
      },
      AGENT_CTX,
    );

    expect(mockHandleOfferSpecific).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          context: 'Tester',
          offeredSlots: expect.arrayContaining([
            expect.objectContaining({ start: expect.stringContaining('2026-06-18T09:00:00') }),
          ]),
        }),
      }),
      expect.any(Object),
      AGENT_CTX.cal,
    );
  });

  it('get_invite_status reports grant active and mutual recompute', async () => {
    mockGetSession.mockResolvedValue({
      id: 'sess-1',
      token: 'tok-invite',
      host_user_id: AGENT_CTX.userId,
      host_timezone: 'America/Chicago',
      invitee_email: 'jane@example.com',
      duration_minutes: 30,
      offered_slots: [{ start: '2026-06-18T15:00:00-05:00', end: '2026-06-18T15:30:00-05:00' }],
      status: 'pending',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      slot_source: 'host_only_pending_grant',
    });
    mockGetGrant.mockResolvedValue(activeGrant());

    const result = await executeAgentTool(
      'get_invite_status',
      { sessionToken: 'tok-invite' },
      AGENT_CTX,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      grantStatus: 'active',
      mutualRecomputeAvailable: true,
      slotSource: 'host_only_pending_grant',
    });
  });

  it('update_session_slots replaces offered slots for host session', async () => {
    mockGetSession.mockResolvedValue({
      id: 'sess-1',
      token: 'tok-invite',
      host_user_id: AGENT_CTX.userId,
      status: 'pending',
      duration_minutes: 30,
    });
    mockReplaceSlots.mockResolvedValue(true);

    const slots = [
      { start: '2026-06-19T10:00:00-05:00', end: '2026-06-19T10:30:00-05:00' },
      { start: '2026-06-19T14:00:00-05:00', end: '2026-06-19T14:30:00-05:00' },
    ];

    const result = await executeAgentTool(
      'update_session_slots',
      { sessionToken: 'tok-invite', slots },
      AGENT_CTX,
    );

    expect(result.ok).toBe(true);
    expect(mockReplaceSlots).toHaveBeenCalledWith(
      'tok-invite',
      expect.arrayContaining([
        expect.objectContaining({ start: expect.stringContaining('2026-06-19T10:00:00') }),
      ]),
    );
  });

  it('update_session_slots accepts full scheduling URL as sessionToken', async () => {
    mockGetSession.mockResolvedValue({
      id: 'sess-1',
      token: 'a71b77b7-d3a9-4073-9719-52a1bb7efa0c',
      host_user_id: AGENT_CTX.userId,
      status: 'pending',
      duration_minutes: 30,
    });
    mockReplaceSlots.mockResolvedValue(true);

    const slots = [{ start: '2026-06-18T09:00:00-05:00' }];

    const result = await executeAgentTool(
      'update_session_slots',
      {
        sessionToken: 'http://localhost:3001/s/a71b77b7-d3a9-4073-9719-52a1bb7efa0c',
        slots,
      },
      AGENT_CTX,
    );

    expect(result.ok).toBe(true);
    expect(mockGetSession).toHaveBeenCalledWith('a71b77b7-d3a9-4073-9719-52a1bb7efa0c');
    expect(mockReplaceSlots).toHaveBeenCalledWith(
      'a71b77b7-d3a9-4073-9719-52a1bb7efa0c',
      [{ start: '2026-06-18T09:00:00.000-05:00', end: '2026-06-18T09:30:00.000-05:00' }],
    );
  });
});
