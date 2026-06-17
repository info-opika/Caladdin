-- v3: scoped, single-invite free/busy OAuth grants for invitees (spec §2.7)
CREATE TABLE IF NOT EXISTS invite_calendar_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduling_session_id UUID NOT NULL UNIQUE REFERENCES scheduling_sessions(id) ON DELETE CASCADE,
  invitee_email TEXT,
  oauth_access_token TEXT,
  oauth_refresh_token TEXT,
  oauth_expiry TIMESTAMPTZ,
  preferred_window_start TIMESTAMPTZ,
  preferred_window_end TIMESTAMPTZ,
  status TEXT CHECK (status IN ('active', 'expired', 'revoked')) DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_calendar_grants_session ON invite_calendar_grants(scheduling_session_id);
CREATE INDEX IF NOT EXISTS idx_invite_calendar_grants_expires ON invite_calendar_grants(expires_at) WHERE status = 'active';
