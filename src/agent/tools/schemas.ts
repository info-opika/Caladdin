import { z } from 'zod';
import { zodToJsonSchema } from './zod-to-json-schema.js';

const emailSchema = z.string().email();
const isoDateTimeSchema = z.string().min(1);
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeHmSchema = z.string().regex(/^\d{2}:\d{2}$/);

export const FindAvailableSlotsInputSchema = z.object({
  durationMinutes: z.number().int().min(5).max(480).optional(),
  rangeStart: isoDateTimeSchema.optional(),
  rangeEnd: isoDateTimeSchema.optional(),
  inviteeEmail: emailSchema.optional(),
});
export type FindAvailableSlotsInput = z.infer<typeof FindAvailableSlotsInputSchema>;

export const CheckSpecificSlotInputSchema = z.object({
  start: isoDateTimeSchema,
  durationMinutes: z.number().int().min(5).max(480).optional(),
  inviteeEmail: emailSchema.optional(),
});
export type CheckSpecificSlotInput = z.infer<typeof CheckSpecificSlotInputSchema>;

export const CreateEventInputSchema = z.object({
  title: z.string().min(1).max(200),
  start: isoDateTimeSchema,
  durationMinutes: z.number().int().min(5).max(480).optional(),
  attendeeEmail: emailSchema.optional(),
  description: z.string().max(2000).optional(),
});
export type CreateEventInput = z.infer<typeof CreateEventInputSchema>;

export const CreateRecurringBlockInputSchema = z.object({
  label: z.string().min(1).max(120),
  startTime: timeHmSchema,
  endTime: timeHmSchema.optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  rangeEnd: dateOnlySchema,
  startDate: dateOnlySchema.optional(),
});
export type CreateRecurringBlockInput = z.infer<typeof CreateRecurringBlockInputSchema>;

const slotPairSchema = z.object({
  start: isoDateTimeSchema,
  end: isoDateTimeSchema.optional(),
});

export const SendInviteInputSchema = z.object({
  inviteeEmail: emailSchema,
  durationMinutes: z.number().int().min(5).max(480).optional(),
  /** Single proposed slot start (end = start + duration). Prefer proposedSlots for multiple times. */
  proposedStart: isoDateTimeSchema.optional(),
  /** Explicit offered times (ISO start/end). Use when the user names specific slots. */
  proposedSlots: z.array(slotPairSchema).min(1).max(5).optional(),
  /** Meeting label shown on the scheduling session (e.g. "Tester"). */
  meetingTitle: z.string().min(1).max(200).optional(),
  context: z.string().max(500).optional(),
});
export type SendInviteInput = z.infer<typeof SendInviteInputSchema>;

export const GetInviteStatusInputSchema = z
  .object({
    sessionToken: z.string().min(1).optional(),
    inviteeEmail: emailSchema.optional(),
  })
  .refine((d) => Boolean(d.sessionToken || d.inviteeEmail), {
    message: 'Provide sessionToken or inviteeEmail',
  });
export type GetInviteStatusInput = z.infer<typeof GetInviteStatusInputSchema>;

export const UpdateSessionSlotsInputSchema = z.object({
  sessionToken: z.string().min(1),
  slots: z.array(slotPairSchema).min(1).max(5),
});
export type UpdateSessionSlotsInput = z.infer<typeof UpdateSessionSlotsInputSchema>;

export const LookupUserInputSchema = z.object({
  email: emailSchema,
});
export type LookupUserInput = z.infer<typeof LookupUserInputSchema>;

export const GetCalendarSummaryInputSchema = z.object({
  rangeStart: isoDateTimeSchema.optional(),
  rangeEnd: isoDateTimeSchema.optional(),
});
export type GetCalendarSummaryInput = z.infer<typeof GetCalendarSummaryInputSchema>;

