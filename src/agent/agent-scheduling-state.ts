import { DateTime } from 'luxon';
import { getSupabase } from '../db/client.js';
import { config } from '../config.js';
import type { AgentContext, AgentMessage } from './types.js';
import { executeAgentTool } from './tools/registry.js';
import { isAffirmation, isBookIntent, isBlockIntent } from './intent-signals.js';
import { isCalendarQueryTurn } from './agent-label-inference.js';

export const AGENT_SCHEDULING_FRAME_TYPE = 'agent_scheduling_task';

export type AgentSchedulingTask = {
  taskType: 'book' | 'invite';
  inviteeEmail?: string;
  meetingTitle?: string;
  dateText?: string;
  timeText?: string;
  /** IANA zone when user specified one (e.g. IST → Asia/Kolkata). */
  sourceTimeZone?: string;
  durationMinutes?: number;
  updatedAt: string;
};

const TZ_ALIASES: Record<string, string> = {
  ist: 'Asia/Kolkata',
  cdt: 'America/Chicago',
  cst: 'America/Chicago',
  cst6cdt: 'America/Chicago',
  est: 'America/New_York',
  edt: 'America/New_York',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  mst: 'America/Denver',
  mdt: 'America/Denver',
  utc: 'UTC',
  gmt: 'UTC',
};

const DAY_NAME: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  fri: 5,
  sat: 6,
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const TIME_WITH_TZ_RE =
  /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:ist|cdt|cst|est|edt|pst|pdt|mst|mdt|utc|gmt)\b/i;
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
const DAY_ONLY_RE =
  /^(?:on\s+)?(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|fri|sat|sun)\.?$/i;

const memoryTasks = new Map<string, { task: AgentSchedulingTask; expiresAt: number }>();
let useInMemoryOnly = false;

export function _setAgentSchedulingStorageForTests(inMemory: boolean): void {
  useInMemoryOnly = inMemory;
  if (inMemory) memoryTasks.clear();
}

function ttlMs(): number {
  return config.conversationSessionMinutes * 60 * 1000;
}

function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_RE);
  return matches ? [...new Set(matches.map((e) => e.toLowerCase()))] : [];
}

function extractTimeZoneToken(text: string): string | undefined {
  const m = text.match(/\b(ist|cdt|cst|est|edt|pst|pdt|mst|mdt|utc|gmt)\b/i);
  if (!m) return undefined;
  return TZ_ALIASES[m[1]!.toLowerCase()];
}

