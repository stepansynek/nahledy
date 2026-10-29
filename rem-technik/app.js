// REM-Technik — client side: cart, search, filters, account, checkout.
// Everything is stored in localStorage; nothing leaves the browser except the ARES lookup.

const ROOT = new URL(document.querySelector('meta[name="root"]')?.content || "./", location.href);
const url = (p) => new URL(p, ROOT).href;
// the build's fingerprint (build.py ASSET_V): files fetched at runtime ask for the same version as this script
const ASSET_V = new URL(import.meta.url).searchParams.get("v");
const vurl = (p) => url(p) + (ASSET_V ? `?v=${ASSET_V}` : "");
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
const wholeQty = (v) => Math.max(1, Math.min(9999, Math.round(+v) || 1)); // whole pieces, 1–9999 ("2.5" → 3)

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
    IDX = fetch(vurl("data/search.json")).then((r) => r.json()).then((d) => {
      const byId = new Map();
      const rows = d.p.map((r) => {
        const o = { id: r[0], n: r[1], c: r[2], b: r[3], pr: r[4], s: r[5] === 1 ? "in" : r[5] === 2 ? "ask" : "out", sub: r[6], u: r[7], img: r[8] ? `assets/img/p/${r[0]}-s.webp` : "assets/img/none.svg", pa: r[9], px: r[10] || [] }; // px: rows read from the bullets (compare only)
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
// typed or pasted order code -> { p, multi }: the exact code first (case and spacing ignored), then the compact form
// ("dlf25ag12"); a compact form that several different codes share (DLF2,5/A and DLF25/A, MG B M and MG B M+) is ambiguous
const codeKey = (s) => norm(s).replace(/\s+/g, " ").trim();
function findCode(idx, code) {
  if (!idx.codes) {
    const exact = new Map(), loose = new Map();
    for (const r of idx.rows) {
      if (!r.c) continue;
      if (!exact.has(codeKey(r.c))) exact.set(codeKey(r.c), r);
      loose.set(r.cc, [...(loose.get(r.cc) || []), r]);
    }
    idx.codes = { exact, loose };
  }
  const hit = idx.codes.exact.get(codeKey(code));
  if (hit) return { p: hit, multi: [] };
  const l = idx.codes.loose.get(compact(code)) || [];
  return new Set(l.map((r) => codeKey(r.c))).size === 1 ? { p: l[0], multi: [] } : { p: null, multi: l };
}
const qtyOf = (s) => wholeQty(String(s ?? "").replace(",", ".")); // "2,5" from Excel -> 3
// a pasted row -> [code, qty]: a tab or semicolon separates them; a comma only before a whole number at the end,
// and only when the row as a whole is not a code (DLF2,5/A G1/2" and TFR 1,8 stay whole)
function splitRow(idx, raw) {
  const t = String(raw).trim();
  if (/[;\t]/.test(t)) { const [c, q] = t.split(/[;\t]/).map((x) => x.trim()); return [c, q]; }
  const m = t.match(/^(.*\S)\s*,\s*(\d+)$/);
  return m && !findCode(idx, t).p ? [m[1], m[2]] : [t, ""];
}
const ART_KIND = { oblast: "Oblast použití", aplikace: "Aplikace", novinka: "Novinka", enovinky: "E-novinky", podpora: "Podpora", vyrobce: "Výrobce", firma: "O firmě", sekce: "Skupina" };
const ART_RANK = { oblast: 3, podpora: 3, aplikace: 2, vyrobce: 2, firma: 2, sekce: 2, novinka: 0, enovinky: 0 }; // guides before news
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
const DEMO_USER = { company: "Ukázkový zákazník s.r.o.", ico: "12345679", dic: "CZ12345679", street: "Technická 12, 616 00 Brno", tel: "+420 600 000 000", name: "Jan Novák", email: "nakup@ukazka.cz", level: "Ceník B2B 2, stálý zákazník", disc: { IDEC: 12, REER: 8, steute: 10, "VIPA YASKAWA": 7, Thermokon: 6, _: 5 } };
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
    // the price box (prefix) keeps the price with DPH for a customer too; listing rows stay one short line
    if (u && yp !== list && prefix) el.innerHTML = `Vaše cena bez DPH, ${czk(yp * (1 + VAT))} s DPH<br>ceníková ${czk(list)} bez DPH`;
    else el.textContent = u && yp !== list ? `Vaše cena, ceníková ${czk(list)}` : `${prefix}${czk(list * (1 + VAT))} s DPH`;
  }
}

/* ---------------- volume prices (set by the company; demo defaults) ---------------- */
const DEFAULT_TIERS = {
  enabled: true,
  rules: [
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
    q = wholeQty(q);
    const lines = cart.all();
    const l = lines.find((x) => x.id === p.id);
    if (l) l.q = wholeQty(l.q + q); else lines.push({ id: p.id, q, n: p.n, c: p.c, b: p.b, pr: p.pr, s: p.s, u: p.u, img: p.img, sub: p.sub });
    cart.save(lines);
  },
  set(id, q) { const lines = cart.all(); const l = lines.find((x) => x.id === id); if (l) l.q = wholeQty(q); cart.save(lines); },
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
  for (const el of $$("[data-cart-total]")) { // a sum is a figure in Saira (as the phone number beside it); "prázdná" and "3 položky" stay text
    el.textContent = !t.n ? (isCustomer() ? "0 Kč" : "prázdná") : t.net ? czk(t.net) : pl(t.n);
    el.classList.toggle("fig", !!t.net || (!t.n && isCustomer()));
  }
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
    <div class="sum"><span>V ${basketIn()} ${pl(t.n)}</span><strong>${t.quote === t.n ? "cena na dotaz" : cus ? `${czk(t.net)} bez DPH` : `orientačně ${czk(t.net)}`}</strong></div>
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
    inp.value = wholeQty((+inp.value || 1) + +step.dataset.step);
    inp.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
document.addEventListener("submit", (ev) => {
  const f = ev.target.closest("form.buy");
  if (!f) return;
  ev.preventDefault();
  const q = wholeQty(f.qty.value);
  f.qty.value = q;
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
  const load = () => loaded ??= fetch(vurl("mega.html")).then((r) => r.text()).then((h) => {
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

/* ---------------- listing filters and sorting: src/parts/30-filters.js (filter system v2) ---------------- */

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
    const draw = () => { tb.innerHTML = tierTable(p, wholeQty(qIn.value)); tb.hidden = false; };
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
    // only say "copied" when the clipboard took it; otherwise select the code so it can be copied by hand
    let ok = true;
    try { await navigator.clipboard.writeText(b.dataset.copy); } catch { ok = false; }
    if (!ok) {
      const c = $(".code", b.closest(".codeline") || document);
      if (c) getSelection().selectAllChildren(c);
      toast("Kód se nepodařilo zkopírovat. Je označený, zkopírujte ho ručně.");
      return;
    }
    b._html ??= b.innerHTML;
    b.innerHTML = `${icon("check", "sm")} Zkopírováno`;
    toast(`Kód ${esc(b.dataset.copy)} je ve schránce.`);
    clearTimeout(b._t); b._t = setTimeout(() => (b.innerHTML = b._html), 1500);
  }));
  // "Uložit do seznamu" puts the product in the first list (Oblíbené) once; a second click only says it is there
  const favs = () => store.get("lists", [{ name: "Oblíbené", items: {} }]);
  $$("[data-save]").forEach((b) => {
    if (favs()[0]?.items[p.id]) $("span", b).textContent = "V seznamu";
    b.addEventListener("click", () => {
      const lists = favs();
      if (!lists.length) lists.push({ name: "Oblíbené", items: {} });
      const open = `<a href="${url("ucet.html#seznamy")}" style="color:#fff">Otevřít seznamy</a>`;
      if (lists[0].items[p.id]) { toast(`Už je v seznamu ${esc(lists[0].name)}. ${open}`); return; }
      lists[0].items[p.id] = wholeQty(qIn?.value);
      store.set("lists", lists);
      $("span", b).textContent = "V seznamu";
      toast(`Uloženo do seznamu ${esc(lists[0].name)}. ${open}`);
    });
  });
  // sticky buy bar on phones once the price box scrolls away above (not while it is still below the fold on a short phone)
  const bar = $("[data-buybar]"), box = $(".pricebox");
  if (bar && box && "IntersectionObserver" in window) {
    new IntersectionObserver(([en]) => {
      const on = !en.isIntersecting && en.boundingClientRect.top < (en.rootBounds?.top ?? 0);
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
function cartRows(lines, editable = true, listOnly = !isCustomer(), listRm = false) {
  return `<div class="cart-cq"><table class="ptable carttable"><thead><tr><th class="c-img"><span class="sr-only">Obrázek</span></th><th>Produkt</th><th>Dostupnost</th><th style="text-align:right">Cena/ks</th><th>Množství</th><th style="text-align:right">${listOnly ? "Orientačně" : "Celkem bez DPH"}</th><th><span class="sr-only">Odebrat</span></th></tr></thead><tbody>
  ${lines.map((l) => {
    const unit = l.unit !== undefined && !editable ? l.unit : unitPrice(l, l.q);
    return `<tr data-id="${l.id}"><td class="c-img"><a href="${url(l.u)}"><img src="${url(l.img)}" alt="" width="64" height="64"></a></td>
    <td class="c-name"><a href="${url(l.u)}">${esc(l.n)}</a><div class="code">${l.c ? `<span>Kód <b>${esc(l.c)}</b></span>` : ""}<span class="brand">${esc(l.b)}</span></div>${editable ? tierHint(l) : ""}
    ${editable ? `<div class="line-note">${l.note ? "" : `<button class="linkbtn" type="button" data-note-open="${l.id}">Přidat poznámku k položce</button>`}<input class="input" type="text" maxlength="300" value="${esc(l.note || "")}" placeholder="Např. potřebujeme i ekvivalent, termín, certifikát" aria-label="Poznámka k položce ${esc(l.c)}" name="note-${l.id}" data-line-note="${l.id}" ${l.note ? "" : "hidden"}></div>` : l.note ? `<div class="tier-hint">Poznámka: ${esc(l.note)}</div>` : ""}</td>
    <td class="c-stock"><span class="stock ${l.s}">${stockTxt(l.s)}</span></td>
    <td class="c-unit">${unit == null ? "na dotaz" : czk(unit)}</td>
    <td class="c-qty">${editable ? `<div class="qty sm"><button type="button" data-step="-1" aria-label="Méně">${icon("minus", "sm")}</button><input type="number" value="${l.q}" min="1" max="9999" inputmode="numeric" aria-label="Množství, ${esc(l.c)}" name="qty-${l.id}" data-line-q="${l.id}"><button type="button" data-step="1" aria-label="Více">${icon("plus", "sm")}</button></div>` : `${l.q} ks`}</td>
    <td class="c-total">${unit == null ? `<span class="muted" style="font-weight:400">Cenu doplníme</span>` : czk(unit * l.q)}</td>
    <td class="c-rm">${editable ? `<button class="x" type="button" data-rm="${l.id}" aria-label="Odebrat ${esc(l.c)}">${icon("trash")}</button>` : listRm ? `<button class="x" type="button" data-list-rm="${l.id}" aria-label="Odebrat ${esc(l.c || l.n)} ze seznamu">${icon("trash")}</button>` : ""}</td></tr>`;
  }).join("")}</tbody></table></div>`;
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
const allOnRequest = (t) => t.n > 0 && t.quote === t.n; // nothing in the basket has a web price: a quote, never "0 Kč"
function quoteSummaryHtml(t, cta, extra = "") {
  return `<h2>Poptávka</h2><dl>
    <div><dt>Položky</dt><dd>${pl(t.n)}, ${t.items} ks</dd></div>
    ${t.volDisc ? `<div><dt>Dle ceníku</dt><dd>${czk(t.list)}</dd></div><div><dt>Množstevní sleva</dt><dd style="color:var(--red)">−${czk(t.volDisc)}</dd></div>` : ""}
    ${allOnRequest(t) ? `<div class="total"><dt>Celkem</dt><dd><span class="price">Cena na dotaz</span></dd></div>` : `<div class="total"><dt>Bez DPH a dopravy</dt><dd><span class="price">${czk(t.net)}</span></dd></div>`}</dl>
    <div class="note-box">${icon("info")}<span>${allOnRequest(t) ? "Ceny a termíny dodání upřesní obchodník v nabídce." : `Částka je orientační. Konečné ceny, slevy a termíny dodání vám potvrdí obchodník v nabídce.${t.quote ? ` U ${pl(t.quote, "položky", "položek", "položek")} bez ceny ${t.quote === 1 ? "ji" : "je"} doplní.` : ""}`}</span></div>
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
      root.innerHTML = `<div class="empty-state"><h2>${cus ? "Košík je prázdný" : "Poptávka je zatím prázdná"}</h2><p>Vyhledejte produkt podle kódu, nebo vložte celý seznam kódů z Excelu níže.</p><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn primary" href="${url("katalog/index.html")}">Otevřít katalog</a><a class="btn" href="${url("rychla-objednavka.html")}">${cus ? "Rychlá objednávka" : "Poptat podle kódů"}</a></div></div>`;
      sum.innerHTML = cus ? summaryHtml(t, { cta: `<a class="btn primary lg wide" aria-disabled="true">Pokračovat k objednávce</a>` }) : quoteSummaryHtml(t, `<a class="btn primary lg wide" aria-disabled="true">Pokračovat k odeslání</a>`);
      return;
    }
    root.innerHTML = cartRows(lines) + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px" class="noprint"><button class="btn quiet sm" type="button" data-save-list aria-expanded="false">${icon("bookmark")} Uložit jako seznam</button><button class="btn quiet sm" type="button" data-print-quote>${icon("print")} Vytisknout</button><button class="btn quiet sm" type="button" data-clear>${icon("trash")} Vyprázdnit</button></div>
      <form class="noprint" data-list-form hidden><div class="field" style="margin-top:14px;max-width:520px"><label for="list-name">Název seznamu</label><div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="list-name" name="name" maxlength="60" required style="flex:1 1 220px"><button class="btn primary sm" type="submit">Uložit seznam</button><button class="btn quiet sm" type="button" data-list-cancel>Zrušit</button></div><span class="hint">Seznam se stejným názvem přepíšeme tímto obsahem.</span></div></form>`;
    if (cus && allOnRequest(t)) { // only "Cena na dotaz" items: it goes out as a quote request
      sum.innerHTML = quoteSummaryHtml(t, `<a class="btn primary lg wide" href="${url("objednavka.html?poptavka=1")}">Pokračovat k poptávce</a>`,
        `<p class="small">Tyto položky nemají cenu v e-shopu. Obchodník vám pošle nabídku s cenami pro ${esc(user().company.replace(/\.$/, ""))}.</p>`);
    } else if (cus) {
      sum.innerHTML = summaryHtml(t, {
        cta: `<a class="btn primary lg wide" href="${url("objednavka.html")}">Pokračovat k objednávce</a><a class="btn wide" href="${url("objednavka.html?poptavka=1")}">Poslat jako poptávku</a>`,
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
    const sl = ev.target.closest("[data-save-list]"), lf = $("[data-list-form]", root);
    if (sl && lf) { // ask for a name, suggesting one; the same name updates that list instead of adding another
      lf.hidden = !lf.hidden;
      sl.setAttribute("aria-expanded", !lf.hidden);
      if (!lf.hidden) { lf.name.value = `${isCustomer() ? "Košík" : "Poptávka"} ${new Date().toLocaleDateString("cs-CZ")}`; lf.name.select(); lf.name.focus(); }
    }
    if (ev.target.closest("[data-list-cancel]")) { lf.hidden = true; $("[data-save-list]", root)?.setAttribute("aria-expanded", "false"); $("[data-save-list]", root)?.focus(); }
  });
  root.addEventListener("submit", (ev) => {
    const f = ev.target.closest("[data-list-form]");
    if (!f) return;
    ev.preventDefault();
    const name = f.name.value.trim();
    if (!name) { f.name.focus(); return; }
    const lists = store.get("lists", [{ name: "Oblíbené", items: {} }]);
    const items = Object.fromEntries(cart.all().map((l) => [l.id, l.q]));
    const same = lists.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (same) same.items = items; else lists.push({ name, items });
    store.set("lists", lists);
    f.hidden = true;
    $("[data-save-list]", root)?.setAttribute("aria-expanded", "false");
    toast(`${same ? `Seznam „${esc(same.name)}“ je aktualizovaný.` : `Uloženo jako „${esc(name)}“.`} <a href="${url("ucet.html#seznamy")}" style="color:#fff">Seznamy</a>`);
  });
  bc?.addEventListener("message", render);
  // paste codes
  const msg = $("[data-paste-msg]");
  async function addLines(text) {
    const idx = await getIndex();
    let ok = 0; const miss = [], amb = [];
    for (const raw of text.split(/\r?\n/)) {
      const [code, qs] = splitRow(idx, raw);
      if (!code) continue;
      const { p, multi } = findCode(idx, code);
      if (p) { cart.add(p, qtyOf(qs)); ok++; } else if (multi.length) amb.push([code, multi]); else miss.push(code);
    }
    render();
    msg.innerHTML = `${ok ? `Přidáno: ${pl(ok)}.` : ""} ${amb.length ? `Upřesněte kód: ${amb.map(([c, m]) => `<b>${esc(c)}</b> (${m.map((r) => esc(r.c)).join(", nebo ")})`).join("; ")}.` : ""} ${miss.length ? `Nenašli jsme: <b>${miss.map(esc).join(", ")}</b>. Doplňte je v <a href="${url("rychla-objednavka.html")}">rychlé objednávce</a> jako poptávku.` : ""}`;
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
// an IČO with 8 digits that fails the checksum blocks the form (empty or short is left to required/pattern)
function icoCheck(form) {
  const i = form.ico;
  if (!i || i.readOnly) return true;
  const v = i.value.replace(/\s/g, "");
  const bad = /^\d{8}$/.test(v) && !icoValid(v) && !i.closest("[hidden]");
  i.setCustomValidity(bad ? "IČO neprošlo kontrolou. Zkontrolujte číslice." : "");
  const err = $(".err", i.closest(".field") || form);
  if (err?.lastChild) { err.dataset.def ??= err.lastChild.textContent; err.lastChild.textContent = bad ? " IČO neprošlo kontrolou. Zkontrolujte číslice." : err.dataset.def; }
  return !bad;
}
// The seat is three fields in the checkout and the registration (street, postcode, town: the postcode field sized for 5 digits)
// and one line everywhere it is read ("Technická 12, 616 00 Brno": sales view, e-mail, account registry, src/parts/85-account.js)
const pscFmt = (z) => String(z ?? "").replace(/\s/g, "").replace(/^(\d{3})(\d{2})$/, "$1 $2");
function addrSplit(s) {
  const t = String(s || "").trim(), m = t.match(/^(.*?),\s*(\d{3}\s?\d{2})\s+(.+)$/);
  return m ? { street: m[1].trim(), zip: pscFmt(m[2]), city: m[3].trim() } : { street: t, zip: "", city: "" };
}
const addrLine = (f) => [f.street.value.trim(), [pscFmt(f.zip?.value.trim()), f.city?.value.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
function aresAddr(s = {}) { // ARES sidlo: "Klíny 4389/35", "615 00", and the town as the postal address writes it ("Praha 1", not "Praha")
  const no = [s.cisloDomovni, s.cisloOrientacni && `${s.cisloOrientacni}${s.cisloOrientacniPismeno || ""}`].filter(Boolean).join("/");
  const town = (s.textovaAdresa || "").match(/\d{5}\s+([^,]+)$/)?.[1] || s.nazevObce || "";
  return s.psc ? { street: [s.nazevUlice || s.nazevCastiObce || s.nazevObce, no].filter(Boolean).join(" "), zip: pscFmt(s.psc), city: town } : addrSplit((s.textovaAdresa || "").replace(/\b(\d{3})(\d{2})\b/, "$1 $2"));
}
function bindAres(form) {
  const msg = $("[data-ares-msg]", form);
  if (!msg || !form.ico) return;
  const acct = user();
  if (acct?.ico) { form.ico.readOnly = true; msg.innerHTML = `${icon("check", "sm")} Údaje firmy jsou z vašeho firemního účtu.`; msg.className = "ares ok"; return; }
  msg.innerHTML = `<span class="muted">Vyzkoušejte třeba IČO <span class="fig">26290464</span>.</span>`;
  async function ares() {
    const ico = form.ico.value.replace(/\s/g, "");
    if (!icoValid(ico)) { msg.className = "ares bad"; msg.innerHTML = `${icon("info", "sm")} Tohle IČO neprošlo kontrolou. Má 8 číslic a poslední je kontrolní.`; return; }
    msg.className = "ares"; msg.innerHTML = `<span class="spin" aria-hidden="true"></span> Hledám v ARES…`;
    try {
      const r = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      form.company.value = d.obchodniJmeno || "";
      const a = aresAddr(d.sidlo);
      form.street.value = a.street;
      if (form.zip) { form.zip.value = a.zip; form.city.value = a.city; }
      if (form.dic) form.dic.value = d.dic || "";
      form.dispatchEvent(new Event("input", { bubbles: true })); // checkout: the draft and the step bar see the filled fields
      msg.className = "ares ok"; msg.innerHTML = `${icon("check", "sm")} Načteno z ARES: ${esc(d.obchodniJmeno)}`;
    } catch (e) {
      msg.className = "ares bad"; msg.innerHTML = `${icon("info", "sm")} ARES teď neodpovídá. Údaje vyplňte ručně.`;
    }
  }
  $("[data-ares]", form)?.addEventListener("click", ares);
  form.ico.addEventListener("input", () => { icoCheck(form); if (/^\d{8}$/.test(form.ico.value)) ares(); });
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
  // a quote for visitors, on request (?poptavka) and for a basket of "Cena na dotaz" items only
  const quoteMode = !u || new URLSearchParams(location.search).has("poptavka") || allOnRequest(cart.totals());
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
    const seat = { ico: u.ico, dic: u.dic, tel: u.tel, ...addrSplit(u.street) };
    for (const [k, v] of Object.entries(seat)) if (v && form[k]) form[k].value = v;
    if (!quoteMode) { $('input[value="invoice"]', form).checked = true; $("[data-invoice-note]").textContent = `Pro ${u.company} je nákup na fakturu povolený.`; }
  } else $('input[value="invoice"]', form).disabled = true;
  bindAres(form);
  // draft: keep what was typed if the visitor leaves and comes back
  const draftKeys = ["ico", "company", "street", "zip", "city", "dic", "po", "name", "tel", "email", "shipaddr", "due", "note"];
  const draft = store.get("coDraft", {});
  for (const k of draftKeys) if (draft[k] && form[k] && !form[k].value) form[k].value = draft[k];
  if (!form.zip.value && !form.city.value) Object.entries(addrSplit(form.street.value)).forEach(([k, v]) => (form[k].value = v)); // a draft from before the seat was split
  if (draft.ship) { const r = $(`input[name=ship][value="${draft.ship}"]`, form); if (r) r.checked = true; }
  form.addEventListener("input", () => {
    const d = Object.fromEntries(draftKeys.map((k) => [k, form[k]?.value || ""]));
    d.ship = $('input[name="ship"]:checked', form)?.value;
    store.set("coDraft", d);
  });
  // buying without a company ID (quote requests only)
  const noico = $("[data-noico]", form);
  const companyBits = [form.ico.closest(".ico-row"), $("[data-ares-msg]", form), form.dic.closest(".field"), form.street.closest(".field"), form.zip.closest(".fit-row")];
  function syncNoIco() {
    const on = quoteMode && !u && noico.checked;
    companyBits.forEach((el) => (el.hidden = on));
    form.ico.required = form.street.required = form.zip.required = form.city.required = form.company.required = !on;
    icoCheck(form);
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
    const terms = `<p class="small">Odesláním souhlasíte se <a href="${url("ochrana-osobnich-udaju.html")}">zpracováním údajů</a>${quoteMode ? ". Poptávka je nezávazná." : ` a s <a href="${url("obchodni-podminky-e-shop.html")}">obchodními podmínkami</a>. Objednávka zavazuje k platbě.`}</p>`;
    const edit = `<a class="small" href="${url("kosik.html")}">Upravit ${quoteMode ? "poptávku" : "košík"}</a>`;
    if (quoteMode) sum.innerHTML = quoteSummaryHtml(t, `<button class="btn primary lg wide" type="submit">Odeslat poptávku</button>${terms}`).replace("<h2>Poptávka</h2>", `<div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Poptávka</h2>${edit}</div>${mini}`);
    else sum.innerHTML = summaryHtml(t, { ship, cta: `<button class="btn primary lg wide" type="submit">${t.quote ? "Objednat a poptat zbytek" : "Odeslat objednávku"}</button>${terms}` }).replace("<h2>Souhrn</h2>", `<div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Souhrn</h2>${edit}</div>${mini}`);
    const bar = $("[data-co-bar]", form);
    bar.hidden = false;
    $("[data-co-bar-label]", bar).textContent = allOnRequest(t) ? "Celkem" : quoteMode ? "Bez DPH, orientačně" : "Celkem s DPH";
    $("[data-co-bar-total]", bar).textContent = allOnRequest(t) ? "Cena na dotaz" : czk(quoteMode ? t.net : (t.net + ship) * (1 + VAT));
    $("[data-co-bar-btn]", bar).textContent = quoteMode ? "Odeslat poptávku" : "Odeslat objednávku";
    steps();
  }
  render();
  form.addEventListener("change", (ev) => { if (ev.target.name === "ship") render(); });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const lines = cart.all();
    if (!lines.length) return;
    icoCheck(form);
    if (!form.checkValidity()) {
      syncInvalid(form);
      const bad = $$("input, textarea, select", form).filter((i) => !i.disabled && !i.closest("[hidden]") && !i.checkValidity());
      const es = $("[data-err-summary]", form);
      es.innerHTML = `<strong>Než odešlete, doplňte prosím:</strong><ul>${bad.map((i) => `<li><a href="#${i.id}">${esc(($(`label[for="${i.id}"]`, form)?.childNodes[0]?.textContent || i.name).trim())}${i.validity.customError ? " (neprošlo kontrolou)" : ""}</a></li>`).join("")}</ul>`;
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
      ico: form.ico.value, dic: form.dic.value, company: form.company.value, street: addrLine(form), zip: pscFmt(form.zip.value.trim()), city: form.city.value.trim(),
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
// Hooks filled by src/parts/85-account.js (loads after this file): password check, extra tabs, forgotten-password routes.
const accountExt = { signIn: null, tabs: [], decorate: null, login: null, refresh: () => {} };
function initAccount() {
  const root = $("[data-account-root]");
  if (!root) return;
  // signIn returns the account's user record, or null when the e-mail and password don't match; no password = demo button or a fresh reset
  async function login(email, pw) {
    const u = accountExt.signIn ? await accountExt.signIn(email, pw) : { ...DEMO_USER, email: email || DEMO_USER.email };
    if (!u) return false;
    store.set("user", u); seedOrders(); render(); renderHeader(); applyPrices(); toast("Jste přihlášeni. Ceny v katalogu jsou teď vaše.");
    return true;
  }
  accountExt.login = login;
  accountExt.refresh = render;
  let refocus = []; // after a list change re-renders the tab: the first of these selectors that exists gets focus
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
        <form class="panel" id="prihlaseni" data-login novalidate><h2>Přihlášení</h2>
          <div class="err-summary" data-login-err role="alert" tabindex="-1" hidden></div>
          <div class="field"><label for="l-email">E-mail</label><input class="input" id="l-email" name="email" type="email" autocomplete="username" spellcheck="false" required><span class="err">${icon("info", "sm")} Zadejte e-mail.</span></div>
          <div class="field"><label for="l-pw">Heslo</label><input class="input" id="l-pw" name="pw" type="password" autocomplete="current-password" required><span class="err">${icon("info", "sm")} Zadejte heslo.</span></div>
          <label class="check"><input type="checkbox" data-show-pw> <span>Zobrazit heslo</span></label>
          <div class="acc-acts"><button class="btn primary" type="submit">Přihlásit</button><a href="#zapomenute-heslo" data-forgot-link>Zapomenuté heslo?</a></div>
          <div class="note-box">${icon("info")}<span>V ukázce se přihlásíte e-mailem <b data-demo-email>${esc(DEMO_USER.email)}</b> a jakýmkoli heslem, dokud si v nastavení účtu nezvolíte vlastní. Nebo rovnou: <button class="linkbtn" type="button" data-demo>přihlásit ukázkový účet</button>.</span></div></form>
        ${pending ? `<div class="help"><h2>Co firemní účet umí</h2><ul class="prose" style="padding-left:20px"><li>Vaše ceny podle ceníku u každého výrobce</li><li>Objednávka rovnou, firmám na fakturu</li><li>Historie objednávek a opakování</li><li>Nákupní seznamy pro údržbu a opakované zakázky</li></ul></div>` : ""}
        <form class="panel" id="registrace" data-register novalidate ${pending ? "hidden" : ""}><h2>Požádat o firemní účet</h2>
          <p class="muted">Účty schvaluje obchodní oddělení. Po schválení uvidíte v katalogu své ceny a objednáte rovnou.</p>
          <div class="ico-row"><div class="field"><label for="r-ico">IČO</label><input class="input" id="r-ico" name="ico" inputmode="numeric" pattern="\\d{8}" maxlength="8" required autocomplete="off" placeholder="8 číslic"><span class="err">${icon("info", "sm")} Vyplňte IČO, 8 číslic.</span></div><button class="btn" type="button" data-ares>Načíst z ARES</button><div class="ares" data-ares-msg aria-live="polite"></div></div>
          <div class="formgrid fit">
            <div class="field full"><label for="r-company">Název firmy</label><input class="input" id="r-company" name="company" required autocomplete="organization"><span class="err">${icon("info", "sm")} Vyplňte název firmy.</span></div>
            <div class="field full"><label for="r-street">Ulice a číslo</label><input class="input" id="r-street" name="street" required autocomplete="billing address-line1"><span class="err">${icon("info", "sm")} Vyplňte ulici a číslo sídla.</span></div>
            <div class="full fit-row"><div class="field w-zip"><label for="r-zip">PSČ</label><input class="input" id="r-zip" name="zip" required inputmode="numeric" pattern="[0-9]{3} ?[0-9]{2}" maxlength="6" autocomplete="billing postal-code"><span class="err">${icon("info", "sm")} PSČ má 5 číslic.</span></div>
            <div class="field w-city"><label for="r-city">Obec</label><input class="input" id="r-city" name="city" required autocomplete="billing address-level2"><span class="err">${icon("info", "sm")} Vyplňte obec.</span></div></div>
            <div class="field w-dic"><label for="r-dic">DIČ <span class="muted" style="font-weight:400">(nepovinné)</span></label><input class="input" id="r-dic" name="dic" autocomplete="off" spellcheck="false"></div>
            <div class="field full"><label for="r-name">Jméno a příjmení</label><input class="input" id="r-name" name="name" required autocomplete="name"><span class="err">${icon("info", "sm")} Vyplňte jméno.</span></div>
            <div class="field w-tel"><label for="r-tel">Telefon <span class="muted" style="font-weight:400">(nepovinné)</span></label><input class="input" id="r-tel" name="tel" type="tel" autocomplete="tel"></div>
            <div class="field"><label for="r-email">Pracovní e-mail</label><input class="input" id="r-email" name="email" type="email" required autocomplete="email"><span class="err">${icon("info", "sm")} Zadejte e-mail.</span></div>
            <div class="field full"><label for="r-what">Co u nás nakupujete <span class="muted" style="font-weight:400">(nepovinné)</span></label><input class="input" id="r-what" name="what" placeholder="Např. bezpečnostní relé REER, PLC IDEC pro údržbu"></div>
          </div>
          <button class="btn primary" type="submit" style="justify-self:start">Odeslat žádost</button>
        </form>
      </div>`;
      $("[data-demo]", root).addEventListener("click", () => login());
      $("[data-login]", root).addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.target, err = $("[data-login-err]", f);
        if (!f.checkValidity()) { f.reportValidity(); syncInvalid(f); return; }
        if (await login(f.email.value.trim(), f.pw.value)) return;
        err.innerHTML = `<strong>E-mail nebo heslo nesedí.</strong><span>Zkontrolujte překlepy, nebo si <a href="#zapomenute-heslo">nastavte nové heslo</a>.</span>`;
        err.hidden = false; err.focus();
      });
      const rf = $("[data-register]", root);
      bindAres(rf);
      rf.addEventListener("submit", (ev) => {
        ev.preventDefault();
        icoCheck(rf);
        if (!rf.checkValidity()) { rf.reportValidity(); syncInvalid(rf); return; }
        const r = { id: docNo("REG"), status: "pending", date: new Date().toISOString(), ico: rf.ico.value, dic: rf.dic.value, company: rf.company.value, street: addrLine(rf), zip: pscFmt(rf.zip.value.trim()), city: rf.city.value.trim(), name: rf.name.value, email: rf.email.value, tel: rf.tel.value, what: rf.what.value };
        store.set("reg", r);
        store.set("regs", [r, ...store.get("regs", []).filter((x) => x.id !== r.id)]);
        renderHeader();
        render();
        scrollTo({ top: 0, behavior: "smooth" });
      });
      if (location.hash === "#registrace") setTimeout(() => rf.scrollIntoView({ block: "start" }), 50);
      accountExt.decorate?.(root);
      return;
    }
    const orders = store.get("orders", []);
    const lists = store.get("lists", [{ name: "Oblíbené", items: {} }]);
    const ext = accountExt.tabs;
    const tab = ["prehled", "objednavky", "seznamy", "cenik", ...ext.map((t) => t.key)].includes(location.hash.slice(1)) ? location.hash.slice(1) : "prehled";
    const tabs = [["prehled", "Přehled"], ["objednavky", `Objednávky (${orders.length})`], ["seznamy", `Nákupní seznamy (${lists.length})`], ["cenik", "Můj ceník"], ...ext.map((t) => [t.key, t.name])];
    root.innerHTML = `<div class="pagehead"><div><h1>${esc(u.company)}</h1><p>${esc(u.name)}, ${esc(u.email)}</p></div><button class="btn" type="button" data-logout>${icon("logout")} Odhlásit</button></div>
      <div class="tabs" role="tablist">${tabs.map(([k, n]) => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${n}</button>`).join("")}</div><div data-tabpanel role="tabpanel"></div>`;
    const panel = $("[data-tabpanel]", root);
    const extTab = ext.find((t) => t.key === tab);
    if (extTab) extTab.render(panel, u);
    else getIndex().then(({ byId }) => {
      if (tab === "prehled") {
        const last = orders[0];
        panel.innerHTML = `<div class="acc-grid"><div class="acc-card"><span class="co">${esc(u.company)}</span><div class="kv"><span>Ceník</span>${esc(u.level)}</div><div class="kv"><span>Platba</span>Faktura, splatnost 14 dní</div><div class="kv"><span>Obchodník</span>+420 548 140 000</div><span class="badge" style="justify-self:start">Ukázka</span></div>
        <div style="display:grid;gap:20px;align-content:start"><div class="facts"><div><strong>${orders.length}</strong><span>${orders.length === 1 ? "objednávka" : orders.length >= 2 && orders.length <= 4 ? "objednávky" : "objednávek"}</span></div><div><strong>${czk(orders.reduce((s, o) => s + o.net, 0))}</strong><span>odebráno bez DPH</span></div><div><strong>${Object.keys(lists[0]?.items || {}).length}</strong><span>položek v oblíbených</span></div></div>
        ${last ? `<div class="panel"><h2>Poslední objednávka ${esc(last.no)}</h2>${cartRows(last.lines, false)}<div><button class="btn primary" type="button" data-reorder="0">${icon("repeat")} Objednat znovu</button></div></div>` : ""}</div></div>`;
      } else if (tab === "objednavky") {
        panel.innerHTML = orders.length ? `<div class="scroll-x"><table class="ptable orders keep"><thead><tr><th>Číslo</th><th>Datum</th><th>Položek</th><th>Vaše č. obj.</th><th>Stav</th><th style="text-align:right">Bez DPH</th><th></th></tr></thead><tbody>${orders.map((o, i) => `<tr><td><b>${esc(o.no)}</b>${o.demo ? ' <span class="badge">ukázka</span>' : ""}</td><td>${new Date(o.date).toLocaleDateString("cs-CZ")}</td><td>${o.lines.length}</td><td>${esc(o.po || "–")}</td><td><span class="status ${o.status === "Vyřízená" ? "done" : "new"}">${esc(o.status)}</span></td><td style="text-align:right" class="num">${o.lines.every((l) => l.pr == null) ? "na dotaz" : czk(o.net)}</td><td style="text-align:right;white-space:nowrap"><button class="btn sm" type="button" data-reorder="${i}">${icon("repeat")} Znovu</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><h3>Zatím žádné objednávky</h3><p>Objednávky z e-shopu i od obchodníka se tu zobrazí s fakturami.</p><a class="btn primary" href="${url("katalog/index.html")}">Otevřít katalog</a></div>`;
      } else if (tab === "seznamy") {
        panel.innerHTML = lists.map((l, li) => {
          const items = Object.entries(l.items).map(([id, q]) => ({ ...byId.get(+id), q })).filter((x) => x.id);
          return `<div class="panel" data-list="${li}"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><h2 tabindex="-1">${esc(l.name)} <span class="count">${items.length}</span></h2><div style="display:flex;gap:8px;flex-wrap:wrap">${items.length ? `<button class="btn primary sm" type="button" data-list-cart="${li}">${icon("cart")} Vše do košíku</button>` : ""}${li ? `<button class="btn quiet sm" type="button" data-list-del>${icon("trash")} Smazat seznam</button>` : ""}</div></div>
          ${items.length ? cartRows(items.map((x) => ({ ...x, u: x.u, img: x.img })), false, undefined, true) : `<p class="muted">Seznam je prázdný. Na stránce produktu použijte „Uložit do seznamu“.</p>`}</div>`;
        }).join("");
      } else {
        const rows = Object.entries(u.disc).map(([b, d]) => `<tr><th scope="row">${b === "_" ? "Ostatní výrobci" : esc(b)}</th><td>${d} %</td></tr>`).join("");
        panel.innerHTML = `<div class="split"><div><table class="spec"><tbody>${rows}</tbody></table></div><div class="note-box">${icon("info")}<span>Slevy z ceníkových cen platí automaticky v celém katalogu, v košíku i v rychlé objednávce. V ukázce jsou slevy smyšlené.</span></div></div>`;
      }
      applyPrices(panel);
      for (const sel of refocus) { const el = $(sel, panel); if (el) { el.focus(); break; } }
      refocus = [];
    });
    $("[data-logout]", root).addEventListener("click", () => { store.set("user", null); render(); renderHeader(); applyPrices(); });
    $$("[data-tab]", root).forEach((b) => b.addEventListener("click", () => { history.replaceState(null, "", "#" + b.dataset.tab); render(); }));
    root.onclick = async (ev) => {
      const r = ev.target.closest("[data-reorder]");
      const lc = ev.target.closest("[data-list-cart]");
      if (r) { const o = store.get("orders", [])[+r.dataset.reorder]; const { byId } = await getIndex(); o.lines.forEach((l) => byId.get(l.id) && cart.add(byId.get(l.id), l.q)); toast(`Položky z ${esc(o.no)} jsou v košíku. <a href="${url("kosik.html")}" style="color:#fff">Zobrazit košík</a>`); }
      if (lc) { const l = store.get("lists", [])[+lc.dataset.listCart]; const { byId } = await getIndex(); Object.entries(l.items).forEach(([id, q]) => byId.get(+id) && cart.add(byId.get(+id), q)); toast(`Seznam „${esc(l.name)}“ je v košíku.`); }
      // shopping lists: remove one item, or delete a whole list (the first one, Oblíbené, stays: products save into it)
      const lr = ev.target.closest("[data-list-rm]"), ld = ev.target.closest("[data-list-del]");
      if (lr || ld) {
        const lists = store.get("lists", [{ name: "Oblíbené", items: {} }]);
        const li = +ev.target.closest("[data-list]").dataset.list, l = lists[li];
        if (!l) return;
        if (lr) {
          const tr = lr.closest("tr"), near = tr.nextElementSibling || tr.previousElementSibling;
          delete l.items[lr.dataset.listRm];
          refocus = [near ? `[data-list="${li}"] tr[data-id="${near.dataset.id}"] [data-list-rm]` : "", `[data-list="${li}"] h2`].filter(Boolean);
          store.set("lists", lists); render(); toast(`Odebráno ze seznamu „${esc(l.name)}“.`);
        } else if (confirm(`Smazat seznam „${l.name}“?`)) {
          lists.splice(li, 1);
          refocus = [`[data-list="${Math.min(li, lists.length - 1)}"] h2`];
          store.set("lists", lists); render(); toast(`Seznam „${esc(l.name)}“ je smazaný.`);
        }
      }
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
${e.po ? `Číslo zákazníka: ${e.po}\n` : ""}${e.ship ? `Doprava: ${e.ship}\n` : ""}${e.shipaddr ? `Doručit na: ${e.shipaddr.replace(/\s*\n\s*/g, ", ")}\n` : ""}${e.pay ? `Platba: ${e.pay}\n` : ""}${e.due ? `Požadovaný termín: ${e.due}\n` : ""}
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
  inbox.save([{ no: "POP-2026-30418", type: "poptavka", date: "2026-10-22T08:41:00", status: "Nová", demo: true, ico: "", dic: "", company: "Ukázková strojírna s.r.o.", street: "Průmyslová 1, Brno", name: "Petra Ukázková", email: "petra.ukazkova@ukazkova-strojirna.cz", tel: "+420 600 000 010", po: "", ship: "Kurýr PPL", pay: "", due: "", note: "Potřebujeme do konce měsíce. U světelné závory prosíme o variantu s výškou 910 mm.", lines: pick, list, net: list, customer: false }]);
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
        ${items.map((x) => `<tr tabindex="0" data-open="${esc(x.no)}"><td><b>${esc(x.no)}</b>${x.demo ? ' <span class="badge">ukázka</span>' : ""}</td><td>${x.type === "poptavka" ? "Poptávka" : "Objednávka"}${x.customer ? `<div class="muted" style="font-size:13px">firemní účet</div>` : ""}</td><td>${esc(x.company)}${x.ico ? `<div class="muted" style="font-size:13px">IČO ${esc(x.ico)}</div>` : ""}</td><td>${new Date(x.date).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</td><td>${pl(x.lines.length)}</td><td style="text-align:right" class="num">${x.lines.every((l) => l.pr == null) ? "na dotaz" : `${czk(x.net)}${x.type === "poptavka" ? `<div class="muted" style="font-size:13px">orientačně</div>` : ""}`}</td><td><span class="status ${x.status === "Nová" ? "new" : "done"}">${esc(x.status)}</span></td></tr>`).join("")}</tbody></table>
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
        ${e.po ? `<dt>Číslo zákazníka</dt><dd>${esc(e.po)}</dd>` : ""}${e.ship ? `<dt>Doprava</dt><dd>${esc(e.ship)}</dd>` : ""}${e.shipaddr ? `<dt>Doručit na</dt><dd style="white-space:pre-line">${esc(e.shipaddr)}</dd>` : ""}${e.pay ? `<dt>Platba</dt><dd>${esc(e.pay)}</dd>` : ""}${e.due ? `<dt>Požadovaný termín</dt><dd>${new Date(e.due).toLocaleDateString("cs-CZ")}</dd>` : ""}${e.note ? `<dt>Poznámka</dt><dd>${esc(e.note)}</dd>` : ""}${e.files?.length ? `<dt>Přílohy</dt><dd>${e.files.map(esc).join(", ")}</dd>` : ""}${e.noico ? `<dt>Zákazník</dt><dd>soukromá osoba, bez IČO</dd>` : ""}</dl>
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
  const diffOnly = $("[data-diff-only]"), diffWrap = $("[data-diff-wrap]");
  async function render() {
    const ids = store.get("compare", []);
    const { byId } = await getIndex();
    const ps = ids.map((i) => byId.get(i)).filter(Boolean);
    const only = ps.length > 1 && diffOnly.checked; // "Jen rozdíly" shows (and counts) from two products on
    if (diffWrap) diffWrap.hidden = ps.length < 2;
    if (!ps.length) { root.innerHTML = `<div class="empty-state"><h3>Zatím nic k porovnání</h3><p>Na stránce produktu klikněte na „Porovnat“. Porovnat lze nejvýše čtyři produkty.</p><a class="btn primary" href="${url("katalog/index.html")}">Otevřít katalog</a></div>`; return; }
    const all = (p) => [...p.pa, ...p.px].filter((x) => x[0] !== "Objednací kód"); // as the product page's table
    const keys = [...new Set(ps.flatMap((p) => all(p).map((x) => x[0])))];
    const val = (p, k) => (all(p).find((x) => x[0] === k) || [])[1] ?? "–";
    const rows = [["Výrobce", (p) => esc(p.b)], ["Objednací kód", (p) => p.c ? `<b>${esc(p.c)}</b>` : "–"], ["Cena bez DPH", (p) => p.pr == null ? "na dotaz" : `<span class="price" data-p="${p.pr}" data-brand="${esc(p.b)}" style="font-size:22px">${czk(p.pr)}</span>`], ["Dostupnost", (p) => `<span class="stock ${p.s}">${stockTxt(p.s)}</span>`], ...keys.map((k) => [k, (p) => esc(val(p, k))])];
    root.innerHTML = `<div class="cmp-wrap"><table class="cmp"><thead><tr><td></td>${ps.map((p) => `<td><a href="${url(p.u)}"><img src="${url(p.img.replace("-s.webp", "-m.webp"))}" alt=""></a><a href="${url(p.u)}" style="font-weight:700;text-decoration:none;display:block;margin-top:8px">${esc(p.n)}</a><button class="linkbtn rm" type="button" data-compare="${p.id}">Odebrat</button></td>`).join("")}</tr></thead>
      <tbody>${rows.map(([k, f], i) => { const vals = ps.map(f); const diff = i > 1 && new Set(vals).size > 1; return `<tr class="${diff ? "diff" : ""}" ${only && !diff && i > 3 ? "hidden" : ""}><th scope="row">${esc(k)}</th>${vals.map((v) => `<td>${v}</td>`).join("")}</tr>`; }).join("")}
      <tr><th scope="row"></th>${ps.map((p) => `<td>${p.pr == null ? `<form class="buy" data-id="${p.id}"><input type="hidden" name="qty" value="1"><button class="btn" type="submit">Poptat</button></form>` : `<form class="buy" data-id="${p.id}"><input type="hidden" name="qty" value="1"><button class="btn primary" type="submit">${icon("cart")}<span>${buyLabel()}</span></button></form>`}</td>`).join("")}</tr></tbody></table></div>
      ${ps.length === 1 ? `<div class="note-box cmp-one">${icon("info")}<span>Přidejte druhý produkt tlačítkem „Porovnat“ na jeho stránce. Řádky, ve kterých se liší, se zvýrazní.</span></div>` : ""}`;
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
  const rowHtml = (code = "", q = 1) => `<tr><td><input class="input" name="code" aria-label="Objednací kód" data-code value="${esc(code)}" autocomplete="off" spellcheck="false" list="pad-codes"></td><td><input class="input" name="q" data-q type="number" min="1" max="9999" value="${q}" inputmode="numeric" aria-label="Množství"></td><td class="res" data-res></td><td class="lt" data-lt></td></tr>`;
  const hint = () => $$("[data-code]", tb).forEach((i, k) => (i.placeholder = k ? "" : "Např. RJ2S-CL-D24")); // the example only in the first row
  const addRow = (c, q) => { tb.insertAdjacentHTML("beforeend", rowHtml(c, q)); hint(); };
  const pasteKey = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform) ? "⌘V" : "Ctrl+V";
  $$("[data-pad-key]").forEach((k) => (k.textContent = pasteKey));
  function resolve(tr) {
    const code = $("[data-code]", tr).value.trim(), q = wholeQty($("[data-q]", tr).value);
    const res = $("[data-res]", tr), lt = $("[data-lt]", tr);
    tr._p = null;
    tr._amb = false;
    tr.classList.remove("amb");
    if (!code) { res.className = "res"; res.textContent = ""; lt.textContent = ""; return; }
    let { p, multi } = findCode(idx, code); // exact code, then the compact form; several compact hits stay a choice
    const similar = multi.length > 1;
    if (!p && !similar) { const cc = compact(code); multi = cc ? idx.rows.filter((r) => r.cc.startsWith(cc)) : []; if (multi.length === 1) p = multi[0]; }
    if (p) {
      tr._p = p;
      const unit = unitPrice(p, q);
      res.className = "res";
      res.innerHTML = `<a href="${url(p.u)}" style="font-weight:600;text-decoration:none">${esc(p.n)}</a><br><span class="muted">${esc(p.c)}</span>, <span class="stock ${p.s}">${stockTxt(p.s)}</span>${p.pr != null ? `, ${czk(unit)}/ks` : ", cena na dotaz"}`;
      lt.textContent = p.pr != null ? czk(unit * q) : "";
    } else if (multi.length > 1) {
      res.className = "res";
      const few = multi.length < 5;
      res.innerHTML = `${similar ? "Podobný kód má víc produktů, vyberte:" : `${multi.length} ${few ? "kódy začínají" : "kódů začíná"} na „${esc(code)}“:`} ${multi.slice(0, 6).map((r) => `<button type="button" class="copy" data-pick="${esc(r.c)}" style="margin:4px 4px 0 0">${esc(r.c)}</button>`).join("")}${multi.length > 6 ? " …" : ""}`;
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
      const q = wholeQty($("[data-q]", tr).value);
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
  tb.addEventListener("change", (ev) => { // whole pieces only: 2.5 becomes 3 as soon as the field is left
    const i = ev.target.closest("[data-q]");
    if (i && i.value !== String(wholeQty(i.value))) { i.value = wholeQty(i.value); resolve(i.closest("tr")); totals(); }
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
    const lines = text.split(/\r?\n/).map((l) => splitRow(idx, l)).filter((l) => l[0]);
    let tr = start && !$("[data-code]", start).value ? start : null;
    for (const [c, q] of lines) {
      if (!tr) { addRow(); tr = tb.lastElementChild; }
      $("[data-code]", tr).value = c; $("[data-q]", tr).value = qtyOf(q); resolve(tr);
      tr = tr.nextElementSibling && !$("[data-code]", tr.nextElementSibling).value ? tr.nextElementSibling : null;
    }
    if ($("[data-code]", tb.lastElementChild).value) addRow();
    totals();
  }
  $("[data-pad-add]").addEventListener("click", () => { addRow(); $("[data-code]", tb.lastElementChild).focus(); });
  $("[data-pad-clear]").addEventListener("click", () => { tb.innerHTML = ""; for (let i = 0; i < 5; i++) addRow(); totals(); });
  $("[data-pad-paste]").addEventListener("click", async () => { try { fill(await navigator.clipboard.readText()); } catch { toast(`Vložte kódy zkratkou ${pasteKey} do prvního prázdného řádku.`); $$("[data-code]", tb).find((i) => !i.value)?.focus(); } });
  $("[data-pad-csv]").addEventListener("change", async (ev) => { const f = ev.target.files[0]; if (f) fill(await f.text()); });
  sum.addEventListener("click", (ev) => {
    if (!ev.target.closest("[data-pad-cart]")) return;
    // the rows that went in leave the pad; a row whose code fits several products stays, marked, until one is picked
    let n = 0; const left = [];
    for (const tr of $$("tr", tb)) {
      const code = $("[data-code]", tr).value.trim(); if (!code) continue;
      if (tr._amb) { left.push(tr); continue; }
      const q = wholeQty($("[data-q]", tr).value);
      const p = tr._p || { id: -Math.floor(Math.random() * 1e9), n: `Poptávka: ${code}`, c: code, b: "", pr: null, s: "out", u: "rychla-objednavka.html", img: "assets/img/none.svg" };
      cart.add(p, q); n++;
      tr.remove();
    }
    for (const tr of left) { tr.classList.add("amb"); $("[data-res]", tr).insertAdjacentHTML("afterbegin", `<strong>Nevloženo.</strong> `); }
    while ($$("tr", tb).length < 5) addRow();
    if ($("[data-code]", tb.lastElementChild).value) addRow();
    hint();
    totals();
    const k = left.length;
    toast(`${n ? `${pl(n)} v ${basketIn()}.` : `Nic jsme nevložili.`}${k ? ` ${k} ${k === 1 ? "řádek čeká" : k < 5 ? "řádky čekají" : "řádků čeká"} na výběr přesného kódu.` : ""}${n ? ` <a href="${url("kosik.html")}" style="color:#fff">${isCustomer() ? "Zobrazit košík" : "Zobrazit poptávku"}</a>` : ""}`);
    ($("[data-pick]", left[0] || tb) || $("[data-code]", tb))?.focus();
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
const searchExt = { bar: null }; // src/parts/30-filters.js: the result filters (groups, manufacturers, stock, price)
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
    // products first: someone searching "bezpečnostní relé" wants the part. Matching articles (six, the rest on request) take
    // a side column from 1400 px and follow the products below that, where a link by the products heading points to them
    const artsHtml = arts.length ? `<aside class="sr-arts" id="sr-arts" aria-labelledby="sr-arts-h"><h2 id="sr-arts-h">Články a stránky<span class="count">${nf.format(arts.length)}</span></h2>
      <ul class="sr-list">${arts.map((a, i) => `<li${i >= 6 ? " hidden" : ""}><a href="${url(a.u)}">${icon("file")}<span class="t">${hl(a.t, q)}</span><span class="k">${ART_KIND[a.k] || ""}</span></a></li>`).join("")}</ul>
      ${arts.length > 6 ? `<button type="button" class="linkbtn sr-more" data-more-arts>Zobrazit všech ${nf.format(arts.length)}</button>` : ""}</aside>` : "";
    const cols = (main) => (arts.length ? `<div class="sr-cols"><div class="sr-main">${main}</div>${artsHtml}</div>` : main);
    const bindArts = () => $("[data-more-arts]", root)?.addEventListener("click", (ev) => {
      const more = $$(".sr-list li[hidden]", root);
      more.forEach((li) => (li.hidden = false));
      $("a", more[0])?.focus();
      ev.currentTarget.remove();
    });
    if (!res.length) {
      root.innerHTML = cols(q ? `<div class="empty-state"><h3>Pro „${esc(q)}“ nemáme nic v e-shopu</h3><p>Sortiment výrobců je širší než e-shop. Pošlete nám kód a ověříme cenu i termín dodání.</p><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn primary" href="${url("rychla-objednavka.html")}?k=${encodeURIComponent(q)}">Poptat kód ${esc(q)}</a><a class="btn" href="${url("katalog/index.html")}">Procházet katalog</a></div></div>` : `<p class="muted">Napište do vyhledávání kód, název nebo výrobce.</p>`);
      bindArts();
      return;
    }
    // one result row; the filter bar (searchExt.bar, src/parts/30-filters.js) renders the rows that match it
    const rowHtml = (p) => `<tr data-id="${p.id}" data-sub="${esc(p.sub)}" data-s="${p.s}"><td class="c-img"><a href="${url(p.u)}" tabindex="-1" aria-hidden="true"><img src="${url(p.img)}" alt="" width="64" height="64" loading="lazy"></a></td>
        <td class="c-name"><a href="${url(p.u)}">${hl(p.n, q)}</a><div class="code">${p.c ? `<span>Kód <b>${hl(p.c, q)}</b></span>` : ""}<span class="brand">${esc(p.b)}</span></div></td>
        <td class="c-par">${p.pa.slice(0, 3).map(([k, v]) => `${esc(k)}: <b>${esc(v)}</b>`).join("<br>")}</td>
        <td class="c-stock"><span class="stock ${p.s}">${stockTxt(p.s)}</span></td>
        <td class="c-price">${p.pr != null ? `<span class="price" data-p="${p.pr}" data-brand="${esc(p.b)}">${czk(p.pr)}</span><span class="price-note" data-pv="${p.pr}">${czk(p.pr * 1.21)} s DPH</span>` : `<span class="ask">Cena na dotaz</span>`}</td>
        <td class="c-buy"><form class="buy" data-id="${p.id}"><div class="qty sm"><button type="button" data-step="-1" aria-label="Méně">${icon("minus", "sm")}</button><input type="number" name="qty" value="1" min="1" max="9999" aria-label="Množství"><button type="button" data-step="1" aria-label="Více">${icon("plus", "sm")}</button></div><button class="btn ${p.pr != null ? "primary " : ""}sm" type="submit">${p.pr != null ? `${icon("cart")}<span>${buyLabel()}</span>` : "Poptat"}</button></form></td></tr>`;
    root.innerHTML = cols((arts.length ? `<div class="sr-hrow"><h2 class="sr-h">Produkty<span class="count">${nf.format(res.length)}</span></h2><a class="sr-jump" href="#sr-arts">Články a stránky (${nf.format(arts.length)})</a></div>` : "") + `<div class="sr-bar" data-sbar></div>
      <table class="ptable"><thead><tr><th class="c-img"><span class="sr-only">Obrázek</span></th><th>Produkt</th><th>Parametry</th><th>Dostupnost</th><th style="text-align:right">Cena bez DPH</th><th><span class="sr-only">Nákup</span></th></tr></thead><tbody>
      ${res.slice(0, 300).map(rowHtml).join("")}
      </tbody></table>`);
    applyPrices(root);
    bindArts();
    searchExt.bar?.({ bar: $("[data-sbar]", root), tbody: $("tbody", root), res, idx, rowHtml });
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
    const id = tr.dataset.id, r = rows[id], t = $("[data-table]");
    if (!r || (t._hit ? !t._hit(id) : tr.hidden)) continue; // a folded line's passing rows print too (30-filters.js)
    const key = r.f || "_singles";
    if (!fams.has(key)) fams.set(key, []);
    fams.get(key).push({ id, ...r });
  }
  const keyCols = $$("[data-table] thead th[data-col^='p:']").map((th) => th.dataset.col.slice(2));
  const famBlurb = (f, n) => { const b = $(`tr.fam[data-fam="${f}"] .line-blurb`)?.textContent; return b && `${$(`tr.fam[data-fam="${f}"] .brand`)?.textContent || ""}, ${pl(n, "varianta", "varianty", "variant")}. ${b}`; };
  const table = (items, names) => `<table class="sh-var"><thead><tr><th>Objednací kód</th>${names ? "<th>Název</th>" : ""}${keyCols.map((k) => `<th>${esc(k)}</th>`).join("")}<th>Dostupnost</th><th class="r">Cena bez DPH</th></tr></thead><tbody>
    ${items.map((x) => `<tr><td class="code"><b>${esc(x.c || "–")}</b></td>${names ? `<td>${esc(x.n)}</td>` : ""}${keyCols.map((k) => `<td>${esc(x.p[k] ?? "–")}</td>`).join("")}<td>${stockTxt(x.s).toLowerCase()}</td><td class="r">${x.pr == null ? "na dotaz" : czk(isCustomer() ? yourPrice(x.pr, x.b) : x.pr)}</td></tr>`).join("")}</tbody></table>`;
  // the rows in no line ("_singles", FEATURES 5a.6) print last, as on the page: no photo, the page's block title, names shown
  const blocks = [...fams.entries()].map(([k, items]) => {
    const head = items[0], single = k === "_singles";
    if (single && fams.size === 1) return `<section class="pc-fam singles${items.length > 14 ? " long" : ""}">${table(items, true)}</section>`; // a group with no line
    const title = single ? $('tr.fam[data-fam="_singles"] .fam-head h3')?.textContent || "Samostatné produkty" : $(`tr.fam[data-fam="${k}"] .line-name`)?.textContent || head.n; // the line's name
    const pic = single ? "" : `<img src="${url(`assets/img/p/${head.id}-m.webp`)}" alt="">`;
    return `<section class="pc-fam${single ? " singles" : ""}${items.length > 14 ? " long" : ""}"><div class="pc-famhead">${pic}<div><h3>${esc(title)}</h3><p>${esc(single ? `${pl(items.length)}, ${items.length === 1 ? "která" : "které"} nepatří do žádné řady v této skupině.` : famBlurb(k, items.length) || `${head.b}, ${pl(items.length, "varianta", "varianty", "variant")}`)}</p></div></div>${table(items, single || items.some((x) => !x.c))}</section>`; // catalogue rows without a code are told apart by name
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
initProduct();
initCart();
initCheckout();
queueMicrotask(initAccount); // after src/parts/85-account.js has registered its accountExt hooks
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

// ---- parts/10-nav.js
{
// Catbar dropdowns (Podpora, Novinky, Firma), the phone "Menu" sheet and the account menu: header() in build.py.
// Each is a popover opened by its popovertarget button, like the mega menu, so the browser handles click, Enter/Space,
// Escape, outside click and keeps one open at a time. This adds what it doesn't: placement under the trigger (page
// coordinates, no CSS anchor positioning needed), aria-expanded, arrow keys, focus back to the trigger on Escape,
// closing when Tab leaves, the current page's item, the account menu's details and sign-out, and the footer form.

const pops = $$(".dd-pop, .acc-pop, .nav-sheet");
const trigOf = (p) => $(`[popovertarget="${p.id}"]`);
const isOpen = (p) => { try { return p.matches(":popover-open"); } catch { return p.classList.contains(":popover-open"); } };
const itemsOf = (p) => $$("a[href], button:not([disabled])", p).filter((x) => x.getClientRects().length);
let openPop = null;

function place(p) {
  const t = trigOf(p), r = t.getBoundingClientRect(), bar = $(".catbar").getBoundingClientRect();
  if (p.classList.contains("nav-sheet")) { p.style.setProperty("--ns-top", `${Math.max(0, bar.bottom)}px`); return; }
  const w = document.documentElement.clientWidth, s = p.style;
  const pw = parseFloat(getComputedStyle(p).width) || 300; // a fixed-width panel (Oblasti) reports its width while closed
  // dropdowns hang from the bar, text in line with the trigger's; the account menu and anything near the right edge align
  // right, and a wide panel that fits neither way is kept on screen
  s.top = `${(p.classList.contains("dd-pop") ? bar.bottom : r.bottom + 4) + scrollY}px`;
  if (p.classList.contains("acc-pop") || (r.left + pw > w - 8 && r.right - pw >= 8)) { s.left = "auto"; s.right = `${Math.max(8, w - r.right)}px`; }
  else { s.right = "auto"; s.left = `${Math.max(8, Math.min(r.left, w - 8 - pw)) + scrollX}px`; }
}

function fillAccount() {
  const u = user();
  if (!u) return;
  $("[data-acc-co]").textContent = u.company;
  $("[data-acc-mail]").textContent = u.email || "";
  $("[data-acc-level]").textContent = u.level || "";
  $("[data-acc-orders]").textContent = store.get("orders", []).length || "";
}

for (const p of pops) {
  const t = trigOf(p);
  if (!t) continue;
  p.addEventListener("beforetoggle", (ev) => { if (ev.newState === "open") { place(p); if (p.id === "acc-pop") fillAccount(); } });
  p.addEventListener("toggle", (ev) => {
    const on = ev.newState === "open";
    t.setAttribute("aria-expanded", on);
    if (on) openPop = p; else if (openPop === p) openPop = null;
  });
  // ArrowDown / ArrowUp on the trigger opens the panel and enters it (Enter and Space only toggle, natively)
  t.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    ev.preventDefault();
    if (!isOpen(p)) t.click();
    const list = itemsOf(p);
    (ev.key === "ArrowUp" ? list.at(-1) : list[0])?.focus();
  });
  p.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); t.focus(); if (isOpen(p)) p.hidePopover(); return; }
    const list = itemsOf(p), i = list.indexOf(document.activeElement);
    const k = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[ev.key];
    if (k === undefined || i < 0) return;
    ev.preventDefault();
    list[(k + list.length) % list.length].focus();
  });
  // Tab past the last link (or Shift+Tab before the trigger) closes it; a click on plain text inside does not
  const away = (ev) => { const to = ev.relatedTarget; if (to && to !== t && !p.contains(to) && isOpen(p)) p.hidePopover(); };
  p.addEventListener("focusout", away);
  t.addEventListener("focusout", away);
  // a link that only changes the hash (ucet.html#objednavky on the account page) leaves the page as it is: close the panel
  p.addEventListener("click", (ev) => { if (ev.target.closest("a[href]") && isOpen(p)) p.hidePopover(); });
}
addEventListener("resize", () => {
  if (!openPop) return;
  if (!trigOf(openPop).getClientRects().length) { if (isOpen(openPop)) openPop.hidePopover(); } // e.g. the phone sheet when the window grows past 760 px
  else place(openPop);
});

// The current page's item: the longest link that is this page or a folder above it (podpora/aplikace.html for
// podpora/aplikace/idec.html). Its group's trigger gets aria-current too; header() already marks the group from page().
{
  const here = location.pathname, links = $$("a[data-nav]");
  let best = "", top = 0;
  for (const a of links) {
    const path = new URL(a.href).pathname, stem = path.replace(/\.html$/, "/");
    const s = path === here ? 1e6 : here.startsWith(stem) ? stem.length : 0;
    if (s > top) { top = s; best = path; }
  }
  if (best) {
    const hit = links.filter((a) => new URL(a.href).pathname === best);
    hit.forEach((a) => a.setAttribute("aria-current", "page"));
    const btn = hit.map((a) => a.closest(".dd")?.querySelector(".dd-btn")).find(Boolean);
    if (btn) { $$(".dd-btn[aria-current]").forEach((b) => b.removeAttribute("aria-current")); btn.setAttribute("aria-current", "true"); }
    $(".ns-btn")?.setAttribute("aria-current", "true");
  }
}

// Sign out from the account menu: the same as the button on ucet.html, then focus goes to the "Přihlásit" link
$("[data-acc-logout]")?.addEventListener("click", () => {
  const ap = $("#acc-pop");
  if (isOpen(ap)) ap.hidePopover();
  store.set("user", null);
  renderHeader();
  applyPrices();
  accountExt.refresh();
  $(".tool[data-account]")?.focus();
  toast("Jste odhlášeni. Katalog teď ukazuje ceníkové ceny.");
});

// The footer form subscribes to both lists (E-novinky and REMinfo) on the shared "newsletter" record (60-company.js,
// account settings). Capture phase: app.js's data-fake-form handler then replaces the form with its "Hotovo" line.
document.addEventListener("submit", (ev) => {
  const f = ev.target.closest?.("form[data-nl-both]");
  if (f && f.checkValidity()) store.set("newsletter", { email: f.email.value.trim(), reminfo: true, enovinky: true });
}, true);

}

// ---- parts/12-mega.js
{
// Mega menu (REVIEW 2026-10-29 #19): mega.html arrives on first open and its panels now show a product with a price, so
// a signed-in customer's own price is applied to it as on the page (applyPrices in app.js).
const megaEl = document.getElementById("mega");
if (megaEl) new MutationObserver(() => applyPrices(megaEl)).observe(megaEl, { childList: true });

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

// ---- parts/22-strips.js
{
// Card strips (REVIEW 2026-10-29 #11; styles in 22-strips.css). A strip of cards that does not fit its row is sized to
// whole cards plus about half of the next one, so the cut reads as "more this way" and never as a card clipped by a few
// pixels; the edge it continues past fades (the fade follows how much of the cut card is hidden, so it never jumps while
// scrolling); and from 761 px previous / next buttons join its heading row and move it by the cards in view. Phones
// swipe. A strip that fits is left as it is.
const PEEK = 0.45, FADE = 48;
const still = matchMedia("(prefers-reduced-motion: reduce)");
const navs = new WeakMap();
let stripUid = 0;

function stripNav(s) {
  let head = s.previousElementSibling;
  if (!head) return null;
  if (/^H[2-4]$/.test(head.tagName)) { // a bare heading: put it in a row the buttons can share, spacing unchanged
    const row = document.createElement("div");
    row.className = "strip-head";
    row.style.marginBottom = getComputedStyle(head).marginBottom;
    head.style.marginBottom = "0";
    head.before(row);
    row.append(head);
    head = row;
  } else if (!head.querySelector("h2, h3")) return null;
  const h = head.querySelector("h2, h3");
  h.id ||= `strip-h-${++stripUid}`;
  s.id ||= `strip-${++stripUid}`;
  head.classList.add("has-strip-nav");
  const nav = document.createElement("div");
  nav.className = "strip-nav";
  nav.setAttribute("role", "group");
  nav.setAttribute("aria-labelledby", h.id);
  nav.innerHTML = `<button class="btn strip-btn prev" type="button" aria-controls="${s.id}" aria-label="Předchozí produkty"></button>`
    + `<button class="btn strip-btn next" type="button" aria-controls="${s.id}" aria-label="Další produkty"></button>`;
  nav.addEventListener("click", (ev) => {
    const b = ev.target.closest(".strip-btn");
    if (!b || b.getAttribute("aria-disabled") === "true") return;
    const cw = s.firstElementChild?.getBoundingClientRect().width || s.clientWidth;
    const n = Math.max(1, Math.floor((s.clientWidth + 1) / cw)); // the whole cards in view
    s.scrollBy({ left: (b.classList.contains("next") ? 1 : -1) * n * cw, behavior: still.matches ? "auto" : "smooth" });
  });
  head.append(nav);
  return nav;
}

function stripEdges(s) {
  const over = s.hasAttribute("data-over");
  const w = s.clientWidth, x = Math.abs(s.scrollLeft), max = s.scrollWidth - w;
  const cw = s.firstElementChild?.getBoundingClientRect().width || w;
  // hidden and visible parts of the card cut at each edge; the fade is the smaller of them, capped at 48 px
  const l = x % cw, r = (x + w) % cw;
  s.style.setProperty("--fade-l", `${over && x > 1 ? Math.min(FADE, l, cw - l) : 0}px`);
  s.style.setProperty("--fade-r", `${over && x < max - 1 ? Math.min(FADE, r, cw - r) : 0}px`);
  const nav = navs.get(s);
  if (!nav) return;
  nav.hidden = !over;
  nav.firstElementChild.setAttribute("aria-disabled", String(!(over && x > 1)));
  nav.lastElementChild.setAttribute("aria-disabled", String(!(over && x < max - 1)));
}

function stripFit(s) {
  s.style.removeProperty("grid-auto-columns");
  const st = getComputedStyle(s);
  if (st.overflowX === "visible" || !st.gridAutoFlow.startsWith("column")) return; // laid out as a grid, not a strip
  const w = s.clientWidth, over = w > 0 && s.scrollWidth > w + 1;
  s.toggleAttribute("data-over", over);
  if (over) {
    const n = Math.max(1, Math.floor(w / (parseFloat(st.getPropertyValue("--strip-min")) || 200) - PEEK));
    s.style.gridAutoColumns = `calc(100% / ${n + PEEK})`;
    if (!navs.has(s)) { const nav = stripNav(s); if (nav) navs.set(s, nav); }
  }
  stripEdges(s);
}

const strips = $$(".strip");
if (strips.length && "ResizeObserver" in window) {
  // refit when a strip's width changes, in the next frame: refitting inside the observer changes the strip's height
  // (wider cards, taller photos), which Safari reports as a ResizeObserver loop
  const seen = new WeakMap();
  const ro = new ResizeObserver((es) => es.forEach(({ target: s, contentRect: { width } }) => {
    if (seen.get(s) !== width) { seen.set(s, width); requestAnimationFrame(() => stripFit(s)); }
  }));
  const mo = new MutationObserver((ms) => new Set(ms.map((m) => m.target)).forEach(stripFit)); // "Naposledy prohlížené" fills later
  for (const s of strips) {
    stripFit(s);
    ro.observe(s);
    mo.observe(s, { childList: true });
    let raf = 0;
    s.addEventListener("scroll", () => { raf ||= requestAnimationFrame(() => { raf = 0; stripEdges(s); }); }, { passive: true });
    // Tab into the half-shown card: bring the whole card in, not just its title link, which sits in the fade
    s.addEventListener("focusin", (ev) => {
      const c = ev.target.closest(".strip > *"), sr = s.getBoundingClientRect(), cr = c?.getBoundingClientRect();
      if (c && s.hasAttribute("data-over") && (cr.left < sr.left - 1 || cr.right > sr.right + 1)) c.scrollIntoView({ block: "nearest", inline: "nearest", behavior: still.matches ? "auto" : "smooth" });
    });
  }
}

}

// ---- parts/30-filters.js
{
// Listing pages (category, subcategory, brand): the filter rail, chips, URL state with back/forward, sorting and the
// phone drawer. Filter system v2 (FEATURES.md 5a.9, DESIGN.md "Filters"); moved here from app.js initListing.
//
// build_filters.py renders the rail and adds each row's facet values to #facets: product id -> { b, s, pr, sub, p, n,
// c, f, x }, where x[field] holds the row's options for a checkbox facet (strings; a row matches when any of them is
// checked, OR inside a facet, AND across facets) or [lo, hi, lo, hi…] for a range facet (data-match on the range box:
// covers = the row's range holds the visitor's from–to, overlap = any overlap, hi = its upper end lies in from–to).
// Counts are live: each option counts the rows that pass every other facet. A family header (tr.fam[data-fam=K],
// "_singles" included) shows while any row passing the filters has f == K.
// Product lines (FEATURES.md 5a.11): a line is one summary row (tr.fam.line) with its variants folded under it. Its
// variant count, stock and lowest price follow the rows that pass the filters; unfolded, it shows only those rows.
// Lines unfold by themselves when the filters leave few rows (AUTO_N) or only one line; a visitor's own fold or unfold,
// and "Rozbalit řady", win over that and live in history.state, so back from a product page finds them as left.

function initListing() {
  const data = $("#facets"), table = $("[data-table]"), form = $("[data-filters]");
  if (!data || !table || !form) return;
  const rows = JSON.parse(data.textContent);
  const tbody = $("tbody", table);
  // Product rows are fixed slots: sorting moves a product's cells between slots, never the <tr> or its <form>.
  // Re-inserting 400+ buy forms makes Chrome's autofill rescan every form on the page (~0.5 s at 4× CPU).
  const slots = $$("tr[data-id]", tbody);
  const trs = new Map(slots.map((tr) => [tr.dataset.id, tr])); // product id → the slot showing it (kept live)
  const famRows = $$("tr.fam", tbody);
  const lineRows = famRows.filter((tr) => tr.classList.contains("line"));
  for (const tr of slots) tr._fo = tr.classList.contains("folded");
  const lineKeys = new Set(lineRows.map((tr) => tr.dataset.fam));
  const allBtn = $("[data-lines-all]");
  const sec = table.closest("section") || table;
  const nEl = $("[data-result-n]"), chips = $("[data-chips]"), empty = $("[data-empty]"), sortSel = $("[data-sort]");
  const status = $("[data-fstatus]"), badges = $$("[data-fcount]"), undo = $("[data-undo]", empty || document);
  const resets = $$("[data-reset]");
  const fshow = $$(".fshow");
  const fl = $("#filters"), scrim = $(".filters-scrim"), openers = $$("[data-open-filters]");

  /* ---- the rail, read once */
  const opts = $$(".fopt", form).map((el) => { const cb = $("input", el); return { el, cb, name: cb.name, value: cb.value, n: $("[data-n]", el), lab: $(".l", el).textContent, c: +$("[data-n]", el).textContent }; });
  const setNames = [...new Set(opts.map((o) => o.name))];
  const titleOf = (el) => el.closest("details")?.querySelector("summary")?.firstChild?.textContent.trim() || "";
  const ranges = $$("[data-range]", form).map((box) => {
    const [lo, hi] = $$("input", box);
    const name = box.dataset.range;
    return { box, name, lo, hi, match: box.dataset.match || "overlap", unit: $(".u", box)?.textContent || "", title: titleOf(box), keys: name === "price" ? ["od", "do"] : [lo.name, hi.name] };
  });
  const sw = { stock: form.elements.stock, priced: form.elements.priced };
  const swN = Object.fromEntries(Object.entries(sw).map(([k, i]) => [k, i && $("[data-n]", i.closest("label"))]));
  const groups = $$("details[data-facet], details[data-extra]", form).map((d) => ({ d, sel: $(":scope > summary [data-sel]", d), k: -1 }));
  const nf4 = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 4 });

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  /* ---- rows: values per facet, prepared once */
  const R = Object.entries(rows);
  for (const [, r] of R) {
    r.hay = norm(`${r.n} ${r.c} ${r.b} ${r.x?.rada?.[0] || ""} ${Object.values(r.p).join(" ")}`);
    r.v = { brand: r.b ? [r.b] : null, sub: [r.sub], price: r.pr == null ? null : [r.pr, r.pr], ...(r.x || {}) };
  }

  /* ---- state */
  const num = (s) => { s = String(s).replace(/\s/g, "").replace(",", ".").replace(/^[\u2212–]/, "-"); return s === "" ? null : Number.isFinite(+s) ? +s : NaN; };
  function read() {
    const st = { q: norm(form.elements.q?.value || "").trim(), stock: !!sw.stock?.checked, priced: !!sw.priced?.checked, sets: new Map(), ranges: new Map() };
    st.terms = st.q ? st.q.split(/\s+/) : [];
    for (const o of opts) if (o.cb.checked) { if (!st.sets.has(o.name)) st.sets.set(o.name, new Set()); st.sets.get(o.name).add(o.value); }
    for (const g of ranges) {
      const lo = num(g.lo.value), hi = num(g.hi.value);
      for (const [i, x] of [[g.lo, lo], [g.hi, hi]]) if (Number.isNaN(x) !== i.hasAttribute("aria-invalid")) i.toggleAttribute("aria-invalid", Number.isNaN(x));
      const a = Number.isNaN(lo) ? null : lo, b = Number.isNaN(hi) ? null : hi;
      if (a != null || b != null) st.ranges.set(g.name, [a ?? -Infinity, b ?? Infinity, g.match, a, b]);
    }
    return st;
  }
  const inRange = (xs, lo, hi, m) => {
    if (!xs) return false;
    for (let i = 0; i < xs.length; i += 2) {
      const a = xs[i], b = xs[i + 1];
      if (m === "covers" ? (lo === -Infinity || a <= lo) && (hi === Infinity || b >= hi) : m === "hi" ? b >= lo && b <= hi : a <= hi && b >= lo) return true;
    }
    return false;
  };
  const TWO = {}; // fails two or more facets: counts nowhere
  function check(r, st) { // → null (passes), the one facet the row fails, or TWO
    let miss = null;
    if (st.stock && r.s !== "in") miss = "stock";
    if (st.priced && r.pr == null) { if (miss) return TWO; miss = "priced"; }
    if (st.terms.length) for (const t of st.terms) if (!r.hay.includes(t)) { if (miss) return TWO; miss = "q"; break; }
    for (const [k, [lo, hi, m]] of st.ranges) if (!inRange(r.v[k], lo, hi, m)) { if (miss) return TWO; miss = k; }
    for (const [k, set] of st.sets) {
      const vs = r.v[k];
      let hit = false;
      if (vs) for (const v of vs) if (set.has(v)) { hit = true; break; }
      if (!hit) { if (miss) return TWO; miss = k; }
    }
    return miss;
  }

  /* ---- chips, in the order the filters were set */
  let act = [];
  const rangeText = (g, a, b) => {
    const u = g.unit ? `\u00a0${g.unit}` : "";
    return a != null && b != null ? `${nf4.format(a)}${a < 0 || b < 0 ? " až " : "–"}${nf4.format(b)}${u}` : a != null ? `od ${nf4.format(a)}${u}` : `do ${nf4.format(b)}${u}`;
  };
  function active(st) { // → [[key, label]] in DOM order
    const out = [];
    if (st.q) out.push(["q", `„${form.elements.q.value.trim()}“`]);
    if (st.stock) out.push(["stock", "Jen skladem"]);
    if (st.priced) out.push(["priced", "Jen s cenou online"]);
    for (const o of opts) if (o.cb.checked) out.push([`${o.name}\u0001${o.value}`, o.name.startsWith("p:") ? `${o.name.slice(2)}: ${o.lab}` : o.lab]);
    for (const g of ranges) { const x = st.ranges.get(g.name); if (x) out.push([`r\u0001${g.name}`, `${g.title}: ${rangeText(g, x[3], x[4])}`]); }
    return out;
  }
  function clear(key) {
    if (key === "stock" || key === "priced") sw[key].checked = false;
    else if (key === "q") form.elements.q.value = "";
    else if (key.startsWith("r\u0001")) { const g = ranges.find((x) => x.name === key.slice(2)); if (g) g.lo.value = g.hi.value = ""; }
    else { const [name, value] = key.split("\u0001"); const o = opts.find((x) => x.name === name && x.value === value); if (o) o.cb.checked = false; }
  }

  /* ---- URL: a history entry per change (back/forward walk the filters), typing replaces its own entry */
  function urlOf(st) {
    const sp = new URLSearchParams();
    if (st.stock) sp.set("skladem", "1");
    if (st.priced) sp.set("cena", "1");
    const q = form.elements.q?.value.trim();
    if (q) sp.set("hledat", q);
    for (const o of opts) if (o.cb.checked) sp.append(o.name, o.value);
    for (const g of ranges) [g.lo, g.hi].forEach((i, j) => { const v = i.value.trim(); if (v && !Number.isNaN(num(v))) sp.set(g.keys[j], v); });
    if (sortSel?.value) sp.set("razeni", sortSel.value);
    const s = sp.toString();
    return location.pathname + (s ? `?${s}` : "");
  }
  // pushState / replaceState restyle every link on the page in Chrome (~50 ms at 4× CPU), so they wait for a pause
  let urlNext = null, urlPush = false, lastTyped = null, lastTypedAt = 0;
  const flushURL = () => {
    if (urlNext == null) return;
    if (urlNext !== location.pathname + location.search) history[urlPush ? "pushState" : "replaceState"](history.state, "", urlNext + location.hash);
    urlNext = null; urlPush = false;
  };
  let urlT;
  const writeURL = (u, push) => { urlNext = u; urlPush ||= push; clearTimeout(urlT); urlT = setTimeout(flushURL, 350); }; // after paint, once a burst of clicks settles
  addEventListener("pagehide", flushURL);

  /* ---- apply */
  let announced = null, sayT;
  function apply({ push = null, counts = true, say = false, now = false } = {}) {
    // read layout before writing: a change made deep in the results brings their top back into view
    const top = sec.getBoundingClientRect().top;
    const jump = say && push != null && !fl.classList.contains("open") && top < 0;
    const st = read();
    const cnt = new Map(setNames.map((k) => [k, new Map()]));
    const okOf = new Map();
    let n = 0, nStock = 0, nPriced = 0;
    for (const [id, r] of R) {
      const miss = check(r, st);
      const ok = miss === null;
      okOf.set(id, ok);
      if (ok) { n++; if (r.s === "in") nStock++; if (r.pr != null) nPriced++; }
      if (!counts || miss === TWO) continue;
      for (const k of setNames) {
        if (miss !== null && miss !== k) continue;
        const vs = r.v[k];
        if (!vs) continue;
        const m = cnt.get(k);
        for (const v of vs) m.set(v, (m.get(v) || 0) + 1);
      }
    }
    visible = okOf;
    if (lineRows.length) {
      const live = new Set(); let tops = 0;
      for (const [id, ok] of okOf) if (ok) { const g = groupOf(id); if (g === "_singles") tops++; else if (!live.has(g)) { live.add(g); tops++; } }
      const any = st.q || st.stock || st.priced || st.sets.size || st.ranges.size;
      auto = (any && n <= AUTO_N) || (tops === 1 && live.size === 1);
    }
    arrange(now, jump ? 0 : top);
    paintLines();
    if (counts) {
      for (const o of opts) {
        const c = cnt.get(o.name).get(o.value) || 0;
        if (c !== o.c) { o.c = c; o.n.textContent = c; }
        const off = c === 0 && !o.cb.checked;
        if (off !== o.cb.disabled) { o.cb.disabled = off; o.el.classList.toggle("zero", off); }
      }
      for (const [k, c] of [["stock", nStock], ["priced", nPriced]]) if (sw[k]) { swN[k].textContent = c; sw[k].disabled = !c && !sw[k].checked; }
    }
    const txt = pl(n);
    if (nEl.textContent !== txt) nEl.textContent = txt;
    fshow.forEach((b) => (b.textContent = n ? `Zobrazit ${txt}` : "Nic neodpovídá, upravte filtry"));
    empty.hidden = n > 0;
    table.hidden = n === 0;
    if (n && !gridded) nextFrame().then(grid);
    // chips: keep the order filters were set in
    const list = active(st), keys = new Set(list.map(([k]) => k)), label = new Map(list);
    act = act.filter((k) => keys.has(k));
    for (const [k] of list) if (!act.includes(k)) act.push(k);
    const html = act.map((k) => `<button type="button" class="chip" data-chip="${esc(k)}" aria-label="Zrušit filtr ${esc(label.get(k))}">${esc(label.get(k))}${icon("x")}</button>`).join("")
      + (act.length > 1 ? `<button type="button" class="linkbtn chips-reset" data-reset-all>Zrušit vše</button>` : "");
    if (chips.innerHTML !== html) chips.innerHTML = html;
    resets.forEach((b) => (b.hidden = !act.length && b.closest(".filters") != null));
    badges.forEach((b) => { b.hidden = !act.length; b.lastChild.textContent = act.length; });
    if (undo) {
      const last = act.at(-1);
      undo.hidden = act.length < 2;
      if (last) undo.textContent = `Zrušit poslední filtr: ${label.get(last)}`;
      undo.dataset.key = last || "";
    }
    // how many filters each group holds, also on a closed group
    for (const g of groups) {
      let k = 0;
      if (g.d.dataset.extra != null) for (const d of $$("details[data-facet]", g.d)) k += selIn(d.dataset.facet, st);
      else k = selIn(g.d.dataset.facet, st);
      if (k !== g.k) { g.k = k; g.sel.hidden = !k; g.sel.textContent = k; }
    }
    if (say) { clearTimeout(sayT); sayT = setTimeout(() => { const t = n ? `Zobrazeno ${txt}` : "Filtrům nic neodpovídá"; if (t !== announced) status.textContent = announced = t; }, 500); }
    if (push != null) writeURL(urlOf(st), push);
    if (jump) sec.scrollIntoView({ block: "start" });
  }
  const selIn = (name, st) => (st.sets.get(name)?.size || 0) + (st.ranges.has(name) ? 1 : 0);

  /* ---- rows: fixed slots arranged for the sort order and the filters */
  // Product rows are fixed slots: a state (sort order + filters) is shown by moving products' cells between slots, never
  // the <tr> or its <form> (re-inserting 400+ buy forms makes Chrome's autofill rescan every form, ~0.5 s at 4× CPU).
  // Showing a row costs ~1 ms of style work at 4× CPU and hiding one ~0.25 ms, so only the first screenful (12 visible
  // rows) is arranged in the frame that answers a click; the rest follows in chunks after paint. The column widths are
  // fixed once the rows are a grid (below), so rows changing below the fold never move the ones in view.
  const ids = slots.map((tr) => tr.dataset.id); // "Doporučené" order = the slots' original order
  const at = ids.slice(), slotOf = new Map(ids.map((id, i) => [id, i])); // slot → product, product → slot
  const orders = new Map([["", ids]]);
  const coll = new Intl.Collator("cs", { numeric: true });
  // lines (5a.6, 5a.11): a grouped table (every listing since 5a.11) sorts inside each line, orders the lines and the
  // rows in no line by their best row, and in "Doporučené" keeps the rows in no line last, as a block; it never turns flat.
  const grouped = table.classList.contains("grouped");
  const groupOf = (id) => { const f = String(rows[id]?.f ?? "_singles"); return lineKeys.has(f) ? f : "_singles"; };
  function orderFor(key) {
    if (orders.has(key)) return orders.get(key);
    const nk = { "price-asc": (r) => r.pr ?? Infinity, "price-desc": (r) => -(r.pr ?? -1), stock: (r) => (r.s === "in" ? 0 : 1) }[key];
    const k = new Map();
    for (const id of ids) { const r = rows[id] || { n: "", p: {} }; k.set(id, nk ? nk(r) : key === "name" ? r.n : r.p[key.slice(2)] ?? null); }
    const cmp = nk ? (a, b) => k.get(a) - k.get(b)
      : (a, b) => { const x = k.get(a), y = k.get(b); return x == null || y == null ? (x == null) - (y == null) : coll.compare(String(x), String(y)); }; // empty values last
    let o;
    if (grouped) {
      const g = new Map();
      // sorted by a key, a row in no line stands on its own among the lines (its block header hides); "Doporučené" keeps the block last
      for (const id of ids) { let f = groupOf(id); if (f === "_singles" && key) f = `_s${id}`; if (!g.has(f)) g.set(f, []); g.get(f).push(id); }
      const lists = [...g.entries()].map(([f, l]) => [f, l.sort(cmp)]); // Array sort is stable: ties keep the page order
      lists.sort(([fa, a], [fb, b]) => (fa === "_singles") - (fb === "_singles") || cmp(a[0], b[0]));
      o = lists.flatMap(([, l]) => l);
    } else o = ids.slice().sort(cmp);
    orders.set(key, o);
    return o;
  }
  let ui, cellsOf, buyOf; // built on the first move
  function prep() {
    ui = slots.map((tr) => { const td = tr.lastElementChild, f = $("form", td); return { td, form: f, qty: f?.elements.qty, btn: f && $("button[type=submit]", f) }; });
    cellsOf = new Map(slots.map((tr, i) => [ids[i], [...tr.children].slice(0, -1)]));
    buyOf = new Map(slots.map((tr, i) => [ids[i], ui[i].btn ? { mode: ui[i].form.dataset.mode, cls: ui[i].btn.className.replace(/\s*is-done/, ""), kids: [...ui[i].btn.childNodes], sig: ui[i].btn.innerHTML } : null]));
    ui.forEach((u, i) => (u.sig = buyOf.get(ids[i])?.sig));
  }
  function show(i, id) { // slot i now holds product id's cells: retarget its row and buy form
    const tr = slots[i], u = ui[i], b = buyOf.get(id);
    tr.dataset.id = id; trs.set(id, tr); at[i] = id; slotOf.set(id, i);
    if (lineRows.length) { const sub = groupOf(id) !== "_singles"; if (tr.classList.contains("sub") !== sub) tr.classList.toggle("sub", sub); }
    if (!u.form || !b) return;
    u.form.dataset.id = id;
    if (b.mode) u.form.dataset.mode = b.mode; else delete u.form.dataset.mode;
    // most buttons read the same ("Do košíku", "Poptat"): only a different one, or one still showing "added", is rebuilt
    if (u.sig === b.sig && !u.btn.classList.contains("is-done")) return;
    clearTimeout(u.btn._t); u.btn._html = undefined;
    u.btn.className = b.cls; u.btn.replaceChildren(...b.kids.map((k) => k.cloneNode(true))); u.sig = b.sig;
  }
  function swap(i, j) {
    if (!ui) prep();
    const a = at[i], w = at[j], ti = slots[i], tj = slots[j];
    for (const c of cellsOf.get(w)) ti.insertBefore(c, ui[i].td);
    for (const c of cellsOf.get(a)) tj.insertBefore(c, ui[j].td);
    const qi = ui[i].qty, qj = ui[j].qty;
    if (qi && qj) [qi.value, qj.value] = [qj.value, qi.value];
    show(i, w); show(j, a);
  }
  const CHUNK = 40;
  let visible = null, sortKey = "", arun = 0, rest = null, veiled = [];
  table._settle = () => rest?.(); // printing reads the DOM order and the rows' hidden state
  function arrange(now = false, top = 0) {
    const FIRST = Math.max(2, Math.ceil((innerHeight - Math.max(0, top) - 85) / 85) + 1); // rows in view below the toolbar and header (rows ≥ 85 px), and one more
    const order = orderFor(sortKey), N = order.length, vis = (id) => !visible || visible.get(id) !== false;
    const open = (id) => isOpen(groupOf(id)); // a passing row of a folded line takes its place in the order, folded
    // Two ways to show a state: each product in its place in the sort order with the misses hidden (cheap when few rows
    // change near the top), or the matches moved up into the first slots (cheap when the first matches sit deep in the
    // table, as with a rare manufacturer). The frame takes whichever costs less in the first screenful.
    const hits = order.filter(vis), n = hits.length;
    const moved = hits.concat(order.filter((id) => !vis(id)));
    const cost = (t, part) => {
      let c = 0;
      for (let i = 0, seen = 0; i < N && seen < FIRST && (!part || i < n); i++) { // moved: the rows after the matches are veiled
        const v = part ? i < n : vis(t[i]), h = slots[i].hidden;
        c += (v && at[i] !== t[i] ? 6 : 0) + (v && h ? 5 : !v && !h ? 1 : 0);
        if (v && open(t[i])) seen++;
      }
      return c;
    };
    const part = cost(moved, true) < cost(order, false), t = part ? moved : order;
    // A row of a folded line is not hidden but folded (.folded: visibility: collapse while the table is a table, so the
    // variants size the columns and opening a line moves none; display: none once the rows are a grid, 35-lines.css).
    // It still takes its product, so the DOM order stays the sort order for printing and for unfolding.
    const step = (i) => { // a hidden slot keeps whatever product it holds
      const h = part ? i >= n : !vis(t[i]), fo = !h && !open(t[i]), tr = slots[i];
      if (!h && at[i] !== t[i]) swap(i, slotOf.get(t[i]));
      if (tr.hidden !== h) tr.hidden = h;
      if (tr._fo !== fo) { tr._fo = fo; tr.classList.toggle("folded", fo); }
      return !h && !fo;
    };
    // family headers go before their group's first visible row (lines 5a.6), hidden when the group has none
    if (famRows.length) {
      const first = new Map();
      for (let i = 0; i < N; i++) { const id = t[i]; if ((part ? i < n : vis(id)) && !first.has(groupOf(id))) first.set(groupOf(id), i); }
      const flat = table.classList.contains("flat");
      for (const fr of famRows) {
        const i = first.get(fr.dataset.fam), h = flat || i == null || (!!sortKey && fr.dataset.fam === "_singles");
        if (!h && fr.nextElementSibling !== slots[i]) tbody.insertBefore(fr, slots[i]);
        if (fr.hidden !== h) fr.hidden = h;
      }
    }
    const my = ++arun;
    for (const tr of veiled) tr.style.visibility = "";
    veiled = [];
    let i = 0;
    // folded rows cost a swap but show nothing: the first frame takes a bounded number of them, the rest follow in chunks
    for (let seen = 0, k = 0; i < N && (now || (seen < FIRST && k < FIRST * 4 && (!part || i < n))); i++, k++) if (step(i)) seen++;
    // Fewer matches than a screenful, moved up: the rows that would show below them are veiled (they keep their place,
    // so nothing moves) instead of hidden one by one now (~0.2 ms each at 4× CPU, 600 on the biggest page), and are
    // hidden last, after the rows further down
    const todo = [];
    for (let j = i; j < N; j++) todo.push(j);
    if (!now && part && i < N) {
      const nv = lineRows.length ? hits.filter(open).length : n;
      for (let j = i; j < N && veiled.length < FIRST - nv + 1; j++) if (!slots[j].hidden && !slots[j]._fo) { slots[j].style.visibility = "hidden"; veiled.push(slots[j]); }
      const v = new Set(veiled.map((tr) => slots.indexOf(tr)));
      todo.sort((a, b) => v.has(a) - v.has(b)); // stable: the veiled ones last
    }
    const finish = () => { for (const tr of veiled) tr.style.visibility = ""; veiled = []; rest = null; };
    let k = 0;
    rest = k < todo.length ? () => { if (my === arun) { while (k < todo.length) step(todo[k++]); finish(); } } : null;
    if (k < todo.length) (async () => {
      while (k < todo.length) {
        await nextFrame();
        if (my !== arun) return;
        for (const end = Math.min(todo.length, k + CHUNK); k < end; k++) step(todo[k]);
      }
      finish();
    })();
  }
  function sort(key, now = false, push = false) {
    // read layout before writing anything: sorting from the sticky header deep in the table jumps back to its top
    const jump = !now && sec.getBoundingClientRect().top < 0;
    sortKey = key || "";
    table.classList.toggle("flat", !!key && !grouped);
    for (const th of $$("thead th", table)) th.removeAttribute("aria-sort");
    const th = key && $(`thead th [data-sortkey="${CSS.escape(key)}"]`, table)?.closest("th") || (key?.startsWith("p:") && $(`thead th[data-col="${CSS.escape(key)}"]`, table));
    if (th) th.setAttribute("aria-sort", key === "price-desc" ? "descending" : "ascending");
    apply({ counts: false, push: now ? null : push, now });
    if (jump) sec.scrollIntoView({ block: "start" });
  }
  /* ---- product lines: fold and unfold, the summary row kept to the rows that pass the filters */
  const AUTO_N = 12;
  let auto = false, forced = null, userOpen = new Map(), stateT;
  function isOpen(g) { return g === "_singles" || (userOpen.has(g) ? userOpen.get(g) : forced ?? auto); }
  table._hit = (id) => !visible || visible.get(id) !== false; // printing takes every passing row, folded or not
  // the spread cells: one per parameter column, else the "Parametry" cell (keys in data-pk); and the phone summary
  const parCells = (tr) => [...$$("td.c-v", tr), ...$$("td.c-par, .c-mob", tr)];
  const lineEls = new Map(lineRows.map((tr) => { const pc = parCells(tr); return [tr.dataset.fam, { tr, n: $("[data-line-n]", tr), lab: $("[data-line-lab]", tr), btn: $("[data-line-tog]", tr), stock: $("[data-line-stock]", tr), price: $("[data-line-price]", tr), pc, p0: pc.map((c) => c.innerHTML), pk: JSON.parse(tr.dataset.pk || "[]"), sig: "", psig: "" }]; }));
  // the spread of a parameter over the rows (build.py span_of / tidy): the shared value, a from–to range of numbers in one
  // unit, else the first values and how many more
  const NUMV = /^([−-]?\d+(?:[.,]\d+)?)\s*(.*)$/, coll2 = new Intl.Collator("cs", { numeric: true });
  function spanOf(vals) {
    let vs = [...new Set(vals.filter((v) => v && v !== "–"))];
    if (vs.length < 2) return vs[0] || "–";
    vs = [...new Set(vs.flatMap((v) => v.split(", ")))];
    if (vs.length < 2) return vs[0];
    const ms = vs.map((v) => NUMV.exec(v));
    if (ms.every(Boolean) && new Set(ms.map((m) => m[2])).size === 1) {
      const xs = ms.map((m) => parseFloat(m[1].replace(",", ".").replace("−", "-"))).sort((a, b) => a - b), f = (x) => String(x).replace(".", ","), u = ms[0][2];
      return `${f(xs[0])}${xs[0] < 0 ? " až " : "–"}${f(xs.at(-1))}${u ? ` ${u}` : ""}`;
    }
    vs.sort(coll2.compare);
    return vs.length <= 3 ? vs.join(", ") : `${vs.slice(0, 2).join(", ")} a ${vs.length - 2} další`;
  }
  const tidy = (v) => v.replace(/(\d)\s+–\s+([−+-]?\d)/g, "$1–$2").replace(/(?<=\d) (?=[°%]|[A-Za-zµΩ]{1,3}(?![A-Za-zÀ-ž]))/g, "\u00a0").replace(/\bV (AC|DC|AC\/DC)\b/g, "V\u00a0$1");
  const colKeys = $$("thead th[data-col^='p:']", table).map((th) => th.dataset.col.slice(2));
  const members = new Map();
  for (const id of ids) { const g = groupOf(id); if (g !== "_singles") { if (!members.has(g)) members.set(g, []); members.get(g).push(id); } }
  const nvar = (k) => `${k}\u00a0${k === 1 ? "variantu" : k < 5 ? "varianty" : "variant"}`;
  function paintLines() {
    if (!lineRows.length) return;
    let shown = 0, opened = 0;
    for (const [g, L] of lineEls) {
      const all = members.get(g) || [], hit = all.filter((id) => !visible || visible.get(id) !== false);
      const m = hit.length, o = isOpen(g);
      if (L.tr.hidden) continue; // no passing row: arrange() hid the line
      shown++; if (o) opened++;
      let kin = 0, ask = 0, lo = null, prices = new Set(), unpriced = 0;
      for (const id of hit) {
        const r = rows[id];
        if (r.s === "in") kin++; else if (r.s === "ask") ask++;
        if (r.pr == null) unpriced++; else { prices.add(r.pr); if (!lo || r.pr < lo.pr) lo = r; }
      }
      const sig = `${hit.join()}|${o}|${kin}|${ask}|${lo?.pr}|${prices.size}|${unpriced}`;
      if (sig === L.sig) continue;
      L.sig = sig;
      L.n.textContent = m === all.length ? `${nvar(m).replace("variantu", "varianta")}` : `${m} z ${all.length}\u00a0variant`;
      L.lab.innerHTML = o ? 'Skrýt<span class="lt-v"> varianty</span>' : `<span class="lt-v">Zobrazit </span>${nvar(m)}`;
      // the parameters follow the passing rows too; all rows passing, the page's own cells come back
      const psig = m === all.length ? "" : hit.join();
      if (psig !== L.psig) {
        L.psig = psig;
        if (!psig) L.pc.forEach((c, i) => (c.innerHTML = L.p0[i]));
        else {
          const ds = hit.map((id) => rows[id].p || {});
          const pars = (keys) => keys.map((k) => `${esc(k)}: <b>${esc(tidy(spanOf(ds.map((d) => d[k]))))}</b>`).join("<br>");
          L.pc.forEach((c) => (c.innerHTML = c.matches("td.c-v") ? esc(tidy(spanOf(ds.map((d) => d[colKeys[$$("td.c-v", L.tr).indexOf(c)]])))) : pars(L.pk)));
        }
      }
      L.btn.setAttribute("aria-expanded", o);
      L.tr.classList.toggle("open", o);
      L.stock.innerHTML = kin ? `<span class="stock in">${kin === m ? "Skladem" : `${kin} z ${m} skladem`}</span>`
        : `<span class="stock ${ask === m ? "ask" : "out"}">${ask === m ? "Termín na dotaz" : "Na objednávku"}</span>`;
      L.price.innerHTML = lo ? `${prices.size > 1 || unpriced ? '<span class="line-od">od </span>' : ""}<span class="price" data-p="${lo.pr}" data-brand="${esc(lo.b || "")}">${czk(lo.pr)}</span>` : '<span class="ask">Cena na dotaz</span>';
      if (lo) applyPrices(L.price);
    }
    if (allBtn) {
      const all = shown > 0 && opened === shown;
      allBtn.toggleAttribute("data-on", all);
      allBtn.lastChild.textContent = all ? " Sbalit řady" : " Rozbalit řady";
      allBtn.hidden = shown < 2;
    }
  }
  const saveLines = () => { clearTimeout(stateT); stateT = setTimeout(() => history.replaceState({ ...history.state, lines: [...userOpen], forced }, ""), 350); }; // after paint: replaceState restyles every link
  // a line's variant photos load lazily while folded: pointing at or focusing the line starts them, so they are there
  // when it opens instead of popping in after
  const warm = (g) => { for (const id of members.get(g) || []) { const im = trs.get(id)?.querySelector(".c-img img"); if (im?.loading === "lazy") im.loading = "eager"; } };
  const warmEv = (ev) => { const tr = ev.target.closest?.("tr.line"); if (tr) warm(tr.dataset.fam); };
  tbody.addEventListener("pointerover", warmEv);
  tbody.addEventListener("focusin", warmEv);
  function toggleLine(g) {
    warm(g);
    userOpen.set(g, !isOpen(g));
    arrange(true);
    paintLines();
    saveLines();
  }
  tbody.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.line");
    if (!tr || (ev.target.closest("a, input, select, label, form") && !ev.target.closest("[data-line-tog]"))) return;
    if (!ev.target.closest("[data-line-tog]") && getSelection().toString()) return; // selecting text in the row is not a click on it
    toggleLine(tr.dataset.fam);
  });
  allBtn?.addEventListener("click", () => {
    forced = !allBtn.hasAttribute("data-on");
    if (forced) for (const g of members.keys()) warm(g);
    userOpen.clear();
    arrange(true);
    paintLines();
    saveLines();
  });
  addEventListener("pagehide", () => { if (stateT) { clearTimeout(stateT); history.replaceState({ ...history.state, lines: [...userOpen], forced }, ""); } });

  // Desktop rows become grid rows with the columns the table had (measured after the first paint, again after a resize),
  // so each row can skip rendering while off screen (content-visibility: auto, 30-filters.css; not in WebKit, which paints
  // such rows blank while scrolling: no .cv on <html>). Rows changing below the fold never move the ones in view and
  // opening a line moves no column.
  let gridded = false, rz;
  function grid() {
    if (gridded || table.hidden || getComputedStyle(table).display !== "table") return;
    // folded variants count for the columns: shown for the measurement (same frame, never painted), because not every
    // engine keeps a visibility: collapse row in the column widths (Safari let the price and buy columns come out too
    // narrow for an opened line's stepper and "Vaše cena" note)
    const fo = slots.filter((tr) => tr._fo);
    for (const tr of fo) tr.style.visibility = "visible";
    const w = $$("thead th", table).map((x) => x.getBoundingClientRect().width).filter((x) => x > 0);
    for (const tr of fo) tr.style.visibility = "";
    const on = slots.filter((tr) => !tr.hidden && !tr._fo).slice(0, 40);
    const h = on.reduce((a, tr) => a + tr.getBoundingClientRect().height, 0) / (on.length || 1);
    table.style.setProperty("--cols", w.map((x) => `${x}px`).join(" "));
    table.style.setProperty("--row-h", `${Math.round(h) || 110}px`);
    table.classList.add("gridded");
    gridded = true;
  }
  addEventListener("resize", () => { if (gridded) { table.classList.remove("gridded"); gridded = false; } clearTimeout(rz); rz = setTimeout(grid, 250); });
  for (const [id, r] of R) {
    const cell = trs.get(id) && $(".c-price", trs.get(id));
    if (cell && r.pr != null) { const note = tierNote({ pr: r.pr, b: r.b, sub: r.sub }); if (note) ($(":scope > .c-st", cell) || cell).insertAdjacentHTML($(":scope > .c-st", cell) ? "beforebegin" : "beforeend", note); } // with the price, above the stock line
  }

  /* ---- events */
  form.addEventListener("change", (ev) => {
    if (ev.target.matches("[data-fsearch]")) return;
    clearTimeout(form._t);
    apply({ push: true, say: true });
  });
  form.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.matches("[data-fsearch]")) return findIn(t);
    if (t.type === "checkbox") return;
    clearTimeout(form._t);
    form._t = setTimeout(() => { // typing keeps one history entry per field
      const push = lastTyped !== t.name || Date.now() - lastTypedAt > 2500;
      lastTyped = t.name; lastTypedAt = Date.now();
      apply({ push, say: true });
    }, t.type === "search" ? 150 : 400);
  });
  form.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input:not([type=checkbox])")) { ev.preventDefault(); clearTimeout(form._t); apply({ push: true, say: true }); } });
  function findIn(inp) { // search inside a long value list
    const q = norm(inp.value).trim(), box = $("#" + inp.getAttribute("aria-controls"));
    let any = false;
    box.classList.toggle("find", !!q);
    for (const el of $$(".fopt", box)) { const hit = !q || norm(el.textContent).includes(q); el.classList.toggle("nomatch", !hit); any ||= hit; }
    const fs = inp.closest("fieldset");
    $(".fnone", fs).hidden = any;
    const more = $("[data-more]", fs);
    if (more) more.hidden = !!q;
  }
  chips.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-reset-all]")) return resetAll();
    const c = ev.target.closest(".chip");
    if (!c) return;
    const sib = c.nextElementSibling?.matches(".chip") ? c.nextElementSibling : c.previousElementSibling;
    const next = sib?.dataset.chip;
    clear(c.dataset.chip);
    apply({ push: true, say: true });
    // focus stays in the chips row, else goes back to the filters
    const to = (next && $(`.chip[data-chip="${CSS.escape(next)}"]`, chips)) || (matchMedia("(max-width: 1020px)").matches ? $("[data-open-filters]") : form.elements.q);
    to?.focus();
  });
  function resetAll() {
    form.reset();
    for (const g of ranges) for (const i of [g.lo, g.hi]) i.removeAttribute("aria-invalid");
    apply({ push: true, say: true });
  }
  resets.forEach((b) => b.addEventListener("click", resetAll));
  undo?.addEventListener("click", () => { if (undo.dataset.key) { clear(undo.dataset.key); apply({ push: true, say: true }); } });
  for (const b of $$("[data-more]", form)) {
    b.addEventListener("click", () => {
      const box = $("#" + b.getAttribute("aria-controls")), open = box.classList.toggle("all");
      b.setAttribute("aria-expanded", open);
      b.textContent = open ? "Zobrazit méně" : `Zobrazit všech ${b.dataset.n}`;
    });
  }
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

  /* ---- restore from the URL (on load and on back/forward) */
  function restore() {
    const sp = new URLSearchParams(location.search);
    form.reset();
    userOpen = new Map(history.state?.lines || []); forced = history.state?.forced ?? null;
    if (sw.stock) sw.stock.checked = !!sp.get("skladem");
    if (sw.priced) sw.priced.checked = !!sp.get("cena");
    if (form.elements.q) form.elements.q.value = sp.get("hledat") || "";
    for (const g of ranges) [g.lo, g.hi].forEach((i, j) => { const v = sp.get(g.keys[j]); if (v != null) { i.value = v; i.closest("details")?.setAttribute("open", ""); } });
    const order = [];
    for (const [k, v] of sp) {
      const o = opts.find((x) => x.name === k && x.value === v);
      if (o) { o.cb.checked = true; o.cb.closest("details:not([open])")?.setAttribute("open", ""); order.push(`${k}\u0001${v}`); }
    }
    for (const d of $$("details[data-extra] details[open]", form)) d.closest("[data-extra]").open = true;
    act = order; // chips in URL order
    return sp.get("razeni") || "";
  }
  const key0 = restore();
  if (key0) { if (sortSel) sortSel.value = key0; sort(key0, true); } else apply({ now: true });
  // after the first paint: rows to grid, then (idle) the slots' cells mapped and the move code run once, so the first
  // click does not pay for it (a swap there and back leaves the table as it was)
  nextFrame().then(() => { grid(); (window.requestIdleCallback || setTimeout)(() => { if (!ui) prep(); if (slots.length > 1) { swap(0, 1); swap(0, 1); } }); });
  addEventListener("popstate", () => {
    urlNext = null;
    const key = restore();
    if (sortSel) sortSel.value = key;
    if (key !== sortKey) sort(key, true);
    apply({ say: true });
  });

  /* ---- phone drawer: a modal dialog with a sticky "Zobrazit N položek" */
  let opener = null;
  const focusables = () => $$("button, input, select, summary, a[href]", fl).filter((el) => !el.disabled && el.offsetParent !== null);
  function openDrawer(b) {
    opener = b;
    fl.classList.add("open");
    fl.setAttribute("role", "dialog"); fl.setAttribute("aria-modal", "true");
    scrim.hidden = false;
    document.documentElement.classList.add("filters-lock");
    openers.forEach((x) => x.setAttribute("aria-expanded", "true"));
    // focus the close button, not a text field: that would pop up the phone keyboard. Retried for a few frames: under
    // reduced motion every property eases for .01 ms (styles.css), and a button still easing in to visible takes no focus
    const x = $(".filters-x", fl), focus = (k) => { x.focus(); if (document.activeElement !== x && k) requestAnimationFrame(() => focus(k - 1)); };
    if (x) focus(10);
  }
  function closeDrawer() {
    if (!fl.classList.contains("open")) return;
    fl.classList.remove("open");
    fl.removeAttribute("role"); fl.removeAttribute("aria-modal");
    scrim.hidden = true;
    document.documentElement.classList.remove("filters-lock");
    openers.forEach((x) => x.setAttribute("aria-expanded", "false"));
    if (sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ block: "start" });
    if (fl.contains(document.activeElement) || document.activeElement === document.body) opener?.focus();
  }
  openers.forEach((b) => b.addEventListener("click", () => openDrawer(b)));
  $$("[data-close-filters]").forEach((b) => b.addEventListener("click", closeDrawer));
  fl.addEventListener("keydown", (ev) => {
    if (!fl.classList.contains("open")) return;
    if (ev.key === "Escape") { ev.preventDefault(); closeDrawer(); return; }
    if (ev.key !== "Tab") return;
    const f = focusables(), first = f[0], last = f.at(-1);
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });
  matchMedia("(max-width: 1020px)").addEventListener("change", (m) => { if (!m.matches) closeDrawer(); });
}
initListing();

/* ---- search results (hledat.html): group and manufacturer pills, stock and price switches, live counts, URL state.
   app.js initSearchPage renders the table and hands over: the rows matching the bar are drawn (the first 300). */
searchExt.bar = ({ bar, tbody, res, idx, rowHtml }) => {
  const CAP = 300, SHOW = 8;
  const keys = { sub: "skupina", b: "vyrobce" };
  const groups = [["sub", "Skupina", (v) => idx.subs[v] || v], ["b", "Výrobce", (v) => v]].map(([k, label, name]) => {
    const c = new Map();
    for (const p of res) if (p[k]) c.set(p[k], (c.get(p[k]) || 0) + 1);
    return { k, label, name, vals: [...c.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "cs")).map(([v]) => v) };
  }).filter((g) => g.vals.length > 1);
  const pill = (g, v, i) => `<button type="button" class="btn sm sr-pill" aria-pressed="false" data-k="${g.k}" data-v="${esc(v)}"${i >= SHOW ? " data-more hidden" : ""}>${esc(g.name(v))} <span class="n" data-n></span></button>`;
  bar.innerHTML = groups.map((g) => `<div class="sr-row" role="group" aria-labelledby="sr-${g.k}"><span class="sr-lab" id="sr-${g.k}">${g.label}</span>${g.vals.map((v, i) => pill(g, v, i)).join("")}${g.vals.length > SHOW ? `<button type="button" class="linkbtn sr-toggle" aria-expanded="false">Další (${g.vals.length - SHOW})</button>` : ""}</div>`).join("")
    + `<div class="sr-row sr-foot"><label class="switch-row">Jen skladem<span class="n" data-sw="stock"></span><input type="checkbox" role="switch" data-sstock></label>`
    + `<label class="switch-row">Jen s cenou online<span class="n" data-sw="priced"></span><input type="checkbox" role="switch" data-spriced></label>`
    + `<span class="sr-n" role="status" data-sn></span><button type="button" class="linkbtn" data-sreset hidden>Zrušit filtry</button></div>`;
  const pills = $$(".sr-pill", bar), stock = $("[data-sstock]", bar), priced = $("[data-spriced]", bar);
  const st = () => {
    const sets = {};
    for (const b of pills) if (b.getAttribute("aria-pressed") === "true") (sets[b.dataset.k] ??= new Set()).add(b.dataset.v);
    return { sets, stock: stock.checked, priced: priced.checked };
  };
  const miss = (p, s, skip) => {
    if (s.stock && skip !== "stock" && p.s !== "in") return true;
    if (s.priced && skip !== "priced" && p.pr == null) return true;
    for (const [k, set] of Object.entries(s.sets)) if (k !== skip && !set.has(p[k])) return true;
    return false;
  };
  let shown = "";
  function draw(push) {
    const s = st(), hit = res.filter((p) => !miss(p, s));
    for (const b of pills) {
      const n = res.reduce((a, p) => a + (p[b.dataset.k] === b.dataset.v && !miss(p, s, b.dataset.k) ? 1 : 0), 0);
      $("[data-n]", b).textContent = n;
      b.disabled = !n && b.getAttribute("aria-pressed") !== "true";
    }
    $("[data-sw=stock]", bar).textContent = res.filter((p) => p.s === "in" && !miss(p, s, "stock")).length;
    $("[data-sw=priced]", bar).textContent = res.filter((p) => p.pr != null && !miss(p, s, "priced")).length;
    const ids = hit.slice(0, CAP).map((p) => p.id).join();
    if (ids !== shown) { shown = ids; tbody.innerHTML = hit.slice(0, CAP).map(rowHtml).join(""); applyPrices(tbody); }
    tbody.closest("table").hidden = !hit.length;
    const any = Object.keys(s.sets).length || s.stock || s.priced;
    $("[data-sn]", bar).textContent = !hit.length ? "Filtrům nic neodpovídá" : hit.length > CAP ? `Zobrazeno ${nf.format(CAP)} z ${pl(hit.length)}, upřesněte výběr` : any ? `Zobrazeno ${pl(hit.length)}` : pl(hit.length);
    $("[data-sreset]", bar).hidden = !any;
    if (push) {
      const sp = new URLSearchParams(location.search);
      for (const k of [...Object.values(keys), "skladem", "cena"]) sp.delete(k);
      for (const [k, set] of Object.entries(s.sets)) for (const v of set) sp.append(keys[k], v);
      if (s.stock) sp.set("skladem", "1");
      if (s.priced) sp.set("cena", "1");
      const u = `${location.pathname}?${sp}`;
      if (u !== location.pathname + location.search) setTimeout(() => history.pushState(null, "", u), 0); // after paint
    }
  }
  function restore() {
    const sp = new URLSearchParams(location.search);
    for (const b of pills) {
      const on = sp.getAll(keys[b.dataset.k]).includes(b.dataset.v);
      b.setAttribute("aria-pressed", on);
      if (on) b.hidden = false;
    }
    stock.checked = !!sp.get("skladem");
    priced.checked = !!sp.get("cena");
  }
  bar.addEventListener("click", (ev) => {
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.matches(".sr-pill")) { t.setAttribute("aria-pressed", t.getAttribute("aria-pressed") !== "true"); draw(true); }
    else if (t.matches(".sr-toggle")) {
      const open = t.getAttribute("aria-expanded") !== "true";
      $$("[data-more]", t.parentElement).forEach((b) => (b.hidden = !open && b.getAttribute("aria-pressed") !== "true"));
      t.setAttribute("aria-expanded", open);
      t.textContent = open ? "Méně" : `Další (${$$("[data-more]", t.parentElement).length})`;
    } else if (t.matches("[data-sreset]")) {
      pills.forEach((b) => b.setAttribute("aria-pressed", "false")); stock.checked = priced.checked = false;
      draw(true); bar.querySelector(".sr-pill")?.focus();
    }
  });
  bar.addEventListener("change", () => draw(true));
  addEventListener("popstate", () => { restore(); draw(false); });
  restore();
  draw(false);
};

}

