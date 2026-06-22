-- Track previously offered slot pairs so "find next" can paginate without recycling.
ALTER TABLE scheduling_sessions
  ADD COLUMN IF NOT EXISTS dismissed_slots jsonb NOT NULL DEFAULT '[]'::jsonb;
