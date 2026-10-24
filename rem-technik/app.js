// REM-Technik — client side: cart, search, filters, account, checkout.
// Everything is stored in localStorage; nothing leaves the browser except the ARES lookup.

const ROOT = new URL(document.querySelector('meta[name="root"]')?.content || "./", location.href);
const url = (p) => new URL(p, ROOT).href;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const VAT = 0.21;
const nf = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });
const czk = (n) => `${nf.format(Math.round(n))} Kč`;
const stockTxt = (s) => (s === "in" ? "Skladem" : s === "ask" ? "Termín na dotaz" : "Na objednávku");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (n, cls = "") => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\u00a0/g, " ").toLowerCase();
const compact = (s) => norm(s).replace(/[^a-z0-9]/g, "");
const pl = (n, one = "položka", few = "položky", many = "položek") => `${nf.format(n)}\u00a0${n === 1 ? one : n > 1 && n < 5 ? few : many}`;

/* ---------------- storage ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("rem." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rem." + k, JSON.stringify(v)); } catch {} bc?.postMessage(k); },
};
const bc = "BroadcastChannel" in window ? new BroadcastChannel("rem") : null;
bc && (bc.onmessage = () => { renderHeader(); applyPrices(); });

/* ---------------- search index ---------------- */
let IDX;
function getIndex() {
  if (!IDX) {
    IDX = fetch(url("data/search.json")).then((r) => r.json()).then((d) => {
      const byId = new Map();
      const rows = d.p.map((r) => {
        const o = { id: r[0], n: r[1], c: r[2], b: r[3], pr: r[4], s: r[5] === 1 ? "in" : r[5] === 2 ? "ask" : "out", sub: r[6], u: r[7], img: r[8] ? `assets/img/p/${r[0]}-s.webp` : "assets/img/none.svg", pa: r[9] };
        o.hay = norm(`${o.n} ${o.c} ${o.b} ${o.pa.map((x) => x.join(" ")).join(" ")}`);
        o.cc = compact(o.c);
        o.nn = norm(o.n);
        byId.set(o.id, o);
        return o;
      });
      // article pages: [title, local path, kind]; matched on whole-word prefixes of the title
      const arts = (d.a || []).map(([t, u, k]) => ({ t, u, k, nt: norm(t), w: norm(t).split(/[^a-z0-9]+/).filter(Boolean) }));
      return { rows, byId, cats: d.c, brands: d.b, subs: d.s, arts };
    });
  }
  return IDX;
}
const ART_KIND = { oblast: "Oblast použití", aplikace: "Aplikace", novinka: "Novinka", podpora: "Podpora", vyrobce: "Výrobce", firma: "O firmě", sekce: "Skupina" };
const ART_RANK = { oblast: 3, podpora: 3, aplikace: 2, vyrobce: 2, firma: 2, sekce: 2, novinka: 0 }; // guides before news
function searchArticles(idx, q, limit = 0, skip = new Set()) {
  const qn = norm(q).trim();
  const toks = qn.split(/[^a-z0-9]+/).filter(Boolean);
  if (qn.length < 2 || !toks.length) return [];
  const out = [], seen = new Set();
  for (const a of idx.arts) {
    if (skip.has(a.u) || seen.has(a.k + a.nt)) continue; // the old site repeats some news titles
    seen.add(a.k + a.nt);
    let s = 0;
    for (const t of toks) {
      let best = 0;
      for (const w of a.w) { if (w === t) { best = 3; break; } if (w.startsWith(t)) best = 2; }
      if (!best) { s = -1; break; }
      s += best;
    }
    if (s < 0) continue;
    if (a.nt.startsWith(qn)) s += 3;
    out.push([s + (ART_RANK[a.k] ?? 1), a]);
  }
  out.sort((x, y) => y[0] - x[0] || x[1].t.length - y[1].t.length || x[1].t.localeCompare(y[1].t, "cs"));
  return (limit ? out.slice(0, limit) : out).map((x) => x[1]);
}

/* ---------------- account & pricing ---------------- */
const DEMO_USER = { company: "Ukázkový zákazník s.r.o.", ico: "12345679", dic: "CZ12345679", street: "Technická 12, 616 00 Brno", tel: "+420 600 000 000", name: "Jan Novák", email: "nakup@ukazka.cz", level: "Ceník B2B 2", disc: { IDEC: 12, REER: 8, steute: 10, "VIPA YASKAWA": 7, Thermokon: 6, _: 5 } };
const user = () => store.get("user", null);
// Two visitor modes: public visitors build a quote request, approved company accounts order at their prices.
const isCustomer = () => !!user();
const basketWord = () => (isCustomer() ? "košíku" : "poptávky"); // "do …"
const basketIn = () => (isCustomer() ? "košíku" : "poptávce"); // "v …"
const buyLabel = () => (isCustomer() ? "Do košíku" : "Do poptávky");
function applyMode() { document.documentElement.dataset.mode = isCustomer() ? "customer" : "public"; }
function yourPrice(price, brand) {
  const u = user();
  if (!u || price == null) return price;
  const d = u.disc[brand] ?? u.disc._ ?? 0;
  return Math.round(price * (1 - d / 100));
}
function applyPrices(root = document) {
  const u = user();
  for (const el of $$("[data-p]", root)) {
    const list = +el.dataset.p;
    if (!el.dataset.list) el.dataset.list = el.textContent;
    const yp = yourPrice(list, el.dataset.brand);
    if (u && yp !== list) {
      el.classList.add("yours");
      el.textContent = czk(yp);
      el.title = `Vaše cena, ceníková ${czk(list)}`;
    } else {
      el.classList.remove("yours");
      el.textContent = el.dataset.list;
      el.removeAttribute("title");
    }
  }
  for (const el of $$("[data-pv]", root)) {
    const list = +el.dataset.pv;
    const brand = el.previousElementSibling?.dataset?.brand ?? el.closest("[data-brand]")?.dataset.brand;
    const yp = yourPrice(list, brand);
    if (!el.dataset.prefix) el.dataset.prefix = el.textContent.startsWith("bez DPH") ? "1" : "0";
    const prefix = el.dataset.prefix === "1" ? "bez DPH, " : "";
    el.textContent = u && yp !== list ? (prefix ? `Vaše cena bez DPH, ceníková ${czk(list)}` : `Vaše cena, ceníková ${czk(list)}`) : `${prefix}${czk(list * (1 + VAT))} s DPH`;
  }
}

/* ---------------- volume prices (set by the company; demo defaults) ---------------- */
const DEFAULT_TIERS = {
  enabled: true,
  rules: [
    { scope: "sub", key: "komponenty-pro-spinani/rele", tiers: [[10, 5], [50, 10]] },
    { scope: "sub", key: "komponenty-pro-spinani/univerzalni-rele-a-patice", tiers: [[10, 5], [50, 10]] },
    { scope: "sub", key: "komponenty-pro-spinani/tlacitka-a-kontrolky", tiers: [[20, 6], [100, 12]] },
    { scope: "sub", key: "komponenty-pro-spinani/koncove-spinace", tiers: [[10, 4], [25, 8]] },
    { scope: "brand", key: "HONGFA", tiers: [[5, 4], [20, 8]] },
  ],
};
const tiersCfg = () => store.get("tiers", DEFAULT_TIERS);
function tierRule(p) {
  const c = tiersCfg();
  if (!c.enabled || p.pr == null) return null;
  return c.rules.find((r) => r.scope === "sub" && r.key === p.sub) || c.rules.find((r) => r.scope === "brand" && r.key === p.b) || null;
}
function tierPct(p, q) {
  const r = tierRule(p);
  let pct = 0;
  if (r) for (const [from, d] of r.tiers) if (q >= from) pct = d;
  return pct;
}
function basePrice(p) { return p.pr == null ? null : isCustomer() ? yourPrice(p.pr, p.b) : p.pr; }
function unitPrice(p, q) { const b = basePrice(p); return b == null ? null : Math.round(b * (1 - tierPct(p, q) / 100)); }
function tierNote(p) {
  const r = tierRule(p);
  if (!r) return "";
  const [from, pct] = r.tiers[r.tiers.length - 1];
  return `<span class="tier-note">od ${czk(Math.round(basePrice(p) * (1 - pct / 100)))} při ${from} ks</span>`;
}
function tierTable(p, q) {
  const r = tierRule(p);
  if (!r) return "";
  const steps = [[1, 0], ...r.tiers], b = basePrice(p);
  const rows = steps.map(([from, pct], i) => {
    const to = steps[i + 1] ? steps[i + 1][0] - 1 : null;
    const on = q >= from && (to == null || q <= to);
    return `<tr${on ? ' class="on"' : ""}><th scope="row">${to == null ? `od ${from} ks` : from === to ? `${from} ks` : `${from}–${to} ks`}</th><td>${czk(Math.round(b * (1 - pct / 100)))}</td><td>${pct ? `−${pct} %` : ""}</td></tr>`;
  }).join("");
  const unit = unitPrice(p, q);
  return `<table class="tier-table"><caption>Množstevní ceny bez DPH</caption><tbody>${rows}</tbody></table>
    <p class="tier-live" aria-live="polite">Při ${q} ks: <b>${czk(unit)}/ks</b>, celkem <b>${czk(unit * q)}</b> bez DPH</p>`;
}
function nextTier(p, q) {
  const r = tierRule(p);
  return r ? r.tiers.find(([from]) => from > q) || null : null;
}

/* ---------------- cart ---------------- */
const cart = {
  all: () => store.get("cart", []),
  save(lines) { store.set("cart", lines); renderHeader(); },
  add(p, q) {
    const lines = cart.all();
    const l = lines.find((x) => x.id === p.id);
    if (l) l.q = Math.min(9999, l.q + q); else lines.push({ id: p.id, q, n: p.n, c: p.c, b: p.b, pr: p.pr, s: p.s, u: p.u, img: p.img, sub: p.sub });
    cart.save(lines);
  },
  set(id, q) { const lines = cart.all(); const l = lines.find((x) => x.id === id); if (l) l.q = Math.max(1, Math.min(9999, q)); cart.save(lines); },
  remove(id) { cart.save(cart.all().filter((x) => x.id !== id)); },
  note(id, text) { const lines = cart.all(); const l = lines.find((x) => x.id === id); if (l) l.note = text.slice(0, 300); store.set("cart", lines); },
  totals(lines = cart.all()) {
    let list = 0, net = 0, base = 0, quote = 0, items = 0;
    for (const l of lines) {
      items += l.q;
      if (l.pr == null) { quote++; continue; }
      list += l.pr * l.q;
      base += basePrice(l) * l.q;
      net += unitPrice(l, l.q) * l.q;
    }
    return { list, net, disc: list - net, custDisc: list - base, volDisc: base - net, vat: net * VAT, gross: net * (1 + VAT), quote, items, n: lines.length };
  },
};

function renderHeader() {
  applyMode();
  const t = cart.totals();
  for (const el of $$("[data-cart-count]")) { el.textContent = t.n || ""; el.dataset.n = t.n; }
  for (const el of $$("[data-cart-total]")) el.textContent = !t.n ? (isCustomer() ? "0 Kč" : "prázdná") : t.net ? czk(t.net) : pl(t.n);
  const cmp = store.get("compare", []);
  for (const el of $$("[data-compare-count]")) { el.textContent = cmp.length; el.dataset.n = cmp.length; }
  const u = user();
  for (const el of $$("[data-acc-name]")) el.textContent = u ? u.name : "Přihlásit";
  const reg = store.get("reg", null);
  for (const el of $$("[data-acc-small]")) el.textContent = u ? u.company : reg?.status === "pending" ? "Žádost čeká na schválení" : "Firemní účet";
  for (const b of $$("[data-compare]")) {
    const on = cmp.includes(+b.dataset.compare);
    b.setAttribute("aria-pressed", on);
    const s = $("span", b); if (s) s.textContent = on ? "V porovnání" : "Porovnat";
  }
}

let toastTimer;
function toast(msg) {
  const t = $("[data-toast]");
  if (!t) return;
  t.innerHTML = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 3200);
}

function showAdded(p, q) {
  const pop = $("#added");
  const cus = isCustomer();
  if (!pop || !pop.showPopover) { toast(`Přidáno do ${basketWord()}: ${esc(p.n)}`); return; }
  const t = cart.totals();
  const line = cart.all().find((x) => x.id === p.id);
  const unit = p.pr == null ? "cena na dotaz" : `${czk(unitPrice(p, line?.q ?? q))}/ks bez DPH${tierPct(p, line?.q ?? q) ? `, množstevní sleva −${tierPct(p, line?.q ?? q)} %` : ""}`;
  const head = !cus ? "Přidáno do poptávky" : p.pr == null ? "Přidáno do košíku jako poptávka" : "Přidáno do košíku";
  pop.innerHTML = `<div class="ok">${icon("check")} ${head}</div>
    <div class="line"><img src="${url(p.img)}" alt="" width="56" height="56"><div><strong>${q}× ${esc(p.n)}</strong><div class="muted" style="font-size:14px">${p.c ? `${esc(p.c)}, ` : ""}${unit}</div></div></div>
    <div class="sum"><span>V ${basketIn()} ${pl(t.n)}</span><strong>${cus ? `${czk(t.net)} bez DPH` : t.list ? `orientačně ${czk(t.net)}` : ""}</strong></div>
    <div class="acts"><button class="btn" type="button" popovertarget="added" popovertargetaction="hide">Pokračovat</button><a class="btn primary" href="${url("kosik.html")}">${cus ? "Zobrazit košík" : "Zobrazit poptávku"}</a></div>`;
  if (pop.matches(":popover-open")) pop.hidePopover();
  pop.showPopover();
  clearTimeout(pop._t);
  pop._t = setTimeout(() => pop.matches(":popover-open") && !pop.matches(":hover, :focus-within") && pop.hidePopover(), 6000);
  const c = $("[data-cart-count]");
  if (c) { c.classList.remove("tick"); void c.offsetWidth; c.classList.add("tick"); }
}

async function addById(id, q, btn) {
  const { byId } = await getIndex();
  const p = byId.get(+id);
  if (!p) return;
  cart.add(p, q);
  showAdded(p, q);
  if (btn) {
    btn._html ??= btn.innerHTML;
    btn.classList.add("is-done");
    btn.innerHTML = `${icon("check")}<span>Přidáno</span>`;
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.classList.remove("is-done"); btn.innerHTML = btn._html; }, 1600);
  }
}

