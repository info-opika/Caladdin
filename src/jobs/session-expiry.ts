import { expireOpenSessions } from '../db/scheduling_sessions.js';
import { expireStaleInviteGrants } from '../db/invite_calendar_grants.js';
import { logger } from '../logger.js';

export async function runSessionExpiry(): Promise<{ sessions: number; grants: number }> {
  const sessions = await expireOpenSessions();
  if (sessions > 0) {
    logger.info('Expired open scheduling sessions', { count: sessions });
  }
  const grants = await expireStaleInviteGrants();
  if (grants > 0) {
    logger.info('Expired or revoked invite calendar grants', { count: grants });
  }
  return { sessions, grants };
}

export function startSessionExpiryWorker(intervalMs = 15 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    runSessionExpiry().catch((e) => logger.error('Session expiry job error', { error: String(e) }));
  }, intervalMs);
}
