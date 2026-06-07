import { createHash } from 'crypto';
import { getSupabase } from './client.js';

export interface AuthSessionRow {
  token_hash: string;
  user_id: string;
  email: string;
  created_at: string;
  expires_at: string;
}

const memoryStore = new Map<string, AuthSessionRow>();

function useMemoryStore(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function insertAuthSession(row: Omit<AuthSessionRow, 'created_at'>): Promise<void> {
  if (useMemoryStore()) {
    memoryStore.set(row.token_hash, {
      ...row,
      created_at: new Date().toISOString(),
    });
    return;
  }

  const { error } = await getSupabase().from('sessions').insert({
    token_hash: row.token_hash,
    user_id: row.user_id,
    email: row.email,
    expires_at: row.expires_at,
  });
  if (error) throw new Error(`Failed to insert session: ${error.message}`);
}

export async function getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRow | null> {
  if (useMemoryStore()) {
    return memoryStore.get(tokenHash) ?? null;
  }

  const { data, error } = await getSupabase()
    .from('sessions')
    .select('token_hash, user_id, email, created_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) throw new Error(`Failed to load session: ${error.message}`);
  return data as AuthSessionRow | null;
}

export async function deleteAuthSessionByTokenHash(tokenHash: string): Promise<void> {
  if (useMemoryStore()) {
    memoryStore.delete(tokenHash);
    return;
  }

  const { error } = await getSupabase().from('sessions').delete().eq('token_hash', tokenHash);
  if (error) throw new Error(`Failed to delete session: ${error.message}`);
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  if (useMemoryStore()) {
    for (const [hash, row] of memoryStore.entries()) {
      if (row.user_id === userId) memoryStore.delete(hash);
    }
    return;
  }

  const { error } = await getSupabase().from('sessions').delete().eq('user_id', userId);
  if (error) throw new Error(`Failed to delete user sessions: ${error.message}`);
}

/** Test helper — simulates shared store across processes in unit tests. */
export function resetAuthSessionsForTests(): void {
  memoryStore.clear();
}
