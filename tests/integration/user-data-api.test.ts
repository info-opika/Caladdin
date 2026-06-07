import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { apiRouter } from '../../src/routes/api.js';

const mockExportUserData = vi.fn();
const mockDeleteUserAccount = vi.fn();
const mockAuditSensitiveOperation = vi.fn();
const mockRequireSession = vi.fn();

vi.mock('../../src/db/user_data.js', () => ({
  exportUserData: (...args: unknown[]) => mockExportUserData(...args),
  deleteUserAccount: (...args: unknown[]) => mockDeleteUserAccount(...args),
}));

vi.mock('../../src/middleware/sensitiveAudit.js', () => ({
  auditSensitiveOperation: (...args: unknown[]) => mockAuditSensitiveOperation(...args),
}));

vi.mock('../../src/middleware/session.js', () => ({
  requireSession: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    mockRequireSession(req, res, next);
    (req as express.Request & { session: { userId: string; email: string } }).session = {
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'host@example.test',
    };
    next();
  },
}));

function app() {
  const x = express();
  x.use(express.json());
  x.use('/api', apiRouter);
  return x;
}

describe('User data GDPR API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditSensitiveOperation.mockResolvedValue(undefined);
  });

  it('GET /api/user/data returns export payload', async () => {
    mockExportUserData.mockResolvedValueOnce({
      exportedAt: '2026-06-07T00:00:00.000Z',
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'host@example.test' },
      policy: { profile: {} },
      eventTypes: [],
      schedulingSessions: [],
      feedback: [],
      auditLog: [],
      usageEvents: [],
      calendarConnected: true,
    });

    const res = await request(app()).get('/api/user/data');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('host@example.test');
    expect(mockExportUserData).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(mockAuditSensitiveOperation).toHaveBeenCalledWith(
      expect.anything(),
      '11111111-1111-4111-8111-111111111111',
      'GDPR_EXPORT',
      'success',
    );
  });

  it('GET /api/user/data returns 404 when user missing', async () => {
    mockExportUserData.mockResolvedValueOnce({
      exportedAt: '2026-06-07T00:00:00.000Z',
      user: null,
      policy: null,
      eventTypes: [],
      schedulingSessions: [],
      feedback: [],
      auditLog: [],
      usageEvents: [],
      calendarConnected: false,
    });

    const res = await request(app()).get('/api/user/data');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('DELETE /api/user/data requires confirm body', async () => {
    const res = await request(app()).delete('/api/user/data').send({});
    expect(res.status).toBe(400);
    expect(mockDeleteUserAccount).not.toHaveBeenCalled();
  });

  it('DELETE /api/user/data deletes account when confirmed', async () => {
    mockDeleteUserAccount.mockResolvedValueOnce(undefined);

    const res = await request(app())
      .delete('/api/user/data')
      .send({ confirm: 'DELETE' });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(mockDeleteUserAccount).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(mockAuditSensitiveOperation).toHaveBeenCalledWith(
      expect.anything(),
      '11111111-1111-4111-8111-111111111111',
      'GDPR_DELETE',
      'requested',
      expect.objectContaining({ email: 'host@example.test' }),
    );
  });

  it('DELETE /api/user/data returns 500 on failure', async () => {
    mockDeleteUserAccount.mockRejectedValueOnce(new Error('db error'));

    const res = await request(app())
      .delete('/api/user/data')
      .send({ confirm: 'DELETE' });

    expect(res.status).toBe(500);
    expect(mockAuditSensitiveOperation).toHaveBeenCalledWith(
      expect.anything(),
      '11111111-1111-4111-8111-111111111111',
      'GDPR_DELETE',
      'error',
    );
  });
});
