/* Biaritz — painel admin v1. Vanilla, sem deps.
   Edita products.json em memória e baixa (JSON + fotos novas). Commit é manual. */

/* ---------- constantes (espelham app.js / otimizar-fotos.py) ---------- */
const SINGULAR = {
  "Flats e Papetes": "Flat", "Sandálias de Salto": "Sandália de Salto",
  "Rasteiras": "Rasteira", "Botas": "Bota", "Tamancos": "Tamanco",
  "Scarpins": "Scarpin", "Sapatilhas": "Sapatilha", "Chinelos": "Chinelo",
  "Birkens": "Birken", "Anabela": "Anabela", "Mary Jane": "Mary Jane",
  "Tênis": "Tênis", "Mocassim": "Mocassim",
};
const catSingular = (p) => SINGULAR[p.categoria] || p.categoria;
const tituloProduto = (p) => p.nome || `${catSingular(p)} ${p.cor}`;

const MOTIVOS = [
  "sem foto", "foto horizontal", "cor não confere com a foto",
  "baixa resolução", "foto borrada", "fundo bagunçado",
];

// listas pros comboboxes (cliente pode digitar fora delas)
const MATERIAIS = ["Couro legítimo", "Couro", "Sintético", "Camurça", "Verniz",
  "Nobuck", "Napa", "Tecido", "Tricot/Knit", "Matelassê"];
const SALTOS = ["Sem salto", "Salto baixo", "Bloco", "Fino", "Taça", "Kitten",
  "Carretel", "Plataforma", "Anabela"];

// quadro 4:5 igual otimizar-fotos.py
const TARGET_W = 864, TARGET_H = 1080, FILL = 0.94, WEBP_Q = 0.82;

/* ---------- estado ---------- */
let PRODUTOS = [];
let selId = null;
let filtro = "todos";
let busca = "";
let dirty = 0;                      // edições feitas
let modoSelecao = false;            // seleção em lote ligada
const selecao = new Set();          // ids selecionados p/ lote
const fotosNovas = new Map();       // "fotos/x.webp" -> Blob webp pendente de download
const blobURL = new Map();          // "fotos/x.webp" -> objectURL p/ preview antes do commit
const srcDe = (nome) => blobURL.get(nome) || nome;
const DRAFT_KEY = "biaritz_admin_draft_v1";

// limites de campo (anti-absurdo)
const LIM = { nome: 60, cor: 30, estacao: 24, material: 40, saltoTipo: 24, saltoAltura: 16 };
const PRECO_MAX = 9999;

/* ---------- elementos ---------- */
const $ = (id) => document.getElementById(id);
const elList = $("list");
const elEditor = $("editor");
const elFilters = $("filters");
const elSearch = $("search");
const elDirty = $("dirty");
const elDirtyCount = $("dirtyCount");
const elFotoCount = $("fotoCount");
const elBtnFotos = $("btnFotos");
const elBtnJson = $("btnJson");

/* ---------- init ---------- */
(async function init() {
  PRODUTOS = await fetch("products.json").then((r) => r.json());
  PRODUTOS.forEach(normaliza);
  renderFiltros();
  renderLista();
  renderProgresso();
  if (temRascunho()) $("restore").hidden = false;

  elSearch.addEventListener("input", () => { busca = elSearch.value.trim().toLowerCase(); renderLista(); });
  elBtnJson.addEventListener("click", baixarJson);
  elBtnFotos.addEventListener("click", baixarFotos);
  $("btnPublicar").addEventListener("click", publicar);
  $("btnZip").addEventListener("click", baixarZip);
  checaLogin();
  $("btnNovo").addEventListener("click", novoProduto);
  $("btnSelecao").addEventListener("click", toggleSelecao);
  $("bulkAplicar").addEventListener("click", aplicaLote);
  $("bulkLimpar").addEventListener("click", () => { selecao.clear(); renderLista(); atualizaBulk(); });
  $("btnRestaurar").addEventListener("click", restauraRascunho);
  $("btnDescartar").addEventListener("click", () => { localStorage.removeItem(DRAFT_KEY); $("restore").hidden = true; });

  document.addEventListener("keydown", atalhos);
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
})();

