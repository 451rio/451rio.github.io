CREATE TABLE captcha_challenges_new (
  id TEXT PRIMARY KEY,
  seed TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE captcha_challenges;
ALTER TABLE captcha_challenges_new RENAME TO captcha_challenges;

CREATE INDEX IF NOT EXISTS idx_captcha_challenges_expires_at
ON captcha_challenges(expires_at);
