import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUserById = vi.fn();
const mockSendEmail = vi.fn();

vi.mock('../../src/db/users.js', () => ({
  getUserById: (...a: unknown[]) => mockGetUserById(...a),
}));

vi.mock('../../src/services/email.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));

vi.mock('../../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  toNtfyHeaderValue,
  sendNtfy,
  sendConfirmationRequest,
  notifyBuild,
  sendHostBookingNotification,
} from '../../src/services/notifications.js';

describe('notifications service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserById.mockResolvedValue({ id: 'u1', email: 'host@test.com' });
    mockSendEmail.mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  it('toNtfyHeaderValue sanitizes unicode for headers', () => {
    expect(toNtfyHeaderValue('Caladdin — guest booked')).toBe('Caladdin - guest booked');
    expect(toNtfyHeaderValue('Hello 🎉')).toBe('Hello ??');
  });

  it('sendNtfy posts to ntfy with optional actions', async () => {
    const ok = await sendNtfy('Title', 'Body', [{ action: 'open', label: 'Open', url: 'https://x.test' }]);
    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('ntfy.sh'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sendNtfy returns false on fetch failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    expect(await sendNtfy('T', 'B')).toBe(false);
  });

  it('sendConfirmationRequest builds approve/reject actions', async () => {
    expect(await sendConfirmationRequest('tok-abc', 'Please confirm')).toBe(true);
    const call = vi.mocked(fetch).mock.calls.at(-1);
    expect(call?.[1]?.headers).toMatchObject({ Title: expect.stringContaining('Confirm') });
  });

  it('notifyBuild posts to agent topic', async () => {
    expect(await notifyBuild('deploy ok')).toBe(true);
  });

  it('sendHostBookingNotification emails host and sends ntfy for each kind', async () => {
    for (const kind of ['booked', 'proposed', 'cancelled', 'rescheduled'] as const) {
      await sendHostBookingNotification({
        hostUserId: 'u1',
        sessionToken: 'session-token-123',
        kind,
        proposedDate: '2026-06-10',
        proposedTimeWindow: 'afternoon',
        note: 'flexible',
      });
    }
    expect(mockSendEmail).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalled();
  });

  it('sendHostBookingNotification skips email when host has no address', async () => {
    mockGetUserById.mockResolvedValueOnce({ id: 'u1', email: null });
    await sendHostBookingNotification({
      hostUserId: 'u1',
      sessionToken: 'tok',
      kind: 'booked',
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
