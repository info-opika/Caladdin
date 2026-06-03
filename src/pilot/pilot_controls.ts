import { getSupabase } from '../db/client.js';

export const MAX_PILOT_USERS = parseInt(process.env.MAX_PILOT_USERS ?? '25', 10);

export type OperationType = 'calendar_write' | 'new_user_onboard' | 'voice_mutation';

export interface CapacityResult {
  allowed: boolean;
  reason?: 'kill_switch' | 'pilot_full';
  message?: string;
}

export interface OperationResult {
  allowed: boolean;
  reason?: 'kill_switch_active';
  message?: string;
}

export function isKillSwitchActive(): boolean {
  return process.env.CALADDIN_KILL_SWITCH === '1';
}

export async function countPilotUsers(): Promise<number> {
  const { count, error } = await getSupabase()
    .from('users')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function isExistingPilotUser(email: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function checkPilotCapacity(): Promise<CapacityResult> {
  if (isKillSwitchActive()) {
    return {
      allowed: false,
      reason: 'kill_switch',
      message: 'Caladdin is temporarily paused. Please try again later.',
    };
  }

  const count = await countPilotUsers();
  if (count >= MAX_PILOT_USERS) {
    return {
      allowed: false,
      reason: 'pilot_full',
      message: 'The Caladdin pilot is full. Join the waitlist and we will notify you when a spot opens.',
    };
  }

  return { allowed: true };
}

export async function checkOperationAllowed(operation: OperationType): Promise<OperationResult> {
  if (isKillSwitchActive()) {
    return {
      allowed: false,
      reason: 'kill_switch_active',
      message: 'Caladdin is temporarily paused. Calendar operations are unavailable.',
    };
  }

  if (operation === 'new_user_onboard') {
    const cap = await checkPilotCapacity();
    if (!cap.allowed) {
      return {
        allowed: false,
        reason: 'kill_switch_active',
        message: cap.message,
      };
    }
  }

  return { allowed: true };
}
