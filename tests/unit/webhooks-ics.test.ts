import { describe, it, expect } from 'vitest';
import { signWebhookPayload } from '../../src/services/webhooks.js';
import { buildIcsCalendar } from '../../src/services/ics.js';

describe('webhook HMAC signing', () => {
  it('produces stable sha256 hex for payload body', () => {
    const body = JSON.stringify({ event: 'booking.confirmed', data: { sessionToken: 'abc' } });
    const sig1 = signWebhookPayload('test-secret-key-123456', 1710000000, body);
    const sig2 = signWebhookPayload('test-secret-key-123456', 1710000000, body);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes signature when timestamp or secret changes', () => {
    const body = '{"event":"booking.cancelled"}';
    const a = signWebhookPayload('secret-a-123456789012', 1, body);
    const b = signWebhookPayload('secret-b-123456789012', 1, body);
    const c = signWebhookPayload('secret-a-123456789012', 2, body);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('ICS calendar feed', () => {
  it('builds valid VCALENDAR with events', () => {
    const ics = buildIcsCalendar([
      {
        uid: 'test@caladdin.app',
        summary: 'Intro call',
        start: '2026-06-10T15:00:00.000Z',
        end: '2026-06-10T15:30:00.000Z',
      },
    ]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Intro call');
    expect(ics).toContain('END:VCALENDAR');
  });
});
