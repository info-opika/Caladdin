import { expireOpenSessions } from '../db/scheduling_sessions.js';
import { logger } from '../logger.js';

export async function runSessionExpiry(): Promise<number> {
  const count = await expireOpenSessions();
  if (count > 0) {
    logger.info('Expired open scheduling sessions', { count });
  }
  return count;
}

export function startSessionExpiryWorker(intervalMs = 15 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    runSessionExpiry().catch((e) => logger.error('Session expiry job error', { error: String(e) }));
  }, intervalMs);
}
