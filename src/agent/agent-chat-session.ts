import { getSupabase } from '../db/client.js';
import { config } from '../config.js';
import type { AgentMessage } from './types.js';

export const AGENT_CHAT_FRAME_TYPE = 'agent_chat_session';
const MAX_TURNS = 12;

type StoredTurn = { role: 'user' | 'assistant'; content: string };

type AgentChatFrame = {
  type: typeof AGENT_CHAT_FRAME_TYPE;
  turns: StoredTurn[];
  updatedAt: string;
};

const memorySessions = new Map<string, { turns: StoredTurn[]; expiresAt: number }>();
let useInMemorySessions = false;

export function _setAgentChatSessionStorageForTests(inMemory: boolean): void {
  useInMemorySessions = inMemory;
  if (inMemory) memorySessions.clear();
}

function sessionTtlMs(): number {
  return config.conversationSessionMinutes * 60 * 1000;
}

function trimTurns(turns: StoredTurn[]): StoredTurn[] {
  return turns.slice(-MAX_TURNS);
}

function frameToTurns(frame: Record<string, unknown>): StoredTurn[] | null {
  if (frame.type !== AGENT_CHAT_FRAME_TYPE) return null;
  const raw = frame.turns;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is StoredTurn =>
      typeof t === 'object' &&
      t !== null &&
      (t.role === 'user' || t.role === 'assistant') &&
      typeof t.content === 'string',
  );
}

async function clearAgentChatFrame(userId: string): Promise<void> {
  if (useInMemorySessions) {
    memorySessions.delete(userId);
    return;
  }
  const { data, error } = await getSupabase()
    .from('pending_clarification_frames')
    .select('id, frame')
    .eq('user_id', userId);
  if (error) throw error;
  for (const row of data ?? []) {
    if ((row.frame as { type?: string }).type === AGENT_CHAT_FRAME_TYPE) {
      await getSupabase().from('pending_clarification_frames').delete().eq('id', row.id);
    }
  }
}

export async function getAgentChatHistory(userId: string): Promise<AgentMessage[]> {
  if (useInMemorySessions) {
    const entry = memorySessions.get(userId);
    if (!entry || entry.expiresAt < Date.now()) {
      memorySessions.delete(userId);
      return [];
    }
    return entry.turns.map((t) => ({ role: t.role, content: t.content }));
  }

  const { data, error } = await getSupabase()
    .from('pending_clarification_frames')
    .select('frame, expires_at')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) throw error;

  for (const row of data ?? []) {
    const turns = frameToTurns(row.frame as Record<string, unknown>);
    if (turns) {
      return turns.map((t) => ({ role: t.role, content: t.content }));
    }
  }
  return [];
}

export async function hasActiveAgentChatSession(userId: string): Promise<boolean> {
  const history = await getAgentChatHistory(userId);
  return history.length > 0;
}

export async function appendAgentChatTurn(
  userId: string,
  userUtterance: string,
  assistantReply: string,
): Promise<void> {
  const existing = await getAgentChatHistory(userId);
  const turns = trimTurns([
    ...existing.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userUtterance.trim() },
    { role: 'assistant' as const, content: assistantReply.trim() },
  ]);

  const expiresAt = Date.now() + sessionTtlMs();

  if (useInMemorySessions) {
    memorySessions.set(userId, { turns, expiresAt });
    return;
  }

  await clearAgentChatFrame(userId);
  const frame: AgentChatFrame = {
    type: AGENT_CHAT_FRAME_TYPE,
    turns,
    updatedAt: new Date().toISOString(),
  };
  const { error } = await getSupabase().from('pending_clarification_frames').insert({
    user_id: userId,
    frame,
    expires_at: new Date(expiresAt).toISOString(),
  });
  if (error) throw error;
}

export async function clearAgentChatSession(userId: string): Promise<void> {
  await clearAgentChatFrame(userId);
}