function parseHourMinute(h: number, m: number, ampm?: string, eveningContext = false): number[] {
  let hour = h;
  const minute = m;
  if (ampm) {
    const ap = ampm.toLowerCase();
    if (ap === 'pm' && hour < 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
  } else if (eveningContext && hour >= 1 && hour <= 11) {
    hour += 12;
  }
  return [hour, minute];
}

/** Standalone follow-up times: "10", "10:30", "10 pm ist", "10 ist". */
const BARE_TIME_FOLLOWUP_RE =
  /^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(ist|cdt|cst|est|edt|pst|pdt|mst|mdt|utc|gmt)?\.?$/i;

export function extractSchedulingTime(text: string): {
  timeText?: string;
  hour: number;
  minute: number;
  sourceTimeZone?: string;
} | null {
  const lower = text.toLowerCase();
  const eveningContext = /\b(evening|night|pm|ist)\b/.test(lower);

  const withTz = text.match(TIME_WITH_TZ_RE);
  if (withTz) {
    const [hour, minute] = parseHourMinute(
      parseInt(withTz[1]!, 10),
      withTz[2] ? parseInt(withTz[2], 10) : 0,
      withTz[3],
      true,
    );
    const tz = extractTimeZoneToken(withTz[0]!);
    return {
      timeText: withTz[0]!.trim(),
      hour,
      minute,
      ...(tz ? { sourceTimeZone: tz } : {}),
    };
  }

  const plain = text.match(TIME_RE);
  if (plain) {
    const [hour, minute] = parseHourMinute(
      parseInt(plain[1]!, 10),
      plain[2] ? parseInt(plain[2], 10) : 0,
      plain[3],
      eveningContext,
    );
    return { timeText: plain[0]!.trim(), hour, minute };
  }

  const atHour = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (atHour) {
    const h = parseInt(atHour[1]!, 10);
    const inferPm = eveningContext || (!atHour[3] && h >= 8 && h <= 11);
    const [hour, minute] = parseHourMinute(
      h,
      atHour[2] ? parseInt(atHour[2], 10) : 0,
      atHour[3],
      inferPm,
    );
    return {
      timeText: atHour[0]!.trim(),
      hour,
      minute,
      ...(extractTimeZoneToken(text) ? { sourceTimeZone: extractTimeZoneToken(text) } : {}),
    };
  }

  const bare = text.trim().match(BARE_TIME_FOLLOWUP_RE);
  if (bare) {
    const h = parseInt(bare[1]!, 10);
    const tzToken = bare[4];
    const inferPm =
      eveningContext ||
      Boolean(tzToken) ||
      (!bare[3] && (h === 10 || (h >= 8 && h <= 11)));
    const [hour, minute] = parseHourMinute(
      h,
      bare[2] ? parseInt(bare[2], 10) : 0,
      bare[3],
      inferPm,
    );
    const tz = tzToken ? TZ_ALIASES[tzToken.toLowerCase()] : extractTimeZoneToken(text);
    return {
      timeText: bare[0]!.trim(),
      hour,
      minute,
      ...(tz ? { sourceTimeZone: tz } : {}),
    };
  }

  return null;
}

function extractDateText(text: string): string | undefined {
  const trimmed = text.trim();
  if (DAY_ONLY_RE.test(trimmed)) {
    const m = trimmed.match(DAY_ONLY_RE);
    return m?.[1]?.toLowerCase();
  }
  for (const name of Object.keys(DAY_NAME)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(text)) return name;
  }
  if (/\btoday\b/i.test(text)) return 'today';
  if (/\btomorrow\b/i.test(text)) return 'tomorrow';
  return undefined;
}

function inferMeetingTitle(text: string): string | undefined {
  const withMatch = text.match(/\b(?:with|for)\s+([A-Za-z][\w.-]*(?:\s+[A-Za-z][\w.-]*)?)\b/);
  if (withMatch?.[1] && !withMatch[1].includes('@')) {
    return `Meeting with ${withMatch[1].trim()}`;
  }
  if (/\bmeeting\b/i.test(text)) return 'Meeting';
  if (/\bcall\b/i.test(text)) return 'Call';
  if (/\bsync\b/i.test(text)) return 'Sync';
  return undefined;
}

