import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendAgentCheckpoint, sendCheckpoint, sendConfirmationRequest } from '../../src/services/ntfy.js';

// Mock global fetch
const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
vi.stubGlobal('fetch', mockFetch);

describe('ntfy service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sendAgentCheckpoint posts to caladdin-agent topic', async () => {
    await sendAgentCheckpoint('Test checkpoint message');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('caladdin-agent');
  });

  it('sendCheckpoint posts to user-specific topic', async () => {
    const userId = 'abcdef12-0000-0000-0000-000000000000';
    await sendCheckpoint(userId, 'User checkpoint');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain(`caladdin-${userId.slice(0, 8)}`);
  });

  it('sendConfirmationRequest includes Approve/Reject actions', async () => {
    const userId = 'abcdef12-0000-0000-0000-000000000000';
    const token = 'cccccccc-1111-1111-1111-cccccccccccc';
    await sendConfirmationRequest(userId, token, 'Clear your Friday calendar');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const actions = (options.headers as Record<string, string>)['Actions'] ?? '';
    expect(actions).toContain('Approve');
    expect(actions).toContain('Reject');
    expect(actions).toContain(token);
  });

  it('sendConfirmationRequest topic matches user first 8 chars', async () => {
    const userId = 'xxyyzz99-0000-0000-0000-000000000000';
    const token = 'dddddddd-2222-2222-2222-dddddddddddd';
    await sendConfirmationRequest(userId, token, 'Test action');

    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain(`caladdin-${userId.slice(0, 8)}`);
  });
});
