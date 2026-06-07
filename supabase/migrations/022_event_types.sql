-- 022_event_types.sql — Persistent event types for public booking URLs (P1-01)

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  description TEXT,
  availability_rules JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_event_types_user_active ON event_types (user_id, active);
CREATE INDEX IF NOT EXISTS idx_event_types_slug ON event_types (slug);

-- ---------------------------------------------------------------------------
-- event_types RLS (user_id scoped)
-- ---------------------------------------------------------------------------
ALTER TABLE event_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_types_select_own ON event_types
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY event_types_insert_own ON event_types
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY event_types_update_own ON event_types
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY event_types_delete_own ON event_types
  FOR DELETE USING (user_id = app_current_user_id());
