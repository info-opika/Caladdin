import { DateTime } from 'luxon';
import type { ConversationContext, PendingIntentTemplate } from '../db/conversation-context.js';
import type { UserPolicyProfile } from '../core/adts.js';
import { inferBlockLabelFromTurns } from './agent-label-inference.js';
import type { AgentContext, AgentMessage } from './types.js';

export type AgentContextAssemblyInput = {
  userUtterance: string;
  chatHistory: AgentMessage[];
  agentContext: AgentContext;
  /** Static block from context-builder (calendar summary, policy snapshot). */
  baseContextBlock: string;
  pendingIntent?: PendingIntentTemplate | null;
};

export type AgentContextAssembly = {
  /** Appended to the base scheduling system prompt. */
  systemExtension: string;
  /** Prepended to the current user message when non-empty. */
  userMessagePrefix: string;
  /** baseContextBlock + systemExtension — convenience for prompt wiring. */
  enrichedContextBlock: string;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function allUserTurns(history: AgentMessage[], utterance: string): string[] {
  return [...history.filter((m) => m.role === 'user').map((m) => m.content), utterance];
}

function extractTimeRange(text: string): string | null {
  const m = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b[\s\S]{0,40}?\bto\b[\s\S]{0,40}?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (m) {
    return `${m[1]}${m[2] ? `:${m[2]}` : ''} ${m[3]} – ${m[4]}${m[5] ? `:${m[5]}` : ''} ${m[6]}`;
  }
  const dash = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (dash) {
    return `${dash[1]}${dash[2] ? `:${dash[2]}` : ''} ${dash[3] ?? ''} – ${dash[4]}${dash[5] ? `:${dash[5]}` : ''} ${dash[6]}`.trim();
  }
  return null;
}

function extractRecurrence(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\bevery\s*day\b|\beveryday\b|\bdaily\b/.test(lower)) return 'every day';
  if (/\bweekdays?\b/.test(lower)) return 'weekdays (Mon–Fri)';
  const days = DAY_NAMES.filter((_, i) =>
    new RegExp(`\\b${DAY_NAMES[i]!.toLowerCase()}\\b`, 'i').test(lower),
  );
  if (days.length > 0) return days.join(', ');
  return null;
}

function extractEmails(text: string): string[] {
  const matches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
  return matches ? [...new Set(matches.map((e) => e.toLowerCase()))] : [];
}

function inferIntentCategory(combined: string): string {
  const lower = combined.toLowerCase();
  if (/\b(block|protect|recurring|personal time|focus time|deep work)\b/.test(lower)) {
    return 'recurring personal block';
  }
  if (/\b(invite|send.*link|scheduling link)\b/.test(lower) || extractEmails(combined).length > 0) {
    return 'invite / mutual scheduling';
  }
  if (/\b(reschedule|move|change|postpone|shift)\b/.test(lower)) {
    return 'reschedule or modify event';
  }
  if (/\b(cancel|delete|remove)\b/.test(lower) && /\b(meeting|event|appointment)\b/.test(lower)) {
    return 'cancel event';
  }
  if (/\b(what.?s on|show|list|when am i|free|busy|calendar|do i have)\b/.test(lower)) {
    return 'calendar query';
  }
  if (/\b(book|schedule|set up|arrange)\b/.test(lower)) {
    return 'book meeting';
  }
  return 'scheduling (general)';
}

function buildPolicyBrief(policy: UserPolicyProfile, timezone: string): string[] {
  const lines = [
    `Timezone: ${timezone}`,
    `Local now: ${DateTime.now().setZone(timezone).toFormat('cccc, MMMM d, yyyy h:mm a ZZZZ')}`,
    `Working hours: ${policy.workingHoursStart}–${policy.workingHoursEnd}`,
    `Chronotype: ${policy.chronotype}`,
    `Default meeting length: ${policy.defaultMeetingLengthMinutes} min`,
  ];
  if (policy.protectedBlocks.length > 0) {
    const labels = policy.protectedBlocks.map((b) => b.label).join(', ');
    lines.push(`Existing protected blocks: ${labels}`);
  }
  return lines;
}

function buildConversationContextLines(ctx: ConversationContext | null | undefined): string[] {
  if (!ctx) return [];
  const lines: string[] = [];
  if (ctx.lastIntent) lines.push(`Last intent: ${ctx.lastIntent}`);
  if (ctx.lastUtterance) lines.push(`Last utterance: "${ctx.lastUtterance}"`);
  if (ctx.lastEvent) {
    const le = ctx.lastEvent;
    lines.push(
      `Last event discussed: "${le.title}"${le.start ? ` at ${le.start}` : ''}${le.id ? ` (id: ${le.id})` : ''}`,
    );
  }
  return lines;
}

