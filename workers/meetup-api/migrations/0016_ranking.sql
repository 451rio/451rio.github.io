-- Ranking público da comunidade.
--
-- Cada meetup vale XP, e o XP só entra na conta depois que o evento termina —
-- inscrição em meetup futuro não pontua. Ajuste por meetup com
-- `UPDATE meetups SET xp_reward = ? WHERE slug = ?`.
ALTER TABLE meetups ADD COLUMN xp_reward INTEGER NOT NULL DEFAULT 100 CHECK (xp_reward >= 0);

-- O ranking é opt-in e mostra apenas apelido e XP. O e-mail fica aqui porque é
-- a chave que liga o perfil às inscrições, mas nunca sai em nenhuma resposta
-- pública: é justamente por isso que existe um apelido.
--
-- `nickname_key` é o apelido sem acento e em minúsculas: dois apelidos que só
-- diferem em caixa ou acento são o mesmo apelido para quem lê o ranking, e
-- deixá-los coexistir seria um convite a se passar por outra pessoa.
CREATE TABLE IF NOT EXISTS participant_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  nickname_key TEXT NOT NULL UNIQUE,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A listagem pública filtra por is_public antes de somar o XP de cada perfil.
CREATE INDEX IF NOT EXISTS idx_participant_profiles_is_public
ON participant_profiles(is_public);
