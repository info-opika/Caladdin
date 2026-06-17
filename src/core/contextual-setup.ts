import type { Intent, ParsedIntent, UserPolicyProfile } from './adts.js';

export const SETUP_FIELD_IDS = [
  'timezone',
  'workingHours',
  'defaultMeetingLength',
  'meetingTimePreference',
] as const;

export type SetupFieldId = (typeof SETUP_FIELD_IDS)[number];

export type SetupFormType = 'timezone' | 'timeRange' | 'duration' | 'preference';

const SCHEDULING_INTENTS: Intent[] = [
  'OFFER_SPECIFIC',
  'SCHEDULING_LINK',
  'PROTECT_BLOCK',
  'CREATE_EVENT',
  'MODIFY_EVENT',
];

const SETUP_QUESTIONS: Record<SetupFieldId, string> = {
  timezone: 'What timezone are you in?',
  workingHours: 'When do you normally take meetings? For example, 9am–6pm.',
  meetingTimePreference: 'Do you prefer morning or afternoon meetings?',
  defaultMeetingLength: 'How long are your usual meetings? Default is 30 minutes.',
};

const SETUP_FORM_TYPES: Record<SetupFieldId, SetupFormType> = {
  timezone: 'timezone',
  workingHours: 'timeRange',
  meetingTimePreference: 'preference',
  defaultMeetingLength: 'duration',
};

export interface ContextualSetupGap {
  field: SetupFieldId;
  question: string;
  formType: SetupFormType;
}

export function fieldsRequiredForIntent(intent: Intent, parsed: ParsedIntent): SetupFieldId[] {
  if (!SCHEDULING_INTENTS.includes(intent)) return [];

  const fields: SetupFieldId[] = ['timezone'];

  if (intent === 'OFFER_SPECIFIC' || intent === 'SCHEDULING_LINK') {
    fields.push('workingHours', 'meetingTimePreference');
    const duration = parsed.params.durationMinutes;
    if (typeof duration !== 'number' || duration <= 0) {
      fields.push('defaultMeetingLength');
    }
  }

  return fields;
}

/**
 * Returns the first contextual setup field still unanswered for this intent, or null.
 */
export function checkContextualSetup(
  policy: UserPolicyProfile,
  intent: Intent,
  parsed: ParsedIntent,
): ContextualSetupGap | null {
  const answered = new Set(policy.setupFieldsAnswered ?? []);

  for (const field of fieldsRequiredForIntent(intent, parsed)) {
    if (!answered.has(field)) {
      return {
        field,
        question: SETUP_QUESTIONS[field],
        formType: SETUP_FORM_TYPES[field],
      };
    }
  }

  return null;
}

const DURATION_RE = /\b(\d+)\s*(?:-|–)?\s*(?:minute|min|mins|hour|hr|hrs)\b/i;
const TIME_RANGE_RE =
  /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
const PREFERENCE_RE = /\b(morning|afternoon|evening|flexible|either)\b/i;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function to24h(hour: number, minute: number, meridiem?: string): string {
  let h = hour;
  const m = minute;
  const mer = meridiem?.toLowerCase();
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (!mer && h >= 1 && h <= 7) h += 12;
  return `${pad2(h)}:${pad2(m)}`;
}

export interface ParsedSetupAnswer {
  timezone?: string;
  workingHoursStart?: string;
  workingHoursEnd?: string;
  defaultMeetingLengthMinutes?: number;
  meetingTimePreference?: 'morning' | 'afternoon' | 'flexible';
}

/**
 * Best-effort parse of a chat reply answering a contextual setup question.
 */
export function parseSetupAnswer(field: SetupFieldId, utterance: string): ParsedSetupAnswer | null {
  const text = utterance.trim();
  if (!text) return null;

  if (field === 'timezone') {
    if (/^[A-Za-z_]+\/[A-Za-z_]+$/.test(text)) {
      return { timezone: text };
    }
    return null;
  }

  if (field === 'workingHours') {
    const m = TIME_RANGE_RE.exec(text);
    if (!m) return null;
    const start = to24h(Number(m[1]), Number(m[2] ?? 0), m[3]);
    const end = to24h(Number(m[4]), Number(m[5] ?? 0), m[6] ?? m[3]);
    return { workingHoursStart: start, workingHoursEnd: end };
  }

  if (field === 'defaultMeetingLength') {
    const m = DURATION_RE.exec(text);
    if (!m) return null;
    const n = Number(m[1]);
    const unit = text.toLowerCase();
    const minutes = unit.includes('hour') || unit.includes('hr') ? n * 60 : n;
    if (minutes < 5 || minutes > 480) return null;
    return { defaultMeetingLengthMinutes: minutes };
  }

  if (field === 'meetingTimePreference') {
    const m = PREFERENCE_RE.exec(text);
    if (!m) return null;
    const word = m[1]!.toLowerCase();
    if (word === 'morning') return { meetingTimePreference: 'morning' };
    if (word === 'afternoon' || word === 'evening') return { meetingTimePreference: 'afternoon' };
    return { meetingTimePreference: 'flexible' };
  }

  return null;
}

export function setupPatchFromAnswer(
  field: SetupFieldId,
  answer: ParsedSetupAnswer,
): ParsedSetupAnswer {
  return answer;
}

export function buildSetupPatch(field: SetupFieldId, answer: ParsedSetupAnswer): ParsedSetupAnswer {
  return answer;
}