/* qty steppers + buy forms, delegated */
document.addEventListener("click", (ev) => {
  const step = ev.target.closest("[data-step]");
  if (step) {
    const inp = $("input", step.closest(".qty"));
    inp.value = Math.max(1, Math.min(9999, (+inp.value || 1) + +step.dataset.step));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
document.addEventListener("submit", (ev) => {
  const f = ev.target.closest("form.buy");
  if (!f) return;
  ev.preventDefault();
  const q = Math.max(1, Math.min(9999, +f.qty.value || 1));
  addById(f.dataset.id, q, $("button[type=submit]", f));
});

/* ---------------- search combobox ---------------- */
function searchRows(idx, q, limit = 8) {
  const qn = norm(q).trim();
  if (!qn) return [];
  const toks = qn.split(/\s+/).filter(Boolean);
  const qc = compact(q);
  const out = [];
  for (const p of idx.rows) {
    let s = 0;
    if (qc.length >= 2 && p.cc.startsWith(qc)) s += 120;
    else if (qc.length >= 3 && p.cc.includes(qc)) s += 70;
    let all = true;
    for (const t0 of toks) {
      let t = t0, i = p.hay.indexOf(t);
      if (i < 0 && /\d[a-z]/.test(t)) { t = t.replace(/(\d)([a-z]+)/g, "$1 $2"); i = p.hay.indexOf(t); } // "24v" finds "24 V"
      if (i < 0) { all = false; break; }
      s += 10 + (i === 0 || p.hay[i - 1] === " " ? 6 : 0) + (p.nn.includes(t) ? 4 : 0);
    }
    if (!all && s < 70) continue;
    if (p.s === "in") s += 2;
    if (p.pr != null) s += 1;
    out.push([s, p]);
  }
  out.sort((a, b) => b[0] - a[0] || a[1].n.localeCompare(b[1].n, "cs"));
  return limit ? out.slice(0, limit).map((x) => x[1]) : out.map((x) => x[1]);
}
function hl(text, q) {
  const toks = norm(q).split(/\s+/).filter((t) => t.length > 1);
  if (!toks.length) return esc(text);
  const n = norm(text);
  const marks = new Array(text.length).fill(false);
  for (const t of toks) { let i = n.indexOf(t); while (i >= 0) { for (let k = i; k < i + t.length; k++) marks[k] = true; i = n.indexOf(t, i + t.length); } }
  let out = "", on = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] && !on) { out += "<mark>"; on = true; }
    if (!marks[i] && on) { out += "</mark>"; on = false; }
    out += esc(text[i]);
  }
  return out + (on ? "</mark>" : "");
}
function initSearch() {
  const box = $("[data-search]");
  if (!box) return;
  const input = $("input", box), pop = $("#search-pop"), form = $("form", box);
  let items = [], sel = -1;
  const close = () => { pop.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); sel = -1; };
  const select = (i) => {
    items.forEach((el, k) => el.setAttribute("aria-selected", k === i));
    sel = i;
    if (items[i]) { input.setAttribute("aria-activedescendant", items[i].id); items[i].scrollIntoView({ block: "nearest" }); }
  };
  async function render() {
    const q = input.value;
    if (!q.trim()) { close(); return; }
    const idx = await getIndex();
    if (q !== input.value) return;
    const qn = norm(q).trim();
    const cats = qn.length > 1 ? idx.cats.filter((c) => norm(c[0]).includes(qn)).slice(0, 3) : [];
    const brands = qn.length > 1 ? idx.brands.filter((b) => norm(b[0]).includes(qn)).slice(0, 2) : [];
    // articles skip pages already offered as a brand (a supplier page is the brand page)
    const allArts = searchArticles(idx, q, 0, new Set([...cats, ...brands].map((x) => x[1])));
    const res = searchRows(idx, q, cats.length + brands.length || allArts.length ? 5 : 7);
    const arts = allArts.slice(0, res.length ? 3 : 6);
    let h = "";
    // categories and brands first: for "relé" or "steute" the group is the better answer than one product
    if (cats.length || brands.length) {
      h += `<div class="sp-group"><div class="sp-head"><span>Kategorie a výrobci</span></div>`;
      h += [...brands.map((b) => [b[0], b[1], `výrobce, ${pl(b[2])}`]), ...cats.map((c) => [c[0], c[1], pl(c[2])])]
        .map((x, i) => `<a class="sp-link" role="option" id="spl-${i}" href="${url(x[1])}" aria-selected="false">${icon("chev-right", "sm")}<span>${hl(x[0], q)} <span class="muted">${x[2]}</span></span></a>`).join("");
      h += `</div>`;
    }
    if (res.length) {
      h += `<div class="sp-group"><div class="sp-head"><span>Produkty</span><span class="kbd-hint">Shift + Enter přidá do ${basketWord()}</span></div>`;
      h += res.map((p, i) => `<a class="sp-item" role="option" id="sp-${i}" data-pid="${p.id}" href="${url(p.u)}" aria-selected="false">
        <img src="${url(p.img)}" alt="" width="48" height="48"><span><span class="t">${hl(p.n, q)}</span><span class="c">${p.c ? `${hl(p.c, q)}, ` : ""}${esc(p.b)}</span></span>
        <span class="r">${p.pr != null ? `<span class="price" data-p="${p.pr}" data-brand="${esc(p.b)}">${czk(p.pr)}</span>` : `<span class="c">Cena na dotaz</span>`}<span class="stock ${p.s}">${stockTxt(p.s)}</span></span></a>`).join("");
      h += `</div>`;
    }
    if (arts.length) {
      h += `<div class="sp-group"><div class="sp-head"><span>Články a stránky</span></div>`;
      h += arts.map((a, i) => `<a class="sp-link" role="option" id="spa-${i}" href="${url(a.u)}" aria-selected="false">${icon("file", "sm")}<span>${hl(a.t, q)} <span class="muted">${ART_KIND[a.k] || ""}</span></span></a>`).join("");
      h += `</div>`;
    }
    if (!h) h = `<div class="sp-empty">Pro „${esc(q)}“ nic nemáme v e-shopu. <a href="${url("rychla-objednavka.html")}?k=${encodeURIComponent(q)}">Pošlete nám kód</a>, cenu a termín dohledáme.</div>`;
    const total = (res.length ? searchRows(idx, q, 0).length : 0) + searchArticles(idx, q).length;
    h += `<div class="sp-foot"><span class="kbd-hint">${h.includes('role="option"') ? "↑ ↓ výběr, Enter otevře" : ""}</span>${total ? `<a href="${url("hledat.html")}?q=${encodeURIComponent(q)}">${total === 1 ? "Zobrazit výsledek" : total < 5 ? `Všechny ${total} výsledky` : `Všech ${nf.format(total)} výsledků`}</a>` : ""}</div>`;
    pop.innerHTML = h;
    applyPrices(pop);
    pop.hidden = false;
    input.setAttribute("aria-expanded", "true");
    items = $$('[role="option"]', pop);
    sel = -1;
  }
  input.addEventListener("input", render);
  input.addEventListener("focus", () => { getIndex(); if (input.value.trim()) render(); });
  input.addEventListener("keydown", (ev) => {
    if (pop.hidden && ev.key === "ArrowDown") { render(); return; }
    if (ev.key === "ArrowDown") { ev.preventDefault(); select(Math.min(items.length - 1, sel + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); select(Math.max(-1, sel - 1)); }
    else if (ev.key === "Escape") { if (!pop.hidden) { ev.preventDefault(); close(); } else input.blur(); }
    else if (ev.key === "Enter" && sel >= 0 && items[sel]) {
      ev.preventDefault();
      const it = items[sel];
      if (ev.shiftKey && it.dataset.pid) { addById(it.dataset.pid, 1); }
      else location.href = it.href;
    } else if (ev.key === "Enter" && ev.shiftKey && items[0]?.dataset.pid) { ev.preventDefault(); addById(items[0].dataset.pid, 1); }
  });
  document.addEventListener("click", (ev) => { if (!box.contains(ev.target)) close(); });
  document.addEventListener("keydown", (ev) => {
    const typing = ev.target.closest("input, textarea, select, [contenteditable]");
    if ((ev.key === "/" && !typing) || ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k")) { ev.preventDefault(); input.focus(); input.select(); }
  });
  const q = new URLSearchParams(location.search).get("q");
  if (q && location.pathname.endsWith("hledat.html")) input.value = q;
  form.addEventListener("submit", (ev) => { if (!input.value.trim()) ev.preventDefault(); });
}

/* ---------------- mega menu ---------------- */
function initMega() {
  const m = $("#mega"), btn = $(".menu-btn");
  if (!m || !btn) return;
  m.addEventListener("toggle", (ev) => btn.setAttribute("aria-expanded", ev.newState === "open"));
  let loaded;
  const load = () => loaded ??= fetch(url("mega.html")).then((r) => r.text()).then((h) => {
    m.innerHTML = h.replaceAll("{R}", ROOT.href);
    bind();
  }).catch(() => { loaded = null; });
  m.addEventListener("beforetoggle", (ev) => { if (ev.newState === "open") load(); });
  btn.addEventListener("pointerenter", load, { once: true });
  btn.addEventListener("focus", load, { once: true });
  const bind = () => { for (const a of $$(".mega-cats a", m)) {
    const on = () => {
      $$(".mega-cats a", m).forEach((x) => x.removeAttribute("aria-current"));
      a.setAttribute("aria-current", "true");
      $$(".mega-panel", m).forEach((p) => p.classList.toggle("on", p.id === a.dataset.panel));
    };
    a.addEventListener("mouseenter", on);
    a.addEventListener("focus", on);
  } };
  // position under the header
  const place = () => { const r = $(".catbar").getBoundingClientRect(); m.style.top = `${Math.max(0, r.bottom)}px`; };
  m.addEventListener("beforetoggle", place);
  // hover intent on desktop
  let t;
  btn.addEventListener("mouseenter", () => { if (matchMedia("(hover:hover) and (min-width:1021px)").matches) t = setTimeout(() => { place(); m.matches(":popover-open") || m.showPopover(); }, 180); });
  btn.addEventListener("mouseleave", () => clearTimeout(t));
}

/* ---------------- listing filters ---------------- */
function initListing() {
  const data = $("#facets");
  const table = $("[data-table]");
  if (!data || !table) return;
  const rows = JSON.parse(data.textContent);
  const form = $("[data-filters]");
  const tbody = $("tbody", table);
  // Product rows are fixed slots: sorting moves a product's cells between slots, never the <tr> or its <form>.
  // Re-inserting 400+ buy forms makes Chrome's autofill rescan every form on the page (~0.5 s at 4× CPU).
  const slots = $$("tr[data-id]", tbody);
  const trs = new Map(slots.map((tr) => [tr.dataset.id, tr])); // product id → the slot showing it (kept live)
  const famRows = $$("tr.fam", tbody);
  const nEl = $("[data-result-n]"), chips = $("[data-chips]"), empty = $("[data-empty]"), sortSel = $("[data-sort]");
  const resets = $$("[data-reset]");

  const numOf = (v) => { const m = String(v ?? "").replace(/(?<=\d)[\s\u00a0](?=\d{3})/g, "").match(/^\s*[-–]?\d+(?:[.,]\d+)?/); return m ? parseFloat(m[0].replace(",", ".").replace("–", "-")) : null; };
  for (const r of Object.values(rows)) r.hay = norm(`${r.n} ${r.c} ${r.b} ${Object.values(r.p).join(" ")}`);
  const read = () => {
    const st = { stock: form.stock?.checked, priced: form.priced?.checked, q: norm(form.q?.value || "").trim(), pmin: +form.pmin?.value || null, pmax: +form.pmax?.value || null, sets: {}, ranges: {} };
    for (const cb of $$('input[type=checkbox]:checked', form)) if (cb.name !== "stock" && cb.name !== "priced") (st.sets[cb.name] ??= new Set()).add(cb.value);
    for (const box of $$("[data-range]", form)) {
      const k = box.dataset.range, lo = $("input[name^='rmin:']", box).value, hi = $("input[name^='rmax:']", box).value;
      if (lo !== "" || hi !== "") st.ranges[k] = [lo === "" ? -Infinity : +lo, hi === "" ? Infinity : +hi];
    }
    return st;
  };
  const val = (r, key) => key === "brand" ? r.b : key === "sub" ? r.sub : key.startsWith("p:") ? r.p[key.slice(2)] : undefined;
  const match = (r, st, skip) => {
    if (st.stock && skip !== "stock" && r.s !== "in") return false;
    if (st.priced && r.pr == null) return false;
    if (st.q && !st.q.split(/\s+/).every((t) => r.hay.includes(t))) return false;
    for (const [k, [lo, hi]] of Object.entries(st.ranges)) { const x = numOf(val(r, k)); if (x == null || x < lo || x > hi) return false; }
    if (skip !== "price") {
      if (st.pmin != null && (r.pr == null || r.pr < st.pmin)) return false;
      if (st.pmax != null && (r.pr == null || r.pr > st.pmax)) return false;
    }
    for (const [k, set] of Object.entries(st.sets)) if (k !== skip && !set.has(String(val(r, k)))) return false;
    return true;
  };
  function apply(push = true, facets = true) {
    const st = read();
    let n = 0;
    for (const [id, r] of Object.entries(rows)) {
      const ok = match(r, st);
      const tr = trs.get(id);
      if (tr) tr.hidden = !ok;
      if (ok) n++;
    }
    for (const fr of famRows) {
      let next = fr.nextElementSibling, any = false;
      while (next && !next.classList.contains("fam")) { if (!next.hidden && next.dataset.id && rows[next.dataset.id]?.f == fr.dataset.fam) any = true; next = next.nextElementSibling; }
      fr.hidden = !any || table.classList.contains("flat");
    }
    // facet counts against all other filters (a re-sort leaves them unchanged)
    if (facets) for (const opt of $$(".fopt", form)) {
      const cb = $("input", opt), key = cb.name;
      let c = 0;
      for (const r of Object.values(rows)) if (String(val(r, key)) === cb.value && match(r, st, key)) c++;
      $("[data-n]", opt).textContent = c;
      opt.classList.toggle("zero", c === 0 && !cb.checked);
    }
    nEl.textContent = pl(n);
    $$(".fshow").forEach((b) => (b.textContent = n ? `Zobrazit ${pl(n)}` : "Nic neodpovídá, upravte filtry"));
    empty.hidden = n > 0;
    table.hidden = n === 0;
    // chips
    const list = [];
    if (st.q) list.push(["q", "", `„${form.q.value.trim()}“`]);
    if (st.stock) list.push(["stock", "in", "Jen skladem"]);
    if (st.priced) list.push(["priced", "1", "Jen s cenou online"]);
    for (const [k, [lo, hi]] of Object.entries(st.ranges)) list.push(["range", k, `${k.slice(2)}: ${lo === -Infinity ? "" : `od ${lo} `}${hi === Infinity ? "" : `do ${hi}`}`.trim()]);
    if (st.pmin != null) list.push(["pmin", "", `Od ${czk(st.pmin)}`]);
    if (st.pmax != null) list.push(["pmax", "", `Do ${czk(st.pmax)}`]);
    for (const [k, set] of Object.entries(st.sets)) for (const v of set) {
      const lab = $(`input[name="${CSS.escape(k)}"][value="${CSS.escape(v)}"]`, form)?.nextElementSibling?.textContent ?? v;
      list.push([k, v, k.startsWith("p:") ? `${k.slice(2)}: ${lab}` : lab]);
    }
    chips.innerHTML = list.map(([k, v, l]) => `<button type="button" class="chip" data-k="${esc(k)}" data-v="${esc(v)}">${esc(l)} ${icon("x")}</button>`).join("");
    resets.forEach((b) => (b.hidden = !list.length && b.closest(".filters") != null));
    if (push) {
      const sp = new URLSearchParams();
      if (st.stock) sp.set("skladem", "1");
      if (st.priced) sp.set("cena", "1");
      if (st.q) sp.set("hledat", form.q.value.trim());
      for (const box of $$("[data-range]", form)) for (const i of $$("input", box)) if (i.value !== "") sp.set(i.name, i.value);
      if (st.pmin != null) sp.set("od", st.pmin);
      if (st.pmax != null) sp.set("do", st.pmax);
      for (const [k, set] of Object.entries(st.sets)) for (const v of set) sp.append(k, v);
      if (sortSel?.value) sp.set("razeni", sortSel.value);
      writeURL(sp.toString() ? `?${sp}` : location.pathname);
    }
  }
  // replaceState restyles the whole page in Chrome (~40 ms at 4× CPU here), so it waits until after the next paint
  let urlNext = null;
  const flushURL = () => { if (urlNext != null) { history.replaceState(null, "", urlNext); urlNext = null; } };
  const writeURL = (u) => { if (urlNext == null) requestAnimationFrame(() => setTimeout(flushURL, 0)); urlNext = u; };
  addEventListener("pagehide", flushURL);
  /* sorting: precomputed orders, cells moved between fixed slots, the visible rows first */
  const ids = slots.map((tr) => tr.dataset.id); // "Doporučené" order = the slots' original order
  const at = ids.slice(), slotOf = new Map(ids.map((id, i) => [id, i])); // slot → product, product → slot
  const orders = new Map([["", ids]]);
  const coll = new Intl.Collator("cs", { numeric: true });
  function orderFor(key) {
    if (orders.has(key)) return orders.get(key);
    const num = { "price-asc": (r) => r.pr ?? Infinity, "price-desc": (r) => -(r.pr ?? -1), stock: (r) => (r.s === "in" ? 0 : 1) }[key];
    const k = new Map();
    for (const id of ids) { const r = rows[id] || { n: "", p: {} }; k.set(id, num ? num(r) : key === "name" ? r.n : r.p[key.slice(2)] ?? null); }
    const o = ids.slice().sort(num ? (a, b) => k.get(a) - k.get(b)
      : (a, b) => { const x = k.get(a), y = k.get(b); return x == null || y == null ? (x == null) - (y == null) : coll.compare(String(x), String(y)); }); // empty values last
    orders.set(key, o);
    return o;
  }
  let ui, cellsOf, buyOf; // built on the first sort
  function prep() {
    ui = slots.map((tr) => { const td = tr.lastElementChild, form = $("form", td); return { td, form, qty: form?.elements.qty, btn: form && $("button[type=submit]", form) }; });
    cellsOf = new Map(slots.map((tr, i) => [ids[i], [...tr.children].slice(0, -1)]));
    buyOf = new Map(slots.map((tr, i) => [ids[i], ui[i].btn ? { mode: ui[i].form.dataset.mode, cls: ui[i].btn.className.replace(/\s*is-done/, ""), kids: [...ui[i].btn.childNodes] } : null]));
  }
  function show(i, id) { // slot i now holds product id's cells: retarget its row and buy form
    const tr = slots[i], u = ui[i], b = buyOf.get(id);
    tr.dataset.id = id; trs.set(id, tr); at[i] = id; slotOf.set(id, i);
    if (!u.form || !b) return;
    u.form.dataset.id = id;
    if (b.mode) u.form.dataset.mode = b.mode; else delete u.form.dataset.mode;
    clearTimeout(u.btn._t); u.btn._html = undefined;
    u.btn.className = b.cls; u.btn.replaceChildren(...b.kids);
  }
  function swap(i, j) {
    const a = at[i], w = at[j], ti = slots[i], tj = slots[j];
    for (const c of cellsOf.get(w)) ti.insertBefore(c, ui[i].td);
    for (const c of cellsOf.get(a)) tj.insertBefore(c, ui[j].td);
    const qi = ui[i].qty, qj = ui[j].qty;
    if (qi && qj) [qi.value, qj.value] = [qj.value, qi.value];
    [ti.hidden, tj.hidden] = [tj.hidden, ti.hidden];
    show(i, w); show(j, a);
  }
  const place = (order, i) => { const j = slotOf.get(order[i]); if (j !== i) swap(i, j); };
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  let run = 0, settle = () => {};
  table._settle = () => settle(); // printing reads the DOM order
  function sort(key, now = false) {
    // read layout before writing anything: sorting from the sticky header deep in the table jumps back to its top
    const sec = table.closest("section") || table;
    const jump = !now && sec.getBoundingClientRect().top < 0;
    if (!ui) prep();
    table.classList.toggle("flat", !!key);
    const order = orderFor(key || ""), n = order.length, my = ++run;
    let i = 0;
    // the first screenful now (~25 rows render in one frame), the rest in small chunks after paint
    for (let seen = 0; i < n && (now || seen < 25); i++) { place(order, i); if (!slots[i].hidden) seen++; }
    settle = () => { if (my === run) { for (; i < n; i++) place(order, i); apply(false, false); } };
    if (i < n) (async () => {
      while (i < n) {
        await nextFrame();
        if (my !== run) return;
        for (const end = Math.min(n, i + 50); i < end; i++) place(order, i); // ≤ ~170 ms per frame at 4× CPU
      }
      if (famRows.length) apply(false, false); // family headers follow their rows again
    })();
    for (const th of $$("thead th", table)) th.removeAttribute("aria-sort");
    const th = key && $(`thead th [data-sortkey="${CSS.escape(key)}"]`, table)?.closest("th") || (key?.startsWith("p:") && $(`thead th[data-col="${CSS.escape(key)}"]`, table));
    if (th) th.setAttribute("aria-sort", key === "price-desc" ? "descending" : "ascending");
    apply(true, false);
    if (jump) sec.scrollIntoView({ block: "start" });
  }
  for (const [id, r] of Object.entries(rows)) {
    const cell = trs.get(id) && $(".c-price", trs.get(id));
    if (cell && r.pr != null) { const note = tierNote({ pr: r.pr, b: r.b, sub: r.sub }); if (note) cell.insertAdjacentHTML("beforeend", note); }
  }
  form.addEventListener("change", () => apply());
  form.addEventListener("input", (ev) => {
    if (ev.target.matches("[data-fsearch]")) {
      const q = norm(ev.target.value).trim();
      const box = ev.target.nextElementSibling;
      if (q) box.classList.add("all");
      for (const o of $$(".fopt", box)) o.classList.toggle("nomatch", !!q && !norm(o.textContent).includes(q));
      return;
    }
    if (ev.target.type === "number" || ev.target.type === "search") { clearTimeout(form._t); form._t = setTimeout(apply, ev.target.type === "search" ? 150 : 300); }
  });
  chips.addEventListener("click", (ev) => {
    const c = ev.target.closest(".chip"); if (!c) return;
    const k = c.dataset.k;
    if (k === "stock") form.stock.checked = false;
    else if (k === "priced") form.priced.checked = false;
    else if (k === "q") form.q.value = "";
    else if (k === "range") $$(`[data-range="${CSS.escape(c.dataset.v)}"] input`, form).forEach((i) => (i.value = ""));
    else if (k === "pmin" || k === "pmax") form[k].value = "";
    else $(`input[name="${CSS.escape(k)}"][value="${CSS.escape(c.dataset.v)}"]`, form).checked = false;
    apply();
  });
  resets.forEach((b) => b.addEventListener("click", () => { form.reset(); apply(); }));
  $$("[data-more]", form).forEach((b) => b.addEventListener("click", () => { b.previousElementSibling.classList.add("all"); b.remove(); }));
  sortSel?.addEventListener("change", () => sort(sortSel.value));
  for (const btn of $$("thead th button", table)) {
    btn.addEventListener("click", () => {
      const th = btn.closest("th");
      let key = btn.dataset.sortkey || th.dataset.col;
      if (key === "price-asc" && th.getAttribute("aria-sort") === "ascending") key = "price-desc";
      if (sortSel) sortSel.value = ["price-asc", "price-desc", "stock", "name"].includes(key) ? key : "";
      sort(key);
    });
  }
  // restore from URL
  const sp = new URLSearchParams(location.search);
  if (sp.get("skladem") && form.stock) form.stock.checked = true;
  if (sp.get("cena") && form.priced) form.priced.checked = true;
  if (sp.get("hledat") && form.q) form.q.value = sp.get("hledat");
  for (const [k, v] of sp) if (k.startsWith("rmin:") || k.startsWith("rmax:")) { const i = form.elements.namedItem(k); if (i) { i.value = v; i.closest("details")?.setAttribute("open", ""); } }
  if (sp.get("od") && form.pmin) form.pmin.value = sp.get("od");
  if (sp.get("do") && form.pmax) form.pmax.value = sp.get("do");
  for (const [k, v] of sp) { const cb = $(`input[name="${CSS.escape(k)}"][value="${CSS.escape(v)}"]`, form); if (cb) { cb.checked = true; const fo = cb.closest(".fopts"); if (cb.closest(".more")) fo.classList.add("all"); cb.closest("details")?.setAttribute("open", ""); } }
  if (sp.get("razeni")) { if (sortSel) sortSel.value = sp.get("razeni"); sort(sp.get("razeni"), true); apply(false); } else apply(false);
  // mobile drawer
  const fl = $("#filters"), scrim = $(".filters-scrim");
  // focus moves to the drawer's close button (not a text field: that would pop up the phone keyboard) and back to the opener
  let opener = null;
  const closeDrawer = () => {
    if (!fl.classList.contains("open")) return;
    fl.classList.remove("open"); scrim.hidden = true;
    if (fl.contains(document.activeElement) || document.activeElement === document.body) opener?.focus();
  };
  $$("[data-open-filters]").forEach((b) => b.addEventListener("click", () => { opener = b; fl.classList.add("open"); scrim.hidden = false; ($(".filters-x", fl) || $("input:not([type=hidden]), button:not([hidden])", fl))?.focus(); }));
  $$("[data-close-filters]").forEach((b) => b.addEventListener("click", closeDrawer));
  fl.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && fl.classList.contains("open")) { ev.preventDefault(); closeDrawer(); } });
}

