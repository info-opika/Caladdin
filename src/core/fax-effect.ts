import { DateTime } from 'luxon';
import { type CandidateSlot, type CalendarEvent, type Intent, type UserPolicyProfile } from './adts.js';

function formatSlotTime(iso: string, tz: string): string {
  const dt = DateTime.fromISO(iso, { zone: tz });
  return dt.isValid ? dt.toFormat('h:mm a') : iso;
}

function formatSlotDay(iso: string, tz: string): string {
  const dt = DateTime.fromISO(iso, { zone: tz });
  return dt.isValid ? dt.toFormat('EEEE') : '';
}

export function generateFaxEffectMessage(
  intent: string,
  slots: CandidateSlot[],
  events: CalendarEvent[],
  profile: UserPolicyProfile,
): string {
  const tz = profile.timezone ?? 'America/Chicago';

  switch (intent) {
    case 'OFFER_SPECIFIC':
    case 'SCHEDULING_LINK':
      if (slots.length === 0) {
        return 'No suitable times found in the next week. Try a different range?';
      }
      if (slots.length === 1) {
        return `I found ${formatSlotTime(slots[0]!.start, tz)} on ${formatSlotDay(slots[0]!.start, tz)}. Share the link?`;
      }
      return `${formatSlotTime(slots[0]!.start, tz)} or ${formatSlotTime(slots[1]!.start, tz)} — two thoughtful times, picked for you.`;

    case 'PIVOT_ASYNC':
      return 'Try a Loom instead — async beats another meeting.';

    case 'FLUSH_RANGE': {
      const tier1 = events.filter((e) => e.tier === 1);
      if (tier1.length > 0) {
        return `This will cancel ${tier1.map((e) => e.title).join(', ')}. Confirm?`;
      }
      return 'These events will be cancelled. This cannot be undone.';
    }

    case 'PROTECT_BLOCK':
      return 'That time is now protected on your calendar.';

    case 'MODIFY_EVENT': {
      const name = events[0]?.title ?? 'your event';
      return `Updated ${name} on your calendar.`;
    }

    case 'SHAPE_RULES':
      return 'Your scheduling preferences are updated.';

    case 'GATEKEEP_RULE':
      return 'Contact priority updated.';

    case 'RESOLVE_MANUAL':
      return 'Could you clarify what you would like on your calendar?';

    case 'WARM_REDIRECT':
      return 'I help with your calendar — scheduling, blocks, and finding time with others.';

    default:
      return 'Done.';
  }
}

export type { Intent };
