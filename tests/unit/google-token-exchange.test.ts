import { describe, it, expect, vi, beforeEach } from 'vitest';
import https from 'node:https';
import { EventEmitter } from 'node:events';

vi.mock('../../src/config.js', () => ({
  config: {
    googleClientId: 'client-id.apps.googleusercontent.com',
    googleClientSecret: 'client-secret',
    googleRedirectUri: 'https://app.example.com/auth/callback',
  },
}));

describe('exchangeAuthorizationCode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns tokens on success', async () => {
    vi.spyOn(https, 'request').mockImplementation((_opts, cb) => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = 200;
      setTimeout(() => {
        cb?.(res as never);
        res.emit('data', Buffer.from(JSON.stringify({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
        })));
        res.emit('end');
      }, 0);
      const req = new EventEmitter() as EventEmitter & { write: () => void; end: () => void };
      req.write = vi.fn();
      req.end = vi.fn();
      return req as never;
    });

    const { exchangeAuthorizationCode } = await import('../../src/services/google_token_exchange.js');
    const out = await exchangeAuthorizationCode('auth-code', 'https://app.example.com/auth/callback');
    expect(out.access_token).toBe('at');
    expect(out.refresh_token).toBe('rt');
    expect(out.expiry_date).toBeGreaterThan(Date.now());
  });

  it('surfaces Google OAuth config errors', async () => {
    vi.spyOn(https, 'request').mockImplementation((_opts, cb) => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = 400;
      setTimeout(() => {
        cb?.(res as never);
        res.emit(
          'data',
          Buffer.from(JSON.stringify({
            error: 'redirect_uri_mismatch',
            error_description: 'Bad Request',
          })),
        );
        res.emit('end');
      }, 0);
      const req = new EventEmitter() as EventEmitter & { write: () => void; end: () => void };
      req.write = vi.fn();
      req.end = vi.fn();
      return req as never;
    });

    const { exchangeAuthorizationCode } = await import('../../src/services/google_token_exchange.js');
    await expect(
      exchangeAuthorizationCode('auth-code', 'https://wrong.example.com/auth/callback'),
    ).rejects.toThrow(/redirect_uri_mismatch/);
  });

  it('refreshes access tokens', async () => {
    vi.spyOn(https, 'request').mockImplementation((_opts, cb) => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = 200;
      setTimeout(() => {
        cb?.(res as never);
        res.emit('data', Buffer.from(JSON.stringify({
          access_token: 'new-at',
          expires_in: 3600,
        })));
        res.emit('end');
      }, 0);
      const req = new EventEmitter() as EventEmitter & { write: () => void; end: () => void };
      req.write = vi.fn();
      req.end = vi.fn();
      return req as never;
    });

    const { refreshAccessToken } = await import('../../src/services/google_token_exchange.js');
    const out = await refreshAccessToken('refresh-token');
    expect(out.access_token).toBe('new-at');
  });
});
