-- Optional event body / notes synced to Google Calendar description field
ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT;