/* ---------------- product page ---------------- */
function initProduct() {
  const el = $("[data-product]");
  if (!el) return;
  const p = JSON.parse(el.dataset.product);
  const record = () => {
    const r = store.get("recent", []).filter((x) => x !== p.id);
    r.unshift(p.id);
    store.set("recent", r.slice(0, 12));
  };
  if (document.prerendering) document.addEventListener("prerenderingchange", record, { once: true }); else record();
  const tb = $("[data-tiers]");
  const qIn = $(".pricebox form.buy input[name=qty]");
  if (tb && qIn && tierRule(p)) {
    const draw = () => { tb.innerHTML = tierTable(p, Math.max(1, +qIn.value || 1)); tb.hidden = false; };
    qIn.addEventListener("input", draw);
    qIn.addEventListener("change", draw);
    bc?.addEventListener("message", draw);
    draw();
  }
  ("requestIdleCallback" in window ? requestIdleCallback : setTimeout)(() => loadQR().then(() => fillQR($("[data-sheet]"))));
  $("[data-zoom]")?.addEventListener("click", () => $("#zoom").showModal());
  $$("[data-ask]").forEach((b) => b.addEventListener("click", () => $("#ask").showModal()));
  $("[data-watch]")?.addEventListener("click", () => $("#watch").showModal());
  $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); } catch {}
    const old = b.innerHTML; b.innerHTML = `${icon("check", "sm")} Zkopírováno`; setTimeout(() => (b.innerHTML = old), 1500);
  }));
  $$("[data-save]").forEach((b) => b.addEventListener("click", () => {
    const lists = store.get("lists", [{ name: "Oblíbené", items: {} }]);
    lists[0].items[p.id] = (lists[0].items[p.id] || 0) + 1;
    store.set("lists", lists);
    $("span", b).textContent = "Uloženo";
    toast(`Uloženo do seznamu ${esc(lists[0].name)}. <a href="${url("ucet.html#seznamy")}" style="color:#fff">Otevřít seznamy</a>`);
  }));
  // sticky buy bar on phones once the price box scrolls away
  const bar = $("[data-buybar]"), box = $(".pricebox");
  if (bar && box && "IntersectionObserver" in window) {
    new IntersectionObserver(([en]) => {
      const on = !en.isIntersecting;
      bar.classList.toggle("on", on);
      bar.inert = !on;
    }).observe(box);
  }
  // local nav scrollspy
  // the active item is the last section (in page order, whatever the nav order) whose top has passed a line
  // under the sticky nav; recomputed on every scroll frame, so it follows scrolling both ways
  const links = $$(".localnav a");
  const secs = links.map((a) => [a, $(a.hash)]).filter(([, s]) => s)
    .sort(([, x], [, y]) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  if (secs.length) {
    const nav = $(".localnav"), strip = $(".wrap", nav);
    let frame = 0, cur = null;
    const spy = () => {
      frame = 0;
      const line = nav.getBoundingClientRect().bottom + innerHeight * 0.2;
      const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
      let on = null;
      for (const s of secs) if (s[1].getBoundingClientRect().top <= line) on = s;
      if (atEnd && on) on = secs[secs.length - 1]; // short last section can't reach the line
      if (on === cur) return;
      cur = on;
      for (const a of links) a.setAttribute("aria-current", on?.[0] === a ? "true" : "false");
      const a = on?.[0]; // keep it visible in the strip on phones
      if (a && strip && strip.scrollWidth > strip.clientWidth) {
        const ar = a.getBoundingClientRect(), sr = strip.getBoundingClientRect();
        if (ar.left < sr.left || ar.right > sr.right) strip.scrollLeft += ar.left - sr.left - 16;
      }
    };
    const queue = () => { frame ||= requestAnimationFrame(spy); };
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue, { passive: true });
    queue();
  }
}

/* compare toggles anywhere */
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-compare]");
  if (!b) return;
  const id = +b.dataset.compare;
  let c = store.get("compare", []);
  if (c.includes(id)) c = c.filter((x) => x !== id);
  else { if (c.length >= 4) { toast("Porovnat lze nejvýše čtyři produkty. Jeden odeberte."); return; } c.push(id); toast(`Přidáno k porovnání (${c.length}/4). <a href="${url("porovnani.html")}" style="color:#fff">Porovnat</a>`); }
  store.set("compare", c);
  renderHeader();
});

/* ---------------- dialogs & fake forms ---------------- */
function syncInvalid(form) {
  for (const f of $$("input, textarea, select", form)) f.setAttribute("aria-invalid", f.matches(":user-invalid") ? "true" : "false");
}
document.addEventListener("submit", (ev) => {
  const f = ev.target.closest("[data-fake-form]");
  if (!f) return;
  ev.preventDefault();
  if (!f.checkValidity()) { f.reportValidity(); syncInvalid(f); return; }
  const email = f.email?.value || "";
  const msg = f.dataset.fakeForm.replace("{email}", esc(email));
  const done = document.createElement("div");
  done.className = "note-box";
  done.setAttribute("role", "status");
  done.style.cssText = "background:var(--green-tint);color:var(--green);font-weight:600";
  done.innerHTML = `${icon("check")}<span>${msg}</span>`;
  f.replaceChildren(done);
});
document.addEventListener("focusout", (ev) => { const f = ev.target.closest?.("form"); if (f && ev.target.matches("input, textarea, select")) ev.target.setAttribute("aria-invalid", ev.target.matches(":user-invalid") ? "true" : "false"); });
function initTraining() {
  for (const b of $$("[data-train]")) b.addEventListener("click", () => {
    const d = $("#train");
    $("[data-train-name]", d).textContent = b.dataset.train + (b.dataset.date ? `, ${b.dataset.date}` : ", termín dle dohody");
    d.showModal();
  });
}

/* ---------------- cart page ---------------- */
function tierHint(l) {
  if (l.pr == null) return "";
  const pct = tierPct(l, l.q), nt = nextTier(l, l.q);
  const parts = [];
  if (pct) parts.push(`<span class="tier-on">Množstevní sleva −${pct} %</span>`);
  if (nt) { const save = Math.round(basePrice(l) * (1 - nt[1] / 100)); parts.push(`<span>Od ${nt[0]} ks jen ${czk(save)}/ks${nt[0] - l.q <= Math.max(5, l.q) ? `, chybí ${nt[0] - l.q} ks` : ""}</span>`); }
  return parts.length ? `<div class="tier-hint">${parts.join("")}</div>` : "";
}
function cartRows(lines, editable = true, listOnly = !isCustomer()) {
  return `<table class="ptable carttable"><thead><tr><th class="c-img"><span class="sr-only">Obrázek</span></th><th>Produkt</th><th>Dostupnost</th><th style="text-align:right">Cena/ks</th><th>Množství</th><th style="text-align:right">${listOnly ? "Orientačně" : "Celkem bez DPH"}</th><th><span class="sr-only">Odebrat</span></th></tr></thead><tbody>
  ${lines.map((l) => {
    const unit = l.unit !== undefined && !editable ? l.unit : unitPrice(l, l.q);
    return `<tr data-id="${l.id}"><td class="c-img"><a href="${url(l.u)}"><img src="${url(l.img)}" alt="" width="64" height="64"></a></td>
    <td class="c-name"><a href="${url(l.u)}">${esc(l.n)}</a><div class="code">${l.c ? `<span>Kód <b>${esc(l.c)}</b></span>` : ""}<span class="brand">${esc(l.b)}</span></div>${editable ? tierHint(l) : ""}
    ${editable ? `<div class="line-note">${l.note ? "" : `<button class="linkbtn" type="button" data-note-open="${l.id}">Přidat poznámku k položce</button>`}<input class="input" type="text" maxlength="300" value="${esc(l.note || "")}" placeholder="Např. potřebujeme i ekvivalent, termín, certifikát" aria-label="Poznámka k položce ${esc(l.c)}" name="note-${l.id}" data-line-note="${l.id}" ${l.note ? "" : "hidden"}></div>` : l.note ? `<div class="tier-hint">Poznámka: ${esc(l.note)}</div>` : ""}</td>
    <td class="c-stock"><span class="stock ${l.s}">${stockTxt(l.s)}</span></td>
    <td class="c-unit">${unit == null ? "na dotaz" : czk(unit)}</td>
    <td class="c-qty">${editable ? `<div class="qty sm"><button type="button" data-step="-1" aria-label="Méně">${icon("minus", "sm")}</button><input type="number" value="${l.q}" min="1" max="9999" inputmode="numeric" aria-label="Množství, ${esc(l.c)}" name="qty-${l.id}" data-line-q="${l.id}"><button type="button" data-step="1" aria-label="Více">${icon("plus", "sm")}</button></div>` : `${l.q} ks`}</td>
    <td class="c-total">${unit == null ? `<span class="muted" style="font-weight:400">Cenu doplníme</span>` : czk(unit * l.q)}</td>
    <td class="c-rm">${editable ? `<button class="x" type="button" data-rm="${l.id}" aria-label="Odebrat ${esc(l.c)}">${icon("trash")}</button>` : ""}</td></tr>`;
  }).join("")}</tbody></table>`;
}
function summaryHtml(t, { cta, ship = null, extra = "" } = {}) {
  const shipCost = ship ?? 0;
  const net = t.net + shipCost;
  return `<h2>Souhrn</h2><dl>
    <div><dt>Položky (${t.items} ks)</dt><dd>${czk(t.list)}</dd></div>
    ${t.custDisc ? `<div><dt>Vaše sleva dle ceníku</dt><dd style="color:var(--red)">−${czk(t.custDisc)}</dd></div>` : ""}
    ${t.volDisc ? `<div><dt>Množstevní sleva</dt><dd style="color:var(--red)">−${czk(t.volDisc)}</dd></div>` : ""}
    ${ship != null ? `<div><dt>Doprava</dt><dd>${shipCost ? czk(shipCost) : "Zdarma"}</dd></div>` : `<div><dt>Doprava</dt><dd class="muted" style="font-weight:400">v dalším kroku</dd></div>`}
    <div><dt>Bez DPH</dt><dd>${czk(net)}</dd></div>
    <div><dt>DPH 21 %</dt><dd>${czk(net * VAT)}</dd></div>
    <div class="total"><dt>Celkem s DPH</dt><dd><span class="price">${czk(net * (1 + VAT))}</span></dd></div></dl>
    ${t.quote ? `<div class="note-box">${icon("info")}<span>${t.quote} ${t.quote === 1 ? "položka nemá" : "položky nemají"} cenu v e-shopu. Obchodník ${t.quote === 1 ? "ji" : "je"} doplní do potvrzení.</span></div>` : ""}
    ${cta}${extra}`;
}
function quoteSummaryHtml(t, cta, extra = "") {
  return `<h2>Poptávka</h2><dl>
    <div><dt>Položky</dt><dd>${pl(t.n)}, ${t.items} ks</dd></div>
    ${t.volDisc ? `<div><dt>Dle ceníku</dt><dd>${czk(t.list)}</dd></div><div><dt>Množstevní sleva</dt><dd style="color:var(--red)">−${czk(t.volDisc)}</dd></div>` : ""}
    <div class="total"><dt>Orientačně bez DPH a dopravy</dt><dd><span class="price">${czk(t.net)}</span></dd></div></dl>
    <div class="note-box">${icon("info")}<span>Konečné ceny, slevy a termíny dodání vám potvrdí obchodník v nabídce.${t.quote ? ` U ${pl(t.quote, "položky", "položek", "položek")} bez ceny je doplní.` : ""}</span></div>
    ${cta}${extra}`;
}
function initCart() {
  const root = $("[data-cart-lines]");
  if (!root) return;
  const sum = $("[data-cart-summary]");
  function draw() {
    const cus = isCustomer();
    const lines = cart.all();
    const t = cart.totals(lines);
    if (!lines.length) {
      root.innerHTML = `<div class="empty-state"><h3>${cus ? "Košík je prázdný" : "Poptávka je zatím prázdná"}</h3><p>Vyhledejte produkt podle kódu, nebo vložte celý seznam kódů z Excelu níže.</p><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn primary" href="${url("katalog/index.html")}">Otevřít katalog</a><a class="btn" href="${url("rychla-objednavka.html")}">${cus ? "Rychlá objednávka" : "Poptat podle kódů"}</a></div></div>`;
      sum.innerHTML = cus ? summaryHtml(t, { cta: `<a class="btn primary lg wide" aria-disabled="true">Pokračovat k objednávce</a>` }) : quoteSummaryHtml(t, `<a class="btn primary lg wide" aria-disabled="true">Pokračovat k odeslání</a>`);
      return;
    }
    root.innerHTML = cartRows(lines) + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px" class="noprint"><button class="btn quiet sm" type="button" data-save-list>${icon("bookmark")} Uložit jako seznam</button><button class="btn quiet sm" type="button" data-print-quote>${icon("print")} Vytisknout</button><button class="btn quiet sm" type="button" data-clear>${icon("trash")} Vyprázdnit</button></div>`;
    if (cus) {
      const allQuote = t.quote === t.n;
      sum.innerHTML = summaryHtml(t, {
        cta: `<a class="btn primary lg wide" href="${url("objednavka.html")}">${allQuote ? "Pokračovat k poptávce" : "Pokračovat k objednávce"}</a>${allQuote ? "" : `<a class="btn wide" href="${url("objednavka.html?poptavka=1")}">Poslat jako poptávku</a>`}`,
        extra: `<p class="small">Ceny pro ${esc(user().company.replace(/\.$/, ""))}. Větší množství nebo projekt? Pošlete košík jako poptávku a obchodník připraví nabídku.</p>`,
      });
    } else {
      sum.innerHTML = quoteSummaryHtml(t, `<a class="btn primary lg wide" href="${url("objednavka.html")}">Pokračovat k odeslání</a>`,
        `<p class="small">Máte firemní účet? <a href="${url("ucet.html")}">Přihlaste se</a> a objednejte rovnou za své ceny. Nemáte? <a href="${url("ucet.html#registrace")}">Požádejte o něj</a>.</p>`);
    }
  }
  // a re-render (new quantity, removed line) keeps keyboard focus on the same control of the same line, or the nearest line
  function render() {
    const a = document.activeElement, tr = root.contains(a) && a.closest("tr[data-id]");
    const sel = tr && ["[data-step='-1']", "[data-step='1']", "[data-line-q]", "[data-line-note]", "[data-rm]"].find((s) => a.matches(s));
    const at = tr ? $$("tr[data-id]", root).indexOf(tr) : -1;
    draw();
    if (!tr) return;
    const rows = $$("tr[data-id]", root);
    const row = rows.find((r) => r.dataset.id === tr.dataset.id) || rows[Math.min(at, rows.length - 1)];
    ((row && sel && $(sel, row)) || $("a, button", root))?.focus();
  }
  render();
  root.addEventListener("change", (ev) => {
    // re-render after Tab has moved focus on (change fires during blur), so focus can be kept
    const i = ev.target.closest("[data-line-q]"); if (i) { cart.set(+i.dataset.lineQ, +i.value || 1); setTimeout(render); }
    const n = ev.target.closest("[data-line-note]"); if (n) cart.note(+n.dataset.lineNote, n.value.trim());
  });
  root.addEventListener("click", (ev) => {
    const rm = ev.target.closest("[data-rm]");
    if (rm) { cart.remove(+rm.dataset.rm); render(); toast("Položka odebrána."); }
    const no = ev.target.closest("[data-note-open]");
    if (no) { const inp = no.nextElementSibling; inp.hidden = false; no.remove(); inp.focus(); }
    if (ev.target.closest("[data-clear]")) { cart.save([]); render(); }
    if (ev.target.closest("[data-print-quote]")) print();
    if (ev.target.closest("[data-save-list]")) {
      const lists = store.get("lists", [{ name: "Oblíbené", items: {} }]);
      const name = `${isCustomer() ? "Košík" : "Poptávka"} ${new Date().toLocaleDateString("cs-CZ")}`;
      lists.push({ name, items: Object.fromEntries(cart.all().map((l) => [l.id, l.q])) });
      store.set("lists", lists);
      toast(`Uloženo jako „${esc(name)}“. <a href="${url("ucet.html#seznamy")}" style="color:#fff">Seznamy</a>`);
    }
  });
  bc?.addEventListener("message", render);
  // paste codes
  const msg = $("[data-paste-msg]");
  async function addLines(text) {
    const { rows } = await getIndex();
    const byCode = new Map(rows.map((r) => [compact(r.c), r]));
    let ok = 0; const miss = [];
    for (const raw of text.split(/\r?\n/)) {
      const [code, qs] = raw.split(/[;\t,]/).map((s) => s?.trim());
      if (!code) continue;
      const p = byCode.get(compact(code));
      if (p) { cart.add(p, Math.max(1, parseInt(qs) || 1)); ok++; } else miss.push(code);
    }
    render();
    msg.innerHTML = `${ok ? `Přidáno: ${pl(ok)}.` : ""} ${miss.length ? `Nenašli jsme: <b>${miss.map(esc).join(", ")}</b>. Doplňte je v <a href="${url("rychla-objednavka.html")}">rychlé objednávce</a> jako poptávku.` : ""}`;
  }
  $("[data-paste-add]")?.addEventListener("click", () => addLines($("[data-paste-text]").value));
  $("[data-csv]")?.addEventListener("change", async (ev) => { const f = ev.target.files[0]; if (f) addLines(await f.text()); });
}

