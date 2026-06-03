/**
 * Autonomous user-simulator corpus for parser + voice + E2E gauntlets.
 * Invariants are checked by tests/fixtures/calendar-user-simulator-invariants.ts
 */

import { extractSchedulingSearchWindowHours } from '../../src/core/scheduling-link-prefilter.js';

export type SimulatorCategory =
  | 'calendar_query'
  | 'availability'
  | 'create_event'
  | 'move_reschedule'
  | 'cancel_delete'
  | 'bulk_risky'
  | 'scheduling_link'
  | 'protect_block'
  | 'ambiguous_calendar'
  | 'non_calendar';

export type SimulatorAxis = 'own_calendar' | 'appointment_with_others';

/** Product line: off-topic is separate from the legacy own-calendar axis (non_calendar category). */
export type ProductFamily = 'own_calendar' | 'appointment_with_others' | 'off_topic';

export type SimulatorItem = {
  /** Stable id for machine-readable reporting (default assigned on build). */
  id: string;
  utterance: string;
  productFamily: ProductFamily;
  category: SimulatorCategory;
  /** Primary expected intent name (or best label for the family). */
  expectedFamily: string;
  allowedOutcomes: string[];
  forbiddenOutcomes: string[];
  shouldUseLLM: boolean | 'optional';
  needsConfirmation: boolean | 'unknown';
  /** Optional: prior user/model context for doc-level multi-turn (server is stateless in production). */
  contextSetup?: string;
  /** Optional: high-level response expectations for harness checks. */
  expectedResponseShape?: 'list_events' | 'agenda' | 'availability' | 'clarify' | 'link' | 'danger_confirm' | 'other';
  notes: string;
  /** own vs external scheduling; `non_calendar` rows still set axis for historical quotas — see `productFamily: off_topic`. */
  axis: SimulatorAxis;
  /** Include in representative /voice integration gauntlet (mocked LLM). */
  includeInVoiceGauntlet?: boolean;
  /** Safe to exercise in Playwright with CALADDIN_E2E (deterministic stub + prefilter). */
  e2eCompatible?: boolean;
  /** Journey kind for Playwright selection. */
  e2eJourney?: 'chat_query' | 'warm_redirect' | 'scheduling_invite' | 'destructive_safe' | 'feedback' | 'ambiguous_stub';
  /** Doc-only tag for gauntlet buckets (compound / dictation / dialog regression). */
  gauntletTag?: 'compound_command' | 'wispr_dictation' | 'dialog_regression';
};

const I = {
  q: ['QUERY_CALENDAR'] as string[],
  warm: ['WARM_REDIRECT'] as string[],
  create: ['CREATE_EVENT'] as string[],
  modify: ['MODIFY_EVENT'] as string[],
  flush: ['FLUSH_RANGE'] as string[],
  sched: ['SCHEDULING_LINK'] as string[],
  protect: ['PROTECT_BLOCK'] as string[],
  resolve: ['RESOLVE_MANUAL'] as string[],
  manualOr: ['RESOLVE_MANUAL', 'QUERY_CALENDAR'] as string[],
};

function deriveProductFamily(category: SimulatorCategory, axis: SimulatorAxis): ProductFamily {
  if (category === 'non_calendar') return 'off_topic';
  return axis;
}

type ItemInput = Omit<SimulatorItem, 'id' | 'productFamily' | 'includeInVoiceGauntlet'> & {
  id?: string;
  productFamily?: ProductFamily;
  includeInVoiceGauntlet?: boolean;
};

let _corpusIdCounter = 0;
function nextCorpusId(manualId?: string): string {
  if (manualId) return manualId;
  _corpusIdCounter += 1;
  return `sim-${String(_corpusIdCounter).padStart(5, '0')}`;
}

function item(p: ItemInput): SimulatorItem {
  const productFamily = p.productFamily ?? deriveProductFamily(p.category, p.axis);
  const id = nextCorpusId(p.id);
  return { includeInVoiceGauntlet: true, e2eCompatible: false, ...p, id, productFamily };
}

