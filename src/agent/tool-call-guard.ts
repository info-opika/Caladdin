import type { AgentMessage } from './types.js';
import type { ToolName } from './tools/schemas.js';
import {
  assistantAskedConfirmation,
  isAffirmation,
  isBlockIntent,
  isBookIntent,
  isCancelIntent,
  isReadOnlyTool,
  utteranceSignals,
} from './intent-signals.js';

export type WrongToolCheck = {
  wrong: boolean;
  expectedTools?: ToolName[];
  correction?: string;
};

/** Detect when utterance signals block/protect but model chose a read-only summary tool. */
export function checkWrongTool(
  utterance: string,
  toolName: string,
  history: AgentMessage[] = [],
): WrongToolCheck {
  const combined = utteranceSignals(utterance, history);

  if (isBlockIntent(combined) && toolName === 'get_calendar_summary') {
    return {
      wrong: true,
      expectedTools: ['create_recurring_block'],
      correction:
        'The user wants to protect or block time, not read their calendar. Use create_recurring_block with label, times, weekdays, and range end.',
    };
  }

  if (/\b(invite|send)\b/i.test(combined) && /\b@/.test(combined) && toolName === 'get_calendar_summary') {
    return {
      wrong: true,
      expectedTools: ['lookup_user', 'send_invite'],
      correction:
        'The user wants to send an invite. Use lookup_user then send_invite — do not dump the calendar summary.',
    };
  }

  if (isBookIntent(combined) && toolName === 'get_calendar_summary') {
    return {
      wrong: true,
      expectedTools: ['create_event', 'check_specific_slot'],
      correction:
        'The user wants to book or schedule. Use create_event or check_specific_slot, not get_calendar_summary alone.',
    };
  }

  if (isCancelIntent(combined) && toolName === 'get_calendar_summary') {
    return {
      wrong: true,
      expectedTools: ['cancel_events_in_range', 'modify_event'],
      correction:
        'The user wants to delete or cancel an event. Use cancel_events_in_range with eventTitle (or modify_event to reschedule), not get_calendar_summary alone.',
    };
  }

  if (
    isAffirmation(utterance) &&
    isBookIntent(combined) &&
    assistantAskedConfirmation(history) &&
    isReadOnlyTool(toolName)
  ) {
    return {
      wrong: true,
      expectedTools: ['create_event'],
      correction:
        'The user confirmed your booking proposal. Call create_event now with the title and start time from this conversation — do not read the calendar or search slots.',
    };
  }

  return { wrong: false };
}
