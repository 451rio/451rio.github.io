# Meetup API Worker (Cloudflare)

API serverless para inscrições de meetup, com limite de vagas rígido (sem lista de espera).
Também agenda e envia e-mails de confirmação com atraso de 10 minutos.

## Endpoints

- `GET /api/captcha` — emite um desafio de verificação (id + pergunta)
- `GET /api/meetups/:slug/status`
- `POST /api/meetups/:slug/register`
- `POST /api/sponsors` — solicitações de patrocínio (substitui o formulário do Airtable)
- `POST /api/talks` — propostas de palestra / Call for Papers (substitui o formulário do Airtable)
- `POST /api/auth/magic-link` — envia o link de acesso sem senha
- `POST /api/auth/session` — troca o link por uma sessão bearer
- `POST /api/auth/logout` — revoga a sessão
- `GET /api/me/registrations` — inscrições, perfil do ranking e estado do certificado
- `POST /api/me/registrations/:slug/cancel` — cancela a inscrição
- `POST /api/me/registrations/:slug/certificate` — emite o certificado de participação
- `GET /api/certificates/:code` — consulta pública de um certificado
- `POST /api/me/profile` — apelido e visibilidade no ranking
- `GET /api/ranking` — ranking público (apelido + XP)
- `GET /api/admin/meetups` — lista de meetups para o painel de sorteio (restrito)
- `GET /api/admin/meetups/:slug/duck-race` — participantes elegíveis e ganhadores da corrida de patos (restrito)
- `POST /api/admin/meetups/:slug/duck-race/draw` — sorteia um vencedor entre quem já fez check-in (restrito)
- `POST /api/admin/meetups/:slug/duck-race/reset` — apaga os ganhadores registrados de um meetup, liberando todo mundo para concorrer de novo (restrito)

## Verificação (captcha) validada no servidor

- `GET /api/captcha` gera uma operação aritmética, guarda a resposta na tabela
  `captcha_challenges` (migração `0011`) e retorna apenas `{ id, question }` — a
  resposta correta nunca é enviada ao cliente.
- Cada envio (`register`/`sponsors`/`talks`) precisa incluir `captchaId` + `captcha`
  (a resposta digitada). O backend valida com `consumeCaptcha`, que consome o desafio
  de forma atômica: cada desafio permite **uma única tentativa** (acerto, erro,
  expiração ou reuso), impedindo replay e força bruta sobre o pequeno espaço de respostas.
- Desafios expirados são removidos pelo cron do Worker.
- Limitação: a conta aritmética ainda é resolvível por um bot que leia a pergunta.
  Recomenda-se somar **rate limiting** (regra da Cloudflare ou contador por IP) para
  proteção real contra flood. O captcha aqui elimina o bypass trivial (`captcha: 1`).

## Solicitações de patrocínio (`POST /api/sponsors`)

- Campos: `company`, `website`, `contactName`, `role`, `email`, `phone`, `message`, `captchaId`, `captcha`.
- Armazenados em texto puro na tabela `sponsor_requests` (dados de contato comercial, não CPF).
- Cada envio dispara imediatamente um e-mail via Resend para `SPONSOR_NOTIFY_EMAIL`
  (padrão `contato@hackinbrasil.com.br`), com `reply_to` apontando para o e-mail da empresa.
- Frontend: página nativa `quero-patrocinar.html` (`/quero-patrocinar/`) + `assets/js/sponsor-registration.js`.
- Migração da tabela: `migrations/0009_sponsor_requests.sql`.

## Propostas de palestra (`POST /api/talks`)

- Campos: `title`, `abstract`, `speakerName`, `email`, `phone` (opcional), `photoUrl`,
  `bio`, `inPerson` (`sim`/`nao`), `imageConsent`, `termsAck`, `captchaId`, `captcha`.
- Armazenados em texto puro na tabela `talk_proposals`.
- Cada envio dispara imediatamente um e-mail via Resend para `TALK_NOTIFY_EMAIL`
  (padrão `contato@hackinbrasil.com.br`), com `reply_to` apontando para o e-mail da pessoa palestrante.
- `photoUrl` aceita apenas URLs `http`/`https`; consentimento de imagem e ciência das orientações são obrigatórios.
- Frontend: página nativa `submeter-palestra.html` (`/submeter-palestra/`) + `assets/js/talk-submission.js`.
- Migração da tabela: `migrations/0010_talk_proposals.sql`.

