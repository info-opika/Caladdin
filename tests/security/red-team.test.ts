import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';
import { createSession } from '../../src/middleware/session.js';

vi.mock('../../src/db/users.js', () => ({
  getPolicy: vi.fn().mockResolvedValue({ schemaVersion: 1, protectedBlocks: [], shapeRules: {}, gatekeepRules: [], timezone: 'UTC', workingHoursStart: '09:00', workingHoursEnd: '18:00' }),
  getUserById: vi.fn().mockResolvedValue({ id: '77a22c75-4e6b-47ca-aee6-2f4ace21be53', email: 'test@test.com' }),
  ensureDefaultPolicy: vi.fn(),
}));

vi.mock('../../src/core/parser.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/core/parser.js')>();
  return {
    ...orig,
    parseIntent: vi.fn().mockResolvedValue({
      intent: 'QUERY_CALENDAR',
      confidence: 0.9,
      params: {},
      mappingMethod: 'direct',
      rawUtterance: 'test',
    }),
  };
});

vi.mock('../../src/core/orchestrator.js', () => ({
  orchestrate: vi.fn().mockResolvedValue({
    intent: 'QUERY_CALENDAR',
    success: true,
    requiresConfirmation: false,
    messageToUser: 'ok',
    schemaVersion: 1,
  }),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: vi.fn().mockResolvedValue(null),
}));

const validUUID = '77a22c75-4e6b-47ca-aee6-2f4ace21be53';

describe('red team', () => {
  it('ATTACK 1: no session on /voice returns 401', async () => {
    const res = await request(app)
      .post('/voice')
      .send({ utterance: 'hello' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('ATTACK 3: utterance too long returns 400', async () => {
    const token = createSession(validUUID, 'test@test.com');
    const res = await request(app)
      .post('/voice')
      .set('Cookie', `caladdin_session=${token}`)
      .send({ utterance: 'a'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });

  it('ATTACK 5: invalid userId in body when session mismatch returns 403', async () => {
    const token = createSession(validUUID, 'test@test.com');
    const res = await request(app)
      .post('/voice')
      .set('Cookie', `caladdin_session=${token}`)
      .send({ utterance: 'calendar today', userId: '99999999-9999-4999-8999-999999999999' });
    expect(res.status).toBe(403);
  });

  it('health is public', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
