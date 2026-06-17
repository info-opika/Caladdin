import { getSupabase } from './client.js';
import { config } from '../config.js';
import type { ParsedIntent } from '../core/adts.js';
import type { SetupFieldId } from '../core/contextual-setup.js';

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

/** LC12 voice pipeline — durable pending intent template (frame-based). */
export const PENDING_FRAME_TTL_MS = config.conversationSessionMinutes * 60 * 1000;
export const PENDING_INTENT_FRAME_TYPE = 'pending_intent';

export type PendingIntentTemplate = {
  pendingIntent: string;
  knownFields: Record<string, unknown>;
  missingFields: string[];
  originalUtterance: string;
  parseRisk?: string;
  createdAt: string;
  expiresAt: string;
};

export interface PendingFrameStorage {
  upsertPendingFrame(userId: string, template: PendingIntentTemplate): Promise<void>;
  getPendingFrame(userId: string): Promise<PendingIntentTemplate | null>;
  clearPendingFrame(userId: string): Promise<void>;
  upsertRawRow?(userId: string, row: Record<string, unknown>): Promise<void>;
}

function frameToPendingTemplate(frame: Record<string, unknown>): PendingIntentTemplate | null {
  if (frame.type !== PENDING_INTENT_FRAME_TYPE) return null;
  return {
    pendingIntent: String(frame.pendingIntent ?? ''),
    knownFields: (frame.knownFields as Record<string, unknown>) ?? {},
    missingFields: Array.isArray(frame.missingFields)
      ? frame.missingFields.filter((x): x is string => typeof x === 'string')
      : [],
    originalUtterance: String(frame.originalUtterance ?? ''),
    ...(typeof frame.parseRisk === 'string' ? { parseRisk: frame.parseRisk } : {}),
    createdAt: String(frame.createdAt ?? new Date().toISOString()),
    expiresAt: String(frame.expiresAt ?? new Date().toISOString()),
  };
}

export class SupabasePendingFrameStorage implements PendingFrameStorage {
  async upsertPendingFrame(userId: string, template: PendingIntentTemplate): Promise<void> {
    await clearPendingIntentFrame(userId);
    const frame = {
      type: PENDING_INTENT_FRAME_TYPE,
      pendingIntent: template.pendingIntent,
      knownFields: template.knownFields,
      missingFields: template.missingFields,
      originalUtterance: template.originalUtterance,
      ...(template.parseRisk ? { parseRisk: template.parseRisk } : {}),
      createdAt: template.createdAt,
      expiresAt: template.expiresAt,
    };
    const { error } = await getSupabase().from('pending_clarification_frames').insert({
      user_id: userId,
      frame,
      expires_at: template.expiresAt,
    });
    if (error) throw error;
  }

  async getPendingFrame(userId: string): Promise<PendingIntentTemplate | null> {
    await expireConversationContexts();
    const { data, error } = await getSupabase()
      .from('pending_clarification_frames')
      .select('frame, expires_at')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (error) throw error;
    for (const row of data ?? []) {
      const tpl = frameToPendingTemplate(row.frame as Record<string, unknown>);
      if (tpl) return tpl;
    }
    return null;
  }

  async clearPendingFrame(userId: string): Promise<void> {
    await clearPendingIntentFrame(userId);
  }
}

export class SharedInMemoryPendingFrameStorage implements PendingFrameStorage {
  constructor(private readonly backing = new Map<string, PendingIntentTemplate>()) {}

  async upsertPendingFrame(userId: string, template: PendingIntentTemplate): Promise<void> {
    this.backing.set(userId, template);
  }

  async upsertRawRow(userId: string, row: Record<string, unknown>): Promise<void> {
    const tpl = frameToPendingTemplate(row);
    if (tpl) this.backing.set(userId, tpl);
  }

  async getPendingFrame(userId: string): Promise<PendingIntentTemplate | null> {
    const tpl = this.backing.get(userId);
    if (!tpl) return null;
    if (Date.parse(tpl.expiresAt) < Date.now()) {
      this.backing.delete(userId);
      return null;
    }
    return tpl;
  }

  async clearPendingFrame(userId: string): Promise<void> {
    this.backing.delete(userId);
  }
}

const supabasePendingStorage = new SupabasePendingFrameStorage();
let testPendingStorage: PendingFrameStorage | null = null;

export function getPendingFrameStorage(): PendingFrameStorage {
  return testPendingStorage ?? supabasePendingStorage;
}

export function _setPendingFrameStorageForTests(storage: PendingFrameStorage | null): void {
  testPendingStorage = storage;
}

