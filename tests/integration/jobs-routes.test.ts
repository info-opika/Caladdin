import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockRunReminders = vi.fn();
const mockRunImprovementLoop = vi.fn();
const mockRunSessionExpiry = vi.fn();

vi.mock('../../src/middleware/session.js', () => ({
  requireApiKey: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.headers['x-api-key'];
    if (key !== 'test-api-key') {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  },
}));

vi.mock('../../src/jobs/reminders.js', () => ({
  runReminders: (...a: unknown[]) => mockRunReminders(...a),
}));

vi.mock('../../src/jobs/improvement-loop.js', () => ({
  runImprovementLoop: (...a: unknown[]) => mockRunImprovementLoop(...a),
}));

vi.mock('../../src/jobs/session-expiry.js', () => ({
  runSessionExpiry: (...a: unknown[]) => mockRunSessionExpiry(...a),
}));

import { jobsRouter } from '../../src/routes/jobs.js';

function app() {
  const x = express();
  x.use(express.json());
  x.use('/jobs', jobsRouter);
  return x;
}

describe('jobs routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunReminders.mockResolvedValue({ processed: 2, sent: 1, skipped: 1, failed: 0 });
    mockRunImprovementLoop.mockResolvedValue({
      failuresAnalyzed: 5,
      groupsAnalyzed: 2,
      reportPath: '/tmp/IMPROVEMENT_REPORT.md',
      ntfySent: false,
    });
    mockRunSessionExpiry.mockResolvedValue(3);
  });

  describe('POST /jobs/reminders', () => {
    it('requires API key', async () => {
      const res = await request(app()).post('/jobs/reminders');
      expect(res.status).toBe(401);
      expect(mockRunReminders).not.toHaveBeenCalled();
    });

    it('runs reminder job and returns stats', async () => {
      const res = await request(app())
        .post('/jobs/reminders')
        .set('x-api-key', 'test-api-key');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'complete', processed: 2, sent: 1 });
      expect(mockRunReminders).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when reminder job throws', async () => {
      mockRunReminders.mockRejectedValueOnce(new Error('db down'));
      const res = await request(app())
        .post('/jobs/reminders')
        .set('x-api-key', 'test-api-key');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });

  describe('POST /jobs/improvement-loop', () => {
    it('requires API key', async () => {
      const res = await request(app()).post('/jobs/improvement-loop');
      expect(res.status).toBe(401);
      expect(mockRunImprovementLoop).not.toHaveBeenCalled();
    });

    it('runs improvement loop with defaults', async () => {
      const res = await request(app())
        .post('/jobs/improvement-loop')
        .set('x-api-key', 'test-api-key')
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'complete',
        failuresAnalyzed: 5,
        groupsAnalyzed: 2,
      });
      expect(mockRunImprovementLoop).toHaveBeenCalledWith({
        lookbackDays: 7,
        minFailuresPerGroup: 3,
      });
    });

    it('accepts custom lookback and threshold', async () => {
      const res = await request(app())
        .post('/jobs/improvement-loop')
        .set('x-api-key', 'test-api-key')
        .send({ lookbackDays: 14, minFailuresPerGroup: 5 });
      expect(res.status).toBe(200);
      expect(mockRunImprovementLoop).toHaveBeenCalledWith({
        lookbackDays: 14,
        minFailuresPerGroup: 5,
      });
    });

    it('returns 500 when improvement loop throws', async () => {
      mockRunImprovementLoop.mockRejectedValueOnce(new Error('write failed'));
      const res = await request(app())
        .post('/jobs/improvement-loop')
        .set('x-api-key', 'test-api-key')
        .send({});
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });

  describe('POST /jobs/session-expiry', () => {
    it('requires API key', async () => {
      const res = await request(app()).post('/jobs/session-expiry');
      expect(res.status).toBe(401);
      expect(mockRunSessionExpiry).not.toHaveBeenCalled();
    });

    it('expires open sessions and returns count', async () => {
      const res = await request(app())
        .post('/jobs/session-expiry')
        .set('x-api-key', 'test-api-key');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'complete', expired: 3 });
      expect(mockRunSessionExpiry).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when session expiry throws', async () => {
      mockRunSessionExpiry.mockRejectedValueOnce(new Error('timeout'));
      const res = await request(app())
        .post('/jobs/session-expiry')
        .set('x-api-key', 'test-api-key');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });
});
