-- v3: NL command audit trail for confirm-before-acting and debugging
CREATE TABLE IF NOT EXISTS command_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_input TEXT NOT NULL,
  input_mode TEXT CHECK (input_mode IN ('text', 'voice')) DEFAULT 'text',
  parsed_intent TEXT,
  parsed_params JSONB DEFAULT '{}',
  confirmed BOOLEAN DEFAULT false,
  resulting_action_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_command_logs_user_created ON command_logs(user_id, created_at DESC);
