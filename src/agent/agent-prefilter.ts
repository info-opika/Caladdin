import { DateTime } from 'luxon';
import { tryProtectBlockFromInfer } from '../core/protect-block-prefilter.js';
import { tryMatchQueryCalendar } from '../core/query-prefilter.js';
import { tryMatchSchedulingLink, extractDurationMinutes } from '../core/scheduling-link-prefilter.js';
import { isCalendarRelated } from '../services/llm.js';
import { WARM_REDIRECT_MESSAGE } from '../core/adts.js';
import { executeAgentTool } from './tools/registry.js';
import { tryAssembleRecurringBlockFromTurns } from './recurring-block-assembler.js';
import {
  clearAgentSchedulingTask,
  getAgentSchedulingTask,
  isSchedulingFollowUp,
  isSchedulingTaskReady,
  syncAgentSchedulingState,
  tryExecuteSchedulingTask,
} from './agent-scheduling-state.js';
import { isCalendarQueryTurn } from './agent-label-inference.js';
import { handleHostProposalCommand } from '../services/host_scheduling_chat.js';
import type { AgentContext, AgentMessage, SchedulingAgentResult } from './types.js';

export type AgentPrefilterOutcome =
  | { bypassed: false }
  | ({ bypassed: true; prefilter: string } & SchedulingAgentResult);

function formatEventTimeLabel(iso: string, timezone: string): string {
  const dt = DateTime.fromISO(iso, { setZone: true });
  if (!dt.isValid) return iso;
  return dt.setZone(timezone).toFormat('ccc M/d h:mm a');
}

function formatCalendarCountReply(
  result: Awaited<ReturnType<typeof executeAgentTool>>,
  dayLabel: string,
): string {
  if (!result.ok) {
    return result.error ?? 'I could not read your calendar right now.';
  }
  const data = result.data as { events?: Array<{ title: string }> };
  const count = data.events?.length ?? 0;
  if (count === 0) return `You have no meetings ${dayLabel}.`;
  if (count === 1) return `You have 1 meeting ${dayLabel}.`;
  return `You have ${count} meetings ${dayLabel}.`;
}

function formatCalendarSummaryReply(
  result: Awaited<ReturnType<typeof executeAgentTool>>,
  timezone: string,
): string {
  if (!result.ok) {
    return result.error ?? 'I could not read your calendar right now.';
  }
  const data = result.data as { events?: Array<{ title: string; start: string; end: string }> };
  const events = data.events ?? [];
  if (events.length === 0) {
    return 'Nothing on your calendar for that period.';
  }
  const zone = timezone.trim() || 'America/Chicago';
  const lines = events.slice(0, 8).map((e) => {
    const start = formatEventTimeLabel(e.start, zone);
    const end = formatEventTimeLabel(e.end, zone);
    return `- ${e.title}: ${start} – ${end}`;
  });
  return `Here is what I see:\n${lines.join('\n')}`;
}

function queryParamsToRange(
  query: ReturnType<typeof tryMatchQueryCalendar>,
  timezone: string,
): { rangeStart?: string; rangeEnd?: string } {
  if (!query) return {};
  const now = DateTime.now().setZone(timezone);
  if (query.day === 'today' || query.queryType === 'today' || query.queryType === 'count') {
    return {
      rangeStart: now.startOf('day').toISO() ?? undefined,
      rangeEnd: now.endOf('day').toISO() ?? undefined,
    };
  }
  if (query.day === 'tomorrow' || query.queryType === 'tomorrow') {
    const d = now.plus({ days: 1 });
    return {
      rangeStart: d.startOf('day').toISO() ?? undefined,
      rangeEnd: d.endOf('day').toISO() ?? undefined,
    };
  }
  if (query.weekRangeKind === 'this_week') {
    return {
      rangeStart: now.startOf('week').toISO() ?? undefined,
      rangeEnd: now.endOf('week').toISO() ?? undefined,
    };
  }
  if (query.weekRangeKind === 'next_week') {
    const w = now.plus({ weeks: 1 });
    return {
      rangeStart: w.startOf('week').toISO() ?? undefined,
      rangeEnd: w.endOf('week').toISO() ?? undefined,
    };
  }
  return {};
}