// ---- parts/32-listing.js
{
// "Porovnat" in table rows (REVIEW-2026-10-29 #10; markup from build.py row_tools()). The checkboxes work on the
// compare store the product page's button uses (app.js: store "compare", at most four products, the header count via
// renderHeader), so a row, the product page and the header always agree. Sorting moves a row's cells with its product
// (30-filters.js), so each checkbox keeps its product id.

const MAX_CMP = 4;
const cmpBoxes = () => $$("input[data-cmp]");
function syncCmp() {
  const c = store.get("compare", []);
  for (const b of cmpBoxes()) { const on = c.includes(+b.dataset.cmp); if (b.checked !== on) b.checked = on; }
}
if (cmpBoxes().length) {
  document.addEventListener("change", (ev) => {
    const b = ev.target.closest?.("input[data-cmp]");
    if (!b) return;
    const id = +b.dataset.cmp;
    let c = store.get("compare", []);
    if (!b.checked) c = c.filter((x) => x !== id);
    else if (!c.includes(id)) {
      if (c.length >= MAX_CMP) { b.checked = false; toast("Porovnat lze nejvýše čtyři produkty. Jeden odeberte."); return; }
      c.push(id);
      toast(`Přidáno k porovnání (${c.length}/${MAX_CMP}). <a href="${url("porovnani.html")}" style="color:#fff">Porovnat</a>`);
    }
    store.set("compare", c);
    renderHeader();
    syncCmp(); // the same product may have a row twice (a variant table and its line's own row)
  });
  // the product page's own "Porovnat" button (app.js [data-compare]) and other tabs change the same store
  document.addEventListener("click", (ev) => { if (ev.target.closest("[data-compare]")) setTimeout(syncCmp); });
  addEventListener("storage", (ev) => { if (ev.key === "rem.compare") syncCmp(); });
  addEventListener("pageshow", syncCmp); // back from the comparison page
  syncCmp();
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

// 4. REMinfo and e-novinky (demo: nothing is sent). One shared record, store "newsletter" = { email, reminfo, enovinky };
//    the account settings (ucet.html) read and write the same record.
{
  const KEY = "newsletter";
  const DEMO = "Ukázka: nic se neodesílá, odběr je uložený jen v tomto prohlížeči.";
  const rec = () => { const r = store.get(KEY, {}) || {}; return { email: String(r.email || ""), reminfo: !!r.reminfo, enovinky: !!r.enovinky }; };
  const same = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const what = (r) => [r.reminfo && "REMinfo", r.enovinky && "e-novinky"].filter(Boolean).join(" a ");

  // one-line forms (footer: REMinfo; data-nl="enovinky" on the homepage and the e-novinky pages): app.js shows its
  // "Hotovo" message and replaces the form, so this runs first (capture); the other list stays as it was for this address
  document.addEventListener("submit", (ev) => {
    const f = ev.target.closest?.("form[data-nl]");
    if (!f || !f.checkValidity()) return;
    const email = f.email.value.trim(), r = rec(), list = f.dataset.nl === "enovinky" ? "enovinky" : "reminfo";
    const keep = (k) => same(email, r.email) && r[k];
    store.set(KEY, { email, reminfo: list === "reminfo" || keep("reminfo"), enovinky: list === "enovinky" || keep("enovinky") });
  }, true);

  const showState = (f) => {
    const st = $("[data-nl-state]", f);
    if (!st) return;
    const r = rec(), on = !!r.email && (r.reminfo || r.enovinky);
    st.hidden = !on;
    st.innerHTML = on ? `Na adresu <b>${esc(r.email)}</b> teď odebíráte ${what(r)}.` : "";
  };
  const done = (f, html) => {
    $("[data-nl-done]", f).innerHTML = `<div class="note-box nl-ok">${icon("check")}<span>${html}</span></div><p class="nl-demo">${DEMO}</p>`;
  };
  // inline errors: shown for every invalid field after the first submit; while invalid, the error describes its field
  const mark = (el) => {
    const bad = !el.checkValidity();
    el.setAttribute("aria-invalid", String(bad));
    if (el.dataset.err) bad ? el.setAttribute("aria-describedby", el.dataset.err) : el.removeAttribute("aria-describedby");
    return bad;
  };
  const check = (f) => {
    f.classList.add("tried");
    let first = null;
    for (const el of $$("input, textarea", f)) if (mark(el) && !first) first = el;
    first?.focus();
    return !first;
  };
  let n = 0;
  for (const f of $$("form[data-nl-form]")) {
    for (const fld of $$(".field", f)) {
      const err = $(".err", fld), inp = $("input:not([type=hidden]), textarea", fld);
      if (err && inp) { err.id = `nl-err-${++n}`; inp.dataset.err = err.id; }
    }
    for (const el of $$("input, textarea", f)) el.setAttribute("aria-invalid", "false");
    const recheck = (ev) => { if (f.classList.contains("tried") && ev.target.matches?.("input, textarea")) mark(ev.target); };
    f.addEventListener("change", recheck);
    f.addEventListener("input", recheck);
    const r = rec(), email = f.email;
    email.value = new URLSearchParams(location.search).get("email") || r.email || user()?.email || "";
    showState(f);

    if (f.dataset.nlForm === "sub") {
      const ri = f.reminfo, en = f.enovinky;
      if (r.email && (r.reminfo || r.enovinky)) { ri.checked = r.reminfo; en.checked = r.enovinky; }
      if (location.hash === "#e-novinky") { en.checked = true; ri.checked = r.reminfo; } // the old "Přihlásit E-novinky" address
      const pick = () => ri.setCustomValidity(ri.checked || en.checked ? "" : "Vyberte REMinfo, e-novinky, nebo obojí.");
      pick();
      ri.addEventListener("change", pick);
      en.addEventListener("change", () => { pick(); if (f.classList.contains("tried")) mark(ri); });
      f.addEventListener("submit", (ev) => {
        ev.preventDefault();
        if (!check(f)) return;
        const next = { email: email.value.trim(), reminfo: ri.checked, enovinky: en.checked };
        store.set(KEY, next);
        showState(f);
        done(f, `Hotovo. ${cap(what(next))} vám budeme posílat na <b>${esc(next.email)}</b>.`);
      });
      continue;
    }

    // unsubscribe: flips one flag of the stored record when the address matches it
    const { nlKey: key, nlOther: other, nlName: name, nlOtherName: otherName, nlOtherUrl: otherUrl, nlSubUrl: subUrl } = f.dataset;
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (!check(f)) return;
      const mail = email.value.trim(), cur = rec();
      let still = false;
      if (!cur.email || same(mail, cur.email)) {
        const next = { ...cur, email: cur.email || mail, [key]: false };
        store.set(KEY, next);
        still = next[other];
      }
      showState(f);
      done(f, `Hotovo. ${cap(name)} už na <b>${esc(mail)}</b> posílat nebudeme.`
        + (still ? ` ${cap(otherName)} vám chodí dál, <a href="${esc(otherUrl)}">odhlásit i ${esc(otherName)}</a>.` : "")
        + ` <a href="${esc(subUrl)}">Přihlásit znovu</a>`);
    });
  }
}

}

