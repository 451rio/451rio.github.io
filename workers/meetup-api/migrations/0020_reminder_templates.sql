CREATE TABLE IF NOT EXISTS reminder_templates (
  meetup_slug TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meetup_slug) REFERENCES meetups(slug) ON DELETE CASCADE
);

INSERT OR IGNORE INTO reminder_templates (meetup_slug, subject, text_body, html_body)
VALUES (
  'meetup-03-09-2026',
  'Lembrete: nosso meetup é quinta-feira, 03/09',
  'Olá,

Passando para lembrar que o Meetup do Hack in Brasil está chegando e que sua inscrição está confirmada.

Data: quinta-feira, 03/09/2026
Horário: 18h50 às 21h50
Local: FIAP - Rua Marques de Olinda, 11 - Rio de Janeiro

Agenda
18:50 - Abertura
19:05 - Principais defesas contra ataques ciberfísicos em subestações elétricas
19:40 - Harvest now, decrypt later: migrando TLS para o mundo pós-quântico na prática
20:15 - Coffee break
20:30 - Quando o SRE vira agente: o que a IA autônoma em produção significa para quem defende infraestrutura
21:05 - Alertas demais, sinal de menos
21:40 - Encerramento e sorteios

Não vai conseguir ir?
As vagas são limitadas e a sua está reservada. Se você já sabe que não vai, cancele a inscrição para que outra pessoa da comunidade possa ocupar o lugar.

Para cancelar, acesse https://hackinbrasil.com.br/minhas-inscricoes/ e peça o link de acesso com o seu e-mail. Não tem senha: o link chega na sua caixa de entrada e abre a sua inscrição.

Se você vai, não precisa fazer nada. Nos vemos lá!

Abraços,
Equipe Hack in Brasil',
  '<p>Olá,</p><p>Passando para lembrar que o <strong>Meetup do Hack in Brasil</strong> está chegando e que sua inscrição está confirmada.</p><p><strong>Data:</strong> quinta-feira, 03/09/2026<br><strong>Horário:</strong> 18h50 às 21h50<br><strong>Local:</strong> FIAP - Rua Marques de Olinda, 11 - Rio de Janeiro</p><h3>Agenda</h3><ul><li>18:50 - Abertura</li><li>19:05 - Principais defesas contra ataques ciberfísicos em subestações elétricas</li><li>19:40 - Harvest now, decrypt later: migrando TLS para o mundo pós-quântico na prática</li><li>20:15 - Coffee break</li><li>20:30 - Quando o SRE vira agente: o que a IA autônoma em produção significa para quem defende infraestrutura</li><li>21:05 - Alertas demais, sinal de menos</li><li>21:40 - Encerramento e sorteios</li></ul><h3>Não vai conseguir ir?</h3><p>As vagas são limitadas e a sua está reservada. Se você já sabe que não vai, cancele a inscrição para que outra pessoa da comunidade possa ocupar o lugar.</p><p>Para cancelar, acesse <a href="https://hackinbrasil.com.br/minhas-inscricoes/">hackinbrasil.com.br/minhas-inscricoes</a> e peça o link de acesso com o seu e-mail. Não tem senha: o link chega na sua caixa de entrada e abre a sua inscrição.</p><p>Se você vai, não precisa fazer nada. Nos vemos lá!</p><p>Abraços,<br>Equipe Hack in Brasil</p>'
);
