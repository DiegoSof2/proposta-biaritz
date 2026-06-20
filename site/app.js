/* Biaritz — protótipo catálogo. Vanilla JS, sem build. */

// Vendedores (cada um com seu WhatsApp). Trocar pelos números reais.
const VENDEDORES = {
  raiane:  { nome: "Consultora Raiane", fone: "5511982105654" },
  matteus: { nome: "Consultor Matteus", fone: "5511982105654" },
};
const VEND_KEY = "biaritz_vendedor";

// Vendedor ativo: ?v= na URL (grava) ou o já gravado. null = mostra os 2 botões.
function vendedorAtivo() {
  const v = new URLSearchParams(location.search).get("v");
  if (v && VENDEDORES[v]) { localStorage.setItem(VEND_KEY, v); return v; }
  const saved = localStorage.getItem(VEND_KEY);
  return saved && VENDEDORES[saved] ? saved : null;
}

const GRADES = {
  baixa:    { nome: "Grade Baixa",    pares: 6,  subtitulo: "Numerações menores",
    numeracoes: [{n:34,pares:1},{n:35,pares:1},{n:36,pares:2},{n:37,pares:1},{n:38,pares:1}] },
  alta:     { nome: "Grade Alta",     pares: 6,  subtitulo: "Numerações maiores",
    numeracoes: [{n:35,pares:1},{n:36,pares:1},{n:37,pares:2},{n:38,pares:1},{n:39,pares:1}] },
  completa: { nome: "Grade Completa", pares: 12, subtitulo: "Numerações completas", destaque: true,
    numeracoes: [{n:34,pares:1},{n:35,pares:2},{n:36,pares:3},{n:37,pares:3},{n:38,pares:2},{n:39,pares:1}] },
};

const CART_KEY = "biaritz_cart_v1";

/* ---------- helpers ---------- */
const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// categoria (plural, como no catálogo) -> singular p/ compor o nome do produto
const SINGULAR = {
  "Flats e Papetes": "Flat", "Sandálias de Salto": "Sandália de Salto",
  "Rasteiras": "Rasteira", "Botas": "Bota", "Tamancos": "Tamanco",
  "Scarpins": "Scarpin", "Sapatilhas": "Sapatilha", "Chinelos": "Chinelo",
  "Birkens": "Birken", "Anabela": "Anabela", "Mary Jane": "Mary Jane",
  "Tênis": "Tênis", "Mocassim": "Mocassim",
};
const catSingular = (p) => SINGULAR[p.categoria] || p.categoria;
// nome = categoria singular + cor (planilha não tem nome próprio); adm pode sobrescrever p.nome
const tituloProduto = (p) => p.nome || `${catSingular(p)} ${p.cor}`;
const nomeProduto = (p) => p.nome || `${catSingular(p)} ${p.cor} (ref. ${p.ref})`;
// desconto progressivo à vista por valor do pedido: 5% base, 7% >=5mil, 10% >=8mil
const descontoPct = (v) => v >= 8000 ? 10 : v >= 5000 ? 7 : 5;
const avista = (v) => v * (1 - descontoPct(v) / 100);
const precoCheio = (p) => p.precoMax;    // preço da planilha (com NF)
// Preço único por par (igual em todas as grades) = preço cheio.
const precoGrade = (p, gKey) => precoCheio(p);
const FICHA_ROWS = [
  ["cor", "Cor"], ["estacao", "Estação"], ["material", "Material"],
  ["saltoTipo", "Tipo de salto"], ["saltoAltura", "Altura do salto"],
];
// modo curadoria: ?debug mostra selos de flag (foto/descrição a revisar)
const DEBUG = new URLSearchParams(location.search).has("debug");

async function loadProducts() {
  const r = await fetch("products.json");
  return r.json();
}