/* ---------------- company lookup (ARES) ---------------- */
function icoValid(ico) {
  if (!/^\d{8}$/.test(ico)) return false;
  let s = 0;
  for (let i = 0; i < 7; i++) s += +ico[i] * (8 - i);
  const c = (11 - (s % 11)) % 10;
  return c === +ico[7];
}
function bindAres(form) {
  const msg = $("[data-ares-msg]", form);
  if (!msg || !form.ico) return;
  const acct = user();
  if (acct?.ico) { form.ico.readOnly = true; msg.innerHTML = `${icon("check", "sm")} Údaje firmy jsou z vašeho firemního účtu.`; msg.className = "ares ok"; return; }
  msg.innerHTML = `<span class="muted">Vyzkoušejte třeba IČO 26290464.</span>`;
  async function ares() {
    const ico = form.ico.value.replace(/\s/g, "");
    if (!icoValid(ico)) { msg.className = "ares bad"; msg.innerHTML = `${icon("info", "sm")} Tohle IČO neprošlo kontrolou. Má 8 číslic a poslední je kontrolní.`; return; }
    msg.className = "ares"; msg.innerHTML = `<span class="spin" aria-hidden="true"></span> Hledám v ARES…`;
    try {
      const r = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      form.company.value = d.obchodniJmeno || "";
      form.street.value = (d.sidlo?.textovaAdresa || "").replace(/\b(\d{3})(\d{2})\b/, "$1 $2");
      if (form.dic) form.dic.value = d.dic || "";
      msg.className = "ares ok"; msg.innerHTML = `${icon("check", "sm")} Načteno z ARES: ${esc(d.obchodniJmeno)}`;
    } catch (e) {
      msg.className = "ares bad"; msg.innerHTML = `${icon("info", "sm")} ARES teď neodpovídá. Údaje vyplňte ručně.`;
    }
  }
  $("[data-ares]", form)?.addEventListener("click", ares);
  form.ico.addEventListener("input", () => { if (/^\d{8}$/.test(form.ico.value)) ares(); });
}

/* sales inbox: what lands at REM's sales team (demo, stored in this browser) */
const inbox = {
  all: () => store.get("inbox", []),
  add(entry) { store.set("inbox", [entry, ...inbox.all()]); },
  save(list) { store.set("inbox", list); },
};
const docNo = (prefix) => `${prefix}-2026-${String(Math.floor(10000 + Math.random() * 89999))}`;

/* ---------------- checkout ---------------- */
function initCheckout() {
  const form = $("[data-checkout]");
  if (!form) return;
  const sum = $("[data-co-summary]");
  const u = user();
  const quoteMode = !u || new URLSearchParams(location.search).has("poptavka");
  const payPanel = $("[data-pay-panel]", form);
  if (quoteMode) {
    payPanel.hidden = true;
    $$("input[name=pay]", form).forEach((i) => (i.disabled = true));
    $("[data-ship-title]", form).textContent = "Preferovaná doprava";
    $('label[for="po"]', form).innerHTML = 'Vaše interní číslo <span class="muted" style="font-weight:400">(nepovinné)</span>';
    $('label[for="email"]', form).textContent = "E-mail, kam pošleme nabídku";
    document.title = "Odeslat poptávku | REM-Technik";
  }
  if (u) {
    form.name.value ||= u.name; form.email.value ||= u.email; form.company.value ||= u.company;
    for (const k of ["ico", "dic", "street", "tel"]) if (u[k] && form[k]) form[k].value = u[k];
    if (!quoteMode) { $('input[value="invoice"]', form).checked = true; $("[data-invoice-note]").textContent = `Pro ${u.company} je nákup na fakturu povolený.`; }
  } else $('input[value="invoice"]', form).disabled = true;
  bindAres(form);
  // draft: keep what was typed if the visitor leaves and comes back
  const draftKeys = ["ico", "company", "street", "dic", "po", "name", "tel", "email", "shipaddr", "due", "note"];
  const draft = store.get("coDraft", {});
  for (const k of draftKeys) if (draft[k] && form[k] && !form[k].value) form[k].value = draft[k];
  if (draft.ship) { const r = $(`input[name=ship][value="${draft.ship}"]`, form); if (r) r.checked = true; }
  form.addEventListener("input", () => {
    const d = Object.fromEntries(draftKeys.map((k) => [k, form[k]?.value || ""]));
    d.ship = $('input[name="ship"]:checked', form)?.value;
    store.set("coDraft", d);
  });
  // buying without a company ID (quote requests only)
  const noico = $("[data-noico]", form);
  const companyBits = [form.ico.closest(".ico-row"), $("[data-ares-msg]", form), form.dic.closest(".field"), form.street.closest(".field")];
  function syncNoIco() {
    const on = quoteMode && !u && noico.checked;
    companyBits.forEach((el) => (el.hidden = on));
    form.ico.required = form.street.required = form.company.required = !on;
    $('label[for="company"]', form).innerHTML = on ? 'Firma <span class="muted" style="font-weight:400">(nepovinné)</span>' : "Název firmy";
    steps();
  }
  if (!quoteMode || u) noico.closest("label").hidden = true;
  noico.addEventListener("change", syncNoIco);
  // attachments (names only in the demo)
  const filesIn = $("[data-files]", form);
  filesIn.addEventListener("change", () => { $("[data-files-list]", form).textContent = [...filesIn.files].map((f) => f.name).join(", "); });
  // step bar with live completion
  const stepsEl = $("[data-co-steps]", form);
  function sectionDone(sec) {
    const req = $$("input[required], textarea[required], select[required]", sec).filter((i) => !i.closest("[hidden]") && !i.disabled);
    const radiosOk = [...new Set($$("input[type=radio]", sec).filter((r) => !r.disabled).map((r) => r.name))].every((n) => $(`input[name="${n}"]:checked`, sec));
    return req.every((i) => i.checkValidity()) && radiosOk;
  }
  function steps() {
    const secs = $$("section.panel[data-step-name]", form).filter((s) => !s.hidden);
    let current = false, chain = true;
    stepsEl.innerHTML = secs.map((s, k) => {
      const done = chain && sectionDone(s); // a later step only counts once the ones before it are done
      chain = done;
      const cur = !done && !current; if (cur) current = true;
      return `<li class="${done ? "done" : ""}${cur ? " current" : ""}"><a href="#${s.id}"${cur ? ' aria-current="step"' : ""}><span class="n">${done ? icon("check", "sm") : k + 1}</span><span>${esc(s.dataset.stepName)}</span></a></li>`;
    }).join("");
  }
  form.addEventListener("input", steps);
  form.addEventListener("change", steps);
  syncNoIco();
  function render() {
    const lines = cart.all();
    const t = cart.totals(lines);
    const ship = +($('input[name="ship"]:checked', form)?.dataset.cost || 0);
    const allQuote = quoteMode || t.quote === t.n;
    $("[data-co-title]").textContent = allQuote ? "Odeslat poptávku" : "Objednávka";
    if (!lines.length) {
      sum.innerHTML = `<h2>Souhrn</h2><p class="muted">${quoteMode ? "Poptávka je prázdná." : "Košík je prázdný."}</p><a class="btn primary wide" href="${url("katalog/index.html")}">Otevřít katalog</a>`;
      return;
    }
    const mini = `<ul style="list-style:none;display:grid;gap:10px;border-bottom:1px solid var(--line);padding-bottom:14px;max-height:280px;overflow:auto">${lines.map((l) => `<li style="display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;font-size:14px"><img src="${url(l.img)}" alt="" width="44" height="44" style="object-fit:contain"><span><b>${l.q}×</b> ${esc(l.n)}<br><span class="muted">${esc(l.c)}</span></span><span class="num">${l.pr == null ? "na dotaz" : czk(unitPrice(l, l.q) * l.q)}</span></li>`).join("")}</ul>`;
    const terms = `<p class="small">Odesláním souhlasíte se <a href="${url("ochrana-osobnich-udaju.html")}">zpracováním údajů</a>${quoteMode ? ". Poptávka je nezávazná." : ` a s <a href="${url("obchodni-podminky.html")}">obchodními podmínkami</a>. Objednávka zavazuje k platbě.`}</p>`;
    const edit = `<a class="small" href="${url("kosik.html")}">Upravit ${quoteMode ? "poptávku" : "košík"}</a>`;
    if (quoteMode) sum.innerHTML = quoteSummaryHtml(t, `<button class="btn primary lg wide" type="submit">Odeslat poptávku</button>${terms}`).replace("<h2>Poptávka</h2>", `<div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Poptávka</h2>${edit}</div>${mini}`);
    else sum.innerHTML = summaryHtml(t, { ship, cta: `<button class="btn primary lg wide" type="submit">${t.quote ? "Objednat a poptat zbytek" : "Odeslat objednávku"}</button>${terms}` }).replace("<h2>Souhrn</h2>", `<div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Souhrn</h2>${edit}</div>${mini}`);
    const bar = $("[data-co-bar]", form);
    bar.hidden = false;
    $("[data-co-bar-label]", bar).textContent = quoteMode ? "Orientačně bez DPH" : "Celkem s DPH";
    $("[data-co-bar-total]", bar).textContent = czk(quoteMode ? t.net : (t.net + ship) * (1 + VAT));
    $("[data-co-bar-btn]", bar).textContent = quoteMode ? "Odeslat poptávku" : "Odeslat objednávku";
    steps();
  }
  render();
  form.addEventListener("change", (ev) => { if (ev.target.name === "ship") render(); });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const lines = cart.all();
    if (!lines.length) return;
    if (!form.checkValidity()) {
      syncInvalid(form);
      const bad = $$("input, textarea, select", form).filter((i) => !i.disabled && !i.closest("[hidden]") && !i.checkValidity());
      const es = $("[data-err-summary]", form);
      es.innerHTML = `<strong>Než odešlete, doplňte prosím:</strong><ul>${bad.map((i) => `<li><a href="#${i.id}">${esc(($(`label[for="${i.id}"]`, form)?.childNodes[0]?.textContent || i.name).trim())}</a></li>`).join("")}</ul>`;
      es.hidden = false;
      es.focus();
      es.scrollIntoView({ block: "center", behavior: "smooth" });
      bad.forEach((i) => i.classList.add("touched"));
      return;
    }
    $("[data-err-summary]", form).hidden = true;
    const t = cart.totals(lines);
    const ship = $('input[name="ship"]:checked', form);
    const pay = $('input[name="pay"]:checked', form);
    const isQuote = quoteMode || t.quote === t.n;
    const no = docNo(isQuote ? "POP" : "OBJ");
    const label = (el) => el?.closest("label")?.querySelector("strong")?.textContent || "";
    const entry = {
      no, type: isQuote ? "poptavka" : "objednavka", date: new Date().toISOString(), status: "Nová",
      ico: form.ico.value, dic: form.dic.value, company: form.company.value, street: form.street.value,
      name: form.name.value, email: form.email.value, tel: form.tel.value, po: form.po.value,
      ship: label(ship), pay: isQuote ? "" : label(pay), due: form.due.value, note: form.note.value,
      shipaddr: form.shipaddr?.value || "", customer: !!u, level: u?.level || "", files: [...(filesIn.files || [])].map((f) => f.name), noico: noico.checked,
      lines: lines.map((l) => ({ ...l, unit: unitPrice(l, l.q), vol: tierPct(l, l.q) })),
      list: t.list, net: t.net + (isQuote ? 0 : +(ship?.dataset.cost || 0)),
    };
    inbox.add(entry);
    store.set("coDraft", {});
    if (u) store.set("orders", [{ no, date: entry.date, lines, net: entry.net, quote: t.quote, company: entry.company, po: entry.po, status: isQuote ? "Poptávka odeslána" : "Přijatá" }, ...store.get("orders", [])]);
    cart.save([]);
    form.hidden = true;
    const done = $("[data-co-done]");
    done.hidden = false;
    done.innerHTML = `<div class="panel" style="max-width:760px"><div class="ok" style="display:flex;gap:10px;align-items:center;color:var(--green);font-weight:700">${icon("check", "lg")} ${isQuote ? "Poptávka odeslána" : "Objednávka přijata"}</div>
      <h2 style="font-size:34px">${no}</h2>
      <p>${isQuote ? `Obchodník vám pošle nabídku s cenami a termíny dodání na <b>${esc(form.email.value)}</b>.` : `Potvrzení s termíny dodání posíláme na <b>${esc(form.email.value)}</b>.${form.po.value ? ` Vaše číslo objednávky ${esc(form.po.value)} uvedeme na faktuře.` : ""}`}</p>
      <ol style="padding-left:22px;display:grid;gap:6px">${isQuote
        ? `<li>Obchodník poptávku zkontroluje.</li><li>Připraví nabídku s cenami, slevami a termíny dodání.</li><li>Nabídku potvrdíte e-mailem${u ? " nebo ve firemním účtu" : ""}.</li>`
        : `<li>Obchodník objednávku zkontroluje a potvrdí termín dodání.</li><li>${t.quote ? "Položky bez ceny doplní do potvrzení." : "Skladové položky připravíme k odeslání."}</li><li>Fakturu a dodací list najdete ve firemním účtu.</li>`}</ol>
      ${!u ? `<p>Chcete příště objednávat rovnou za své ceny? <a href="${url("ucet.html#registrace")}">Požádejte o firemní účet</a>.</p>` : ""}
      <div class="note-box">${icon("info")}<span>Ukázka: ${isQuote ? "poptávka" : "objednávka"} zůstala jen ve vašem prohlížeči. Podívejte se, jak dorazila k obchodníkovi.</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn primary" href="${url("obchodnik.html")}#${no}">Zobrazit pohled obchodníka</a>${u ? `<a class="btn" href="${url("ucet.html#objednavky")}">Zobrazit v účtu</a>` : ""}<a class="btn" href="${url("index.html")}">Pokračovat na web</a></div></div>`;
    $("[data-co-title]").textContent = "Hotovo";
    const lead = $("[data-co-lead]"); if (lead) lead.hidden = true;
    scrollTo({ top: 0, behavior: "smooth" });
  });
}