// ---- parts/85-account.js
{
// Firemní účet: forgotten password (ucet.html#zapomenute-heslo, then #nove-heslo), account settings (ucet.html#nastaveni)
// and the checkout hooks that offer saved delivery addresses and contact persons. Demo: everything stays in localStorage.
//   rem.accounts   { [IČO]: { ico, level, disc, pw, profile, addresses, defaultAddr, contacts, primary, notify } }
//                  rem.user (the session) is derived from it: company, address and the primary contact,
//                  so the header, the account page and the checkout prefill follow the settings
//   rem.pwReset    { email, ico, at }: the last reset request; ico is null for an e-mail without an account
//   rem.newsletter { email, reminfo, enovinky }: shared with the public subscribe / unsubscribe forms
// app.js calls the hooks in accountExt (signIn, tabs, decorate) and initAccount runs after this file.

const COUNTRY = { CZ: "Česká republika", SK: "Slovensko" };
const RESET_MIN = 60; // minutes
const COMMON_PW = new Set(["12345678", "123456789", "1234567890", "heslo123", "password", "password1", "qwertzui", "qwertyui", "abcd1234"]);
const lc = (s) => String(s ?? "").trim().toLowerCase();
const rid = (p) => p + Math.random().toString(36).slice(2, 8);
const zipFmt = (z) => String(z || "").replace(/\s/g, "").replace(/^(\d{3})(\d{2})$/, "$1 $2");
const accounts = () => store.get("accounts", {});
const putAccount = (a) => store.set("accounts", { ...accounts(), [a.ico]: a });
const primaryOf = (a) => a.contacts.find((c) => c.id === a.primary) || a.contacts[0] || { name: "", email: "", tel: "" };
const oneLine = (a) => [a.street, [a.zip, a.city].filter(Boolean).join(" "), a.country && a.country !== "CZ" ? COUNTRY[a.country] : ""].filter(Boolean).join(", ");
const zipCity = (a) => [a.zip && `<span class="fig">${esc(a.zip)}</span>`, esc(a.city || "")].filter(Boolean).join(" "); // postcodes in figures, as everywhere
function splitStreet(s) {
  const t = String(s || "").trim();
  const m = t.match(/^(.*?),\s*(\d{3}\s?\d{2})\s+(.+)$/);
  return m ? { street: m[1].trim(), zip: zipFmt(m[2]), city: m[3].trim() } : { street: t, zip: "", city: "" };
}

/* ---------- accounts registry ---------- */
function demoAccount() {
  return {
    ico: DEMO_USER.ico, level: DEMO_USER.level, disc: DEMO_USER.disc, pw: null,
    profile: { name: DEMO_USER.company, dic: DEMO_USER.dic, street: "Technická 12", zip: "616 00", city: "Brno", country: "CZ" },
    addresses: [
      { id: "a1", label: "Sídlo a sklad", name: DEMO_USER.company, street: "Technická 12", zip: "616 00", city: "Brno", country: "CZ", note: "Rampa B, příjem Po–Pá 7–15 h" },
      { id: "a2", label: "Provoz Kuřim", name: `${DEMO_USER.company}, provoz Kuřim`, street: "Průmyslová 8", zip: "664 34", city: "Kuřim", country: "CZ", note: "Vrátnice u hlavní brány, ohlásit se na údržbě" },
      { id: "a3", label: "Montáž Žilina", name: `${DEMO_USER.company}, montážní tým`, street: "Priemyselná 3", zip: "010 01", city: "Žilina", country: "SK", note: "" },
    ],
    defaultAddr: "a1",
    contacts: [
      { id: "c1", name: DEMO_USER.name, email: DEMO_USER.email, tel: DEMO_USER.tel },
      { id: "c2", name: "Pavel Dvořák", email: "udrzba@ukazka.cz", tel: "+420 600 000 002" },
      { id: "c3", name: "Eva Svobodová", email: "faktury@ukazka.cz", tel: "+420 600 000 003" },
    ],
    primary: "c1",
    notify: { orders: true },
  };
}
// an account approved on obchodnik.html starts from its registration: the seat is the first delivery address, the applicant the primary contact
function accountFromUser(u) {
  const where = splitStreet(u.street);
  const c = { id: rid("c"), name: u.name || "", email: u.email || "", tel: u.tel || "" };
  const ad = { id: rid("a"), label: "Sídlo firmy", name: u.company, ...where, country: "CZ", note: "" };
  return { ico: u.ico, level: u.level, disc: u.disc, pw: null, profile: { name: u.company, dic: u.dic || "", ...where, country: "CZ" }, addresses: [ad], defaultAddr: ad.id, contacts: [c], primary: c.id, notify: { orders: true } };
}
function userOf(a, base = {}) {
  const c = primaryOf(a);
  return { ...base, company: a.profile.name, ico: a.ico, dic: a.profile.dic, street: oneLine(a.profile), tel: c.tel, name: c.name, email: c.email, level: a.level, disc: a.disc };
}
// the login e-mail is the primary contact's e-mail
function findAccount(email) {
  const e = lc(email);
  if (!e) return null;
  const all = accounts();
  const hit = Object.values(all).find((a) => lc(primaryOf(a).email) === e);
  if (hit) return hit;
  if (e === lc(DEMO_USER.email) && !all[DEMO_USER.ico]) return demoAccount();
  const r = store.get("regs", []).find((x) => x.status === "approved" && lc(x.email) === e && !all[x.ico]);
  return r ? accountFromUser(r) : null;
}
const demoLoginEmail = () => primaryOf(accounts()[DEMO_USER.ico] || demoAccount()).email;
async function pwHash(ico, pw) {
  const data = new TextEncoder().encode(`rem-demo:${ico}:${pw}`);
  if (crypto.subtle) return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");
  let h = 2166136261; // plain-http fallback (no SubtleCrypto): FNV-1a, still never the password itself
  for (const b of data) h = Math.imul(h ^ b, 16777619);
  return "fnv" + (h >>> 0).toString(16);
}
// keep the session and the registry in step: pricing comes from the session (sales may change it), everything else from the registry
function syncSession() {
  const u = user();
  if (!u?.ico) return null;
  const all = accounts();
  const a = { ...(all[u.ico] || (u.ico === DEMO_USER.ico ? demoAccount() : accountFromUser(u))), level: u.level, disc: u.disc };
  if (JSON.stringify(a) !== JSON.stringify(all[u.ico])) store.set("accounts", { ...all, [u.ico]: a });
  const nu = userOf(a, u);
  if (JSON.stringify(nu) !== JSON.stringify(u)) store.set("user", nu);
  return a;
}
function saveAccount(a) {
  putAccount(a);
  const u = user();
  if (u?.ico === a.ico) { store.set("user", userOf(a, u)); renderHeader(); }
}

accountExt.signIn = async (email, pw) => {
  const a = email === undefined ? accounts()[DEMO_USER.ico] || demoAccount() : findAccount(email);
  if (!a) return null;
  if (pw !== undefined && a.pw && a.pw !== (await pwHash(a.ico, pw))) return null;
  putAccount(a);
  return userOf(a);
};

/* ---------- form helpers ---------- */
const NEP = ' <span class="nep">(nepovinné)</span>';
function fld(id, label, attrs, { value = "", hint = "", err = "", opt = false, full = false } = {}) {
  // the error line joins aria-describedby only while the field is aria-invalid (describe below)
  return `<div class="field${full ? " full" : ""}"><label for="${id}">${label}${opt ? NEP : ""}</label><input class="input" id="${id}" ${attrs} value="${esc(value)}" data-fld${hint ? ` aria-describedby="${id}-h"` : ""}>${hint ? `<span class="hint" id="${id}-h">${hint}</span>` : ""}${err ? `<span class="err" id="${id}-e">${icon("info", "sm")} <span data-msg data-def="${esc(err)}">${err}</span></span>` : ""}</div>`;
}
function countrySel(id, val, ac) {
  return `<div class="field"><label for="${id}">Stát</label><select class="select" id="${id}" name="country" autocomplete="${ac}">${Object.entries(COUNTRY).map(([k, n]) => `<option value="${k}"${k === val ? " selected" : ""}>${n}</option>`).join("")}</select></div>`;
}
const ERRS = '<div class="err-summary" data-err-summary role="alert" tabindex="-1" hidden></div>';
// error summary with links to the fields, as in checkout
function check(form) {
  const es = $("[data-err-summary]", form);
  const bad = $$("input, select, textarea", form).filter((i) => !i.disabled && !i.closest("[hidden]") && !i.checkValidity());
  syncInvalid(form);
  for (const i of bad) { i.classList.add("touched"); i.setAttribute("aria-invalid", "true"); errText(i); }
  $$("[data-fld]", form).forEach(describe);
  if (!bad.length) { if (es) es.hidden = true; return true; }
  if (es) {
    es.innerHTML = `<strong>Než uložíte, opravte prosím:</strong><ul>${bad.map((i) => `<li><a href="#${i.id}">${esc(($(`label[for="${i.id}"]`, form)?.childNodes[0]?.textContent || i.name).trim())}</a></li>`).join("")}</ul>`;
    es.hidden = false;
    es.focus();
  } else bad[0].focus();
  return false;
}
// error-summary links focus the field without touching location.hash (the account page routes on the hash)
document.addEventListener("click", (ev) => {
  const a = ev.target.closest("[data-err-summary] a[href^='#']");
  if (!a) return;
  ev.preventDefault();
  const el = document.getElementById(a.hash.slice(1));
  el?.focus();
  el?.scrollIntoView({ block: "center" });
});
function describe(i) {
  if (!i.hasAttribute?.("data-fld")) return;
  const ids = [`${i.id}-h`, i.getAttribute("aria-invalid") === "true" && `${i.id}-e`].filter((x) => x && document.getElementById(x));
  if (ids.length) i.setAttribute("aria-describedby", ids.join(" "));
  else i.removeAttribute("aria-describedby");
}
document.addEventListener("focusout", (ev) => describe(ev.target)); // after app.js has synced aria-invalid on blur
// the message under a field: a custom one (wrong password…) or the field's default
function errText(i) {
  const m = i.id && document.getElementById(`${i.id}-e`)?.querySelector("[data-msg]");
  if (m) m.textContent = i.validity.customError ? i.validationMessage : m.dataset.def;
}
document.addEventListener("input", (ev) => {
  const i = ev.target;
  if (!i.matches?.("input, select, textarea")) return;
  if (i.classList.contains("touched") && i.checkValidity()) i.classList.remove("touched");
  if (i.getAttribute("aria-invalid") === "true") i.setAttribute("aria-invalid", i.matches(":user-invalid") ? "true" : "false"); // clears as soon as it's fixed
  describe(i);
  errText(i);
});
// a new password: at least 8 characters, not the e-mail, not a well-known one
function pwRule(i, email) {
  const v = i.value, l = lc(v), e = lc(email);
  i.setCustomValidity(!v ? "" : v.length < 8 ? "Heslo musí mít aspoň 8 znaků." : l === e || (e && l === e.split("@")[0]) ? "Heslo nesmí být stejné jako e-mail." : COMMON_PW.has(l) ? "Tohle heslo je moc běžné. Zvolte jiné." : "");
  errText(i);
}
document.addEventListener("change", (ev) => {
  const t = ev.target.closest?.("[data-show-pw]");
  if (!t) return;
  for (const i of $$("input[type=password], input[data-pw]", t.form)) { i.dataset.pw = ""; i.type = t.checked ? "text" : "password"; }
});

/* ---------- forgotten password ---------- */
let typedEmail = "";
document.addEventListener("click", (ev) => { if (ev.target.closest('a[href="#zapomenute-heslo"]')) typedEmail = $("#l-email")?.value.trim() || typedEmail; });
const backLink = '<a href="#prihlaseni">Zpět na přihlášení</a>';
function resetTarget() {
  const r = store.get("pwReset", null);
  if (!r?.ico || Date.now() - r.at > RESET_MIN * 60e3) return null;
  return accounts()[r.ico] || findAccount(r.email);
}
function mailHtml(email) {
  const a = resetTarget();
  if (!a) return `<p><b>Do schránky ${esc(email)} nepřijde nic.</b> V této ukázce k té adrese žádný účet nepatří. Ukázkový účet se přihlašuje adresou ${esc(demoLoginEmail())}.</p>`;
  return `<dl><dt>Od</dt><dd>REM-Technik s.r.o.</dd><dt>Komu</dt><dd>${esc(email)}</dd><dt>Předmět</dt><dd>Nové heslo k firemnímu účtu</dd></dl>
    <p>Dobrý den,</p><p>dostali jsme žádost o nové heslo k firemnímu účtu ${esc(a.profile.name.replace(/\.$/, ""))}. Nové heslo si nastavíte tady:</p>
    <p><a class="btn primary" href="${url("ucet.html#nove-heslo")}">Nastavit nové heslo</a></p>
    <p>Odkaz platí hodinu a funguje jen jednou. Pokud jste o nové heslo nežádali, e-mail smažte, vaše heslo zůstává beze změny.</p>
    <p class="muted">REM-Technik s.r.o., Klíny 35, <span class="fig">615 00</span> Brno</p>`;
}
function forgotForm(slot, email = "") {
  slot.innerHTML = `<form class="panel" id="zapomenute-heslo" data-forgot novalidate aria-labelledby="fg-h">
    <h2 id="fg-h" tabindex="-1">Zapomenuté heslo</h2>
    <p class="muted">Napište e-mail, kterým se přihlašujete. Pošleme na něj odkaz, přes který si nastavíte nové heslo.</p>
    ${fld("fg-email", "E-mail", 'name="email" type="email" autocomplete="username" spellcheck="false" required', { value: email, err: "Zadejte e-mail ve tvaru jmeno@firma.cz." })}
    <div class="acc-acts"><button class="btn primary" type="submit">Poslat odkaz</button>${backLink}</div></form>`;
  const f = $("form", slot);
  f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (!check(f)) return;
    const e = f.email.value.trim();
    store.set("pwReset", { email: e, ico: findAccount(e)?.ico || null, at: Date.now() });
    sent(slot, e);
  });
}
function sent(slot, email) {
  slot.innerHTML = `<div class="panel" id="zapomenute-heslo" aria-labelledby="fg-h">
    <h2 id="fg-h" tabindex="-1">Zkontrolujte e-mail</h2>
    <p>Pokud k adrese <b>${esc(email)}</b> patří firemní účet, poslali jsme na ni odkaz pro nastavení nového hesla. Odkaz platí hodinu.</p>
    <p class="muted">Nic nepřišlo? Podívejte se do nevyžádané pošty, nebo <button class="linkbtn" type="button" data-again>pošlete odkaz znovu</button>. S přihlášením poradí obchodní oddělení na <a class="fig" href="tel:+420548140000">+420 548 140 000</a>.</p>
    <div class="note-box">${icon("info")}<span>Ukázka: nic se neodesílá. Web odpoví u každé adresy stejně, aby nešlo zjistit, kdo u nás má účet. <button class="linkbtn" type="button" aria-expanded="false" aria-controls="fg-mail" data-mail>Ukázat, co přijde do schránky</button></span></div>
    <div class="acc-mail" id="fg-mail" hidden>${mailHtml(email)}</div>
    <div class="acc-acts">${backLink}</div></div>`;
  $("h2", slot).focus();
  $("[data-again]", slot).addEventListener("click", () => { forgotForm(slot, email); $("#fg-email", slot).focus(); });
  $("[data-mail]", slot).addEventListener("click", (ev) => {
    const box = $("#fg-mail", slot), open = box.hidden;
    box.hidden = !open;
    ev.target.setAttribute("aria-expanded", open);
    ev.target.textContent = open ? "Skrýt ukázku e-mailu" : "Ukázat, co přijde do schránky";
  });
}
function resetForm(slot) {
  const a = resetTarget();
  if (!a) {
    slot.innerHTML = `<div class="panel" id="nove-heslo" aria-labelledby="np-h"><h2 id="np-h" tabindex="-1">Odkaz už neplatí</h2>
      <p>Odkaz pro nastavení hesla platí hodinu a použít ho jde jen jednou. Pošlete si nový.</p>
      <div class="acc-acts"><a class="btn primary" href="#zapomenute-heslo">Poslat nový odkaz</a>${backLink}</div></div>`;
    return;
  }
  const email = primaryOf(a).email;
  slot.innerHTML = `<form class="panel" id="nove-heslo" data-reset novalidate aria-labelledby="np-h">
    <h2 id="np-h" tabindex="-1">Nové heslo</h2>
    <p class="muted">Firemní účet ${esc(a.profile.name.replace(/\.$/, ""))}. Po uložení vás rovnou přihlásíme.</p>
    ${ERRS}
    ${fld("np-user", "Přihlašovací e-mail", 'name="username" type="email" autocomplete="username" readonly', { value: email })}
    ${fld("np-pw", "Nové heslo", 'name="pw" type="password" autocomplete="new-password" minlength="8" maxlength="128" required', { hint: "Aspoň 8 znaků. Dobře poslouží několik slov za sebou.", err: "Zadejte nové heslo." })}
    <label class="check"><input type="checkbox" data-show-pw> <span>Zobrazit heslo</span></label>
    <div class="acc-acts"><button class="btn primary" type="submit">Uložit heslo a přihlásit</button></div></form>`;
  const f = $("form", slot);
  f.pw.addEventListener("input", () => pwRule(f.pw, email));
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    pwRule(f.pw, email);
    if (!check(f)) return;
    putAccount({ ...(accounts()[a.ico] || a), pw: await pwHash(a.ico, f.pw.value) });
    store.set("pwReset", null);
    history.replaceState(null, "", location.pathname + location.search);
    await accountExt.login(email);
    toast("Nové heslo je uložené a jste přihlášeni.");
  });
}
// logged-out ucet.html: the forgotten-password routes take the login panel's place
accountExt.decorate = (root) => {
  const de = $("[data-demo-email]", root);
  if (de) de.textContent = demoLoginEmail();
  const lf = $("[data-login]", root);
  const route = location.hash.slice(1);
  if (!lf) return;
  if (route === "nastaveni") { $("h2", lf).insertAdjacentHTML("afterend", '<p class="muted">Nastavení účtu otevřeme hned po přihlášení.</p>'); return; }
  if (route !== "zapomenute-heslo" && route !== "nove-heslo") return;
  const slot = document.createElement("div");
  slot.className = "acc-flow";
  lf.replaceWith(slot);
  if (route === "zapomenute-heslo") forgotForm(slot, typedEmail);
  else resetForm(slot);
  $("h2", slot).focus();
};