/* ---------- helpers de estado ---------- */
const PLACEHOLDER = "fotos/_placeholder.webp";
const MAX_FOTOS = 4;
// completa campos que podem faltar no JSON antigo
function normaliza(p) {
  if (!Array.isArray(p.fotos)) {
    p.fotos = p.foto && p.foto !== PLACEHOLDER ? [p.foto] : [];
  }
  if (p.ativo === undefined) p.ativo = true;
  if (p.revisado === undefined) p.revisado = false;   // bookkeeping do painel (não vai pro público)
  if (!Array.isArray(p.motivosFoto)) p.motivosFoto = [];
  if (!p.ficha) p.ficha = { material: "", saltoTipo: "", saltoAltura: "" };
  sincronizaFoto(p);
}
// mantém p.foto (capa p/ catálogo) e flag de foto coerentes com p.fotos
function sincronizaFoto(p) {
  p.foto = p.fotos[0] || PLACEHOLDER;
  if (p.fotos.length) {
    p.motivosFoto = p.motivosFoto.filter((m) => m !== "sem foto");
    p.flagFoto = p.motivosFoto.length > 0;
  } else {
    if (!p.motivosFoto.includes("sem foto")) p.motivosFoto.push("sem foto");
    p.flagFoto = true;
  }
}
// próximo nome de arquivo livre p/ uma foto nova do produto
function nomeFotoLivre(p) {
  for (let i = 0; i < MAX_FOTOS; i++) {
    const nome = i === 0 ? `fotos/${p.id}.webp` : `fotos/${p.id}-${i + 1}.webp`;
    if (!p.fotos.includes(nome)) return nome;
  }
  return `fotos/${p.id}-${Date.now()}.webp`;
}
const semFoto = (p) => (p.motivosFoto || []).includes("sem foto");
let _saveT;
function marcaDirty() {
  dirty++; elDirtyCount.textContent = dirty; elDirty.hidden = false;
  clearTimeout(_saveT);
  _saveT = setTimeout(salvaRascunho, 600);   // autosave debounced no localStorage
}
function atualizaFotoBtn() {
  elFotoCount.textContent = fotosNovas.size;
  elBtnFotos.disabled = fotosNovas.size === 0;
}

/* ---------- filtros ---------- */
function contagem() {
  return {
    todos: PRODUTOS.length,
    pendentes: PRODUTOS.filter((p) => !p.revisado).length,
    revisados: PRODUTOS.filter((p) => p.revisado).length,
    foto: PRODUTOS.filter((p) => p.flagFoto).length,
    desc: PRODUTOS.filter((p) => p.flagDescricao).length,
    semfoto: PRODUTOS.filter(semFoto).length,
  };
}
function renderFiltros() {
  const c = contagem();
  const defs = [
    ["todos", "Todos", c.todos], ["pendentes", "Pendentes", c.pendentes],
    ["revisados", "Revisados", c.revisados], ["foto", "Foto a revisar", c.foto],
    ["desc", "Descrição a revisar", c.desc], ["semfoto", "Sem foto", c.semfoto],
  ];
  elFilters.innerHTML = defs.map(([k, lbl, n]) =>
    `<button class="adm-chip ${filtro === k ? "on" : ""}" data-f="${k}">${lbl} <b>${n}</b></button>`
  ).join("");
  elFilters.querySelectorAll(".adm-chip").forEach((b) =>
    b.addEventListener("click", () => { filtro = b.dataset.f; renderFiltros(); renderLista(); }));
}