/* ---------------- account ---------------- */
function initAccount() {
  const root = $("[data-account-root]");
  if (!root) return;
  function render() {
    const u = user();
    if (!u) {
      const reg = store.get("reg", null);
      const pending = reg?.status === "pending";
      root.innerHTML = `<div class="pagehead"><div><h1>Firemní účet</h1><p>Vaše ceny podle ceníku u každého výrobce, nákup na fakturu, historie objednávek a nákupní seznamy pro celý tým.</p></div></div>
      ${pending ? `<div class="panel" style="margin-bottom:24px;border-color:var(--ink)"><h2>Žádost odeslána: ${esc(reg.company)}</h2>
        <p>Obchodník vaši firmu ověří a přidělí vám ceník. Přihlašovací údaje pošleme na <b>${esc(reg.email)}</b>. Mezitím můžete posílat poptávky jako dosud.</p>
        <div class="note-box">${icon("info")}<span>Ukázka: žádost teď čeká v pohledu obchodníka. Tam jí přidělíte slevy po výrobcích a schválíte ji.</span></div>
        <div><a class="btn primary" href="${url("obchodnik.html#ucty")}">Schválit žádost jako obchodník</a></div></div>` : ""}
      <div class="split">
        <form class="panel" data-login novalidate><h2>Přihlášení</h2>
          <div class="field"><label for="l-email">E-mail</label><input class="input" id="l-email" name="email" type="email" autocomplete="username" required><span class="err">${icon("info", "sm")} Zadejte e-mail.</span></div>
          <div class="field"><label for="l-pw">Heslo</label><input class="input" id="l-pw" name="pw" type="password" autocomplete="current-password" required><span class="err">${icon("info", "sm")} Zadejte heslo.</span></div>
          <button class="btn primary" type="submit" style="justify-self:start">Přihlásit</button>
          <div class="note-box">${icon("info")}<span>V ukázce se přihlásíte jakýmkoli e-mailem a heslem, nebo rovnou: <button class="linkbtn" type="button" data-demo>přihlásit ukázkový účet</button>.</span></div></form>
        ${pending ? `<div class="help"><h2>Co firemní účet umí</h2><ul class="prose" style="padding-left:20px"><li>Vaše ceny podle ceníku u každého výrobce</li><li>Objednávka rovnou, firmám na fakturu</li><li>Historie objednávek a opakování</li><li>Nákupní seznamy pro údržbu a opakované zakázky</li></ul></div>` : ""}
        <form class="panel" id="registrace" data-register novalidate ${pending ? "hidden" : ""}><h2>Požádat o firemní účet</h2>
          <p class="muted">Účty schvaluje obchodní oddělení. Po schválení uvidíte v katalogu své ceny a objednáte rovnou.</p>
          <div class="ico-row"><div class="field"><label for="r-ico">IČO</label><input class="input" id="r-ico" name="ico" inputmode="numeric" pattern="\\d{8}" maxlength="8" required autocomplete="off" placeholder="8 číslic"><span class="err">${icon("info", "sm")} Vyplňte IČO, 8 číslic.</span></div><button class="btn" type="button" data-ares>Načíst z ARES</button></div>
          <div class="ares" data-ares-msg aria-live="polite"></div>
          <div class="formgrid">
            <div class="field full"><label for="r-company">Název firmy</label><input class="input" id="r-company" name="company" required autocomplete="organization"><span class="err">${icon("info", "sm")} Vyplňte název firmy.</span></div>
            <div class="field full"><label for="r-street">Sídlo</label><input class="input" id="r-street" name="street" required autocomplete="street-address"><span class="err">${icon("info", "sm")} Vyplňte sídlo.</span></div>
            <div class="field"><label for="r-dic">DIČ <span class="muted" style="font-weight:400">(nepovinné)</span></label><input class="input" id="r-dic" name="dic"></div>
            <div class="field"><label for="r-name">Jméno a příjmení</label><input class="input" id="r-name" name="name" required autocomplete="name"><span class="err">${icon("info", "sm")} Vyplňte jméno.</span></div>
            <div class="field"><label for="r-email">Pracovní e-mail</label><input class="input" id="r-email" name="email" type="email" required autocomplete="email"><span class="err">${icon("info", "sm")} Zadejte e-mail.</span></div>
            <div class="field"><label for="r-tel">Telefon</label><input class="input" id="r-tel" name="tel" type="tel" autocomplete="tel"></div>
            <div class="field full"><label for="r-what">Co u nás nakupujete <span class="muted" style="font-weight:400">(nepovinné)</span></label><input class="input" id="r-what" name="what" placeholder="Např. bezpečnostní relé REER, PLC IDEC pro údržbu"></div>
          </div>
          <button class="btn primary" type="submit" style="justify-self:start">Odeslat žádost</button>
        </form>
      </div>`;
      const login = (email) => { store.set("user", { ...DEMO_USER, email: email || DEMO_USER.email }); seedOrders(); render(); renderHeader(); applyPrices(); toast("Jste přihlášeni. Ceny v katalogu jsou teď vaše."); };
      $("[data-demo]", root).addEventListener("click", () => login());
      $("[data-login]", root).addEventListener("submit", (ev) => { ev.preventDefault(); const f = ev.target; if (!f.checkValidity()) { f.reportValidity(); return; } login(f.email.value); });
      const rf = $("[data-register]", root);
      bindAres(rf);
      rf.addEventListener("submit", (ev) => {
        ev.preventDefault();
        if (!rf.checkValidity()) { rf.reportValidity(); syncInvalid(rf); return; }
        const r = { id: docNo("REG"), status: "pending", date: new Date().toISOString(), ico: rf.ico.value, dic: rf.dic.value, company: rf.company.value, street: rf.street.value, name: rf.name.value, email: rf.email.value, tel: rf.tel.value, what: rf.what.value };
        store.set("reg", r);
        store.set("regs", [r, ...store.get("regs", []).filter((x) => x.id !== r.id)]);
        renderHeader();
        render();
        scrollTo({ top: 0, behavior: "smooth" });
      });
      if (location.hash === "#registrace") setTimeout(() => rf.scrollIntoView({ block: "start" }), 50);
      return;
    }
    const orders = store.get("orders", []);
    const lists = store.get("lists", [{ name: "Oblíbené", items: {} }]);
    const tab = ["prehled", "objednavky", "seznamy", "cenik"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "prehled";
    const tabs = [["prehled", "Přehled"], ["objednavky", `Objednávky (${orders.length})`], ["seznamy", `Nákupní seznamy (${lists.length})`], ["cenik", "Můj ceník"]];
    root.innerHTML = `<div class="pagehead"><div><h1>${esc(u.company)}</h1><p>${esc(u.name)}, ${esc(u.email)}</p></div><button class="btn" type="button" data-logout>${icon("logout")} Odhlásit</button></div>
      <div class="tabs" role="tablist">${tabs.map(([k, n]) => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${n}</button>`).join("")}</div><div data-tabpanel role="tabpanel"></div>`;
    const panel = $("[data-tabpanel]", root);
    getIndex().then(({ byId }) => {
      if (tab === "prehled") {
        const last = orders[0];
        panel.innerHTML = `<div class="acc-grid"><div class="acc-card"><span class="co">${esc(u.company)}</span><div class="kv"><span>Ceník</span>${esc(u.level)}</div><div class="kv"><span>Platba</span>Faktura, splatnost 14 dní</div><div class="kv"><span>Obchodník</span>+420 548 140 000</div><span class="badge" style="justify-self:start">Ukázka</span></div>
        <div style="display:grid;gap:20px;align-content:start"><div class="facts"><div><strong>${orders.length}</strong><span>${orders.length === 1 ? "objednávka" : orders.length >= 2 && orders.length <= 4 ? "objednávky" : "objednávek"}</span></div><div><strong>${czk(orders.reduce((s, o) => s + o.net, 0))}</strong><span>odebráno bez DPH</span></div><div><strong>${Object.keys(lists[0]?.items || {}).length}</strong><span>položek v oblíbených</span></div></div>
        ${last ? `<div class="panel"><h2>Poslední objednávka ${esc(last.no)}</h2>${cartRows(last.lines, false)}<div><button class="btn primary" type="button" data-reorder="0">${icon("repeat")} Objednat znovu</button></div></div>` : ""}</div></div>`;
      } else if (tab === "objednavky") {
        panel.innerHTML = orders.length ? `<div class="scroll-x"><table class="ptable orders keep"><thead><tr><th>Číslo</th><th>Datum</th><th>Položek</th><th>Vaše č. obj.</th><th>Stav</th><th style="text-align:right">Bez DPH</th><th></th></tr></thead><tbody>${orders.map((o, i) => `<tr><td><b>${esc(o.no)}</b>${o.demo ? ' <span class="badge">ukázka</span>' : ""}</td><td>${new Date(o.date).toLocaleDateString("cs-CZ")}</td><td>${o.lines.length}</td><td>${esc(o.po || "–")}</td><td><span class="status ${o.status === "Vyřízená" ? "done" : "new"}">${esc(o.status)}</span></td><td style="text-align:right" class="num">${czk(o.net)}</td><td style="text-align:right;white-space:nowrap"><button class="btn sm" type="button" data-reorder="${i}">${icon("repeat")} Znovu</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><h3>Zatím žádné objednávky</h3><p>Objednávky z e-shopu i od obchodníka se tu zobrazí s fakturami.</p><a class="btn primary" href="${url("katalog/index.html")}">Otevřít katalog</a></div>`;
      } else if (tab === "seznamy") {
        panel.innerHTML = lists.map((l, li) => {
          const items = Object.entries(l.items).map(([id, q]) => ({ ...byId.get(+id), q })).filter((x) => x.id);
          return `<div class="panel"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><h2>${esc(l.name)} <span class="count">${items.length}</span></h2>${items.length ? `<button class="btn primary sm" type="button" data-list-cart="${li}">${icon("cart")} Vše do košíku</button>` : ""}</div>
          ${items.length ? cartRows(items.map((x) => ({ ...x, u: x.u, img: x.img })), false) : `<p class="muted">Seznam je prázdný. Na stránce produktu použijte „Uložit do seznamu“.</p>`}</div>`;
        }).join("");
      } else {
        const rows = Object.entries(u.disc).map(([b, d]) => `<tr><th scope="row">${b === "_" ? "Ostatní výrobci" : esc(b)}</th><td>${d} %</td></tr>`).join("");
        panel.innerHTML = `<div class="split"><div><table class="spec"><tbody>${rows}</tbody></table></div><div class="note-box">${icon("info")}<span>Slevy z ceníkových cen platí automaticky v celém katalogu, v košíku i v rychlé objednávce. V ukázce jsou slevy smyšlené.</span></div></div>`;
      }
      applyPrices(panel);
    });
    $("[data-logout]", root).addEventListener("click", () => { store.set("user", null); render(); renderHeader(); applyPrices(); });
    $$("[data-tab]", root).forEach((b) => b.addEventListener("click", () => { history.replaceState(null, "", "#" + b.dataset.tab); render(); }));
    root.onclick = async (ev) => {
      const r = ev.target.closest("[data-reorder]");
      const lc = ev.target.closest("[data-list-cart]");
      if (r) { const o = store.get("orders", [])[+r.dataset.reorder]; const { byId } = await getIndex(); o.lines.forEach((l) => byId.get(l.id) && cart.add(byId.get(l.id), l.q)); toast(`Položky z ${esc(o.no)} jsou v košíku. <a href="${url("kosik.html")}" style="color:#fff">Zobrazit košík</a>`); }
      if (lc) { const l = store.get("lists", [])[+lc.dataset.listCart]; const { byId } = await getIndex(); Object.entries(l.items).forEach(([id, q]) => byId.get(+id) && cart.add(byId.get(+id), q)); toast(`Seznam „${esc(l.name)}“ je v košíku.`); }
    };
  }
  async function seedOrders() {
    if (store.get("orders", []).some((o) => o.demo)) return;
    const { byId } = await getIndex();
    const mk = (pairs) => pairs.map(([id, q]) => { const p = byId.get(id); return p && { id: p.id, q, n: p.n, c: p.c, b: p.b, pr: p.pr, s: p.s, u: p.u, img: p.img }; }).filter(Boolean);
    const a = mk([[100, 20], [303, 2], [127, 4]]), b = mk([[281, 1], [246, 2]]);
    const net = (ls) => ls.reduce((s, l) => s + yourPrice(l.pr ?? 0, l.b) * l.q, 0);
    store.set("orders", [...store.get("orders", []),
      { no: "OBJ-2026-41877", date: "2026-10-02T09:12:00", lines: a, net: net(a), po: "ÚDRŽBA-2610", status: "Vyřízená", demo: true },
      { no: "OBJ-2026-39012", date: "2026-08-27T13:40:00", lines: b, net: net(b), po: "", status: "Vyřízená", demo: true }]);
    render();
  }
  addEventListener("hashchange", render);
  render();
}

/* ---------------- sales view (demo of REM's side) ---------------- */
const PRICE_LISTS = {
  "Ceník B2B 1, základní": { _: 3 },
  "Ceník B2B 2, stálý zákazník": { IDEC: 12, REER: 8, steute: 10, "VIPA YASKAWA": 7, Thermokon: 6, _: 5 },
  "Ceník B2B 3, integrátor / OEM": { IDEC: 18, REER: 14, steute: 15, "VIPA YASKAWA": 12, Thermokon: 10, _: 8 },
};
function selectlineCsv(e) {
  // Sample layout for a SelectLine document import; the real field mapping depends on REM's SelectLine version.
  const head = ["Doklad", "Cislo", "Datum", "ICO", "DIC", "Firma", "Kontakt", "Email", "Telefon", "CisloZakaznika", "Radek", "Kod", "Nazev", "Vyrobce", "Mnozstvi", "MJ", "CenikovaCena", "Sleva", "CenaZaJednotku", "Poznamka"];
  const num = (n) => (n == null ? "" : String(n).replace(".", ","));
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = e.lines.map((l, i) => [
    e.type === "poptavka" ? "Poptavka" : "Objednavka", e.no, e.date.slice(0, 10), e.ico, e.dic, e.company, e.name, e.email, e.tel, e.po,
    i + 1, l.c, l.n, l.b, l.q, "ks", num(l.pr), l.pr != null && l.unit != null && l.unit !== l.pr ? num(Math.round((1 - l.unit / l.pr) * 100)) : "", num(l.unit), [i === 0 && e.note, i === 0 && e.due && `Termin: ${e.due}`, l.note && `Polozka: ${l.note}`].filter(Boolean).join(" | "),
  ].map(q).join(";"));
  return "﻿" + [head.join(";"), ...rows].join("\r\n");
}
function mailText(e) {
  const lines = e.lines.map((l) => `  ${String(l.q).padStart(4)} ks  ${l.c}  ${l.n}${l.pr != null ? `  (ceník ${czk(l.pr).replace(" ", " ")})` : "  (cena na dotaz)"}${l.note ? `\n            poznámka: ${l.note}` : ""}`).join("\n");
  return `Předmět: ${e.type === "poptavka" ? "Nová poptávka" : "Nová objednávka"} ${e.no} – ${e.company}

Firma: ${e.company}, IČO ${e.ico}${e.dic ? `, DIČ ${e.dic}` : ""}
Sídlo: ${e.street}
Kontakt: ${e.name}, ${e.email}${e.tel ? `, ${e.tel}` : ""}
${e.po ? `Číslo zákazníka: ${e.po}\n` : ""}${e.ship ? `Doprava: ${e.ship}\n` : ""}${e.pay ? `Platba: ${e.pay}\n` : ""}${e.due ? `Požadovaný termín: ${e.due}\n` : ""}
Položky:
${lines}

${e.note ? `Poznámka: ${e.note}\n\n` : ""}${e.files?.length ? `Přílohy zákazníka: ${e.files.join(", ")}\n` : ""}Importní soubor pro SelectLine je v příloze.`;
}
function download(name, text, type = "text/csv;charset=utf-8") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function seedInbox() {
  if (inbox.all().length) return;
  const { byId } = await getIndex();
  const pick = [[100, 50], [303, 2], [2035, 1], [255, 1]].map(([id, q]) => { const p = byId.get(id); return p && { id: p.id, q, n: p.n, c: p.c, b: p.b, pr: p.pr, s: p.s, u: p.u, img: p.img, unit: p.pr }; }).filter(Boolean);
  const list = pick.reduce((s, l) => s + (l.pr ?? 0) * l.q, 0);
  inbox.save([{ no: "POP-2026-30418", type: "poptavka", date: "2026-10-22T08:41:00", status: "Nová", demo: true, ico: "", dic: "", company: "Ukázková strojírna s.r.o.", street: "Průmyslová 1, Brno", name: "Petra Ukázková", email: "nakup@ukazka.cz", tel: "+420 600 000 000", po: "", ship: "Kurýr PPL", pay: "", due: "", note: "Potřebujeme do konce měsíce. U světelné závory prosíme o variantu s výškou 910 mm.", lines: pick, list, net: list, customer: false }]);
}
function initSales() {
  const root = $("[data-sales-root]");
  if (!root) return;
  const tabsEl = $("[data-sales-tabs]");
  let open = location.hash.slice(1);
  async function render() {
    await seedInbox();
    const { rows, subs: subNames } = await getIndex();
    const items = inbox.all();
    const regs = store.get("regs", []);
    const tab = open === "slevy" ? "slevy" : open === "ucty" || regs.some((r) => r.id === open) ? "ucty" : "doklady";
    const newCount = items.filter((x) => x.status === "Nová").length;
    const pendCount = regs.filter((r) => r.status === "pending").length;
    tabsEl.innerHTML = `<button role="tab" aria-selected="${tab === "doklady"}" data-stab="doklady">Poptávky a objednávky${newCount ? ` (${newCount} nové)` : ""}</button><button role="tab" aria-selected="${tab === "ucty"}" data-stab="ucty">Žádosti o firemní účet${pendCount ? ` (${pendCount})` : ""}</button><button role="tab" aria-selected="${tab === "slevy"}" data-stab="slevy">Množstevní slevy</button>`;
    if (tab === "slevy") { root.innerHTML = tiersAdmin(rows, subNames); bindTiers(); return; }
    if (tab === "doklady") {
      const e = items.find((x) => x.no === open);
      if (e) { root.innerHTML = docDetail(e); return; }
      root.innerHTML = `<table class="ptable inbox"><thead><tr><th>Číslo</th><th>Typ</th><th>Firma</th><th>Datum</th><th>Položek</th><th style="text-align:right">Hodnota bez DPH</th><th>Stav</th></tr></thead><tbody>
        ${items.map((x) => `<tr tabindex="0" data-open="${esc(x.no)}"><td><b>${esc(x.no)}</b>${x.demo ? ' <span class="badge">ukázka</span>' : ""}</td><td>${x.type === "poptavka" ? "Poptávka" : "Objednávka"}${x.customer ? `<div class="muted" style="font-size:13px">firemní účet</div>` : ""}</td><td>${esc(x.company)}${x.ico ? `<div class="muted" style="font-size:13px">IČO ${esc(x.ico)}</div>` : ""}</td><td>${new Date(x.date).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</td><td>${pl(x.lines.length)}</td><td style="text-align:right" class="num">${czk(x.net)}${x.type === "poptavka" ? `<div class="muted" style="font-size:13px">orientačně</div>` : ""}</td><td><span class="status ${x.status === "Nová" ? "new" : "done"}">${esc(x.status)}</span></td></tr>`).join("")}</tbody></table>
        <p class="muted" style="margin-top:14px">Nové poptávky a objednávky z webu. Kliknutím otevřete detail, stáhnete importní soubor pro SelectLine nebo text e-mailu.</p>`;
    } else {
      const r = regs.find((x) => x.id === open);
      if (r) { root.innerHTML = regDetail(r, rows); bindReg(r); return; }
      root.innerHTML = regs.length ? `<table class="ptable inbox"><thead><tr><th>Firma</th><th>IČO</th><th>Kontakt</th><th>Datum</th><th>Stav</th></tr></thead><tbody>
        ${regs.map((x) => `<tr tabindex="0" data-open="${esc(x.id)}"><td><b>${esc(x.company)}</b>${x.what ? `<div class="muted" style="font-size:13px">${esc(x.what)}</div>` : ""}</td><td>${esc(x.ico)}</td><td>${esc(x.name)}<div class="muted" style="font-size:13px">${esc(x.email)}</div></td><td>${new Date(x.date).toLocaleDateString("cs-CZ")}</td><td><span class="status ${x.status === "pending" ? "new" : "done"}">${x.status === "pending" ? "Čeká na schválení" : `Schváleno, ${esc(x.level || "")}`}</span></td></tr>`).join("")}</tbody></table>`
        : `<div class="empty-state"><h3>Zatím žádné žádosti o účet</h3><p>Vyplňte žádost na stránce Firemní účet. Objeví se tady a vy jí přidělíte ceník.</p><a class="btn primary" href="${url("ucet.html#registrace")}">Požádat o firemní účet</a></div>`;
    }
  }
  function docDetail(e) {
    const lineNet = (l) => (l.unit ?? l.pr ?? 0) * l.q;
    const total = e.lines.reduce((s, l) => s + lineNet(l), 0);
    const listSum = e.lines.reduce((s, l) => s + (l.pr ?? 0) * l.q, 0);
    const shipCost = Math.max(0, Math.round(e.net - total));
    const open = e.lines.filter((l) => l.pr == null).length;
    return `<p><button class="linkbtn" type="button" data-back>Zpět na seznam</button></p>
      <div class="pagehead" style="padding-top:12px"><div><h2 style="font-size:34px">${e.type === "poptavka" ? "Poptávka" : "Objednávka"} ${esc(e.no)}</h2><p>${new Date(e.date).toLocaleString("cs-CZ")}${e.customer ? `, firemní účet, ${esc(e.level)}` : ", bez účtu"}</p></div><span class="status ${e.status === "Nová" ? "new" : "done"}">${esc(e.status)}</span></div>
      <div class="split" style="margin-bottom:28px">
        <dl class="kv-grid"><dt>Firma</dt><dd>${esc(e.company)}</dd><dt>IČO / DIČ</dt><dd>${esc(e.ico || "–")} / ${esc(e.dic || "–")}</dd><dt>Sídlo</dt><dd>${esc(e.street || "–")}</dd><dt>Kontakt</dt><dd>${esc(e.name)}, ${esc(e.email)}${e.tel ? `, ${esc(e.tel)}` : ""}</dd>
        ${e.po ? `<dt>Číslo zákazníka</dt><dd>${esc(e.po)}</dd>` : ""}${e.ship ? `<dt>Doprava</dt><dd>${esc(e.ship)}</dd>` : ""}${e.pay ? `<dt>Platba</dt><dd>${esc(e.pay)}</dd>` : ""}${e.due ? `<dt>Požadovaný termín</dt><dd>${new Date(e.due).toLocaleDateString("cs-CZ")}</dd>` : ""}${e.note ? `<dt>Poznámka</dt><dd>${esc(e.note)}</dd>` : ""}${e.files?.length ? `<dt>Přílohy</dt><dd>${e.files.map(esc).join(", ")}</dd>` : ""}${e.noico ? `<dt>Zákazník</dt><dd>soukromá osoba, bez IČO</dd>` : ""}</dl>
        <div class="panel" style="align-content:start"><h3>Převzít do SelectLine</h3>
          <p class="muted" style="font-size:15px">Soubor obsahuje hlavičku dokladu a všechny řádky s kódy, množstvím a cenami. Obchodník ho naimportuje a z poptávky vytvoří nabídku.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-csv-dl>${icon("download")} Stáhnout pro SelectLine (CSV)</button><button class="btn" type="button" data-status>${e.type === "poptavka" ? (e.status === "Nová" ? "Označit: nabídka odeslána" : "Vrátit do nových") : e.status === "Nová" ? "Označit: potvrzeno" : "Vrátit do nových"}</button></div>
          <p class="small muted">Vzorový formát. Přesné mapování polí na import dokladů nastavíme podle vaší verze SelectLine; v ostrém provozu může doklad vznikat automaticky přes rozhraní SelectLine.</p>
          <details><summary class="linkbtn" style="display:inline">Zobrazit e-mail, který obchodník dostane</summary><pre class="mail" style="margin-top:12px">${esc(mailText(e))}</pre></details>
        </div>
      </div>
      <div class="scroll-x"><table class="ptable keep"><thead><tr><th>Kód</th><th>Název</th><th>Výrobce</th><th>Sklad</th><th style="text-align:right">Množství</th><th style="text-align:right">Ceník/ks</th><th style="text-align:right">${e.customer ? "Cena zákazníka/ks" : "Cena/ks"}</th><th style="text-align:right">Celkem</th></tr></thead><tbody>
        ${e.lines.map((l) => `<tr><td><b>${esc(l.c || "–")}</b></td><td><a href="${url(l.u)}">${esc(l.n)}</a>${l.note ? `<div class="muted" style="font-size:13px">Poznámka: ${esc(l.note)}</div>` : ""}${l.vol ? `<div class="muted" style="font-size:13px">množstevní sleva −${l.vol} %</div>` : ""}</td><td>${esc(l.b)}</td><td><span class="stock ${l.s}">${stockTxt(l.s)}</span></td><td style="text-align:right">${l.q} ks</td><td style="text-align:right" class="num">${l.pr == null ? "na dotaz" : czk(l.pr)}</td><td style="text-align:right" class="num">${l.pr == null ? "doplnit" : czk(l.unit ?? l.pr)}</td><td style="text-align:right" class="num"><b>${l.pr == null ? "doplnit" : czk(lineNet(l))}</b></td></tr>`).join("")}
      </tbody></table></div>
      <dl class="doc-sum">
        ${listSum !== total ? `<dt>Položky dle ceníku</dt><dd class="num">${czk(listSum)}</dd><dt>${e.customer ? "Slevy zákazníka a množstevní slevy" : "Množstevní slevy"}</dt><dd class="num">−${czk(listSum - total)}</dd>` : ""}
        ${shipCost ? `<dt>Doprava</dt><dd class="num">${czk(shipCost)}</dd>` : ""}
        <dt><b>Celkem bez DPH</b></dt><dd><span class="price" style="font-size:24px">${czk(total + shipCost)}</span></dd>
        ${open ? `<dt></dt><dd class="muted" style="font-size:14px">${open === 1 ? "1 položka" : `${open} položky`} bez ceny, doplní obchodník</dd>` : ""}
      </dl>`;
  }
  function regDetail(r, rows) {
    const brands = [...new Set(rows.map((p) => p.b).filter(Boolean))].sort((x, y) => rows.filter((p) => p.b === y).length - rows.filter((p) => p.b === x).length);
    const tpl = r.level && PRICE_LISTS[r.level] ? r.level : "Ceník B2B 2, stálý zákazník";
    const disc = r.disc || PRICE_LISTS[tpl];
    return `<p><button class="linkbtn" type="button" data-back>Zpět na seznam</button></p>
      <div class="pagehead" style="padding-top:12px"><div><h2 style="font-size:34px">${esc(r.company)}</h2><p>Žádost o firemní účet ${new Date(r.date).toLocaleString("cs-CZ")}</p></div><span class="status ${r.status === "pending" ? "new" : "done"}">${r.status === "pending" ? "Čeká na schválení" : "Schváleno"}</span></div>
      <div class="split">
        <dl class="kv-grid"><dt>IČO / DIČ</dt><dd>${esc(r.ico)} / ${esc(r.dic || "–")}</dd><dt>Sídlo</dt><dd>${esc(r.street)}</dd><dt>Kontakt</dt><dd>${esc(r.name)}, ${esc(r.email)}${r.tel ? `, ${esc(r.tel)}` : ""}</dd>${r.what ? `<dt>Nakupuje</dt><dd>${esc(r.what)}</dd>` : ""}</dl>
        <form class="panel" data-approve><h3>Přidělit ceník</h3>
          <div class="field"><label for="tpl">Výchozí ceník</label><select class="select" id="tpl" name="tpl">${Object.keys(PRICE_LISTS).map((k) => `<option${k === tpl ? " selected" : ""}>${k}</option>`).join("")}</select></div>
          <table class="disc-table"><thead><tr><th>Výrobce</th><th>Sleva z ceníku</th></tr></thead><tbody>
            ${brands.map((b) => `<tr><td>${esc(b)}</td><td><input class="input" type="number" min="0" max="50" step="1" name="d:${esc(b)}" value="${disc[b] ?? disc._ ?? 0}" aria-label="Sleva ${esc(b)} v procentech"> %</td></tr>`).join("")}
            <tr><td>Ostatní výrobci</td><td><input class="input" type="number" min="0" max="50" step="1" name="d:_" value="${disc._ ?? 0}" aria-label="Sleva ostatní výrobci v procentech"> %</td></tr>
          </tbody></table>
          <p class="small muted">V ostrém provozu se ceník přiřazuje v SelectLine a web ho jen čte. Tady ho nastavíte ručně pro ukázku.</p>
          <button class="btn primary" type="submit" style="justify-self:start">${r.status === "pending" ? "Schválit a přidělit ceník" : "Uložit ceník"}</button>
          <div class="note-box">${icon("info")}<span>V ukázce se schválením zároveň přihlásíte jako tento zákazník, abyste viděli jeho ceny v katalogu.</span></div>
        </form>
      </div>`;
  }
  function bindReg(r) {
    const f = $("[data-approve]", root);
    f.tpl.addEventListener("change", () => {
      const d = PRICE_LISTS[f.tpl.value];
      for (const inp of $$("input[name^='d:']", f)) { const b = inp.name.slice(2); inp.value = d[b] ?? d._ ?? 0; }
    });
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const disc = {};
      for (const inp of $$("input[name^='d:']", f)) disc[inp.name.slice(2)] = Math.max(0, Math.min(50, +inp.value || 0));
      const done = { ...r, status: "approved", level: f.tpl.value, disc };
      store.set("regs", store.get("regs", []).map((x) => (x.id === r.id ? done : x)));
      store.set("reg", done);
      store.set("user", { company: r.company, ico: r.ico, dic: r.dic, street: r.street, tel: r.tel, name: r.name, email: r.email, level: f.tpl.value, disc });
      renderHeader(); applyPrices();
      root.insertAdjacentHTML("afterbegin", `<div class="note-box" role="status" style="background:var(--green-tint);color:var(--green);font-weight:600;margin-bottom:20px">${icon("check")}<span>Účet ${esc(r.company)} je schválený. <a href="${url("katalog/index.html")}">Otevřít katalog s cenami zákazníka</a></span></div>`);
      scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  root.addEventListener("click", (ev) => {
    const row = ev.target.closest("[data-open]");
    if (row && !ev.target.closest("a")) { open = row.dataset.open; history.replaceState(null, "", "#" + open); render(); scrollTo({ top: 0 }); }
    if (ev.target.closest("[data-back]")) { const wasReg = store.get("regs", []).some((x) => x.id === open); open = wasReg ? "ucty" : ""; history.replaceState(null, "", open ? "#ucty" : location.pathname); render(); }
    const e = inbox.all().find((x) => x.no === open);
    if (e && ev.target.closest("[data-csv-dl]")) download(`selectline-${e.no}.csv`, selectlineCsv(e));
    if (e && ev.target.closest("[data-status]")) {
      const next = e.status === "Nová" ? (e.type === "poptavka" ? "Nabídka odeslána" : "Potvrzeno") : "Nová";
      inbox.save(inbox.all().map((x) => (x.no === e.no ? { ...x, status: next } : x)));
      render();
    }
  });
  root.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("[data-open]")) ev.target.click(); });
  tabsEl.addEventListener("click", (ev) => { const b = ev.target.closest("[data-stab]"); if (!b) return; open = b.dataset.stab === "doklady" ? "" : b.dataset.stab; history.replaceState(null, "", open ? "#" + open : location.pathname); render(); });
  function tiersAdmin(rows, subNames) {
    const cfg = tiersCfg();
    const brands = [...new Set(rows.map((p) => p.b).filter(Boolean))].sort((x, y) => x.localeCompare(y, "cs"));
    const subs = [...new Set(rows.map((p) => p.sub).filter((s) => s && s.includes("/")))];
    const opt = (list, cur, lab = (x) => x) => list.map((x) => `<option value="${esc(x)}"${x === cur ? " selected" : ""}>${esc(lab(x))}</option>`).join("");
    const subOpts = (cur) => {
      const tops = [...new Set(subs.map((s) => s.split("/")[0]))];
      const keys = cur && !subs.includes(cur) ? [cur, ...subs] : subs;
      return tops.map((t) => `<optgroup label="${esc(subNames[t] || t)}">${opt(keys.filter((s) => s.split("/")[0] === t).sort((a, b) => (subNames[a] || a).localeCompare(subNames[b] || b, "cs")), cur, (k) => subNames[k] || k)}</optgroup>`).join("");
    };
    const ruleRow = (r, i) => `<tr data-rule="${i}">
      <td><select class="select" name="scope" aria-label="Rozsah pravidla"><option value="brand"${r.scope === "brand" ? " selected" : ""}>Výrobce</option><option value="sub"${r.scope === "sub" ? " selected" : ""}>Skupina produktů</option></select></td>
      <td><select class="select" name="key" aria-label="Výrobce nebo skupina">${r.scope === "sub" ? subOpts(r.key) : opt(brands, r.key)}</select></td>
      ${[0, 1, 2].map((k) => `<td class="tier-cell"><span>od</span><input class="input" type="number" min="2" max="9999" name="from${k}" value="${r.tiers[k]?.[0] ?? ""}" aria-label="Stupeň ${k + 1}: od kolika kusů"><span>ks</span><input class="input" type="number" min="0" max="50" name="pct${k}" value="${r.tiers[k]?.[1] ?? ""}" aria-label="Stupeň ${k + 1}: sleva v procentech"><span>%</span></td>`).join("")}
      <td><button class="x" type="button" data-del-rule="${i}" aria-label="Odebrat pravidlo">${icon("trash")}</button></td></tr>`;
    return `<form class="panel" data-tiers-form>
      <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center"><h2>Množstevní slevy</h2><label class="switch-row" style="gap:12px">Povolit na webu <input type="checkbox" name="enabled" ${cfg.enabled ? "checked" : ""}></label></div>
      <p class="muted">Sleva se uplatní automaticky v katalogu, na produktu, v košíku i v poptávce. Pravidlo pro skupinu má přednost před pravidlem pro výrobce. V každém stupni zadáte, od kolika kusů platí a kolik procent ubírá.</p>
      <div class="scroll-x"><table class="disc-table tiers-admin"><thead><tr><th>Platí pro</th><th>Výrobce / skupina</th><th>Stupeň 1</th><th>Stupeň 2</th><th>Stupeň 3</th><th><span class="sr-only">Odebrat</span></th></tr></thead><tbody>${cfg.rules.map(ruleRow).join("")}</tbody></table></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" data-add-rule>${icon("plus")} Přidat pravidlo</button><button class="btn primary" type="submit">Uložit slevy</button><button class="btn quiet" type="button" data-reset-tiers>Obnovit výchozí</button></div>
      <p class="small muted">Ukázka: v ostrém provozu se množstevní ceny nastavují v SelectLine a web je jen čte.</p></form>`;
  }
  function bindTiers() {
    const f = $("[data-tiers-form]", root);
    const raw = () => $$("tr[data-rule]", f).map((tr) => ({
      scope: $("[name=scope]", tr).value, key: $("[name=key]", tr).value,
      tiers: [0, 1, 2].map((k) => [+$(`[name=from${k}]`, tr).value, +$(`[name=pct${k}]`, tr).value]).filter(([from, pct]) => from > 1 && pct > 0).sort((x, y) => x[0] - y[0]),
    }));
    const collect = () => ({ enabled: f.enabled.checked, rules: raw().filter((r) => r.key && r.tiers.length) });
    const keep = (rules) => store.set("tiers", { enabled: f.enabled.checked, rules });
    f.addEventListener("change", (ev) => {
      if (ev.target.name !== "scope") return;
      const rules = raw(); rules[+ev.target.closest("tr").dataset.rule].key = ""; keep(rules); render();
    });
    f.addEventListener("click", (ev) => {
      const del = ev.target.closest("[data-del-rule]");
      if (del) { keep(raw().filter((_, i) => i !== +del.dataset.delRule)); render(); }
      if (ev.target.closest("[data-add-rule]")) { keep([...raw(), { scope: "brand", key: "", tiers: [[10, 5]] }]); render(); }
      if (ev.target.closest("[data-reset-tiers]")) { store.set("tiers", DEFAULT_TIERS); render(); toast("Obnoveny výchozí množstevní slevy."); }
    });
    f.addEventListener("submit", (ev) => { ev.preventDefault(); store.set("tiers", collect()); toast("Množstevní slevy uloženy. Platí hned v katalogu i v košíku."); render(); });
  }
  render();
}

/* ---------------- compare ---------------- */
function initCompare() {
  const root = $("[data-compare-root]");
  if (!root) return;
  const diffOnly = $("[data-diff-only]");
  async function render() {
    const ids = store.get("compare", []);
    const { byId } = await getIndex();
    const ps = ids.map((i) => byId.get(i)).filter(Boolean);
    if (!ps.length) { root.innerHTML = `<div class="empty-state"><h3>Zatím nic k porovnání</h3><p>Na stránce produktu klikněte na „Porovnat“. Porovnat lze nejvýše čtyři produkty.</p><a class="btn primary" href="${url("katalog/index.html")}">Otevřít katalog</a></div>`; return; }
    const keys = [...new Set(ps.flatMap((p) => p.pa.map((x) => x[0])))];
    const val = (p, k) => (p.pa.find((x) => x[0] === k) || [])[1] ?? "–";
    const rows = [["Výrobce", (p) => esc(p.b)], ["Objednací kód", (p) => p.c ? `<b>${esc(p.c)}</b>` : "–"], ["Cena bez DPH", (p) => p.pr == null ? "na dotaz" : `<span class="price" data-p="${p.pr}" data-brand="${esc(p.b)}" style="font-size:22px">${czk(p.pr)}</span>`], ["Dostupnost", (p) => `<span class="stock ${p.s}">${stockTxt(p.s)}</span>`], ...keys.map((k) => [k, (p) => esc(val(p, k))])];
    root.innerHTML = `<div class="cmp-wrap"><table class="cmp"><thead><tr><td></td>${ps.map((p) => `<td><a href="${url(p.u)}"><img src="${url(p.img.replace("-s.webp", "-m.webp"))}" alt=""></a><a href="${url(p.u)}" style="font-weight:700;text-decoration:none;display:block;margin-top:8px">${esc(p.n)}</a><button class="linkbtn rm" type="button" data-compare="${p.id}">Odebrat</button></td>`).join("")}</tr></thead>
      <tbody>${rows.map(([k, f], i) => { const vals = ps.map(f); const diff = i > 1 && new Set(vals).size > 1; return `<tr class="${diff ? "diff" : ""}" ${diffOnly.checked && !diff && i > 3 ? "hidden" : ""}><th scope="row">${esc(k)}</th>${vals.map((v) => `<td>${v}</td>`).join("")}</tr>`; }).join("")}
      <tr><th scope="row"></th>${ps.map((p) => `<td>${p.pr == null ? `<form class="buy" data-id="${p.id}"><input type="hidden" name="qty" value="1"><button class="btn" type="submit">Poptat</button></form>` : `<form class="buy" data-id="${p.id}"><input type="hidden" name="qty" value="1"><button class="btn primary" type="submit">${icon("cart")}<span>${buyLabel()}</span></button></form>`}</td>`).join("")}</tr></tbody></table></div>`;
    applyPrices(root);
  }
  diffOnly.addEventListener("change", render);
  root.addEventListener("click", (ev) => { if (ev.target.closest("[data-compare]")) setTimeout(render, 0); });
  render();
}

/* ---------------- quick order pad ---------------- */
function initPad() {
  const pad = $("[data-pad]");
  if (!pad) return;
  const tb = $("tbody", pad), sum = $("[data-pad-summary]");
  let idx;
  const rowHtml = (code = "", q = 1) => `<tr><td><input class="input" name="code" aria-label="Objednací kód" data-code value="${esc(code)}" placeholder="Např. RJ2S-CL-D24" autocomplete="off" spellcheck="false" list="pad-codes"></td><td><input class="input" name="q" data-q type="number" min="1" max="9999" value="${q}" inputmode="numeric" aria-label="Množství"></td><td class="res" data-res><span class="muted">Napište kód</span></td><td class="lt" data-lt></td></tr>`;
  const addRow = (c, q) => tb.insertAdjacentHTML("beforeend", rowHtml(c, q));
  function resolve(tr) {
    const code = $("[data-code]", tr).value.trim(), q = Math.max(1, +$("[data-q]", tr).value || 1);
    const res = $("[data-res]", tr), lt = $("[data-lt]", tr);
    tr._p = null;
    tr._amb = false;
    if (!code) { res.className = "res"; res.innerHTML = `<span class="muted">Napište kód</span>`; lt.textContent = ""; return; }
    const cc = compact(code);
    let p = idx.rows.find((r) => r.cc === cc);
    let multi = [];
    if (!p) { multi = idx.rows.filter((r) => r.cc.startsWith(cc)); if (multi.length === 1) p = multi[0]; }
    if (p) {
      tr._p = p;
      const unit = unitPrice(p, q);
      res.className = "res";
      res.innerHTML = `<a href="${url(p.u)}" style="font-weight:600;text-decoration:none">${esc(p.n)}</a><br><span class="muted">${esc(p.c)}</span>, <span class="stock ${p.s}">${stockTxt(p.s)}</span>${p.pr != null ? `, ${czk(unit)}/ks` : ", cena na dotaz"}`;
      lt.textContent = p.pr != null ? czk(unit * q) : "";
    } else if (multi.length > 1) {
      res.className = "res";
      const few = multi.length < 5;
      res.innerHTML = `${multi.length} ${few ? "kódy začínají" : "kódů začíná"} na „${esc(code)}“: ${multi.slice(0, 6).map((r) => `<button type="button" class="copy" data-pick="${esc(r.c)}" style="margin:4px 4px 0 0">${esc(r.c)}</button>`).join("")}${multi.length > 6 ? " …" : ""}`;
      lt.textContent = "";
      tr._amb = true;
    } else {
      res.className = "res miss"; res.innerHTML = `Kód v e-shopu nemáme. Přidáme ho jako poptávku.`; lt.textContent = "";
    }
  }
  function totals() {
    let n = 0, net = 0, quote = 0;
    for (const tr of $$("tr", tb)) {
      const code = $("[data-code]", tr).value.trim(); if (!code) continue;
      const q = Math.max(1, +$("[data-q]", tr).value || 1);
      n++;
      if (tr._amb) continue;
      if (tr._p?.pr != null) net += unitPrice(tr._p, q) * q; else quote++;
    }
    sum.innerHTML = `<h2>Souhrn</h2><dl><div><dt>Řádků</dt><dd>${n}</dd></div><div><dt>Bez DPH</dt><dd>${czk(net)}</dd></div><div><dt>DPH 21 %</dt><dd>${czk(net * VAT)}</dd></div><div class="total"><dt>Celkem s DPH</dt><dd><span class="price">${czk(net * (1 + VAT))}</span></dd></div></dl>
      ${quote ? `<div class="note-box">${icon("info")}<span>${quote} ${quote === 1 ? "řádek půjde" : "řádky půjdou"} jako poptávka.</span></div>` : ""}
      <button class="btn primary lg wide" type="button" data-pad-cart ${n ? "" : "disabled"}>${icon("cart")} Vložit do ${basketWord()}</button>`;
  }
  tb.addEventListener("input", (ev) => {
    const tr = ev.target.closest("tr"); resolve(tr); totals();
    if (tr === tb.lastElementChild && $("[data-code]", tr).value) addRow();
  });
  tb.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pick]"); if (!b) return;
    const tr = b.closest("tr"); $("[data-code]", tr).value = b.dataset.pick; resolve(tr); totals(); $("[data-q]", tr).focus();
  });
  tb.addEventListener("paste", (ev) => {
    const t = ev.clipboardData?.getData("text") || "";
    if (!t.includes("\n") && !t.includes("\t")) return;
    ev.preventDefault();
    fill(t, ev.target.closest("tr"));
  });
  tb.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); const tr = ev.target.closest("tr"); const next = tr.nextElementSibling || (addRow(), tb.lastElementChild); $(ev.target.matches("[data-q]") ? "[data-code]" : "[data-q]", ev.target.matches("[data-q]") ? next : tr).focus(); }
  });
  function fill(text, start) {
    const lines = text.split(/\r?\n/).map((l) => l.split(/[;\t,]/).map((s) => s.trim())).filter((l) => l[0]);
    let tr = start && !$("[data-code]", start).value ? start : null;
    for (const [c, q] of lines) {
      if (!tr) { addRow(); tr = tb.lastElementChild; }
      $("[data-code]", tr).value = c; $("[data-q]", tr).value = parseInt(q) || 1; resolve(tr);
      tr = tr.nextElementSibling && !$("[data-code]", tr.nextElementSibling).value ? tr.nextElementSibling : null;
    }
    if ($("[data-code]", tb.lastElementChild).value) addRow();
    totals();
  }
  $("[data-pad-add]").addEventListener("click", () => { addRow(); $("[data-code]", tb.lastElementChild).focus(); });
  $("[data-pad-clear]").addEventListener("click", () => { tb.innerHTML = ""; for (let i = 0; i < 5; i++) addRow(); totals(); });
  $("[data-pad-paste]").addEventListener("click", async () => { try { fill(await navigator.clipboard.readText()); } catch { toast("Vložte kódy do prvního políčka zkratkou Ctrl+V."); } });
  $("[data-pad-csv]").addEventListener("change", async (ev) => { const f = ev.target.files[0]; if (f) fill(await f.text()); });
  sum.addEventListener("click", (ev) => {
    if (!ev.target.closest("[data-pad-cart]")) return;
    let n = 0;
    for (const tr of $$("tr", tb)) {
      const code = $("[data-code]", tr).value.trim(); if (!code || tr._amb) continue;
      const q = Math.max(1, +$("[data-q]", tr).value || 1);
      const p = tr._p || { id: -Math.floor(Math.random() * 1e9), n: `Poptávka: ${code}`, c: code, b: "", pr: null, s: "out", u: "rychla-objednavka.html", img: "assets/img/none.svg" };
      cart.add(p, q); n++;
    }
    toast(`${pl(n)} v ${basketIn()}. <a href="${url("kosik.html")}" style="color:#fff">${isCustomer() ? "Zobrazit košík" : "Zobrazit poptávku"}</a>`);
  });
  getIndex().then((d) => {
    idx = d;
    const dl = document.createElement("datalist");
    dl.id = "pad-codes";
    dl.innerHTML = d.rows.filter((r) => r.pr != null).map((r) => `<option value="${esc(r.c)}">${esc(r.n)}</option>`).join("");
    document.body.append(dl);
    for (let i = 0; i < 5; i++) addRow();
    const k = new URLSearchParams(location.search).get("k");
    if (k) { $("[data-code]", tb.firstElementChild).value = k; resolve(tb.firstElementChild); }
    totals();
  });
}

