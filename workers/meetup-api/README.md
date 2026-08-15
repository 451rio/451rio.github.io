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
- O PDF é gerado pelo navegador (impressão) a partir de `/certificado/?codigo=...`.
  Não há gerador de PDF no Worker.

## Ranking público (`0016`)

- `meetups.xp_reward` (padrão 100) define quanto vale participar de cada meetup.
- `participant_profiles` guarda apelido e o opt-in (`is_public`). O ranking devolve
  **apenas apelido e XP**.
- O XP é somado na hora da consulta, contando só meetups que já terminaram — inscrição em
  meetup futuro não pontua.
- Apelidos são únicos ignorando caixa e acento, e nomes que se passariam pela organização
  (`admin`, `organizador`, `hackinbrasil`, ...) são recusados.

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
```

`DOC_ENCRYPTION_KEY_BASE64` deve ser uma chave AES-256 em Base64 (32 bytes).
`RESEND_API_KEY` é a chave privada da API do Resend.

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

## E-mails de confirmação

- O e-mail é agendado no momento da inscrição para envio após 10 minutos.
- O envio ocorre via trigger de cron do Worker (`*/2 * * * *`).
- O conteúdo do e-mail é definido no banco em `email_templates`.
- Inscrições antigas são carregadas para envio na primeira aplicação da migração `0002`.
- Para editar próximas mensagens, atualize o registro em `email_templates`.
- O limite diário está fixo em 100 envios.
- Quando o envio falha, a próxima tentativa é reagendada para 10 minutos depois (até 5 tentativas).
