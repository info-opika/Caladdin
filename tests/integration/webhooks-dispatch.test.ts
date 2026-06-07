/**
 * Webhook dispatch — HMAC signing and delivery (mocked fetch + DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

const mockListActive = vi.fn();

vi.mock('../../src/db/webhook_subscriptions.js', () => ({
  listActiveWebhooksForEvent: (...a: unknown[]) => mockListActive(...a),
}));

import { signWebhookPayload, dispatchBookingWebhooks } from '../../src/services/webhooks.js';

describe('webhook dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('signWebhookPayload matches HMAC scheme', () => {
    const body = '{"event":"booking.confirmed"}';
    const ts = 1710000000;
    const secret = 'test-secret';
    const sig = signWebhookPayload(secret, ts, body);
    const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(sig).toBe(expected);
  });

  it('returns zero counts when no subscriptions', async () => {
    mockListActive.mockResolvedValue([]);
    const result = await dispatchBookingWebhooks('host-1', 'booking.confirmed', {
      sessionToken: 'tok',
      hostUserId: 'host-1',
    });
    expect(result).toEqual({ delivered: 0, failed: 0 });
  });

  it('delivers POST to each active subscription', async () => {
    mockListActive.mockResolvedValue([
      {
        id: 'wh-1',
        userId: 'host-1',
        url: 'https://hooks.test/caladdin',
        secret: 'sec-1',
        events: ['booking.confirmed'],
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    const result = await dispatchBookingWebhooks('host-1', 'booking.confirmed', {
      sessionToken: 'tok-abc',
      hostUserId: 'host-1',
      guestEmail: 'guest@example.com',
    });
    expect(result.delivered).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://hooks.test/caladdin',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Caladdin-Event': 'booking.confirmed',
        }),
      }),
    );
  });

  it('counts failed delivery on non-2xx', async () => {
    mockListActive.mockResolvedValue([
      {
        id: 'wh-1',
        userId: 'host-1',
        url: 'https://hooks.test/fail',
        secret: 'sec',
        events: ['booking.cancelled'],
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    const result = await dispatchBookingWebhooks('host-1', 'booking.cancelled', {
      sessionToken: 'tok',
      hostUserId: 'host-1',
    });
    expect(result.failed).toBe(1);
  });
});
