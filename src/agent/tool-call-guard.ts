import type { ToolName } from './tools/schemas.js';

export type WrongToolCheck = {
  wrong: boolean;
  expectedTools?: ToolName[];
  correction?: string;
};

const BLOCK_SIGNAL = /\b(block|protect|shield|recurring|personal time|focus time)\b/i;

/** Detect when utterance signals block/protect but model chose a read-only summary tool. */
export function checkWrongTool(utterance: string, toolName: string): WrongToolCheck {
  if (BLOCK_SIGNAL.test(utterance) && toolName === 'get_calendar_summary') {
    return {
      wrong: true,
      expectedTools: ['create_recurring_block'],
      correction:
        'The user wants to protect or block time, not read their calendar. Use create_recurring_block with label, times, weekdays, and range end.',
    };
  }

  if (/\b(invite|send)\b/i.test(utterance) && /\b@/.test(utterance) && toolName === 'get_calendar_summary') {
    return {
      wrong: true,
      expectedTools: ['lookup_user', 'send_invite'],
      correction:
        'The user wants to send an invite. Use lookup_user then send_invite — do not dump the calendar summary.',
    };
  }

  if (/\b(book|schedule)\b/i.test(utterance) && toolName === 'get_calendar_summary') {
    return {
      wrong: true,
      expectedTools: ['create_event', 'check_specific_slot'],
      correction: 'The user wants to book or schedule. Use create_event or check_specific_slot, not get_calendar_summary alone.',
    };
  }

  return { wrong: false };
}
