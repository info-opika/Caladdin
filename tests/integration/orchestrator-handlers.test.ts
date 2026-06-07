import { describe, it, expect, vi, beforeEach } from 'vitest';
import { orchestrate } from '../../src/core/orchestrator.js';
import { ParsedIntentSchema } from '../../src/core/adts.js';

const mockCreate = vi.fn();
const mockRecordLast = vi.fn();
const mockInsertAudit = vi.fn();

vi.mock('../../src/db/users.js', () => ({
  ensureDefaultPolicy: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    protectedBlocks: [],
    shapeRules: {},
    gatekeepRules: [],
    timezone: 'America/Chicago',
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
  }),
  upsertPolicy: vi.fn(),
  getPolicy: vi.fn(),
}));

vi.mock('../../src/services/calendar_api.js', () => ({
  createEventWithSync: (...a: unknown[]) => mockCreate(...a),
  listEventsFromGCalSafe: vi.fn().mockResolvedValue({ events: [] }),
}));

vi.mock('../../src/db/conversation-context.js', () => ({
  recordLastEvent: (...a: unknown[]) => mockRecordLast(...a),
}));

vi.mock('../../src/db/audit.js', () => ({
  insertAuditLog: (...a: unknown[]) => mockInsertAudit(...a),
}));

vi.mock('../../src/db/confirmations.js', () => ({
  insertPendingConfirmation: vi.fn().mockResolvedValue('tok'),
}));

vi.mock('../../src/services/notifications.js', () => ({
  sendConfirmationRequest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/failures.js', () => ({
  insertFailureLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/auth_service.js', () => ({
  getOAuthClientForUser: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/pilot/pilot_controls.js', () => ({
  checkOperationAllowed: vi.fn().mockResolvedValue({ allowed: true }),
}));

const ctx = { userId: 'user-int-1', requestId: 'req-int-1' };

describe('orchestrator handler integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      id: 'ev-int',
      title: 'Lunch',
      start: '2026-06-10T12:00:00.000Z',
      end: '2026-06-10T13:00:00.000Z',
      gcalEventId: 'gcal-int',
      participants: [],
    });
    mockRecordLast.mockResolvedValue(undefined);
    mockInsertAudit.mockResolvedValue(undefined);
  });

  it('CREATE_EVENT runs real handler end-to-end', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'CREATE_EVENT',
      confidence: 0.95,
      params: { title: 'Lunch', start: '2026-06-10T12:00:00.000Z', end: '2026-06-10T13:00:00.000Z' },
      mappingMethod: 'direct',
      rawUtterance: 'schedule lunch',
    });
    const result = await orchestrate(parsed, ctx);
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/Lunch/i);
    expect(mockCreate).toHaveBeenCalled();
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'CREATE_EVENT', outcome: 'success' }),
    );
  });

  it('RESOLVE_MANUAL runs real handler', async () => {
    const parsed = ParsedIntentSchema.parse({
      intent: 'RESOLVE_MANUAL',
      confidence: 0.5,
      params: {},
      mappingMethod: 'direct',
      rawUtterance: 'tell me a joke',
    });
    const result = await orchestrate(parsed, ctx);
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/calendar|scheduling/i);
  });
});