function buildPendingIntentLines(pending: PendingIntentTemplate | null | undefined): string[] {
  if (!pending) return [];
  const known = Object.entries(pending.knownFields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  const lines = [
    `Pending intent: ${pending.pendingIntent}`,
    `Original request: "${pending.originalUtterance}"`,
  ];
  if (known.length > 0) lines.push(`Known fields: ${known.join(', ')}`);
  if (pending.missingFields.length > 0) {
    lines.push(`Still missing: ${pending.missingFields.join(', ')}`);
  }
  return lines;
}

export type SessionKnowledge = {
  intentCategory: string;
  known: string[];
  missing: string[];
  readyToAct: boolean;
};

/** Derive what the multi-turn session already established vs what is still needed. */
export function deriveSessionKnowledge(
  history: AgentMessage[],
  userUtterance: string,
  pendingIntent?: PendingIntentTemplate | null,
): SessionKnowledge {
  const userTurns = allUserTurns(history, userUtterance);
  const combined = userTurns.join(' ');
  const intentCategory = pendingIntent?.pendingIntent
    ? pendingIntent.pendingIntent
    : inferIntentCategory(combined);

  const known: string[] = [];
  const missing: string[] = [];

  if (pendingIntent) {
    for (const [k, v] of Object.entries(pendingIntent.knownFields)) {
      if (v !== undefined && v !== null && v !== '') known.push(`${k}: ${JSON.stringify(v)}`);
    }
    for (const f of pendingIntent.missingFields) {
      if (!known.some((k) => k.startsWith(`${f}:`))) missing.push(f);
    }
  }

  const timeRange = extractTimeRange(combined);
  if (timeRange) known.push(`time range: ${timeRange}`);
  else if (/recurring|block|protect|every\s*day|weekday/i.test(combined)) {
    missing.push('daily start/end time');
  }

  const recurrence = extractRecurrence(combined);
  if (recurrence) known.push(`recurrence: ${recurrence}`);

  const emails = extractEmails(combined);
  if (emails.length > 0) known.push(`invitee: ${emails.join(', ')}`);

  const label = inferBlockLabelFromTurns(userTurns);
  if (label) known.push(`label/title: "${label}"`);
  else if (/block|protect|recurring/i.test(combined)) missing.push('block label');

  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
  if (lastAssistant && history.length > 0) {
    known.push(`last assistant asked: "${lastAssistant.content.slice(0, 120)}${lastAssistant.content.length > 120 ? '…' : ''}"`);
  }

  const isBlockIntent = /recurring|block|protect|personal time|focus/i.test(combined);
  const isInviteIntent = emails.length > 0 || /\binvite\b/i.test(combined);
  const isQueryIntent = /\b(what.?s on|show my|calendar for|do i have)\b/i.test(combined);
  const isBookIntent = /\b(book|schedule)\b/i.test(combined) && !isBlockIntent;

  let readyToAct = false;
  if (isBlockIntent) {
    readyToAct = Boolean(timeRange && label);
    if (!recurrence && readyToAct) missing.push('weekdays (default Mon–Fri if unspecified)');
  } else if (isInviteIntent) {
    readyToAct = emails.length > 0;
    if (!timeRange && !/\bslot|time|am|pm\b/i.test(combined)) missing.push('proposed time(s) or duration');
  } else if (isQueryIntent) {
    readyToAct = true;
  } else if (isBookIntent) {
    readyToAct = Boolean(timeRange || /\btomorrow|today|monday|tuesday|wednesday|thursday|friday\b/i.test(combined));
    if (!label && !/\bmeeting\b/i.test(combined)) missing.push('meeting title');
    if (!timeRange) missing.push('date/time');
  } else if (pendingIntent && pendingIntent.missingFields.length === 0) {
    readyToAct = true;
  }

  const dedupedMissing = [...new Set(missing)].filter(
    (m) => !known.some((k) => k.toLowerCase().includes(m.toLowerCase().split(' ')[0] ?? '')),
  );

  return {
    intentCategory,
    known,
    missing: dedupedMissing,
    readyToAct,
  };
}

function buildSessionSummarySection(
  history: AgentMessage[],
  userUtterance: string,
  knowledge: SessionKnowledge,
): string {
  if (history.length === 0) {
    const lines = [
      '## Turn context',
      'Fresh request — no prior clarifications in this session.',
      `Current utterance: "${userUtterance}"`,
      `Inferred goal: ${knowledge.intentCategory}`,
    ];
    if (knowledge.known.length > 0) {
      lines.push('Detected from utterance (do NOT re-ask):');
      for (const k of knowledge.known) lines.push(`- ${k}`);
    }
    lines.push(
      knowledge.readyToAct
        ? 'Status: enough information — prefer calling the appropriate tool now.'
        : 'Status: gather missing details or act if the request is already complete.',
    );
    return lines.join('\n');
  }

  const userTurns = allUserTurns(history, userUtterance);
  const turnLines = userTurns.map((t, i) => `${i + 1}. "${t}"`);

  const lines = [
    '## Turn context',
    `Session turns (user): ${userTurns.length}`,
    ...turnLines,
    `Inferred goal: ${knowledge.intentCategory}`,
  ];

  if (knowledge.known.length > 0) {
    lines.push('Already established (do NOT re-ask):');
    for (const k of knowledge.known) lines.push(`- ${k}`);
  }
  if (knowledge.missing.length > 0) {
    lines.push('Still needed:');
    for (const m of knowledge.missing) lines.push(`- ${m}`);
  }
  if (knowledge.readyToAct) {
    lines.push('Status: enough information — prefer calling the appropriate tool now.');
  } else if (knowledge.missing.length > 0) {
    lines.push('Status: ask ONE short clarifying question for the highest-priority missing item.');
  }

  return lines.join('\n');
}

function buildMultiTurnInstructions(): string {
  return [
    '## Multi-turn scheduling intelligence',
    '- Treat chat history plus this turn as one continuous request — merge facts across turns.',
    '- Never re-ask for information already stated in prior user messages or listed under "Already established".',
    '- When enough fields are present, call the right tool immediately; do not ask for confirmation unless there is a real conflict.',
    '- When something is still missing, ask exactly ONE focused clarifying question.',
    '- Short follow-up replies (e.g. a label, a time, "every day") usually answer your previous question — interpret them in that context.',
    '- Use the user timezone for all spoken times; convert to ISO 8601 with offset in tool arguments.',
  ].join('\n');
}

function buildFewShotExamples(): string {
  return [
    '## Intent patterns (concise)',
    '- Recurring block: "Block focus time weekdays 9–11" → create_recurring_block (label, startTime, endTime, daysOfWeek, rangeEnd).',
    '- Multi-turn block: user gives duration, then "every day 7–7:30", then "Deep Work" → merge all three; do not re-ask times or label.',
    '- Calendar query: "What do I have tomorrow?" → get_calendar_summary with tomorrow\'s range.',
    '- Reschedule: "Move my 3pm with Alex to Thursday" → use last event context if provided, else get_calendar_summary then modify_event.',
    '- Invite: "Invite jane@co.com Tuesday 2pm for sync" → lookup_user then send_invite with proposedSlots.',
    '- Book: "Schedule 30 min with Sam Friday at 10" → create_event once title/time are clear.',
  ].join('\n');
}

/**
 * Central assembly of scheduling context for every LLM turn — timezone, policy,
 * multi-turn session state, and intent guidance across all scheduling scenarios.
 */
export function assembleAgentContext(input: AgentContextAssemblyInput): AgentContextAssembly {
  const { userUtterance, chatHistory, agentContext, baseContextBlock, pendingIntent } = input;
  const { policy, timezone, conversationContext } = agentContext;

  const knowledge = deriveSessionKnowledge(chatHistory, userUtterance, pendingIntent);

  const systemParts = [
    '## Live scheduling context',
    ...buildPolicyBrief(policy, timezone),
    '',
    buildSessionSummarySection(chatHistory, userUtterance, knowledge),
    '',
    ...buildConversationContextLines(conversationContext),
    ...(buildConversationContextLines(conversationContext).length > 0 ? [''] : []),
    ...buildPendingIntentLines(pendingIntent),
    ...(buildPendingIntentLines(pendingIntent).length > 0 ? [''] : []),
    buildMultiTurnInstructions(),
    '',
    buildFewShotExamples(),
  ];

  const systemExtension = systemParts.filter((l) => l !== undefined).join('\n');

  let userMessagePrefix = '';
  if (chatHistory.length > 0) {
    const hints: string[] = ['[Scheduling context for this turn]'];
    if (knowledge.readyToAct) {
      hints.push('You have enough information from this conversation to act — use tools rather than asking again.');
    }
    if (knowledge.known.length > 0) {
      hints.push(`Remember: ${knowledge.known.slice(0, 5).join('; ')}`);
    }
    userMessagePrefix = hints.join(' ');
  }

  return {
    systemExtension,
    userMessagePrefix,
    enrichedContextBlock: `${baseContextBlock}\n\n${systemExtension}`,
  };
}