function protectParamsToBlockInput(params: Record<string, unknown>) {
  return {
    label: String(params.label ?? 'Personal time'),
    startTime: String(params.startTime ?? '09:00'),
    endTime: params.endTime ? String(params.endTime) : undefined,
    daysOfWeek: Array.isArray(params.daysOfWeek) ? params.daysOfWeek : [1, 2, 3, 4, 5],
    rangeEnd: String(params.rangeEnd ?? DateTime.now().plus({ weeks: 4 }).toISODate()),
    startDate: params.startDate ? String(params.startDate) : undefined,
  };
}

function prefilterResult(
  prefilter: string,
  reply: string,
  toolCalls: SchedulingAgentResult['toolCalls'],
  model: string,
): AgentPrefilterOutcome {
  return {
    bypassed: true,
    prefilter,
    reply,
    toolCalls,
    rounds: 0,
    trace: {
      model,
      rounds: 0,
      totalLatencyMs: 0,
      tools: toolCalls.map((t) => ({ name: t.name, latencyMs: 0, ok: t.result.ok })),
      prefilterBypass: true,
      requestedModel: model,
    },
  };
}

/** OFFER_SPECIFIC phrasing — must send scheduling link, not defer to multi-turn book state. */
function isOfferSpecificSlotRequest(utterance: string): boolean {
  return (
    /\bfind\s+\d+\s+slots?\s+(?:for|with)\b/i.test(utterance) ||
    /\bfind\s+(?:two|2)\s+slots?\s+(?:for|with)\b/i.test(utterance)
  );
}

