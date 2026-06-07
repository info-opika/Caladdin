import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateGuestIntake,
  upsertBookingResponse,
  getBookingResponseForSession,
  resetBookingResponsesForTests,
} from '../../src/db/booking_responses.js';

describe('booking responses db', () => {
  beforeEach(() => {
    resetBookingResponsesForTests();
  });

  it('validates required guest fields', () => {
    expect(validateGuestIntake(undefined)).toBe('name_required');
    expect(validateGuestIntake({ name: '', email: 'a@b.com' })).toBe('name_required');
    expect(validateGuestIntake({ name: 'Ada', email: '' })).toBe('email_required');
    expect(validateGuestIntake({ name: 'Ada', email: 'not-an-email' })).toBe('email_invalid');
    expect(validateGuestIntake({ name: 'Ada', email: 'ada@example.com' })).toBeNull();
  });

  it('stores and retrieves guest intake for a session', async () => {
    const saved = await upsertBookingResponse({
      sessionId: 'sess-1',
      guest: {
        name: 'Ada Lovelace',
        email: 'Ada@Example.COM',
        notes: 'Looking forward',
        answers: { role: 'engineer' },
      },
    });

    expect(saved.guestName).toBe('Ada Lovelace');
    expect(saved.guestEmail).toBe('ada@example.com');
    expect(saved.notes).toBe('Looking forward');
    expect(saved.answers).toEqual({ role: 'engineer' });

    const loaded = await getBookingResponseForSession('host-1', 'sess-1');
    expect(loaded?.guestEmail).toBe('ada@example.com');
  });
});