/* ---------- settings tab ---------- */
const SW = (name, title, text, on) => `<label class="switch-row set-sw"><span><strong>${title}</strong><small>${text}</small></span><input type="checkbox" role="switch" name="${name}"${on ? " checked" : ""}></label>`;
function addrLines(ad) {
  return `${esc(ad.name)}<br>${esc(ad.street)}<br>${zipCity(ad)}${ad.country !== "CZ" ? `<br>${esc(COUNTRY[ad.country] || ad.country)}` : ""}`;
}
function settingsHtml(a) {
  const p = a.profile, prim = primaryOf(a), nl = store.get("newsletter", {});
  const addrs = a.addresses.map((ad) => {
    const def = ad.id === a.defaultAddr, sr = `<span class="sr-only"> adresu ${esc(ad.label)}</span>`;
    return `<li class="addr" data-addr="${ad.id}"><div class="addr-top"><strong>${esc(ad.label)}</strong>${def ? '<span class="badge">Výchozí</span>' : ""}</div>
      <address>${addrLines(ad)}</address>
      ${ad.note ? `<p class="addr-meta">${esc(ad.note)}</p>` : ""}
      <div class="addr-acts"><button class="btn" type="button" data-addr-edit="${ad.id}">Upravit${sr}</button>${def ? "" : `<button class="btn quiet" type="button" data-addr-def="${ad.id}">Nastavit jako výchozí<span class="sr-only">: ${esc(ad.label)}</span></button>`}<button class="btn quiet" type="button" data-addr-del="${ad.id}">Smazat${sr}</button></div></li>`;
  }).join("");
  const contacts = a.contacts.map((c) => {
    const main = c.id === a.primary, sr = `<span class="sr-only"> kontakt ${esc(c.name)}</span>`;
    return `<li data-ct="${c.id}"><div><strong>${esc(c.name)}</strong>${main ? ' <span class="badge">Hlavní kontakt</span>' : ""}<div class="ct-meta"><span class="ct-mail">${esc(c.email)}</span>${c.tel ? `<span class="fig">${esc(c.tel)}</span>` : ""}</div></div>
      <div class="ct-acts"><button class="btn" type="button" data-ct-edit="${c.id}">Upravit${sr}</button>${main ? "" : `<button class="btn quiet" type="button" data-ct-del="${c.id}">Smazat${sr}</button>`}</div></li>`;
  }).join("");
  return `<div class="set">
  <form class="panel" id="set-firma" data-set-company novalidate aria-labelledby="sf-h">
    <h2 id="sf-h">Firma a fakturační údaje</h2>
    <p class="muted">Uvádíme je na objednávkách a fakturách.</p>
    ${ERRS}
    <div class="formgrid">
      ${fld("sf-name", "Název firmy", 'name="name" required autocomplete="organization"', { value: p.name, err: "Vyplňte název firmy.", full: true })}
      ${fld("sf-ico", "IČO", 'name="ico" readonly autocomplete="off"', { value: a.ico, hint: "IČO mění jen obchodní oddělení." })}
      ${fld("sf-dic", "DIČ", 'name="dic" autocomplete="off" spellcheck="false" pattern="(CZ|SK|cz|sk)? ?[0-9]{8,10}" maxlength="13"', { value: p.dic, opt: true, err: "DIČ má tvar CZ a 8 až 10 číslic." })}
      ${fld("sf-street", "Ulice a číslo", 'name="street" required autocomplete="billing address-line1"', { value: p.street, err: "Vyplňte ulici a číslo.", full: true })}
      ${fld("sf-zip", "PSČ", 'name="zip" required inputmode="numeric" pattern="[0-9]{3} ?[0-9]{2}" maxlength="6" autocomplete="billing postal-code"', { value: p.zip, err: "PSČ má 5 číslic, např. 615 00." })}
      ${fld("sf-city", "Obec", 'name="city" required autocomplete="billing address-level2"', { value: p.city, err: "Vyplňte obec." })}
      ${countrySel("sf-country", p.country, "billing country")}
    </div>
    <div class="acc-acts"><button class="btn primary" type="submit">Uložit údaje firmy</button></div>
  </form>
  <form class="panel" id="set-heslo" data-set-pw novalidate aria-labelledby="sp-h">
    <h2 id="sp-h">Přihlášení a heslo</h2>
    ${ERRS}
    ${fld("sp-user", "Přihlašovací e-mail", 'name="username" type="email" autocomplete="username" readonly', { value: prim.email, hint: "E-mail hlavního kontaktu. Změníte ho v kontaktních osobách." })}
    ${fld("sp-cur", "Současné heslo", 'name="cur" type="password" autocomplete="current-password" required', { err: "Zadejte současné heslo." })}
    ${fld("sp-new", "Nové heslo", 'name="pw" type="password" autocomplete="new-password" minlength="8" maxlength="128" required', { hint: "Aspoň 8 znaků. Dobře poslouží několik slov za sebou.", err: "Zadejte nové heslo." })}
    <label class="check"><input type="checkbox" data-show-pw> <span>Zobrazit hesla</span></label>
    <div class="acc-acts"><button class="btn primary" type="submit">Změnit heslo</button></div>
    <div class="note-box">${icon("info")}<span>Ukázka: heslo zůstává jen v tomto prohlížeči, uložené jako otisk SHA-256.${a.pw ? "" : " Dokud si ho nezměníte, projde jakékoli současné heslo."}</span></div>
  </form>
  <section class="panel set-wide" id="set-adresy" aria-labelledby="sa-h">
    <div class="set-head"><h2 id="sa-h">Doručovací adresy <span class="count">${a.addresses.length}</span></h2><button class="btn" type="button" data-addr-new>${icon("plus")} Přidat adresu</button></div>
    <p class="muted">Výchozí adresu předvyplníme v objednávce, ostatní vyberete v kroku Doprava.</p>
    ${addrs ? `<ul class="addr-grid">${addrs}</ul>` : `<p class="empty-note">Zatím žádná adresa. Bez ní napíšete adresu do každé objednávky ručně.</p>`}
  </section>
  <section class="panel" id="set-kontakty" aria-labelledby="sk-h">
    <div class="set-head"><h2 id="sk-h">Kontaktní osoby <span class="count">${a.contacts.length}</span></h2><button class="btn" type="button" data-ct-new>${icon("plus")} Přidat kontakt</button></div>
    <p class="muted">Hlavní kontakt se přihlašuje do účtu a předvyplníme ho v objednávce. Ostatní v objednávce vyberete.</p>
    <ul class="ct-list">${contacts}</ul>
  </section>
  <form class="panel" id="set-upozorneni" data-set-notify novalidate aria-labelledby="su-h">
    <h2 id="su-h">Upozornění e-mailem</h2>
    <div class="set-sws">
      ${SW("orders", "Objednávky a poptávky", `Potvrzení, expedice, faktury a nabídky od obchodníka. Posíláme na ${esc(prim.email)}.`, a.notify?.orders ?? true)}
      ${SW("reminfo", "REMinfo", "Bulletin o nových produktech a aplikacích jednotlivých výrobců", nl.reminfo)}
      ${SW("enovinky", "E-novinky", "Krátké zprávy mezi vydáními REMinfo: novinky, ceníky, školení", nl.enovinky)}
    </div>
    ${fld("su-nl", "Zpravodaje posílat na", 'name="nlemail" type="email" autocomplete="email" spellcheck="false" required', { value: nl.email || prim.email, err: "Zadejte e-mail ve tvaru jmeno@firma.cz." })}
    <p class="muted set-arch">Všechna rozeslaná vydání najdete v <a href="${url("e-novinky.html")}">archivu e-novinek a REMinfo</a>.</p>
    <p class="muted set-saved" data-saved role="status">Změny ukládáme hned.</p>
  </form>
</div>`;
}
function renderSettings(panel) {
  const a = syncSession();
  if (!a) return;
  panel.innerHTML = settingsHtml(a);
  bindSettings(panel, a);
}
accountExt.tabs.push({ key: "nastaveni", name: "Nastavení účtu", render: renderSettings });

