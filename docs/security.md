# Segurança da Aplicação

Este documento descreve como o projeto mantém segurança contínua no ciclo de desenvolvimento e operação.

## Objetivo

Adotar uma abordagem em camadas para reduzir riscos de vulnerabilidades em código, dependências, infraestrutura e dados.

## Controles Ativos

### 1. Dependabot (SCA)

- O Dependabot monitora dependências e abre PRs automáticos para atualização.
- Foco: identificar e corrigir versões com CVEs conhecidos.
- Configuração: `.github/dependabot.yml`.

### 2. ZAP (DAST)

- O OWASP ZAP Baseline é executado por workflow para testes dinâmicos de segurança contra a aplicação publicada.
- Foco: detectar problemas de segurança observáveis em runtime (headers, exposição de rotas, comportamento HTTP etc.).
- Configuração: `.github/workflows/zap.yml`.

### 3. CodeQL (SAST)

- O CodeQL analisa o código-fonte em busca de padrões inseguros e vulnerabilidades.
- Foco: encontrar riscos estruturais antes de produção (injeções, uso inseguro de APIs, fluxos perigosos).
- Recomendação: manter workflow ativo para JavaScript/TypeScript e linguagens usadas no repositório.

### 4. GitHub Secret Scanning

- O Secret Scanning do GitHub ajuda a detectar segredos expostos em commits e histórico.
- Foco: prevenção de vazamento de tokens/chaves.
- Prática adicional: segredos operacionais ficam em providers (`GitHub Secrets`, `Cloudflare Secrets`) e não no código.

### 5. Revisão de Código com apoio de LLM

- Revisões assistidas por LLM são usadas para aumentar cobertura de análise (bugs, riscos de segurança, regressões).
- Foco: reforço de revisão humana, não substituição.
- Regra: mudanças sensíveis devem ter validação humana final.

### 6. Cloudflare WAF

- O WAF da Cloudflare protege a aplicação com regras gerenciadas e mitigação de tráfego malicioso.
- Foco: reduzir ataques comuns na borda (bots maliciosos, payloads suspeitos, padrões abusivos).
- Recomendação: manter regras gerenciadas e monitoramento de eventos em modo contínuo.

### 7. Criptografia de dados armazenados

- Dados sensíveis de inscrição (CPF) são armazenados criptografados no backend serverless.
- Implementação atual: AES-GCM com chave em secret (`DOC_ENCRYPTION_KEY_BASE64`) no Cloudflare Workers.
- Foco: reduzir impacto em caso de acesso indevido ao banco.

## Medidas Complementares Recomendadas

- Rate limiting e CAPTCHA (ex.: Turnstile) no endpoint de inscrição.
- Política formal de retenção e descarte de dados (LGPD).
- Revisão periódica de permissões de tokens e secrets.
- Rotação de credenciais e chaves criptográficas.

## Resumo

A segurança do projeto é tratada com defesa em profundidade:

- Segurança de dependências (`Dependabot`)
- Segurança estática de código (`CodeQL`)
- Segurança dinâmica em produção (`ZAP`)
- Proteção de segredos (`Secret Scanning`)
- Revisão humana potencializada por IA (`LLM assisted review`)
- Proteção de borda (`Cloudflare WAF`)
- Proteção de dados em repouso (criptografia)
