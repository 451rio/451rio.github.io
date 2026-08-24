-- "nesta quinta-feira" dava a entender que o meetup era na mesma semana da
-- inscrição. Como as inscrições abrem meses antes, a frase chegava errada para
-- quase todo mundo. 03/09/2026 é de fato uma quinta — só o "nesta" sai.

UPDATE email_templates
SET
  text_body = REPLACE(text_body, 'acontecerá nesta quinta-feira', 'acontecerá quinta-feira'),
  html_body = REPLACE(html_body, 'acontecerá nesta quinta-feira', 'acontecerá quinta-feira'),
  updated_at = CURRENT_TIMESTAMP
WHERE meetup_slug = 'meetup-03-09-2026';

-- email_jobs congela o corpo no momento da inscrição (src/index.js) e o envio lê
-- dessa cópia, não do template. Sem isto, quem já se inscreveu continuaria
-- recebendo o texto antigo. Só o que ainda não saiu: reescrever job já enviado
-- falsificaria o registro do que a pessoa recebeu.
UPDATE email_jobs
SET
  text_body = REPLACE(text_body, 'acontecerá nesta quinta-feira', 'acontecerá quinta-feira'),
  html_body = REPLACE(html_body, 'acontecerá nesta quinta-feira', 'acontecerá quinta-feira'),
  updated_at = CURRENT_TIMESTAMP
WHERE meetup_slug = 'meetup-03-09-2026'
  AND status IN ('pending', 'failed');
