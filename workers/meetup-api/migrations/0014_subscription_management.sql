CREATE TABLE IF NOT EXISTS auth_login_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT NOT NULL,
  email TEXT,
  token_hash TEXT UNIQUE,
  expires_at TEXT,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_login_requests_email_hash_created_at
ON auth_login_requests(email_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_auth_login_requests_created_at
ON auth_login_requests(created_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
ON auth_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_registrations_email
ON registrations(email);

CREATE TABLE IF NOT EXISTS registration_cancellations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meetup_slug TEXT NOT NULL,
  cancelled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_registration_cancellations_meetup_slug
ON registration_cancellations(meetup_slug);
