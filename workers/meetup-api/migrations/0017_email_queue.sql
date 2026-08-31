CREATE TABLE email_jobs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'confirmation' CHECK (kind IN ('confirmation', 'certificate')),
  meetup_slug TEXT NOT NULL,
  template_id INTEGER,
  registration_id INTEGER,
  certificate_code TEXT,
  recipient_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  send_after TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  cap_retries INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  resend_email_id TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meetup_slug) REFERENCES meetups(slug) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES email_templates(id) ON DELETE RESTRICT,
  FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE
);

INSERT INTO email_jobs_new (
  id, kind, meetup_slug, template_id, registration_id, recipient_name, recipient_email,
  subject, text_body, html_body, send_after, status, attempts, cap_retries, last_error,
  resend_email_id, sent_at, created_at, updated_at
)
SELECT
  id, 'confirmation', meetup_slug, template_id, registration_id, recipient_name, recipient_email,
  subject, text_body, html_body, send_after, status, attempts, cap_retries, last_error,
  resend_email_id, sent_at, created_at, updated_at
FROM email_jobs;

DROP TABLE email_jobs;
ALTER TABLE email_jobs_new RENAME TO email_jobs;

CREATE INDEX IF NOT EXISTS idx_email_jobs_status_send_after
ON email_jobs(status, send_after);

CREATE INDEX IF NOT EXISTS idx_email_jobs_registration_id
ON email_jobs(registration_id);

CREATE INDEX IF NOT EXISTS idx_email_jobs_certificate_code
ON email_jobs(certificate_code) WHERE certificate_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_sends_sent_at ON email_sends(sent_at);

INSERT INTO email_sends (kind, sent_at)
SELECT 'confirmation', sent_at FROM email_jobs
WHERE status = 'sent' AND sent_at IS NOT NULL AND date(sent_at) = date('now');
