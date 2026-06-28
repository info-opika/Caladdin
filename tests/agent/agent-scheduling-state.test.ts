import { describe, it, expect, beforeEach } from 'vitest';
import {
  _setAgentSchedulingStorageForTests,
  buildSchedulingTaskContextLines,
  clearAgentSchedulingTask,
  extractSchedulingTime,
  getAgentSchedulingTask,
  isSchedulingFollowUp,
  isSchedulingTaskReady,
  mergeSchedulingTask,
  resolveTaskStartIso,
  saveAgentSchedulingTask,
  syncAgentSchedulingState,
} from '../../src/agent/agent-scheduling-state.js';
import type { AgentMessage } from '../../src/agent/types.js';

const USER = '22222222-2222-4222-8222-222222222222';

describe('agent scheduling state', () => {
  beforeEach(async () => {
    _setAgentSchedulingStorageForTests(true);
    await clearAgentSchedulingTask(USER);
  });

  it('extracts email, date, and time with timezone from combined utterance', () => {
    const task = mergeSchedulingTask(
      null,
      ['Invite aniket@opika.co for a sync on monday at 10 pm ist'],
      'America/Chicago',
    );
    expect(task?.inviteeEmail).toBe('aniket@opika.co');
    expect(task?.dateText).toBe('monday');
    expect(task?.timeText).toMatch(/10 pm ist/i);
    expect(task?.sourceTimeZone).toBe('Asia/Kolkata');
  });

  it('preserves invitee email when follow-up only adds a day', () => {
    const first = mergeSchedulingTask(
      null,
      ['Invite aniket@opika.co to a meeting'],
      'America/Chicago',
    );
    expect(first?.inviteeEmail).toBe('aniket@opika.co');

    const second = mergeSchedulingTask(first, ['Invite aniket@opika.co to a meeting', 'monday'], 'America/Chicago');
    expect(second?.inviteeEmail).toBe('aniket@opika.co');
    expect(second?.dateText).toBe('monday');
  });

  it('persists and reloads structured task state', async () => {
    const task = mergeSchedulingTask(null, ['Schedule with bob@co.com Friday 3pm'], 'America/Chicago');
    expect(task).not.toBeNull();
    await saveAgentSchedulingTask(USER, task!);

    const loaded = await getAgentSchedulingTask(USER);
    expect(loaded?.inviteeEmail).toBe('bob@co.com');
    expect(loaded?.dateText).toBe('friday');
  });

  it('syncAgentSchedulingState merges across turns', async () => {
    await syncAgentSchedulingState(USER, ['Invite aniket@opika.co'], 'America/Chicago');
    const afterDay = await syncAgentSchedulingState(
      USER,
      ['Invite aniket@opika.co', 'monday at 10 pm ist'],
      'America/Chicago',
    );
    expect(afterDay?.inviteeEmail).toBe('aniket@opika.co');
    expect(afterDay?.dateText).toBe('monday');
    expect(afterDay?.timeText).toMatch(/10 pm ist/i);
  });

  it('marks task ready when all invite fields present', () => {
    const task = mergeSchedulingTask(
      null,
      ['Invite aniket@opika.co Monday at 10 pm ist for sync'],
      'America/Chicago',
    );
    expect(task).not.toBeNull();
    expect(isSchedulingTaskReady(task!)).toBe(true);
  });

  it('buildSchedulingTaskContextLines tells model not to re-ask known fields', () => {
    const task = mergeSchedulingTask(
      null,
      ['Invite aniket@opika.co on monday'],
      'America/Chicago',
    );
    const lines = buildSchedulingTaskContextLines(task);
    expect(lines.join('\n')).toContain('aniket@opika.co');
    expect(lines.join('\n')).toContain('do NOT re-ask');
    expect(lines.join('\n')).toContain('monday');
  });

  it('detects scheduling follow-up on first turn with email', () => {
    expect(isSchedulingFollowUp('Invite aniket@opika.co', null, [])).toBe(true);
  });

  it('detects day-only follow-up when task exists', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: 'Invite aniket@opika.co' },
      { role: 'assistant', content: 'What day works?' },
    ];
    const task = mergeSchedulingTask(null, ['Invite aniket@opika.co'], 'America/Chicago');
    expect(isSchedulingFollowUp('monday', task, history)).toBe(true);
  });

  it('resolveTaskStartIso converts IST time on named weekday', () => {
    const task = mergeSchedulingTask(
      { taskType: 'invite', inviteeEmail: 'aniket@opika.co', updatedAt: new Date().toISOString() },
      ['monday at 10 pm ist'],
      'America/Chicago',
    );
    expect(task?.dateText).toBe('monday');
    const iso = resolveTaskStartIso(task!, 'America/Chicago');
    expect(iso).toBeTruthy();
    expect(extractSchedulingTime('10 pm ist')?.hour).toBe(22);
  });

  it('keeps morning times when am is explicit', () => {
    expect(extractSchedulingTime('7:30 am')?.hour).toBe(7);
    expect(extractSchedulingTime('9:30 am')?.hour).toBe(9);
  });

  it('does not PM-infer bare 7 o clock', () => {
    expect(extractSchedulingTime('7')?.hour).toBe(7);
    expect(extractSchedulingTime('7:30')?.hour).toBe(7);
  });

  it('PM-infers ambiguous bare 10 for evening scheduling', () => {
    expect(extractSchedulingTime('10')?.hour).toBe(22);
    expect(extractSchedulingTime('10 pm ist')?.hour).toBe(22);
    expect(extractSchedulingTime('10 ist')?.sourceTimeZone).toBe('Asia/Kolkata');
  });

  it('executes on yes when task already complete', async () => {
    const task = mergeSchedulingTask(
      null,
      ['Invite aniket@opika.co Monday at 10 pm ist for sync'],
      'America/Chicago',
    );
    expect(isSchedulingTaskReady(task!)).toBe(true);
    expect(isSchedulingFollowUp('yes', task, [{ role: 'assistant', content: 'Shall I send the invite?' }])).toBe(true);
  });
});
