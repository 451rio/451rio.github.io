# Hack in Brasil Website

Site institucional da comunidade **Hack in Brasil**, publicado com **GitHub Pages** usando **Jekyll**.

## Stack

- HTML + CSS + JavaScript
- Jekyll (via `github-pages` gem)
- GitHub Pages
- Dependabot (Bundler + GitHub Actions)

## Estrutura

- `index.html`: página principal
- `codigo-de-conduta.html`: código de conduta (`/codigo-de-conduta/`)
- `politica-de-privacidade.html`: política de privacidade (`/politica-de-privacidade/`)
- `_layouts/default.html`: layout base Jekyll
- `_config.yml`: configuração do Jekyll
- `assets/css/style.css`: estilos
- `assets/js/main.js`: scripts da página
- `assets/images/`: imagens
- `.github/dependabot.yml`: atualizações automáticas de dependências
- `.github/workflows/deploy-worker.yml`: deploy isolado do Cloudflare Worker
- `CNAME`: domínio customizado do GitHub Pages
- `workers/meetup-api/`: backend serverless para inscrições

## Rodando localmente

### Pré-requisitos

- Ruby 3.2.2
- Bundler (`gem install bundler`)

### Comandos

```bash
bundle config set --local path vendor/bundle
bundle install
bundle exec jekyll serve
```

Depois acesse:

- `http://127.0.0.1:4000/`

## Build local

```bash
bundle exec jekyll build
```

Saída gerada em `_site/`.

## Deploy

O deploy é feito automaticamente pelo GitHub Pages ao fazer push para a branch configurada no repositório.

## Dependabot

Configuração em `.github/dependabot.yml`:

- Atualização semanal de gems (`bundler`)
- Atualização semanal de workflows (`github-actions`)

## Inscrições de Meetup (Cloudflare Workers)

O site continua estático em Jekyll. As inscrições são processadas por API serverless separada.

- Código da API: `workers/meetup-api`
- Deploy separado via workflow: `.github/workflows/deploy-worker.yml`
- Frontend integrado em: `assets/js/meetup-registration.js`
- Página de meetup com formulário: `meetup-25-03-2026.html`

Configuração detalhada em `workers/meetup-api/README.md`.

Documentação operacional completa em `docs/meetup-subscriptions.md`.
Guia de segurança da aplicação em `docs/security.md`.

## Privacidade

- Política de privacidade: `politica-de-privacidade.html`
- Contato DPO: `dpo@hackinbrasil.com.br`