// save, redraw the account page (head, header and tab follow the change), put focus back where the user was
function commit(a, msg, focusSel) {
  saveAccount(a);
  accountExt.refresh();
  if (msg) toast(msg);
  if (focusSel) $(focusSel)?.focus();
}
function bindSettings(panel, a) {
  const fc = $("[data-set-company]", panel);
  fc.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (!check(fc)) return;
    const v = (k) => fc[k].value.trim();
    commit({ ...a, profile: { name: v("name"), dic: v("dic").toUpperCase().replace(/\s/g, ""), street: v("street"), zip: zipFmt(v("zip")), city: v("city"), country: fc.country.value } }, "Údaje firmy jsou uložené.", "#set-firma button[type=submit]");
  });

  const fp = $("[data-set-pw]", panel);
  const email = primaryOf(a).email;
  fp.pw.addEventListener("input", () => pwRule(fp.pw, email));
  fp.cur.addEventListener("input", () => fp.cur.setCustomValidity(""));
  fp.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    pwRule(fp.pw, email);
    if (!fp.pw.validationMessage && fp.pw.value && fp.pw.value === fp.cur.value) fp.pw.setCustomValidity("Nové heslo je stejné jako současné.");
    if (fp.cur.value && a.pw && a.pw !== (await pwHash(a.ico, fp.cur.value))) fp.cur.setCustomValidity("Současné heslo nesedí.");
    if (!check(fp)) return;
    commit({ ...a, pw: await pwHash(a.ico, fp.pw.value) }, "Heslo je změněné. Příště se přihlásíte novým.", "#set-heslo button[type=submit]");
  });

  const fn = $("[data-set-notify]", panel);
  const said = $("[data-saved]", fn);
  fn.addEventListener("submit", (ev) => ev.preventDefault());
  fn.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.name === "orders") {
      a.notify = { orders: t.checked };
      saveAccount(a);
    } else {
      if (!fn.nlemail.checkValidity()) {
        check(fn);
        said.textContent = "Zpravodaje jsme neuložili: opravte e-mail.";
        return;
      }
      store.set("newsletter", { email: fn.nlemail.value.trim(), reminfo: fn.reminfo.checked, enovinky: fn.enovinky.checked });
    }
    said.textContent = `Uloženo v ${new Date().toLocaleTimeString("cs-CZ", { hour: "numeric", minute: "2-digit" })}.`;
  });

  panel.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if ("addrNew" in d) addrDialog(a, null, b);
    else if (d.addrEdit) addrDialog(a, d.addrEdit, b);
    else if (d.addrDef) {
      const ad = a.addresses.find((x) => x.id === d.addrDef);
      commit({ ...a, defaultAddr: d.addrDef }, `Výchozí adresa: ${ad.label}.`, `[data-addr="${d.addrDef}"] [data-addr-edit]`);
    } else if (d.addrDel) confirmDel(b, "adresu", () => {
      const rest = a.addresses.filter((x) => x.id !== d.addrDel);
      commit({ ...a, addresses: rest, defaultAddr: a.defaultAddr === d.addrDel ? rest[0]?.id || null : a.defaultAddr }, "Adresa je smazaná.", "[data-addr-new]");
    });
    else if ("ctNew" in d) contactDialog(a, null, b);
    else if (d.ctEdit) contactDialog(a, d.ctEdit, b);
    else if (d.ctDel) confirmDel(b, "kontakt", () => commit({ ...a, contacts: a.contacts.filter((x) => x.id !== d.ctDel) }, "Kontakt je smazaný.", "[data-ct-new]"));
  });
}
// deleting asks once, in place
function confirmDel(btn, what, yes) {
  const box = btn.parentElement, keep = box.innerHTML;
  box.innerHTML = `<span class="del-q">Opravdu smazat ${what}?</span><button class="btn dark" type="button" data-yes>Smazat</button><button class="btn quiet" type="button" data-no>Ponechat</button>`;
  const restore = (ev) => { ev.stopPropagation(); box.innerHTML = keep; $("[data-addr-del], [data-ct-del]", box)?.focus(); };
  $("[data-yes]", box).addEventListener("click", (ev) => { ev.stopPropagation(); yes(); });
  $("[data-no]", box).addEventListener("click", restore);
  $("[data-no]", box).focus();
}

