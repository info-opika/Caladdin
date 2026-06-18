import { describe, it, expect } from 'vitest';
import { buildOpenAiToolDefinitions, buildAnthropicToolDefinitions, TOOL_NAMES } from '../../src/agent/tools/schemas.js';

describe('buildOpenAiToolDefinitions', () => {
  it('every tool function.parameters has type object', () => {
    const tools = buildOpenAiToolDefinitions();
    expect(tools).toHaveLength(TOOL_NAMES.length);

    for (const [i, tool] of tools.entries()) {
      expect(tool.type).toBe('function');
      expect(tool.function.parameters, `tools.${i} (${tool.function.name})`).toMatchObject({ type: 'object' });
    }
  });

  it('get_invite_status schema includes optional sessionToken and inviteeEmail', () => {
    const tool = buildOpenAiToolDefinitions().find((t) => t.function.name === 'get_invite_status');
    expect(tool?.function.parameters).toEqual({
      type: 'object',
      properties: {
        sessionToken: { type: 'string', minLength: 1 },
        inviteeEmail: { type: 'string', format: 'email' },
      },
    });
  });

  it('buildAnthropicToolDefinitions alias preserves legacy shape', () => {
    const legacy = buildAnthropicToolDefinitions();
    expect(legacy[0]).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
      input_schema: { type: 'object' },
    });
  });
});
