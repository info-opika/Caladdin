import { getSupabase } from './client.js';

export async function saveGoogleTokens(userId: string, tokens: {
  access_token: string;
  refresh_token?: string | null;
  expiry?: Date | null;
}): Promise<void> {
  const { error } = await getSupabase().from('google_tokens').upsert({
    user_id: userId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry: tokens.expiry?.toISOString() ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function getGoogleTokens(userId: string): Promise<{
  access_token: string;
  refresh_token: string | null;
  expiry: string | null;
} | null> {
  const { data, error } = await getSupabase().from('google_tokens').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
