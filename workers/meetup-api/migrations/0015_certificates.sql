-- Certificados de participação.
--
-- A carga horária passa a ser um dado do meetup: ela é impressa no certificado,
-- e é o que define, junto com `event_date`, quando o certificado fica liberado
-- (24h depois do fim do evento). O padrão é 4 horas; ajuste por meetup com
-- `UPDATE meetups SET duration_minutes = ? WHERE slug = ?`.
ALTER TABLE meetups ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 240 CHECK (duration_minutes > 0);

-- Um certificado por inscrição. O código é o identificador público usado na
-- página de validação, então precisa ser imprevisível — quem tem o código vê o
-- nome de quem participou.
--
-- `participant_name` e `duration_minutes` são cópias do estado no momento da
-- emissão: reimprimir o mesmo certificado meses depois não pode devolver um
-- documento diferente do que a pessoa já tem em mãos.
CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  meetup_slug TEXT NOT NULL,
  registration_id INTEGER NOT NULL,
  participant_name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meetup_slug) REFERENCES meetups(slug) ON DELETE CASCADE,
  FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
  UNIQUE (meetup_slug, registration_id)
);

-- A listagem de inscrições faz LEFT JOIN por registration_id para saber se já
-- existe certificado emitido.
CREATE INDEX IF NOT EXISTS idx_certificates_registration_id
ON certificates(registration_id);
