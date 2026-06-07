-- 025_performance_indexes.sql — Cal.com-scale query paths (Agent 2 perf sprint)

-- Public booking: user_id + slug for active event types
CREATE INDEX IF NOT EXISTS idx_event_types_user_slug_active
  ON event_types (user_id, slug)
  WHERE active = TRUE;

-- Host dashboard: list event types by recency
CREATE INDEX IF NOT EXISTS idx_event_types_user_created
  ON event_types (user_id, created_at DESC);

-- Host session history
CREATE INDEX IF NOT EXISTS idx_scheduling_sessions_host_created
  ON scheduling_sessions (host_user_id, created_at DESC);

-- Session expiry worker (open/pending past expires_at)
CREATE INDEX IF NOT EXISTS idx_scheduling_sessions_status_expires
  ON scheduling_sessions (status, expires_at)
  WHERE status IN ('open', 'pending');

-- Reminder upsert fallback + host joins
CREATE INDEX IF NOT EXISTS idx_booking_reminders_session_type
  ON booking_reminders (session_id, reminder_type);

-- Rate limit oldest-in-window lookup (ascending created_at)
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_bucket_created_asc
  ON rate_limit_events (bucket_key, created_at ASC);

-- Retention / cleanup sweeps on stale rate limit rows
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_created
  ON rate_limit_events (created_at);