export const UpdatePreferencesInputSchema = z.object({
  timezone: z.string().optional(),
  workingHoursStart: timeHmSchema.optional(),
  workingHoursEnd: timeHmSchema.optional(),
  defaultMeetingLengthMinutes: z.number().int().min(5).max(480).optional(),
  meetingTimePreference: z.enum(['morning', 'afternoon', 'flexible']).optional(),
});
export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesInputSchema>;

export const ModifyEventInputSchema = z.object({
  eventTitle: z.string().optional(),
  newTitle: z.string().optional(),
  newStart: isoDateTimeSchema.optional(),
  newEnd: isoDateTimeSchema.optional(),
  addAttendeeEmail: emailSchema.optional(),
});
export type ModifyEventInput = z.infer<typeof ModifyEventInputSchema>;

export const CancelEventsInRangeInputSchema = z.object({
  rangeStart: isoDateTimeSchema.optional(),
  rangeEnd: isoDateTimeSchema.optional(),
  eventTitle: z.string().optional(),
});
export type CancelEventsInRangeInput = z.infer<typeof CancelEventsInRangeInputSchema>;

export const UndoLastActionInputSchema = z.object({});
export type UndoLastActionInput = z.infer<typeof UndoLastActionInputSchema>;

export const TOOL_NAMES = [
  'find_available_slots',
  'check_specific_slot',
  'create_event',
  'create_recurring_block',
  'send_invite',
  'get_invite_status',
  'update_session_slots',
  'lookup_user',
  'get_calendar_summary',
  'update_preferences',
  'modify_event',
  'cancel_events_in_range',
  'undo_last_action',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  find_available_slots: 'Find open meeting slots on the host or mutual calendar.',
  check_specific_slot: 'Check if a specific date/time is free.',
  create_event: 'Create a single calendar event with title and start time.',
  create_recurring_block: 'Create a recurring personal time block (PROTECT_BLOCK).',
  send_invite: 'Send a scheduling invite; pass proposedSlots for named times (ISO with timezone).',
  get_invite_status: 'Check invite grant status and offered slots for a session.',
  update_session_slots: 'Replace offered slots on an open scheduling session.',
  lookup_user: 'Check if an email is a Caladdin user with calendar connected.',
  get_calendar_summary: 'Read-only summary of calendar events for a day or week.',
  update_preferences: 'Update scheduling preferences (timezone, hours, duration).',
  modify_event: 'Modify an existing event (time, title, or attendee).',
  cancel_events_in_range: 'Cancel or delete calendar events by title or date range.',
  undo_last_action: 'Undo the most recent reversible calendar action.',
};

const SCHEMA_BY_TOOL: Record<ToolName, z.ZodTypeAny> = {
  find_available_slots: FindAvailableSlotsInputSchema,
  check_specific_slot: CheckSpecificSlotInputSchema,
  create_event: CreateEventInputSchema,
  create_recurring_block: CreateRecurringBlockInputSchema,
  send_invite: SendInviteInputSchema,
  get_invite_status: GetInviteStatusInputSchema,
  update_session_slots: UpdateSessionSlotsInputSchema,
  lookup_user: LookupUserInputSchema,
  get_calendar_summary: GetCalendarSummaryInputSchema,
  update_preferences: UpdatePreferencesInputSchema,
  modify_event: ModifyEventInputSchema,
  cancel_events_in_range: CancelEventsInRangeInputSchema,
  undo_last_action: UndoLastActionInputSchema,
};

export function getToolInputSchema(name: ToolName): z.ZodTypeAny {
  return SCHEMA_BY_TOOL[name];
}

export function buildOpenAiToolDefinitions(names?: ToolName[]) {
  const selected = names ?? [...TOOL_NAMES];
  return selected.map((name) => ({
    type: 'function' as const,
    function: {
      name,
      description: TOOL_DESCRIPTIONS[name],
      parameters: zodToJsonSchema(getToolInputSchema(name)),
    },
  }));
}

/** @deprecated Use buildOpenAiToolDefinitions */
export function buildAnthropicToolDefinitions(names?: ToolName[]) {
  return buildOpenAiToolDefinitions(names).map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}
