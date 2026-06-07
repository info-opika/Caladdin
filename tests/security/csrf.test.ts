import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {
  csrfProtectionMiddleware,
  CSRF_COOKIE,
  CSRF_HEADER,
  generateCsrfToken,
} from '../../src/middleware/csrf.js';
import { SESSION_COOKIE } from '../../src/middleware/session.js';

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(csrfProtectionMiddleware);
  app.post('/api/profile', (_req, res) => res.json({ ok: true }));
  app.post('/jobs/reminders', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('CSRF protection', () => {
  const prevVitest = process.env.VITEST;
  const prevNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.VITEST = '';
    process.env.NODE_ENV = 'production';
  });

  afterAll(() => {
    process.env.VITEST = prevVitest;
    process.env.NODE_ENV = prevNodeEnv;
  });
  it('allows POST without CSRF when no session cookie', async () => {
    const res = await request(buildApp()).post('/api/profile').send({});
    expect(res.status).toBe(200);
  });

  it('rejects POST with session cookie but missing CSRF token', async () => {
    const res = await request(buildApp())
      .post('/api/profile')
      .set('Cookie', [`${SESSION_COOKIE}=signed.session.token`])
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CSRF/i);
  });

  it('accepts POST when CSRF header matches cookie', async () => {
    const token = generateCsrfToken();
    const res = await request(buildApp())
      .post('/api/profile')
      .set('Cookie', [`${SESSION_COOKIE}=signed.session.token`, `${CSRF_COOKIE}=${token}`])
      .set(CSRF_HEADER, token)
      .send({});
    expect(res.status).toBe(200);
  });

  it('exempts API-key routes from CSRF even with session cookie', async () => {
    const res = await request(buildApp())
      .post('/jobs/reminders')
      .set('Cookie', [`${SESSION_COOKIE}=signed.session.token`])
      .send({});
    expect(res.status).toBe(200);
  });
});