/* ---------- address and contact dialogs ---------- */
function dialogEl() {
  let d = $("#set-dlg");
  if (!d) {
    d = document.createElement("dialog");
    d.id = "set-dlg";
    d.className = "set-dlg";
    d.setAttribute("aria-labelledby", "set-dlg-h");
    document.body.append(d);
  }
  return d;
}
function openDialog(title, body, onSave, opener) {
  const d = dialogEl();
  d.innerHTML = `<div class="dlg-head"><h2 id="set-dlg-h" style="font-size:24px">${title}</h2><form method="dialog"><button class="x" aria-label="Zavřít">${icon("x")}</button></form></div>
    <form class="dlg-body" novalidate>${ERRS}${body}</form>`;
  const f = $("form.dlg-body", d);
  $("[data-dlg-close]", f)?.addEventListener("click", () => d.close());
  f.addEventListener("submit", (ev) => { ev.preventDefault(); if (check(f)) { d.close(); onSave(f); } });
  d.onclose = () => { if (opener?.isConnected) opener.focus(); };
  d.showModal();
  $("input:not([readonly])", f)?.focus();
}
const dlgActs = (save) => `<div class="acc-acts"><button class="btn primary" type="submit">${save}</button><button class="btn quiet" type="button" data-dlg-close>Zrušit</button></div>`;
function addrDialog(a, id, opener) {
  const ad = a.addresses.find((x) => x.id === id) || { name: a.profile.name, country: "CZ" };
  const isDef = id && id === a.defaultAddr;
  const v = (k) => ad[k] || "";
  openDialog(id ? "Upravit adresu" : "Nová doručovací adresa", `<div class="formgrid">
      ${fld("da-label", "Název adresy", 'name="label" required maxlength="60" autocomplete="off"', { value: v("label"), hint: "Abyste ji poznali v objednávce, třeba Sklad Brno.", err: "Pojmenujte adresu.", full: true })}
      ${fld("da-name", "Příjemce", 'name="name" required autocomplete="shipping organization"', { value: v("name"), err: "Vyplňte firmu nebo jméno příjemce.", full: true })}
      ${fld("da-street", "Ulice a číslo", 'name="street" required autocomplete="shipping address-line1"', { value: v("street"), err: "Vyplňte ulici a číslo.", full: true })}
      ${fld("da-zip", "PSČ", 'name="zip" required inputmode="numeric" pattern="[0-9]{3} ?[0-9]{2}" maxlength="6" autocomplete="shipping postal-code"', { value: v("zip"), err: "PSČ má 5 číslic, např. 615 00." })}
      ${fld("da-city", "Obec", 'name="city" required autocomplete="shipping address-level2"', { value: v("city"), err: "Vyplňte obec." })}
      ${countrySel("da-country", ad.country, "shipping country")}
      ${fld("da-note", "Poznámka pro dopravce", 'name="note" maxlength="120" autocomplete="off"', { value: v("note"), opt: true, full: true, hint: "Např. rampa B, příjem Po–Pá 7–15 h, telefon na vrátnici." })}
    </div>
    <label class="check"><input type="checkbox" name="def"${isDef || !a.addresses.length ? " checked" : ""}${isDef ? " disabled" : ""}> <span>Výchozí adresa pro objednávky</span></label>
    ${dlgActs("Uložit adresu")}`, (f) => {
    const t = (k) => f[k].value.trim();
    const next = { id: id || rid("a"), label: t("label"), name: t("name"), street: t("street"), zip: zipFmt(t("zip")), city: t("city"), country: f.country.value, note: t("note") };
    const list = id ? a.addresses.map((x) => (x.id === id ? next : x)) : [...a.addresses, next];
    commit({ ...a, addresses: list, defaultAddr: f.def.checked || !a.defaultAddr ? next.id : a.defaultAddr }, id ? "Adresa je uložená." : `Adresa ${next.label} je přidaná.`, `[data-addr="${next.id}"] [data-addr-edit]`);
  }, opener);
}
function contactDialog(a, id, opener) {
  const c = a.contacts.find((x) => x.id === id) || {};
  const main = id && id === a.primary;
  openDialog(id ? "Upravit kontakt" : "Nový kontakt", `<div class="formgrid">
      ${fld("dc-name", "Jméno a příjmení", 'name="name" required autocomplete="off"', { value: c.name || "", err: "Vyplňte jméno.", full: true })}
      ${fld("dc-email", "E-mail", 'name="email" type="email" required autocomplete="off" spellcheck="false"', { value: c.email || "", err: "Zadejte e-mail ve tvaru jmeno@firma.cz." })}
      ${fld("dc-tel", "Telefon", 'name="tel" type="tel" autocomplete="off" pattern="\\+?[0-9 ]{9,17}"', { value: c.tel || "", opt: true, err: "Telefon zadejte jako +420 600 000 000." })}
    </div>
    <label class="check"><input type="checkbox" name="main"${main ? " checked disabled" : ""} aria-describedby="dc-main-h"> <span>Hlavní kontakt</span></label>
    <p class="hint" id="dc-main-h">${main ? "Hlavní kontakt se přihlašuje do účtu. Jiného hlavního nastavíte u jeho kontaktu." : "Hlavní kontakt se přihlašuje do účtu svým e-mailem a předvyplníme ho v objednávce."}</p>
    ${dlgActs("Uložit kontakt")}`, (f) => {
    const t = (k) => f[k].value.trim();
    const next = { id: id || rid("c"), name: t("name"), email: t("email"), tel: t("tel") };
    const list = id ? a.contacts.map((x) => (x.id === id ? next : x)) : [...a.contacts, next];
    const nowMain = f.main.checked && !main;
    commit({ ...a, contacts: list, primary: nowMain ? next.id : a.primary }, nowMain ? `Hlavní kontakt je teď ${next.name}. Přihlašuje se e-mailem ${next.email}.` : id ? "Kontakt je uložený." : `Kontakt ${next.name} je přidaný.`, `[data-ct="${next.id}"] [data-ct-edit]`);
  }, opener);
}

