import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUserByEmail = vi.fn();
const mockGetOAuthClient = vi.fn();

vi.mock('../../src/db/users.js', () => ({
  getUserByEmail: (...a: unknown[]) => mockGetUserByEmail(...a),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: (...a: unknown[]) => mockGetOAuthClient(...a),
}));

import { lookupInviteeAvailability } from '../../src/services/invitee_lookup.js';

describe('lookupInviteeAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unknown invitee for empty email', async () => {
    const result = await lookupInviteeAvailability('  ');
    expect(result).toEqual({ isCaladdinUser: false, hasCalendarConnected: false });
    expect(mockGetUserByEmail).not.toHaveBeenCalled();
  });

  it('returns unknown invitee when email is not registered', async () => {
    mockGetUserByEmail.mockResolvedValue(null);
    const result = await lookupInviteeAvailability('guest@example.com');
    expect(result).toEqual({ isCaladdinUser: false, hasCalendarConnected: false });
    expect(mockGetOAuthClient).not.toHaveBeenCalled();
  });

  it('returns known user without calendar when OAuth missing', async () => {
    mockGetUserByEmail.mockResolvedValue({ id: 'user-2', email: 'jane@example.com' });
    mockGetOAuthClient.mockResolvedValue(null);
    const result = await lookupInviteeAvailability('jane@example.com');
    expect(result).toEqual({
      isCaladdinUser: true,
      hasCalendarConnected: false,
      userId: 'user-2',
    });
  });

  it('returns known user with calendar connected', async () => {
    mockGetUserByEmail.mockResolvedValue({ id: 'user-3', email: 'known@example.com' });
    mockGetOAuthClient.mockResolvedValue({ events: {} });
    const result = await lookupInviteeAvailability('known@example.com');
    expect(result).toEqual({
      isCaladdinUser: true,
      hasCalendarConnected: true,
      userId: 'user-3',
    });
  });
});