/* ---------- carrinho (localStorage) ---------- */
function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
}
function setCart(c) { localStorage.setItem(CART_KEY, JSON.stringify(c)); }
function cartTotals(cart) {
  let total = 0, pares = 0, grades = 0;
  for (const it of cart) {
    const n = GRADES[it.grade].pares * it.qtd;
    total += n * it.precoPar; pares += n; grades += it.qtd;
  }
  return { total, pares, grades, itens: cart.length };
}
function waLink(cart, fone) {
  const t = cartTotals(cart);
  let txt = "*Pedido Biaritz*%0A%0A";
  cart.forEach((it, i) => {
    const g = GRADES[it.grade];
    const sub = g.pares * it.qtd * it.precoPar;
    txt += `${i + 1}. ${nomeProduto(it)} — ${it.cor}%0A`;
    txt += `   ${g.nome} x${it.qtd} (${g.pares * it.qtd} pares) · ${brl(it.precoPar)}/par = ${brl(sub)}%0A`;
  });
  txt += `%0A*Total:* ${t.pares} pares · ${brl(t.total)}`;
  txt += `%0A*À vista (-${descontoPct(t.total)}%):* ${brl(avista(t.total))}`;
  txt = txt.replace(/ /g, "%20");
  return `https://wa.me/${fone}?text=${txt}`;
}

/* ================= CATÁLOGO ================= */
const CAT_STATE_KEY = "biaritz_catalogo_v1";

async function initCatalogo() {
  const produtos = (await loadProducts()).filter((p) => p.ativo !== false);
  const cats = ["Todos", ...new Set(produtos.map((p) => p.categoria))];
  const elFilters = document.getElementById("filters");
  const elGrid = document.getElementById("grid");

  // Seta dos filtros: rola a faixa de categorias + animação ao clicar
  const elArrow = document.getElementById("filtersArrow");
  if (elArrow) {
    const atFim = () => elFilters.scrollLeft + elFilters.clientWidth >= elFilters.scrollWidth - 4;
    const sync = () => { elArrow.style.opacity = atFim() ? "0" : "1"; };
    elArrow.addEventListener("click", () => {
      const fim = atFim();
      elFilters.scrollBy({ left: fim ? -elFilters.scrollWidth : elFilters.clientWidth * 0.7, behavior: "smooth" });
      elArrow.classList.remove("nudge"); void elArrow.offsetWidth; elArrow.classList.add("nudge");
    });
    elFilters.addEventListener("scroll", sync, { passive: true });
    requestAnimationFrame(sync);
  }

  // Restaura filtro/scroll ao voltar do produto
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(CAT_STATE_KEY)) || {}; } catch {}
  let ativo = cats.includes(saved.filtro) ? saved.filtro : "Todos";
  let busca = saved.busca || "";
  const elSearch = document.getElementById("search");
  if (elSearch) elSearch.value = busca;

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const saveState = () => sessionStorage.setItem(CAT_STATE_KEY,
    JSON.stringify({ filtro: ativo, busca, scroll: window.scrollY }));
  // Salva só ao sair da página (não a cada scroll — evitava travar a rolagem)
  window.addEventListener("pagehide", saveState);

  function renderFilters() {
    elFilters.innerHTML = `<span class="lbl">Filtrar:</span>` +
      cats.map((c) => `<button class="pill ${c === ativo ? "active" : ""}" data-c="${c}">${c}</button>`).join("");
    elFilters.querySelectorAll(".pill").forEach((b) =>
      b.addEventListener("click", () => { ativo = b.dataset.c; saveState(); renderFilters(); renderGrid(); }));
  }
  function renderGrid() {
    let lista = ativo === "Todos" ? produtos : produtos.filter((p) => p.categoria === ativo);
    const q = busca.trim().toLowerCase();
    if (q) lista = lista.filter((p) => [tituloProduto(p), p.ref, p.cor, p.categoria, nomeProduto(p)]
      .some((s) => String(s || "").toLowerCase().includes(q)));
    if (!lista.length) {
      elGrid.innerHTML = `<div class="grid-vazio">Nenhum produto encontrado para “${busca}”.</div>`;
      return;
    }
    elGrid.innerHTML = lista.map((p, i) => `
      <a class="card" href="produto.html?id=${encodeURIComponent(p.id)}">
        <div class="photo">
          <span class="badge green">Pronta entrega</span>
          ${DEBUG && (p.flagFoto || p.flagDescricao) ? `<span class="badge flag" title="${[...(p.flagFoto ? p.motivosFoto : []), ...(p.flagDescricao ? ['descrição a preencher'] : [])].join(' · ')}">⚑ revisar</span>` : ""}
          <img src="${p.foto}" alt="${p.ref} ${p.cor}" width="320" height="400" ${i < 4 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}>
        </div>
        <div class="body">
          <div class="ref">Ref. ${p.ref}</div>
          <div class="name">${tituloProduto(p)}</div>
          <div class="price">
            <div class="price-main"><b>${brl(precoCheio(p))}</b><small>/par</small></div>
            <div class="price-avista">5–10% à vista conforme o pedido</div>
          </div>
        </div>
      </a>`).join("");
  }
  if (elSearch) elSearch.addEventListener("input", () => {
    busca = elSearch.value;
    saveState();
    renderGrid();
  });
  renderFilters();
  renderGrid();
  // Volta pro ponto de scroll anterior
  if (saved.scroll) requestAnimationFrame(() => window.scrollTo(0, saved.scroll));
}

