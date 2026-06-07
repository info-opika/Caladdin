import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';

describe('security headers', () => {
  it('sets CSP, X-Frame-Options, and Referrer-Policy on /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBeTruthy();
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['content-security-policy']).toMatch(/fonts\.googleapis\.com/);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sets X-Content-Type-Options on API routes', async () => {
    const res = await request(app).post('/voice').send({ utterance: 'hello' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