## Certificado de participação (`0015`)

- `meetups.duration_minutes` (padrão 240) define a carga horária impressa e o fim do evento.
- O certificado só é emitido **24 horas após o fim** do meetup; antes disso a API responde
  `409` com `availableAt`.
- Cada emissão grava uma linha em `certificates` com um código público
  (`HIB-XXXX-XXXX-XXXX`, ~60 bits). Emitir de novo devolve o mesmo código.
- `participant_name` e `duration_minutes` são congelados na emissão: reimprimir não pode
  gerar um documento diferente do que a pessoa já tem.
- O PDF é montado no próprio Worker (`src/pdf.js`) e enviado como anexo pelo Resend, a
  pedido, para o e-mail da inscrição. Reenviar devolve o mesmo documento.
- `GET /api/certificates/:code` é público e **não devolve o nome** — só edição, carga
  horária e data de emissão, o suficiente para conferir um documento que já se tem em mãos.
- `src/certificate-assets.js` é gerado (assinaturas, selo e métricas das fontes); como
  regerar está em `docs/meetup-subscriptions.md`.

## Ranking público (`0016`)

- `meetups.xp_reward` (padrão 100) define quanto vale participar de cada meetup.
- `participant_profiles` guarda apelido e o opt-in (`is_public`). O ranking devolve
  **apenas apelido e XP**.
- O XP é somado na hora da consulta, contando só meetups que já terminaram — inscrição em
  meetup futuro não pontua.
- Apelidos são únicos ignorando caixa e acento, e nomes que se passariam pela organização
  (`admin`, `organizador`, `hackinbrasil`, ...) são recusados.

## Corrida de patos (sorteio, `0024`)

- Área restrita em `/sorteio/` (`sorteio.html` + `assets/js/sorteio.js`), com o mesmo login
  sem senha da área de conta — a sessão do bearer token é compartilhada entre
  `/minhas-inscricoes/` e `/sorteio/` na mesma aba.
- O organizador escolhe o meetup num dropdown; a lista de "patos" elegíveis é sempre quem
  já fez check-in **naquele** meetup e ainda não ganhou uma corrida anterior da mesma edição.
- Cada sorteio grava uma linha em `raffle_winners` (`meetup_slug`, `registration_id`, `name`,
  `won_at`); um índice único em `(meetup_slug, registration_id)` garante que ninguém ganha
  duas vezes na mesma edição, mesmo reabrindo a página ou usando outro dispositivo.
- `POST /api/admin/meetups/:slug/duck-race/draw` decide o vencedor no servidor (sorteio
  sem viés por rejection sampling, o mesmo princípio já usado no código do certificado) e
  só depois grava o resultado — a animação no navegador é só encenação: os outros patos
  recebem tempos de chegada sorteados, mas sempre mais lentos que o do vencedor.
- Cada pessoa tem um pato com aparência fixa (cor, fantasia e variante de idade), derivada
  por hash do `registration.id` — a mesma pessoa mantém o mesmo pato em corridas seguintes
  do evento. O nome exibido inclui o `#id` porque duas pessoas com check-in podem ter o
  mesmo nome.
- `POST /api/admin/meetups/:slug/duck-race/reset` apaga todas as linhas de `raffle_winners`
  daquele meetup — existe para poder testar o sorteio várias vezes antes do evento (ou
  reabrir a disputa se for preciso). Exige digitar `RESETAR` no modal de confirmação; não
  tem como desfazer.

## Dados coletados

- `name`
- `email`
- `document` (armazenado criptografado)
- `consentLgpd`

## Regras de lotação

- Sem waitlist.
- Ao atingir `capacity`, novas inscrições retornam erro e o frontend desabilita o botão.

## Setup

1. Criar D1 e atualizar `database_id` em `wrangler.toml`.
   Configure também `ALLOWED_ORIGIN` com os domínios permitidos (separados por vírgula), por exemplo:

```toml
ALLOWED_ORIGIN = "https://hackinbrasil.com.br,https://www.hackinbrasil.com.br"
```

2. Instalar dependências:

```bash
cd workers/meetup-api
npm install
```

3. Aplicar migração:

```bash
npx wrangler d1 migrations apply meetup_db --remote
```

4. Definir secret:

```bash
npx wrangler secret put DOC_ENCRYPTION_KEY_BASE64
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ADMIN_EMAILS
```

