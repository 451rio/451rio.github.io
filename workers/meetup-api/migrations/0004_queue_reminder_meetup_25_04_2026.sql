-- Queue reminder email only for attendees registered in meetup-25-04-2026.
-- This does not affect registrations from other meetups.
-- Important: keep previous email job history untouched.
--
-- The original schema had UNIQUE(registration_id), allowing only one email job
-- per registration. For reminders, we need a second job row without rewriting
-- confirmation history, so we rebuild the table without that unique constraint.

DROP TABLE IF EXISTS email_jobs_new;

CREATE TABLE email_jobs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meetup_slug TEXT NOT NULL,
  template_id INTEGER NOT NULL,
  registration_id INTEGER NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  send_after TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
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
  id,
  meetup_slug,
  template_id,
  registration_id,
  recipient_name,
  recipient_email,
  subject,
  text_body,
  html_body,
  send_after,
  status,
  attempts,
  last_error,
  resend_email_id,
  sent_at,
  created_at,
  updated_at
)
SELECT
  id,
  meetup_slug,
  template_id,
  registration_id,
  recipient_name,
  recipient_email,
  subject,
  text_body,
  html_body,
  send_after,
  status,
  attempts,
  last_error,
  resend_email_id,
  sent_at,
  created_at,
  updated_at
FROM email_jobs;

DROP TABLE email_jobs;
ALTER TABLE email_jobs_new RENAME TO email_jobs;

CREATE INDEX IF NOT EXISTS idx_email_jobs_status_send_after
ON email_jobs(status, send_after);

CREATE INDEX IF NOT EXISTS idx_email_jobs_registration_id
ON email_jobs(registration_id);

INSERT INTO email_jobs (
  meetup_slug,
  template_id,
  registration_id,
  recipient_name,
  recipient_email,
  subject,
  text_body,
  html_body,
  send_after,
  status,
  attempts,
  created_at,
  updated_at
)
SELECT
  r.meetup_slug,
  t.id,
  r.id,
  r.name,
  r.email,
  'O meetup já é amanhã, contamos com sua presença!',
  'Olá,\n\nO meetup já é amanhã, contamos com sua presença!\n\nAgenda\n10:00 - Abertura\n10:15 - Enquanto o mundo debate a educação digital infantil, como você prepara os seus filhos?\n10:50 - Cibersegurança, HOJE você aprende\n11:40 - Coffee break\n12:00 - Letramento Digital: Desafios e proteção em um mundo conectado\n12:50 - Encerramento e sorteios\n\nHorário\n10h às 13h\n\nLocal\nColégio Niterói\nR. Vereador José Vicente Sobrinho, 269\nBarreto, Niterói - RJ\nCEP 24110-441\n\nRecado\nTeremos vendas de itens do Cibernauta (livros, canecas e camisas), além de distribuição de muitos brindes e vendas de camisas do Hack in Brasil.\n\nAté amanhã!\nEquipe Hack in Brasil',
  '<p>Olá,</p><p><strong>O meetup já é amanhã, contamos com sua presença!</strong></p><h3>Agenda</h3><ul><li>10:00 - Abertura</li><li>10:15 - Enquanto o mundo debate a educação digital infantil, como você prepara os seus filhos?</li><li>10:50 - Cibersegurança, HOJE você aprende</li><li>11:40 - Coffee break</li><li>12:00 - Letramento Digital: Desafios e proteção em um mundo conectado</li><li>12:50 - Encerramento e sorteios</li></ul><h3>Horário</h3><p>10h às 13h</p><h3>Local</h3><p>Colégio Niterói<br>R. Vereador José Vicente Sobrinho, 269<br>Barreto, Niterói - RJ<br>CEP 24110-441</p><h3>Recado</h3><p>Teremos vendas de itens do Cibernauta (livros, canecas e camisas), além de distribuição de muitos brindes e vendas de camisas do Hack in Brasil.</p><p>Até amanhã!<br>Equipe Hack in Brasil</p>',
  CURRENT_TIMESTAMP,
  'pending',
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM registrations r
JOIN email_templates t ON t.meetup_slug = r.meetup_slug
WHERE r.meetup_slug = 'meetup-25-04-2026'
  AND NOT EXISTS (
    SELECT 1
    FROM email_jobs j
    WHERE j.registration_id = r.id
      AND j.subject = 'O meetup já é amanhã, contamos com sua presença!'
  );
