import { getSupabase } from './client.js';
import { hashPayload } from './audit.js';
import { config } from '../config.js';

export interface PendingConfirmation {
  id: string;
  token: string;
  user_id: string;
  intent: string;
  payload: Record<string, unknown>;
  payload_hash: string | null;
  status: string;
  expires_at: string;
}

export async function insertPendingConfirmation(entry: {
  userId: string;
  intent: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const expiresAt = new Date(Date.now() + config.confirmExpiryMinutes * 60 * 1000).toISOString();
  const payloadHash = hashPayload(entry.payload);
  const { data, error } = await getSupabase()
    .from('pending_confirmations')
    .insert({
      user_id: entry.userId,
      intent: entry.intent,
      payload: entry.payload,
      payload_hash: payloadHash,
      expires_at: expiresAt,
      status: 'pending',
    })
    .select('token')
    .single();
  if (error) throw error;
  return data.token as string;
}

export async function getPendingConfirmation(token: string): Promise<PendingConfirmation | null> {
  const { data, error } = await getSupabase()
    .from('pending_confirmations')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  return data as PendingConfirmation | null;
}

export async function updateConfirmationStatus(token: string, status: string): Promise<void> {
  const { error } = await getSupabase()
    .from('pending_confirmations')
    .update({ status })
    .eq('token', token);
  if (error) throw error;
}

export async function expireStaleConfirmations(): Promise<void> {
  const { error } = await getSupabase()
    .from('pending_confirmations')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
}