export async function clearPendingIntentFrame(userId: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from('pending_clarification_frames')
    .select('id, frame')
    .eq('user_id', userId);
  if (error) throw error;
  for (const row of data ?? []) {
    if ((row.frame as { type?: string }).type === PENDING_INTENT_FRAME_TYPE) {
      await getSupabase().from('pending_clarification_frames').delete().eq('id', row.id);
    }
  }
}

export async function upsertPendingFrame(userId: string, template: PendingIntentTemplate): Promise<void> {
  await getPendingFrameStorage().upsertPendingFrame(userId, template);
}

export async function getPendingFrame(userId: string): Promise<PendingIntentTemplate | null> {
  return getPendingFrameStorage().getPendingFrame(userId);
}

export async function clearPendingFrame(userId: string): Promise<void> {
  await getPendingFrameStorage().clearPendingFrame(userId);
}

/** v3 contextual setup — defer intent until a setup field is answered. */
export const SETUP_PENDING_FRAME_TYPE = 'setup_pending';

export interface PendingSetupIntent {
  setupField: SetupFieldId;
  deferredParsed: ParsedIntent;
  originalUtterance: string;
  createdAt: string;
  expiresAt: string;
}

const setupPendingMemory = new Map<string, PendingSetupIntent>();
let useInMemorySetupPending = false;

export function _setSetupPendingStorageForTests(inMemory: boolean): void {
  useInMemorySetupPending = inMemory;
  if (inMemory) setupPendingMemory.clear();
}

function frameToPendingSetup(frame: Record<string, unknown>): PendingSetupIntent | null {
  if (frame.type !== SETUP_PENDING_FRAME_TYPE) return null;
  const deferred = frame.deferredParsed as ParsedIntent | undefined;
  if (!deferred || typeof deferred !== 'object') return null;
  return {
    setupField: String(frame.setupField ?? '') as SetupFieldId,
    deferredParsed: deferred,
    originalUtterance: String(frame.originalUtterance ?? ''),
    createdAt: String(frame.createdAt ?? new Date().toISOString()),
    expiresAt: String(frame.expiresAt ?? new Date().toISOString()),
  };
}

async function clearSetupPendingFrame(userId: string): Promise<void> {
  if (useInMemorySetupPending) {
    setupPendingMemory.delete(userId);
    return;
  }
  const { data, error } = await getSupabase()
    .from('pending_clarification_frames')
    .select('id, frame')
    .eq('user_id', userId);
  if (error) throw error;
  for (const row of data ?? []) {
    if ((row.frame as { type?: string }).type === SETUP_PENDING_FRAME_TYPE) {
      await getSupabase().from('pending_clarification_frames').delete().eq('id', row.id);
    }
  }
}

export async function savePendingSetupIntent(
  userId: string,
  entry: {
    setupField: SetupFieldId;
    deferredParsed: ParsedIntent;
    originalUtterance: string;
  },
): Promise<void> {
  const expiresAt = new Date(Date.now() + config.conversationSessionMinutes * 60 * 1000).toISOString();
  const pending: PendingSetupIntent = {
    setupField: entry.setupField,
    deferredParsed: entry.deferredParsed,
    originalUtterance: entry.originalUtterance,
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  if (useInMemorySetupPending) {
    setupPendingMemory.set(userId, pending);
    return;
  }

  await clearSetupPendingFrame(userId);
  const frame = {
    type: SETUP_PENDING_FRAME_TYPE,
    setupField: pending.setupField,
    deferredParsed: pending.deferredParsed,
    originalUtterance: pending.originalUtterance,
    createdAt: pending.createdAt,
    expiresAt: pending.expiresAt,
  };
  const { error } = await getSupabase().from('pending_clarification_frames').insert({
    user_id: userId,
    frame,
    expires_at: expiresAt,
  });
  if (error) throw error;
}

export async function getPendingSetupIntent(userId: string): Promise<PendingSetupIntent | null> {
  if (useInMemorySetupPending) {
    const tpl = setupPendingMemory.get(userId);
    if (!tpl) return null;
    if (Date.parse(tpl.expiresAt) < Date.now()) {
      setupPendingMemory.delete(userId);
      return null;
    }
    return tpl;
  }

  await expireConversationContexts();
  const { data, error } = await getSupabase()
    .from('pending_clarification_frames')
    .select('frame, expires_at')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  for (const row of data ?? []) {
    const tpl = frameToPendingSetup(row.frame as Record<string, unknown>);
    if (tpl) return tpl;
  }
  return null;
}

export async function clearPendingSetupIntent(userId: string): Promise<void> {
  await clearSetupPendingFrame(userId);
}
