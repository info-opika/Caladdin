/**
 * Real-user-style scheduling scenarios — validates AI parsing AND calendar event payloads.
 *
 * Pipeline under test:
 *   utterance → parseIntent → enrichCreateParams → handleCreateEvent → GCal request body
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import {
  enrichCreateParams,
  extractRecurrenceFromUtterance,
  extractTitle,
  extractEmails,
  isNewEventInviteUtterance,
} from '../../src/core/param-extract.js';
import { extractTimezoneFromUtterance, getLocalPartsInTimezone } from '../../src/core/date-utils.js';
import { parseIntent } from '../../src/core/parser.js';
import { ParsedIntentSchema } from '../../src/core/adts.js';
import { config } from '../../src/config.js';
import { handleCreateEvent } from '../../src/handlers/create-event.js';
import { createEventWithSync } from '../../src/services/calendar_api.js';

// ── Scenario definitions ─────────────────────────────────────────────────────

type RecurrenceExpectation = {
  rrule?: string;
  byDay?: string[];
  freq?: 'DAILY' | 'WEEKLY';
  interval?: number;
  required: boolean;
};

type UserSchedulingScenario = {
  id: string;
  utterance: string;
  expectedIntent: 'CREATE_EVENT' | 'MODIFY_EVENT' | 'OFFER_SPECIFIC' | 'RESOLVE_MANUAL';
  title?: string;
  attendees?: string[];
  timezone?: string;
  hour?: number;
  minute?: number;
  recurrence: RecurrenceExpectation;
  /** Whether isNewEventInviteUtterance prefilter rescues intent without LLM */
  rescuedWithoutLlm?: boolean;
  notes?: string;
};

const PRIMARY_UTTERANCE =
  "Send an invite to aniket@opika.co and kanth@opika.co at 3 PM Central Time for 30 minutes. The invite should be recurring every weekday (Monday to Friday) and name the event as 'Vibecoding'. Please add an event description Invited by Caladdin";

const SCENARIOS: UserSchedulingScenario[] = [
  {
    id: 'vibecoding-weekday-recurring',
    utterance: PRIMARY_UTTERANCE,
    expectedIntent: 'CREATE_EVENT',
    title: 'Vibecoding',
    attendees: ['aniket@opika.co', 'kanth@opika.co'],
    timezone: 'America/Chicago',
    hour: 15,
    minute: 0,
    recurrence: {
      required: true,
      rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
      freq: 'WEEKLY',
    },
    rescuedWithoutLlm: true,
    notes: 'PRIMARY user-reported case',
  },
  {
    id: 'daily-standup-et-month',
    utterance: 'Schedule a daily standup at 9am ET every day for the next month',
    expectedIntent: 'CREATE_EVENT',
    title: 'daily standup',
    timezone: 'America/New_York',
    hour: 9,
    minute: 0,
    recurrence: { required: true, freq: 'DAILY' },
    rescuedWithoutLlm: true,
    notes: 'Keyword prefilter now routes "Schedule a …" to CREATE_EVENT',
  },
  {
    id: 'one-time-pacific',
    utterance: 'Book a meeting with john@example.com tomorrow at 2pm Pacific, one time only',
    expectedIntent: 'CREATE_EVENT',
    attendees: ['john@example.com'],
    timezone: 'America/Los_Angeles',
    hour: 14,
    minute: 0,
    recurrence: { required: false },
    rescuedWithoutLlm: true,
    notes: 'Keyword prefilter now routes "Book a meeting" to CREATE_EVENT',
  },
  {
    id: 'weekly-tuesday-central',
    utterance: 'Set up a weekly team sync every Tuesday at 10am Central',
    expectedIntent: 'CREATE_EVENT',
    title: 'team sync',
    timezone: 'America/Chicago',
    hour: 10,
    minute: 0,
    recurrence: { required: true, byDay: ['TU'], freq: 'WEEKLY' },
    rescuedWithoutLlm: true,
    notes: 'Keyword prefilter now routes "Set up a …" to CREATE_EVENT',
  },
  {
    id: 'biweekly-friday-sarah',
    utterance: 'Invite sarah@test.com to a biweekly meeting Fridays at 4pm',
    expectedIntent: 'CREATE_EVENT',
    attendees: ['sarah@test.com'],
    hour: 16,
    minute: 0,
    recurrence: { required: true, byDay: ['FR'], freq: 'WEEKLY', interval: 2 },
    rescuedWithoutLlm: true,
    notes: 'Intent rescued via invite prefilter; biweekly RRULE includes BYDAY=FR for plural Fridays',
  },
];