`DOC_ENCRYPTION_KEY_BASE64` deve ser uma chave AES-256 em Base64 (32 bytes).
`RESEND_API_KEY` é a chave privada da API do Resend.
`ADMIN_EMAILS` é a lista de e-mails com acesso às ferramentas da organização (check-in dentro
de `/minhas-inscricoes/` e o sorteio em `/sorteio/`), separados por
vírgula caso haja mais de um. Fica como secret (e não em `[vars]`) porque este repositório é
público — nunca vai para o `wrangler.toml`.

5. Deploy:

```bash
npx wrangler deploy
```

## Integração com Jekyll

No formulário da página do meetup, ajustar:

- `data-api-base="https://SEU-WORKER-DOMAIN"`
- `data-meetup-slug="meetup-25-03-2026"`

Arquivo integrado: `assets/js/meetup-registration.js`.

Comportamento de UX atual:

- Exibe apenas status de disponibilidade: "Inscrições abertas" ou "Inscrições encerradas"
- Não exibe quantidade de vagas
- Feedback de sucesso/erro em modal com botão de fechar (X)

## Segurança / LGPD

- Documento criptografado no banco.
- Consentimento obrigatório (`consentLgpd=true`).
- CPF validado no frontend e no backend (estrutura + dígitos verificadores).
- Recomenda-se adicionar captcha e política de retenção dos dados.

## Lembretes automáticos

Valem para **toda** edição, sem cadastro manual. Quem enfileira é o cron
(`queueDueReminders`), não uma migração — por isso alcança também quem se
inscreve depois que a janela já abriu.

- A janela abre `REMINDER_LEAD_DAYS` (5) dias antes do evento, às
  `REMINDER_SEND_HOUR_UTC` (12:00 UTC = 09:00 em São Paulo).
- São até 5 levas, uma por dia, do quinto dia antes até a véspera. Cada tick do
  cron distribui os pendentes em rodízio pelas levas ainda disponíveis.
- Dividir não é enfeite: a capacidade de uma edição chega perto do teto de 100
  e-mails/dia, que é compartilhado com confirmação, magic link e cancelamento.
  Mandando tudo de uma vez, a sobra cai no `deferJobsOverDailyCap`, que desiste
  após 3 reagendamentos e marca o job como `failed` — gente sem lembrete e sem
  aviso.
- "Agora" é sempre a primeira leva. Quem se inscreve faltando dois dias pega as
  levas que restam; quem se inscreve no dia recebe na hora.
- Um lembrete por inscrição, garantido por índice único parcial
  (`idx_email_jobs_one_reminder_per_registration`). Dois ticks sobrepostos não
  duplicam.
- Quem cancela some sozinho: o cancelamento apaga a inscrição e o job vai junto
  por `ON DELETE CASCADE`.

### Texto do lembrete

- Por padrão o Worker monta o corpo a partir de `meetups` (título, data, hora) e
  aponta para a página da edição no site, que tem endereço e agenda. É o que faz
  um meetup novo já nascer com lembrete.
- Para personalizar (agenda no corpo, endereço, recados da edição), insira uma
  linha em `reminder_templates` com o `meetup_slug`. Existindo, ela vence.
- Migrações: `0019` (abre `email_jobs.kind` para `reminder` + índice único) e
  `0020` (tabela `reminder_templates`, já com o texto do meetup de 03/09/2026).

## E-mails de confirmação

- O e-mail é agendado no momento da inscrição para envio após 10 minutos.
- O envio ocorre via trigger de cron do Worker (`*/2 * * * *`).
- O conteúdo do e-mail é definido no banco em `email_templates`.
- Inscrições antigas são carregadas para envio na primeira aplicação da migração `0002`.
- Para editar próximas mensagens, atualize o registro em `email_templates`.
- O limite diário está fixo em 100 envios, contados na tabela `email_sends` — que registra
  **todo** e-mail que sai, inclusive os imediatos (magic link, cancelamento, patrocínio,
  palestra). Antes a conta olhava só a fila e ignorava esses, estourando a cota do Resend
  sem perceber.
- O que não couber no dia é reagendado para o dia seguinte às 11:00 UTC (08:00 em São Paulo),
  até 3 vezes.
- Quando o envio falha por outro motivo, a próxima tentativa é reagendada para 10 minutos
  depois (até 5 tentativas).
- O certificado entra nessa mesma fila (`kind = 'certificate'`); o PDF é remontado na hora
  do envio a partir do código, então a fila não guarda anexo.
