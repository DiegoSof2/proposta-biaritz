# Biaritz — deploy no Cloudflare Worker

Painel admin (`/site/admin.html`) publica direto no GitHub via um Cloudflare Worker.
Login por Google OAuth; só e-mails da allowlist publicam. O Worker comita
`site/products.json` + fotos novas num único commit → o push dispara o auto-deploy.

## Arquitetura
```
Browser (admin.html)
   │  fetch /api/publish  (cookie de sessão assinado)
   ▼
Cloudflare Worker (worker/index.js)
   │  GitHub Git Data API (blobs→tree→commit→ref)  ← GITHUB_TOKEN
   ▼
GitHub repo (master)  ──push──►  Cloudflare auto-deploy
```
- Estático servido pelo binding `ASSETS` (raiz do repo).
- `/auth/*` e `/api/*` são interceptados pelo Worker (não são arquivos).

## 1. Google OAuth
1. console.cloud.google.com → APIs & Services → Credentials.
2. Criar **OAuth client ID** tipo *Web application*.
3. Authorized redirect URI: `https://<SEU-WORKER>/auth/callback`
   (ex: `https://biaritz.<conta>.workers.dev/auth/callback` ou domínio custom).
4. Copiar **Client ID** → `wrangler.toml` (`GOOGLE_CLIENT_ID`).
5. Copiar **Client secret** → secret (passo 3).
6. OAuth consent screen: publicar ou adicionar os e-mails como *test users*.

## 2. GitHub token
- Fine-grained PAT, só no repo `DiegoSof2/proposta-biaritz`,
  permissão **Contents: Read and write**.

## 3. Secrets do Worker
```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put COOKIE_SECRET        # ex: openssl rand -hex 32
```

## 4. Vars (já em wrangler.toml — editar se preciso)
`GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GOOGLE_CLIENT_ID`, `ALLOWED_EMAILS`
(lista separada por vírgula).

## 5. Deploy
```bash
npx wrangler deploy
```
Ou conectar o repo em Workers Builds (deploy a cada push no master).

## Uso
1. Abrir `https://<worker>/site/admin.html`.
2. "Entrar p/ publicar" → Google → volta logado.
3. Editar; clicar **Publicar no site**.
4. Worker comita; deploy em ~1–2 min. Botões "Baixar" seguem como fallback.

## Notas Cloudflare (gotchas tratados)
- Limite de asset 25 MiB: `.assetsignore` exclui `OneDrive_*`, `*.xls`, etc.
- Cookie de sessão assinado com HMAC-SHA256 (Web Crypto), HttpOnly+Secure+SameSite=Lax.
- base64 de fotos em pedaços (evita estouro de pilha no browser e no Worker).
- GitHub API exige header `User-Agent` (setado: `biaritz-admin`).
- id_token do Google decodificado direto (veio por TLS do endpoint de token).
