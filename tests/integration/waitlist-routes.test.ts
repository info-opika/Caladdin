/**
 * Waitlist HTTP routes — POST /waitlist, GET /waitlist/status
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockAdd = vi.fn();
const mockCheckCap = vi.fn();

vi.mock('../../src/db/waitlist.js', () => ({
  addToWaitlist: (...a: unknown[]) => mockAdd(...a),
}));

vi.mock('../../src/pilot/pilot_controls.js', () => ({
  checkPilotCapacity: (...a: unknown[]) => mockCheckCap(...a),
  MAX_PILOT_USERS: 25,
}));

import { waitlistRouter } from '../../src/routes/waitlist.js';

function app() {
  const x = express();
  x.use(express.json());
  x.use('/waitlist', waitlistRouter);
  return x;
}

describe('waitlist routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCap.mockResolvedValue({ allowed: true });
    mockAdd.mockResolvedValue({ email: 'user@example.com', status: 'waiting' });
  });

  describe('GET /waitlist/status', () => {
    it('returns pilotOpen true when capacity allows', async () => {
      const res = await request(app()).get('/waitlist/status');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        pilotOpen: true,
        maxUsers: 25,
        message: 'Pilot open',
      });
    });

    it('returns pilotOpen false with capacity message when full', async () => {
      mockCheckCap.mockResolvedValueOnce({
        allowed: false,
        reason: 'pilot_full',
        message: 'The Caladdin pilot is full. Join the waitlist.',
      });
      const res = await request(app()).get('/waitlist/status');
      expect(res.status).toBe(200);
      expect(res.body.pilotOpen).toBe(false);
      expect(res.body.message).toMatch(/full/i);
    });

    it('returns pilotOpen false when kill switch active', async () => {
      mockCheckCap.mockResolvedValueOnce({
        allowed: false,
        reason: 'kill_switch',
        message: 'Caladdin is temporarily paused.',
      });
      const res = await request(app()).get('/waitlist/status');
      expect(res.body.pilotOpen).toBe(false);
    });

    it('returns 503 when checkPilotCapacity throws', async () => {
      mockCheckCap.mockRejectedValueOnce(new Error('db'));
      const res = await request(app()).get('/waitlist/status');
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('Unavailable');
    });
  });

  describe('POST /waitlist', () => {
    it('accepts valid email and returns ok', async () => {
      const res = await request(app()).post('/waitlist').send({ email: 'user@example.com' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, email: 'user@example.com', status: 'waiting' });
      expect(mockAdd).toHaveBeenCalledWith('user@example.com');
    });

    it('returns 400 for missing email', async () => {
      const res = await request(app()).post('/waitlist').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Valid email required');
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid email format', async () => {
      const res = await request(app()).post('/waitlist').send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('returns 400 for email without domain', async () => {
      const res = await request(app()).post('/waitlist').send({ email: 'user@' });
      expect(res.status).toBe(400);
    });

    it('returns 500 when addToWaitlist throws', async () => {
      mockAdd.mockRejectedValueOnce(new Error('db'));
      const res = await request(app()).post('/waitlist').send({ email: 'a@b.com' });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Could not join waitlist');
    });

    it('idempotent re-post returns same email status', async () => {
      mockAdd.mockResolvedValue({ email: 'a@b.com', status: 'waiting' });
      const r1 = await request(app()).post('/waitlist').send({ email: 'a@b.com' });
      const r2 = await request(app()).post('/waitlist').send({ email: 'a@b.com' });
      expect(r1.body.status).toBe('waiting');
      expect(r2.body.status).toBe('waiting');
    });
  });
});
