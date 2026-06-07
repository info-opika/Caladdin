import { createHmac } from 'crypto';
import { logger } from '../logger.js';
import { listActiveWebhooksForEvent, type WebhookEvent } from '../db/webhook_subscriptions.js';

export interface BookingWebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: {
    sessionToken: string;
    sessionId?: string;
    hostUserId: string;
    guestEmail?: string | null;
    slot?: { start: string; end: string } | null;
  };
}

export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  const signed = `${timestamp}.${body}`;
  return createHmac('sha256', secret).update(signed).digest('hex');
}

export async function dispatchBookingWebhooks(
  hostUserId: string,
  event: WebhookEvent,
  data: BookingWebhookPayload['data'],
): Promise<{ delivered: number; failed: number }> {
  const subscriptions = await listActiveWebhooksForEvent(hostUserId, event);
  if (subscriptions.length === 0) return { delivered: 0, failed: 0 };

  const payload: BookingWebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  let delivered = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      const signature = signWebhookPayload(sub.secret, timestamp, body);
      try {
        const res = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Caladdin-Signature': `t=${timestamp},v1=${signature}`,
            'Caladdin-Event': event,
          },
          body,
        });
        if (res.ok) {
          delivered += 1;
        } else {
          failed += 1;
          logger.warn('Webhook delivery failed', { url: sub.url, status: res.status, event });
        }
      } catch (err) {
        failed += 1;
        logger.warn('Webhook delivery error', { url: sub.url, event, error: String(err) });
      }
    }),
  );

  return { delivered, failed };
}
