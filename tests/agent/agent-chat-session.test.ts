import { describe, it, expect, beforeEach } from 'vitest';
import {
  _setAgentChatSessionStorageForTests,
  appendAgentChatTurn,
  clearAgentChatSession,
  getAgentChatHistory,
  hasActiveAgentChatSession,
} from '../../src/agent/agent-chat-session.js';

const USER = '11111111-1111-4111-8111-111111111111';

describe('agent chat session', () => {
  beforeEach(() => {
    _setAgentChatSessionStorageForTests(true);
  });

  it('stores and retrieves multi-turn history', async () => {
    await appendAgentChatTurn(USER, 'Block 30 minutes for meditation', 'Which day and time?');
    await appendAgentChatTurn(
      USER,
      'Everyday from 7 AM to 7:30 AM',
      'What label would you like?',
    );

    const history = await getAgentChatHistory(USER);
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ role: 'user', content: 'Block 30 minutes for meditation' });
    expect(history[3]?.role).toBe('assistant');
    expect(await hasActiveAgentChatSession(USER)).toBe(true);
  });

  it('clears session after successful completion', async () => {
    await appendAgentChatTurn(USER, 'hello', 'hi');
    await clearAgentChatSession(USER);
    expect(await getAgentChatHistory(USER)).toEqual([]);
  });
});
