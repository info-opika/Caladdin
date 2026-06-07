/**
 * Pilot controls — capacity, existing-user bypass, and operation gating (mocked Supabase).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCount = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('../../src/db/client.js', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count === 'exact' && opts?.head) {
              return Promise.resolve({ count: mockCount(), error: null });
            }
            return {
              eq: (_col: string, email: string) => ({
                maybeSingle: () => mockMaybeSingle(email),
              }),
            };
          },
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    },
  }),
}));

import {
  MAX_PILOT_USERS,
  checkPilotCapacity,
  isExistingPilotUser,
  checkOperationAllowed,
  countPilotUsers,
} from '../../src/pilot/pilot_controls.js';

describe('pilot controls — capacity (mocked DB)', () => {
  const originalKill = process.env.CALADDIN_KILL_SWITCH;
  const originalMax = process.env.MAX_PILOT_USERS;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CALADDIN_KILL_SWITCH;
    delete process.env.MAX_PILOT_USERS;
    mockCount.mockReturnValue(0);
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    if (originalKill !== undefined) process.env.CALADDIN_KILL_SWITCH = originalKill;
    else delete process.env.CALADDIN_KILL_SWITCH;
    if (originalMax !== undefined) process.env.MAX_PILOT_USERS = originalMax;
    else delete process.env.MAX_PILOT_USERS;
  });

  it('countPilotUsers returns Supabase count', async () => {
    mockCount.mockReturnValue(12);
    await expect(countPilotUsers()).resolves.toBe(12);
  });

  it('countPilotUsers treats null count as 0', async () => {
    mockCount.mockReturnValue(0);
    await expect(countPilotUsers()).resolves.toBe(0);
  });

  it('isExistingPilotUser normalizes email to lowercase', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'u1' }, error: null });
    const exists = await isExistingPilotUser('User@Example.COM');
    expect(exists).toBe(true);
    expect(mockMaybeSingle).toHaveBeenCalledWith('user@example.com');
  });

  it('isExistingPilotUser returns false when no row', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(isExistingPilotUser('new@example.com')).resolves.toBe(false);
  });

  it('checkPilotCapacity allows when under MAX_PILOT_USERS', async () => {
    mockCount.mockReturnValue(MAX_PILOT_USERS - 1);
    const cap = await checkPilotCapacity();
    expect(cap).toEqual({ allowed: true });
  });

  it('checkPilotCapacity blocks with pilot_full at capacity', async () => {
    mockCount.mockReturnValue(MAX_PILOT_USERS);
    const cap = await checkPilotCapacity();
    expect(cap.allowed).toBe(false);
    if (!cap.allowed) {
      expect(cap.reason).toBe('pilot_full');
      expect(cap.message).toMatch(/waitlist/i);
    }
  });

  it('checkPilotCapacity blocks with pilot_full above capacity', async () => {
    mockCount.mockReturnValue(MAX_PILOT_USERS + 5);
    const cap = await checkPilotCapacity();
    expect(cap.allowed).toBe(false);
    if (!cap.allowed) expect(cap.reason).toBe('pilot_full');
  });

  it('checkPilotCapacity respects custom MAX_PILOT_USERS env', async () => {
    process.env.MAX_PILOT_USERS = '3';
    vi.resetModules();
    const mod = await import('../../src/pilot/pilot_controls.js');
    mockCount.mockReturnValue(3);
    const cap = await mod.checkPilotCapacity();
    expect(cap.allowed).toBe(false);
    if (!cap.allowed) expect(cap.reason).toBe('pilot_full');
  });

  it('checkOperationAllowed allows voice_mutation when pilot not full', async () => {
    mockCount.mockReturnValue(0);
    const result = await checkOperationAllowed('voice_mutation');
    expect(result).toEqual({ allowed: true });
  });

  it('checkOperationAllowed blocks new_user_onboard when pilot full', async () => {
    mockCount.mockReturnValue(MAX_PILOT_USERS);
    const result = await checkOperationAllowed('new_user_onboard');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('pilot_full');
      expect(result.message).toMatch(/waitlist/i);
    }
  });

  it('checkOperationAllowed does not check capacity for calendar_write', async () => {
    mockCount.mockReturnValue(MAX_PILOT_USERS);
    const result = await checkOperationAllowed('calendar_write');
    expect(result).toEqual({ allowed: true });
  });

  it('checkOperationAllowed blocks all ops when kill switch active', async () => {
    process.env.CALADDIN_KILL_SWITCH = '1';
    const result = await checkOperationAllowed('calendar_write');
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('kill_switch_active');
  });
});
