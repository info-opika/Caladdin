-- 024_booking_reminders.sql — T-24h / T-1h reminder queue (P1-05)

CREATE TABLE IF NOT EXISTS booking_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES scheduling_sessions(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('t24h', 't1h')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'skipped', 'failed')) DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_booking_reminders_due
  ON booking_reminders (status, scheduled_for)
  WHERE status = 'pending';

ALTER TABLE booking_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_reminders_select_own ON booking_reminders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM scheduling_sessions ss
      WHERE ss.id = booking_reminders.session_id
        AND ss.host_user_id = app_current_user_id()
    )
  );

CREATE POLICY booking_reminders_insert_own ON booking_reminders
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM scheduling_sessions ss
      WHERE ss.id = booking_reminders.session_id
        AND ss.host_user_id = app_current_user_id()
    )
  );

CREATE POLICY booking_reminders_update_own ON booking_reminders
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM scheduling_sessions ss
      WHERE ss.id = booking_reminders.session_id
        AND ss.host_user_id = app_current_user_id()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM scheduling_sessions ss
      WHERE ss.id = booking_reminders.session_id
        AND ss.host_user_id = app_current_user_id()
    )
  );

CREATE POLICY booking_reminders_delete_own ON booking_reminders
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM scheduling_sessions ss
      WHERE ss.id = booking_reminders.session_id
        AND ss.host_user_id = app_current_user_id()
    )
  );
