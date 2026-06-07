import { randomBytes } from 'crypto';
import { getSupabase, setUserContext } from './client.js';

export type WebhookEvent = 'booking.confirmed' | 'booking.cancelled';

export interface WebhookSubscription {
  id: string;
  userId: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WebhookRow {
  id: string;
  user_id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToSubscription(row: WebhookRow): WebhookSubscription {
  return {
    id: row.id,
    userId: row.user_id,
    url: row.url,
    secret: row.secret,
    events: (row.events ?? []) as WebhookEvent[],
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function generateWebhookSecret(): string {
  return randomBytes(24).toString('hex');
}

export async function listWebhookSubscriptions(userId: string): Promise<WebhookSubscription[]> {
  const db = await setUserContext(userId);
  const { data, error } = await db
    .from('webhook_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => rowToSubscription(row as WebhookRow));
}

export async function createWebhookSubscription(
  userId: string,
  input: { url: string; events: WebhookEvent[]; secret?: string },
): Promise<WebhookSubscription> {
  const db = await setUserContext(userId);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('webhook_subscriptions')
    .insert({
      user_id: userId,
      url: input.url,
      secret: input.secret ?? generateWebhookSecret(),
      events: input.events,
      active: true,
      updated_at: now,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToSubscription(data as WebhookRow);
}

export async function updateWebhookSubscription(
  userId: string,
  id: string,
  patch: { url?: string; events?: WebhookEvent[]; active?: boolean },
): Promise<WebhookSubscription | null> {
  const db = await setUserContext(userId);
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.url !== undefined) row.url = patch.url;
  if (patch.events !== undefined) row.events = patch.events;
  if (patch.active !== undefined) row.active = patch.active;

  const { data, error } = await db
    .from('webhook_subscriptions')
    .update(row)
    .eq('user_id', userId)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? rowToSubscription(data as WebhookRow) : null;
}

export async function deleteWebhookSubscription(userId: string, id: string): Promise<boolean> {
  const db = await setUserContext(userId);
  const { data, error } = await db
    .from('webhook_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Service role — webhook dispatcher reads active subscriptions for host. */
export async function listActiveWebhooksForEvent(
  userId: string,
  event: WebhookEvent,
): Promise<WebhookSubscription[]> {
  const { data, error } = await getSupabase()
    .from('webhook_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true);
  if (error) throw error;
  return (data ?? [])
    .map((row) => rowToSubscription(row as WebhookRow))
    .filter((sub) => sub.events.includes(event));
}
