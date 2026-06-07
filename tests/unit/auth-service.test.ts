import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  config: {
    googleClientId: 'cid',
    googleClientSecret: 'sec',
    googleRedirectUri: 'http://localhost/cb',
    oauthStateSecret: 'state-secret-key-for-tests',
  },
}));

vi.mock('../../src/db/tokens.js', () => ({
  getGoogleTokens: vi.fn(),
  saveGoogleTokens: vi.fn(),
}));

import {
  signOAuthState,
  verifyOAuthState,
  getOAuthClientForUser,
  createOAuth2Client,
  getAuthUrl,
  persistTokensForUser,
  getAuthService,
} from '../../src/services/auth_service.js';
import { getGoogleTokens, saveGoogleTokens } from '../../src/db/tokens.js';

describe('auth_service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signOAuthState and verifyOAuthState round-trip', () => {
    const signed = signOAuthState('user-123');
    expect(verifyOAuthState(signed)).toBe(true);
    expect(verifyOAuthState('tampered.state')).toBe(false);
  });

  it('createOAuth2Client returns client', () => {
    expect(createOAuth2Client()).toBeTruthy();
  });

  it('getOAuthClientForUser returns null without tokens', async () => {
    vi.mocked(getGoogleTokens).mockResolvedValue(null);
    const cal = await getOAuthClientForUser('user-1');
    expect(cal).toBeNull();
  });

  it('getOAuthClientForUser builds calendar client when tokens exist', async () => {
    vi.mocked(getGoogleTokens).mockResolvedValue({
      access_token: 'access',
      refresh_token: 'refresh',
      expiry: new Date(Date.now() + 3600000).toISOString(),
    });
    const cal = await getOAuthClientForUser('user-1');
    expect(cal).toBeTruthy();
  });

  it('getAuthUrl includes Google OAuth parameters', () => {
    const url = getAuthUrl('state-token');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('state-token');
  });

  it('persistTokensForUser saves via tokens db', async () => {
    await persistTokensForUser('user-2', {
      access_token: 'a',
      refresh_token: 'r',
      expiry_date: Date.now() + 3600_000,
    });
    expect(saveGoogleTokens).toHaveBeenCalledWith(
      'user-2',
      expect.objectContaining({ access_token: 'a', refresh_token: 'r' }),
    );
  });

  it('getAuthService exposes getClientForUser', () => {
    expect(getAuthService().getClientForUser).toBe(getOAuthClientForUser);
  });
});