export function mergeSchedulingTask(
  existing: AgentSchedulingTask | null,
  userTurns: string[],
  hostTimezone: string,
): AgentSchedulingTask | null {
  const combined = userTurns.join(' ').trim();
  if (!combined) return existing;

  const lower = combined.toLowerCase();
  const hasInviteSignal =
    extractEmails(combined).length > 0 ||
    /\b(invite|send.*link|scheduling link)\b/i.test(combined);
  const hasBookSignal = isBookIntent(combined) && !isBlockIntent(combined);

  if (!existing && !hasInviteSignal && !hasBookSignal) {
    return null;
  }

  const taskType: 'book' | 'invite' =
    existing?.taskType ?? (hasInviteSignal && !hasBookSignal ? 'invite' : 'book');

  const emails = extractEmails(combined);
  const timeInfo = extractSchedulingTime(combined);
  const dateText = extractDateText(userTurns[userTurns.length - 1] ?? '') ?? extractDateText(combined);

  const task: AgentSchedulingTask = {
    taskType: existing?.taskType ?? taskType,
    updatedAt: new Date().toISOString(),
    ...(existing?.inviteeEmail ? { inviteeEmail: existing.inviteeEmail } : {}),
    ...(existing?.meetingTitle ? { meetingTitle: existing.meetingTitle } : {}),
    ...(existing?.dateText ? { dateText: existing.dateText } : {}),
    ...(existing?.timeText ? { timeText: existing.timeText } : {}),
    ...(existing?.sourceTimeZone ? { sourceTimeZone: existing.sourceTimeZone } : {}),
    ...(existing?.durationMinutes ? { durationMinutes: existing.durationMinutes } : {}),
  };

  if (emails.length > 0) task.inviteeEmail = emails[0];
  if (timeInfo) {
    task.timeText = timeInfo.timeText;
    if (timeInfo.sourceTimeZone) task.sourceTimeZone = timeInfo.sourceTimeZone;
  }
  if (dateText) task.dateText = dateText;

  const title = inferMeetingTitle(combined);
  if (title && !task.meetingTitle) task.meetingTitle = title;

  const dur = lower.match(/\b(\d+)\s*(?:min(?:ute)?s?|m)\b/);
  if (dur) task.durationMinutes = parseInt(dur[1]!, 10);

  if (!task.meetingTitle && task.inviteeEmail) {
    task.meetingTitle = `Meeting with ${task.inviteeEmail.split('@')[0]}`;
  }

  void hostTimezone;
  return task;
}

export function isSchedulingFollowUp(
  utterance: string,
  task: AgentSchedulingTask | null,
  history: AgentMessage[],
): boolean {
  if (task) return true;

  const t = utterance.trim();
  const userTurns = [...history.filter((m) => m.role === 'user').map((m) => m.content), utterance];
  const combined = userTurns.join(' ');

  if (history.length === 0) {
    return (
      extractEmails(t).length > 0 ||
      isBookIntent(t) ||
      /\b(invite|send.*link|scheduling link)\b/i.test(t)
    );
  }

  if (isCalendarQueryTurn(t)) return false;
  if (extractEmails(t).length > 0 && t.length < 80) return true;
  if (DAY_ONLY_RE.test(t)) return true;
  if (isAffirmation(t)) return true;
  if (extractSchedulingTime(t)) return true;

  return isBookIntent(combined) || extractEmails(combined).length > 0;
}

/** Merge user turns into durable task state and persist when tracking applies. */
export async function syncAgentSchedulingState(
  userId: string,
  userTurns: string[],
  hostTimezone: string,
): Promise<AgentSchedulingTask | null> {
  const existing = await getAgentSchedulingTask(userId).catch(() => null);
  const merged = mergeSchedulingTask(existing, userTurns, hostTimezone);
  if (!merged) {
    if (existing) await clearAgentSchedulingTask(userId);
    return null;
  }
  await saveAgentSchedulingTask(userId, merged);
  return merged;
}

export function buildSchedulingTaskContextLines(task: AgentSchedulingTask | null | undefined): string[] {
  if (!task) return [];
  const lines = [`Structured task state (${task.taskType}):`];
  if (task.inviteeEmail) lines.push(`- Invitee email: ${task.inviteeEmail} — do NOT re-ask`);
  if (task.meetingTitle) lines.push(`- Meeting title: ${task.meetingTitle}`);
  if (task.dateText) lines.push(`- Date: ${task.dateText} — do NOT re-ask`);
  if (task.timeText) {
    const tzNote = task.sourceTimeZone ? ` (${task.sourceTimeZone})` : '';
    lines.push(`- Time: ${task.timeText}${tzNote} — do NOT re-ask`);
  }
  if (task.durationMinutes) lines.push(`- Duration: ${task.durationMinutes} min`);
  const missing = schedulingTaskMissingFields(task);
  if (missing.length > 0) lines.push(`- Still needed: ${missing.join(', ')}`);
  else lines.push('- Status: all required fields captured — act with tools');
  return lines;
}