/* ================= PRODUTO ================= */
async function initProduto() {
  const produtos = await loadProducts();
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const ref = params.get("ref");
  const p = produtos.find((x) => x.id === id) || produtos.find((x) => x.ref === ref) || produtos[0];
  const sel = { baixa: 0, alta: 0, completa: 0 };
  // Galeria: uma foto por produto (usa p.fotos se vier várias no futuro).
  const fotos = (Array.isArray(p.fotos) && p.fotos.length ? p.fotos : [p.foto]);
  let fotoAtiva = 0;

  const el = document.getElementById("product");

  function sub(gKey, qtd) {
    return GRADES[gKey].pares * qtd * precoGrade(p, gKey);
  }
  function totalSel() {
    let total = 0, pares = 0;
    for (const k in sel) { total += sub(k, sel[k]); pares += GRADES[k].pares * sel[k]; }
    return { total, pares };
  }

  function render() {
    const t = totalSel();
    el.innerHTML = `
      <div class="gallery">
        <div class="main">
          <span class="badge green">Pronta entrega</span>
          ${DEBUG && p.flagFoto ? `<span class="badge flag">⚑ foto: ${p.motivosFoto.join(' · ')}</span>` : ""}
          <img src="${fotos[fotoAtiva]}" alt="${p.ref} ${p.cor}" width="480" height="600" fetchpriority="high">
        </div>
        ${fotos.length > 1 ? `<div class="thumbs">${fotos.map((f, i) =>
          `<div class="thumb ${i === fotoAtiva ? "active" : ""}" data-foto="${i}"><img src="${f}" alt=""></div>`).join("")}</div>` : ""}
      </div>
      <div class="info">
        <div class="meta"><span>Ref. ${p.ref}</span></div>
        <h1>${tituloProduto(p)}</h1>
        <span class="cat-pill">${p.categoria}</span>

        <div>
          <div class="section-lbl spec-lbl">Especificações</div>
          <dl class="ficha">
            ${FICHA_ROWS.map(([k, lbl]) => {
              const v = k === "cor" ? p.cor : k === "estacao" ? (p.estacao || "") : (p.ficha?.[k] || "");
              const corDot = k === "cor" ? `<span class="cor-dot" style="background:${p.corHex || '#C4AE97'}"></span>` : "";
              return `<div class="ficha-col"><dt>${lbl}</dt>
                <dd class="${v ? "" : "pend"}">${corDot}${v || "A confirmar"}</dd></div>`;
            }).join("")}
          </dl>
        </div>

        <div>
          <div class="section-lbl" style="margin-bottom:12px">Grades fechadas · preço por par conforme a grade</div>
          <div class="grades">
            ${Object.keys(GRADES).map((k) => {
              const g = GRADES[k];
              const pp = precoGrade(p, k);
              const on = sel[k] > 0;
              const boxes = g.numeracoes.map((x) =>
                `<div class="gsize"><span class="gn">${x.n}</span><span class="gp">${x.pares === 1 ? "1 par" : x.pares + " pares"}</span></div>`).join("");
              return `<div class="grade ${on ? "on" : ""}" data-g="${k}">
                ${g.destaque ? `<span class="grade-badge">Mais escolhida</span>` : ""}
                <div class="ginfo">
                  <div class="gname">${g.nome} · ${g.pares} pares</div>
                  <div class="gsub">${g.subtitulo}</div>
                  <div class="gsizes">${boxes}</div>
                </div>
                <div class="qty">
                  <button data-act="dec" data-g="${k}">−</button>
                  <span class="n">${sel[k]}</span>
                  <button data-act="inc" data-g="${k}">+</button>
                </div>
                <div class="gprice-box">
                  <div class="gtotal">${sel[k] > 0 ? brl(sub(k, sel[k])) : brl(g.pares * pp)}</div>
                  <div class="gper">(${brl(pp)} / par)</div>
                </div>
              </div>`;
            }).join("")}
          </div>
        </div>

        <div class="order">
          <div class="total-row">
            <span class="k">Total selecionado</span>
            <span class="v">${t.pares > 0 ? brl(t.total) : "—"}</span>
          </div>
          <div class="total-avista"${t.pares > 0 ? "" : " style=\"visibility:hidden\""}>${brl(avista(t.pares > 0 ? t.total : 0))} à vista (-${descontoPct(t.total)}%)</div>
          <div class="pares">${t.pares} pares no total${t.pares > 0 && t.pares < 6 ? " · pedido mínimo 6 pares (1 grade)" : ""}</div>
          <button class="btn-add" id="addBtn">Adicionar ao carrinho</button>
          <div class="add-aviso" id="addAviso" hidden>Selecione ao menos uma grade antes de adicionar.</div>
        </div>

        <div class="facts">
          <div class="fact">💸 Até 10% de desconto à vista</div>
          <div class="fact">🚚 Frete Grátis acima de R$5 mil</div>
          <div class="fact">💳 6x sem juros no cartão</div>
          <div class="fact">👥 Atendemos apenas CNPJ</div>
        </div>
      </div>`;

    el.querySelectorAll(".qty button").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const k = b.dataset.g;
      sel[k] = Math.max(0, sel[k] + (b.dataset.act === "inc" ? 1 : -1));
      render();
    }));
    el.querySelectorAll(".thumb").forEach((th) => th.addEventListener("click", () => {
      fotoAtiva = +th.dataset.foto;
      render();
    }));
    const addBtn = el.querySelector("#addBtn");
    if (addBtn) addBtn.addEventListener("click", addToCart);
    renderPedido();
  }

  function addToCart() {
    const temSel = Object.values(sel).some((q) => q > 0);
    if (!temSel) {
      const av = el.querySelector("#addAviso");
      if (av) { av.hidden = false; clearTimeout(av._t); av._t = setTimeout(() => { av.hidden = true; }, 3500); }
      return;
    }
    const cart = getCart();
    for (const k in sel) {
      if (sel[k] <= 0) continue;
      const existente = cart.find((it) =>
        it.ref === p.ref && it.cor === p.cor && it.grade === k);
      if (existente) existente.qtd += sel[k];
      else cart.push({ ref: p.ref, categoria: p.categoria, cor: p.cor, foto: p.foto,
        nome: nomeProduto(p), grade: k, qtd: sel[k], precoPar: precoGrade(p, k) });
    }
    setCart(cart);
    flyToCart(el.querySelector("#addBtn"));
    for (const k in sel) sel[k] = 0;
    render();
    openPedido();
  }

  function renderSugestoes() {
    const sec = document.getElementById("sugestoes");
    const grid = document.getElementById("sugGrid");
    if (!sec || !grid) return;
    const outros = produtos.filter((x) => x.id !== p.id && x.ativo !== false);
    const mesmaCat = outros.filter((x) => x.categoria === p.categoria);
    const resto = outros.filter((x) => x.categoria !== p.categoria);
    const lista = [...mesmaCat, ...resto].slice(0, 4);
    if (!lista.length) return;
    grid.innerHTML = lista.map((s) => `
      <a class="card" href="produto.html?id=${encodeURIComponent(s.id)}">
        <div class="photo">
          <span class="badge green">Pronta entrega</span>
          <img src="${s.foto}" alt="${s.ref} ${s.cor}" loading="lazy">
        </div>
        <div class="body">
          <div class="ref">Ref. ${s.ref}</div>
          <div class="name">${tituloProduto(s)}</div>
          <div class="price">
            <div class="price-main"><b>${brl(precoCheio(s))}</b><small>/par</small></div>
            <div class="price-avista">5–10% à vista conforme o pedido</div>
          </div>
        </div>
      </a>`).join("");
    sec.hidden = false;
  }

  render();
  renderSugestoes();
}

