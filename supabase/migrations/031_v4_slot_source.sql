-- v4: honest slot-source metadata on scheduling sessions
ALTER TABLE scheduling_sessions
  ADD COLUMN IF NOT EXISTS slot_source TEXT
  CHECK (
    slot_source IS NULL
    OR slot_source IN ('mutual_known_user', 'host_only_pending_grant')
  );
