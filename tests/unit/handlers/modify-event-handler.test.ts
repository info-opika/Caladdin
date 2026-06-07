import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParsedIntentSchema } from '../../../src/core/adts.js';

const mockListEvents = vi.fn();
const mockUpdateEvent = vi.fn();
const mockSyncEvent = vi.fn();
const mockAddInvitees = vi.fn();
const mockRecordLastEvent = vi.fn();
const mockGetEventByGcalId = vi.fn();

vi.mock('../../../src/db/events.js', () => ({
  listEvents: (...a: unknown[]) => mockListEvents(...a),
  updateEvent: (...a: unknown[]) => mockUpdateEvent(...a),
  getEventByGcalId: (...a: unknown[]) => mockGetEventByGcalId(...a),
}));

vi.mock('../../../src/services/calendar_api.js', () => ({
  syncEventToGCal: (...a: unknown[]) => mockSyncEvent(...a),
  addInviteesToGCalEvent: (...a: unknown[]) => mockAddInvitees(...a),
}));

vi.mock('../../../src/db/conversation-context.js', () => ({
  recordLastEvent: (...a: unknown[]) => mockRecordLastEvent(...a),
}));

import { handleModifyEvent } from '../../../src/handlers/modify-event.js';

const ctx = { userId: 'user-1', timezone: 'America/Chicago' };
const cal = {} as import('googleapis').calendar_v3.Calendar;

const baseEvent = {
  id: 'eebb589c-429c-4a36-a7bb-ee2652832aaa',
  userId: 'user-1',
  title: 'Team Standup',
  start: '2026-04-22T15:00:00-05:00',
  end: '2026-04-22T15:30:00-05:00',
  participants: ['team@company.com'],
  tier: 2,
  isRecurring: false,
  status: 'confirmed' as const,
  gcalEventId: 'gcal-standup',
  proposedForSession: null,
  description: null,
};

describe('handleModifyEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListEvents.mockResolvedValue([baseEvent]);
    mockUpdateEvent.mockImplementation(async (_id, patch) => ({ ...baseEvent, ...patch }));
    mockSyncEvent.mockResolvedValue('gcal-standup');
    mockRecordLastEvent.mockResolvedValue(undefined);
    mockAddInvitees.mockResolvedValue({ participants: ['team@company.com', 'alex@example.com'], added: ['alex@example.com'] });
  });

  it('returns not-found when no matching event', async () => {
    mockListEvents.mockResolvedValue([]);
    const parsed = ParsedIntentSchema.parse({
      intent: 'MODIFY_EVENT',
      confidence: 0.9,
      params: { newStart: '2026-04-23T10:00:00-05:00' },
      mappingMethod: 'direct',
      rawUtterance: 'move meeting',
    });
    const result = await handleModifyEvent(parsed, ctx, cal);
    expect(result.success).toBe(false);
    expect(result.messageToUser).toMatch(/could not find/i);
  });

  it('renames event by title match', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'MODIFY_EVENT',
      confidence: 0.9,
      params: { newTitle: 'Daily Sync' },
      mappingMethod: 'direct',
      rawUtterance: 'rename standup to daily sync',
    });
    const result = await handleModifyEvent(parsed, ctx, cal);
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/Renamed/i);
    expect(mockUpdateEvent).toHaveBeenCalledWith(baseEvent.id, { title: 'Daily Sync' });
  });

  it('updates description', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'MODIFY_EVENT',
      confidence: 0.9,
      params: { newDescription: 'Bring notes' },
      mappingMethod: 'direct',
      rawUtterance: 'add description',
    });
    const result = await handleModifyEvent(parsed, ctx, cal);
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/description/i);
  });

  it('reschedules event start time', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'MODIFY_EVENT',
      confidence: 0.9,
      params: { newStart: '2026-04-22T16:00:00-05:00' },
      mappingMethod: 'direct',
      rawUtterance: 'move standup to 4pm',
    });
    const result = await handleModifyEvent(parsed, ctx, cal);
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/Updated/i);
  });

  it('prompts when addInvitees is empty', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'MODIFY_EVENT',
      confidence: 0.9,
      params: { addInvitees: [] },
      mappingMethod: 'direct',
      rawUtterance: 'add invitees to standup',
    });
    const result = await handleModifyEvent(parsed, ctx, cal);
    expect(result.success).toBe(false);
    expect(result.messageToUser).toMatch(/Who should I invite/i);
  });

  it('adds invitees via Google Calendar', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'MODIFY_EVENT',
      confidence: 0.9,
      params: { addInvitees: ['alex@example.com'] },
      mappingMethod: 'direct',
      rawUtterance: 'invite alex@example.com to standup',
    });
    const result = await handleModifyEvent(parsed, ctx, cal);
    expect(result.success).toBe(true);
    expect(mockAddInvitees).toHaveBeenCalledWith(cal, 'gcal-standup', ['alex@example.com']);
  });
});
