import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeGoogleOAuthEnv, auditGoogleOAuthEnvDrift } from '../../../src/config/normalizeOAuthEnv.js';

const saved: Record<string, string | undefined> = {};

function save(keys: string[]) {
  for (const k of keys) saved[k] = process.env[k];
}

function restore(keys: string[]) {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

const KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
];

describe('normalizeGoogleOAuthEnv', () => {
  beforeEach(() => save(KEYS));
  afterEach(() => restore(KEYS));

  it('mirrors GOOGLE_OAUTH_* into GOOGLE_CLIENT_* when only alias set', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'id-from-alias';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret-from-alias';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:3000/auth/callback';
    const audit = auditGoogleOAuthEnvDrift();
    expect(process.env.GOOGLE_CLIENT_ID).toBe('id-from-alias');
    expect(process.env.GOOGLE_CLIENT_SECRET).toBe('secret-from-alias');
    expect(audit.configured).toBe(true);
    expect(audit.clientId).toBe('set');
  });

  it('mirrors GOOGLE_CLIENT_* into GOOGLE_OAUTH_* when only canonical set', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.GOOGLE_CLIENT_ID = 'canonical-id';
    process.env.GOOGLE_CLIENT_SECRET = 'canonical-secret';
    normalizeGoogleOAuthEnv();
    expect(process.env.GOOGLE_OAUTH_CLIENT_ID).toBe('canonical-id');
  });
});
