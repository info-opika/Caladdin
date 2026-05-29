import { z } from 'zod';

export const IntentEnum = z.enum([
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
  'RESOLVE_MANUAL',
]);

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

export const UserPolicyProfileSchema = z.object({
  schemaVersion: z.number().int().default(1),
  protectedBlocks: z.array(ProtectedBlockSchema).default([]),
  shapeRules: z.record(z.unknown()).default({}),
  gatekeepRules: z.array(z.object({
    contact: z.string(),
    tier: z.number().int().min(0).max(3),
  })).default([]),
  timezone: z.string().default('America/Chicago'),
  workingHoursStart: z.string().default('09:00'),
  workingHoursEnd: z.string().default('18:00'),
});

export type UserPolicyProfile = z.infer<typeof UserPolicyProfileSchema>;

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
  status: z.enum(['confirmed', 'cancelled', 'proposed']).default('confirmed'),
  gcalEventId: z.string().optional().nullable(),
  proposedForSession: z.string().uuid().optional().nullable(),
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
  messageToUser: z.string(),
  confirmationToken: z.string().uuid().optional(),
  slots: z.array(SlotSchema).optional(),
  eventsAffected: z.number().int().optional(),
  schemaVersion: z.number().int().optional(),
  schedulingLink: z.string().url().optional(),
  executionStatus: z.enum(['success', 'failed']).optional(),
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
          'QUERY_CALENDAR', 'UNDO', 'RESOLVE_MANUAL',
        ],
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      params: {
        type: 'object',
        description: 'Intent-specific fields. CREATE_EVENT: title, start, end (ISO 8601). MODIFY_EVENT: eventTitle?, newTitle?, newStart?, newEnd?. QUERY_CALENDAR: rangeStart?, rangeEnd?. FLUSH_RANGE: rangeStart, rangeEnd.',
        properties: {
          title: { type: 'string', description: 'Event title for CREATE_EVENT' },
          start: { type: 'string', description: 'ISO 8601 start datetime' },
          end: { type: 'string', description: 'ISO 8601 end datetime' },
          eventTitle: { type: 'string', description: 'Existing event title to match for MODIFY_EVENT' },
          newTitle: { type: 'string', description: 'New title when renaming an event' },
          newStart: { type: 'string', description: 'New start time for MODIFY_EVENT' },
          newEnd: { type: 'string', description: 'New end time for MODIFY_EVENT' },
          rangeStart: { type: 'string', description: 'Query/cancel window start ISO' },
          rangeEnd: { type: 'string', description: 'Query/cancel window end ISO' },
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

export const CALENDAR_TOPIC_RE = /\b(calendar|meetings?|schedule|block|free|busy|appointments?|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|mornings?|afternoons?|events?|calls?|slots?|times?|undo|decline|move|cancel|protect|lunch|standup|deep work|haircut|dentist|investor)\b/i;

export const OFF_TOPIC_RE = /\b(weather|sports|recipe|joke|movie|stock price)\b/i;

export const WARM_REDIRECT_MESSAGE =
  'Good to know! Anything I can help you with? Your calendar? Setting up a time with a friend?';

export const RESOLVE_MANUAL_MESSAGE =
  'I want to help — could you be more specific? For example: "What\'s on my calendar today?", "Block Tuesday mornings", or "Find time for Alex next week".';

export interface OrchestratorContext {
  userId: string;
  requestId: string;
  oauthClient?: unknown;
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
  'MODIFY_EVENT', 'PIVOT_ASYNC', 'SHAPE_RULES', 'GATEKEEP_RULE', 'UNDO',
];

export const READ_INTENTS: Intent[] = ['QUERY_CALENDAR'];