/* ---------- lista ---------- */
function listaFiltrada() {
  let arr = PRODUTOS.filter((p) => {
    if (filtro === "foto" && !p.flagFoto) return false;
    if (filtro === "desc" && !p.flagDescricao) return false;
    if (filtro === "semfoto" && !semFoto(p)) return false;
    if (filtro === "pendentes" && p.revisado) return false;
    if (filtro === "revisados" && !p.revisado) return false;
    if (busca) {
      const hay = `${p.ref} ${p.cor} ${p.categoria} ${tituloProduto(p)}`.toLowerCase();
      if (!hay.includes(busca)) return false;
    }
    return true;
  });
  // flagados primeiro (foto+desc no topo), depois categoria/ref
  const score = (p) => (p.flagFoto ? 2 : 0) + (p.flagDescricao ? 1 : 0);
  return arr.sort((a, b) => score(b) - score(a) ||
    a.categoria.localeCompare(b.categoria) || a.ref.localeCompare(b.ref));
}
function renderLista() {
  const arr = listaFiltrada();
  elList.innerHTML = arr.map((p) => `
    <div class="adm-row ${p.id === selId ? "sel" : ""} ${p.ativo === false ? "off" : ""} ${selecao.has(p.id) ? "picked" : ""}" data-id="${p.id}" role="button" tabindex="0">
      ${modoSelecao ? `<input type="checkbox" class="rw-pick" ${selecao.has(p.id) ? "checked" : ""}>` : ""}
      <img src="${srcDe(p.foto)}" alt="" loading="lazy">
      <div class="rw-main">
        <div class="rw-nome">${tituloProduto(p)}</div>
        <div class="rw-sub">${p.categoria} · ref ${p.ref} · ${brl(p.precoMax)}</div>
      </div>
      <div class="rw-flags">
        ${p.revisado ? '<span class="flagdot okdot">ok</span>' : ""}
        ${p.ativo === false ? '<span class="flagdot offdot">off</span>' : ""}
        ${p.flagFoto ? '<span class="flagdot foto">foto</span>' : ""}
        ${p.flagDescricao ? '<span class="flagdot desc">desc</span>' : ""}
      </div>
    </div>`).join("") || `<div class="adm-empty">Nenhum produto neste filtro.</div>`;
  elList.querySelectorAll(".adm-row").forEach((b) => {
    const id = b.dataset.id;
    b.addEventListener("click", () => {
      if (modoSelecao) { toggleItem(id); return; }
      selId = id; renderLista(); renderEditor();
    });
  });
}
function toggleItem(id) {
  selecao.has(id) ? selecao.delete(id) : selecao.add(id);
  renderLista(); atualizaBulk();
}
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/* ---------- editor ---------- */
function renderEditor() {
  const p = PRODUTOS.find((x) => x.id === selId);
  if (!p) { elEditor.innerHTML = '<div class="adm-empty">Selecione um produto.</div>'; return; }
  const cats = [...new Set(PRODUTOS.map((x) => x.categoria))].sort();
  const cores = [...new Set(PRODUTOS.map((x) => x.cor).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const ficha = p.ficha || (p.ficha = { material: "", saltoTipo: "", saltoAltura: "" });
  const opts = (arr) => arr.map((v) => `<option value="${esc(v)}">`).join("");

  elEditor.innerHTML = `
    <div class="ed-head">
      <div class="ed-fotos" id="edFotos">${slotsHTML(p)}</div>
      <div class="ed-meta">
        <h2 id="edTitulo">${tituloProduto(p)}</h2>
        <div class="ed-ref">ref ${p.ref} · id ${p.id}</div>
        <label class="chk ed-ativo"><input type="checkbox" id="f_ativo" ${p.ativo !== false ? "checked" : ""}> Produto ativo (aparece no catálogo)</label>
        <label class="chk ed-ativo"><input type="checkbox" id="f_revisado" ${p.revisado ? "checked" : ""}> Revisado</label>
        <div class="ed-meta-btns">
          <button class="adm-btn ghost sm" id="btnDuplicar" type="button">Duplicar</button>
          <button class="adm-btn ghost sm danger" id="btnExcluir" type="button">Excluir</button>
        </div>
      </div>
    </div>
    <div class="ed-grid">
      <div class="ed-field full">
        <label>Nome do produto</label>
        <input type="text" id="f_nome" value="${esc(p.nome)}" placeholder="${catSingular(p)} ${esc(p.cor)}" maxlength="${LIM.nome}">
      </div>
      <div class="ed-field">
        <label>Categoria</label>
        <select id="f_categoria">${cats.map((c) => `<option ${c === p.categoria ? "selected" : ""}>${c}</option>`).join("")}</select>
      </div>
      <div class="ed-field">
        <label>Preço (R$)</label>
        <input type="number" step="0.01" min="0" max="${PRECO_MAX}" id="f_preco" value="${p.precoMax}">
      </div>
      <div class="ed-field">
        <label>Cor</label>
        <div class="ed-cor-wrap">
          <input type="text" id="f_cor" value="${esc(p.cor)}" list="dl_cores" maxlength="${LIM.cor}">
          <input type="color" id="f_corHex" value="${corHex(p.corHex)}">
        </div>
      </div>
      <div class="ed-field">
        <label>Estação</label>
        <input type="text" id="f_estacao" value="${esc(p.estacao)}" placeholder="Verão 2026" maxlength="${LIM.estacao}">
      </div>
      <div class="ed-field">
        <label>Material</label>
        <input type="text" id="f_material" value="${esc(ficha.material)}" list="dl_materiais" maxlength="${LIM.material}">
      </div>
      <div class="ed-field">
        <label>Tipo de salto</label>
        <input type="text" id="f_saltoTipo" value="${esc(ficha.saltoTipo)}" list="dl_saltos" maxlength="${LIM.saltoTipo}">
      </div>
      <div class="ed-field">
        <label>Altura do salto</label>
        <input type="text" id="f_saltoAltura" value="${esc(ficha.saltoAltura)}" placeholder="ex: 7 cm" maxlength="${LIM.saltoAltura}">
      </div>

      <div class="ed-flags">
        <h3>Revisão</h3>
        <label class="chk"><input type="checkbox" id="f_flagDesc" ${p.flagDescricao ? "checked" : ""}> Descrição a revisar</label>
        <label class="chk" style="margin-top:10px"><input type="checkbox" id="f_flagFoto" ${p.flagFoto ? "checked" : ""}> Foto a revisar</label>
        <div class="ed-motivos ${p.flagFoto ? "" : "off"}" id="edMotivos">
          ${MOTIVOS.map((m, i) => `<label class="chk"><input type="checkbox" data-motivo="${i}" ${(p.motivosFoto || []).includes(m) ? "checked" : ""}> ${m}</label>`).join("")}
        </div>
      </div>
    </div>
    <datalist id="dl_cores">${opts(cores)}</datalist>
    <datalist id="dl_materiais">${opts(MATERIAIS)}</datalist>
    <datalist id="dl_saltos">${opts(SALTOS)}</datalist>`;

  wireEditor(p);
}

function wireEditor(p) {
  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  const bind = (id, set) => on(id, "input", (e) => { set(e.target.value); marcaDirty(); });

  bind("f_nome", (v) => { p.nome = v.trim(); document.getElementById("edTitulo").textContent = tituloProduto(p); refreshRow(p); });
  bind("f_categoria", (v) => { p.categoria = v; refreshRow(p); });
  bind("f_preco", (v) => { const n = parseFloat(v) || 0; p.precoMax = n; p.precoMin = n; refreshRow(p); });
  on("f_preco", "blur", (e) => {   // clamp anti-absurdo ao sair do campo
    let n = Math.min(PRECO_MAX, Math.max(0, parseFloat(e.target.value) || 0));
    n = Math.round(n * 100) / 100;
    e.target.value = n; p.precoMax = n; p.precoMin = n; refreshRow(p);
  });
  bind("f_cor", (v) => { p.cor = v; if (!p.nome) document.getElementById("edTitulo").textContent = tituloProduto(p); refreshRow(p); });
  bind("f_corHex", (v) => { p.corHex = v; });
  bind("f_estacao", (v) => { p.estacao = v; });
  bind("f_material", (v) => { p.ficha.material = v; });
  bind("f_saltoTipo", (v) => { p.ficha.saltoTipo = v; });
  bind("f_saltoAltura", (v) => { p.ficha.saltoAltura = v; });

  on("f_flagDesc", "change", (e) => { p.flagDescricao = e.target.checked; marcaDirty(); refreshRow(p); renderFiltros(); });
  on("f_flagFoto", "change", (e) => {
    p.flagFoto = e.target.checked;
    document.getElementById("edMotivos").classList.toggle("off", !p.flagFoto);
    if (!p.flagFoto) { p.motivosFoto = []; document.querySelectorAll("#edMotivos input").forEach((c) => (c.checked = false)); }
    marcaDirty(); refreshRow(p); renderFiltros();
  });
  document.querySelectorAll("#edMotivos input[data-motivo]").forEach((c) =>
    c.addEventListener("change", () => {
      const sel = [...document.querySelectorAll("#edMotivos input[data-motivo]:checked")].map((x) => MOTIVOS[+x.dataset.motivo]);
      p.motivosFoto = sel;
      marcaDirty(); renderFiltros();
    }));

  on("f_ativo", "change", (e) => { p.ativo = e.target.checked; marcaDirty(); renderLista(); });
  on("f_revisado", "change", (e) => { p.revisado = e.target.checked; marcaDirty(); renderLista(); renderFiltros(); renderProgresso(); });
  on("btnDuplicar", "click", () => duplicaProduto(p));
  on("btnExcluir", "click", () => excluiProduto(p));

  wireFotos(p);
}

/* ---------- slots de foto ---------- */
function slotsHTML(p) {
  let s = "";
  for (let i = 0; i < MAX_FOTOS; i++) {
    const f = p.fotos[i];
    if (f) {
      s += `<div class="ed-slot filled">
        <img src="${srcDe(f)}" class="slot-img" data-full="${srcDe(f)}" alt="">
        ${i === 0 ? '<span class="slot-cap">capa</span>'
          : `<button class="slot-cap-btn" type="button" data-cap="${i}" title="Tornar capa">tornar capa</button>`}
        <button class="slot-x" type="button" data-rm="${i}" title="Remover foto">×</button>
      </div>`;
    } else {
      s += `<label class="ed-slot add">
        <input type="file" accept="image/*" hidden class="slot-add">
        <span>+ foto</span></label>`;
    }
  }
  return s;
}
function rerenderSlots(p) {
  document.getElementById("edFotos").innerHTML = slotsHTML(p);
  wireFotos(p);
}
function wireFotos(p) {
  const box = document.getElementById("edFotos");
  box.querySelectorAll(".slot-add").forEach((inp) =>
    inp.addEventListener("change", (e) => { if (e.target.files[0]) adicionaFoto(p, e.target.files[0]); }));
  box.querySelectorAll(".slot-img").forEach((img) =>
    img.addEventListener("click", () => abreLightbox(img.dataset.full)));
  box.querySelectorAll(".slot-x").forEach((btn) =>
    btn.addEventListener("click", () => removeFoto(p, +btn.dataset.rm)));
  box.querySelectorAll(".slot-cap-btn").forEach((btn) =>
    btn.addEventListener("click", () => tornaCapa(p, +btn.dataset.cap)));
  // drag-drop em qualquer slot vazio
  box.querySelectorAll(".ed-slot.add").forEach((slot) => {
    ["dragenter", "dragover"].forEach((ev) => slot.addEventListener(ev, (e) => { e.preventDefault(); slot.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => slot.addEventListener(ev, (e) => { e.preventDefault(); slot.classList.remove("drag"); }));
    slot.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f && f.type.startsWith("image/")) adicionaFoto(p, f); });
  });
}
function removeFoto(p, i) {
  const nome = p.fotos[i];
  if (nome) fotosNovas.delete(nome);
  p.fotos.splice(i, 1);
  sincronizaFoto(p);
  atualizaFotoBtn(); rerenderSlots(p); marcaDirty(); refreshRow(p); renderFiltros();
}

function refreshRow(p) {
  const row = elList.querySelector(`.adm-row[data-id="${p.id}"]`);
  if (!row) return;
  row.classList.toggle("off", p.ativo === false);
  row.querySelector("img").src = srcDe(p.foto);
  row.querySelector(".rw-nome").textContent = tituloProduto(p);
  row.querySelector(".rw-sub").textContent = `${p.categoria} · ref ${p.ref} · ${brl(p.precoMax)}`;
  row.querySelector(".rw-flags").innerHTML =
    (p.revisado ? '<span class="flagdot okdot">ok</span>' : "") +
    (p.ativo === false ? '<span class="flagdot offdot">off</span>' : "") +
    (p.flagFoto ? '<span class="flagdot foto">foto</span>' : "") +
    (p.flagDescricao ? '<span class="flagdot desc">desc</span>' : "");
}

/* ---------- adicionar foto (canvas 4:5, espelha otimizar-fotos.py) ---------- */
async function adicionaFoto(p, file) {
  if (p.fotos.length >= MAX_FOTOS) { alert(`Máximo de ${MAX_FOTOS} fotos por produto.`); return; }
  const img = await carregaImg(file);
  const scale = FILL * Math.min(TARGET_W / img.width, TARGET_H / img.height);
  const nw = Math.max(1, Math.round(img.width * scale));
  const nh = Math.max(1, Math.round(img.height * scale));
  const cv = document.createElement("canvas");
  cv.width = TARGET_W; cv.height = TARGET_H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, TARGET_W, TARGET_H);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (TARGET_W - nw) >> 1, (TARGET_H - nh) >> 1, nw, nh);
  const blob = await new Promise((res) => cv.toBlob(res, "image/webp", WEBP_Q));

  const nome = nomeFotoLivre(p);
  fotosNovas.set(nome, blob);
  blobURL.set(nome, URL.createObjectURL(blob));   // preview p/ slot/lightbox
  p.fotos.push(nome);
  sincronizaFoto(p);
  atualizaFotoBtn();

  // limpa selo de foto a revisar (tem foto nova)
  const fc = document.getElementById("f_flagFoto");
  if (fc) { fc.checked = false; document.getElementById("edMotivos").classList.add("off"); }
  rerenderSlots(p); marcaDirty(); refreshRow(p); renderFiltros();
}
function carregaImg(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- exportar ---------- */
function jsonPublico() {
  // revisado é controle do painel — não vai pro catálogo público
  return PRODUTOS.map(({ revisado, ...rest }) => rest);
}
function valida() {
  const out = [];
  const semRef = PRODUTOS.filter((p) => !p.ref).length;
  const semPreco = PRODUTOS.filter((p) => !(p.precoMax > 0)).length;
  const semFotoAtivo = PRODUTOS.filter((p) => p.ativo !== false && !p.fotos.length).length;
  const precoAlto = PRODUTOS.filter((p) => p.precoMax > PRECO_MAX).length;
  if (semRef) out.push(`• ${semRef} sem referência`);
  if (semPreco) out.push(`• ${semPreco} sem preço (R$ 0)`);
  if (semFotoAtivo) out.push(`• ${semFotoAtivo} produto(s) ativo(s) sem foto`);
  if (precoAlto) out.push(`• ${precoAlto} com preço acima de R$ ${PRECO_MAX}`);
  return out;
}
function confirmaPublicar() {
  const probs = valida();
  if (!probs.length) return true;
  return confirm("Atenção antes de publicar:\n\n" + probs.join("\n") + "\n\nBaixar mesmo assim?");
}
function zeraDirty() { dirty = 0; elDirtyCount.textContent = 0; elDirty.hidden = true; }
function baixarJson() {
  if (!confirmaPublicar()) return;
  const blob = new Blob([JSON.stringify(jsonPublico(), null, 2)], { type: "application/json" });
  baixar(blob, "products.json");
  zeraDirty();
}
function baixarFotos() {
  let i = 0;
  for (const [caminho, blob] of fotosNovas) {
    const nome = caminho.split("/").pop();   // "fotos/x-2.webp" -> "x-2.webp"
    setTimeout(() => baixar(blob, nome), i * 250); // espaça p/ navegador não bloquear
    i++;
  }
}

/* ---------- publicar via Worker (Cloudflare -> commit GitHub) ---------- */
// estado de login; quando rodando estático (file:// ou sem worker) fica null
let usuario = null;
async function checaLogin() {
  const el = $("auth");
  try {
    const r = await fetch("/auth/me", { headers: { Accept: "application/json" } });
    if (r.ok) {
      usuario = (await r.json()).email;
      el.innerHTML = `<span class="auth-on">● ${usuario}</span> · <a href="/auth/logout" id="lnkSair" class="lnk">sair</a>`;
      $("lnkSair").addEventListener("click", async (e) => { e.preventDefault(); await fetch("/auth/logout", { method: "POST" }); location.reload(); });
      $("btnPublicar").hidden = false;
    } else {
      usuario = null;
      el.innerHTML = `<a href="/auth/login" class="lnk">Entrar p/ publicar</a>`;
      $("btnPublicar").hidden = true;
    }
  } catch {
    // sem worker (modo estático/local): só download manual
    usuario = null;
    el.textContent = "";
    $("btnPublicar").hidden = true;
  }
}

async function publicar() {
  if (!confirmaPublicar()) return;
  const btn = $("btnPublicar");
  btn.disabled = true; const txt = btn.textContent; btn.textContent = "Publicando…";
  try {
    const fotos = [];
    for (const [caminho, blob] of fotosNovas) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      fotos.push({ path: caminho, base64: bytesToBase64(buf) });
    }
    const r = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products: jsonPublico(), fotos }),
    });
    if (r.status === 401) { alert("Sessão expirada. Faça login de novo."); location.href = "/auth/login"; return; }
    if (!r.ok) { alert("Erro ao publicar:\n" + await r.text()); return; }
    const j = await r.json();
    // limpa fotos pendentes (já estão no commit)
    for (const u of blobURL.values()) URL.revokeObjectURL(u);
    fotosNovas.clear(); blobURL.clear(); atualizaFotoBtn();
    zeraDirty();
    if (selId) renderEditor();
    alert(`Tudo certo! Suas alterações foram salvas${j.fotos ? ` (${j.fotos} foto${j.fotos > 1 ? "s" : ""})` : ""}.\nO site é atualizado em 1 a 2 minutos.`);
  } catch (e) {
    alert("Falha ao publicar: " + (e && e.message || e));
  } finally {
    btn.disabled = false; btn.textContent = txt;
  }
}

