import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseFrom = vi.fn();
vi.mock('../../src/db/service_client.js', () => ({
  getServiceSupabaseOrAnon: () => ({ from: supabaseFrom }),
}));
vi.mock('../../src/db/users.js', () => ({
  ensureCaladdinUserRow: vi.fn().mockResolvedValue(undefined),
}));

import { logger } from '../../src/utils/logger.js';

describe('upsertTokens error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const logSpy = vi.spyOn(logger, 'error');
    logSpy.mockClear();
  });

  it('logs only userId, operation, code on select failure (no access_token in log payload)', async () => {
    const logSpy = vi.spyOn(logger, 'error');
    supabaseFrom.mockImplementation((table: string) => {
      if (table === 'google_tokens') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: 'denied', code: 'PGRST301' } }),
            }),
          }),
          upsert: () => ({ error: null }),
        };
      }
      return {};
    });

    const { upsertTokens } = await import('../../src/db/tokens.js');
    await expect(upsertTokens('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { access_token: 'secret-access' })).rejects.toThrow(
      /google_tokens select failed/
    );
    expect(logSpy).toHaveBeenCalled();
    const arg = (logSpy.mock.calls[0] ?? [null, ''])[0] as Record<string, unknown> | null;
    expect(String(JSON.stringify(arg))).not.toMatch(/secret-access/);
  });

  it('throws on upsert error without including token in thrown message (message from Supabase only)', async () => {
    supabaseFrom.mockImplementation((table: string) => {
      if (table === 'google_tokens') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          upsert: () => ({ error: { message: 'null value in column "tokens"', code: '23502' } }),
        };
      }
      return {};
    });
    const { upsertTokens } = await import('../../src/db/tokens.js');
    await expect(
      upsertTokens('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
        access_token: 'x',
        refresh_token: 'y',
      })
    ).rejects.toThrow(/google_tokens upsert failed/);
  });
});
