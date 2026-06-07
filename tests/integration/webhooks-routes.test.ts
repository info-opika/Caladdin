import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockSession = { userId: 'user-wh-1', email: 'host@test.com' };
const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../src/middleware/session.js', () => ({
  requireSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { session: typeof mockSession }).session = mockSession;
    next();
  },
}));

vi.mock('../../src/db/webhook_subscriptions.js', () => ({
  listWebhookSubscriptions: (...a: unknown[]) => mockList(...a),
  createWebhookSubscription: (...a: unknown[]) => mockCreate(...a),
  updateWebhookSubscription: (...a: unknown[]) => mockUpdate(...a),
  deleteWebhookSubscription: (...a: unknown[]) => mockDelete(...a),
  generateWebhookSecret: () => 'generated-secret-1234567890',
}));

import { webhooksRouter } from '../../src/routes/webhooks.js';

function app() {
  const x = express();
  x.use(express.json());
  x.use('/api/webhooks', webhooksRouter);
  return x;
}

describe('webhooks routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/webhooks lists subscriptions for host', async () => {
    mockList.mockResolvedValueOnce([
      {
        id: 'wh-1',
        userId: 'user-wh-1',
        url: 'https://example.com/hook',
        secret: 'sec',
        events: ['booking.confirmed'],
        active: true,
        createdAt: '2026-06-07T00:00:00.000Z',
        updatedAt: '2026-06-07T00:00:00.000Z',
      },
    ]);
    const res = await request(app()).get('/api/webhooks');
    expect(res.status).toBe(200);
    expect(res.body.subscriptions).toHaveLength(1);
    expect(mockList).toHaveBeenCalledWith('user-wh-1');
  });

  it('POST /api/webhooks validates https URL and events', async () => {
    const badUrl = await request(app())
      .post('/api/webhooks')
      .send({ url: 'http://insecure.test/hook', events: ['booking.confirmed'] });
    expect(badUrl.status).toBe(400);

    mockCreate.mockResolvedValueOnce({
      id: 'wh-2',
      url: 'https://example.com/hook',
      secret: 'sec',
      events: ['booking.cancelled'],
      active: true,
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:00:00.000Z',
    });
    const ok = await request(app())
      .post('/api/webhooks')
      .send({ url: 'https://example.com/hook', events: ['booking.cancelled'] });
    expect(ok.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith('user-wh-1', {
      url: 'https://example.com/hook',
      events: ['booking.cancelled'],
    });
  });

  it('DELETE /api/webhooks/:id returns 404 when missing', async () => {
    mockDelete.mockResolvedValueOnce(false);
    const res = await request(app()).delete('/api/webhooks/missing');
    expect(res.status).toBe(404);
  });
});
