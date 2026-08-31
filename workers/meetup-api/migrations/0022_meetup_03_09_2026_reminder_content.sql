UPDATE reminder_templates
SET
  text_body = 'Olá,

Passando para lembrar que o Meetup do Hack in Brasil está chegando e que sua inscrição está confirmada.

Data: quinta-feira, 03/09/2026
Horário: 18h50 às 21h50
Local: FIAP - Rua Marques de Olinda, 11 - Rio de Janeiro

Agenda
18:50 - Abertura
19:15 - Principais defesas contra ataques ciberfísicos em subestações elétricas
19:50 - Quando o SRE vira agente: o que a IA autônoma em produção significa para quem defende infraestrutura
20:25 - Coffee break
20:55 - Alertas demais, sinal de menos
21:30 - Encerramento e sorteios

Não vai conseguir ir?
As vagas são limitadas e a sua está reservada. Se você já sabe que não vai, cancele a inscrição para que outra pessoa da comunidade possa ocupar o lugar.

Para cancelar, acesse https://hackinbrasil.com.br/minhas-inscricoes/ e peça o link de acesso com o seu e-mail. Não tem senha: o link chega na sua caixa de entrada e abre a sua inscrição.

Estacionamento
O prédio da FIAP tem estacionamento próprio, mas é pago e fecha às 22h. Se for de carro, garanta que o veículo seja retirado até esse horário.

Somos convidados na FIAP
Vamos manter o espaço tão organizado e limpo quanto o encontramos: capriche no descarte do lixo e cuide bem do ambiente durante o evento.

Se você vai, não precisa fazer nada. Nos vemos lá!

Abraços,
Equipe Hack in Brasil',
  html_body = '<p>Olá,</p><p>Passando para lembrar que o <strong>Meetup do Hack in Brasil</strong> está chegando e que sua inscrição está confirmada.</p><p><strong>Data:</strong> quinta-feira, 03/09/2026<br><strong>Horário:</strong> 18h50 às 21h50<br><strong>Local:</strong> FIAP - Rua Marques de Olinda, 11 - Rio de Janeiro</p><h3>Agenda</h3><ul><li>18:50 - Abertura</li><li>19:15 - Principais defesas contra ataques ciberfísicos em subestações elétricas</li><li>19:50 - Quando o SRE vira agente: o que a IA autônoma em produção significa para quem defende infraestrutura</li><li>20:25 - Coffee break</li><li>20:55 - Alertas demais, sinal de menos</li><li>21:30 - Encerramento e sorteios</li></ul><h3>Não vai conseguir ir?</h3><p>As vagas são limitadas e a sua está reservada. Se você já sabe que não vai, cancele a inscrição para que outra pessoa da comunidade possa ocupar o lugar.</p><p>Para cancelar, acesse <a href="https://hackinbrasil.com.br/minhas-inscricoes/">hackinbrasil.com.br/minhas-inscricoes</a> e peça o link de acesso com o seu e-mail. Não tem senha: o link chega na sua caixa de entrada e abre a sua inscrição.</p><h3>Estacionamento</h3><p>O prédio da FIAP tem estacionamento próprio, mas é pago e fecha às 22h. Se for de carro, garanta que o veículo seja retirado até esse horário.</p><h3>Somos convidados na FIAP</h3><p>Vamos manter o espaço tão organizado e limpo quanto o encontramos: capriche no descarte do lixo e cuide bem do ambiente durante o evento.</p><p>Se você vai, não precisa fazer nada. Nos vemos lá!</p><p>Abraços,<br>Equipe Hack in Brasil</p>',
  updated_at = CURRENT_TIMESTAMP
WHERE meetup_slug = 'meetup-03-09-2026';

UPDATE email_jobs
SET
  text_body = (SELECT text_body FROM reminder_templates WHERE meetup_slug = 'meetup-03-09-2026'),
  html_body = (SELECT html_body FROM reminder_templates WHERE meetup_slug = 'meetup-03-09-2026'),
  updated_at = CURRENT_TIMESTAMP
WHERE meetup_slug = 'meetup-03-09-2026'
  AND kind = 'reminder'
  AND status IN ('pending', 'failed');
