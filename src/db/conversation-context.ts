import { getSupabase } from './client.js';
import { config } from '../config.js';

export interface LastEventRef {
  id?: string;
  title: string;
  gcalEventId?: string | null;
  start?: string;
  end?: string;
  participants?: string[];
}

export interface ConversationContext {
  lastEvent?: LastEventRef;
  lastIntent?: string;
  lastUtterance?: string;
  updatedAt: string;
}

const FRAME_TYPE = 'conversation';
const EMAIL_FRAME_TYPE = 'email_confirmation';

export interface PendingEmailConfirmation {
  email: string;
  originalIntent: string;
  originalParams: Record<string, unknown>;
  originalUtterance?: string;
}

function frameToContext(frame: Record<string, unknown>): ConversationContext | null {
  if (frame.type !== FRAME_TYPE) return null;
  return {
    lastEvent: frame.lastEvent as LastEventRef | undefined,
    lastIntent: frame.lastIntent as string | undefined,
    lastUtterance: frame.lastUtterance as string | undefined,
    updatedAt: (frame.updatedAt as string) ?? new Date().toISOString(),
  };
}

export async function expireConversationContexts(): Promise<void> {
  const { error } = await getSupabase()
    .from('pending_clarification_frames')
    .delete()
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
}

export async function getConversationContext(userId: string): Promise<ConversationContext | null> {
  await expireConversationContexts();

  const { data, error } = await getSupabase()
    .from('pending_clarification_frames')
    .select('frame, expires_at, created_at')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) throw error;

  for (const row of data ?? []) {
    const ctx = frameToContext(row.frame as Record<string, unknown>);
    if (ctx) return ctx;
  }
  return null;
}

export async function saveConversationContext(
  userId: string,
  update: Omit<ConversationContext, 'updatedAt'>,
): Promise<void> {
  const expiresAt = new Date(
    Date.now() + config.conversationSessionMinutes * 60 * 1000,
  ).toISOString();

  const { data: existing, error: listError } = await getSupabase()
    .from('pending_clarification_frames')
    .select('id, frame')
    .eq('user_id', userId);

  if (listError) throw listError;

  for (const row of existing ?? []) {
    if ((row.frame as { type?: string }).type === FRAME_TYPE) {
      const { error } = await getSupabase()
        .from('pending_clarification_frames')
        .delete()
        .eq('id', row.id);
      if (error) throw error;
    }
  }

  const frame = {
    type: FRAME_TYPE,
    lastEvent: update.lastEvent,
    lastIntent: update.lastIntent,
    lastUtterance: update.lastUtterance,
    updatedAt: new Date().toISOString(),
  };

  const { error } = await getSupabase().from('pending_clarification_frames').insert({
    user_id: userId,
    frame,
    expires_at: expiresAt,
  });
  if (error) throw error;
}

export async function recordLastEvent(
  userId: string,
  lastIntent: string,
  lastUtterance: string,
  event: LastEventRef,
  prior?: ConversationContext | null,
): Promise<void> {
  await saveConversationContext(userId, {
    lastEvent: event,
    lastIntent,
    lastUtterance,
  });
}

export async function getPendingEmailConfirmation(userId: string): Promise<PendingEmailConfirmation | null> {
  await expireConversationContexts();
  const { data, error } = await getSupabase()
    .from('pending_clarification_frames')
    .select('frame, expires_at')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) throw error;
  for (const row of data ?? []) {
    const frame = row.frame as Record<string, unknown>;
    if (frame.type === EMAIL_FRAME_TYPE) {
      return {
        email: frame.email as string,
        originalIntent: frame.originalIntent as string,
        originalParams: (frame.originalParams as Record<string, unknown>) ?? {},
        originalUtterance: frame.originalUtterance as string | undefined,
      };
    }
  }
  return null;
}

export async function savePendingEmailConfirmation(
  userId: string,
  pending: PendingEmailConfirmation,
): Promise<void> {
  await clearPendingEmailConfirmation(userId);
  const expiresAt = new Date(Date.now() + config.conversationSessionMinutes * 60 * 1000).toISOString();
  const frame = {
    type: EMAIL_FRAME_TYPE,
    ...pending,
  };
  const { error } = await getSupabase().from('pending_clarification_frames').insert({
    user_id: userId,
    frame,
    expires_at: expiresAt,
  });
  if (error) throw error;
}

export async function clearPendingEmailConfirmation(userId: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from('pending_clarification_frames')
    .select('id, frame')
    .eq('user_id', userId);
  if (error) throw error;
  for (const row of data ?? []) {
    if ((row.frame as { type?: string }).type === EMAIL_FRAME_TYPE) {
      await getSupabase().from('pending_clarification_frames').delete().eq('id', row.id);
    }
  }
}

export async function savePendingClarification(
  userId: string,
  data: { pendingIntent: string; knownFields: Record<string, unknown>; question: string },
): Promise<void> {
  const expiresAt = new Date(Date.now() + config.conversationSessionMinutes * 60 * 1000).toISOString();
  const frame = { type: 'clarification', ...data };
  const { error } = await getSupabase().from('pending_clarification_frames').insert({
    user_id: userId,
    frame,
    expires_at: expiresAt,
  });
  if (error) throw error;
}
