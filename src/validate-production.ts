import { existsSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { resolveWebRoot } from './project-paths.js';
import { logger } from './logger.js';
import { inviteeGrantRedirectUri } from './services/invitee_oauth.js';

const WEAK_SECRETS = new Set([
  '',
  'dev-session-secret-change-me',
  'dev-oauth-state-secret',
  'change-me-in-production',
]);

function assertSecret(name: string, value: string, minLength = 32): void {
  if (WEAK_SECRETS.has(value) || value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} random characters in production`);
  }
}

/** Fail fast on misconfiguration before accepting traffic (Render / Docker). */
export function validateProductionConfig(): void {
  if (!config.isProd || process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return;
  }

  assertSecret('SESSION_SECRET', config.sessionSecret);
  assertSecret('OAUTH_STATE_SECRET', config.oauthStateSecret);
  assertSecret('CALADDIN_API_KEY', config.apiKey, 24);

  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const expectedRedirect = `${baseUrl}/auth/callback`;
  if (config.googleRedirectUri !== expectedRedirect) {
    throw new Error(
      `GOOGLE_REDIRECT_URI must be ${expectedRedirect} (got ${config.googleRedirectUri})`,
    );
  }

  const expectedGrantRedirect = `${baseUrl}/s/grant/callback`;
  const actualGrantRedirect = inviteeGrantRedirectUri();
  if (actualGrantRedirect !== expectedGrantRedirect) {
    throw new Error(
      `INVITEE_GRANT_REDIRECT_URI must be ${expectedGrantRedirect} (got ${actualGrantRedirect})`,
    );
  }

  if (!config.baseUrl.startsWith('https://')) {
    throw new Error('CALADDIN_BASE_URL must use https:// in production');
  }

  const webRoot = resolveWebRoot();
  if (!existsSync(join(webRoot, 'index.html'))) {
    throw new Error(`Built UI missing at ${webRoot}/index.html — run npm run build:web in the image`);
  }

  logger.info('Production config validated', { webRoot, baseUrl: config.baseUrl });
}
