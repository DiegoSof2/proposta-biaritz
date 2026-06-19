/* Biaritz — Cloudflare Worker.
   Serve o site estático (binding ASSETS) e expõe:
     GET  /auth/login     -> inicia Google OAuth
     GET  /auth/callback  -> troca code, valida e-mail, seta cookie de sessão
     GET  /auth/me        -> { email } se logado, senão 401
     POST /auth/logout    -> limpa cookie
     POST /api/publish    -> comita products.json + fotos no GitHub (1 commit atômico)

   Cloudflare-specific:
   - Static assets servidos ANTES do Worker p/ paths que casam arquivo;
     /auth/* e /api/* não são arquivos, então caem aqui. (assets.binding=ASSETS)
   - Web Crypto (crypto.subtle) p/ assinar cookie — disponível no runtime.
   - Sem dependências: fetch nativo, btoa/atob nativos.

   Secrets (wrangler secret put): GITHUB_TOKEN, GOOGLE_CLIENT_SECRET, COOKIE_SECRET
   Vars (wrangler.toml): GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH,
                         GOOGLE_CLIENT_ID, ALLOWED_EMAILS
*/

const SESSION_COOKIE = "biaritz_session";
const STATE_COOKIE = "biaritz_oauth_state";
const SESSION_TTL = 12 * 60 * 60; // 12h em segundos
const ADMIN_PATH = "/admin.html";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === "/auth/login") return authLogin(request, env, url);
      if (pathname === "/auth/callback") return authCallback(request, env, url);
      if (pathname === "/auth/me") return authMe(request, env);
      if (pathname === "/auth/logout") return authLogout();
      if (pathname === "/api/publish") return apiPublish(request, env);

      // página admin trancada: sem sessão válida -> manda pro login Google.
      if (pathname === "/admin" || pathname === "/admin.html") {
        const sess = await verificaSessao(request, env);
        if (!sess) return Response.redirect(`${url.origin}/auth/login`, 302);
      }
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }

    // não é rota da API: deixa os assets estáticos responderem.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};

