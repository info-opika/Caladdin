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

/** Comma-separated CALADDIN_AGENT_PILOT_USERS → trimmed user IDs. */
export function parseAgentPilotUsers(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

/**
 * True when the scheduling agent is on for this user.
 * Default on (unset or CALADDIN_AGENT_ENABLED=1). When =0, only CALADDIN_AGENT_PILOT_USERS get the agent.
 */
export function agentEnabledFor(userId: string): boolean {
  if (process.env.CALADDIN_AGENT_ENABLED !== '0') return true;
  return parseAgentPilotUsers(process.env.CALADDIN_AGENT_PILOT_USERS).includes(userId);
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  freellmapiBaseUrl:
    process.env.FREELLMAPI_BASE_URL ??
    'https://freellmapiserver-production-df6f.up.railway.app/v1',
  freellmapiApiKey: required('FREELLMAPI_API_KEY'),
  agentModel: process.env.CALADDIN_AGENT_MODEL ?? 'auto:caladdin-agent',
  agentEscalationModel: process.env.CALADDIN_AGENT_ESCALATION_MODEL ?? 'auto:smart',
  llmTemperature: 0,
  parallelToolCalls: false,
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
  conversationSessionMinutes: 10,
  schedulingSessionHours: 72,
  undoWindowMinutes: 10,
  /** Global agent rollout flag; false only when CALADDIN_AGENT_ENABLED=0 (see agentEnabledFor for pilot override). */
  agentEnabled: process.env.CALADDIN_AGENT_ENABLED !== '0',
  get agentPilotUsers(): string[] {
    return parseAgentPilotUsers(process.env.CALADDIN_AGENT_PILOT_USERS);
  },
  llmTimeoutMs: 10000,
  rateLimitMax: 20,
  rateLimitWindowMs: 60 * 60 * 1000,
  voiceHttpRateLimitMax: 30,
  voiceHttpRateLimitWindowMs: 60 * 1000,
  bookingSelectRateLimitMax: 10,
  bookingSelectRateLimitWindowMs: 60 * 1000,
};