const EDGE_CASES = [
  {
    id: 'weekday-vs-daily',
    utterance: 'Create a recurring meeting every weekday at noon',
    expectedRrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    notRrule: 'RRULE:FREQ=DAILY',
  },
  {
    id: 'every-day-standalone',
    utterance: 'Schedule a standup every day at 9am',
    expectedRrule: 'RRULE:FREQ=DAILY',
    notes: '"every day" now maps to FREQ=DAILY without explicit "recurring" keyword',
  },
  {
    id: 'recurring-keyword-without-pattern',
    utterance: 'Create a recurring meeting with bob@test.com at 2pm',
    expectNoRrule: true,
  },
  {
    id: 'ambiguous-timezone-no-hint',
    utterance: 'Schedule a meeting at 3pm with alice@test.com',
    expectedTimezone: undefined,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseRruleDays(rrules: string[] | undefined): string[] {
  if (!rrules?.length) return [];
  const byDay = rrules[0].match(/BYDAY=([A-Z,]+)/)?.[1];
  return byDay ? byDay.split(',') : [];
}

function assertRecurrence(
  rrules: string[] | undefined,
  expected: RecurrenceExpectation,
  scenarioId: string,
): void {
  if (!expected.required) {
    expect(rrules, `${scenarioId}: should not have recurrence`).toBeUndefined();
    return;
  }
  expect(rrules, `${scenarioId}: recurrence rules missing`).toBeDefined();
  expect(rrules!.length, `${scenarioId}: expected at least one RRULE`).toBeGreaterThan(0);

  const rrule = rrules![0];
  if (expected.rrule) expect(rrule, `${scenarioId}: RRULE mismatch`).toBe(expected.rrule);
  if (expected.freq) expect(rrule, `${scenarioId}: FREQ`).toContain(`FREQ=${expected.freq}`);
  if (expected.byDay?.length) {
    const days = parseRruleDays(rrules);
    for (const d of expected.byDay) {
      expect(days, `${scenarioId}: missing BYDAY=${d}`).toContain(d);
    }
  }
  if (expected.interval) {
    expect(rrule, `${scenarioId}: INTERVAL=${expected.interval}`).toContain(`INTERVAL=${expected.interval}`);
  }
}

function assertWallClockInTimezone(
  isoStart: string | undefined,
  timezone: string,
  hour: number,
  minute: number,
  scenarioId: string,
): void {
  expect(isoStart, `${scenarioId}: start time missing`).toBeTruthy();
  const parts = getLocalPartsInTimezone(new Date(isoStart!), timezone);
  expect(parts.hour, `${scenarioId}: hour in ${timezone}`).toBe(hour);
  expect(parts.minute, `${scenarioId}: minute in ${timezone}`).toBe(minute);
}

// ── Mocks for handler / calendar_api layers ──────────────────────────────────

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockRecordLastEvent = vi.fn();

vi.mock('../../src/db/events.js', () => ({
  insertEvent: (...a: unknown[]) => mockInsert(...a),
  updateEvent: (...a: unknown[]) => mockUpdate(...a),
  cancelEvent: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock('../../src/db/compensation_queue.js', () => ({
  enqueueCompensation: vi.fn(),
}));

vi.mock('../../src/db/conversation-context.js', () => ({
  recordLastEvent: (...a: unknown[]) => mockRecordLastEvent(...a),
}));

function mockCal(insertId = 'gcal-1') {
  return {
    events: {
      insert: vi.fn().mockResolvedValue({ data: { id: insertId } }),
      patch: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      list: vi.fn().mockResolvedValue({ data: { items: [] } }),
    },
  } as unknown as import('googleapis').calendar_v3.Calendar;
}

const ctx = { userId: '00000000-0000-4000-8000-00000000cafe', timezone: 'America/Chicago' };

// ── PRIMARY CASE: full pipeline ──────────────────────────────────────────────

describe('PRIMARY — Vibecoding weekday recurring invite (full pipeline)', () => {
  const s = SCENARIOS[0];
  let savedKey: string;

  beforeEach(() => {
    vi.clearAllMocks();
    savedKey = config.freellmapiApiKey;
    (config as { freellmapiApiKey: string }).freellmapiApiKey = '';
    mockInsert.mockImplementation(async (_uid, event) => ({
      id: 'ev-vibecoding',
      userId: ctx.userId,
      ...event,
      gcalEventId: null,
    }));
    mockUpdate.mockImplementation(async (_id, patch) => ({
      id: 'ev-vibecoding',
      userId: ctx.userId,
      title: 'Vibecoding',
      gcalEventId: 'gcal-vibecoding',
      ...patch,
    }));
    mockRecordLastEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    (config as { freellmapiApiKey: string }).freellmapiApiKey = savedKey;
  });

  it('parseIntent classifies as CREATE_EVENT without LLM (invite prefilter)', async () => {
    const parsed = await parseIntent(s.utterance, ctx.userId);
    expect(parsed.intent).toBe('CREATE_EVENT');
    expect(isNewEventInviteUtterance(s.utterance)).toBe(true);
  });

  it('enrichCreateParams extracts title, attendees, RRULE, timezone, 30min, description', () => {
    const ref = DateTime.fromISO('2026-06-09T12:00:00', { zone: 'America/Chicago' }).toJSDate();
    vi.useFakeTimers();
    vi.setSystemTime(ref);
    try {
      const params = enrichCreateParams({}, s.utterance, ctx.timezone);
      expect(params.title).toBe('Vibecoding');
      expect(params.participants).toEqual(expect.arrayContaining(['aniket@opika.co', 'kanth@opika.co']));
      expect(params.description).toBe('Invited by Caladdin');
      expect(params.timeZone).toBe('America/Chicago');
      assertRecurrence(params.recurrence as string[] | undefined, s.recurrence, s.id);
      assertWallClockInTimezone(params.start as string, 'America/Chicago', 15, 0, s.id);
      const start = new Date(params.start as string);
      const end = new Date(params.end as string);
      expect((end.getTime() - start.getTime()) / 60000).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handleCreateEvent forwards recurrence + timezone to createEventWithSync', async () => {
    const ref = DateTime.fromISO('2026-06-09T12:00:00', { zone: 'America/Chicago' }).toJSDate();
    vi.useFakeTimers();
    vi.setSystemTime(ref);
    try {
      const parsed = await parseIntent(s.utterance, ctx.userId);
      const cal = mockCal();
      await handleCreateEvent(parsed, ctx, cal);

      const payload = mockInsert.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(payload.title).toBe('Vibecoding');
      expect(payload.participants).toEqual(expect.arrayContaining(['aniket@opika.co', 'kanth@opika.co']));
      expect(payload.description).toBe('Invited by Caladdin');
      expect(payload.isRecurring).toBe(true);
      expect(payload.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']);
      expect(payload.timeZone).toBe('America/Chicago');
      assertWallClockInTimezone(payload.start as string, 'America/Chicago', 15, 0, s.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('GCal insert requestBody includes recurrence, attendees, timezone-aware 3 PM', async () => {
    const ref = DateTime.fromISO('2026-06-09T12:00:00', { zone: 'America/Chicago' }).toJSDate();
    vi.useFakeTimers();
    vi.setSystemTime(ref);
    try {
      const params = enrichCreateParams({}, s.utterance, ctx.timezone);
      const cal = mockCal('gcal-vibecoding');
      await createEventWithSync(cal, ctx.userId, {
        title: params.title as string,
        start: params.start as string,
        end: params.end as string,
        tier: 2,
        status: 'confirmed',
        participants: params.participants as string[],
        description: params.description as string,
        isRecurring: true,
        recurrence: params.recurrence as string[],
        timeZone: params.timeZone as string,
      });

      const insertCall = vi.mocked(cal.events.insert).mock.calls[0]?.[0];
      expect(insertCall?.requestBody?.summary).toBe('Vibecoding');
      expect(insertCall?.requestBody?.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']);
      expect(insertCall?.requestBody?.attendees).toEqual(
        expect.arrayContaining([
          { email: 'aniket@opika.co' },
          { email: 'kanth@opika.co' },
        ]),
      );
      expect(insertCall?.requestBody?.description).toBe('Invited by Caladdin');
      expect(insertCall?.requestBody?.start).toEqual(
        expect.objectContaining({ timeZone: 'America/Chicago', dateTime: expect.stringMatching(/T15:00:00/) }),
      );
      expect(insertCall?.sendUpdates).toBe('all');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Param extraction for all scenarios ───────────────────────────────────────

describe('recurring scheduling — param extraction', () => {
  it('PRIMARY: regex layer extracts RRULE, title, email, timezone', () => {
    const s = SCENARIOS[0];
    assertRecurrence(extractRecurrenceFromUtterance(s.utterance), s.recurrence, s.id);
    expect(extractTitle(s.utterance)).toBe('Vibecoding');
    expect(extractEmails(s.utterance)).toEqual(
      expect.arrayContaining(['aniket@opika.co', 'kanth@opika.co']),
    );
    expect(extractTimezoneFromUtterance(s.utterance)).toBe('America/Chicago');
  });

  it('weekly Tuesday: extracts BYDAY=TU when "every Tuesday" present', () => {
    const s = SCENARIOS.find((x) => x.id === 'weekly-tuesday-central')!;
    const rrules = extractRecurrenceFromUtterance(s.utterance);
    assertRecurrence(rrules, s.recurrence, s.id);
  });

  it('one-time Pacific: no recurrence extracted', () => {
    const s = SCENARIOS.find((x) => x.id === 'one-time-pacific')!;
    assertRecurrence(extractRecurrenceFromUtterance(s.utterance), s.recurrence, s.id);
    expect(extractTimezoneFromUtterance(s.utterance)).toBe('America/Los_Angeles');
  });

  for (const edge of EDGE_CASES) {
    it(`edge case: ${edge.id}`, () => {
      const rrules = extractRecurrenceFromUtterance(edge.utterance);
      if ('expectedRrule' in edge && edge.expectedRrule) {
        expect(rrules?.[0]).toBe(edge.expectedRrule);
      }
      if ('notRrule' in edge && edge.notRrule) {
        expect(rrules?.[0]).not.toBe(edge.notRrule);
      }
      if ('expectNoRrule' in edge && edge.expectNoRrule) {
        expect(rrules).toBeUndefined();
      }
      if ('expectedTimezone' in edge) {
        expect(extractTimezoneFromUtterance(edge.utterance)).toBe(edge.expectedTimezone);
      }
    });
  }
});

// ── Known extraction gaps (expected failures) ────────────────────────────────

describe('recurring scheduling — known extraction gaps', () => {
  it.fails('desired: daily standup should add COUNT/UNTIL for "for the next month"', () => {
    const s = SCENARIOS.find((x) => x.id === 'daily-standup-et-month')!;
    const rrules = extractRecurrenceFromUtterance(s.utterance);
    expect(rrules?.[0]).toContain('COUNT=');
  });

  it('biweekly "Fridays" plural includes BYDAY=FR', () => {
    const s = SCENARIOS.find((x) => x.id === 'biweekly-friday-sarah')!;
    const rrules = extractRecurrenceFromUtterance(s.utterance);
    expect(rrules?.[0]).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR');
  });

  it('daily standup produces FREQ=DAILY without COUNT', () => {
    const s = SCENARIOS.find((x) => x.id === 'daily-standup-et-month')!;
    expect(extractRecurrenceFromUtterance(s.utterance)?.[0]).toBe('RRULE:FREQ=DAILY');
  });
});

// ── Parser intent without LLM ────────────────────────────────────────────────

describe('recurring scheduling — parser intent without LLM', () => {
  let savedKey: string;

  beforeEach(() => {
    savedKey = config.freellmapiApiKey;
    (config as { freellmapiApiKey: string }).freellmapiApiKey = '';
  });

  afterEach(() => {
    (config as { freellmapiApiKey: string }).freellmapiApiKey = savedKey;
  });

  for (const s of SCENARIOS.filter((x) => x.rescuedWithoutLlm)) {
    it(`rescued: ${s.id} → CREATE_EVENT via invite prefilter`, async () => {
      const result = await parseIntent(s.utterance, ctx.userId);
      expect(result.intent).toBe('CREATE_EVENT');
    });
  }

  for (const s of SCENARIOS.filter((x) => !x.rescuedWithoutLlm)) {
    it(`keyword path: ${s.id} → CREATE_EVENT`, async () => {
      const result = await parseIntent(s.utterance, ctx.userId);
      expect(
        result.intent,
        `"${s.utterance.slice(0, 60)}…" should be CREATE_EVENT`,
      ).toBe('CREATE_EVENT');
    });
  }
});

// ── Keyword-only parser path (LLM retired; agent handles rich scheduling) ────

describe('recurring scheduling — parser keyword path', () => {
  it('daily standup classified CREATE_EVENT via schedule keyword + enrich', async () => {
    const utterance = SCENARIOS.find((x) => x.id === 'daily-standup-et-month')!.utterance;
    const result = await parseIntent(utterance, ctx.userId);
    expect(result.intent).toBe('CREATE_EVENT');
    expect(result.params.recurrence?.length).toBeGreaterThan(0);
    expect(result.params.recurrence?.[0]).toContain('FREQ=DAILY');
  });

  it('one-time Pacific meeting with attendee via book keyword + enrich', async () => {
    const utterance = SCENARIOS.find((x) => x.id === 'one-time-pacific')!.utterance;
    const result = await parseIntent(utterance, ctx.userId);
    expect(result.intent).toBe('CREATE_EVENT');
    expect(result.params.participants).toContain('john@example.com');
    expect(result.params.timeZone).toBe('America/Los_Angeles');
  });
});

// ── Remaining gap inventory ──────────────────────────────────────────────────

describe('recurring scheduling — remaining gap inventory', () => {
  const GAPS = [
    'Bounded recurrence ("for the next month") — COUNT/UNTIL not parsed from natural language',
    'Ambiguous timezone utterances fall back to user policy timezone only at handler level',
  ];

  it.each(GAPS)('documented remaining gap: %s', (gap) => {
    expect(gap.length).toBeGreaterThan(20);
  });
});
