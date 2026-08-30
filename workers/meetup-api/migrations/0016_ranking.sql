ALTER TABLE meetups ADD COLUMN xp_reward INTEGER NOT NULL DEFAULT 100 CHECK (xp_reward >= 0);

CREATE TABLE IF NOT EXISTS participant_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  nickname_key TEXT NOT NULL UNIQUE,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_participant_profiles_is_public
ON participant_profiles(is_public);
