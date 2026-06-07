import { describe, it, expect } from 'vitest';
import {
  signGuestActionToken,
  verifyGuestActionToken,
  guestActionUrl,
} from '../../src/core/guest-action-token.js';
import { config } from '../../src/config.js';

describe('guest action tokens', () => {
  const sessionToken = 'abc-session-token';

  it('signs and verifies cancel token', () => {
    const token = signGuestActionToken(sessionToken, 'cancel');
    expect(verifyGuestActionToken(sessionToken, 'cancel', token)).toBe(true);
    expect(verifyGuestActionToken(sessionToken, 'reschedule', token)).toBe(false);
    expect(verifyGuestActionToken('other', 'cancel', token)).toBe(false);
  });

  it('signs and verifies reschedule token', () => {
    const token = signGuestActionToken(sessionToken, 'reschedule');
    expect(verifyGuestActionToken(sessionToken, 'reschedule', token)).toBe(true);
    expect(verifyGuestActionToken(sessionToken, 'cancel', token)).toBe(false);
  });

  it('rejects tampered token', () => {
    const token = signGuestActionToken(sessionToken, 'cancel');
    expect(verifyGuestActionToken(sessionToken, 'cancel', `${token}x`)).toBe(false);
  });

  it('builds action URLs', () => {
    const url = guestActionUrl(sessionToken, 'cancel');
    expect(url).toContain(`${config.baseUrl}/s/${sessionToken}/cancel`);
    expect(url).toContain('actionToken=');
  });
});
