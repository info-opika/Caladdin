/**
 * Platform invite landing page — GET /invite/:token
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockGetInvite = vi.fn();

vi.mock('../../src/db/platform_invites.js', () => ({
  getPlatformInviteByToken: (...a: unknown[]) => mockGetInvite(...a),
}));

import { inviteRouter } from '../../src/routes/invite.js';

function app() {
  const x = express();
  x.use('/invite', inviteRouter);
  return x;
}

describe('invite routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders invite page with auth start link for valid token', async () => {
    mockGetInvite.mockResolvedValueOnce({
      token: 'valid-tok',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    const res = await request(app()).get('/invite/valid-tok');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain("You're invited to Caladdin");
    expect(res.text).toContain('/auth/start?invite=valid-tok');
    expect(res.text).toContain('Create your account with Google');
  });

  it('returns 404 for unknown token', async () => {
    mockGetInvite.mockResolvedValueOnce(null);
    const res = await request(app()).get('/invite/bad-tok');
    expect(res.status).toBe(404);
    expect(res.text).toMatch(/not found or expired/i);
  });

  it('returns 404 for expired invite', async () => {
    mockGetInvite.mockResolvedValueOnce({
      token: 'old-tok',
      expires_at: new Date(Date.now() - 86400000).toISOString(),
    });
    const res = await request(app()).get('/invite/old-tok');
    expect(res.status).toBe(404);
  });
});
