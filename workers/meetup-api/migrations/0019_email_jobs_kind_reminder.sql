-- Abre `email_jobs.kind` para lembretes de meetup.
--
-- `kind` só aceitava 'confirmation' e 'certificate'. Um lembrete não é nenhum
-- dos dois, e `email_sends` grava esse mesmo rótulo no livro-caixa que mede o
-- limite diário — vale distinguir. SQLite não altera CHECK no lugar; a tabela é
-- reconstruída, como já foi feito em 0004 e 0017.
--
-- Quem enfileira os lembretes é o cron do Worker (`queueDueReminders`), não uma
-- migração: eles precisam alcançar também quem se inscreve depois, em todos os
-- meetups. Esta migração só abre espaço no schema.

DROP TABLE IF EXISTS email_jobs_new;

CREATE TABLE email_jobs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'confirmation' CHECK (kind IN ('confirmation', 'certificate', 'reminder')),
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
  id, kind, meetup_slug, template_id, registration_id, certificate_code,
  recipient_name, recipient_email, subject, text_body, html_body, send_after,
  status, attempts, cap_retries, last_error, resend_email_id, sent_at,
  created_at, updated_at
)
SELECT
  id, kind, meetup_slug, template_id, registration_id, certificate_code,
  recipient_name, recipient_email, subject, text_body, html_body, send_after,
  status, attempts, cap_retries, last_error, resend_email_id, sent_at,
  created_at, updated_at
FROM email_jobs;

DROP TABLE email_jobs;
ALTER TABLE email_jobs_new RENAME TO email_jobs;

CREATE INDEX IF NOT EXISTS idx_email_jobs_status_send_after
ON email_jobs(status, send_after);

-- Usado pelo cancelamento (DELETE ... WHERE registration_id = ?) e pela busca de
-- quem ainda não tem lembrete na fila. É também o que impede o lembrete de
-- sair para quem desistiu.
CREATE INDEX IF NOT EXISTS idx_email_jobs_registration_id
ON email_jobs(registration_id);

CREATE INDEX IF NOT EXISTS idx_email_jobs_certificate_code
ON email_jobs(certificate_code) WHERE certificate_code IS NOT NULL;

-- No máximo um lembrete por inscrição. O cron enfileira em lote a cada 2
-- minutos; sem isto, dois ticks sobrepostos poderiam mandar o mesmo lembrete
-- duas vezes para a mesma pessoa. Parcial de propósito: único em
-- `registration_id` inteiro não serve, já que a mesma inscrição tem confirmação
-- e lembrete — foi por isso que 0017 não recriou o índice único de 0002.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_jobs_one_reminder_per_registration
ON email_jobs(registration_id) WHERE kind = 'reminder';
