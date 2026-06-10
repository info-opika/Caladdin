import { logger } from '../logger.js';
import { getSupabase } from '../db/client.js';
import { config } from '../config.js';

export type SystemMode =
  | 'FULL'
  | 'DEGRADED_LLM'
  | 'DEGRADED_DB'
  | 'DEGRADED_CALENDAR'
  | 'SAFE_MODE';

export const MODE_RULES: Record<SystemMode, { description: string; allowMutations: boolean; useLLM: boolean }> = {
  FULL: { description: 'All systems operational.', allowMutations: true, useLLM: true },
  DEGRADED_LLM: { description: 'LLM unavailable — falling back to keyword parser.', allowMutations: true, useLLM: false },
  DEGRADED_DB: { description: 'Database unavailable — read-only mode.', allowMutations: false, useLLM: true },
  DEGRADED_CALENDAR: { description: 'Google Calendar API unavailable — local-only mode.', allowMutations: true, useLLM: true },
  SAFE_MODE: { description: 'Multiple subsystems down — confirmations only.', allowMutations: false, useLLM: false },
};

async function pingDB(): Promise<boolean> {
  try {
    const { error } = await getSupabase().from('users').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

function pingLLM(): boolean {
  return Boolean(config.anthropicApiKey && config.anthropicApiKey.length > 10);
}

function pingCalendar(): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

/** Resolves current system mode without live Anthropic ping (env + DB health only). */
export async function resolveSystemMode(): Promise<SystemMode> {
  const [llmOk, dbOk, calOk] = await Promise.all([
    Promise.resolve(pingLLM()),
    pingDB(),
    Promise.resolve(pingCalendar()),
  ]);

  let mode: SystemMode;
  if (llmOk && dbOk && calOk) mode = 'FULL';
  else if (!llmOk && !dbOk) mode = 'SAFE_MODE';
  else if (!dbOk) mode = 'DEGRADED_DB';
  else if (!llmOk) mode = 'DEGRADED_LLM';
  else mode = 'DEGRADED_CALENDAR';

  logger.info({ mode, llmOk, dbOk, calOk }, 'System mode resolved');
  return mode;
}
