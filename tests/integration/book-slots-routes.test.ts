import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPublicLookup = vi.fn();
const mockEnsurePolicy = vi.fn();
const mockGenerateSlots = vi.fn();
const mockPickHost = vi.fn();
const mockGetOAuth = vi.fn();

vi.mock('../../src/db/event_types.js', () => ({
  getPublicEventTypeByUsernameSlug: (...a: unknown[]) => mockPublicLookup(...a),
}));

vi.mock('../../src/db/event_type_members.js', () => ({
  pickRoundRobinHost: (...a: unknown[]) => mockPickHost(...a),
}));

vi.mock('../../src/db/users.js', () => ({
  ensureDefaultPolicy: (...a: unknown[]) => mockEnsurePolicy(...a),
}));

vi.mock('../../src/core/slot-scoring.js', () => ({
  generatePublicBookingSlots: (...a: unknown[]) => mockGenerateSlots(...a),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: (...a: unknown[]) => mockGetOAuth(...a),
}));

vi.mock('googleapis', () => ({
  google: { calendar: vi.fn(() => ({})) },
}));

import { bookPublicRouter } from '../../src/routes/book_public.js';

function app() {
  const x = express();
  x.use('/book', bookPublicRouter);
  return x;
}

const sampleEventType = {
  id: 'et-slots',
  userId: 'owner-1',
  name: 'Demo',
  slug: 'demo',
  durationMinutes: 30,
  description: null,
  availabilityRules: { minimumNoticeMinutes: 60, bufferMinutes: 10 },
  schedulingMode: 'single' as const,
  active: true,
  createdAt: '2026-06-07T00:00:00.000Z',
  updatedAt: '2026-06-07T00:00:00.000Z',
};

describe('book public slots route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublicLookup.mockResolvedValue({
      eventType: sampleEventType,
      hostName: 'Owner',
      hostTimezone: 'America/Chicago',
    });
    mockEnsurePolicy.mockResolvedValue({
      userId: 'owner-1',
      timezone: 'America/Chicago',
      workingHoursStart: '09:00',
      workingHoursEnd: '17:00',
      protectedBlocks: [],
    });
    mockGetOAuth.mockResolvedValue(null);
    mockGenerateSlots.mockResolvedValue([
      { start: '2026-06-10T15:00:00.000Z', end: '2026-06-10T15:30:00.000Z' },
    ]);
  });

  it('GET /book/:username/:slug/slots returns generated slots', async () => {
    const res = await request(app()).get('/book/host/demo/slots');
    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(1);
    expect(mockGenerateSlots).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ timezone: 'America/Chicago' }),
      30,
      14,
      expect.objectContaining({ availabilityRules: sampleEventType.availabilityRules }),
    );
  });

  it('uses round-robin host when scheduling mode is round_robin', async () => {
    mockPublicLookup.mockResolvedValueOnce({
      eventType: { ...sampleEventType, schedulingMode: 'round_robin' },
      hostName: 'Team',
      hostTimezone: 'UTC',
    });
    mockPickHost.mockResolvedValueOnce('member-2');

    const res = await request(app()).get('/book/team/demo/slots');
    expect(res.status).toBe(200);
    expect(res.body.hostUserId).toBe('member-2');
    expect(mockPickHost).toHaveBeenCalledWith('et-slots', 'owner-1');
    expect(mockGenerateSlots.mock.calls[0]?.[0]).toBe('member-2');
  });
});
