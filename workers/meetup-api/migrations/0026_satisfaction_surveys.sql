CREATE TABLE IF NOT EXISTS satisfaction_surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meetup_slug TEXT NOT NULL,
  pre_event_communication INTEGER NOT NULL CHECK (pre_event_communication BETWEEN 1 AND 5),
  organization INTEGER NOT NULL CHECK (organization BETWEEN 1 AND 5),
  venue INTEGER NOT NULL CHECK (venue BETWEEN 1 AND 5),
  tech_infrastructure INTEGER NOT NULL CHECK (tech_infrastructure BETWEEN 1 AND 5),
  talks INTEGER NOT NULL CHECK (talks BETWEEN 1 AND 5),
  coffee_break INTEGER NOT NULL CHECK (coffee_break BETWEEN 1 AND 5),
  raffle_prizes INTEGER NOT NULL CHECK (raffle_prizes BETWEEN 1 AND 5),
  networking INTEGER NOT NULL CHECK (networking BETWEEN 1 AND 5),
  overall_experience INTEGER NOT NULL CHECK (overall_experience BETWEEN 1 AND 5),
  expectations INTEGER NOT NULL CHECK (expectations BETWEEN 1 AND 5),
  recommendation INTEGER NOT NULL CHECK (recommendation BETWEEN 1 AND 5),
  comments TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meetup_slug) REFERENCES meetups(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_meetup_slug
ON satisfaction_surveys(meetup_slug);
