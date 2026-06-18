import { describe, it, expect } from 'vitest';
import { selectToolsForUtterance } from '../../src/agent/tool-pruning.js';

describe('selectToolsForUtterance', () => {
  it('selects block tools for protect/block utterances', () => {
    const tools = selectToolsForUtterance('block personal time every morning', []);
    expect(tools).toContain('create_recurring_block');
    expect(tools.length).toBeLessThanOrEqual(6);
    expect(tools).not.toContain('send_invite');
  });

  it('selects invite tools for invite utterances', () => {
    const tools = selectToolsForUtterance('send invite to jane@example.com', []);
    expect(tools).toContain('lookup_user');
    expect(tools).toContain('send_invite');
  });

  it('selects book tools for schedule utterances', () => {
    const tools = selectToolsForUtterance('book a meeting tomorrow', []);
    expect(tools).toContain('create_event');
    expect(tools).toContain('check_specific_slot');
  });

  it('includes undo when history mentions a recent write', () => {
    const tools = selectToolsForUtterance('what about tomorrow', [
      { role: 'assistant', content: 'I booked your focus block.' },
    ]);
    expect(tools).toContain('undo_last_action');
  });

  it('falls back to core six for ambiguous utterances', () => {
    const tools = selectToolsForUtterance('help me with my day', []);
    expect(tools).toEqual([
      'get_calendar_summary',
      'create_event',
      'find_available_slots',
      'check_specific_slot',
      'create_recurring_block',
      'send_invite',
    ]);
  });
});
