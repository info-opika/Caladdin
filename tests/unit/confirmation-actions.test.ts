import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetPending = vi.fn();
const mockUpdateStatus = vi.fn();
const mockExpireStale = vi.fn();
const mockReExec = vi.fn();
const mockInsertAudit = vi.fn();
const mockHashPayload = vi.fn();

vi.mock('../../src/db/confirmations.js', () => ({
  expireStaleConfirmations: (...args: unknown[]) => mockExpireStale(...args),
  getPendingConfirmation: (...args: unknown[]) => mockGetPending(...args),
  updateConfirmationStatus: (...args: unknown[]) => mockUpdateStatus(...args),
}));

vi.mock('../../src/db/audit.js', () => ({
  hashPayload: (...args: unknown[]) => mockHashPayload(...args),
  insertAuditLog: (...args: unknown[]) => mockInsertAudit(...args),
}));

vi.mock('../../src/core/orchestrator.js', () => ({
  reExecuteFromConfirmation: (...args: unknown[]) => mockReExec(...args),
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { approvePendingConfirmation } from '../../src/core/confirmation-actions.js';

const baseRow = {
  id: 'c1',
  token: 'tok-abc',
  user_id: 'u1',
  intent: 'FLUSH_RANGE',
  payload: { parsed: {}, requestId: 'req-1' },
  payload_hash: 'hash',
  status: 'pending',
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};

describe('approvePendingConfirmation re-exec failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExpireStale.mockResolvedValue(undefined);
    mockUpdateStatus.mockResolvedValue(undefined);
    mockInsertAudit.mockResolvedValue(undefined);
    mockHashPayload.mockReturnValue('hash');
    mockGetPending.mockResolvedValue(baseRow);
  });

  it('returns 500 and rolls back to pending when re-exec throws', async () => {
    mockReExec.mockRejectedValue(new Error('gcal down'));
    const result = await approvePendingConfirmation('tok-abc', 'u1');
    expect(result.status).toBe(500);
    expect(result.body.success).toBe(false);
    expect(result.body.status).toBe('pending');
    expect(mockUpdateStatus).toHaveBeenCalledWith('tok-abc', 'approved');
    expect(mockUpdateStatus).toHaveBeenCalledWith('tok-abc', 'pending');
  });

  it('returns 500 and rolls back when re-exec returns unsuccessful result', async () => {
    mockReExec.mockResolvedValue({
      intent: 'FLUSH_RANGE',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'Handler failed',
      schemaVersion: 1,
    });
    const result = await approvePendingConfirmation('tok-abc', 'u1');
    expect(result.status).toBe(500);
    expect(result.body.executionStatus).toBe('failed');
    expect(result.body.status).toBe('pending');
    expect(mockUpdateStatus).toHaveBeenCalledWith('tok-abc', 'pending');
  });

  it('returns 200 when re-exec succeeds', async () => {
    mockReExec.mockResolvedValue({
      intent: 'FLUSH_RANGE',
      success: true,
      requiresConfirmation: false,
      messageToUser: 'Done',
      schemaVersion: 1,
    });
    const result = await approvePendingConfirmation('tok-abc', 'u1');
    expect(result.status).toBe(200);
    expect(result.body.executionStatus).toBe('success');
    expect(mockUpdateStatus).not.toHaveBeenCalledWith('tok-abc', 'pending');
  });
});
