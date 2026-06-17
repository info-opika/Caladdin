import { describe, it, expect } from 'vitest';
import { buildAnthropicToolDefinitions, TOOL_NAMES } from '../../src/agent/tools/schemas.js';

describe('buildAnthropicToolDefinitions', () => {
  it('every tool input_schema has type object', () => {
    const tools = buildAnthropicToolDefinitions();
    expect(tools).toHaveLength(TOOL_NAMES.length);

    for (const [i, tool] of tools.entries()) {
      expect(tool.input_schema, `tools.${i} (${tool.name})`).toMatchObject({ type: 'object' });
    }
  });

  it('get_invite_status schema includes optional sessionToken and inviteeEmail', () => {
    const tool = buildAnthropicToolDefinitions().find((t) => t.name === 'get_invite_status');
    expect(tool?.input_schema).toEqual({
      type: 'object',
      properties: {
        sessionToken: { type: 'string', minLength: 1 },
        inviteeEmail: { type: 'string', format: 'email' },
      },
    });
  });
});