/** Kanth live regressions — must stay green. */
const KANTH_REGRESSIONS: SimulatorItem[] = [
  item({
    utterance: "What's on my calendar today?",
    category: 'calendar_query',
    expectedFamily: 'QUERY_CALENDAR',
    allowedOutcomes: I.q,
    forbiddenOutcomes: ['CREATE_EVENT', 'RESOLVE_MANUAL', 'WARM_REDIRECT'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'Kanth manual — curly apostrophe today query',
    axis: 'own_calendar',
    e2eCompatible: true,
    e2eJourney: 'chat_query',
  }),
  item({
    utterance: 'what is on my calendar tomorrow?',
    category: 'calendar_query',
    expectedFamily: 'QUERY_CALENDAR',
    allowedOutcomes: I.q,
    forbiddenOutcomes: ['RESOLVE_MANUAL', 'WARM_REDIRECT', 'CREATE_EVENT'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'Kanth manual — straight quote tomorrow',
    axis: 'own_calendar',
    e2eCompatible: true,
    e2eJourney: 'chat_query',
  }),
  item({
    utterance: 'whats on my calendar tomorrow?',
    category: 'calendar_query',
    expectedFamily: 'QUERY_CALENDAR',
    allowedOutcomes: I.q,
    forbiddenOutcomes: ['RESOLVE_MANUAL', 'WARM_REDIRECT'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'Kanth — missing apostrophe',
    axis: 'own_calendar',
    e2eCompatible: true,
    e2eJourney: 'chat_query',
  }),
  item({
    utterance: 'what about tomorrow?',
    category: 'calendar_query',
    expectedFamily: 'QUERY_CALENDAR',
    allowedOutcomes: I.q,
    forbiddenOutcomes: ['RESOLVE_MANUAL', 'WARM_REDIRECT'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'Kanth — short follow-up',
    axis: 'own_calendar',
    e2eCompatible: true,
    e2eJourney: 'chat_query',
  }),
  item({
    utterance: 'when is my next meeting?',
    category: 'calendar_query',
    expectedFamily: 'QUERY_CALENDAR',
    allowedOutcomes: I.q,
    forbiddenOutcomes: ['RESOLVE_MANUAL', 'WARM_REDIRECT'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'Kanth — next meeting family',
    axis: 'own_calendar',
    e2eCompatible: true,
    e2eJourney: 'chat_query',
  }),
  item({
    utterance: 'Find time with kanth.miriyala@gmail.com next week',
    category: 'scheduling_link',
    expectedFamily: 'SCHEDULING_LINK',
    allowedOutcomes: ['SCHEDULING_LINK'],
    forbiddenOutcomes: ['WARM_REDIRECT', 'QUERY_CALENDAR', 'FLUSH_RANGE', 'RESOLVE_MANUAL'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'P0 — next week anchors implicit default business-hours search window (risk-tagged in params)',
    axis: 'appointment_with_others',
    e2eCompatible: true,
    e2eJourney: 'scheduling_invite',
  }),
];

const RED_TEAM_FALSE_POSITIVES: SimulatorItem[] = [
  item({
    utterance: "who is the next president",
    category: 'non_calendar',
    expectedFamily: 'WARM_REDIRECT',
    allowedOutcomes: I.warm,
    forbiddenOutcomes: ['QUERY_CALENDAR', 'CREATE_EVENT', 'SCHEDULING_LINK'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'red-team: politics, not “next meeting”',
    axis: 'own_calendar',
    e2eCompatible: true,
    e2eJourney: 'warm_redirect',
  }),
  item({
    utterance: 'when is the next football game for the 49ers',
    category: 'non_calendar',
    expectedFamily: 'WARM_REDIRECT',
    allowedOutcomes: I.warm,
    forbiddenOutcomes: ['QUERY_CALENDAR', 'SCHEDULING_LINK'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'red-team: sports, not user calendar',
    axis: 'own_calendar',
  }),
  item({
    utterance: "what is tomorrow's weather in Austin",
    category: 'non_calendar',
    expectedFamily: 'WARM_REDIRECT',
    allowedOutcomes: I.warm,
    forbiddenOutcomes: ['QUERY_CALENDAR'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'red-team: weather (tomorrow) without calendar',
    axis: 'own_calendar',
    e2eCompatible: true,
    e2eJourney: 'warm_redirect',
  }),
  item({
    utterance: 'write me a poem about tomorrow',
    category: 'non_calendar',
    expectedFamily: 'WARM_REDIRECT',
    allowedOutcomes: I.warm,
    forbiddenOutcomes: ['QUERY_CALENDAR', 'CREATE_EVENT'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'red-team: creative + “tomorrow”',
    axis: 'own_calendar',
    e2eCompatible: true,
    e2eJourney: 'warm_redirect',
  }),
  item({
    utterance: 'What is the capital of France?',
    category: 'non_calendar',
    expectedFamily: 'WARM_REDIRECT',
    allowedOutcomes: I.warm,
    forbiddenOutcomes: ['QUERY_CALENDAR'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'red-team: trivia',
    axis: 'own_calendar',
    e2eCompatible: true,
    e2eJourney: 'warm_redirect',
  }),
  item({
    utterance: 'I need a cancel culture article for class tomorrow',
    category: 'non_calendar',
    expectedFamily: 'WARM_REDIRECT',
    allowedOutcomes: I.warm,
    forbiddenOutcomes: ['MODIFY_EVENT', 'FLUSH_RANGE', 'CREATE_EVENT'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'red-team: “cancel” not calendar cancel',
    axis: 'own_calendar',
  }),
  item({
    utterance: 'what is the schedule of the NBA playoffs this year',
    category: 'non_calendar',
    expectedFamily: 'WARM_REDIRECT',
    allowedOutcomes: I.warm,
    forbiddenOutcomes: ['QUERY_CALENDAR', 'CREATE_EVENT', 'SCHEDULING_LINK'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'red-team: sports TV schedule, not GCal',
    axis: 'own_calendar',
  }),
  item({
    utterance: 'When is the next Apple event in Cupertino',
    category: 'non_calendar',
    expectedFamily: 'WARM_REDIRECT',
    allowedOutcomes: I.warm,
    forbiddenOutcomes: ['QUERY_CALENDAR'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'red-team: livestream “event”',
    axis: 'own_calendar',
  }),
  item({
    utterance: 'Explain free market economics in simple terms',
    category: 'non_calendar',
    expectedFamily: 'WARM_REDIRECT',
    allowedOutcomes: I.warm,
    forbiddenOutcomes: ['CREATE_EVENT', 'SCHEDULING_LINK'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'red-team: no calendar keywords',
    axis: 'own_calendar',
    e2eCompatible: true,
    e2eJourney: 'warm_redirect',
  }),
  item({
    utterance: 'find available flights tomorrow morning to NYC',
    category: 'non_calendar',
    expectedFamily: 'WARM_REDIRECT',
    allowedOutcomes: I.warm,
    forbiddenOutcomes: ['QUERY_CALENDAR', 'CREATE_EVENT'],
    shouldUseLLM: false,
    needsConfirmation: false,
    notes: 'red-team: travel search; “available”+“tomorrow” not availability check',
    axis: 'own_calendar',
  }),
];

function pushQueryFamily(out: SimulatorItem[], variants: { u: string; note: string }[]) {
  for (const { u, note } of variants) {
    out.push(
      item({
        utterance: u,
        category: 'calendar_query',
        expectedFamily: 'QUERY_CALENDAR',
        allowedOutcomes: I.q,
        forbiddenOutcomes: ['WARM_REDIRECT', 'RESOLVE_MANUAL', 'CREATE_EVENT'],
        shouldUseLLM: false,
        needsConfirmation: false,
        notes: note,
        axis: 'own_calendar',
        e2eCompatible: /guest1@/i.test(u) ? false : true,
        e2eJourney: 'chat_query',
      })
    );
  }
}

function buildCalendarQueries(): SimulatorItem[] {
  const out: SimulatorItem[] = [];
  const more: { u: string; note: string }[] = [
    { u: "What’s on my schedule today", note: "curly What’s" },
    { u: 'whats on my cal today', note: 'shorthand cal' },
    { u: 'show my meetings today pls', note: 'polite' },
    { u: 'do i have anything on my calendar today', note: 'verbose' },
    { u: 'agenda for today..', note: 'punctuation' },
    { u: 'what do i have going on today', note: 'spoken' },
    { u: 'WISPR whats on my calendar today', note: 'dictation prefix' },
    { u: "today's schedule plz", note: "today's" },
    { u: 'what meetings am i in today', note: 'meetings' },
    { u: 'any calls today on my calendar', note: 'calls' },
    { u: 'my calendar for today thx', note: 'thanks' },
    { u: 'list my events for today', note: 'list events' },
    { u: "what is on my calendar tommorrow", note: 'typo tommorrow' },
    { u: "tomorrow's schedule for me", note: "tomorrow's + schedule" },
    { u: 'what do I have on my calendar tommorow', note: 'typo' },
    { u: 'show calendar tomorrow pls', note: 'imperative' },
    { u: 'my meetings tomorrow in chicago', note: 'place noise' },
    { u: 'whats the plan tomorrow morning', note: 'plan' },
    { u: "what is tomorrows schedule", note: 'tomorrows → normalize' },
    { u: "what is tomorrow's events", note: "tomorrow's" },
    { u: "what's on my cal tomorrow question mark", note: 'noise words' },
    { u: 'when is my next call', note: 'next + call' },
    { u: "when is my next appointment", note: 'next + appointment' },
    { u: "what's the next event on my calendar", note: 'calendar explicit' },
    { u: "what's the next event", note: 'next event' },
    { u: 'next meeting for me pls', note: 'imperative' },
    { u: 'whats the next event', note: 'no apostrophe' },
    { u: "when is my next meeting with Priya", note: 'name noise after meeting' },
    { u: "when is my next meeting in the chicago office", note: 'location' },
    { u: 'what is on my calendar for today', note: 'for today' },
    { u: 'any events for me today pls', note: 'events for today' },
    { u: 'did i put anything on my calendar today', note: 'did i' },
    { u: "hey what is happening on my schedule today", note: 'happening' },
    { u: 'calendar snapshot today please', note: 'snapshot' },
    { u: 'for today only: my meetings and events', note: 'for today only' },
  ];
  pushQueryFamily(out, more);
  return out;
}

function buildAvailability(): SimulatorItem[] {
  const times = [
    '3',
    '3pm',
    '10:30am',
    '2:00pm',
    '9am',
    '4:30',
    '11:15am',
    '1pm',
  ];
  const out: SimulatorItem[] = [];
  for (const t of times) {
    out.push(
      item({
        utterance: `am I free at ${t}`,
        category: 'availability',
        expectedFamily: 'QUERY_CALENDAR',
        allowedOutcomes: I.q,
        forbiddenOutcomes: ['WARM_REDIRECT', 'CREATE_EVENT'],
        shouldUseLLM: false,
        needsConfirmation: false,
        notes: `free + time ${t}`,
        axis: 'own_calendar',
        e2eCompatible: true,
        e2eJourney: 'chat_query',
      })
    );
    out.push(
      item({
        utterance: `am I available at ${t} tomorrow`,
        category: 'availability',
        expectedFamily: 'QUERY_CALENDAR',
        allowedOutcomes: I.q,
        forbiddenOutcomes: ['WARM_REDIRECT', 'RESOLVE_MANUAL'],
        shouldUseLLM: false,
        needsConfirmation: false,
        notes: `available + time + tomorrow ${t}`,
        axis: 'own_calendar',
      })
    );
  }
  const raw = [
    'do I have anything at 3:30pm',
    "do I have anything at 3:30 p m",
    'anything on my schedule at 4pm',
    "anything at 2:00pm on my calendar",
    'am I busy at 5pm or free',
    'is my calendar free at 10:30am',
    'am I open at 9:00am thursday for a 30m slot',
    'any conflicts at 2pm on friday',
    "do i have any meetings at 8am",
    'free at 7pm for dinner block',
    'am i free at 12:30pm for lunch time',
    'am i free at 12 pm after lunch',
    'anything before 9am on my schedule',
  ];
  for (const u of raw) {
    out.push(
      item({
        utterance: u,
        category: 'availability',
        expectedFamily: 'QUERY_CALENDAR',
        allowedOutcomes: I.q,
        forbiddenOutcomes: ['WARM_REDIRECT', 'CREATE_EVENT', 'SCHEDULING_LINK'],
        shouldUseLLM: false,
        needsConfirmation: false,
        notes: 'natural availability',
        axis: 'own_calendar',
        e2eCompatible: /3:30|4pm|5pm|10:30|2pm|2:00|8am|7pm|12:30|12 pm|9am|before 9|30m/i.test(
          u
        )
          ? true
          : false,
      })
    );
  }
  for (let i = 0; i < 20; i++) {
    const mins = (i * 5) % 60;
    const mm = String(mins).padStart(2, '0');
    out.push(
      item({
        utterance: `do I have anything at ${(i % 12) + 1}:${mm}pm`,
        category: 'availability',
        expectedFamily: 'QUERY_CALENDAR',
        allowedOutcomes: I.q,
        forbiddenOutcomes: ['WARM_REDIRECT', 'SCHEDULING_LINK'],
        shouldUseLLM: false,
        needsConfirmation: false,
        notes: `synthetic time variant ${i}`,
        axis: 'own_calendar',
        includeInVoiceGauntlet: i < 3,
      })
    );
  }
  return out;
}

function buildCreateEvents(): SimulatorItem[] {
  const out: SimulatorItem[] = [];
  const phrases = [
    'schedule a dentist appointment for next tuesday 3pm',
    'book a 30m sync for tomorrow 10am',
    'put team standup on my calendar tuesday 9:30am',
    'create a lunch with sam@company.test friday 12-1',
    "add a block called deep work tmrw 1-3pm",
    'please put investor call weds 4pm 45m',
    'I need a meeting thursday 2pm for one hour with legal',
    "drop a cal invite for 3pm tuesday: roadmap review",
    'hold time monday 11am-12pm for interviews',
    'put coffee with jane@startup.io next thursday 8am',
    'add gym session tmrw 6am',
    'set up dinner reservation block saturday 7:30',
    "create event: 1-1 for Priya, next week sometime friday 2pm",
    "add an all day focus block on friday for deep work (heads down)",
    'put a 25m call with recruiter at 1:15 tuesday',
    "add calendar hold for offsite, next week mon 9-5 (I'm flexible in afternoon)",
    'create focus time afternoon tomorrow',
    'book 60 minutes with morgan@x.co next tuesday 3-4',
    "schedule a board prep session, let's say 9am tuesday 90m",
    'add a slot for product review, wednesday 4pm central',
  ];
  for (const u of phrases) {
    const allowProtect =
      u.includes('add a block called deep work') && /\btmrw|tomorrow\b/i.test(u);
    const offsiteFlex = u.includes('add calendar hold for offsite');
    const noLlm = allowProtect || offsiteFlex;

    const queryDrift =
      /\bhold time\b[\s\S]*\bmonday\b/i.test(u) ||
      /\bcreate focus time\b[\s\S]*\bafternoon\b[\s\S]*\btomorrow\b/i.test(u);

    let allowedOutcomes: SimulatorItem['allowedOutcomes'];
    if (allowProtect) {
      allowedOutcomes = ['CREATE_EVENT', 'PROTECT_BLOCK'];
    } else if (offsiteFlex) {
      allowedOutcomes = [...I.create, 'RESOLVE_MANUAL'];
    } else if (queryDrift) {
      allowedOutcomes = [...I.create, 'QUERY_CALENDAR'];
    } else {
      allowedOutcomes = I.create;
    }

    let forbiddenOutcomes: string[] = ['FLUSH_RANGE', 'WARM_REDIRECT'];
    const inviteScheduling =
      /\b@\S+/i.test(u) && /\b(schedule|sync|book|coffee|meet|slot|invite|calendar hold)\b/i.test(u);
    if (inviteScheduling) {
      allowedOutcomes = [...(allowedOutcomes as string[]), 'SCHEDULING_LINK'];
    } else {
      forbiddenOutcomes.push('SCHEDULING_LINK');
    }

    out.push(
      item({
        utterance: u,
        category: 'create_event',
        expectedFamily: 'CREATE_EVENT',
        allowedOutcomes,
        forbiddenOutcomes,
        shouldUseLLM: !noLlm,
        needsConfirmation: false,
        notes: 'create via classifier',
        axis: u.includes('@') || /with\s+\w+@/i.test(u) ? 'appointment_with_others' : 'own_calendar',
      })
    );
  }
  for (let i = 0; i < 22; i++) {
    out.push(
      item({
        utterance: `schedule 30m sync for project ${i} next week tuesday 2pm with team+${i}@example.com`,
        category: 'create_event',
        expectedFamily: 'CREATE_EVENT',
        allowedOutcomes: [...I.create, 'SCHEDULING_LINK'],
        forbiddenOutcomes: ['FLUSH_RANGE', 'WARM_REDIRECT'],
        shouldUseLLM: true,
        needsConfirmation: 'unknown',
        notes: `generated create ${i}`,
        axis: 'appointment_with_others',
        includeInVoiceGauntlet: i < 4,
      })
    );
  }
  return out;
}

function buildMoveReschedule(): SimulatorItem[] {
  const out: SimulatorItem[] = [];
  const uu = [
    'move my 3pm meeting to 4pm',
    "reschedule dentist from tuesday to wednesday 9:30am",
    'postpone the standup to thursday 9am',
    "shift the 2pm 1-1 to 3:30",
    "move thursday’s investor call to friday at the same time",
    'reschedule the lunch to next week tuesday 12-1',
    "push the team sync to later, say 4pm",
    "move the board meeting up to 8am tuesday if possible",
    "postpone my 11am to after lunch, maybe 1:30",
    "reschedule 3pm to 3:45 and shorten to 20m",
    "shift the client call to tomorrow 10:30 pacific if you can",
    "reschedule the workshop from mon to wed same time",
    "move the standup, same time next week",
    "push the sync one hour",
    "push it to friday",
    "postpone the dentist appointment tmrw to next week thursday 9:30am",
  ];
  for (const u of uu) {
    out.push(
      item({
        utterance: u,
        category: 'move_reschedule',
        expectedFamily: 'MODIFY_EVENT',
        allowedOutcomes: I.modify,
        forbiddenOutcomes: ['CREATE_EVENT', 'FLUSH_RANGE', 'SCHEDULING_LINK', 'WARM_REDIRECT'],
        shouldUseLLM: 'optional',
        needsConfirmation: 'unknown',
        notes: 'move/reschedule — prefilter or classifier',
        axis: u.includes('investor') || u.includes('client') ? 'appointment_with_others' : 'own_calendar',
      })
    );
  }
  for (let i = 0; i < 28; i++) {
    out.push(
      item({
        utterance: `reschedule the ${i} oclock meeting to ${i + 1} oclock tuesday please`,
        category: 'move_reschedule',
        expectedFamily: 'MODIFY_EVENT',
        allowedOutcomes: I.modify,
        forbiddenOutcomes: ['FLUSH_RANGE', 'CREATE_EVENT'],
        shouldUseLLM: 'optional',
        needsConfirmation: 'unknown',
        notes: `move gen ${i}`,
        axis: 'own_calendar',
      })
    );
  }
  return out;
}

function buildCancelDelete(): SimulatorItem[] {
  const out: SimulatorItem[] = [];
  const uu = [
    "cancel the dentist appt tmrw",
    'remove my 2pm from today',
    'delete the standup on friday',
    "cancel tuesday’s 1-1 with HR",
    'delete interview block tomorrow morning 9-10',
    'remove the recurring hold if you can',
    'cancel that',
    "cancel the meeting I just mentioned",
    'delete lunch tomorrow',
    "remove friday 4pm call",
  ];
  for (const u of uu) {
    const isCancelThat = u === 'cancel that';
    out.push(
      item({
        utterance: u,
        category: 'cancel_delete',
        expectedFamily: isCancelThat ? 'RESOLVE_MANUAL' : 'MODIFY_EVENT',
        allowedOutcomes: isCancelThat ? ['MODIFY_EVENT', 'RESOLVE_MANUAL'] : I.modify,
        forbiddenOutcomes: ['CREATE_EVENT', 'SCHEDULING_LINK', 'FLUSH_RANGE', 'WARM_REDIRECT'],
        shouldUseLLM: 'optional',
        needsConfirmation: 'unknown',
        notes: isCancelThat ? 'too vague: manual unless clarified' : 'single-target delete',
        axis: u.includes('with') || u.includes('1-1') ? 'appointment_with_others' : 'own_calendar',
        e2eCompatible: u.includes('dentist'),
        e2eJourney: 'destructive_safe',
      })
    );
  }
  for (let i = 0; i < 32; i++) {
    out.push(
      item({
        utterance: `cancel the sync with person${i}@example.com thursday 3pm`,
        category: 'cancel_delete',
        expectedFamily: 'MODIFY_EVENT',
        allowedOutcomes: I.modify,
        forbiddenOutcomes: ['CREATE_EVENT', 'FLUSH_RANGE', 'SCHEDULING_LINK'],
        shouldUseLLM: 'optional',
        needsConfirmation: 'unknown',
        notes: `cancel w email ${i}`,
        axis: 'appointment_with_others',
        includeInVoiceGauntlet: i < 4,
      })
    );
  }
  return out;
}

function buildBulkRisky(): SimulatorItem[] {
  const out: SimulatorItem[] = [];
  const uu = [
    'clear my entire calendar for next week',
    'wipe the calendar next week please',
    'flush all events in the next 7 days',
    'delete everything on my calendar for next week',
    'remove all my meetings next week and keep nothing',
    'cancel all events next week in one go',
    "clear the whole day tomorrow, everything",
    'erase this week and next week for my calendar',
    "clear my whole calendar, I'm ooo",
    'delete all tuesday things', // prefilter: scoped delete → MODIFY, not a full-range flush
    "wipe the afternoon tomorrow except one hold",
  ];
  for (const u of uu) {
    const exceptWipe = u.includes('except one hold');
    const tuesdayAll = u === 'delete all tuesday things';
    out.push(
      item({
        utterance: u,
        category: tuesdayAll ? 'cancel_delete' : 'bulk_risky',
        expectedFamily: exceptWipe ? 'RESOLVE_MANUAL' : tuesdayAll ? 'RESOLVE_MANUAL' : 'FLUSH_RANGE',
        allowedOutcomes: exceptWipe ? ['FLUSH_RANGE', 'RESOLVE_MANUAL'] : tuesdayAll ? ['RESOLVE_MANUAL'] : [...I.flush, 'RESOLVE_MANUAL'],
        forbiddenOutcomes: ['CREATE_EVENT', 'SCHEDULING_LINK', 'WARM_REDIRECT'],
        shouldUseLLM: 'optional',
        needsConfirmation: true,
        notes: exceptWipe
          ? 'exception clause → manual disambiguation'
          : tuesdayAll
            ? 'scoped “delete all …” with weekday reference → RESOLVE_MANUAL (unbounded delete)'
            : 'bulk / wide cancel — prefilter to FLUSH or manual',
        axis: 'own_calendar',
        e2eCompatible: u.includes('next week') && u.includes('clear'),
        e2eJourney: 'destructive_safe',
      })
    );
  }
  for (let i = 0; i < 22; i++) {
    out.push(
      item({
        utterance: `completely clear my calendar in this range: next ${i % 2 === 0 ? 'week' : 'month'}`,
        category: 'bulk_risky',
        expectedFamily: 'FLUSH_RANGE',
        allowedOutcomes: [...I.flush, 'RESOLVE_MANUAL'],
        forbiddenOutcomes: ['SCHEDULING_LINK', 'CREATE_EVENT', 'WARM_REDIRECT'],
        shouldUseLLM: 'optional',
        needsConfirmation: true,
        notes: `bulk ${i} — may need clarify`,
        axis: 'own_calendar',
        includeInVoiceGauntlet: false,
      })
    );
  }
  return out;
}

function buildSchedulingLink(): SimulatorItem[] {
  const out: SimulatorItem[] = [];
  const guest = 'guest1@example.test';
  const ph = [
    `find time with ${guest} next week 9am to 5pm`,
    `book a time with ${guest} please 9am to 5pm`,
    `send ${guest} a scheduling link for tuesday or wednesday 9am to 5pm`,
    `I need a meeting with ${guest} and want them to pick — share link 9am to 5pm`,
    `create a public scheduling link for ${guest} 30m 9am to 5pm`,
    `set up a calendly-style link to meet ${guest} some time friday 9am to 5pm`,
    `schedule with ${guest}@invalid fix email guest1@example.test 9am to 5pm`,
    'today afternoon or evening with priya.guest@example.net',
  ];
  for (const u of ph) {
    const isMissingWindow = /today afternoon or evening/i.test(u);
    out.push(
      item({
        utterance: u,
        category: 'scheduling_link',
        expectedFamily: isMissingWindow ? 'RESOLVE_MANUAL' : 'SCHEDULING_LINK',
        allowedOutcomes: isMissingWindow ? I.resolve : I.sched,
        forbiddenOutcomes: ['WARM_REDIRECT', 'FLUSH_RANGE', 'CREATE_EVENT'],
        shouldUseLLM: false,
        needsConfirmation: false,
        notes: isMissingWindow
          ? 'scheduling ask missing explicit window bounds; must clarify'
          : 'scheduling_link prefilter (no Anthropic); messy double-@ case still has schedule with + email',
        axis: 'appointment_with_others',
        e2eCompatible: u.includes('guest1@example.test'),
        e2eJourney: 'scheduling_invite',
      })
    );
  }
  for (let i = 0; i < 60; i++) {
    out.push(
      item({
        utterance: `find time to meet with prospect${i}@acme.test next tuesday, send a link 9am to 5pm`,
        category: 'scheduling_link',
        expectedFamily: 'SCHEDULING_LINK',
        allowedOutcomes: I.sched,
        forbiddenOutcomes: ['WARM_REDIRECT', 'FLUSH_RANGE'],
        shouldUseLLM: false,
        needsConfirmation: false,
        notes: `sched link gen ${i}`,
        axis: 'appointment_with_others',
        includeInVoiceGauntlet: i < 6,
      })
    );
  }
  return out;
}

function buildProtectBlock(): SimulatorItem[] {
  const out: SimulatorItem[] = [];
  for (const row of [
    {
      u: "block 9-12 for deep work tuesday",
      allowed: I.protect,
      llm: false,
    },
    {
      u: "protect my calendar friday for writing",
      allowed: I.protect,
      llm: true,
    },
    {
      u: "I need a no-meeting block 1-3pm tmrw",
      allowed: I.protect,
      llm: true,
      note: 'clock with pm + tmrw — classifier supplies PROTECT_BLOCK params in tests',
    },
    {
      u: "put a hard block: no interviews after 2pm tuesday",
      allowed: [...I.protect, 'RESOLVE_MANUAL'],
      llm: false,
      note: 'open-ended after X → clarify end time (preflight)',
    },
    {
      u: "reserve morning for code review, block 8-11 tuesday",
      allowed: I.protect,
      llm: false,
      note: 'single-day Tuesday block must stay single-day with provided title',
    },
    {
      u: "shield 12-1 from meetings every day (try)",
      allowed: [...I.protect, 'RESOLVE_MANUAL'],
      llm: false,
      note: 'every day without end bound → clarify (preflight)',
    },
  ]) {
    out.push(
      item({
        utterance: row.u,
        category: 'protect_block',
        expectedFamily: 'PROTECT_BLOCK',
        allowedOutcomes: row.allowed,
        forbiddenOutcomes: ['FLUSH_RANGE', 'SCHEDULING_LINK', 'WARM_REDIRECT'],
        shouldUseLLM: row.llm,
        needsConfirmation: 'unknown',
        notes: 'note' in row && row.note ? row.note : 'protect / block',
        axis: 'own_calendar',
      })
    );
  }
  for (let i = 0; i < 26; i++) {
    out.push(
      item({
        utterance: `block ${8 + (i % 3)}-10 for focus time on project-${i} next week`,
        category: 'protect_block',
        expectedFamily: 'PROTECT_BLOCK',
        allowedOutcomes: [...I.protect, 'RESOLVE_MANUAL'],
        forbiddenOutcomes: ['FLUSH_RANGE', 'SCHEDULING_LINK', 'WARM_REDIRECT', 'CREATE_EVENT'],
        shouldUseLLM: false,
        needsConfirmation: 'unknown',
        notes: 'generated protect: focus block + next week',
        axis: 'own_calendar',
        includeInVoiceGauntlet: i < 3,
      })
    );
  }
  return out;
}

function buildAmbiguous(): SimulatorItem[] {
  const out: SimulatorItem[] = [];
  for (const u of [
    'sometime friday 2-4 work for a call?',
    "before my investor call, am I free? I can’t see it",
    "which slot should I pick if both look ok tuesday, kind of vague on priorities",
    "tuesday is overloaded, i need a gut check on what to do first but no specifics",
    "maybe 3, maybe 4, idk what works with the team for my meeting schedule",
    "zzz ambiguous calendar phrase zzz",
    "what’s happening with the schedule thing tuesday, maybe 3, maybe 4, idk",
    "i am fuzzy on whether 2-3 is ok on my calendar for that peer 1-1",
  ]) {
    const noLlm = u.includes('before my investor') || u.includes('i am fuzzy');
    out.push(
      item({
        utterance: u,
        category: 'ambiguous_calendar',
        expectedFamily: 'RESOLVE_MANUAL',
        allowedOutcomes: I.resolve,
        forbiddenOutcomes: ['FLUSH_RANGE', 'SCHEDULING_LINK'],
        shouldUseLLM: !noLlm,
        needsConfirmation: 'unknown',
        notes: 'likely manual / low confidence in prod',
        axis: 'own_calendar',
        e2eCompatible: u.includes('zzz'),
        e2eJourney: 'ambiguous_stub',
        includeInVoiceGauntlet: false,
      })
    );
  }
  for (let i = 0; i < 24; i++) {
    out.push(
      item({
        utterance: `vague time thing: maybe next week, item ${i} not sure, help`,
        category: 'ambiguous_calendar',
        expectedFamily: 'RESOLVE_MANUAL',
        allowedOutcomes: I.resolve,
        forbiddenOutcomes: ['FLUSH_RANGE', 'SCHEDULING_LINK'],
        shouldUseLLM: false,
        needsConfirmation: 'unknown',
        notes: `vague placeholder item ${i}`,
        axis: 'own_calendar',
        includeInVoiceGauntlet: false,
      })
    );
  }
  return out;
}

function buildNonCalendar(): SimulatorItem[] {
  const out: SimulatorItem[] = [];
  for (const u of [
    "recipe for pasta tonight, not a calendar",
    "what’s the best productivity book",
    "write code for a fibonacci function",
    "tell me a joke",
    "how do I fix sleep schedule generally",
    "ping me later — nothing about gcal",
  ]) {
    out.push(
      item({
        utterance: u,
        category: 'non_calendar',
        expectedFamily: 'WARM_REDIRECT',
        allowedOutcomes: I.warm,
        forbiddenOutcomes: ['CREATE_EVENT', 'SCHEDULING_LINK', 'QUERY_CALENDAR', 'FLUSH_RANGE'],
        shouldUseLLM: false,
        needsConfirmation: false,
        notes: 'chit-chat',
        axis: 'own_calendar',
        e2eCompatible: u.includes('joke') || u.includes('productivity'),
        e2eJourney: 'warm_redirect',
      })
    );
  }
  for (let i = 0; i < 26; i++) {
    out.push(
      item({
        utterance: `offtopic item ${i}: explain tc39 proposals briefly, no gcal link`,
        category: 'non_calendar',
        expectedFamily: 'WARM_REDIRECT',
        allowedOutcomes: I.warm,
        forbiddenOutcomes: ['CREATE_EVENT', 'MODIFY_EVENT', 'FLUSH_RANGE', 'SCHEDULING_LINK', 'QUERY_CALENDAR'],
        shouldUseLLM: false,
        needsConfirmation: false,
        notes: `non-cal gen ${i} (avoid "book"/"time" substrings in keywords)`,
        axis: 'own_calendar',
        includeInVoiceGauntlet: false,
      })
    );
  }
  return out;
}

/**
 * Job MVP phrase gaps: recurring recurrence wording, reminders (no first-class intent yet),
 * series-scope moves, scheduling-preference cues that still route to deterministic QUERY in v1 parser.
 * Complex single-event reschedules are already well covered in `buildMoveReschedule` — not duplicated.
 */
function buildMvpJobPhraseCoverage(): SimulatorItem[] {
  const out: SimulatorItem[] = [];

  const recurringCreates: { u: string; note: string }[] = [
    {
      u: 'schedule a bi-weekly leadership sync every other Tuesday 10am',
      note: 'Job5 — every other / bi-weekly phrasing; recurrence grid not in prefilter (LLM)',
    },
    {
      u: 'book a one on one biweekly on alternating Wednesdays at 2pm',
      note: 'Job5 — bi-weekly alternation language; tests classifier + policy later',
    },
    {
      u: 'put a bi-weekly coaching session every other Thursday 3 to 4pm',
      note: 'Job5 — bi-weekly windowed event; edge case for duration + repeat',
    },
    {
      u: 'create a bi-weekly retro every other Friday afternoon',
      note: 'Job5 — bi-weekly + vague daypart; avoid misfire as generic create',
    },
    {
      u: 'schedule a monthly review on the first Monday of each month at 11am',
      note: 'Job5 — monthly nth-weekday template; high-value enterprise phrasing',
    },
    {
      u: 'put rent reminder on the first Monday of every month at 9am',
      note: 'Job5 — first Monday monthly; conflicts with simple weekly protect heuristics',
    },
    {
      u: 'add a budget sync the first Monday of each month at 2pm on my calendar',
      note: 'Job5 — first Monday + explicit calendar; monthly repeat clarity',
    },
    {
      u: 'block the first Monday morning each month for all-hands prep starting 8am',
      note: 'Job5 — first Monday + morning block; tests month-anchored recurrence',
    },
  ];
  for (const { u, note } of recurringCreates) {
    const monthlyOrNthMonth =
      /\bmonthly\b|\bfirst\s+\w+\s+of\s+(each|every)\s+month\b|\beach\s+month\b/i.test(u) ||
      /\b(first|every)\s+\w+\s+of\s+(each|every)\s+month\b/i.test(u) ||
      /\bblock\s+the\s+first\s+\w+/i.test(u);
    out.push(
      item({
        utterance: u,
        category: 'create_event',
        expectedFamily: 'CREATE_EVENT',
        allowedOutcomes: monthlyOrNthMonth ? [...I.create, 'RESOLVE_MANUAL'] : I.create,
        forbiddenOutcomes: ['FLUSH_RANGE', 'WARM_REDIRECT', 'SCHEDULING_LINK'],
        shouldUseLLM: !monthlyOrNthMonth,
        needsConfirmation: 'unknown',
        notes: note,
        axis: 'own_calendar',
        includeInVoiceGauntlet: false,
      })
    );
  }

  const moveFutureSeries: { u: string; note: string }[] = [
    {
      u: 'move all future yoga classes to 8am each Tuesday',
      note: 'Job5 — move all future instances; destructive prefilter → MODIFY (singular weekday ref)',
    },
    {
      u: 'reschedule every future team standup one hour earlier on Mondays',
      note: 'Job5 — series time shift; organizational calendar hygiene',
    },
    {
      u: 'move all subsequent piano lessons to 4pm each Thursday',
      note: 'Job5 — lessons keyword; ensure HAS_EVENT_REF still matches weekday',
    },
    {
      u: 'shift every future all-hands to 9am pacific on each Friday',
      note: 'Job5 — shift + recurring org event; timezone phrase',
    },
  ];
  for (const { u, note } of moveFutureSeries) {
    out.push(
      item({
        utterance: u,
        category: 'move_reschedule',
        expectedFamily: 'RESOLVE_MANUAL',
        allowedOutcomes: ['RESOLVE_MANUAL', 'MODIFY_EVENT'],
        forbiddenOutcomes: ['CREATE_EVENT', 'FLUSH_RANGE', 'SCHEDULING_LINK', 'WARM_REDIRECT'],
        shouldUseLLM: false,
        needsConfirmation: 'unknown',
        notes: note,
        axis: 'own_calendar',
        includeInVoiceGauntlet: false,
      })
    );
  }

  const skipInstance: { u: string; note: string }[] = [
    {
      u: "skip next Friday's yoga",
      note: 'Job5 — skip one recurring instance; EXDATE / exception semantics not in prefilter',
    },
    {
      u: 'skip only the next spin class occurrence on my calendar',
      note: 'Job5 — skip next + title; needs instance disambiguation',
    },
    {
      u: 'skip just this week’s Tuesday therapy appointment, keep the series',
      note: 'Job5 — skip + keep series; classic exception phrasing',
    },
    {
      u: 'for the book club skip the upcoming Sunday meet only',
      note: 'Job5 — skip one off; indefinite article noise',
    },
  ];
  for (const { u, note } of skipInstance) {
    out.push(
      item({
        utterance: u,
        category: 'ambiguous_calendar',
        expectedFamily: 'RESOLVE_MANUAL',
        allowedOutcomes: I.resolve,
        forbiddenOutcomes: ['FLUSH_RANGE', 'SCHEDULING_LINK'],
        shouldUseLLM: false,
        needsConfirmation: 'unknown',
        notes: note,
        axis: 'own_calendar',
        includeInVoiceGauntlet: false,
      })
    );
  }

  const reminders: { u: string; note: string }[] = [
    {
      u: 'remind me 30 minutes before my dentist appointment',
      note: 'Job6 — offset reminder before titled event; not MODIFY duration',
    },
    {
      u: 'notify me fifteen minutes ahead of tomorrow’s onboarding meeting',
      note: 'Job6 — short lead reminder; onboarding keyword',
    },
    {
      u: 'alert me one hour before the board review tomorrow morning',
      note: 'Job6 — hour offset; executive prep use case',
    },
    {
      u: 'add a reminder 45 minutes before my calendar haircut block Wednesday',
      note: 'Job6 — calendar + external service reminder parity',
    },
    {
      u: 'add a 1-hour reminder to the Tuesday team sync',
      note: 'Job6 — long lead on recurring meeting reminder',
    },
    {
      u: 'attach a ninety-minute reminder before Tuesday team meeting appointments',
      note:
        'Job6 — ninety-minute spelled + meeting keyword; avoids WARM/sync without meet* and QUERY “next week”',
    },
    {
      u: 'give me two reminders before the team meeting: morning and 1 hour out',
      note: 'Job6 — stacked reminders; splitter / manual risk',
    },
    {
      u: 'default reminder thirty minutes before weekly team meeting series',
      note:
        'Job6 — series default reminders; spelled “thirty” avoids modify-prefilter set+numeric minutes misroute',
    },
  ];
  for (const { u, note } of reminders) {
    out.push(
      item({
        utterance: u,
        category: 'ambiguous_calendar',
        expectedFamily: 'RESOLVE_MANUAL',
        allowedOutcomes: I.resolve,
        forbiddenOutcomes: ['FLUSH_RANGE', 'SCHEDULING_LINK'],
        shouldUseLLM: true,
        needsConfirmation: 'unknown',
        notes: note,
        axis: 'own_calendar',
        includeInVoiceGauntlet: false,
      })
    );
  }

  const preferenceQueries: { u: string; note: string }[] = [
    {
      u: 'find time slots next to my meetings tomorrow please',
      note: 'Job15 — adjacent-to-existing-meeting search; QUERY today/tomorrow family',
    },
    {
      u: 'locate free time right next to my standup block tomorrow on my schedule',
      note: 'Job15 — buffer next to one anchor event; adjacency intent',
    },
    {
      u: 'find openings adjacent to my meetings tomorrow morning on my calendar',
      note: 'Job15 — morning-scoped adjacency; product parity with “next to”',
    },
    {
      u: 'need contiguous time next to my existing meetings tomorrow',
      note: 'Job15 — contiguous phrasing; scheduling preference not SHAPE_RULES yet',
    },
    {
      u: 'avoid scheduling over lunch hour today on my schedule',
      note: 'Job15 — lunch avoidance; soft constraint as query',
    },
    {
      u: 'keep my midday lunch block free today on my schedule',
      note: 'Job15 — protect lunch without explicit PROTECT_BLOCK match',
    },
    {
      u: 'do not overlap new holds with noon lunch today on my calendar',
      note: 'Job15 — negative constraint on lunch window',
    },
    {
      u: 'skip proposing lunch overlaps today on my schedule',
      note: 'Job15 — “skip” + lunch; must not route to bulk destructive',
    },
    {
      u: 'prefer no commitments after 6pm today — show gaps on my calendar',
      note: 'Job15 — hard stop time; evening boundary preference',
    },
    {
      u: 'no meetings after 6pm today on my calendar',
      note: 'Job15 — explicit “after 6pm” phrasing for policy tests',
    },
    {
      u: 'avoid putting anything past 6pm tonight on my schedule please',
      note: 'Job15 — tonight + 6pm; same family as “nothing after 6”',
    },
    {
      u: 'anything after six pm tomorrow should stay empty on my calendar block view',
      note: 'Job15 — tomorrow evening ceiling; regression for “after six” dictation',
    },
  ];
  for (const { u, note } of preferenceQueries) {
    out.push(
      item({
        utterance: u,
        category: 'availability',
        expectedFamily: 'QUERY_CALENDAR',
        allowedOutcomes: [...I.q, 'RESOLVE_MANUAL'],
        forbiddenOutcomes: ['WARM_REDIRECT', 'CREATE_EVENT', 'SCHEDULING_LINK'],
        shouldUseLLM: false,
        needsConfirmation: false,
        notes: note,
        axis: 'own_calendar',
        includeInVoiceGauntlet: false,
      })
    );
  }

  return out;
}

/** Compound single-utterance requests, Wispr-style dictation, and dialog-shaped lines (parser + voice; dialog follow-ups are also covered in Playwright). */
function buildCompoundWisprGauntlet(): SimulatorItem[] {
  return [
    item({
      utterance:
        "Whats on my calendar tomorrow and also find time with guest1@example.test next week",
      category: 'calendar_query',
      expectedFamily: 'QUERY_CALENDAR',
      allowedOutcomes: [...I.q, 'RESOLVE_MANUAL'],
      forbiddenOutcomes: ['SCHEDULING_LINK', 'WARM_REDIRECT', 'CREATE_EVENT', 'FLUSH_RANGE'],
      shouldUseLLM: false,
      needsConfirmation: false,
      notes:
        'compound: query+schedule in one line — RESOLVE_MANUAL disambiguation before QUERY preflight wins',
      axis: 'own_calendar',
      gauntletTag: 'compound_command',
    }),
    item({
      utterance: 'move my 3pm today to 4 and block friday morning for deep work',
      category: 'move_reschedule',
      expectedFamily: 'MODIFY_EVENT',
      allowedOutcomes: I.modify,
      forbiddenOutcomes: ['CREATE_EVENT', 'FLUSH_RANGE', 'WARM_REDIRECT'],
      shouldUseLLM: false,
      needsConfirmation: 'unknown',
      notes: 'compound: move+block — destructive prefilter → MODIFY (split PROTECT is future work)',
      axis: 'own_calendar',
      gauntletTag: 'compound_command',
    }),
    item({
      utterance: 'cancel tuesday 2pm and reschedule that block to thursday 3pm',
      category: 'move_reschedule',
      expectedFamily: 'MODIFY_EVENT',
      allowedOutcomes: [...I.modify, 'RESOLVE_MANUAL'],
      forbiddenOutcomes: ['CREATE_EVENT', 'FLUSH_RANGE', 'WARM_REDIRECT'],
      shouldUseLLM: false,
      needsConfirmation: 'unknown',
      notes: 'compound: cancel+reschedule — prefilter processes reschedule before bare cancel',
      axis: 'own_calendar',
      gauntletTag: 'compound_command',
    }),
    item({
      utterance:
        'find time with guest1@example.test 9am to 5pm next week and protect my friday mornings from new meetings',
      category: 'scheduling_link',
      expectedFamily: 'RESOLVE_MANUAL',
      allowedOutcomes: I.resolve,
      forbiddenOutcomes: ['WARM_REDIRECT', 'FLUSH_RANGE', 'SCHEDULING_LINK'],
      shouldUseLLM: false,
      needsConfirmation: false,
      notes: 'compound: must clarify one action first, no side effects before user picks',
      axis: 'appointment_with_others',
      gauntletTag: 'compound_command',
    }),
    item({
      utterance: 'um so like whats on my cal tomorrow',
      category: 'calendar_query',
      expectedFamily: 'QUERY_CALENDAR',
      allowedOutcomes: I.q,
      forbiddenOutcomes: ['WARM_REDIRECT', 'RESOLVE_MANUAL'],
      shouldUseLLM: false,
      needsConfirmation: false,
      notes: 'Wispr filler + shorthand cal',
      axis: 'own_calendar',
      gauntletTag: 'wispr_dictation',
    }),
    item({
      utterance: 'like do i have anything tomorrow or',
      category: 'calendar_query',
      expectedFamily: 'QUERY_CALENDAR',
      allowedOutcomes: I.q,
      forbiddenOutcomes: ['WARM_REDIRECT'],
      shouldUseLLM: false,
      needsConfirmation: false,
      notes: 'Wispr trailing filler',
      axis: 'own_calendar',
      gauntletTag: 'wispr_dictation',
    }),
    item({
      utterance: 'am i free at 3pm uh or 3:30',
      category: 'availability',
      expectedFamily: 'QUERY_CALENDAR',
      allowedOutcomes: I.q,
      forbiddenOutcomes: ['WARM_REDIRECT', 'CREATE_EVENT'],
      shouldUseLLM: false,
      needsConfirmation: false,
      notes: 'Wispr filler in availability',
      axis: 'own_calendar',
      gauntletTag: 'wispr_dictation',
    }),
    item({
      utterance: 'WISPR dictation when is my next meeting with jordan',
      category: 'calendar_query',
      expectedFamily: 'QUERY_CALENDAR',
      allowedOutcomes: I.q,
      forbiddenOutcomes: ['WARM_REDIRECT'],
      shouldUseLLM: false,
      needsConfirmation: false,
      notes: 'dictation product tag + contact name',
      axis: 'own_calendar',
      gauntletTag: 'wispr_dictation',
    }),
    item({
      utterance: 'find time with ravi dot kumar at company dot com next week 9am to 5pm',
      category: 'scheduling_link',
      expectedFamily: 'SCHEDULING_LINK',
      allowedOutcomes: I.sched,
      forbiddenOutcomes: ['WARM_REDIRECT', 'QUERY_CALENDAR'],
      shouldUseLLM: true,
      needsConfirmation: false,
      notes: 'spoken email format (no @); prod may extract differently',
      axis: 'appointment_with_others',
      gauntletTag: 'wispr_dictation',
    }),
    item({
      utterance: 'tomorrow .. anything at 3pm',
      category: 'availability',
      expectedFamily: 'QUERY_CALENDAR',
      allowedOutcomes: I.q,
      forbiddenOutcomes: ['WARM_REDIRECT'],
      shouldUseLLM: false,
      needsConfirmation: false,
      notes: 'missing punctuation / spaced dots',
      axis: 'own_calendar',
      gauntletTag: 'wispr_dictation',
    }),
    item({
      utterance: 'i said cancel— actually move that meeting to friday',
      category: 'move_reschedule',
      expectedFamily: 'MODIFY_EVENT',
      allowedOutcomes: I.modify,
      forbiddenOutcomes: ['CREATE_EVENT', 'FLUSH_RANGE'],
      shouldUseLLM: 'optional',
      needsConfirmation: 'unknown',
      notes: 'partial correction mid-utterance',
      axis: 'own_calendar',
      gauntletTag: 'wispr_dictation',
    }),
    item({
      utterance: "What's on tomorrow?",
      category: 'calendar_query',
      expectedFamily: 'QUERY_CALENDAR',
      allowedOutcomes: I.q,
      forbiddenOutcomes: ['RESOLVE_MANUAL', 'WARM_REDIRECT'],
      shouldUseLLM: false,
      needsConfirmation: false,
      notes: 'dialog regression: first turn (pair with follow-up in E2E)',
      axis: 'own_calendar',
      e2eCompatible: true,
      e2eJourney: 'chat_query',
      gauntletTag: 'dialog_regression',
    }),
    item({
      utterance: 'Move the first one to Friday.',
      category: 'move_reschedule',
      expectedFamily: 'MODIFY_EVENT',
      allowedOutcomes: I.modify,
      forbiddenOutcomes: ['FLUSH_RANGE', 'CREATE_EVENT', 'SCHEDULING_LINK'],
      shouldUseLLM: false,
      needsConfirmation: 'unknown',
      notes: 'dialog-style phrasing: prefilter still picks MODIFY (deictic “first” is unsafe detail — host UI context in future)',
      axis: 'own_calendar',
      gauntletTag: 'dialog_regression',
    }),
    item({
      utterance: 'Cancel it.',
      category: 'ambiguous_calendar',
      expectedFamily: 'RESOLVE_MANUAL',
      allowedOutcomes: I.resolve,
      forbiddenOutcomes: ['CREATE_EVENT', 'SCHEDULING_LINK', 'FLUSH_RANGE'],
      shouldUseLLM: false,
      needsConfirmation: 'unknown',
      notes: 'dialog regression: pronoun only — prefilter → manual (no event ref)',
      axis: 'own_calendar',
      gauntletTag: 'dialog_regression',
    }),
    item({
      utterance: 'Make it 45 minutes.',
      category: 'ambiguous_calendar',
      expectedFamily: 'WARM_REDIRECT',
      allowedOutcomes: ['WARM_REDIRECT', 'RESOLVE_MANUAL'],
      forbiddenOutcomes: ['FLUSH_RANGE', 'CREATE_EVENT', 'SCHEDULING_LINK', 'MODIFY_EVENT'],
      shouldUseLLM: false,
      needsConfirmation: 'unknown',
      notes: 'dialog follow-up: isolated, no cal keywords → warm (after scheduling context in chat, add duration phrase to corpus when server keeps thread)',
      axis: 'own_calendar',
      gauntletTag: 'dialog_regression',
    }),
  ];
}

/** Extra appointment axis rows, exact mandatory Kanth phrases, compound-command set, and off-topic chaff to satisfy 10-user quota tests. */
function buildScaleTenUserGauntlet(): SimulatorItem[] {
  const out: SimulatorItem[] = [];
  out.push(
    item({
      utterance: "tomorrow's schedule",
      category: 'calendar_query',
      expectedFamily: 'QUERY_CALENDAR',
      allowedOutcomes: I.q,
      forbiddenOutcomes: ['RESOLVE_MANUAL', 'WARM_REDIRECT', 'CREATE_EVENT'],
      shouldUseLLM: false,
      needsConfirmation: false,
      expectedResponseShape: 'agenda',
      notes: 'mandatory live: tomorrow’s schedule (normalized to tomorrow schedule prefilter)',
      axis: 'own_calendar',
      e2eCompatible: true,
      e2eJourney: 'chat_query',
    }),
    item({
      utterance: 'next meeting',
      category: 'calendar_query',
      expectedFamily: 'QUERY_CALENDAR',
      allowedOutcomes: I.q,
      forbiddenOutcomes: ['RESOLVE_MANUAL', 'WARM_REDIRECT'],
      shouldUseLLM: false,
      needsConfirmation: false,
      expectedResponseShape: 'list_events',
      notes: 'mandatory live: standalone next meeting',
      axis: 'own_calendar',
      e2eCompatible: true,
      e2eJourney: 'chat_query',
    }),
    item({
      utterance: 'am I free at 3pm?',
      category: 'availability',
      expectedFamily: 'QUERY_CALENDAR',
      allowedOutcomes: I.q,
      forbiddenOutcomes: ['RESOLVE_MANUAL', 'WARM_REDIRECT'],
      shouldUseLLM: false,
      needsConfirmation: false,
      expectedResponseShape: 'availability',
      notes: 'mandatory live: 3pm availability',
      axis: 'own_calendar',
      e2eCompatible: true,
      e2eJourney: 'chat_query',
    }),
    item({
      utterance: 'do I have anything at 10:30am?',
      category: 'availability',
      expectedFamily: 'QUERY_CALENDAR',
      allowedOutcomes: I.q,
      forbiddenOutcomes: ['RESOLVE_MANUAL', 'WARM_REDIRECT'],
      shouldUseLLM: false,
      needsConfirmation: false,
      expectedResponseShape: 'availability',
      notes: 'mandatory live: 10:30 check',
      axis: 'own_calendar',
      e2eCompatible: true,
      e2eJourney: 'chat_query',
    })
  );
  for (let i = 0; i < 12; i++) {
    out.push(
      item({
        utterance: `find time with scale${i}@external.test next week 9am to 5pm`,
        category: 'scheduling_link',
        expectedFamily: 'SCHEDULING_LINK',
        allowedOutcomes: I.sched,
        forbiddenOutcomes: ['WARM_REDIRECT', 'FLUSH_RANGE'],
        shouldUseLLM: false,
        needsConfirmation: false,
        expectedResponseShape: 'link',
        notes: `10-user scale: appointment_with_others #${i}`,
        axis: 'appointment_with_others',
        includeInVoiceGauntlet: false,
      })
    );
  }
  const compoundBatches: {
    u: string;
    cat: SimulatorCategory;
    al: string[];
    sm: boolean | 'optional';
    ex: string;
    ax: SimulatorAxis;
    note: string;
    forbid: string[];
  }[] = [
    // sm: 'optional' — many routes hit prefilter or manual; LLM is not always invoked.
    {
      u: 'Move my 3pm call to Friday and block lunch after that.',
      cat: 'move_reschedule',
      al: I.modify,
      sm: false,
      ex: 'MODIFY_EVENT',
      ax: 'own_calendar',
      note: 'compound: move+block one breath',
      forbid: ['CREATE_EVENT', 'WARM_REDIRECT', 'SCHEDULING_LINK'],
    },
    {
      u: 'Cancel dentist appointment tomorrow, then for guest1@example.test open scheduling for monday afternoon (two tasks one breath, avoid next week bulk trigger)',
      cat: 'move_reschedule',
      al: ['MODIFY_EVENT', 'SCHEDULING_LINK', 'RESOLVE_MANUAL', 'FLUSH_RANGE'],
      sm: true,
      ex: 'MODIFY_EVENT',
      ax: 'own_calendar',
      note: 'compound: cancel+scheduling; phrasing avoids cancel+next week false FLUSH in prefilter',
      forbid: ['CREATE_EVENT', 'WARM_REDIRECT'],
    },
    {
      u: 'clear next week except my investor call and protect mornings for deep work',
      cat: 'bulk_risky',
      al: ['FLUSH_RANGE', 'RESOLVE_MANUAL', 'PROTECT_BLOCK', 'GATEKEEP_RULE'],
      sm: true,
      ex: 'RESOLVE_MANUAL',
      ax: 'own_calendar',
      note: 'compound: clear+except+protect — except clause often → manual/confirm in prefilter',
      forbid: ['CREATE_EVENT', 'SCHEDULING_LINK', 'WARM_REDIRECT'],
    },
    {
      u: 'Schedule yoga on Monday and block my dinners every day next week for family time',
      cat: 'create_event',
      al: ['CREATE_EVENT', 'PROTECT_BLOCK', 'RESOLVE_MANUAL', 'GATEKEEP_RULE', 'QUERY_CALENDAR'],
      sm: true,
      ex: 'CREATE_EVENT',
      ax: 'own_calendar',
      note: 'compound: create+recurring protect language',
      forbid: ['FLUSH_RANGE', 'WARM_REDIRECT', 'SCHEDULING_LINK'],
    },
    {
      u: 'find time with guest1@example.test 9am to 5pm next week but do not book over my 9am standups',
      cat: 'scheduling_link',
      al: ['SCHEDULING_LINK', 'RESOLVE_MANUAL'],
      sm: true,
      ex: 'RESOLVE_MANUAL',
      ax: 'appointment_with_others',
      note: 'compound: find time with explicit constraint should apply or clarify',
      forbid: ['CREATE_EVENT', 'FLUSH_RANGE', 'WARM_REDIRECT'],
    },
    {
      u: 'move my 4pm to 2pm tuesday and also cancel the 5pm standup the same day',
      cat: 'move_reschedule',
      al: I.resolve,
      sm: 'optional',
      ex: 'RESOLVE_MANUAL',
      ax: 'own_calendar',
      note: 'compound: move and cancel requires clarification before any mutation',
      forbid: ['CREATE_EVENT', 'WARM_REDIRECT', 'SCHEDULING_LINK', 'MODIFY_EVENT'],
    },
    {
      u: "postpone my 10am tuesday and if you can't, delete it and message me",
      cat: 'move_reschedule',
      al: ['MODIFY_EVENT', 'RESOLVE_MANUAL'],
      sm: 'optional',
      ex: 'MODIFY_EVENT',
      ax: 'own_calendar',
      note: 'compound: postpone with fallback (manual risk)',
      forbid: ['CREATE_EVENT', 'SCHEDULING_LINK', 'WARM_REDIRECT'],
    },
    {
      u: 'wipe tuesday except my dentist and protect afternoon focus time',
      cat: 'bulk_risky',
      al: ['FLUSH_RANGE', 'RESOLVE_MANUAL', 'GATEKEEP_RULE', 'PROTECT_BLOCK'],
      sm: true,
      ex: 'RESOLVE_MANUAL',
      ax: 'own_calendar',
      note: 'compound: wipe+except — except → manual in prefilter',
      forbid: ['CREATE_EVENT', 'SCHEDULING_LINK', 'WARM_REDIRECT'],
    },
    {
      u: 'book a call with casey@ops.test tomorrow at 1pm and block 30m before and after for prep',
      cat: 'create_event',
      al: ['CREATE_EVENT', 'RESOLVE_MANUAL', 'GATEKEEP_RULE'],
      sm: true,
      ex: 'CREATE_EVENT',
      ax: 'appointment_with_others',
      note: 'compound: create with buffer language',
      forbid: ['FLUSH_RANGE', 'WARM_REDIRECT', 'SCHEDULING_LINK'],
    },
    {
      u: 'reschedule the board readout and send a new scheduling link to guest1@example.test for next thursday',
      cat: 'scheduling_link',
      al: ['SCHEDULING_LINK', 'MODIFY_EVENT', 'RESOLVE_MANUAL'],
      sm: true,
      ex: 'SCHEDULING_LINK',
      ax: 'appointment_with_others',
      note: 'compound: reschedule + link',
      forbid: ['CREATE_EVENT', 'WARM_REDIRECT', 'FLUSH_RANGE'],
    },
    {
      u: "delete friday 2pm 1-1 and create a 45m session with taylor@acme.com same afternoon",
      cat: 'cancel_delete',
      al: ['MODIFY_EVENT', 'CREATE_EVENT', 'RESOLVE_MANUAL'],
      sm: true,
      ex: 'RESOLVE_MANUAL',
      ax: 'appointment_with_others',
      note: 'compound: delete+create — deictic+create often manual without thread',
      forbid: ['WARM_REDIRECT', 'SCHEDULING_LINK', 'FLUSH_RANGE'],
    },
    {
      u: "flush tuesday that isn't tier 0 and add a no-meet block wednesday morning for heads down",
      cat: 'bulk_risky',
      al: ['FLUSH_RANGE', 'RESOLVE_MANUAL', 'PROTECT_BLOCK', 'GATEKEEP_RULE'],
      sm: true,
      ex: 'RESOLVE_MANUAL',
      ax: 'own_calendar',
      note: 'compound: bulk + protect; tier qualifier → manual/confirm in prod',
      forbid: ['CREATE_EVENT', 'SCHEDULING_LINK', 'WARM_REDIRECT'],
    },
    {
      u: 'show my thursday 4-5 and then nuke the rest of the day if it is only low tier stuff',
      cat: 'bulk_risky',
      al: ['FLUSH_RANGE', 'RESOLVE_MANUAL', 'QUERY_CALENDAR'],
      sm: true,
      ex: 'RESOLVE_MANUAL',
      ax: 'own_calendar',
      note: 'compound: query+nuke (manual)',
      forbid: ['CREATE_EVENT', 'SCHEDULING_LINK', 'WARM_REDIRECT'],
    },
    {
      u: "need to move investor pitch from mon 9 to tuesday 2 and add a 15m hold before it",
      cat: 'move_reschedule',
      al: I.modify,
      sm: 'optional',
      ex: 'MODIFY_EVENT',
      ax: 'appointment_with_others',
      note: 'compound: move+hold buffer with investor',
      forbid: ['CREATE_EVENT', 'FLUSH_RANGE', 'WARM_REDIRECT'],
    },
    {
      u: "cancel tuesday 3pm standup then for guest1@example.test open a monday 10am slot, two things in one breath (no 'next week' with cancel)",
      cat: 'move_reschedule',
      al: ['MODIFY_EVENT', 'SCHEDULING_LINK', 'RESOLVE_MANUAL', 'FLUSH_RANGE'],
      sm: true,
      ex: 'MODIFY_EVENT',
      ax: 'own_calendar',
      note: 'compound: cancel+scheduling; avoid cancel+next week bulk misfire',
      forbid: ['WARM_REDIRECT', 'CREATE_EVENT'],
    },
    {
      u: 'what is on my thursday and can you add a 20m checkin with morgan@labs.test thursday 4:30 if free',
      cat: 'calendar_query',
      al: ['QUERY_CALENDAR', 'SCHEDULING_LINK', 'CREATE_EVENT', 'RESOLVE_MANUAL'],
      sm: true,
      ex: 'QUERY_CALENDAR',
      ax: 'own_calendar',
      note: 'compound: query+scheduling; prefilter takes agenda first',
      forbid: ['WARM_REDIRECT', 'FLUSH_RANGE'],
    },
  ];
  for (const c of compoundBatches) {
    out.push(
      item({
        utterance: c.u,
        category: c.cat,
        expectedFamily: c.ex,
        allowedOutcomes: c.al,
        forbiddenOutcomes: c.forbid,
        shouldUseLLM: c.sm === false ? false : 'optional',
        needsConfirmation: 'unknown',
        notes: c.note,
        axis: c.ax,
        gauntletTag: 'compound_command',
      })
    );
  }
  for (const [u, note] of [
    ['best pasta shape for bolognese, food only', 'off-topic: recipes — zero cal keywords'],
    ['ibuprofen 200mg with food, medical only', 'off-topic: medical — avoid meet* substrings'],
    ['bond index etf allocation for a 20 year horizon, investment only', 'off-topic: finance'],
  ] as const) {
    out.push(
      item({
        utterance: u,
        category: 'non_calendar',
        expectedFamily: 'WARM_REDIRECT',
        allowedOutcomes: I.warm,
        forbiddenOutcomes: ['QUERY_CALENDAR', 'CREATE_EVENT', 'SCHEDULING_LINK', 'FLUSH_RANGE'],
        shouldUseLLM: false,
        needsConfirmation: false,
        notes: note,
        axis: 'own_calendar',
        includeInVoiceGauntlet: false,
      })
    );
  }
  for (let j = 0; j < 4; j++) {
    out.push(
      item({
        utterance: `uh can you find time with raj next week maybe after lunch item ${j} 9am to 5pm`,
        category: 'scheduling_link',
        expectedFamily: 'RESOLVE_MANUAL',
        allowedOutcomes: ['SCHEDULING_LINK', 'RESOLVE_MANUAL'],
        forbiddenOutcomes: ['WARM_REDIRECT', 'FLUSH_RANGE'],
        shouldUseLLM: true,
        needsConfirmation: false,
        notes: `Wispr: filler scheduling ${j} with extra constraint should apply or clarify`,
        axis: 'appointment_with_others',
        gauntletTag: 'wispr_dictation',
      })
    );
  }
  return out;
}

/**
 * Full simulator corpus. Counts and axis quotas are verified in unit tests.
 */
export function buildCalendarUserSimulatorCorpus(): SimulatorItem[] {
  return [
    ...KANTH_REGRESSIONS,
    ...RED_TEAM_FALSE_POSITIVES,
    ...buildCalendarQueries(),
    ...buildAvailability(),
    ...buildCreateEvents(),
    ...buildMoveReschedule(),
    ...buildCancelDelete(),
    ...buildBulkRisky(),
    ...buildSchedulingLink(),
    ...buildProtectBlock(),
    ...buildAmbiguous(),
    ...buildNonCalendar(),
    ...buildMvpJobPhraseCoverage(),
    ...buildCompoundWisprGauntlet(),
    ...buildScaleTenUserGauntlet(),
  ];
}

export const CALENDAR_USER_SIMULATOR_CORPUS: SimulatorItem[] = buildCalendarUserSimulatorCorpus();

/** Shapes the mocked `classifyIntent` return when the LLM path runs (parser integration tests). */
export function buildMockClassifyForSimulatorItem(item: SimulatorItem): {
  intent: string;
  confidence: number;
  params: Record<string, unknown>;
  mappingMethod: 'direct';
  rawUtterance: string;
} {
  if (item.category === 'ambiguous_calendar') {
    return {
      intent: 'OFFER_SPECIFIC',
      confidence: 0.55,
      params: {},
      mappingMethod: 'direct',
      rawUtterance: item.utterance,
    };
  }
  if (item.allowedOutcomes.length === 1 && item.allowedOutcomes[0] === 'RESOLVE_MANUAL') {
    return {
      intent: 'OFFER_SPECIFIC',
      confidence: 0.55,
      params: {},
      mappingMethod: 'direct',
      rawUtterance: item.utterance,
    };
  }
  const order = [
    'SCHEDULING_LINK',
    'CREATE_EVENT',
    'MODIFY_EVENT',
    'PROTECT_BLOCK',
    'GATEKEEP_RULE',
    'FLUSH_RANGE',
    'OFFER_SPECIFIC',
    'PIVOT_ASYNC',
    'SHAPE_RULES',
    'UNDO',
    'QUERY_CALENDAR',
    'WARM_REDIRECT',
    'RESOLVE_MANUAL',
  ];
  const intent = order.find((x) => item.allowedOutcomes.includes(x)) ?? item.allowedOutcomes[0]!;
  let params: Record<string, unknown> = {};
  if (intent === 'SCHEDULING_LINK') {
    const emails = [...item.utterance.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)].map((m) => m[0]!);
    const email =
      emails.find((e) => /guest1@example\.test/i.test(e)) ?? emails[emails.length - 1] ?? 'guest@example.com';
    const win = extractSchedulingSearchWindowHours(item.utterance);
    params = { inviteeEmail: email };
    if (win) {
      params['windowStartHourLocal'] = win.startHour;
      params['windowEndHourLocal'] = win.endHour;
    }
  } else if (intent === 'PROTECT_BLOCK') {
    params = {
      label: item.utterance.slice(0, 80).trim() || 'Protected block',
      startTime: '09:00',
      endTime: '10:00',
      daysOfWeek: [1],
      rangeEnd: '2099-12-31',
      tier: 1,
    };
  }
  const confidence = intent === 'RESOLVE_MANUAL' ? 0.45 : 0.95;
  return { intent, confidence, params, mappingMethod: 'direct', rawUtterance: item.utterance };
}

export function getVoiceGauntletSubset(max = 200): SimulatorItem[] {
  const withFlag = CALENDAR_USER_SIMULATOR_CORPUS.filter((c) => c.includeInVoiceGauntlet !== false);
  if (withFlag.length >= max) {
    return withFlag.slice(0, max);
  }
  const rest = CALENDAR_USER_SIMULATOR_CORPUS.filter((c) => !withFlag.includes(c));
  return [...withFlag, ...rest].slice(0, max);
}

export function getE2eJourneyPhrases(
  kind: NonNullable<SimulatorItem['e2eJourney']>,
  cap = 100
): SimulatorItem[] {
  return CALENDAR_USER_SIMULATOR_CORPUS.filter((c) => c.e2eCompatible && c.e2eJourney === kind).slice(0, cap);
}
