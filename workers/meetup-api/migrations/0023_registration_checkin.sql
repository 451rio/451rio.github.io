ALTER TABLE registrations ADD COLUMN checkin_code TEXT;
ALTER TABLE registrations ADD COLUMN checked_in_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_checkin_code
ON registrations(checkin_code) WHERE checkin_code IS NOT NULL;
