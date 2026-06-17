import { describe, it, expect, afterEach } from 'vitest';
import { agentEnabledFor, parseAgentPilotUsers } from '../../src/config.js';

describe('agent feature flags', () => {
  const originalEnabled = process.env.CALADDIN_AGENT_ENABLED;
  const originalPilot = process.env.CALADDIN_AGENT_PILOT_USERS;

  afterEach(() => {
    if (originalEnabled !== undefined) {
      process.env.CALADDIN_AGENT_ENABLED = originalEnabled;
    } else {
      delete process.env.CALADDIN_AGENT_ENABLED;
    }
    if (originalPilot !== undefined) {
      process.env.CALADDIN_AGENT_PILOT_USERS = originalPilot;
    } else {
      delete process.env.CALADDIN_AGENT_PILOT_USERS;
    }
  });

  it('parseAgentPilotUsers splits comma-separated IDs', () => {
    expect(parseAgentPilotUsers('a, b ,c')).toEqual(['a', 'b', 'c']);
    expect(parseAgentPilotUsers('')).toEqual([]);
    expect(parseAgentPilotUsers(undefined)).toEqual([]);
  });

  it('agentEnabledFor returns true when global flag is on', () => {
    process.env.CALADDIN_AGENT_ENABLED = '1';
    delete process.env.CALADDIN_AGENT_PILOT_USERS;
    expect(agentEnabledFor('any-user-id')).toBe(true);
  });

  it('agentEnabledFor returns true for pilot user when global flag is off', () => {
    process.env.CALADDIN_AGENT_ENABLED = '0';
    process.env.CALADDIN_AGENT_PILOT_USERS = 'pilot-a, pilot-b';
    expect(agentEnabledFor('pilot-a')).toBe(true);
    expect(agentEnabledFor('pilot-b')).toBe(true);
    expect(agentEnabledFor('other-user')).toBe(false);
  });

  it('agentEnabledFor returns false when flag off and user not in pilot list', () => {
    delete process.env.CALADDIN_AGENT_ENABLED;
    delete process.env.CALADDIN_AGENT_PILOT_USERS;
    expect(agentEnabledFor('regular-user')).toBe(false);
  });
});
