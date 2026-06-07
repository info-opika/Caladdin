import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoll = vi.fn();
const mockMark = vi.fn();
const mockDelete = vi.fn();
const mockGetOAuth = vi.fn();
const mockGetEvent = vi.fn();
const mockSync = vi.fn();

vi.mock('../../src/db/compensation_queue.js', () => ({
  pollCompensationBatch: (...a: unknown[]) => mockPoll(...a),
  markCompensationAttempt: (...a: unknown[]) => mockMark(...a),
  deleteCompensation: (...a: unknown[]) => mockDelete(...a),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: (...a: unknown[]) => mockGetOAuth(...a),
}));

vi.mock('../../src/services/calendar_api.js', () => ({
  syncEventToGCal: (...a: unknown[]) => mockSync(...a),
}));

vi.mock('../../src/db/events.js', () => ({
  getEventById: (...a: unknown[]) => mockGetEvent(...a),
}));

vi.mock('../../src/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { runCompensationWorker } from '../../src/jobs/compensation-worker.js';

describe('compensation worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes batch and deletes on success', async () => {
    mockPoll.mockResolvedValue([
      { id: 'cq-1', user_id: 'u1', payload: { eventId: 'ev-1' }, attempts: 0 },
    ]);
    mockGetOAuth.mockResolvedValue({});
    mockGetEvent.mockResolvedValue({ id: 'ev-1', title: 'Meet' });
    mockSync.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);

    const n = await runCompensationWorker();
    expect(n).toBe(1);
    expect(mockSync).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith('cq-1');
  });

  it('increments attempts when oauth missing', async () => {
    mockPoll.mockResolvedValue([{ id: 'cq-2', user_id: 'u1', payload: {}, attempts: 1 }]);
    mockGetOAuth.mockResolvedValue(null);
    const n = await runCompensationWorker();
    expect(n).toBe(0);
    expect(mockMark).toHaveBeenCalledWith('cq-2', 2);
  });

  it('increments attempts when sync throws', async () => {
    mockPoll.mockResolvedValue([{ id: 'cq-3', user_id: 'u1', payload: { eventId: 'ev-2' }, attempts: 0 }]);
    mockGetOAuth.mockResolvedValue({});
    mockGetEvent.mockResolvedValue({ id: 'ev-2' });
    mockSync.mockRejectedValue(new Error('gcal down'));
    const n = await runCompensationWorker();
    expect(n).toBe(0);
    expect(mockMark).toHaveBeenCalledWith('cq-3', 1);
  });
});
