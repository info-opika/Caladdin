-- 017_scheduling_extensions.sql
ALTER TABLE scheduling_sessions
  ADD COLUMN IF NOT EXISTS invitee_email TEXT,
  ADD COLUMN IF NOT EXISTS host_timezone TEXT DEFAULT 'America/Chicago',
  ADD COLUMN IF NOT EXISTS duration_minutes INT DEFAULT 30,
  ADD COLUMN IF NOT EXISTS offered_slots JSONB,
  ADD COLUMN IF NOT EXISTS selected_slot JSONB,
  ADD COLUMN IF NOT EXISTS google_event_id TEXT,
  ADD COLUMN IF NOT EXISTS proposed_alternatives JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS host_name TEXT;

-- Extend status values for claim/finalize flow
ALTER TABLE scheduling_sessions DROP CONSTRAINT IF EXISTS scheduling_sessions_status_check;
ALTER TABLE scheduling_sessions ADD CONSTRAINT scheduling_sessions_status_check
  CHECK (status IN ('open', 'pending', 'booked', 'confirmed', 'expired'));

CREATE TABLE IF NOT EXISTS platform_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  inviter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_email TEXT NOT NULL,
  status TEXT CHECK (status IN ('sent', 'accepted', 'expired')) DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_invites_token ON platform_invites(token);
CREATE INDEX IF NOT EXISTS idx_platform_invites_email ON platform_invites(invitee_email);
