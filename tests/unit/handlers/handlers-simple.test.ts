/**
 * Unit tests for lightweight src/handlers/* (gatekeep, shape-rules, resolve-manual, undo, pivot-async).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParsedIntentSchema, type UserPolicyProfile } from '../../../src/core/adts.js';

const mockEnsurePolicy = vi.fn();
const mockUpsertPolicy = vi.fn();
const mockInsertFailure = vi.fn();
const mockGetLastAudit = vi.fn();
const mockUpdateEvent = vi.fn();
vi.mock('../../../src/db/users.js', () => ({
  ensureDefaultPolicy: (...a: unknown[]) => mockEnsurePolicy(...a),
  upsertPolicy: (...a: unknown[]) => mockUpsertPolicy(...a),
}));

vi.mock('../../../src/db/failures.js', () => ({
  insertFailureLog: (...a: unknown[]) => mockInsertFailure(...a),
}));

vi.mock('../../../src/db/audit.js', () => ({
  getLastAuditForUser: (...a: unknown[]) => mockGetLastAudit(...a),
}));

vi.mock('../../../src/db/events.js', () => ({
  updateEvent: (...a: unknown[]) => mockUpdateEvent(...a),
}));

import { handleGatekeepRule } from '../../../src/handlers/gatekeep-rule.js';
import { handleShapeRules } from '../../../src/handlers/shape-rules.js';
import { handleResolveManual } from '../../../src/handlers/resolve-manual.js';
import { handleUndo } from '../../../src/handlers/undo.js';

const ctx = { userId: 'user-1', timezone: 'America/Chicago', requestId: 'req-1' };

const BASE_POLICY: UserPolicyProfile = {
  userId: 'user-1',
  schemaVersion: 1,
  timezone: 'America/Chicago',
  chronotype: 'morning',
  defaultBufferMinutes: 15,
  clusteringPreference: 'balanced',
  maxFragmentsPerDay: 4,
  faxEffectConfig: {
    targetSlotsPerOffer: 2,
    minBufferMinutes: 15,
    clusteringWeight: 0.35,
    energyWeight: 0.45,
    fragmentPenaltyWeight: 0.15,
    protectDeepWorkBlocks: true,
  },
  protectedBlocks: [],
  contactTiers: {},
  gatekeepRules: [],
  shapeRules: {},
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
};

function parsed(intent: string, params: Record<string, unknown> = {}, raw = 'test') {
  return ParsedIntentSchema.parse({
    intent,
    confidence: 0.9,
    params,
    mappingMethod: 'direct',
    rawUtterance: raw,
  });
}

describe('handleGatekeepRule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsurePolicy.mockResolvedValue({ ...BASE_POLICY, gatekeepRules: [] });
    mockUpsertPolicy.mockResolvedValue(undefined);
  });

  it('adds new contact tier rule', async () => {
    const result = await handleGatekeepRule(
      parsed('GATEKEEP_RULE', { contact: 'vip@corp.com', tier: 1 }),
      ctx,
      null,
    );
    expect(result.success).toBe(true);
    expect(result.messageToUser).toMatch(/tier 1/i);
    expect(mockUpsertPolicy).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        gatekeepRules: [{ contact: 'vip@corp.com', tier: 1 }],
      }),
    );
  });

  it('updates existing contact tier', async () => {
    mockEnsurePolicy.mockResolvedValue({
      ...BASE_POLICY,
      gatekeepRules: [{ contact: 'vip@corp.com', tier: 2 }],
    });
    await handleGatekeepRule(parsed('GATEKEEP_RULE', { contact: 'vip@corp.com', tier: 0 }), ctx, null);
    expect(mockUpsertPolicy).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        gatekeepRules: [{ contact: 'vip@corp.com', tier: 0 }],
      }),
    );
  });

  it('infers tier from tierLabel', async () => {
    await handleGatekeepRule(
      parsed('GATEKEEP_RULE', { contact: 'a@b.com', tierLabel: 'sacred priority' }),
      ctx,
      null,
    );
    expect(mockUpsertPolicy).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ gatekeepRules: [{ contact: 'a@b.com', tier: 0 }] }),
    );
  });
});

describe('handleShapeRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsurePolicy.mockResolvedValue({ ...BASE_POLICY, shapeRules: { bufferMinutes: 10 } });
    mockUpsertPolicy.mockResolvedValue(undefined);
  });

  it('merges shape rules and working hours', async () => {
    const result = await handleShapeRules(
      parsed('SHAPE_RULES', {
        bufferMinutes: 20,
        noMeetingsBefore: '10:00',
      }),
      ctx,
      null,
    );
    expect(result.success).toBe(true);
    expect(mockUpsertPolicy).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        workingHoursStart: '10:00',
        shapeRules: expect.objectContaining({ bufferMinutes: 20 }),
      }),
    );
  });
});

describe('handleResolveManual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertFailure.mockResolvedValue(undefined);
  });

  it('logs failure and returns resolve message', async () => {
    const result = await handleResolveManual(
      parsed('RESOLVE_MANUAL', {}, 'help me with taxes'),
      ctx,
      null,
    );
    expect(result.success).toBe(true);
    expect(mockInsertFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        rawUtterance: 'help me with taxes',
        failureReason: 'resolve_manual',
        requestId: 'req-1',
      }),
    );
  });
});

describe('handleUndo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateEvent.mockResolvedValue({});
  });

  it('returns message when nothing to undo', async () => {
    mockGetLastAudit.mockResolvedValue(null);
    const result = await handleUndo(parsed('UNDO'), ctx, null);
    expect(result.success).toBe(false);
    expect(result.messageToUser).toMatch(/Nothing recent/i);
  });

  it('rejects undo outside window', async () => {
    mockGetLastAudit.mockResolvedValue({
      intent: 'CREATE_EVENT',
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const result = await handleUndo(parsed('UNDO'), ctx, null);
    expect(result.success).toBe(false);
    expect(result.messageToUser).toMatch(/within \d+ minutes/i);
  });

  it('rejects non-undoable intents', async () => {
    mockGetLastAudit.mockResolvedValue({
      intent: 'OFFER_SPECIFIC',
      created_at: new Date().toISOString(),
    });
    const result = await handleUndo(parsed('UNDO'), ctx, null);
    expect(result.success).toBe(false);
    expect(result.messageToUser).toMatch(/cannot be undone/i);
  });

  it('restores previous event snapshot', async () => {
    mockGetLastAudit.mockResolvedValue({
      intent: 'MODIFY_EVENT',
      created_at: new Date().toISOString(),
      previous_state: { eventId: 'ev-1', snapshot: { title: 'Old title' } },
    });
    const result = await handleUndo(parsed('UNDO'), ctx, null);
    expect(result.success).toBe(true);
    expect(mockUpdateEvent).toHaveBeenCalledWith('ev-1', { title: 'Old title' });
  });
});


