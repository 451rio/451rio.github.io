CREATE TABLE raffle_winners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meetup_slug TEXT NOT NULL REFERENCES meetups(slug),
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  name TEXT NOT NULL,
  won_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE UNIQUE INDEX idx_raffle_winners_meetup_registration
ON raffle_winners(meetup_slug, registration_id);

CREATE INDEX idx_raffle_winners_meetup ON raffle_winners(meetup_slug);
