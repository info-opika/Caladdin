-- 007_scheduling_sessions.sql
CREATE TABLE IF NOT EXISTS scheduling_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  host_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slots JSONB NOT NULL,
  host_name TEXT,
  context TEXT,
  posture TEXT CHECK (posture IN ('strict', 'mutual', 'flexible')) DEFAULT 'mutual',
  status TEXT CHECK (status IN ('open', 'booked', 'expired')) DEFAULT 'open',
  proposed_event_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduling_token ON scheduling_sessions(token);
