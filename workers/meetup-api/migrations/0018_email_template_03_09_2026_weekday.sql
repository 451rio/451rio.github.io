UPDATE email_templates
SET
  text_body = REPLACE(text_body, 'acontecerá nesta quinta-feira', 'acontecerá quinta-feira'),
  html_body = REPLACE(html_body, 'acontecerá nesta quinta-feira', 'acontecerá quinta-feira'),
  updated_at = CURRENT_TIMESTAMP
WHERE meetup_slug = 'meetup-03-09-2026';

UPDATE email_jobs
SET
  text_body = REPLACE(text_body, 'acontecerá nesta quinta-feira', 'acontecerá quinta-feira'),
  html_body = REPLACE(html_body, 'acontecerá nesta quinta-feira', 'acontecerá quinta-feira'),
  updated_at = CURRENT_TIMESTAMP
WHERE meetup_slug = 'meetup-03-09-2026'
  AND status IN ('pending', 'failed');
