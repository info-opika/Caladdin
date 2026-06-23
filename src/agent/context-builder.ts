import { DateTime } from 'luxon';
import { ensureDefaultPolicy } from '../db/users.js';
import { getConversationContext } from '../db/conversation-context.js';
import { getOAuthClientForUser } from '../services/auth_service.js';
import { listEventsFromGCalSafe } from '../services/calendar_api.js';
import { normalizeGCalRange } from '../core/date-utils.js';
import type { AgentContext } from './types.js';

export type BuiltAgentContext = AgentContext & {
  systemContextBlock: string;
};

export async function buildAgentContext(params: {
  userId: string;
  requestId: string;
  timezone?: string;
}): Promise<BuiltAgentContext> {
  const policy = await ensureDefaultPolicy(params.userId);
  const timezone = params.timezone?.trim() || policy.timezone || 'America/Chicago';
  const cal = await getOAuthClientForUser(params.userId);
  const conversationContext = await getConversationContext(params.userId);

  const systemContextBlock = await buildContextBlock({
    userId: params.userId,
    timezone,
    policy,
    cal,
    conversationContext,
  });

  return {
    userId: params.userId,
    requestId: params.requestId,
    timezone,
    cal,
    policy,
    conversationContext,
    systemContextBlock,
  };
}

async function buildContextBlock(params: {
  userId: string;
  timezone: string;
  policy: Awaited<ReturnType<typeof ensureDefaultPolicy>>;
  cal: Awaited<ReturnType<typeof getOAuthClientForUser>>;
  conversationContext: Awaited<ReturnType<typeof getConversationContext>>;
}): Promise<string> {
  const now = DateTime.now().setZone(params.timezone);
  const lines: string[] = [
    `Today: ${now.toFormat('cccc, MMMM d, yyyy')} (${params.timezone})`,
    `Working hours: ${params.policy.workingHoursStart}–${params.policy.workingHoursEnd}`,
    `Default meeting length: ${params.policy.defaultMeetingLengthMinutes} minutes`,
    `Calendar connected: ${params.cal ? 'yes' : 'no'}`,
  ];

  if (params.policy.protectedBlocks.length > 0) {
    const labels = params.policy.protectedBlocks.map((b) => b.label).join(', ');
    lines.push(`Protected blocks already set: ${labels}`);
  }

  if (params.conversationContext?.lastEvent) {
    const le = params.conversationContext.lastEvent;
    lines.push(`Last event discussed: "${le.title}"${le.start ? ` at ${le.start}` : ''}`);
  }

  if (params.cal) {
    const { timeMin, timeMax } = normalizeGCalRange(undefined, undefined, 7);
    const { events } = await listEventsFromGCalSafe(params.cal, timeMin, timeMax, params.userId);
    if (events.length === 0) {
      lines.push('This week: no events on Google Calendar.');
    } else {
      const summary = events.slice(0, 8).map((e) => {
        const start = DateTime.fromISO(e.start, { zone: params.timezone });
        return `• ${e.title} — ${start.toFormat('ccc M/d h:mm a')}`;
      });
      lines.push('This week (summary):');
      lines.push(...summary);
    }
  }

  return lines.join('\n');
}
