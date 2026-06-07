import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession,
  getSession,
  destroySession,
  signSessionToken,
  verifySessionTokenSignature,
} from '../../src/middleware/session.js';
import { resetAuthSessionsForTests } from '../../src/db/sessions.js';

const USER_ID = '77a22c75-4e6b-47ca-aee6-2f4ace21be53';
const EMAIL = 'user@example.com';

describe('Persistent session store (P0-01)', () => {
  beforeEach(() => {
    resetAuthSessionsForTests();
    process.env.VITEST = 'true';
  });

  it('signs session tokens with SESSION_SECRET', () => {
    const token = signSessionToken(USER_ID);
    expect(token.split('.')).toHaveLength(2);
    expect(verifySessionTokenSignature(token)).toBe(true);
    expect(verifySessionTokenSignature(`${token}x`)).toBe(false);
  });

  it('stores and retrieves session from shared backing store', async () => {
    const token = await createSession(USER_ID, EMAIL);
    const session = await getSession(token);
    expect(session).toEqual({ userId: USER_ID, email: EMAIL });
  });

  it('persists multiple concurrent sessions for the same user', async () => {
    const token1 = await createSession(USER_ID, EMAIL);
    const token2 = await createSession(USER_ID, EMAIL);
    expect(await getSession(token1)).toEqual({ userId: USER_ID, email: EMAIL });
    expect(await getSession(token2)).toEqual({ userId: USER_ID, email: EMAIL });
  });

  it('rejects tampered token before DB lookup', async () => {
    const token = await createSession(USER_ID, EMAIL);
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(await getSession(tampered)).toBeNull();
  });

  it('destroySession removes persisted session', async () => {
    const token = await createSession(USER_ID, EMAIL);
    await destroySession(token);
    expect(await getSession(token)).toBeNull();
  });
});
