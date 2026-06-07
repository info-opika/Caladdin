-- 027_team_scheduling.sql — Multi-host event types with round-robin assignment

ALTER TABLE event_types
  ADD COLUMN IF NOT EXISTS scheduling_mode TEXT NOT NULL DEFAULT 'single'
    CHECK (scheduling_mode IN ('single', 'round_robin'));

ALTER TABLE event_types
  ADD COLUMN IF NOT EXISTS round_robin_index INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS event_type_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type_id UUID NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_type_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_type_members_event_position
  ON event_type_members (event_type_id, position ASC);

ALTER TABLE event_type_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_type_members_select_own ON event_type_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM event_types et
      WHERE et.id = event_type_members.event_type_id
        AND et.user_id = app_current_user_id()
    )
  );

CREATE POLICY event_type_members_insert_own ON event_type_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM event_types et
      WHERE et.id = event_type_members.event_type_id
        AND et.user_id = app_current_user_id()
    )
  );

CREATE POLICY event_type_members_update_own ON event_type_members
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM event_types et
      WHERE et.id = event_type_members.event_type_id
        AND et.user_id = app_current_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM event_types et
      WHERE et.id = event_type_members.event_type_id
        AND et.user_id = app_current_user_id()
    )
  );

CREATE POLICY event_type_members_delete_own ON event_type_members
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM event_types et
      WHERE et.id = event_type_members.event_type_id
        AND et.user_id = app_current_user_id()
    )
  );
