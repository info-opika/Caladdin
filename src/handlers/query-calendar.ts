import { ParsedIntent, IntentResult, OrchestratorContext } from '../core/adts.js';
import { listEventsFromGCalSafe } from '../services/calendar_api.js';
import { normalizeGCalRange } from '../core/date-utils.js';
import { calendar_v3 } from 'googleapis';

export async function handleQueryCalendar(
  parsed: ParsedIntent,
  ctx: OrchestratorContext,
  cal: calendar_v3.Calendar | null,
): Promise<IntentResult> {
  const { timeMin, timeMax } = normalizeGCalRange(
    parsed.params.rangeStart,
    parsed.params.rangeEnd,
    7,
  );

  if (!cal) {
    return {
      intent: 'QUERY_CALENDAR',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'Your Google Calendar is not connected. Sign out and sign in again to reconnect.',
      schemaVersion: 1,
    };
  }

  const { events, error } = await listEventsFromGCalSafe(cal, timeMin, timeMax);

  if (error) {
    return {
      intent: 'QUERY_CALENDAR',
      success: false,
      requiresConfirmation: false,
      messageToUser: 'I could not read your Google Calendar. Try signing out and signing in again to refresh access.',
      schemaVersion: 1,
    };
  }

  if (events.length === 0) {
    return {
      intent: 'QUERY_CALENDAR',
      success: true,
      requiresConfirmation: false,
      messageToUser: 'Your Google Calendar looks clear for the next week.',
      eventsAffected: 0,
      schemaVersion: 1,
    };
  }

  const lines = events.slice(0, 10).map((e) => {
    const start = new Date(e.start);
    return `• ${e.title} — ${start.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  });

  return {
    intent: 'QUERY_CALENDAR',
    success: true,
    requiresConfirmation: false,
    messageToUser: `Here's what's on your Google Calendar:\n${lines.join('\n')}`,
    eventsAffected: events.length,
    schemaVersion: 1,
  };
}
