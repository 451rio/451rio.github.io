CREATE TABLE raffle_winners_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meetup_slug TEXT NOT NULL,
  registration_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  won_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (meetup_slug) REFERENCES meetups(slug) ON DELETE CASCADE,
  FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE
);

INSERT INTO raffle_winners_new (id, meetup_slug, registration_id, name, won_at)
SELECT id, meetup_slug, registration_id, name, won_at FROM raffle_winners;

DROP TABLE raffle_winners;

ALTER TABLE raffle_winners_new RENAME TO raffle_winners;

CREATE UNIQUE INDEX idx_raffle_winners_meetup_registration
ON raffle_winners(meetup_slug, registration_id);