export function schedulingTaskMissingFields(task: AgentSchedulingTask): string[] {
  const missing: string[] = [];
  if (!task.timeText) missing.push('time');
  if (!task.dateText) missing.push('date');
  if (task.taskType === 'invite' && !task.inviteeEmail) missing.push('invitee email');
  const title =
    task.meetingTitle ?? (task.inviteeEmail ? `Meeting with ${task.inviteeEmail.split('@')[0]}` : undefined);
  if (!title) missing.push('meeting title');
  return missing;
}

export function isSchedulingTaskReady(task: AgentSchedulingTask): boolean {
  const title =
    task.meetingTitle ?? (task.inviteeEmail ? `Meeting with ${task.inviteeEmail.split('@')[0]}` : undefined);
  return (
    Boolean(task.timeText) &&
    Boolean(task.dateText) &&
    Boolean(title) &&
    (task.taskType !== 'invite' || Boolean(task.inviteeEmail))
  );
}

function resolveDayStart(dateText: string, zone: string): DateTime {
  const now = DateTime.now().setZone(zone).startOf('day');
  const key = dateText.toLowerCase();
  if (key === 'today') return now;
  if (key === 'tomorrow') return now.plus({ days: 1 });

  const targetDow = DAY_NAME[key];
  if (targetDow === undefined) return now;

  let cursor = now;
  for (let i = 0; i < 8; i += 1) {
    if (cursor.weekday % 7 === targetDow) {
      if (i === 0 && cursor <= DateTime.now().setZone(zone)) {
        cursor = cursor.plus({ weeks: 1 });
        continue;
      }
      return cursor;
    }
    cursor = cursor.plus({ days: 1 });
  }
  return now;
}

/** Resolve task date+time to ISO start in the host calendar timezone. */
export function resolveTaskStartIso(task: AgentSchedulingTask, hostTimezone: string): string | null {
  if (!task.dateText) return null;
  const combined = `${task.dateText} ${task.timeText ?? ''}`;
  const timeInfo = extractSchedulingTime(combined) ?? extractSchedulingTime(task.timeText ?? '');
  if (!timeInfo) return null;

  const eventZone = task.sourceTimeZone ?? hostTimezone;
  const dayStart = resolveDayStart(task.dateText, eventZone);
  const start = dayStart.set({
    hour: timeInfo.hour,
    minute: timeInfo.minute,
    second: 0,
    millisecond: 0,
  });
  if (!start.isValid) return null;

  return start.setZone(hostTimezone).toISO() ?? null;
}

function frameToTask(frame: Record<string, unknown>): AgentSchedulingTask | null {
  if (frame.type !== AGENT_SCHEDULING_FRAME_TYPE) return null;
  const taskType = frame.taskType === 'invite' ? 'invite' : 'book';
  return {
    taskType,
    ...(typeof frame.inviteeEmail === 'string' ? { inviteeEmail: frame.inviteeEmail } : {}),
    ...(typeof frame.meetingTitle === 'string' ? { meetingTitle: frame.meetingTitle } : {}),
    ...(typeof frame.dateText === 'string' ? { dateText: frame.dateText } : {}),
    ...(typeof frame.timeText === 'string' ? { timeText: frame.timeText } : {}),
    ...(typeof frame.sourceTimeZone === 'string' ? { sourceTimeZone: frame.sourceTimeZone } : {}),
    ...(typeof frame.durationMinutes === 'number' ? { durationMinutes: frame.durationMinutes } : {}),
    updatedAt: String(frame.updatedAt ?? new Date().toISOString()),
  };
}

export async function getAgentSchedulingTask(userId: string): Promise<AgentSchedulingTask | null> {
  const mem = memoryTasks.get(userId);
  if (mem && mem.expiresAt >= Date.now()) return mem.task;
  if (useInMemoryOnly) return null;

  const { data, error } = await getSupabase()
    .from('pending_clarification_frames')
    .select('frame, expires_at')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) return mem?.task ?? null;

  for (const row of data ?? []) {
    const task = frameToTask(row.frame as Record<string, unknown>);
    if (task) {
      memoryTasks.set(userId, { task, expiresAt: Date.parse(String(row.expires_at)) });
      return task;
    }
  }
  return null;
}

