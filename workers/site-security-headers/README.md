# Site Security Headers Worker (Cloudflare)

Worker de borda que faz proxy para o origin estático (GitHub Pages) e injeta headers HTTP de segurança.

## Por que existe

GitHub Pages não oferece configuração nativa de headers de resposta personalizados.  
Para fechar alertas de scanner (como ZAP), os headers são aplicados na borda da Cloudflare.

## Headers adicionados

- `Referrer-Policy`
- `Clear-Site-Data`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`
- `Content-Security-Policy`
- `Permissions-Policy`
- `X-Permitted-Cross-Domain-Policies`
- `Cross-Origin-Embedder-Policy`
- `X-Frame-Options`

## Setup

1. Instalar dependências:

```bash
cd workers/site-security-headers
npm install
```

2. Ajustar origin upstream em `wrangler.toml` (exemplo atual):

```toml
UPSTREAM_ORIGIN = "https://hackinbrasil.github.io"
```

3. Deploy:

```bash
npx wrangler deploy
```

4. As rotas do domínio são aplicadas pelo `wrangler.toml` no deploy:

- `hackinbrasil.com.br/*`
- `www.hackinbrasil.com.br/*`

## Observações operacionais

- O domínio precisa estar com proxy ativo na Cloudflare para o Worker interceptar tráfego.
- Qualquer ajuste de CSP deve ser validado após mudanças em fontes externas (novos iframes, CDNs, APIs).