/* ---------- session sync on every page, checkout and product dialogs ---------- */
const ACC = syncSession();
function enhanceCheckout(form, a) {
  // contact persons: pick who handles this order
  if (a.contacts.length > 1 && form.name) {
    const cur = a.contacts.find((c) => lc(c.email) === lc(form.email.value)) || primaryOf(a);
    form.name.closest(".field").insertAdjacentHTML("beforebegin", `<div class="field full"><label for="co-contact">Kontakt z firemního účtu</label><select class="select" id="co-contact" autocomplete="off">${a.contacts.map((c) => `<option value="${c.id}"${c === cur ? " selected" : ""}>${esc(c.name)}, ${esc(c.email)}</option>`).join("")}</select></div>`);
    $("#co-contact", form).addEventListener("change", (ev) => {
      const c = a.contacts.find((x) => x.id === ev.target.value);
      if (!c) return;
      form.name.value = c.name; form.tel.value = c.tel || ""; form.email.value = c.email;
      form.dispatchEvent(new Event("input", { bubbles: true })); // draft + step bar
    });
  }
  // delivery addresses: the default one is preselected, a one-off address stays possible
  const ta = form.shipaddr, det = ta?.closest("details");
  if (!a.addresses.length || !det) return;
  const text = (ad) => [ad.name, oneLine(ad), ad.note].filter(Boolean).join("\n");
  const fs = document.createElement("fieldset");
  fs.className = "co-addr";
  fs.innerHTML = `<legend>Doručit na</legend><div class="options">${a.addresses.map((ad) => `<label class="opt"><input type="radio" name="addr" value="${ad.id}"><span><strong>${esc(ad.label)}</strong><small>${esc(ad.name)}, ${esc(ad.street)}, ${zipCity(ad)}${ad.country !== "CZ" ? `, ${esc(COUNTRY[ad.country] || ad.country)}` : ""}</small></span>${ad.id === a.defaultAddr ? '<span class="badge">Výchozí</span>' : "<span></span>"}</label>`).join("")}
    <label class="opt"><input type="radio" name="addr" value="jina"><span><strong>Jiná adresa</strong><small>Jen pro tuto objednávku, do účtu ji neukládáme</small></span><span></span></label></div>
    <div class="field" data-addr-other hidden></div>
    <p class="small"><a href="${url("ucet.html#nastaveni")}">Spravovat doručovací adresy</a></p>`;
  det.replaceWith(fs);
  const other = $("[data-addr-other]", fs);
  other.append($('label[for="ship-addr"]', det), ta);
  let custom = "";
  const restored = ta.value.trim(); // from the checkout draft
  const match = a.addresses.find((ad) => text(ad) === restored);
  const start = match ? match.id : restored ? "jina" : a.addresses.find((ad) => ad.id === a.defaultAddr) ? a.defaultAddr : a.addresses[0].id;
  if (start === "jina") custom = restored;
  $(`input[name=addr][value="${start}"]`, fs).checked = true;
  function sync(user) {
    const pickup = $("input[name=ship]:checked", form)?.value === "pickup";
    const pick = $("input[name=addr]:checked", fs).value;
    const ad = a.addresses.find((x) => x.id === pick);
    fs.hidden = pickup;
    other.hidden = pickup || pick !== "jina";
    ta.required = !other.hidden;
    if (pick === "jina" && !pickup) ta.value = custom;
    else ta.value = pickup ? "" : text(ad);
    // each courier serves one country: a saved address abroad can't take PPL (ČR) and a Czech one not the Slovak courier;
    // the other one is disabled, and a selection that no longer fits moves to the courier that does
    const ppl = $('input[name=ship][value="ppl"]', form), sk = $('input[name=ship][value="sk"]', form);
    if (ppl) ppl.disabled = !!ad && ad.country !== "CZ";
    if (sk) sk.disabled = !!ad && ad.country !== "SK";
    const ship = $("input[name=ship]:checked", form);
    if (ad && ship?.disabled) {
      const r = ad.country === "SK" ? sk : ad.country === "CZ" ? ppl : null;
      if (r && r !== ship) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
    }
  }
  ta.addEventListener("input", () => { custom = ta.value; });
  fs.addEventListener("change", (ev) => {
    if (ev.target.name !== "addr") return;
    sync(true);
    if (ev.target.value === "jina") ta.focus();
    form.dispatchEvent(new Event("input", { bubbles: true }));
  });
  form.addEventListener("change", (ev) => { if (ev.target.name === "ship") { sync(false); form.dispatchEvent(new Event("input", { bubbles: true })); } }); // re-save the draft with the address
  sync(false);
}
if (ACC) {
  const co = $("[data-checkout]");
  if (co) enhanceCheckout(co, ACC);
  // product page: "ask a technician" and "hlídat dostupnost" know who is logged in
  const p = primaryOf(ACC);
  for (const [sel, v] of [["#ask-email", p.email], ["#ask-phone", p.tel], ["#w-email", p.email]]) { const i = $(sel); if (i && !i.value && v) i.value = v; }
}

}

