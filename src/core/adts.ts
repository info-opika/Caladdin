import { z } from 'zod';

export const VALID_INTENTS = [
  'PROTECT_BLOCK',
  'OFFER_SPECIFIC',
  'CREATE_EVENT',
  'FLUSH_RANGE',
  'MODIFY_EVENT',
  'PIVOT_ASYNC',
  'SHAPE_RULES',
  'GATEKEEP_RULE',
  'QUERY_CALENDAR',
  'UNDO',
  'INVITE_PLATFORM',
  'SCHEDULING_LINK',
  'RESOLVE_MANUAL',
  'WARM_REDIRECT',
] as const;

export const IntentEnum = z.enum(VALID_INTENTS);

export type Intent = z.infer<typeof IntentEnum>;

export const MappingMethodEnum = z.enum(['direct', 'fuzzy', 'resolve_manual']);

export const ModifyScopeEnum = z.enum(['single', 'this_and_future', 'series']);

export const PivotModeEnum = z.enum(['A', 'B', 'C']);

export const ProtectedBlockSchema = z.object({
  label: z.string(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
  startTime: z.string(),
  endTime: z.string(),
});

export const ProtectBlockParamsSchema = z.object({
  label: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  rangeEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.string().optional(),
  tier: z.number().int().min(0).max(3).default(1),
  rawUtterance: z.string().optional(),
});
export type ProtectBlockParams = z.infer<typeof ProtectBlockParamsSchema>;

export const RecurringBlockSchema = z.object({
  label: z.string(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  daysOfWeek: z.array(z.number()),
  rangeEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tier: z.number().default(1),
});
export type RecurringBlock = z.infer<typeof RecurringBlockSchema>;

export const FaxEffectConfigSchema = z.object({
  targetSlotsPerOffer: z.number().int().default(2),
  minBufferMinutes: z.number().int().default(15),
  clusteringWeight: z.number().default(0.35),
  energyWeight: z.number().default(0.45),
  fragmentPenaltyWeight: z.number().default(0.15),
  protectDeepWorkBlocks: z.boolean().default(true),
});

export const UserPolicyProfileSchema = z.object({
  schemaVersion: z.number().int().default(1),
  userId: z.string().uuid().optional(),
  protectedBlocks: z.array(ProtectedBlockSchema).default([]),
  shapeRules: z.record(z.unknown()).default({}),
  gatekeepRules: z.array(z.object({
    contact: z.string(),
    tier: z.number().int().min(0).max(3),
  })).default([]),
  timezone: z.string().default('America/Chicago'),
  workingHoursStart: z.string().default('09:00'),
  workingHoursEnd: z.string().default('18:00'),
  chronotype: z.enum(['morning', 'evening', 'flexible']).default('morning'),
  defaultBufferMinutes: z.number().int().default(15),
  clusteringPreference: z.string().default('balanced'),
  maxFragmentsPerDay: z.number().int().default(4),
  faxEffectConfig: FaxEffectConfigSchema.optional(),
  contactTiers: z.record(z.number()).default({}),
  shareAvailabilityOnInvite: z.boolean().default(true),
  onboardingComplete: z.boolean().default(false),
});

export type UserPolicyProfile = z.infer<typeof UserPolicyProfileSchema>;

export const CandidateSlotSchema = z.object({
  start: z.string(),
  end: z.string(),
  adjacentEventCount: z.number().int().default(0),
  energyScore: z.number().default(0.5),
  createsFragment: z.boolean().default(false),
  score: z.number().optional(),
  label: z.string().optional(),
});

export type CandidateSlot = z.infer<typeof CandidateSlotSchema>;

export function migratePolicy(raw: unknown): UserPolicyProfile {
  const obj = typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
  if (obj.schemaVersion === undefined || (obj.schemaVersion as number) < 1) {
    obj.schemaVersion = 1;
  }
  if (!obj.protectedBlocks) obj.protectedBlocks = [];
  if (!obj.shapeRules) obj.shapeRules = {};
  if (!obj.gatekeepRules) obj.gatekeepRules = [];
  if (!obj.timezone) obj.timezone = 'America/Chicago';
  if (!obj.workingHoursStart) obj.workingHoursStart = '09:00';
  if (!obj.workingHoursEnd) obj.workingHoursEnd = '18:00';
  if (!obj.chronotype) obj.chronotype = 'morning';
  if (!obj.defaultBufferMinutes) obj.defaultBufferMinutes = 15;
  if (!obj.clusteringPreference) obj.clusteringPreference = 'balanced';
  if (!obj.maxFragmentsPerDay) obj.maxFragmentsPerDay = 4;
  if (!obj.contactTiers) obj.contactTiers = {};
  if (obj.shareAvailabilityOnInvite === undefined) obj.shareAvailabilityOnInvite = true;
  if (obj.onboardingComplete === undefined) obj.onboardingComplete = false;
  if (!obj.faxEffectConfig) {
    obj.faxEffectConfig = {
      targetSlotsPerOffer: 2,
      minBufferMinutes: 15,
      clusteringWeight: 0.35,
      energyWeight: 0.45,
      fragmentPenaltyWeight: 0.15,
      protectDeepWorkBlocks: true,
    };
  }
  return UserPolicyProfileSchema.parse(obj);
}

export const CalendarEventSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  participants: z.array(z.string()).default([]),
  tier: z.number().int().min(0).max(3).default(2),
  isRecurring: z.boolean().default(false),
  recurrence: z.array(z.string()).optional(),
  timeZone: z.string().optional(),
  status: z.enum(['confirmed', 'cancelled', 'proposed']).default('confirmed'),
  gcalEventId: z.string().optional().nullable(),
  proposedForSession: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const ParsedIntentSchema = z.object({
  intent: IntentEnum,
  confidence: z.number().min(0).max(1),
  params: z.record(z.unknown()).default({}),
  mappingMethod: MappingMethodEnum,
  rawUtterance: z.string().min(1).max(1000),
  _destructivePreFilter: z.boolean().optional(),
  _warmRedirect: z.boolean().optional(),
  _offTopic: z.boolean().optional(),
});

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>;

export const SlotSchema = z.object({
  start: z.string(),
  end: z.string(),
  score: z.number().optional(),
  label: z.string().optional(),
});

export const IntentResultSchema = z.object({
  intent: IntentEnum,
  success: z.boolean(),
  requiresConfirmation: z.boolean(),
  messageToUser: z.string().optional(),
  confirmationToken: z.string().uuid().optional(),
  slots: z.array(SlotSchema).optional(),
  eventsAffected: z.union([z.number().int(), z.array(z.unknown())]).optional(),
  schemaVersion: z.number().int().optional(),
  schedulingLink: z.string().url().optional(),
  executionStatus: z.enum(['success', 'failed']).optional(),
  isWarmRedirect: z.boolean().optional(),
  atomicOp: z.string().optional(),
  failureReason: z.string().optional(),
});

export type IntentResult = z.infer<typeof IntentResultSchema>;

export const CLASSIFY_INTENT_TOOL = {
  name: 'classify_intent',
  description: 'Classify a calendar utterance into a canonical intent and extract structured params',
  input_schema: {
    type: 'object' as const,
    properties: {
      intent: {
        type: 'string',
        enum: [
          'PROTECT_BLOCK', 'OFFER_SPECIFIC', 'CREATE_EVENT', 'FLUSH_RANGE',
          'MODIFY_EVENT', 'PIVOT_ASYNC', 'SHAPE_RULES', 'GATEKEEP_RULE',
          'QUERY_CALENDAR', 'UNDO', 'INVITE_PLATFORM', 'RESOLVE_MANUAL',
        ],
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      params: {
        type: 'object',
        description: 'Intent-specific fields. CREATE_EVENT: title, start, end, participants? (emails), description?, isRecurring?, recurrence? (RRULE strings), timeZone? (IANA). MODIFY_EVENT: eventTitle?, newTitle?, newStart?, newEnd?, addInvitees? (emails), newDescription?. QUERY_CALENDAR: rangeStart?, rangeEnd?. FLUSH_RANGE: rangeStart?, rangeEnd?, eventTitle? (delete one event by title).',
        properties: {
          title: { type: 'string', description: 'Event title for CREATE_EVENT' },
          start: { type: 'string', description: 'ISO 8601 start datetime' },
          end: { type: 'string', description: 'ISO 8601 end datetime' },
          isRecurring: { type: 'boolean', description: 'True when user wants a recurring series (CREATE_EVENT)' },
          recurrence: {
            type: 'array',
            items: { type: 'string' },
            description: 'Google Calendar RRULE strings, e.g. RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR for weekdays',
          },
          timeZone: { type: 'string', description: 'IANA timezone from user phrase (e.g. America/Chicago for Central Time)' },
          description: { type: 'string', description: 'Event description/notes for CREATE_EVENT or MODIFY_EVENT' },
          newDescription: { type: 'string', description: 'New description when updating an event' },
          participants: { type: 'array', items: { type: 'string' }, description: 'Guest emails for CREATE_EVENT' },
          eventTitle: { type: 'string', description: 'Existing event title to match for MODIFY_EVENT' },
          newTitle: { type: 'string', description: 'New title when renaming an event' },
          newStart: { type: 'string', description: 'New start time for MODIFY_EVENT' },
          newEnd: { type: 'string', description: 'New end time for MODIFY_EVENT' },
          addInvitees: { type: 'array', items: { type: 'string' }, description: 'Emails to invite to an existing event' },
          rangeStart: { type: 'string', description: 'Query/cancel window start ISO' },
          rangeEnd: { type: 'string', description: 'Query/cancel window end ISO' },
          recipientName: { type: 'string', description: 'Name of person to meet for OFFER_SPECIFIC' },
          recipientEmail: { type: 'string', description: 'Email of invitee for OFFER_SPECIFIC' },
          inviteeEmail: { type: 'string', description: 'Email for INVITE_PLATFORM' },
          email: { type: 'string', description: 'Email alias for invites' },
          label: { type: 'string', description: 'Label for PROTECT_BLOCK' },
        },
      },
      mappingMethod: {
        type: 'string',
        enum: ['direct', 'fuzzy', 'resolve_manual'],
      },
    },
    required: ['intent', 'confidence', 'params', 'mappingMethod'],
  },
};

export const DESTRUCTIVE_VERB_RE = /\b(delete|cancel|remove|clear|drop|erase|wipe)\b/i;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CALENDAR_TOPIC_RE = /\b(calendar|meetings?|schedule|block|free|busy|appointments?|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|mornings?|afternoons?|events?|calls?|slots?|times?|undo|decline|move|cancel|protect|lunch|standup|deep work|haircut|dentist|investor|starting|ending|hour|update|change|rename|central|invite|invitee|guest|attendee|participant)\b/i;

export const OFF_TOPIC_RE = /\b(weather|sports|recipe|joke|movie|stock price|president|politics|election|capital of|tell me a story|homework|write code|python|javascript|news headlines?)\b/i;

/** WH-questions and general knowledge — off-domain unless calendar words present */
export const GENERAL_KNOWLEDGE_RE = /\b(who is|who was|what is the|what's the|when did|where is|why did|how old|how tall|explain|define|capital of|population of)\b/i;

/** Caladdin only handles calendar/scheduling — never general chat or trivia */
export const CALENDAR_ONLY_MESSAGE =
  'I only help with your calendar — scheduling, events, availability, and protecting your time. I can\'t answer general questions. Try: "What\'s on my calendar today?" or "Block tomorrow morning for focus."';

export const WARM_REDIRECT_MESSAGE = CALENDAR_ONLY_MESSAGE;

export const RESOLVE_MANUAL_MESSAGE =
  'I want to help — could you be more specific? For example: "What\'s on my calendar today?", "Block Tuesday mornings", or "Find time for Alex next week".';

export interface OrchestratorContext {
  userId: string;
  requestId: string;
  timezone?: string;
  oauthClient?: unknown;
  conversationContext?: import('../db/conversation-context.js').ConversationContext | null;
  _skipConfirmationGate?: boolean;
}

export interface FailureLogEntry {
  id?: string;
  user_id?: string | null;
  raw_utterance?: string | null;
  attempted_intent?: string | null;
  confidence?: number | null;
  failure_reason?: string | null;
  request_id?: string | null;
  created_at?: string;
}

export const MUTATION_INTENTS: Intent[] = [
  'PROTECT_BLOCK', 'OFFER_SPECIFIC', 'CREATE_EVENT', 'FLUSH_RANGE',
  'MODIFY_EVENT', 'PIVOT_ASYNC', 'SHAPE_RULES', 'GATEKEEP_RULE', 'UNDO', 'INVITE_PLATFORM',
];

export const READ_INTENTS: Intent[] = ['QUERY_CALENDAR'];
