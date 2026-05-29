import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return v ?? `test-${name}`;
  }
  if (!v && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required env: ${name}`);
  }
  return v ?? '';
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  googleClientId: required('GOOGLE_OAUTH_CLIENT_ID'),
  googleClientSecret: required('GOOGLE_OAUTH_CLIENT_SECRET'),
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/auth/callback',
  baseUrl: process.env.CALADDIN_BASE_URL ?? 'http://localhost:3000',
  apiKey: required('CALADDIN_API_KEY'),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-session-secret-change-me',
  oauthStateSecret: process.env.OAUTH_STATE_SECRET ?? 'dev-oauth-state-secret',
  ntfyTopic: process.env.NTFY_TOPIC ?? 'caladdin-agent',
  ntfyUserTopic: process.env.NTFY_USER_TOPIC ?? 'caladdin-user',
  utteranceMaxLength: 1000,
  confirmExpiryMinutes: 10,
  schedulingSessionHours: 72,
  undoWindowMinutes: 10,
  llmTimeoutMs: 10000,
  rateLimitMax: 20,
  rateLimitWindowMs: 60 * 60 * 1000,
};
