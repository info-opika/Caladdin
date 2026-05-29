import { pollCompensationBatch, markCompensationAttempt, deleteCompensation } from '../db/compensation_queue.js';
import { getOAuthClientForUser } from '../services/auth_service.js';
import { syncEventToGCal } from '../services/calendar_api.js';
import { getEventById } from '../db/events.js';
import { logger } from '../logger.js';

export async function runCompensationWorker(): Promise<number> {
  const batch = await pollCompensationBatch(10);
  let processed = 0;

  for (const item of batch) {
    const userId = item.user_id as string;
    const payload = item.payload as { eventId?: string; event?: Record<string, unknown> };
    const cal = await getOAuthClientForUser(userId);
    if (!cal) {
      await markCompensationAttempt(item.id as string, (item.attempts as number) + 1);
      continue;
    }

    try {
      if (payload.eventId) {
        const event = await getEventById(payload.eventId);
        if (event) {
          await syncEventToGCal(cal, userId, event, 'create');
        }
      }
      await deleteCompensation(item.id as string);
      processed++;
    } catch (e) {
      logger.warn('Compensation retry failed', { id: item.id, error: String(e) });
      await markCompensationAttempt(item.id as string, (item.attempts as number) + 1);
    }
  }

  return processed;
}

export function startCompensationWorker(intervalMs = 60000): NodeJS.Timeout {
  return setInterval(() => {
    runCompensationWorker().catch((e) => logger.error('Compensation worker error', { error: String(e) }));
  }, intervalMs);
}
