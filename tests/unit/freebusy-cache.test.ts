import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListBusy = vi.fn();

vi.mock('../../src/services/calendar_api.js', () => ({
  listBusyFromGCal: (...a: unknown[]) => mockListBusy(...a),
}));

import {
  getCachedBusyFromGCal,
  clearFreeBusyCacheForTests,
  getFreeBusyCacheStats,
} from '../../src/services/freebusy-cache.js';

describe('freebusy-cache', () => {
  beforeEach(() => {
    clearFreeBusyCacheForTests();
    mockListBusy.mockReset();
    mockListBusy.mockResolvedValue([{ start: '2026-06-01T10:00:00Z', end: '2026-06-01T11:00:00Z' }]);
  });

  it('returns cached result on second call within TTL', async () => {
    const cal = {} as import('googleapis').calendar_v3.Calendar;
    await getCachedBusyFromGCal(cal, 'user-1', '2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z');
    await getCachedBusyFromGCal(cal, 'user-1', '2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z');
    expect(mockListBusy).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent fetches for the same key', async () => {
    const cal = {} as import('googleapis').calendar_v3.Calendar;
    let resolveBusy!: (v: Array<{ start: string; end: string }>) => void;
    mockListBusy.mockImplementation(
      () =>
        new Promise((r) => {
          resolveBusy = r;
        }),
    );

    const p1 = getCachedBusyFromGCal(cal, 'user-1', '2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z');
    const p2 = getCachedBusyFromGCal(cal, 'user-1', '2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z');
    expect(getFreeBusyCacheStats().inflight).toBe(1);
    resolveBusy([{ start: '2026-06-01T10:00:00Z', end: '2026-06-01T11:00:00Z' }]);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toEqual(b);
    expect(mockListBusy).toHaveBeenCalledTimes(1);
  });
});
