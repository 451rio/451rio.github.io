-- Duck race raffle: draws happen only among checked-in registrations of a meetup,
-- and each registration can only win once per meetup (a pato that already won is
-- excluded from the eligible pool in later races of the same edition).
CREATE TABLE raffle_winners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meetup_slug TEXT NOT NULL REFERENCES meetups(slug),
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  name TEXT NOT NULL,
  won_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- Guards the "can't win twice" rule at the database level, not just in the query
-- that picks eligible ducks — a stray second insert can never sneak a repeat win in.
CREATE UNIQUE INDEX idx_raffle_winners_meetup_registration
ON raffle_winners(meetup_slug, registration_id);

CREATE INDEX idx_raffle_winners_meetup ON raffle_winners(meetup_slug);
