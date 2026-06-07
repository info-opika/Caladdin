import { describe, it, expect } from 'vitest';
import {
  safeTimezone,
  safeGCalCall,
  getUserFacingErrorMessage,
  createGracefulFailureResult,
} from '../../src/core/graceful-failure.js';

describe('graceful-failure', () => {
  it('safeTimezone falls back for invalid zones', () => {
    expect(safeTimezone('America/Chicago')).toBe('America/Chicago');
    expect(safeTimezone('Not/AZone')).toBe('America/Chicago');
    expect(safeTimezone(null)).toBe('America/Chicago');
  });

  it('safeGCalCall returns fallback on error', async () => {
    const result = await safeGCalCall('test', async () => {
      throw new Error('boom');
    }, []);
    expect(result).toEqual([]);
  });

  it('getUserFacingErrorMessage maps token errors', () => {
    expect(getUserFacingErrorMessage(new Error('invalid_grant'))).toMatch(/sign in again/i);
    expect(getUserFacingErrorMessage(new Error('rate limit'))).toMatch(/busy right now/i);
  });

  it('createGracefulFailureResult builds intent result', () => {
    const r = createGracefulFailureResult('QUERY_CALENDAR', 'Custom');
    expect(r.success).toBe(false);
    expect(r.messageToUser).toBe('Custom');
  });
});
