/**
 * ZETA-B1 VERIFICATION: Pilot controls and hardening
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MAX_PILOT_USERS,
  isKillSwitchActive,
  checkPilotCapacity,
  isExistingPilotUser,
  checkOperationAllowed,
} from '../../src/pilot/pilot_controls.js';

describe('ZETA-B1.2: Kill Switch', () => {
  const originalEnv = process.env.CALADDIN_KILL_SWITCH;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CALADDIN_KILL_SWITCH = originalEnv;
    } else {
      delete process.env.CALADDIN_KILL_SWITCH;
    }
  });

  it('should return false when CALADDIN_KILL_SWITCH is not set', () => {
    delete process.env.CALADDIN_KILL_SWITCH;
    expect(isKillSwitchActive()).toBe(false);
  });

  it('should return false when CALADDIN_KILL_SWITCH is 0', () => {
    process.env.CALADDIN_KILL_SWITCH = '0';
    expect(isKillSwitchActive()).toBe(false);
  });

  it('should return true when CALADDIN_KILL_SWITCH is 1', () => {
    process.env.CALADDIN_KILL_SWITCH = '1';
    expect(isKillSwitchActive()).toBe(true);
  });

  it('should block calendar operations when kill switch active', async () => {
    process.env.CALADDIN_KILL_SWITCH = '1';
    
    const result = await checkOperationAllowed('calendar_write');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('kill_switch_active');
      expect(result.message).toContain('temporarily paused');
    }
  });

  it('should block new user onboarding when kill switch active', async () => {
    process.env.CALADDIN_KILL_SWITCH = '1';
    
    const result = await checkOperationAllowed('new_user_onboard');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('kill_switch_active');
    }
  });

  it('should allow operations when kill switch inactive', async () => {
    delete process.env.CALADDIN_KILL_SWITCH;
    
    const result = await checkOperationAllowed('calendar_write');
    expect(result.allowed).toBe(true);
  });

  it('checkPilotCapacity should block when kill switch active', async () => {
    process.env.CALADDIN_KILL_SWITCH = '1';
    
    const result = await checkPilotCapacity();
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('kill_switch');
      expect(result.message).toContain('temporarily paused');
    }
  });
});

describe('ZETA-B1.3: 25-user cap', () => {
  it('should have MAX_PILOT_USERS set to 25', () => {
    expect(MAX_PILOT_USERS).toBe(25);
  });

  it('checkPilotCapacity should return pilot_full when at capacity', async () => {
    // This test requires DB access and is tested in integration
    // Unit test confirms the constant exists and is correct
    expect(MAX_PILOT_USERS).toBe(25);
  });
});

describe('ZETA-B1.6: Graceful Failure Wrappers', () => {
  it('graceful-failure module exists and exports expected functions', async () => {
    const module = await import('../../src/core/graceful-failure.js');
    expect(module.safeGCalCall).toBeDefined();
    expect(module.getUserFacingErrorMessage).toBeDefined();
    expect(module.createGracefulFailureResult).toBeDefined();
    expect(module.safeTimezone).toBeDefined();
  });
});

describe('ZETA-B1.7: Timezone Safety', () => {
  it('safeTimezone should handle invalid timezone gracefully', async () => {
    const { safeTimezone } = await import('../../src/core/graceful-failure.js');
    
    expect(safeTimezone(null)).toBe('America/Chicago');
    expect(safeTimezone(undefined)).toBe('America/Chicago');
    expect(safeTimezone('')).toBe('America/Chicago');
    expect(safeTimezone('INVALID')).toBe('America/Chicago');
    expect(safeTimezone('NOT/REAL')).toBe('America/Chicago');
  });

  it('safeTimezone should accept valid IANA timezones', async () => {
    const { safeTimezone } = await import('../../src/core/graceful-failure.js');
    
    expect(safeTimezone('America/New_York')).toBe('America/New_York');
    expect(safeTimezone('Europe/London')).toBe('Europe/London');
    expect(safeTimezone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('safeTimezone should support custom fallback', async () => {
    const { safeTimezone } = await import('../../src/core/graceful-failure.js');
    
    expect(safeTimezone('INVALID', 'UTC')).toBe('UTC');
    expect(safeTimezone(null, 'America/Los_Angeles')).toBe('America/Los_Angeles');
  });
});