async function clearSchedulingFrame(userId: string): Promise<void> {
  memoryTasks.delete(userId);
  if (useInMemoryOnly) return;

  const { data, error } = await getSupabase()
    .from('pending_clarification_frames')
    .select('id, frame')
    .eq('user_id', userId);
  if (error) return;
  for (const row of data ?? []) {
    if ((row.frame as { type?: string }).type === AGENT_SCHEDULING_FRAME_TYPE) {
      await getSupabase().from('pending_clarification_frames').delete().eq('id', row.id);
    }
  }
}

export async function saveAgentSchedulingTask(
  userId: string,
  task: AgentSchedulingTask,
): Promise<void> {
  const expiresAt = Date.now() + ttlMs();
  memoryTasks.set(userId, { task, expiresAt });

  if (useInMemoryOnly) return;

  await clearSchedulingFrame(userId).catch(() => undefined);
  const frame = {
    type: AGENT_SCHEDULING_FRAME_TYPE,
    ...task,
  };
  const { error } = await getSupabase().from('pending_clarification_frames').insert({
    user_id: userId,
    frame,
    expires_at: new Date(expiresAt).toISOString(),
  });
  if (error) return;
}

export async function clearAgentSchedulingTask(userId: string): Promise<void> {
  await clearSchedulingFrame(userId);
}

export type SchedulingExecutionResult = {
  reply: string;
  toolCalls: Array<{ name: string; input: unknown; result: Awaited<ReturnType<typeof executeAgentTool>> }>;
};

export async function tryExecuteSchedulingTask(
  task: AgentSchedulingTask,
  ctx: AgentContext,
): Promise<SchedulingExecutionResult | null> {
  if (!isSchedulingTaskReady(task)) return null;

  const startIso = resolveTaskStartIso(task, ctx.timezone);
  if (!startIso) return null;

  const title = task.meetingTitle ?? 'Meeting';
  const durationMinutes = task.durationMinutes ?? ctx.policy.defaultMeetingLengthMinutes;

  if (task.taskType === 'invite' && task.inviteeEmail) {
    const lookup = await executeAgentTool('lookup_user', { email: task.inviteeEmail }, ctx);
    const inviteInput = {
      inviteeEmail: task.inviteeEmail,
      durationMinutes,
      meetingTitle: title,
      proposedSlots: [{ start: startIso }],
    };
    const invite = await executeAgentTool('send_invite', inviteInput, ctx);
    const reply = invite.ok
      ? `I've scheduled ${title} for ${formatLocalTime(startIso, ctx.timezone)} and sent an invite to ${task.inviteeEmail}.`
      : (invite.error ?? 'I could not send that invite.');
    return {
      reply,
      toolCalls: [
        { name: 'lookup_user', input: { email: task.inviteeEmail }, result: lookup },
        { name: 'send_invite', input: inviteInput, result: invite },
      ],
    };
  }

  const createInput = {
    title,
    start: startIso,
    durationMinutes,
    ...(task.inviteeEmail ? { attendeeEmail: task.inviteeEmail } : {}),
  };
  const created = await executeAgentTool('create_event', createInput, ctx);
  const reply = created.ok
    ? `Done — ${title} is on your calendar for ${formatLocalTime(startIso, ctx.timezone)}${
        task.inviteeEmail ? ` with ${task.inviteeEmail}` : ''
      }.`
    : (created.error ?? 'I could not create that event.');
  return {
    reply,
    toolCalls: [{ name: 'create_event', input: createInput, result: created }],
  };
}

function formatLocalTime(iso: string, timezone: string): string {
  const dt = DateTime.fromISO(iso, { setZone: true });
  if (!dt.isValid) return iso;
  return dt.setZone(timezone).toFormat('cccc, MMM d h:mm a ZZZZ');
}