/* ---------------- auth ---------------- */
function authLogin(request, env, url) {
  const redirectUri = `${url.origin}/auth/callback`;
  const state = randomHex(16);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  const headers = new Headers({ Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  headers.append("Set-Cookie", cookie(STATE_COOKIE, state, { maxAge: 600 }));
  return new Response(null, { status: 302, headers });
}

async function authCallback(request, env, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(request.headers.get("Cookie"));
  if (!code || !state || state !== cookies[STATE_COOKIE]) {
    return new Response("Estado OAuth inválido. Tente entrar de novo.", { status: 400 });
  }

  const redirectUri = `${url.origin}/auth/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return new Response("Falha ao trocar código com o Google.", { status: 502 });
  }
  const tok = await tokenRes.json();
  const claims = decodeJwt(tok.id_token);
  const email = (claims.email || "").toLowerCase();

  if (!claims.email_verified || !emailPermitido(email, env)) {
    return new Response(`Acesso negado para ${email || "(sem e-mail)"}.`, { status: 403 });
  }

  const session = await makeSession(email, env.COOKIE_SECRET);
  const headers = new Headers({ Location: ADMIN_PATH });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, session, { maxAge: SESSION_TTL }));
  headers.append("Set-Cookie", cookie(STATE_COOKIE, "", { maxAge: 0 }));
  return new Response(null, { status: 302, headers });
}

async function authMe(request, env) {
  const sess = await verificaSessao(request, env);
  if (!sess) return json({ error: "não autenticado" }, 401);
  return json({ email: sess.email });
}

function authLogout() {
  const headers = new Headers();
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", { maxAge: 0 }));
  return json({ ok: true }, 200, headers);
}

function emailPermitido(email, env) {
  const lista = (env.ALLOWED_EMAILS || "").toLowerCase().split(/[,\s]+/).filter(Boolean);
  return lista.includes(email);
}

/* ---------------- publish ---------------- */
async function apiPublish(request, env) {
  if (request.method !== "POST") return json({ error: "use POST" }, 405);
  const sess = await verificaSessao(request, env);
  if (!sess) return json({ error: "não autenticado" }, 401);

  const body = await request.json();
  const produtos = body.products;
  const fotos = Array.isArray(body.fotos) ? body.fotos : [];
  if (!Array.isArray(produtos)) return json({ error: "products ausente" }, 400);

  const owner = env.GITHUB_OWNER, repo = env.GITHUB_REPO, branch = env.GITHUB_BRANCH || "master";
  const gh = (path, init) => fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "biaritz-admin",
      "Content-Type": "application/json",
      ...(init && init.headers),
    },
  });
  const ghJson = async (res, ctx) => {
    if (!res.ok) throw new Error(`GitHub ${ctx} ${res.status}: ${await res.text()}`);
    return res.json();
  };

  // 1. ref atual do branch
  const ref = await ghJson(await gh(`/git/ref/heads/${branch}`), "ref");
  const baseSha = ref.object.sha;
  // 2. commit base -> tree base
  const baseCommit = await ghJson(await gh(`/git/commits/${baseSha}`), "commit");
  const baseTree = baseCommit.tree.sha;

  // 3. blobs: products.json (utf-8) + fotos (já base64 do browser)
  const treeItems = [];
  const jsonStr = JSON.stringify(produtos, null, 2);
  const jsonBlob = await ghJson(await gh("/git/blobs", {
    method: "POST",
    body: JSON.stringify({ content: bytesToBase64(new TextEncoder().encode(jsonStr)), encoding: "base64" }),
  }), "blob json");
  treeItems.push({ path: "site/products.json", mode: "100644", type: "blob", sha: jsonBlob.sha });

  for (const f of fotos) {
    if (!f || !f.path || !f.base64) continue;
    const path = f.path.startsWith("site/") ? f.path : `site/${f.path.replace(/^\/+/, "")}`;
    const blob = await ghJson(await gh("/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content: f.base64, encoding: "base64" }),
    }), "blob foto");
    treeItems.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }

  // 4. nova tree
  const tree = await ghJson(await gh("/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree: treeItems }),
  }), "tree");

  // 5. commit
  const nFotos = treeItems.length - 1;
  const msg = `Painel: atualiza catálogo (${produtos.length} produtos${nFotos ? `, +${nFotos} foto(s)` : ""}) [${sess.email}]`;
  const commit = await ghJson(await gh("/git/commits", {
    method: "POST",
    body: JSON.stringify({ message: msg, tree: tree.sha, parents: [baseSha] }),
  }), "commit novo");

  // 6. move o ref
  await ghJson(await gh(`/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  }), "patch ref");

  return json({ ok: true, commit: commit.sha, fotos: nFotos });
}

/* ---------------- sessão (cookie assinado HMAC) ---------------- */
async function makeSession(email, secret) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  })));
  const sig = await hmac(payload, secret);
  return `${payload}.${sig}`;
}
async function verificaSessao(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const raw = cookies[SESSION_COOKIE];
  if (!raw || !raw.includes(".")) return null;
  const [payload, sig] = raw.split(".");
  const esperado = await hmac(payload, env.COOKIE_SECRET);
  if (!timingSafeEqual(sig, esperado)) return null;
  let data;
  try { data = JSON.parse(new TextDecoder().decode(fromBase64url(payload))); }
  catch { return null; }
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
  if (!emailPermitido((data.email || "").toLowerCase(), env)) return null;
  return data;
}

/* ---------------- helpers crypto/encoding ---------------- */
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64url(new Uint8Array(sig));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function decodeJwt(token) {
  const part = token.split(".")[1];
  return JSON.parse(new TextDecoder().decode(fromBase64url(part)));
}
// base64 padrão (p/ GitHub blobs) a partir de bytes, em pedaços (evita stack overflow)
function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function base64url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64url(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function randomHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* ---------------- helpers http ---------------- */
function json(obj, status = 200, headers = new Headers()) {
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(obj), { status, headers });
}
function cookie(name, value, { maxAge }) {
  let c = `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