// bytes -> base64 (em pedaços, evita estouro de pilha em fotos grandes)
function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/* ---------- lightbox ---------- */
function abreLightbox(src) {
  let lb = document.getElementById("lightbox");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "lightbox"; lb.className = "lightbox";
    lb.innerHTML = '<img alt=""><button class="lb-x" type="button" aria-label="Fechar">×</button>';
    document.body.appendChild(lb);
    lb.addEventListener("click", (e) => { if (e.target === lb || e.target.classList.contains("lb-x")) fechaLightbox(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") fechaLightbox(); });
  }
  lb.querySelector("img").src = src;
  lb.classList.add("on");
}
function fechaLightbox() { const lb = document.getElementById("lightbox"); if (lb) lb.classList.remove("on"); }
function baixar(blob, nome) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- capa ---------- */
function tornaCapa(p, i) {
  if (i <= 0 || i >= p.fotos.length) return;
  const [f] = p.fotos.splice(i, 1);
  p.fotos.unshift(f);
  sincronizaFoto(p);
  rerenderSlots(p); marcaDirty(); refreshRow(p);
}

/* ---------- CRUD produto ---------- */
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
function idUnico(base) {
  base = base || "novo"; let id = base, n = 2;
  while (PRODUTOS.some((p) => p.id === id)) id = `${base}-${n++}`;
  return id;
}
function produtoVazio(id, cat) {
  return {
    id, ref: "", cor: "", nome: "", categoria: cat,
    precoMin: 0, precoMax: 0, corHex: null, estacao: "",
    arquivo: "", foto: PLACEHOLDER, fotos: [],
    flagFoto: true, motivosFoto: ["sem foto"], flagDescricao: true,
    ativo: true, revisado: false,
    ficha: { material: "", saltoTipo: "", saltoAltura: "" },
  };
}
function novoProduto() {
  const cat = [...new Set(PRODUTOS.map((x) => x.categoria))].sort()[0] || "Rasteiras";
  const p = produtoVazio(idUnico(`novo-${Date.now().toString(36)}`), cat);
  PRODUTOS.unshift(p);
  selId = p.id; filtro = "todos"; busca = ""; elSearch.value = "";
  renderFiltros(); renderLista(); renderEditor(); renderProgresso(); marcaDirty();
}
function duplicaProduto(orig) {
  const p = JSON.parse(JSON.stringify(orig));
  p.id = idUnico(`${slug(orig.ref) || "item"}-${slug(orig.cor) || "copia"}`);
  p.revisado = false; p.fotos = []; p.foto = PLACEHOLDER;
  p.flagFoto = true; p.motivosFoto = ["sem foto"];
  PRODUTOS.unshift(p);
  selId = p.id;
  renderFiltros(); renderLista(); renderEditor(); renderProgresso(); marcaDirty();
}
function excluiProduto(p) {
  if (!confirm(`Excluir "${tituloProduto(p)}"? Só dá pra desfazer não baixando o JSON.`)) return;
  const i = PRODUTOS.indexOf(p);
  if (i >= 0) PRODUTOS.splice(i, 1);
  selId = null; selecao.delete(p.id);
  elEditor.innerHTML = '<div class="adm-empty">Selecione um produto.</div>';
  renderFiltros(); renderLista(); renderProgresso(); marcaDirty();
}

/* ---------- seleção em lote ---------- */
function toggleSelecao() {
  modoSelecao = !modoSelecao;
  $("btnSelecao").classList.toggle("on", modoSelecao);
  $("bulk").hidden = !modoSelecao;
  if (!modoSelecao) selecao.clear();
  renderLista(); atualizaBulk();
}
function atualizaBulk() { $("bulkCount").textContent = selecao.size; }
function aplicaLote() {
  const campo = $("bulkCampo").value;
  const valor = $("bulkValor").value.trim();
  if (!campo) { alert("Escolha um campo."); return; }
  if (!selecao.size) { alert("Nenhum produto selecionado."); return; }
  const alvos = PRODUTOS.filter((p) => selecao.has(p.id));
  alvos.forEach((p) => {
    if (campo === "material") p.ficha.material = valor.slice(0, LIM.material);
    else if (campo === "saltoTipo") p.ficha.saltoTipo = valor.slice(0, LIM.saltoTipo);
    else if (campo === "estacao") p.estacao = valor.slice(0, LIM.estacao);
    else if (campo === "categoria") p.categoria = valor;
    else if (campo === "ativo") p.ativo = /^(sim|s|true|1|ativo)$/i.test(valor);
  });
  marcaDirty(); renderFiltros(); renderLista();
  if (selId) renderEditor();
  alert(`Aplicado em ${alvos.length} produto(s).`);
}

/* ---------- progresso ---------- */
function renderProgresso() {
  const tot = PRODUTOS.length;
  const ok = PRODUTOS.filter((p) => p.revisado).length;
  const pct = tot ? Math.round((ok / tot) * 100) : 0;
  $("progBar").style.width = pct + "%";
  $("progTxt").textContent = `${ok} de ${tot} revisados (${pct}%)`;
}

/* ---------- rascunho (localStorage; não guarda blobs de foto) ---------- */
function salvaRascunho() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ t: Date.now(), produtos: PRODUTOS })); }
  catch (e) { /* quota cheia: ignora */ }
}
function temRascunho() { return !!localStorage.getItem(DRAFT_KEY); }
function restauraRascunho() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (d && Array.isArray(d.produtos)) {
      PRODUTOS = d.produtos; PRODUTOS.forEach(normaliza);
      selId = null; selecao.clear();
      elEditor.innerHTML = '<div class="adm-empty">Rascunho restaurado. (Fotos novas não ficam no rascunho — re-suba se precisar.)</div>';
      renderFiltros(); renderLista(); renderProgresso();
      $("restore").hidden = true;
    }
  } catch (e) { alert("Rascunho corrompido."); }
}

