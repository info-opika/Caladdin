import { describe, it, expect, vi, beforeEach } from 'vitest';
import https from 'node:https';
import { EventEmitter } from 'node:events';

describe('fetchGoogleUserInfo', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns email and name on success', async () => {
    vi.spyOn(https, 'request').mockImplementation((_opts, cb) => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = 200;
      setTimeout(() => {
        cb?.(res as never);
        res.emit(
          'data',
          Buffer.from(JSON.stringify({ email: 'user@example.com', name: 'Test User' })),
        );
        res.emit('end');
      }, 0);
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = vi.fn();
      return req as never;
    });

    const { fetchGoogleUserInfo } = await import('../../src/services/google_https.js');
    const out = await fetchGoogleUserInfo('access-token');
    expect(out).toEqual({ email: 'user@example.com', name: 'Test User' });
  });

  it('surfaces API errors without retrying config failures', async () => {
    vi.spyOn(https, 'request').mockImplementation((_opts, cb) => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = 401;
      setTimeout(() => {
        cb?.(res as never);
        res.emit(
          'data',
          Buffer.from(JSON.stringify({ error: { status: 'UNAUTHENTICATED', message: 'Invalid Credentials' } })),
        );
        res.emit('end');
      }, 0);
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = vi.fn();
      return req as never;
    });

    const { fetchGoogleUserInfo } = await import('../../src/services/google_https.js');
    await expect(fetchGoogleUserInfo('bad-token')).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('retries transient network errors', async () => {
    let attempts = 0;
    vi.spyOn(https, 'request').mockImplementation((_opts, cb) => {
      attempts += 1;
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = vi.fn(() => {
        if (attempts < 2) {
          req.emit('error', new Error('Premature close'));
          return;
        }
        const res = new EventEmitter() as EventEmitter & { statusCode: number };
        res.statusCode = 200;
        setTimeout(() => {
          cb?.(res as never);
          res.emit('data', Buffer.from(JSON.stringify({ email: 'retry@example.com' })));
          res.emit('end');
        }, 0);
      });
      return req as never;
    });

    const { fetchGoogleUserInfo } = await import('../../src/services/google_https.js');
    const out = await fetchGoogleUserInfo('access-token');
    expect(out.email).toBe('retry@example.com');
    expect(attempts).toBe(2);
  });
});

describe('listGCalEventsViaHttps', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns calendar items', async () => {
    vi.spyOn(https, 'request').mockImplementation((opts, cb) => {
      expect(String(opts.path)).toContain('/calendar/v3/calendars/primary/events');
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = 200;
      setTimeout(() => {
        cb?.(res as never);
        res.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              items: [
                {
                  id: 'evt-1',
                  summary: 'Meeting',
                  start: { dateTime: '2026-06-10T15:00:00Z' },
                  end: { dateTime: '2026-06-10T16:00:00Z' },
                },
              ],
            }),
          ),
        );
        res.emit('end');
      }, 0);
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = vi.fn();
      return req as never;
    });

    const { listGCalEventsViaHttps } = await import('../../src/services/google_https.js');
    const items = await listGCalEventsViaHttps('access-token', '2026-06-01', '2026-06-30');
    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toBe('Meeting');
  });
});
