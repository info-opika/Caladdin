/**
 * INVITE_PLATFORM handler — email send, link generation, error paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParsedIntentSchema } from '../../src/core/adts.js';

const mockCreateInvite = vi.fn();
const mockGetUser = vi.fn();
const mockSendEmail = vi.fn();
const mockRecordUsage = vi.fn();

vi.mock('../../src/db/platform_invites.js', () => ({
  createPlatformInvite: (...a: unknown[]) => mockCreateInvite(...a),
  platformInviteUrl: (token: string) => `https://caladdin.test/invite/${token}`,
}));

vi.mock('../../src/db/users.js', () => ({
  getUserById: (...a: unknown[]) => mockGetUser(...a),
}));

vi.mock('../../src/services/email.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
  platformInviteEmailHtml: (name: string, link: string) => `<p>${name} invited you</p><a href="${link}">Join</a>`,
}));

vi.mock('../../src/db/usage_events.js', () => ({
  recordUsageEvent: (...a: unknown[]) => mockRecordUsage(...a),
}));

import { handleInvitePlatform } from '../../src/handlers/invite-platform.js';

const ctx = { userId: 'host-uuid', timezone: 'America/Chicago' };

function parsed(params: Record<string, unknown>) {
  return ParsedIntentSchema.parse({
    intent: 'INVITE_PLATFORM',
    confidence: 0.9,
    params,
    mappingMethod: 'direct',
    rawUtterance: 'invite someone',
  });
}

describe('handleInvitePlatform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ display_name: 'Kanth', email: 'kanth@example.com' });
    mockCreateInvite.mockResolvedValue({
      token: 'inv-tok-1',
      invitee_email: 'guest@example.com',
    });
    mockSendEmail.mockResolvedValue({ ok: true });
  });

  it('returns prompt when no email provided', async () => {
    const result = await handleInvitePlatform(parsed({}), ctx, null);
    expect(result.success).toBe(false);
    expect(result.messageToUser).toMatch(/Who should I invite/i);
    expect(mockCreateInvite).not.toHaveBeenCalled();
  });

  it('creates invite, sends email, records usage on success', async () => {
    const result = await handleInvitePlatform(
      parsed({ inviteeEmail: 'guest@example.com' }),
      ctx,
      null,
    );
    expect(result.success).toBe(true);
    expect(result.schedulingLink).toBe('https://caladdin.test/invite/inv-tok-1');
    expect(mockCreateInvite).toHaveBeenCalledWith('host-uuid', 'guest@example.com');
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'guest@example.com',
        subject: expect.stringContaining('Kanth'),
      }),
    );
    expect(mockRecordUsage).toHaveBeenCalledWith('host-uuid', 'platform_invite_sent', {
      inviteeEmail: 'guest@example.com',
      token: 'inv-tok-1',
    });
  });

  it('accepts email param alias', async () => {
    await handleInvitePlatform(parsed({ email: 'alt@example.com' }), ctx, null);
    expect(mockCreateInvite).toHaveBeenCalledWith('host-uuid', 'alt@example.com');
  });

  it('returns manual link when email send fails', async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: false });
    const result = await handleInvitePlatform(parsed({ inviteeEmail: 'g@example.com' }), ctx, null);
    expect(result.success).toBe(false);
    expect(result.messageToUser).toMatch(/Share this link manually/i);
    expect(result.schedulingLink).toContain('inv-tok-1');
  });

  it('uses email as inviter name fallback', async () => {
    mockGetUser.mockResolvedValueOnce({ email: 'solo@example.com', display_name: null });
    await handleInvitePlatform(parsed({ inviteeEmail: 'g@example.com' }), ctx, null);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('solo@example.com') }),
    );
  });
});
