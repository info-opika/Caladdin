import { getSupabase } from './client.js';

export async function recordUsageEvent(
  userId: string | null,
  eventType: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await getSupabase().from('usage_events').insert({
      user_id: userId,
      event_type: eventType,
      metadata,
    });
    if (error) {
      // Table may not exist in unit tests
    }
  } catch {
    // Non-fatal telemetry
  }
}
