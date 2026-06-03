import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { signOAuthState } from '../../src/utils/oauthState.js';

const USER = '19191919-1919-4919-8919-191919191919';

const st = vi.hoisted(() => ({
  order: [] as string[],
  userRowExists: false,
  existingRefreshToken: null as string | null,
  lastGoogleTokensRow: null as Record<string, unknown> | null,
  googleTokensUpsertFail: false,
  googleTokensSelectFail: false,
}));

const { mockGenerateAuthUrl, mockGetToken, OAuth2Mock } = vi.hoisted(() => {
  const mockGenerateAuthUrl = vi.fn();
  const mockGetToken = vi.fn();
  const OAuth2Mock = vi.fn(function OAuth2MockConstructor(this: Record<string, unknown>) {
    this.generateAuthUrl = mockGenerateAuthUrl;
    this.getToken = mockGetToken;
  });
  return { mockGenerateAuthUrl, mockGetToken, OAuth2Mock };
});

vi.mock('google-auth-library', () => ({
  OAuth2Client: OAuth2Mock,
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getAuthService: () => ({ getClientForUser: () => Promise.resolve({ token: 'ok' }) }),
}));

vi.mock('../../src/pilot/pilot_controls.js', () => ({
  isExistingPilotUser: vi.fn().mockResolvedValue(true),
  checkPilotCapacity: vi.fn().mockResolvedValue({ allowed: true, message: '' }),
}));

vi.mock('../../src/db/service_client.js', () => ({
  getServiceSupabaseOrAnon: () => ({
    from(table: string) {
      st.order.push(`from:${table}`);
      if (table === 'users') {
        return {
          select: () => ({
            eq: (col: string, userId: string) => ({
              maybeSingle: async () => {
                st.order.push('users:maybeSingle');
                return { data: st.userRowExists ? { id: userId } : null, error: null };
              },
            }),
          }),
          insert: (row: { id: string }) => {
            st.order.push('users:insert');
            st.userRowExists = true;
            return { error: null };
          },
        };
      }
      if (table === 'google_tokens') {
        return {
          select: (cols: string) => {
            st.order.push(`google_tokens:select(${cols})`);
            return {
              eq: (col: string) => ({
                maybeSingle: async () => {
                  st.order.push('google_tokens:maybeSingle');
                  if (st.googleTokensSelectFail) {
                    return { data: null, error: { message: 'select denied', code: 'TEST' } };
                  }
                  return {
                    data: st.existingRefreshToken
                      ? { refresh_token: st.existingRefreshToken }
                      : null,
                    error: null,
                  };
                },
              }),
            };
          },
          upsert: (row: Record<string, unknown>) => {
            st.order.push('google_tokens:upsert');
            if (st.googleTokensUpsertFail) {
              return { error: { message: 'insert denied', code: 'TEST' } };
            }
            st.lastGoogleTokensRow = { ...row };
            return { error: null };
          },
        };
      }
      if (table === 'user_policies') {
        return {
          select: () => ({
            eq: (col: string) => ({
              maybeSingle: async () => {
                st.order.push('user_policies:maybeSingle');
                return { data: null, error: null };
              },
            }),
          }),
          upsert: () => {
            st.order.push('user_policies:upsert');
            return { error: null };
          },
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      };
    },
  }),
}));

import authRouter from '../../src/routes/auth.js';

function app() {
  const x = express();
  x.use(cookieParser());
  x.use('/auth', authRouter);
  return x;
}

describe('OAuth callback persistence (real auth route + real upsertTokens; mocked Supabase)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['GOOGLE_CLIENT_ID'] = 'client-id';
    process.env['GOOGLE_CLIENT_SECRET'] = 'client-secret';
    process.env['GOOGLE_REDIRECT_URI'] = 'http://localhost:3000/auth/callback';
    process.env['CALADDIN_API_KEY'] = 'test-api-key-hmac-for-oauth-state-32chars-ok';
    st.order = [];
    st.userRowExists = false;
    st.existingRefreshToken = null;
    st.lastGoogleTokensRow = null;
    st.googleTokensUpsertFail = false;
    st.googleTokensSelectFail = false;
    mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/mock');
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expiry_date: 1_800_000_000_000,
        scope:
          'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
      },
    });
  });

  it('signed state + matching cookie: user row + tokens write order; google_tokens row matches schema', async () => {
    const res = await request(app())
      .get('/auth/callback')
      .query({ code: 'c1', state: signOAuthState(USER) })
      .set('Cookie', [`caladdin_user_id=${USER}`]);

    expect(res.status).toBe(302);
    const tUpsert = st.order.indexOf('google_tokens:upsert');
    expect(tUpsert).toBeGreaterThanOrEqual(0);
    expect(
      st.order.slice(0, tUpsert + 1).some((s) => s === 'users:insert' || s === 'users:maybeSingle')
    ).toBe(true);
    const insertAt = st.order.indexOf('users:insert');
    if (insertAt >= 0) {
      expect(insertAt).toBeLessThan(tUpsert);
    }

    expect(st.lastGoogleTokensRow).toMatchObject({
      user_id: USER,
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expiry_date: 1_800_000_000_000,
    });
    expect(st.lastGoogleTokensRow?.['updated_at']).toEqual(expect.any(String));
    // Row shape matches getClientForUser: access_token, refresh_token, expiry_date
  });

  it('callback returns 500 when google_tokens upsert fails (e.g. NOT NULL, RLS)', async () => {
    st.googleTokensUpsertFail = true;
    const res = await request(app())
      .get('/auth/callback')
      .query({ code: 'c-fail', state: signOAuthState(USER) })
      .set('Cookie', [`caladdin_user_id=${USER}`]);
    expect(res.status).toBe(500);
  });

  it('callback returns 500 when google_tokens select before upsert fails', async () => {
    st.googleTokensSelectFail = true;
    const res = await request(app())
      .get('/auth/callback')
      .query({ code: 'c-sel', state: signOAuthState(USER) })
      .set('Cookie', [`caladdin_user_id=${USER}`]);
    expect(res.status).toBe(500);
  });

  it('refresh_token kept when Google omits it but row had one', async () => {
    st.userRowExists = true;
    st.existingRefreshToken = 'keep-this-refresh';
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: 'rotated',
        scope:
          'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
      },
    });
    const res = await request(app())
      .get('/auth/callback')
      .query({ code: 'c2', state: signOAuthState(USER) })
      .set('Cookie', [`caladdin_user_id=${USER}`]);
    expect(res.status).toBe(302);
    expect(st.lastGoogleTokensRow).toMatchObject({
      user_id: USER,
      access_token: 'rotated',
      refresh_token: 'keep-this-refresh',
    });
  });

  it('400 when state missing (cannot verify callback)', async () => {
    const res = await request(app())
      .get('/auth/callback')
      .query({ code: 'c' })
      .set('Cookie', [`caladdin_user_id=${USER}`]);
    expect(res.status).toBe(400);
  });

  it('403 when caladdin session cookie missing', async () => {
    const res = await request(app())
      .get('/auth/callback')
      .query({ code: 'c', state: signOAuthState(USER) });
    expect(res.status).toBe(403);
  });

  it('403 when cookie does not match signed state user', async () => {
    const other = '28282828-2828-4828-8828-282828282828';
    const res = await request(app())
      .get('/auth/callback')
      .query({ code: 'c', state: signOAuthState(USER) })
      .set('Cookie', [`caladdin_user_id=${other}`]);
    expect(res.status).toBe(403);
  });
});
