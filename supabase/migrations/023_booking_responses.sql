-- 023_booking_responses.sql — Guest intake on booking (P1-03)

ALTER TABLE scheduling_sessions DROP CONSTRAINT IF EXISTS scheduling_sessions_status_check;
ALTER TABLE scheduling_sessions ADD CONSTRAINT scheduling_sessions_status_check
  CHECK (status IN ('open', 'pending', 'booked', 'confirmed', 'expired', 'cancelled'));

CREATE TABLE IF NOT EXISTS booking_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES scheduling_sessions(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  notes TEXT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_responses_session ON booking_responses (session_id);

-- Host reads own session responses via scheduling_sessions.host_user_id
ALTER TABLE booking_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_responses_select_own ON booking_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM scheduling_sessions ss
      WHERE ss.id = booking_responses.session_id
        AND ss.host_user_id = app_current_user_id()
    )
  );

CREATE POLICY booking_responses_insert_own ON booking_responses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM scheduling_sessions ss
      WHERE ss.id = booking_responses.session_id
        AND ss.host_user_id = app_current_user_id()
    )
  );

CREATE POLICY booking_responses_update_own ON booking_responses
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM scheduling_sessions ss
      WHERE ss.id = booking_responses.session_id
        AND ss.host_user_id = app_current_user_id()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM scheduling_sessions ss
      WHERE ss.id = booking_responses.session_id
        AND ss.host_user_id = app_current_user_id()
    )
  );

CREATE POLICY booking_responses_delete_own ON booking_responses
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM scheduling_sessions ss
      WHERE ss.id = booking_responses.session_id
        AND ss.host_user_id = app_current_user_id()
    )
  );
