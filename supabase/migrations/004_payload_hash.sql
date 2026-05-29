-- 004_payload_hash.sql
ALTER TABLE pending_confirmations
ADD COLUMN IF NOT EXISTS payload_hash TEXT;