/* ---------- atalhos de teclado ---------- */
function atalhos(e) {
  const noCampo = e.target.matches && e.target.matches("input,select,textarea");
  if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { e.preventDefault(); baixarJson(); return; }
  if (noCampo) return;
  if (e.key === "ArrowDown") { e.preventDefault(); navega(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); navega(-1); }
}
function navega(d) {
  const arr = listaFiltrada();
  if (!arr.length) return;
  let i = arr.findIndex((p) => p.id === selId);
  i = i < 0 ? 0 : Math.min(arr.length - 1, Math.max(0, i + d));
  selId = arr[i].id; renderLista(); renderEditor();
  const row = elList.querySelector(".adm-row.sel"); if (row) row.scrollIntoView({ block: "nearest" });
}

/* ---------- baixar tudo (.zip store, sem libs) ---------- */
async function baixarZip() {
  if (!confirmaPublicar()) return;
  const enc = new TextEncoder();
  const arquivos = [{ nome: "products.json", data: enc.encode(JSON.stringify(jsonPublico(), null, 2)) }];
  for (const [caminho, blob] of fotosNovas) {
    arquivos.push({ nome: "fotos/" + caminho.split("/").pop(), data: new Uint8Array(await blob.arrayBuffer()) });
  }
  baixar(new Blob([montaZip(arquivos)], { type: "application/zip" }), "biaritz-publicar.zip");
  zeraDirty();
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function montaZip(arquivos) {
  const enc = new TextEncoder();
  const locals = [], centrals = []; let offset = 0;
  for (const f of arquivos) {
    const nm = enc.encode(f.nome), crc = crc32(f.data), size = f.data.length;
    const local = new Uint8Array(30 + nm.length + size), dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, size, true); dv.setUint32(22, size, true);
    dv.setUint16(26, nm.length, true);
    local.set(nm, 30); local.set(f.data, 30 + nm.length);
    locals.push(local);
    const central = new Uint8Array(46 + nm.length), dc = new DataView(central.buffer);
    dc.setUint32(0, 0x02014b50, true); dc.setUint16(4, 20, true); dc.setUint16(6, 20, true);
    dc.setUint32(16, crc, true); dc.setUint32(20, size, true); dc.setUint32(24, size, true);
    dc.setUint16(28, nm.length, true); dc.setUint32(42, offset, true);
    central.set(nm, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22), de = new DataView(end.buffer);
  de.setUint32(0, 0x06054b50, true);
  de.setUint16(8, arquivos.length, true); de.setUint16(10, arquivos.length, true);
  de.setUint32(12, centralSize, true); de.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22); let pos = 0;
  for (const l of locals) { out.set(l, pos); pos += l.length; }
  for (const c of centrals) { out.set(c, pos); pos += c.length; }
  out.set(end, pos);
  return out;
}

/* ---------- util ---------- */
function esc(s) { return String(s ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
function corHex(h) { return /^#[0-9a-f]{6}$/i.test(h || "") ? h : "#C4AE97"; }
