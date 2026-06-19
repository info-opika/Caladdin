/**
 * OAuth callback MVP — 14-day import, pilot gating, ref=scheduling, invite= attribution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { signOAuthState } from '../../src/services/auth_service.js';

const st = vi.hoisted(() => ({
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  existingUser: false,
  killSwitch: false,
  capacityAllowed: true,
  importCalls: [] as { start: string; end: string }[],
  usageEvents: [] as { userId: string | null; type: string; meta: Record<string, unknown> }[],
  inviteAccepted: [] as { token: string; userId: string }[],
}));

function buildState(extra: Record<string, string> = {}): string {
  const payload = Buffer.from(JSON.stringify({ nonce: 'n', ...extra })).toString('base64url');
  return signOAuthState(payload);
}

vi.mock('../../src/services/auth_service.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/services/auth_service.js')>();
  return {
    ...orig,
    exchangeCodeForTokens: vi.fn().mockResolvedValue({ access_token: 'at', refresh_token: 'rt' }),
    getGoogleUserInfo: vi.fn().mockResolvedValue({ email: 'newuser@example.com', name: 'New User' }),
    persistTokensForUser: vi.fn().mockResolvedValue(undefined),
    getAuthUrl: vi.fn((state: string) => `https://accounts.google.com/o/oauth2/auth?state=${encodeURIComponent(state)}`),
  };
});

vi.mock('../../src/pilot/pilot_controls.js', () => ({
  isExistingPilotUser: vi.fn(async (email: string) => {
    void email;
    return st.existingUser;
  }),
  isKillSwitchActive: vi.fn(() => st.killSwitch),
  checkPilotCapacity: vi.fn(async () =>
    st.capacityAllowed
      ? { allowed: true }
      : { allowed: false, reason: 'pilot_full', message: 'Pilot full' },
  ),
}));

vi.mock('../../src/db/users.js', () => ({
  upsertUser: vi.fn().mockResolvedValue({
    id: st.userId,
    email: 'newuser@example.com',
    display_name: 'New User',
    timezone: 'America/Chicago',
    privacy_mode: 'standard',
  }),
  ensureDefaultPolicy: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/services/calendar_api.js', () => ({
  importEventsFromGCalWithToken: vi.fn(async (_token: string, _userId: string, start: string, end: string) => {
    st.importCalls.push({ start, end });
  }),
}));

vi.mock('../../src/db/usage_events.js', () => ({
  recordUsageEvent: vi.fn(async (userId: string | null, eventType: string, metadata: Record<string, unknown> = {}) => {
    st.usageEvents.push({ userId, type: eventType, meta: metadata });
  }),
}));

vi.mock('../../src/db/platform_invites.js', () => ({
  getPlatformInviteByToken: vi.fn(),
  markPlatformInviteAccepted: vi.fn(async (token: string, userId: string) => {
    st.inviteAccepted.push({ token, userId });
  }),
}));

vi.mock('../../src/db/conversation-context.js', () => ({
  clearPendingEmailConfirmation: vi.fn().mockResolvedValue(undefined),
}));

import { authRouter } from '../../src/routes/auth.js';
import { importEventsFromGCalWithToken } from '../../src/services/calendar_api.js';
import { addDays, startOfWeek } from '../../src/core/date-utils.js';

function app() {
  const x = express();
  x.use(cookieParser());
  x.use('/auth', authRouter);
  return x;
}

/** Wait for schedulePostSignInWork() fire-and-forget tasks in tests. */
async function flushPostSignInWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('OAuth MVP callback flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    st.existingUser = false;
    st.killSwitch = false;
    st.capacityAllowed = true;
    st.importCalls = [];
    st.usageEvents = [];
    st.inviteAccepted = [];
    process.env.VITEST = 'true';
  });

  it('redirects to /?welcome=1 on successful new user signup', async () => {
    const res = await request(app())
      .get('/auth/callback')
      .query({ code: 'auth-code', state: buildState() });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?welcome=1');
    expect(res.headers['set-cookie']?.some((c) => c.startsWith('caladdin_session='))).toBe(true);
  });

  it('imports 14 days of calendar events on callback', async () => {
    await request(app()).get('/auth/callback').query({ code: 'c1', state: buildState() });
    await flushPostSignInWork();
    expect(importEventsFromGCalWithToken).toHaveBeenCalledTimes(1);
    expect(st.importCalls).toHaveLength(1);
    const { start, end } = st.importCalls[0]!;
    const weekStart = startOfWeek(new Date());
    const expectedEnd = addDays(weekStart, 14).toISOString();
    expect(start).toBe(weekStart.toISOString());
    expect(end).toBe(expectedEnd);
  });

  it('redirects to /?pilot=paused for new user when kill switch active', async () => {
    st.killSwitch = true;
    const res = await request(app()).get('/auth/callback').query({ code: 'c', state: buildState() });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?pilot=paused');
  });

  it('redirects to /?pilot=full for new user when pilot at capacity', async () => {
    st.capacityAllowed = false;
    const res = await request(app()).get('/auth/callback').query({ code: 'c', state: buildState() });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?pilot=full');
  });

  it('allows existing pilot user through when pilot full', async () => {
    st.existingUser = true;
    st.capacityAllowed = false;
    const res = await request(app()).get('/auth/callback').query({ code: 'c', state: buildState() });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?welcome=1');
  });

  it('allows existing pilot user through when kill switch active', async () => {
    st.existingUser = true;
    st.killSwitch = true;
    const res = await request(app()).get('/auth/callback').query({ code: 'c', state: buildState() });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?welcome=1');
  });

  it('records post_accept_signup when ref=scheduling and token in state', async () => {
    const sessionToken = 'sched-tok-abc';
    await request(app())
      .get('/auth/callback')
      .query({ code: 'c', state: buildState({ ref: 'scheduling', token: sessionToken }) });
    await flushPostSignInWork();
    expect(st.usageEvents).toContainEqual({
      userId: st.userId,
      type: 'post_accept_signup',
      meta: { sessionToken },
    });
  });

  it('does not record post_accept_signup without ref=scheduling', async () => {
    await request(app())
      .get('/auth/callback')
      .query({ code: 'c', state: buildState({ token: 'tok-only' }) });
    await flushPostSignInWork();
    expect(st.usageEvents.find((e) => e.type === 'post_accept_signup')).toBeUndefined();
  });

  it('marks platform invite accepted and records platform_invite_signup', async () => {
    const inviteToken = 'inv-xyz';
    await request(app())
      .get('/auth/callback')
      .query({ code: 'c', state: buildState({ invite: inviteToken }) });
    await flushPostSignInWork();
    expect(st.inviteAccepted).toEqual([{ token: inviteToken, userId: st.userId }]);
    expect(st.usageEvents).toContainEqual({
      userId: st.userId,
      type: 'platform_invite_signup',
      meta: { inviteToken },
    });
  });

  it('GET /auth/start redirects to Google with invite in signed state', async () => {
    const res = await request(app()).get('/auth/start').query({ invite: 'tok-inv' });
    expect(res.status).toBe(302);
    const loc = res.headers.location as string;
    expect(loc).toContain('accounts.google.com');
    const stateParam = new URL(loc).searchParams.get('state');
    expect(stateParam).toBeTruthy();
    expect(stateParam!.split('.').length).toBe(2);
  });

  it('returns 400 for invalid OAuth state', async () => {
    const res = await request(app()).get('/auth/callback').query({ code: 'c', state: 'bad-state' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Invalid OAuth state/i);
  });

  it('returns 400 when code missing', async () => {
    const res = await request(app()).get('/auth/callback').query({ state: buildState() });
    expect(res.status).toBe(400);
  });

  it('returns 500 when token exchange fails', async () => {
    const { exchangeCodeForTokens } = await import('../../src/services/auth_service.js');
    vi.mocked(exchangeCodeForTokens).mockRejectedValueOnce(new Error('oauth fail'));
    const res = await request(app()).get('/auth/callback').query({ code: 'c', state: buildState() });
    expect(res.status).toBe(500);
    expect(res.text).toMatch(/Calendar connection failed/i);
  });

  it('redirects to /?auth=expired when authorization code was already used', async () => {
    const { exchangeCodeForTokens } = await import('../../src/services/auth_service.js');
    vi.mocked(exchangeCodeForTokens).mockRejectedValueOnce(
      new Error('Google OAuth error: invalid_grant — Bad Request'),
    );
    const res = await request(app()).get('/auth/callback').query({ code: 'c', state: buildState() });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?auth=expired');
  });
});
