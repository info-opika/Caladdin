import type { AgentMessage } from './types.js';
import type { ToolName } from './tools/schemas.js';
import {
  assistantAskedConfirmation,
  isAffirmation,
  isBlockIntent,
  isBookIntent,
  isCancelIntent,
  utteranceSignals,
} from './intent-signals.js';
import { isSchedulingFollowUp } from './agent-scheduling-state.js';

export const CORE_TOOL_NAMES: ToolName[] = [
  'get_calendar_summary',
  'create_event',
  'find_available_slots',
  'check_specific_slot',
  'create_recurring_block',
  'send_invite',
];

const BLOCK_TOOLS: ToolName[] = [
  'create_recurring_block',
  'get_calendar_summary',
  'modify_event',
  'cancel_events_in_range',
];

const INVITE_TOOLS: ToolName[] = [
  'lookup_user',
  'send_invite',
  'get_invite_status',
  'update_session_slots',
  'check_specific_slot',
  'find_available_slots',
];

const BOOK_TOOLS: ToolName[] = [
  'create_event',
  'check_specific_slot',
  'find_available_slots',
  'get_calendar_summary',
];

const CANCEL_TOOLS: ToolName[] = [
  'cancel_events_in_range',
  'modify_event',
  'get_calendar_summary',
  'undo_last_action',
];

const SUMMARY_TOOLS: ToolName[] = ['get_calendar_summary', 'find_available_slots'];

const WRITE_TOOL_NAMES = new Set<ToolName>([
  'create_event',
  'create_recurring_block',
  'send_invite',
  'update_session_slots',
  'modify_event',
  'cancel_events_in_range',
  'undo_last_action',
]);

function hadRecentWrite(history: AgentMessage[]): boolean {
  return history.some(
    (m) =>
      m.role === 'assistant' &&
      /\b(created|booked|blocked|sent|invite|cancelled|canceled|updated)\b/i.test(m.content),
  );
}

function dedupe(names: ToolName[]): ToolName[] {
  return [...new Set(names)];
}

/** Prune 13 tools → 4–6 relevant tools based on utterance keywords. */
export function selectToolsForUtterance(utterance: string, history: AgentMessage[] = []): ToolName[] {
  const text = utteranceSignals(utterance, history);

  let subset: ToolName[];
  const inviteSignals = /\b(invite|send|grant|proposed)\b/.test(text) || /@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
  const schedulingContinuation =
    history.length > 0 &&
    (isSchedulingFollowUp(utterance, null, history) || isAffirmation(utterance));

  if (isBlockIntent(text) && !schedulingContinuation) {
    subset = BLOCK_TOOLS;
  } else if (inviteSignals || (schedulingContinuation && inviteSignals)) {
    subset = INVITE_TOOLS;
  } else if (
    isBookIntent(text) ||
    schedulingContinuation ||
    (isAffirmation(utterance) && isBookIntent(text) && assistantAskedConfirmation(history))
  ) {
    subset = BOOK_TOOLS;
  } else if (isCancelIntent(text)) {
    subset = CANCEL_TOOLS;
  } else if (/\b(what'?s on|summary|tomorrow|today|calendar|agenda|meetings?)\b/.test(text)) {
    subset = SUMMARY_TOOLS;
  } else {
    subset = CORE_TOOL_NAMES;
  }

  if (hadRecentWrite(history)) {
    subset = dedupe([...subset, 'undo_last_action']);
  }

  return dedupe(subset);
}

export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name as ToolName);
}