/* ---------- animação "voar pro carrinho" ---------- */
function flyToCart(srcEl) {
  const btn = document.getElementById("btnPedido");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!srcEl || !btn || reduce) { bumpCart(); return; }
  const a = srcEl.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const fly = srcEl.cloneNode(true);
  fly.removeAttribute("id");
  fly.className = "fly-cart " + fly.className;
  Object.assign(fly.style, {
    left: a.left + "px", top: a.top + "px",
    width: a.width + "px", height: a.height + "px",
  });
  document.body.appendChild(fly);
  const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
  const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
  // força reflow antes de aplicar o destino p/ garantir a transição
  void fly.offsetWidth;
  requestAnimationFrame(() => {
    fly.style.transform = `translate(${dx}px, ${dy}px) scale(.1)`;
    fly.style.opacity = ".25";
  });
  let ended = false;
  const finish = () => { if (ended) return; ended = true; fly.remove(); bumpCart(); };
  fly.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 900); // fallback se transitionend não disparar
}
function bumpCart() {
  const btn = document.getElementById("btnPedido");
  if (!btn) return;
  btn.classList.remove("cart-bump"); void btn.offsetWidth; btn.classList.add("cart-bump");
}

/* ---------- carrinho-drawer "Meu pedido" (compartilhado) ---------- */
function ensureDrawer() {
  if (document.getElementById("pedidoDrawer")) return;
  const ov = document.createElement("div");
  ov.id = "pedidoOverlay"; ov.className = "ped-overlay";
  ov.addEventListener("click", closePedido);
  const dr = document.createElement("aside");
  dr.id = "pedidoDrawer"; dr.className = "ped-drawer";
  document.body.append(ov, dr);
}
function openPedido() { ensureDrawer(); renderPedido(); document.body.classList.add("ped-open"); }
function closePedido() { document.body.classList.remove("ped-open"); }

