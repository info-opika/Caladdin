import { DateTime } from 'luxon';
import { tryProtectBlockFromInfer } from '../core/protect-block-prefilter.js';
import { tryMatchQueryCalendar } from '../core/query-prefilter.js';
import { tryMatchSchedulingLink, extractDurationMinutes } from '../core/scheduling-link-prefilter.js';
import { isCalendarRelated } from '../services/llm.js';
import { WARM_REDIRECT_MESSAGE } from '../core/adts.js';
import { executeAgentTool } from './tools/registry.js';
import { tryAssembleRecurringBlockFromTurns } from './recurring-block-assembler.js';
import type { AgentContext, AgentMessage, SchedulingAgentResult } from './types.js';

export type AgentPrefilterOutcome =
  | { bypassed: false }
  | ({ bypassed: true; prefilter: string } & SchedulingAgentResult);

function formatEventTimeLabel(iso: string, timezone: string): string {
  const dt = DateTime.fromISO(iso, { setZone: true });
  if (!dt.isValid) return iso;
  return dt.setZone(timezone).toFormat('ccc M/d h:mm a');
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
  if (query.day === 'today' || query.queryType === 'today') {
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

/** Deterministic prefilters before LLM — protect block, query, invite link, off-topic. */
export async function runAgentPrefilter(
  utterance: string,
  agentCtx: AgentContext,
  model: string,
  history: AgentMessage[] = [],
): Promise<AgentPrefilterOutcome> {
  const tz = agentCtx.timezone;
  const sessionActive = history.length > 0;

  if (!isCalendarRelated(utterance, { activeAgentSession: sessionActive })) {
    return prefilterResult('off_topic', WARM_REDIRECT_MESSAGE, [], model);
  }

  const userTurns = [
    ...history.filter((m) => m.role === 'user').map((m) => m.content),
    utterance,
  ];
  const combinedUtterance = userTurns.join(' ');

  const queryHit = tryMatchQueryCalendar(utterance);
  if (queryHit && (queryHit.queryType === 'today' || queryHit.queryType === 'tomorrow' || queryHit.weekRangeKind)) {
    const range = queryParamsToRange(queryHit, tz);
    const result = await executeAgentTool('get_calendar_summary', range, agentCtx);
    return prefilterResult(
      'query',
      formatCalendarSummaryReply(result, tz),
      [{ name: 'get_calendar_summary', input: range, result }],
      model,
    );
  }

  const assembled = tryAssembleRecurringBlockFromTurns(userTurns, tz);
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

  const linkHit = tryMatchSchedulingLink(utterance);
  if (linkHit?.inviteeEmail) {
    const duration = extractDurationMinutes(utterance);
    const input = {
      inviteeEmail: linkHit.inviteeEmail,
      ...(duration ? { durationMinutes: duration } : {}),
    };
    const lookup = await executeAgentTool('lookup_user', { email: linkHit.inviteeEmail }, agentCtx);
    const invite = await executeAgentTool('send_invite', input, agentCtx);
    const reply = invite.ok
      ? `I sent a scheduling invite to ${linkHit.inviteeEmail}.`
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
