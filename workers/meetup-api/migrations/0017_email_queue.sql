-- Uma fila só, e uma contagem que corresponde à realidade.
--
-- Problema 1: `email_jobs` só aceitava e-mail de confirmação. `registration_id`
-- era NOT NULL UNIQUE (a inscrição gasta a vaga dela no e-mail de confirmação) e
-- `template_id` era obrigatório, então o certificado não tinha como entrar na
-- fila e acabava enviado direto, furando o limite diário.
--
-- Problema 2: o limite de 100/dia era medido contando linhas 'sent' em
-- `email_jobs`. Todo envio direto — magic link, cancelamento, patrocínio,
-- palestra — saía sem ser contado, mas gastava a cota real do Resend. A conta
-- do Worker dizia 40 enquanto o provedor já tinha visto 100.
--
-- SQLite não altera constraint no lugar: a tabela é reconstruída.

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

-- Sem índice único aqui. O `UNIQUE` de `registration_id` do 0002 já tinha sido
-- removido no 0004, de propósito: os lembretes ("já é amanhã", "é hoje") são
-- jobs adicionais da mesma inscrição. Em produção são 193 inscrições com mais
-- de uma linha, então qualquer unicidade por inscrição faria esta migração
-- falhar na criação do índice — depois de a tabela já ter sido reconstruída.
--
-- O índice comum por inscrição precisa voltar: o cancelamento apaga a fila com
-- `WHERE registration_id = ?`, e ele se perde junto com a tabela antiga.
CREATE INDEX IF NOT EXISTS idx_email_jobs_registration_id
ON email_jobs(registration_id);

-- Usado na checagem de job em aberto antes de enfileirar um certificado.
CREATE INDEX IF NOT EXISTS idx_email_jobs_certificate_code
ON email_jobs(certificate_code) WHERE certificate_code IS NOT NULL;

-- Livro-caixa de tudo que saiu de fato, inclusive os envios imediatos. É daqui
-- que o limite diário passa a ser lido — não guarda destinatário nem assunto,
-- só o tipo e a hora.
CREATE TABLE IF NOT EXISTS email_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_sends_sent_at ON email_sends(sent_at);

-- O que já foi enviado hoje pela fila entra no livro, senão o limite reiniciaria
-- do zero no dia em que esta migração rodar.
INSERT INTO email_sends (kind, sent_at)
SELECT 'confirmation', sent_at FROM email_jobs
WHERE status = 'sent' AND sent_at IS NOT NULL AND date(sent_at) = date('now');