/** Deterministic prefilters before LLM — protect block, query, invite link, off-topic. */
export async function runAgentPrefilter(
  utterance: string,
  agentCtx: AgentContext,
  model: string,
  history: AgentMessage[] = [],
): Promise<AgentPrefilterOutcome> {
  const tz = agentCtx.timezone;
  const sessionActive = history.length > 0;

  const userTurns = [
    ...history.filter((m) => m.role === 'user').map((m) => m.content),
    utterance,
  ];
  const combinedUtterance = userTurns.join(' ');

  const queryHit = tryMatchQueryCalendar(utterance);
  if (
    queryHit &&
    (queryHit.queryType === 'today' ||
      queryHit.queryType === 'tomorrow' ||
      queryHit.queryType === 'count' ||
      queryHit.weekRangeKind)
  ) {
    const range = queryParamsToRange(queryHit, tz);
    const result = await executeAgentTool('get_calendar_summary', range, agentCtx);
    if (queryHit.queryType === 'count') {
      const dayLabel = queryHit.day === 'tomorrow' ? 'tomorrow' : 'today';
      return prefilterResult(
        'query',
        formatCalendarCountReply(result, dayLabel),
        [{ name: 'get_calendar_summary', input: range, result }],
        model,
      );
    }
    return prefilterResult(
      'query',
      formatCalendarSummaryReply(result, tz),
      [{ name: 'get_calendar_summary', input: range, result }],
      model,
    );
  }

  const hostProposal = await handleHostProposalCommand(
    utterance,
    agentCtx.userId,
    agentCtx.cal,
    agentCtx.policy,
  );
  if (hostProposal) {
    return prefilterResult('host_proposal', hostProposal.messageToUser, [], model);
  }

  const pendingTask = await getAgentSchedulingTask(agentCtx.userId).catch(() => null);
  const schedulingFollowUp = isSchedulingFollowUp(utterance, pendingTask, history);

  if (!isCalendarRelated(utterance, { activeAgentSession: sessionActive || schedulingFollowUp })) {
    return prefilterResult('off_topic', WARM_REDIRECT_MESSAGE, [], model);
  }

  if (schedulingFollowUp && !isCalendarQueryTurn(utterance) && !isOfferSpecificSlotRequest(utterance)) {
    const merged = await syncAgentSchedulingState(agentCtx.userId, userTurns, tz);
    if (merged) {
      if (isSchedulingTaskReady(merged)) {
        const executed = await tryExecuteSchedulingTask(merged, agentCtx);
        if (executed) {
          await clearAgentSchedulingTask(agentCtx.userId);
          return prefilterResult('scheduling_execute', executed.reply, executed.toolCalls, model);
        }
      }
      // Task in progress — defer to agent loop; never fall through to scheduling-link prefilter.
      return { bypassed: false };
    }
  }

  const assembled =
    schedulingFollowUp && !isCalendarQueryTurn(utterance)
      ? null
      : tryAssembleRecurringBlockFromTurns(userTurns, tz);
  if (assembled) {
    const result = await executeAgentTool('create_recurring_block', assembled, agentCtx);
    const reply = result.ok
      ? (typeof result.data === 'object' &&
        result.data !== null &&
        'message' in result.data &&
        typeof (result.data as { message: string }).message === 'string'
          ? (result.data as { message: string }).message
          : `Your daily ${assembled.label} block is set from ${assembled.startTime} to ${assembled.endTime}.`)
      : (result.error ?? 'I could not create that block.');
    return prefilterResult(
      'protect_block',
      reply,
      [{ name: 'create_recurring_block', input: assembled, result }],
      model,
    );
  }

  const protectIntent = tryProtectBlockFromInfer(combinedUtterance, tz);
  if (protectIntent?.intent === 'PROTECT_BLOCK') {
    const input = protectParamsToBlockInput(protectIntent.params ?? {});
    const result = await executeAgentTool('create_recurring_block', input, agentCtx);
    const reply = result.ok
      ? (typeof result.data === 'object' &&
        result.data !== null &&
        'message' in result.data &&
        typeof (result.data as { message: string }).message === 'string'
          ? (result.data as { message: string }).message
          : 'Your recurring block is set.')
      : (result.error ?? 'I could not create that block.');
    return prefilterResult('protect_block', reply, [{ name: 'create_recurring_block', input, result }], model);
  }

  const explicitLinkOnly =
    /\b(send|share|create|forward|email)\b[\s\S]{0,100}\b(link|scheduling\s+link|booking\s+link|invite\s+link)\b/i.test(
      utterance,
    ) ||
    /\bfind\s+time\b/i.test(utterance) ||
    isOfferSpecificSlotRequest(utterance);
  const linkHit = tryMatchSchedulingLink(utterance);
  if (linkHit?.inviteeEmail && (!schedulingFollowUp || explicitLinkOnly)) {
    const duration = extractDurationMinutes(utterance);
    const input = {
      inviteeEmail: linkHit.inviteeEmail,
      ...(duration ? { durationMinutes: duration } : {}),
    };
    const lookup = await executeAgentTool('lookup_user', { email: linkHit.inviteeEmail }, agentCtx);
    const invite = await executeAgentTool('send_invite', input, agentCtx);
    const inviteMessage =
      invite.ok &&
      typeof invite.data === 'object' &&
      invite.data !== null &&
      'message' in invite.data &&
      typeof (invite.data as { message: string }).message === 'string'
        ? (invite.data as { message: string }).message
        : null;
    const reply = invite.ok
      ? (inviteMessage ?? `I sent a scheduling invite to ${linkHit.inviteeEmail}.`)
      : (invite.error ?? 'I could not send that invite.');
    return prefilterResult(
      'scheduling_link',
      reply,
      [
        { name: 'lookup_user', input: { email: linkHit.inviteeEmail }, result: lookup },
        { name: 'send_invite', input, result: invite },
      ],
      model,
    );
  }

  return { bypassed: false };
}
