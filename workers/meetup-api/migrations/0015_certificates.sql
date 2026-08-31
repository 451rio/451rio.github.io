ALTER TABLE meetups ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 240 CHECK (duration_minutes > 0);

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  meetup_slug TEXT NOT NULL,
  registration_id INTEGER NOT NULL,
  participant_name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meetup_slug) REFERENCES meetups(slug) ON DELETE CASCADE,
  FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
  UNIQUE (meetup_slug, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_certificates_registration_id
ON certificates(registration_id);
