-- Self-service subscription management: passwordless login (magic link) and
-- registration cancellation.

-- One row per magic link request. `email_hash` is a blind index (HMAC) and is
-- always recorded so rate limiting works without leaking whether the address
-- has registrations. `email` and `token_hash` are only filled in when a token
-- was actually issued.
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

-- Short lived bearer sessions created after a magic link is consumed.
-- Only the SHA-256 hash of the token is stored.
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

-- Login and the registration listing both look registrations up by e-mail
-- alone. The existing UNIQUE (meetup_slug, email) index cannot serve that
-- (wrong leading column), so without this every login scans the table.
CREATE INDEX IF NOT EXISTS idx_registrations_email
ON registrations(email);

-- Anonymous audit trail so capacity churn can be inspected without keeping
-- personal data of people who cancelled.
CREATE TABLE IF NOT EXISTS registration_cancellations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meetup_slug TEXT NOT NULL,
  cancelled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_registration_cancellations_meetup_slug
ON registration_cancellations(meetup_slug);