/* ---------------- search results page ---------------- */
function initSearchPage() {
  const root = $("[data-search-results]");
  if (!root) return;
  const q = new URLSearchParams(location.search).get("q") || "";
  getIndex().then((idx) => {
    const res = q ? searchRows(idx, q, 0) : [];
    const arts = q ? searchArticles(idx, q) : [];
    $("[data-search-title]").innerHTML = q ? `Výsledky pro „${esc(q)}“<span class="count">${pl(res.length + arts.length, "výsledek", "výsledky", "výsledků")}</span>` : "Hledání";
    document.title = q ? `${q}: hledání | REM-Technik` : document.title;
    if (q) $("[data-search-sub]").textContent = res.length ? `Řádky můžete rovnou vložit ${isCustomer() ? "do košíku" : "do poptávky"}. Upřesněte výsledek podle skupiny nebo dostupnosti.` : arts.length ? "V e-shopu jsme nic nenašli, o tématu ale píšeme na webu." : "";
    // articles first, six of them and the rest on request; the product table follows under its own heading
    const artsHtml = arts.length ? `<section class="sr-arts" aria-labelledby="sr-arts-h"><h2 id="sr-arts-h">Články a stránky<span class="count">${nf.format(arts.length)}</span></h2>
      <ul class="sr-list">${arts.map((a, i) => `<li${i >= 6 ? " hidden" : ""}><a href="${url(a.u)}">${icon("file")}<span class="t">${hl(a.t, q)}</span><span class="k">${ART_KIND[a.k] || ""}</span></a></li>`).join("")}</ul>
      ${arts.length > 6 ? `<button type="button" class="linkbtn sr-more" data-more-arts>Zobrazit všech ${nf.format(arts.length)}</button>` : ""}</section>` : "";
    const bindArts = () => $("[data-more-arts]", root)?.addEventListener("click", (ev) => {
      const more = $$(".sr-list li[hidden]", root);
      more.forEach((li) => (li.hidden = false));
      $("a", more[0])?.focus();
      ev.currentTarget.remove();
    });
    if (!res.length) {
      root.innerHTML = artsHtml + (q ? `<div class="empty-state"><h3>Pro „${esc(q)}“ nemáme nic v e-shopu</h3><p>Sortiment výrobců je širší než e-shop. Pošlete nám kód a ověříme cenu i termín dodání.</p><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn primary" href="${url("rychla-objednavka.html")}?k=${encodeURIComponent(q)}">Poptat kód ${esc(q)}</a><a class="btn" href="${url("katalog/index.html")}">Procházet katalog</a></div></div>` : `<p class="muted">Napište do vyhledávání kód, název nebo výrobce.</p>`);
      bindArts();
      return;
    }
    const cats = [...new Set(res.map((p) => p.sub))];
    root.innerHTML = artsHtml + (arts.length ? `<h2 class="sr-h">Produkty<span class="count">${nf.format(res.length)}</span></h2>` : "") + `<div class="toolbar"><div class="chips" data-sfac>${cats.slice(0, 8).map((c) => `<button type="button" class="btn sm" aria-pressed="false" data-sub="${esc(c)}">${esc(idx.subs[c] || c)} <span class="muted">${res.filter((p) => p.sub === c).length}</span></button>`).join("")}</div>
      <label class="switch-row" style="gap:10px">Jen skladem <input type="checkbox" name="skladem" data-sstock></label></div>
      <table class="ptable"><thead><tr><th class="c-img"><span class="sr-only">Obrázek</span></th><th>Produkt</th><th>Parametry</th><th>Dostupnost</th><th style="text-align:right">Cena bez DPH</th><th><span class="sr-only">Nákup</span></th></tr></thead><tbody>
      ${res.slice(0, 300).map((p) => `<tr data-id="${p.id}" data-sub="${esc(p.sub)}" data-s="${p.s}"><td class="c-img"><a href="${url(p.u)}" tabindex="-1" aria-hidden="true"><img src="${url(p.img)}" alt="" width="64" height="64" loading="lazy"></a></td>
        <td class="c-name"><a href="${url(p.u)}">${hl(p.n, q)}</a><div class="code">${p.c ? `<span>Kód <b>${hl(p.c, q)}</b></span>` : ""}<span class="brand">${esc(p.b)}</span></div></td>
        <td class="c-par">${p.pa.slice(0, 3).map(([k, v]) => `${esc(k)}: <b>${esc(v)}</b>`).join("<br>")}</td>
        <td class="c-stock"><span class="stock ${p.s}">${stockTxt(p.s)}</span></td>
        <td class="c-price">${p.pr != null ? `<span class="price" data-p="${p.pr}" data-brand="${esc(p.b)}">${czk(p.pr)}</span><span class="price-note" data-pv="${p.pr}">${czk(p.pr * 1.21)} s DPH</span>` : `<span class="ask">Cena na dotaz</span>`}</td>
        <td class="c-buy"><form class="buy" data-id="${p.id}"><div class="qty sm"><button type="button" data-step="-1" aria-label="Méně">${icon("minus", "sm")}</button><input type="number" name="qty" value="1" min="1" max="9999" aria-label="Množství"><button type="button" data-step="1" aria-label="Více">${icon("plus", "sm")}</button></div><button class="btn ${p.pr != null ? "primary " : ""}sm" type="submit">${p.pr != null ? `${icon("cart")}<span>${buyLabel()}</span>` : "Poptat"}</button></form></td></tr>`).join("")}
      </tbody></table>`;
    applyPrices(root);
    bindArts();
    const st = { sub: null, stock: false };
    const apply = () => $$("tbody tr", root).forEach((tr) => (tr.hidden = (st.sub && tr.dataset.sub !== st.sub) || (st.stock && tr.dataset.s !== "in")));
    $("[data-sfac]", root).addEventListener("click", (ev) => { const b = ev.target.closest("[data-sub]"); if (!b) return; const on = b.getAttribute("aria-pressed") !== "true"; $$("[data-sub]", root).forEach((x) => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", on); st.sub = on ? b.dataset.sub : null; apply(); });
    $("[data-sstock]", root).addEventListener("change", (ev) => { st.stock = ev.target.checked; apply(); });
  });
}

/* ---------------- print: catalogue sheets ---------------- */
let QR;
function loadQR() {
  return (QR ??= new Promise((res) => {
    const sc = document.createElement("script");
    sc.src = url("vendor/qrcode.min.js");
    sc.onload = () => res(window.qrcode);
    sc.onerror = () => res(null);
    document.head.append(sc);
  }));
}
function fillQR(root = document) {
  if (!window.qrcode) return;
  for (const el of $$("[data-qr]", root)) {
    if (el.firstChild) continue;
    const q = window.qrcode(0, "M");
    q.addData(el.dataset.qr);
    q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
  }
}
function prepareSheet() {
  const sh = $("[data-sheet]");
  if (!sh) return;
  fillQR(sh);
  applyPrices(sh);
  const el = $("[data-product]");
  const p = el && JSON.parse(el.dataset.product);
  const slot = $("[data-sheet-tiers]", sh);
  if (p && slot) slot.innerHTML = tierRule(p) ? tierTable(p, 1).replace(/<p class="tier-live"[\s\S]*$/, "") : "";
}
let titleBefore = document.title;
addEventListener("beforeprint", () => {
  titleBefore = document.title;
  const el = $("[data-product]");
  if (el && !document.body.classList.contains("print-cat")) { const p = JSON.parse(el.dataset.product); document.title = `REM-Technik ${p.c || p.n} katalogovy list`; prepareSheet(); }
});
addEventListener("afterprint", () => { document.title = titleBefore; document.body.classList.remove("print-cat"); $(".print-catalog")?.remove(); });
async function printSheet() { await loadQR(); prepareSheet(); print(); }
async function printGroup(btn, doPrint = true) {
  const data = $("#facets");
  if (!data) return;
  await loadQR();
  $("[data-table]")?._settle?.(); // finish a sort still filling in below the fold
  const rows = JSON.parse(data.textContent);
  const fams = new Map();
  for (const tr of $$("[data-table] tbody > tr")) {
    if (tr.classList.contains("fam")) continue;
    const id = tr.dataset.id, r = rows[id];
    if (!r || tr.hidden) continue;
    const key = r.f || "single";
    if (!fams.has(key)) fams.set(key, []);
    fams.get(key).push({ id, ...r });
  }
  const keyCols = $$("[data-table] thead th[data-col^='p:']").map((th) => th.dataset.col.slice(2));
  const famBlurb = (f) => $(`tr.fam[data-fam="${f}"] .fam-head p`)?.textContent || "";
  const table = (items, names) => `<table class="sh-var"><thead><tr><th>Objednací kód</th>${names ? "<th>Název</th>" : ""}${keyCols.map((k) => `<th>${esc(k)}</th>`).join("")}<th>Dostupnost</th><th class="r">Cena bez DPH</th></tr></thead><tbody>
    ${items.map((x) => `<tr><td class="code"><b>${esc(x.c || "–")}</b></td>${names ? `<td>${esc(x.n)}</td>` : ""}${keyCols.map((k) => `<td>${esc(x.p[k] ?? "–")}</td>`).join("")}<td>${stockTxt(x.s).toLowerCase()}</td><td class="r">${x.pr == null ? "na dotaz" : czk(isCustomer() ? yourPrice(x.pr, x.b) : x.pr)}</td></tr>`).join("")}</tbody></table>`;
  const blocks = [...fams.entries()].map(([k, items]) => {
    const head = items[0];
    const title = k === "single" ? "Další položky skupiny" : head.n;
    const imgSrc = url(`assets/img/p/${k === "single" ? head.id : head.id}-m.webp`);
    return `<section class="pc-fam${items.length > 14 ? " long" : ""}"><div class="pc-famhead"><img src="${imgSrc}" alt=""><div><h3>${esc(title)}</h3><p>${esc(k === "single" ? `${pl(items.length)}` : famBlurb(k) || `${head.b}, ${pl(items.length, "varianta", "varianty", "variant")}`)}</p></div></div>${table(items, k === "single")}</section>`;
  }).join("");
  const n = [...fams.values()].reduce((s, x) => s + x.length, 0);
  const box = document.createElement("div");
  box.className = "print-catalog";
  box.style.setProperty("--tab", btn.dataset.tab);
  box.innerHTML = `<div class="sh-tab"><span>${esc(btn.dataset.tabname)}</span></div>
    <header class="sh-head"><img class="sh-logo" src="${url("logo.svg")}" alt="REM-Technik"><div class="sh-path"><b>${esc(btn.dataset.cat)}</b><br>Katalogové listy, ${new Date().toLocaleDateString("cs-CZ")}</div><div class="sh-qrbox"><div class="sh-qr" data-qr="${esc(location.href.split("?")[0].split("#")[0])}"></div><span>Skupina online s filtry a aktuálními cenami</span></div></header>
    <h2 style="margin-top:6mm">${esc(btn.dataset.printCatalog)}</h2>
    <p class="pc-intro">${pl(n)}${[...new URLSearchParams(location.search).keys()].some((k) => k !== "katalog") ? " podle zvolených filtrů" : ""}. Ceny bez DPH${isCustomer() ? ` pro ${esc(user().company)}` : " dle ceníku"}, platné v den tisku.</p>${blocks}`;
  $("main").append(box);
  fillQR(box);
  document.body.classList.add("print-cat");
  titleBefore = document.title;
  document.title = `REM-Technik ${btn.dataset.printCatalog} katalogove listy`;
  await Promise.all($$("img", box).map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
  if (doPrint) print();
}
// ?katalog in the URL prepares the group's catalogue pages for printing straight away (shareable print link)
if (new URLSearchParams(location.search).has("katalog")) addEventListener("load", () => { const b = $("[data-print-catalog]"); if (b) printGroup(b, false); });
document.addEventListener("click", (ev) => {
  if (ev.target.closest("[data-print]")) { ev.preventDefault(); printSheet(); }
  const g = ev.target.closest("[data-print-catalog]");
  if (g) printGroup(g);
});

/* ---------------- promo carousel ---------------- */
function initCarousel() {
  const c = $("[data-carousel]");
  if (!c) return;
  const slides = $$(".promo", c), bars = $$(".cbar", c), play = $("[data-play]", c);
  // Autoplay for everyone; the pause button stops it. Under reduced motion (followed live) the bars stay still and
  // a plain timer advances the slides, since the global reduced-motion rule makes the bar animation end at once.
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  let i = 0, userPaused = false, manualPause = false, hover = false, timer;
  const dur = () => { const v = getComputedStyle(c).getPropertyValue("--dur").trim(); return (v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000) || 7000; };
  const tick = () => { clearTimeout(timer); if (mq.matches && !userPaused && !hover) timer = setTimeout(() => go(i + 1), dur()); };
  const sync = () => {
    c.classList.toggle("still", mq.matches);
    c.classList.toggle("paused", userPaused || hover);
    play.innerHTML = icon(userPaused ? "play" : "pause");
    play.setAttribute("aria-label", userPaused ? "Spustit střídání" : "Pozastavit střídání");
    tick();
  };
  mq.addEventListener("change", () => { userPaused = manualPause; sync(); });
  function go(n, focus = false) {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => { const on = k === i; s.classList.toggle("on", on); s.inert = !on; });
    bars.forEach((b, k) => {
      b.setAttribute("aria-selected", k === i);
      b.tabIndex = k === i ? 0 : -1;
      b.classList.toggle("done", k < i);
      const f = $(".fill", b); f.style.animation = "none"; void f.offsetWidth; f.style.animation = "";
    });
    c.style.setProperty("--slide-bg", slides[i].dataset.bg);
    const img = $(".promo-img img", slides[i]); if (img.loading === "lazy") img.loading = "eager";
    if (focus) bars[i].focus();
    tick();
  }
  bars.forEach((b, k) => {
    b.addEventListener("click", () => go(k));
    $(".fill", b).addEventListener("animationend", () => { if (k === i && !userPaused) go(i + 1); });
  });
  $(".bars", c).addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight") { ev.preventDefault(); go(i + 1, true); }
    if (ev.key === "ArrowLeft") { ev.preventDefault(); go(i - 1, true); }
  });
  play.addEventListener("click", () => { userPaused = manualPause = !userPaused; sync(); });
  c.addEventListener("pointerenter", (ev) => { if (ev.pointerType === "mouse") { hover = true; sync(); } });
  c.addEventListener("pointerleave", () => { hover = false; sync(); });
  c.addEventListener("focusin", () => { hover = true; sync(); });
  c.addEventListener("focusout", (ev) => { if (!c.contains(ev.relatedTarget)) { hover = false; sync(); } });
  // swipe on touch screens
  let x0 = null;
  c.addEventListener("pointerdown", (ev) => { if (ev.pointerType !== "mouse" && !ev.target.closest("button, a, input")) x0 = ev.clientX; });
  c.addEventListener("pointerup", (ev) => { if (x0 != null && Math.abs(ev.clientX - x0) > 50) go(i + (ev.clientX < x0 ? 1 : -1)); x0 = null; });
  document.addEventListener("visibilitychange", () => { hover = document.hidden; sync(); });
  sync();
}

/* ---------------- recently viewed ---------------- */
function initRecent() {
  const sec = $("[data-recent]");
  if (!sec) return;
  const ids = store.get("recent", []);
  if (!ids.length) return;
  getIndex().then(({ byId }) => {
    const ps = ids.map((i) => byId.get(i)).filter(Boolean).slice(0, 8);
    if (!ps.length) return;
    $("[data-recent-list]", sec).innerHTML = ps.map((p) => `<article class="card"><a class="img" href="${url(p.u)}" tabindex="-1" aria-hidden="true"><img src="${url(p.img.replace("-s.webp", "-m.webp"))}" alt="" width="240" height="180" loading="lazy"></a><div><h3><a href="${url(p.u)}">${esc(p.n)}</a></h3><div class="code">${esc(p.b)}${p.c ? `, kód ${esc(p.c)}` : ""}</div></div><div class="foot"><div>${p.pr != null ? `<span class="price" data-p="${p.pr}" data-brand="${esc(p.b)}">${czk(p.pr)}</span>` : `<span class="muted">Cena na dotaz</span>`}<div><span class="stock ${p.s}">${stockTxt(p.s)}</span></div></div></div></article>`).join("");
    sec.hidden = false;
    applyPrices(sec);
  });
}

/* ---------------- view transitions: product photo morph ---------------- */
addEventListener("pageswap", (ev) => {
  if (!ev.viewTransition) return;
  const to = ev.activation?.entry?.url;
  if (!to) return;
  const m = to.match(/-(\d+)\.html/);
  if (!m) return;
  const link = document.querySelector(`[data-vt="${m[1]}"]`)?.closest("tr, .card")?.querySelector("img") || document.querySelector(`[data-pid="${m[1]}"] img`);
  if (link) { link.style.viewTransitionName = "product-photo"; ev.viewTransition.finished.finally(() => (link.style.viewTransitionName = "")); }
});
addEventListener("pagereveal", (ev) => {
  if (!ev.viewTransition) return;
  const img = document.querySelector("[data-vt-target]");
  const from = window.navigation?.activation?.from?.url || "";
  if (img && !from.includes(location.pathname)) { img.style.viewTransitionName = "product-photo"; ev.viewTransition.finished.finally(() => (img.style.viewTransitionName = "")); }
});

/* ---------------- boot ---------------- */
if (!("popover" in HTMLElement.prototype)) import("https://unpkg.com/@oddbird/popover-polyfill@0.5.2/dist/popover.min.js").catch(() => {});
renderHeader();
applyPrices();
initSearch();
initMega();
initListing();
initProduct();
initCart();
initCheckout();
initAccount();
initCompare();
initPad();
initSearchPage();
initRecent();
initTraining();
initSales();
initCarousel();
// The search index (~85 kB gzipped) loads on intent: hovering, touching or focusing a buy form or the search box.
for (const ev of ["pointerover", "touchstart", "focusin"]) document.addEventListener(ev, (e) => { if (e.target.closest?.("form.buy, #q, [data-quick], [data-paste]")) getIndex(); }, { passive: true });

// ---- parts/00-video.js
{
// YouTube facade: nothing loads from YouTube until the visitor asks for the video
document.addEventListener("click", (ev) => {
  const a = ev.target.closest("a[data-yt]");
  if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
  ev.preventDefault();
  const f = document.createElement("iframe");
  f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(a.dataset.yt)}?autoplay=1&rel=0`;
  f.title = a.closest("figure")?.querySelector("figcaption")?.textContent || "Video";
  f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  f.allowFullscreen = true;
  a.replaceWith(f);
});

}

// ---- parts/20-product.js
{
// Product page: gallery thumbnails switch the main (and zoomed) photo; a very long description opens clipped.
const thumbs = document.querySelector("[data-thumbs]");
if (thumbs) {
  const main = document.querySelector(".gallery .main img");
  const zoom = document.querySelector("#zoom img");
  thumbs.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-full]");
    if (!b || !main) return;
    main.src = b.dataset.full;
    main.width = +b.dataset.w;
    main.height = +b.dataset.h;
    main.style.setProperty("--nat-w", `${b.dataset.w}px`);
    if (zoom) { zoom.src = b.dataset.full; zoom.width = +b.dataset.w; zoom.height = +b.dataset.h; }
    for (const x of thumbs.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
  });
}

const pd = document.querySelector("[data-pdesc]");
if (pd && pd.scrollHeight > 1150) {
  pd.classList.add("clip");
  pd.id ||= "popis-text";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn pdesc-more";
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", pd.id);
  btn.textContent = "Zobrazit celý popis";
  pd.after(btn);
  btn.addEventListener("click", () => {
    const open = pd.classList.toggle("clip") === false;
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = open ? "Sbalit popis" : "Zobrazit celý popis";
    if (!open) pd.closest("section")?.scrollIntoView({ block: "start" });
  });
}

}

// ---- parts/60-company.js
{
// Company and support pages (build_company.py)
// 1. Guide tables: the "Video" button opens the player row under the procedure.
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-gv]");
  if (!b) return;
  const row = document.getElementById(b.getAttribute("aria-controls"));
  if (!row) return;
  const open = b.getAttribute("aria-expanded") !== "true";
  b.setAttribute("aria-expanded", String(open));
  const box = row.querySelector(".g-vbox");
  if (box && box.dataset.facade === undefined) box.dataset.facade = box.innerHTML;
  row.hidden = !open;
  if (open) row.querySelector("a[data-yt], a[data-mp4]")?.click(); // one click plays (the facade is the no-JS fallback)
  else if (box) box.innerHTML = box.dataset.facade; // closing stops the player (a hidden iframe would keep playing)
});

// 2. MP4 facade (videos hosted on rem-technik.cz): nothing loads until the visitor clicks.
document.addEventListener("click", (ev) => {
  const a = ev.target.closest("a[data-mp4]");
  if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
  ev.preventDefault();
  const title = (a.querySelector(".sr-only")?.textContent || "Video").replace(/^Přehrát video:\s*/, "");
  const v = document.createElement("video");
  v.src = a.dataset.mp4;
  v.controls = true;
  v.autoplay = true;
  v.playsInline = true;
  v.setAttribute("aria-label", title);
  if (a.closest(".g-vbox")) { a.replaceWith(v); v.focus(); return; } // guide rows play inline
  // library cards: the small thumbnail stays, the video opens in a dialog at a watchable size
  let d = document.getElementById("vplay");
  if (!d) {
    d = document.createElement("dialog");
    d.id = "vplay";
    d.className = "vplay";
    d.setAttribute("aria-labelledby", "vplay-h");
    d.innerHTML = '<div class="dlg-head"><h2 id="vplay-h"></h2><form method="dialog"><button class="x" aria-label="Zavřít"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button></form></div><div class="vplay-b"></div>';
    d.addEventListener("close", () => d.querySelector(".vplay-b").replaceChildren()); // closing stops the video
    document.body.append(d);
  }
  d.querySelector("#vplay-h").textContent = title;
  d.querySelector(".vplay-b").replaceChildren(v);
  d.showModal();
});

// 3. Video library: filter by manufacturer and by text.
const tools = document.querySelector("[data-vtools]");
if (tools) {
  const chips = [...tools.querySelectorAll("[data-vf]")];
  const q = tools.querySelector("[data-vq]");
  const count = tools.querySelector("[data-vcount]");
  const groups = [...document.querySelectorAll("[data-vg]")];
  const empty = document.querySelector("[data-vempty]");
  let brand = "";
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const apply = () => {
    const t = norm(q.value.trim());
    let n = 0;
    for (const g of groups) {
      let gn = 0;
      const on = !brand || g.dataset.vg === brand;
      for (const c of g.querySelectorAll(".vcard")) {
        const hit = on && (!t || norm(c.dataset.q || "").includes(t));
        c.hidden = !hit;
        if (hit) gn++;
      }
      g.hidden = gn === 0;
      n += gn;
    }
    empty.hidden = n > 0;
    count.textContent = brand || t ? `${n} ${n === 1 ? "video" : n > 1 && n < 5 ? "videa" : "videí"}` : "";
  };
  for (const c of chips) c.addEventListener("click", () => {
    brand = c.dataset.vf;
    for (const x of chips) x.setAttribute("aria-pressed", String(x === c));
    apply();
  });
  q.addEventListener("input", apply);
  if (location.hash.startsWith("#v-")) document.querySelector(location.hash)?.scrollIntoView();
}

}

// ---- parts/news.js
{
// News hub (novinky.html). The type filter is plain radios styled by CSS :has(); this script only
// - keeps the chosen type in the URL hash (novinky.html#nove-produkty opens the hub filtered),
// - opens the collapsed year groups while a type is chosen, so its older items are visible too,
// - opens a year group when the Archiv links jump to it.
const hub = document.querySelector("[data-news-hub]");
if (hub) {
  const groups = [...hub.querySelectorAll("details.nw-year")];
  const setOpen = (on) => groups.forEach((d) => { d.open = on; });
  const pick = () => {
    const t = decodeURIComponent(location.hash.slice(1));
    const r = t && hub.querySelector(`input[name="nwt"][value="${CSS.escape(t)}"]`);
    if (r) { r.checked = true; setOpen(true); return; }
    const g = t && document.getElementById(t);
    if (g && g.tagName === "DETAILS") g.open = true;
  };
  pick();
  addEventListener("hashchange", pick);
  hub.addEventListener("change", (ev) => {
    if (ev.target.name !== "nwt") return;
    const v = ev.target.value;
    setOpen(!!v);
    history.replaceState(null, "", v ? `#${v}` : location.pathname + location.search);
  });
  hub.addEventListener("click", (ev) => {
    const a = ev.target.closest('.nw-years a[href^="#"]');
    const g = a && document.getElementById(a.getAttribute("href").slice(1));
    if (g && g.tagName === "DETAILS") g.open = true;
  });
}

}
