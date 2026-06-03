import { calendar_v3 } from 'googleapis';
import { logger } from '../logger.js';

const VALID_TZ = new Set(Intl.supportedValuesOf('timeZone'));

export function safeTimezone(tz: string | null | undefined, fallback = 'America/Chicago'): string {
  if (!tz || !tz.trim()) return fallback;
  try {
    if (VALID_TZ.has(tz)) return tz;
  } catch {
    // Intl.supportedValuesOf may be unavailable in older runtimes
    if (/^[A-Za-z_]+\/[A-Za-z_]+$/.test(tz)) return tz;
  }
  return fallback;
}

export async function safeGCalCall<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    logger.warn(`GCal call failed: ${label}`, { error: String(e) });
    return fallback;
  }
}

export function getUserFacingErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid_grant|token/i.test(msg)) {
    return 'Your calendar connection expired. Please sign in again.';
  }
  if (/quota|rate/i.test(msg)) {
    return 'Google Calendar is busy right now. Try again in a minute.';
  }
  return 'Something went wrong with your calendar. Please try again.';
}

export function createGracefulFailureResult(intent: string, message?: string) {
  return {
    intent,
    success: false,
    requiresConfirmation: false,
    messageToUser: message ?? getUserFacingErrorMessage(new Error('unknown')),
    schemaVersion: 1,
  };
}

export type GCalClient = calendar_v3.Calendar;
