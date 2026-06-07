import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';
import * as client from '../../src/db/client.js';
import * as redis from '../../src/services/redis.js';

describe('GET /health', () => {
  beforeEach(() => {
    vi.spyOn(client, 'pingDb').mockResolvedValue('ok');
    vi.spyOn(redis, 'pingRedis').mockResolvedValue('skipped');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 with db, redis, version, uptime', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
    expect(res.body.redis).toBe('skipped');
    expect(res.body.version).toBe('1.0.0');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns 503 when db ping fails', async () => {
    vi.mocked(client.pingDb).mockResolvedValue('error');
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.db).toBe('error');
  });

  it('returns 503 when redis ping fails in production with REDIS_URL', async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevRedis = process.env.REDIS_URL;
    process.env.NODE_ENV = 'production';
    process.env.REDIS_URL = 'redis://localhost:6379';
    vi.mocked(redis.pingRedis).mockResolvedValue('error');

    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.redis).toBe('error');

    process.env.NODE_ENV = prevEnv;
    process.env.REDIS_URL = prevRedis;
  });
});