// ---- parts/enovinky.js
{
// E-novinky hub (e-novinky.html). The obor and year filters are radios styled by CSS :has() (works without JS);
// this script opens the collapsed years while a filter is on, keeps the filters in the URL hash (#obor-mechanika, #rok-2025, #obor-mechanika&rok-2025, as the issue pages
// link them), says how many issues are shown and offers a way back when a combination has none.
const enHub = document.querySelector("[data-en-hub]");
if (enHub) {
  const shown = enHub.querySelector("[data-en-shown]");
  const empty = enHub.querySelector("[data-en-empty]");
  const rows = [...enHub.querySelectorAll(".en-row")];
  const years = [...enHub.querySelectorAll("details.en-year")];
  const opened = years.map((d) => d.open); // the newest year starts open, the rest collapsed
  const val = (n) => enHub.querySelector(`input[name="${n}"]:checked`)?.value || "";
  const pick = (n, v) => { const r = enHub.querySelector(`input[name="${n}"][value="${CSS.escape(v)}"]`); if (r) r.checked = true; };
  const count = () => {
    const o = val("eno"), y = val("eny");
    const n = rows.filter((r) => (!o || r.dataset.o === o) && (!y || r.dataset.y === y)).length;
    empty.hidden = n > 0;
    years.forEach((d, i) => { d.open = o || y ? true : opened[i]; }); // a filter shows its issues in every year
    shown.textContent = o || y ? (n ? `Zobrazeno ${n} z ${rows.length} vydání.` : "") : "";
  };
  const fromHash = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!/^(obor|rok)-/.test(h)) return;
    const parts = Object.fromEntries(h.split("&").map((p) => [p.split("-")[0], p.slice(p.indexOf("-") + 1)]));
    pick("eno", parts.obor || "");
    pick("eny", parts.rok || "");
    count();
  };
  fromHash();
  addEventListener("hashchange", fromHash);
  enHub.addEventListener("change", (ev) => {
    if (ev.target.name !== "eno" && ev.target.name !== "eny") return;
    const o = val("eno"), y = val("eny");
    const h = [o && `obor-${o}`, y && `rok-${y}`].filter(Boolean).join("&");
    history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
    count();
  });
  enHub.querySelector("[data-en-reset]")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    pick("eno", "");
    pick("eny", "");
    history.replaceState(null, "", location.pathname + location.search);
    count();
    enHub.querySelector("#eo-all")?.focus();
  });
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
