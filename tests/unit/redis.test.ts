import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pingRedis } from '../../src/services/redis.js';
import { config } from '../../src/config.js';

describe('pingRedis', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup, VITEST: 'false', NODE_ENV: 'development' };
    delete process.env.REDIS_URL;
    (config as { isProd: boolean }).isProd = false;
  });

  afterEach(() => {
    process.env = envBackup;
  });

  it('returns skipped when REDIS_URL is unset', async () => {
    expect(await pingRedis()).toBe('skipped');
  });

  it('returns ok in vitest even when REDIS_URL is set', async () => {
    process.env.VITEST = 'true';
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(await pingRedis()).toBe('ok');
  });

  it('returns skipped when TCP connect fails in development', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:59999';
    expect(await pingRedis()).toBe('skipped');
  }, 10_000);

  it('returns error when TCP connect fails in production', async () => {
    process.env.NODE_ENV = 'production';
    (config as { isProd: boolean }).isProd = true;
    process.env.REDIS_URL = 'redis://127.0.0.1:59999';
    expect(await pingRedis()).toBe('error');
  }, 10_000);
});
