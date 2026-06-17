import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockExpireOpenSessions = vi.fn();
const mockExpireStaleInviteGrants = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../../src/db/scheduling_sessions.js', () => ({
  expireOpenSessions: (...a: unknown[]) => mockExpireOpenSessions(...a),
}));

vi.mock('../../src/db/invite_calendar_grants.js', () => ({
  expireStaleInviteGrants: (...a: unknown[]) => mockExpireStaleInviteGrants(...a),
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    info: (...a: unknown[]) => mockLoggerInfo(...a),
    error: (...a: unknown[]) => mockLoggerError(...a),
  },
}));

import { runSessionExpiry, startSessionExpiryWorker } from '../../src/jobs/session-expiry.js';

describe('session expiry job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockExpireStaleInviteGrants.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runSessionExpiry returns expired count and logs when sessions expired', async () => {
    mockExpireOpenSessions.mockResolvedValueOnce(4);
    const result = await runSessionExpiry();
    expect(result).toEqual({ sessions: 4, grants: 0 });
    expect(mockLoggerInfo).toHaveBeenCalledWith('Expired open scheduling sessions', { count: 4 });
  });

  it('runSessionExpiry skips log when nothing expired', async () => {
    mockExpireOpenSessions.mockResolvedValueOnce(0);
    const result = await runSessionExpiry();
    expect(result).toEqual({ sessions: 0, grants: 0 });
    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('startSessionExpiryWorker schedules periodic expiry', async () => {
    mockExpireOpenSessions.mockResolvedValue(1);
    const handle = startSessionExpiryWorker(1000);
    expect(handle).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockExpireOpenSessions).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });
});
