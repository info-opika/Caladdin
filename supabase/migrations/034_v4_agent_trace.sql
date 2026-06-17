-- v4: observability for scheduling agent tool loop on command_logs
ALTER TABLE command_logs
  ADD COLUMN IF NOT EXISTS agent_trace JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_command_logs_agent_trace
  ON command_logs ((agent_trace IS NOT NULL))
  WHERE agent_trace IS NOT NULL;