const WA_ICON = '<svg width="16" height="16" viewBox="0 0 14 14"><path d="M7 1C3.7 1 1 3.5 1 6.7c0 1.2.4 2.3 1 3.2L1 13l3.2-1c.9.5 1.8.7 2.8.7 3.3 0 6-2.5 6-6S10.3 1 7 1Z" fill="none" stroke="#fff" stroke-width="0.9"/></svg>';

function botoesVendedor(cart) {
  const ativo = vendedorAtivo();
  const chaves = ativo ? [ativo] : Object.keys(VENDEDORES);
  const on = cart.length > 0;
  return chaves.map((k) => {
    const v = VENDEDORES[k];
    const href = on ? `href="${waLink(cart, v.fone)}" target="_blank" rel="noopener"` : "";
    return `<a class="btn-wa ${on ? "" : "off"}" ${href}>${WA_ICON} ENVIAR — ${v.nome.toUpperCase()}</a>`;
  }).join("");
}

function renderPedido() {
  const cart = getCart();
  const t = cartTotals(cart);
  const count = document.getElementById("pedidoCount");
  if (count) count.textContent = cart.length;
  const dr = document.getElementById("pedidoDrawer");
  if (!dr) return;
  const linhas = cart.map((it, i) => {
    const g = GRADES[it.grade];
    const pares = g.pares * it.qtd;
    return `<div class="ped-item">
      <img src="${it.foto || ""}" alt="">
      <div class="pi-main">
        <div class="pi-name">${it.nome || nomeProduto(it)}</div>
        <div class="pi-sub">${it.ref} · ${it.cor}</div>
        <div class="pi-qty">
          <button data-act="dec" data-i="${i}">−</button>
          <span class="pi-n">${it.qtd}</span>
          <button data-act="inc" data-i="${i}">+</button>
          <span class="pi-pares">${g.nome.replace("Grade ", "")} · ${pares} pares</span>
        </div>
      </div>
      <button class="pi-x" data-act="del" data-i="${i}" aria-label="remover">×</button>
    </div>`;
  }).join("");

  const META_FRETE = 5000, META_DESC = 8000;
  const pct = Math.min(100, (t.total / META_DESC) * 100);
  const dPct = descontoPct(t.total);
  let bmsg;
  if (t.total < META_FRETE) bmsg = `Você tem <b>${dPct}%</b> à vista · faltam <b>${brl(META_FRETE - t.total)}</b> p/ <b>frete grátis + 7%</b> 🚚`;
  else if (t.total < META_DESC) bmsg = `Frete grátis ✓ · faltam <b>${brl(META_DESC - t.total)}</b> p/ <b>10% de desconto</b> 🏷️`;
  else bmsg = `🎉 Frete grátis ✓ · <b>10% de desconto</b> (máximo)`;
  const r1 = t.total >= META_FRETE, r2 = t.total >= META_DESC;
  const freteHtml = cart.length ? `
    <div class="frete">
      <div class="frete-msg">${bmsg}</div>
      <div class="frete-bar${r2 ? " full" : ""}">
        <span style="width:0%"></span>
        <i class="fmark ${r1 ? "hit" : ""}" style="left:62.5%"></i>
        <i class="fmark ${r2 ? "hit" : ""}" style="left:100%"></i>
      </div>
      <div class="frete-ticks"><span style="left:62.5%">frete + 7%</span><span style="left:100%">10%</span></div>
    </div>` : "";

  dr.innerHTML = `
    <div class="ped-head">
      <div><div class="ped-title">Meu pedido</div><div class="ped-mod">${cart.length} ${cart.length === 1 ? "modelo" : "modelos"}</div></div>
      <button class="ped-close" id="pedClose" aria-label="fechar">×</button>
    </div>
    <div class="ped-list">${cart.length ? linhas : '<div class="ped-vazio">Seu pedido está vazio.</div>'}</div>
    ${freteHtml}
    <div class="ped-foot">
      <div class="ped-mini">
        <div class="pm-cell"><span>Grades</span><b>${t.grades}</b></div>
        <div class="pm-cell"><span>Pares</span><b>${t.pares}</b></div>
      </div>
      <div class="ped-tot ped-valor"><span>Total</span><b>${brl(t.total)}</b></div>
      ${t.total > 0 ? `<div class="ped-tot ped-avista"><span>À vista (-${descontoPct(t.total)}%)</span><b>${brl(avista(t.total))}</b></div>` : ""}
      <div class="ped-aviso">Pedido sujeito à confirmação.</div>
      <button class="btn-continuar" id="pedContinuar">Continuar comprando</button>
      ${botoesVendedor(cart)}
    </div>`;

  const barFill = dr.querySelector(".frete-bar span");
  if (barFill) requestAnimationFrame(() => { barFill.style.width = pct + "%"; });

  dr.querySelector("#pedClose").addEventListener("click", closePedido);
  dr.querySelector("#pedContinuar").addEventListener("click", () => {
    if (document.body.dataset.page === "produto") location.href = "index.html";
    else closePedido();
  });
  dr.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
    const c = getCart();
    const i = +b.dataset.i;
    if (b.dataset.act === "inc") c[i].qtd++;
    else if (b.dataset.act === "dec") { c[i].qtd--; if (c[i].qtd <= 0) c.splice(i, 1); }
    else if (b.dataset.act === "del") c.splice(i, 1);
    setCart(c);
    renderPedido();
  }));
}

/* ---------- bootstrap ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "catalogo") initCatalogo();
  else if (page === "produto") initProduto();
  if (!document.getElementById("proto-wm")) {
    const wm = document.createElement("div");
    wm.id = "proto-wm";
    wm.innerHTML = '<b>Protótipo</b> · não representa o resultado final';
    document.body.appendChild(wm);
  }
  ensureDrawer();
  renderPedido();
  const btn = document.getElementById("btnPedido");
  if (btn) btn.addEventListener("click", openPedido);
  if (location.hash === "#pedido") openPedido();
});
