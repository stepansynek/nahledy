(() => {
  "use strict";

  const { MODELS, TRIMS, PAINTS, EXTRAS, OFFER, FINANCE, DEALERS, TOWNS, MAP, BORDER } = NORIK;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const NUM = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });
  const kc = (n) => `${NUM.format(Math.round(n))} Kč`;
  // Czech typesetting: one-letter words stay with the next word
  const nb = (t) => t.replace(/(^|[\s(])([aikosuvzAIKOSUVZ]) /g, "$1$2 ").replace(/(^|[\s(])([aikosuvzAIKOSUVZ]) /g, "$1$2 ");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const srcset = (base, widths) => widths.map((w) => `${base}-${w}.webp ${w}w`).join(", ");

  // Swap an image for another coat: the new one sweeps across once, from the nose to the tail.
  const sweeps = new WeakMap();
  async function sweep(img, set, src, alt) {
    const job = (sweeps.get(img) || 0) + 1;
    sweeps.set(img, job);
    img.parentElement.querySelectorAll(".is-next").forEach((el) => el.remove());
    const next = img.cloneNode(false);
    next.classList.add("is-next");
    next.alt = "";
    next.setAttribute("aria-hidden", "true");
    next.removeAttribute("fetchpriority");
    next.loading = "eager";
    next.srcset = set;
    next.src = src;
    img.after(next);
    try { await next.decode(); } catch { /* show it anyway */ }
    if (sweeps.get(img) !== job) return;
    if (reduced.matches) next.style.clipPath = "none";
    else await next.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }],
      { duration: 760, easing: "cubic-bezier(.65,0,.35,1)", fill: "forwards" }).finished.catch(() => {});
    if (sweeps.get(img) !== job) return;
    img.srcset = set;
    img.src = src;
    if (alt) img.alt = alt;
    try { await img.decode(); } catch { /* the overlay stays until the next swap */ }
    if (sweeps.get(img) === job) next.remove();
  }

  /* ------------------------------------------------------------ header */
  const header = $("[data-header]");
  const nav = $("#menu");
  const toggle = $("[data-menu-toggle]");
  if (!CSS.supports("(animation-timeline: scroll()) and (animation-range: 0% 100%)")) {
    const solid = () => header.classList.toggle("is-solid", scrollY > 60);
    addEventListener("scroll", solid, { passive: true });
    solid();
  }
  const setMenu = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) { setMenu(false); toggle.focus(); }
  });

  /* ------------------------------------------------------------ hero paint */
  const heroBase = $("[data-hero-base]");
  const heroSizes = heroBase.getAttribute("sizes");
  const heroSet = (id) => srcset(`img/hero/cval-${id}`, [800, 1200, 1800]);
  let heroPaint = "grosak";

  function setHeroPaint(id) {
    if (id === heroPaint) return;
    heroPaint = id;
    const p = PAINTS[id];
    $("[data-hero-paint-name]").textContent = `${p.name}, ${p.kind}`;
    $("[data-hero-price]").textContent = kc(MODELS.cval.base + p.price);
    $("[data-hero-price-note]").textContent = `výbava Start, barva ${p.price ? `+${kc(p.price)}` : "v ceně"}`;
    $("[data-hero-config]").dataset.paint = id;
    sweep(heroBase, heroSet(id), `img/hero/cval-${id}-1200.webp`,
      `Norik Cval v barvě ${p.name} stojí na silnici nad údolím při západu slunce`);
  }
  $$("[data-hero-swatches] input").forEach((input) =>
    input.addEventListener("change", () => setHeroPaint(input.value)));

  // warm the other coats once the page is idle, at whatever size the hero uses
  const warm = () => Object.keys(PAINTS).forEach((id) => {
    if (id === "grosak") return;
    const img = new Image();
    img.sizes = heroSizes;
    img.srcset = heroSet(id);
  });
  addEventListener("load", () => ("requestIdleCallback" in window ? requestIdleCallback(warm) : setTimeout(warm, 1500)));

  /* ------------------------------------------------------------ configurator */
  const form = $("[data-config]");
  const stage = $("[data-stage]");
  const state = { model: "cval", engine: "b110", trim: "start", paint: "grosak", extras: new Set(), pay: "hotove" };

  const extrasFor = (m) => EXTRAS.filter((x) => (!x.only || x.only.includes(m)) && !(x.not || []).includes(m));
  const offerApplies = () => state.model === OFFER.model && OFFER.trims.includes(state.trim) && state.extras.has(OFFER.extra);

  function choice(name, value, title, meta, price, checked) {
    return `<label class="choice"><input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""}>`
      + `<span class="choice__body"><span class="choice__name">${title}</span><span class="choice__price">${price}</span>`
      + (meta ? `<span class="choice__meta">${meta}</span>` : "") + `</span></label>`;
  }

  function renderOptions() {
    const m = MODELS[state.model];
    $("[data-engines]").innerHTML = m.engines.map((e) =>
      choice("motor", e.id, e.name, "", e.price ? `+${kc(e.price)}` : "v ceně", e.id === state.engine)).join("");
    $("[data-trims]").innerHTML = Object.entries(TRIMS).map(([id, t]) =>
      choice("vybava", id, t.name, nb(t.text), m.trims[id] ? `+${kc(m.trims[id])}` : "v ceně", id === state.trim)).join("");
    $("[data-paints]").innerHTML = Object.entries(PAINTS).map(([id, p]) =>
      `<label class="swatch" style="--swatch:${p.hex}"><input type="radio" name="barva" value="${id}"${id === state.paint ? " checked" : ""}>`
      + `<span class="visually-hidden">${p.name}, ${p.kind}, ${p.price ? kc(p.price) : "v ceně"}</span></label>`).join("");
    $("[data-extras]").innerHTML = extrasFor(state.model).map((x) =>
      `<label class="extra"><input type="checkbox" name="doplnky" value="${x.id}"${state.extras.has(x.id) ? " checked" : ""}>`
      + `<span>${nb(x.name)}</span><span class="extra__price" data-extra-price="${x.id}">${kc(x.price)}</span></label>`).join("");
  }

  const stageBody = $("[data-body]", stage);
  const stageWheels = $("[data-wheels]", stage);
  const carSet = (name) => srcset(`img/cars/${name}`, [800, 1600]);
  const setImg = (img, name) => { img.srcset = carSet(name); img.src = `img/cars/${name}-800.webp`; };
  const shown = { model: state.model, paint: state.paint, wheel: "kryt" };

  async function renderStage() {
    const m = MODELS[state.model], paint = PAINTS[state.paint], wheel = TRIMS[state.trim].wheel;
    const alt = `Norik ${m.name} ${TRIMS[state.trim].name} z boku, barva ${paint.name}`;
    $("[data-stage-caption]").textContent = `Norik ${m.name} ${TRIMS[state.trim].name}, barva ${paint.name}`;
    $("[data-paint-name]").textContent = `${paint.name}, ${paint.kind}`;
    if (shown.model !== state.model) {
      // another model: fade the stage out, load both layers, fade back in
      Object.assign(shown, { model: state.model, paint: state.paint, wheel });
      const target = state.model;
      stage.classList.add("is-swapping");
      if (!reduced.matches) await new Promise((r) => setTimeout(r, 200));
      if (target !== state.model) return;
      stage.querySelectorAll(".is-next").forEach((el) => el.remove());
      setImg(stageBody, `${state.model}-${state.paint}`);
      setImg(stageWheels, `${state.model}-kola-${wheel}`);
      stageBody.alt = alt;
      await Promise.all([stageBody.decode(), stageWheels.decode()].map((p) => p.catch(() => {})));
      if (target === state.model) stage.classList.remove("is-swapping");
      return;
    }
    if (shown.paint !== state.paint) {
      shown.paint = state.paint;
      sweep(stageBody, carSet(`${state.model}-${state.paint}`), `img/cars/${state.model}-${state.paint}-800.webp`, alt);
    } else {
      stageBody.alt = alt;
    }
    if (shown.wheel !== wheel) {
      shown.wheel = wheel;
      setImg(stageWheels, `${state.model}-kola-${wheel}`);
    }
  }

  function totals() {
    const m = MODELS[state.model];
    const engine = m.engines.find((e) => e.id === state.engine);
    const paint = PAINTS[state.paint];
    const lines = [[`${m.name} ${TRIMS[state.trim].name}, ${engine.name}`, m.base + engine.price + m.trims[state.trim]],
      [`Barva ${paint.name}`, paint.price]];
    extrasFor(state.model).filter((x) => state.extras.has(x.id)).forEach((x) => lines.push([x.name, x.price]));
    if (offerApplies()) {
      const x = EXTRAS.find((e) => e.id === OFFER.extra);
      lines.push([`Akce: ${x.name.toLowerCase()} zdarma`, -x.price, true]);
    }
    return { lines, total: lines.reduce((s, l) => s + l[1], 0), m, engine, paint };
  }

  function renderSummary() {
    const { lines, total, m } = totals();
    $("[data-summary-lines]").innerHTML = lines.map(([t, p, disc]) =>
      `<div${disc ? ' class="is-discount"' : ""}><dt>${t}</dt><dd>${p === 0 ? "v ceně" : (p < 0 ? "−" : "") + kc(Math.abs(p))}</dd></div>`).join("");
    $("[data-summary-total]").textContent = kc(total);
    $("[data-vat-label]").textContent = m.vat ? "s DPH" : "bez DPH";
    const monthly = $("[data-summary-monthly]");
    if (state.pay === "splatky") {
      const down = total * FINANCE.down;
      const r = FINANCE.rate / 12;
      const pay = (total - down) * r / (1 - (1 + r) ** -FINANCE.months);
      monthly.innerHTML = `Akontace ${Math.round(FINANCE.down * 100)}\u00a0% (${kc(down)}), ${FINANCE.months}\u00a0splátek po <strong>${kc(pay)}</strong>. `
        + `Orientační výpočet s\u00a0úrokem ${String(FINANCE.rate * 100).replace(".", ",")}\u00a0% ročně, přesnou nabídku spočítá prodejce.`;
      monthly.hidden = false;
    } else {
      monthly.hidden = true;
    }
    const free = state.model === OFFER.model && OFFER.trims.includes(state.trim);
    const tag = $(`[data-extra-price="${OFFER.extra}"]`);
    if (tag) {
      const x = EXTRAS.find((e) => e.id === OFFER.extra);
      tag.textContent = free ? `zdarma do ${OFFER.until}` : kc(x.price);
      tag.classList.toggle("is-free", free);
    }
  }

  function render(full) {
    if (full) renderOptions();
    renderStage();
    renderSummary();
    $("[data-config-status]").textContent = "";
  }

  function setModel(id) {
    const m = MODELS[id];
    if (!m) return;
    state.model = id;
    if (!m.engines.some((e) => e.id === state.engine)) state.engine = m.engines[0].id;
    const allowed = extrasFor(id).map((x) => x.id);
    state.extras = new Set([...state.extras].filter((x) => allowed.includes(x)));
  }

  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "model") { setModel(t.value); render(true); return; }
    if (t.name === "motor") state.engine = t.value;
    if (t.name === "vybava") state.trim = t.value;
    if (t.name === "barva") state.paint = t.value;
    if (t.name === "doplnky") t.checked ? state.extras.add(t.value) : state.extras.delete(t.value);
    if (t.name === "platba") state.pay = t.value;
    render(false);
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  function applyParams(params) {
    if (params.get("m")) setModel(params.get("m"));
    const m = MODELS[state.model];
    if (m.engines.some((e) => e.id === params.get("e"))) state.engine = params.get("e");
    if (TRIMS[params.get("t")]) state.trim = params.get("t");
    if (PAINTS[params.get("c")]) state.paint = params.get("c");
    if (params.has("x")) {
      const allowed = extrasFor(state.model).map((x) => x.id);
      state.extras = new Set(params.get("x").split(",").filter((x) => allowed.includes(x)));
    }
    if (params.get("p") === "splatky") state.pay = "splatky";
    $$('input[name="model"]', form).forEach((i) => { i.checked = i.value === state.model; });
    $$('input[name="platba"]', form).forEach((i) => { i.checked = i.value === state.pay; });
    render(true);
  }

  function configUrl() {
    const p = new URLSearchParams({ m: state.model, e: state.engine, t: state.trim, c: state.paint });
    if (state.extras.size) p.set("x", [...state.extras].join(","));
    if (state.pay === "splatky") p.set("p", "splatky");
    return `${location.href.split(/[?#]/)[0]}?${p}#konfigurator`;
  }

  $("[data-config-share]").addEventListener("click", async () => {
    const url = configUrl();
    const status = $("[data-config-status]");
    history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = "Odkaz na tuhle sestavu je ve schránce.";
    } catch {
      status.textContent = "Odkaz je teď v adresním řádku, zkopírujte ho odtamtud.";
    }
  });

  // any "Sestavit" link carries its model (and sometimes trim, extras, paint) into the configurator
  $$("[data-config-link]").forEach((a) => a.addEventListener("click", () => {
    const p = new URLSearchParams({ m: a.dataset.model });
    if (a.dataset.trim) p.set("t", a.dataset.trim);
    if (a.dataset.extras) p.set("x", a.dataset.extras);
    p.set("c", a.dataset.paint || (a.dataset.model === state.model ? state.paint : MODELS[a.dataset.model].paint));
    applyParams(p);
  }));

  applyParams(new URLSearchParams(location.search));

  /* ------------------------------------------------------------ dealers */
  const plain = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const km = (a, b) => {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const xy = (lat, lon) => [(lon - MAP.lon0) * MAP.kx * MAP.k, (MAP.lat0 - lat) * MAP.k];
  const map = $("[data-map]");
  const dealerName = (d) => `Norik ${d[0]}`;

  map.innerHTML = `<path class="map__land" d="${BORDER}"/>`
    + DEALERS.map((d, i) => { const [x, y] = xy(d[2], d[3]); return `<circle class="map__dot" data-dealer="${i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"><title>${dealerName(d)}</title></circle>`; }).join("")
    + `<g data-map-layer></g>`;
  $("[data-towns]").innerHTML = [...new Set(TOWNS.map((t) => t[0]))].sort((a, b) => a.localeCompare(b, "cs"))
    .map((t) => `<option value="${t}"></option>`).join("");
  const dealerSelect = $("[data-dealer-select]");
  [...DEALERS].sort((a, b) => a[0].localeCompare(b[0], "cs")).forEach((d) => {
    dealerSelect.add(new Option(`${dealerName(d)} (${d[1]})`, dealerName(d)));
  });

  const finderStatus = $("[data-finder-status]");
  const results = $("[data-finder-results]");
  function showNearest(here, label) {
    const near = DEALERS.map((d, i) => ({ d, i, dist: km(here, [d[2], d[3]]) }))
      .sort((a, b) => a.dist - b.dist).slice(0, 3);
    finderStatus.classList.remove("is-error");
    finderStatus.textContent = `Nejbližší pobočky ${label}:`;
    results.innerHTML = near.map(({ d, dist }, n) =>
      `<li class="result"><span class="result__no" aria-hidden="true">${n + 1}</span>`
      + `<span class="result__name">${dealerName(d)}</span><span class="result__km">${dist < 1.5 ? "ve městě" : `${NUM.format(Math.round(dist))} km`}</span>`
      + `<span class="result__meta">${d[1] !== d[0] ? `${d[1]}. ` : ""}${d[4]}, Po–Pá 8–18, So\u00a08–12.</span>`
      + `<button class="btn btn--line btn--sm" type="button" data-pick-dealer="${dealerName(d)}">Domluvit jízdu tady</button></li>`).join("");
    $$(".map__dot", map).forEach((c) => c.classList.remove("is-near"));
    const [mx, my] = xy(here[0], here[1]);
    $("[data-map-layer]", map).innerHTML = `<circle class="map__me" cx="${mx}" cy="${my}" r="13"/><circle class="map__me-dot" cx="${mx}" cy="${my}" r="4"/>`
      + near.map(({ d, i }, n) => {
        const dot = $(`[data-dealer="${i}"]`, map);
        dot.classList.add("is-near");
        const [x, y] = xy(d[2], d[3]);
        return `<circle class="map__dot is-near" cx="${x}" cy="${y}" r="12"/><text class="map__num" x="${x}" y="${y}">${n + 1}</text>`;
      }).join("");
  }
  function finderError(msg) {
    finderStatus.textContent = msg;
    finderStatus.classList.add("is-error");
    results.innerHTML = "";
    $("[data-map-layer]", map).innerHTML = "";
  }

  $("[data-finder]").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = plain($("#mesto").value);
    if (!q) { finderError("Napište město, ve kterém bydlíte nebo pracujete."); $("#mesto").focus(); return; }
    const pool = [...TOWNS, ...DEALERS.map((d) => [d[0], d[2], d[3]])];
    const hit = pool.find((t) => plain(t[0]) === q) || pool.find((t) => plain(t[0]).startsWith(q)) || pool.find((t) => plain(t[0]).includes(q));
    if (!hit) {
      finderError(`Město „${$("#mesto").value.trim()}“ v seznamu nemáme. Zkuste nejbližší větší město, nebo použijte svou polohu.`);
      return;
    }
    showNearest([hit[1], hit[2]], `k městu ${hit[0]}`);
  });

  $("[data-geo]").addEventListener("click", () => {
    if (!("geolocation" in navigator)) { finderError("Prohlížeč polohu neumí zjistit. Napište město."); return; }
    finderStatus.classList.remove("is-error");
    finderStatus.textContent = "Zjišťujeme polohu…";
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: la, longitude: lo } = coords;
        if (la < 48.5 || la > 51.1 || lo < 12 || lo > 18.9) { finderError("Vaše poloha je mimo Česko. Napište město, kde chcete auto vyzkoušet."); return; }
        showNearest([la, lo], "k vaší poloze");
      },
      () => finderError("Polohu se nepodařilo zjistit. Napište město."),
      { timeout: 10000, maximumAge: 600000 },
    );
  });

  /* ------------------------------------------------------------ test drive */
  const drive = $("[data-drive]");
  const done = $("[data-drive-done]");
  const note = $("[data-drive-note]");
  const goDrive = (focusEl) => {
    $("#jizda").scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth" });
    setTimeout(() => focusEl?.focus({ preventScroll: true }), reduced.matches ? 0 : 600);
  };
  const firstEmpty = () => $$("select[required], input[required]", drive).find((el) => !el.value && el.type !== "checkbox");

  results.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick-dealer]");
    if (!b) return;
    dealerSelect.value = b.dataset.pickDealer;
    dealerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    goDrive(firstEmpty());
  });

  $$("[data-drive-link]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    if (a.dataset.model) $("#d-model").value = a.dataset.model;
    if (a.dataset.note) note.value = a.dataset.note;
    goDrive(firstEmpty());
  }));

  $("[data-config-drive]").addEventListener("click", () => {
    const { m, engine, paint, total } = totals();
    const extras = extrasFor(state.model).filter((x) => state.extras.has(x.id)).map((x) => x.name.toLowerCase());
    $("#d-model").value = state.model;
    note.value = `Sestava: ${m.name} ${TRIMS[state.trim].name}, ${engine.name}, barva ${paint.name}`
      + (extras.length ? `, ${extras.join(", ")}` : "") + `. Cena ${kc(total)} ${m.vat ? "s DPH" : "bez DPH"}.`;
    goDrive(firstEmpty());
  });

  // aria-invalid follows the visual :user-invalid state
  const syncAria = (el) => {
    if (!el.matches?.("input, select, textarea")) return;
    const bad = el.matches(":user-invalid") || el.closest(".field")?.classList.contains("is-invalid") && !el.checkValidity();
    if (bad) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
  };
  drive.addEventListener("blur", (e) => syncAria(e.target), true);
  drive.addEventListener("input", (e) => {
    const f = e.target.closest(".field");
    if (f && e.target.checkValidity()) f.classList.remove("is-invalid");
    syncAria(e.target);
  });
  drive.addEventListener("change", (e) => {
    const f = e.target.closest(".field");
    if (f && e.target.checkValidity()) f.classList.remove("is-invalid");
    syncAria(e.target);
  });

  drive.addEventListener("submit", (e) => {
    e.preventDefault();
    const bad = $$("input, select, textarea", drive).filter((el) => !el.checkValidity());
    $$(".field", drive).forEach((f) => f.classList.remove("is-invalid"));
    bad.forEach((el) => { el.closest(".field")?.classList.add("is-invalid"); el.setAttribute("aria-invalid", "true"); });
    if (bad.length) { bad[0].focus(); return; }
    const data = new FormData(drive);
    $("[data-drive-done-text]").textContent = `Prodejce ${data.get("prodejce")} vám zavolá na číslo ${data.get("telefon").trim()} `
      + `do konce příštího pracovního dne a domluví s vámi čas jízdy v modelu ${MODELS[data.get("model")].name}.`;
    drive.hidden = true;
    done.hidden = false;
    done.focus();
  });
  $("[data-drive-reset]").addEventListener("click", () => {
    drive.reset();
    $$("[aria-invalid]", drive).forEach((el) => el.removeAttribute("aria-invalid"));
    done.hidden = true;
    drive.hidden = false;
    $("#d-model").focus();
  });
})();
