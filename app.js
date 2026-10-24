/* Kronos - lógica de la interfaz.
   Dos modos:
   - ESTÁTICO (publicado en GitHub Pages): si existe data/days.json, carga el
     índice de días (ayer/hoy/mañana), renderiza el seleccionado y las
     estadísticas globales. Los deportes sin contenido se ocultan.
   - EN VIVO: si no, usa el gateway (/api/predict) con selectores interactivos.
*/
(function () {
  "use strict";

  const state = { sports: [], currentSport: null, currentLeague: null, loading: false, mode: "live" };

  const $ = (id) => document.getElementById(id);

  const els = {
    sportPills: $("sportPills"), leagueSelect: $("leagueSelect"), dateInput: $("dateInput"),
    btnPredict: $("btnPredict"), btnPredictLabel: $("btnPredictLabel"), btnRefresh: $("btnRefresh"),
    healthDot: $("healthDot"), healthText: $("healthText"), alertDot: $("alertDot"),
    loadingSection: $("loadingSection"), loadingText: $("loadingText"),
    errorSection: $("errorSection"), errorText: $("errorText"),
    resultsSection: $("resultsSection"), picksGrid: $("picksGrid"), picksCount: $("picksCount"),
    gamesList: $("gamesList"), gamesCount: $("gamesCount"), elapsedText: $("elapsedText"),
    emptyState: $("emptyState"), dateHint: $("dateHint"),
    staticRoot: $("staticRoot"), controlBar: $("controlBar"),
  };

  /* ── utilidades ─────────────────────────────────────── */

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function shiftDate(days) {
    const d = new Date(); d.setDate(d.getDate() + days); return fmtDate(d);
  }
  function initials(name) {
    if (!name) return "?";
    const parts = String(name).split(/[\s\-]/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function fmtDateLong(dateStr) {
    try {
      return new Date(dateStr + (dateStr.length === 10 ? "T12:00:00" : "")).toLocaleDateString("es", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
    } catch (e) { return dateStr; }
  }
  /* Formato numérico uniforme en toda la web (null/"" => "—", no 0). */
  function _toNum(value) {
    if (value === null || value === undefined || value === "") return NaN;
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }
  function fmtProb(p) {
    const v = _toNum(p);
    return Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "—";
  }
  function fmtOdds(o) {
    const v = _toNum(o);
    return Number.isFinite(v) ? v.toFixed(2) : "—";
  }
  function fmtUnits(u) {
    const v = _toNum(u);
    return Number.isFinite(v) ? v.toFixed(2) : "—";
  }
  function fmtWinPct(v) {
    const n = _toNum(v);
    return Number.isFinite(n) ? Math.round(n * 100) + "%" : "—";
  }
  async function api(path, body) {
    const opts = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "GET" };
    const resp = await fetch(path, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }

  /* ── animaciones ────────────────────────────────────── */

  function countUp(el, target, dur = 900) {
    if (target === null || target === undefined) { el.textContent = "-"; return; }
    const t0 = performance.now();
    function step(now) {
      const p = Math.min((now - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target * 100) + "%";
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function animateIn(container) {
    container.querySelectorAll(".pick-card").forEach((c, i) => {
      c.style.animationDelay = `${i * 0.07}s`;
      c.classList.add("visible");
    });
  }
  function countUpAll(scope) {
    scope.querySelectorAll(".prob-big, .m-prob").forEach((el) => {
      if (el.dataset.counted) return;
      el.dataset.counted = "1";
      const t = parseFloat(el.dataset.target || "");
      countUp(el, isNaN(t) ? null : t);
    });
  }

  /* ── builders compartidos ───────────────────────────── */

  const TIER_PRIORITY = { "TOP PICK": 0, "MUY BUENO": 1, "BUENO": 2, "DESTACADO": 3 };
  function tierName(t) { return String(t || "").toUpperCase().trim(); }
  function tierPriority(t) { return TIER_PRIORITY[tierName(t)] ?? 99; }
  function sortPicks(picks) {
    return [...(picks || [])].sort((a, b) => {
      const d = tierPriority(a.tier) - tierPriority(b.tier);
      return d !== 0 ? d : (b.prob || 0) - (a.prob || 0);
    });
  }
  function tierClass(tier) {
    const t = (tier || "").toUpperCase();
    if (t.includes("TOP")) return "tier-top";
    if (t.includes("MUY")) return "tier-muy";
    if (t.includes("BUENO")) return "tier-bueno";
    return "tier-destacado";
  }
  function tierBadge(tier) {
    const t = (tier || "").toUpperCase();
    let cls = "bg-[#e0f2fe] border-[#bae6fd] text-[#0369a1]";
    let dot = "#0284c7";
    if (t.includes("TOP")) { cls = "bg-[#fef3c7] border-[#fde68a] text-[#92400e]"; dot = "#d97706"; }
    else if (t.includes("MUY")) { cls = "bg-[#dcfce7] border-[#bbf7d0] text-[#166534]"; dot = "#059669"; }
    else if (t.includes("DESTACADO")) { cls = "bg-surface-container border-outline-variant text-on-surface-variant"; dot = "#7e7576"; }
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded border font-label-sm text-[10px] font-semibold uppercase tracking-wider ${cls}"><span class="w-1.5 h-1.5 rounded-full" style="background:${dot}"></span>${esc(tier)}</span>`;
  }
  function pickCardHTML(p, estado) {
    return `
      <div class="flex items-center justify-between gap-2 mb-4">
        <span class="font-label-sm text-[11px] text-on-surface-variant tracking-wider uppercase">${esc(p.market)}${p.league_label ? ` · ${esc(p.league_label)}` : ""}</span>
        <span class="flex items-center gap-1.5">${tierBadge(p.tier)}${estado ? estadoBadge(estado) : ""}</span>
      </div>
      <h3 class="font-headline-md text-[17px] leading-snug font-bold text-primary mb-2">${esc(p.match)}</h3>
      <p class="font-body-md text-[14px] text-on-surface-variant font-medium mb-5">Pick: <span class="text-primary font-semibold">${esc(p.pick)}</span></p>
      <div class="flex items-baseline justify-between border-t border-outline-variant pt-4">
        <div>
          <span class="block font-label-sm text-[11px] text-on-surface-variant mb-1">PROBABILIDAD</span>
          <span class="prob-big" data-target="${p.prob ?? ""}">0%</span>
        </div>
        <div class="text-right">
          <span class="block font-label-sm text-[11px] text-on-surface-variant">Unidades: <strong class="font-semibold text-primary">${fmtUnits(p.units)}</strong></span>
          ${p.odds != null ? `<span class="block font-label-sm text-[11px] text-on-surface-variant mt-1">Cuota: <strong class="font-semibold text-primary">${fmtOdds(p.odds)}</strong></span>` : ""}
        </div>
      </div>
      ${p.note ? `<p class="font-label-sm text-[10px] text-on-surface-variant mt-3">${esc(p.note)}</p>` : ""}`;
  }
  function gameRowHTML(g) {
    const conv = g.convergence === true;
    return `
      <div class="p-4 sm:px-6 flex items-center justify-between hover:bg-surface-bright transition-colors cursor-pointer group">
        <div class="flex items-center gap-4 min-w-0">
          <div class="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center font-label-md text-label-md font-semibold text-primary shrink-0">${esc(g.home_abbrev || initials(g.home))}</div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[15px] font-semibold text-primary truncate">${esc(g.home)} <span class="text-on-surface-variant font-normal mx-1">vs</span> ${esc(g.away)}</span>
              ${g.league_label ? `<span class="px-2 py-0.5 rounded bg-surface-container font-label-sm text-[10px] text-on-surface-variant">${esc(g.league_label)}</span>` : ""}
            </div>
            <div class="flex items-center gap-2 mt-0.5">
              ${g.context ? `<span class="font-label-sm text-[11px] text-on-surface-variant truncate">${esc(g.context)}</span>` : ""}
              ${conv ? `<span class="font-label-sm text-[11px] text-accent-emerald font-semibold">✓ conv.</span>` : ""}
            </div>
          </div>
        </div>
        <span class="material-symbols-outlined chevron text-outline group-hover:text-primary transition-colors ml-3">expand_more</span>
      </div>
      <div class="markets-panel bg-surface-container-low/40">
        <div class="px-2 pb-2">
          ${g.extra ? `<div class="market-row" style="border-top:0"><span class="m-label">Alineación</span><span class="m-pick" style="grid-column: span 3">${esc(g.extra)}</span></div>` : ""}
          ${(g.markets || []).map((m) => `
            <div class="market-row ${m.strong ? "strong" : ""}">
              <span class="m-label">${esc(m.label)}</span>
              <span class="m-pick">${esc(m.pick)}</span>
              <span class="m-prob" data-target="${m.prob ?? ""}">${m.prob != null ? "0%" : "-"}</span>
              <span class="m-detail">${esc(m.detail)}</span>
            </div>`).join("")}
        </div>
      </div>`;
  }
  function gameRowBind(row) {
    row.addEventListener("click", () => {
      const panel = row.querySelector(".markets-panel");
      const open = row.classList.toggle("open");
      panel.classList.toggle("open", open);
      panel.style.maxHeight = open ? panel.scrollHeight + "px" : "0px";
      if (open) countUpAll(panel);
    });
  }
  function renderGames(predictions, container) {
    container.innerHTML = "";
    if (!predictions || !predictions.length) return 0;
    predictions.forEach((g) => {
      const row = document.createElement("div");
      row.className = "game-row";
      row.innerHTML = gameRowHTML(g);
      gameRowBind(row);
      container.appendChild(row);
    });
    return predictions.length;
  }
  function renderPicks(picks, container, countEl, resultsMap) {
    container.innerHTML = "";
    if (!picks || !picks.length) {
      if (countEl) countEl.textContent = "";
      return 0;
    }
    const shown = sortPicks(picks);
    if (countEl) countEl.textContent = `(${shown.length})`;
    shown.forEach((p) => {
      const card = document.createElement("div");
      card.className = `pick-card ${tierClass(p.tier)} bg-surface-container-lowest border border-outline-variant rounded-xl p-6 flex flex-col justify-between hover:border-outline transition-colors relative`;
      const estado = resultsMap ? resultsMap[`${p.match}|${p.market}|${p.pick}`] : null;
      card.innerHTML = pickCardHTML(p, estado);
      container.appendChild(card);
    });
    animateIn(container);
    countUpAll(container);
    return shown.length;
  }
  function attachTierFilter(picks, grid, countEl, resultsMap) {
    /* Chips para filtrar por clasificación (TOP / MUY BUENO / BUENO / DESTACADO). */
    const scope = grid.parentElement;
    if (!scope) return;
    const prev = scope.querySelector(".tier-filter-bar");
    if (prev) prev.remove();
    const tiers = [...new Set((picks || []).map((p) => tierName(p.tier)).filter(Boolean))]
      .sort((a, b) => tierPriority(a) - tierPriority(b));
    if (tiers.length < 2) return;
    const bar = document.createElement("div");
    bar.className = "tier-filter-bar flex flex-wrap items-center gap-2 mb-4";
    bar.innerHTML = `<span class="font-mono text-xs text-text-muted uppercase tracking-wider">Clasificación:</span>`;
    const chips = [];
    const make = (label, tier) => {
      const n = tier ? picks.filter((p) => tierName(p.tier) === tier).length : picks.length;
      const b = document.createElement("button");
      b.className = "chip" + (tier ? "" : " on");
      b.textContent = `${label} (${n})`;
      b.addEventListener("click", () => {
        chips.forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        const sub = tier ? picks.filter((p) => tierName(p.tier) === tier) : picks;
        renderPicks(sub, grid, countEl, resultsMap);
      });
      return b;
    };
    chips.push(make("Todas", null));
    tiers.forEach((t) => chips.push(make(t, t)));
    chips.forEach((b) => bar.appendChild(b));
    scope.insertBefore(bar, grid);
  }
  function setBtnLoading(on) {
    state.loading = on;
    els.btnPredict.disabled = on;
    els.btnPredict.classList.toggle("spinning", on);
    els.btnPredictLabel.textContent = on ? "Calculando…" : "Predecir";
  }
  function showError(msg) { els.errorText.textContent = msg; els.errorSection.classList.remove("hidden"); }
  function hideError() { els.errorSection.classList.add("hidden"); }

  /* ═══════════ REGISTRO DE PICKS (últimos 30 días) ═══════════ */

  const SPORT_NAMES = { beisbol: "Béisbol", tenis: "Tenis", futbol: "Fútbol", amfut: "NFL/NCAAF", basquet: "Básquetbol" };
  const ESTADO_CLASS = {
    GANADO: "estado-ganado", PERDIDO: "estado-perdido",
    PENDIENTE: "estado-pendiente", ANULADO: "estado-anulado",
  };
  const registroState = { data: null, sport: "ALL", estado: "ALL", fecha: "ALL", prev: null, loading: false };

  function estadoBadge(estado) {
    const cls = ESTADO_CLASS[estado] || "estado-pendiente";
    return `<span class="estado-badge ${cls}">${esc(estado)}</span>`;
  }

  function registroCard(label, c, big) {
    const pct = fmtWinPct(c.win_pct);
    const cls = c.win_pct == null ? "text-primary" : (c.win_pct >= 0.55 ? "text-accent-emerald" : (c.win_pct < 0.5 ? "text-accent-crimson" : "text-primary"));
    return `<div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-3.5">
      <span class="block font-label-sm text-label-sm text-on-surface-variant">${esc(label)}</span>
      <span class="win-big ${big ? "text-[26px]" : "text-[22px]"} font-bold ${cls}">${pct}</span>
      <span class="block font-label-sm text-[10px] text-on-surface-variant mt-1">${c.ganados || 0}G · ${c.perdidos || 0}P${c.anulados ? ` · ${c.anulados}A` : ""}${c.pendientes ? ` · ${c.pendientes} pend.` : ""}</span>
    </div>`;
  }

  async function fetchRegistro(force) {
    if (registroState.data && !force) return registroState.data;
    let data = null;
    try { data = await api("/api/registro"); } catch (e) { /* modo estático */ }
    if (!data) {
      try {
        const r = await fetch("data/registro.json");
        if (r.ok) data = await r.json();
      } catch (e) { /* sin registro publicado */ }
    }
    registroState.data = data;
    return data;
  }

  function _picksPorDeporte(d) {
    return (d.picks || []).filter(
      (p) => (registroState.sport === "ALL" || p.deporte === registroState.sport)
        && (registroState.fecha === "ALL" || p.fecha === registroState.fecha));
  }

  function renderRegistroFechas(d) {
    const sel = $("registroFecha");
    if (!sel) return;
    const fechas = [...new Set((d.picks || []).map((p) => p.fecha).filter(Boolean))].sort().reverse();
    sel.innerHTML = "";
    sel.add(new Option("Todas las fechas", "ALL"));
    fechas.forEach((f) => sel.add(new Option(f, f)));
    sel.value = registroState.fecha;
    if (!sel.dataset.wired) {
      sel.addEventListener("change", () => {
        registroState.fecha = sel.value;
        renderRegistroFilters(registroState.data);
        renderRegistroRows();
      });
      sel.dataset.wired = "1";
    }
  }

  function _chip(key, label, active, onClick) {
    const b = document.createElement("button");
    b.className = "chip" + (active ? " on" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function renderRegistroFilters(d) {
    const bar = $("registroFilters");
    bar.innerHTML = "";
    const mk = (key, label) => {
      const n = key === "ALL" ? d.total.n : (d.by_sport[key] || {}).n || 0;
      return _chip(key, `${label} (${n})`, registroState.sport === key, () => {
        registroState.sport = key;
        registroState.estado = "ALL";
        renderRegistroFilters(d);
        renderRegistroRows();
      });
    };
    bar.appendChild(mk("ALL", "Todos"));
    Object.keys(d.by_sport).forEach((s) => bar.appendChild(mk(s, SPORT_NAMES[s] || s)));

    const estadoBar = $("registroEstadoFilters");
    if (!estadoBar) return;
    estadoBar.innerHTML = "";
    const base = _picksPorDeporte(d);
    const n = (e) => base.filter((p) => p.estado === e).length;
    estadoBar.appendChild(_chip("ALL", `Todos (${base.length})`, registroState.estado === "ALL", () => {
      registroState.estado = "ALL"; renderRegistroFilters(d); renderRegistroRows();
    }));
    estadoBar.appendChild(_chip("GANADO", `Ganados (${n("GANADO")})`, registroState.estado === "GANADO", () => {
      registroState.estado = "GANADO"; renderRegistroFilters(d); renderRegistroRows();
    }));
    estadoBar.appendChild(_chip("PERDIDO", `Perdidos (${n("PERDIDO")})`, registroState.estado === "PERDIDO", () => {
      registroState.estado = "PERDIDO"; renderRegistroFilters(d); renderRegistroRows();
    }));
    estadoBar.appendChild(_chip("PENDIENTE", `Pendientes (${n("PENDIENTE")})`, registroState.estado === "PENDIENTE", () => {
      registroState.estado = "PENDIENTE"; renderRegistroFilters(d); renderRegistroRows();
    }));
    estadoBar.appendChild(_chip("ANULADO", `Anulados (${n("ANULADO")})`, registroState.estado === "ANULADO", () => {
      registroState.estado = "ANULADO"; renderRegistroFilters(d); renderRegistroRows();
    }));
  }

  function renderRegistroRows() {
    const d = registroState.data;
    if (!d) return;
    const tbody = $("registroRows");
    const empty = $("registroEmpty");
    const rows = _picksPorDeporte(d).filter(
      (p) => registroState.estado === "ALL" || p.estado === registroState.estado);
    tbody.innerHTML = rows.map((p) => `
      <tr class="hover:bg-surface-bright transition-colors">
        <td class="py-3 px-4 font-label-sm text-label-sm text-on-surface-variant whitespace-nowrap">${esc(p.fecha)}</td>
        <td class="py-3 px-4 text-on-surface font-medium col-optional">${esc(SPORT_NAMES[p.deporte] || p.deporte)}</td>
        <td class="py-3 px-4 text-primary font-semibold">${esc(p.partido)}</td>
        <td class="py-3 px-4 text-on-surface-variant font-label-sm text-label-sm col-optional">${esc(p.mercado)}</td>
        <td class="py-3 px-4 font-label-sm text-label-sm font-semibold text-primary">${esc(p.pick)}</td>
        <td class="py-3 px-4 font-label-md text-label-md text-right text-primary">${fmtOdds(p.cuota)}</td>
        <td class="py-3 px-4 font-label-md text-label-md text-right text-primary font-medium">${fmtProb(p.prob)}</td>
        <td class="py-3 px-4 text-center whitespace-nowrap">${estadoBadge(p.estado)}</td>
      </tr>`).join("");
    empty.classList.toggle("hidden", rows.length > 0);
    const msg = empty.querySelector("p");
    if (msg) msg.textContent = "No hay picks con ese filtro en el período.";
  }

  async function loadRegistro(force) {
    const sum = $("registroSummary");
    if (!registroState.data && !registroState.loading) {
      registroState.loading = true;
      sum.innerHTML = `<div class="col-span-full flex items-center gap-2 text-text-muted font-headline text-sm"><span class="spinner"></span> Cargando registro…</div>`;
      await fetchRegistro(force);
      registroState.loading = false;
    }
    const d = registroState.data;
    if (!d) {
      sum.innerHTML = `<div class="col-span-full font-headline text-sm text-text-muted">No se pudo cargar el registro.</div>`;
      $("registroFilters").innerHTML = "";
      $("registroRows").innerHTML = "";
      $("registroEmpty").classList.remove("hidden");
      return;
    }
    const upd = d.generated_at ? new Date(d.generated_at).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" }) : "";
    $("registroMeta").textContent = `Últimos ${d.days} días · ${d.total.n} picks${upd ? ` · actualizado ${upd}` : ""}`;
    let html = registroCard("Total", d.total, true);
    Object.keys(d.by_sport).forEach((s) => { html += registroCard(SPORT_NAMES[s] || s, d.by_sport[s], false); });
    sum.innerHTML = html;
    renderRegistroFechas(d);
    renderRegistroFilters(d);
    renderRegistroRows();
    const excel = $("btnExcel");
    if (excel) excel.href = state.mode === "static" ? "data/picks.xlsx" : "/api/registro.xlsx";
  }

  const REGISTRO_HIDE = ["heroHeader", "controlBar", "staticRoot", "resultsSection", "loadingSection", "errorSection", "auditPanel"];

  function setNavActive(key) {
    document.querySelectorAll(".nav-link").forEach((n) => {
      const on = n.dataset.nav === key;
      n.classList.toggle("border-b-2", on);
      n.classList.toggle("border-primary", on);
      n.classList.toggle("text-primary", on);
    });
  }

  function openRegistro() {
    if (!registroState.prev) {
      registroState.prev = {};
      REGISTRO_HIDE.forEach((id) => {
        const el = $(id);
        if (el) registroState.prev[id] = { hidden: el.classList.contains("hidden"), display: el.style.display };
      });
    }
    REGISTRO_HIDE.forEach((id) => { const el = $(id); if (el) el.classList.add("hidden"); });
    const hero = $("heroHeader");
    if (hero) hero.style.display = "none";
    $("registroSection").classList.remove("hidden");
    setNavActive("registro");
    loadRegistro();
  }

  function closeRegistro() {
    $("registroSection").classList.add("hidden");
    if (registroState.prev) {
      Object.keys(registroState.prev).forEach((id) => {
        const el = $(id);
        const st = registroState.prev[id];
        if (!el || !st) return;
        el.classList.toggle("hidden", st.hidden);
        el.style.display = st.display || "";
      });
      registroState.prev = null;
    }
    setNavActive("dashboard");
  }

  function wireRegistro() {
    const link = document.querySelector('[data-nav="registro"]');
    if (link) link.addEventListener("click", (e) => { e.preventDefault(); openRegistro(); });
    const pro = $("btnPro");
    if (pro) pro.addEventListener("click", openRegistro);
    const close = $("registroClose");
    if (close) close.addEventListener("click", closeRegistro);
    if (state.mode === "static") {
      document.querySelectorAll(".nav-link").forEach((n) => {
        n.addEventListener("click", () => {
          if (n.dataset.nav === "registro") return; // lo maneja el listener de arriba
          if (n.dataset.nav === "dashboard") {
            if (registroState.prev) closeRegistro();
            window.scrollTo({ top: 0, behavior: "smooth" });
          } else if (n.dataset.nav === "cartelera") {
            const p = $("staticPanels");
            if (p) p.scrollIntoView({ behavior: "smooth", block: "start" });
          } else if (n.dataset.nav === "modelos") {
            const s = $("statsSection");
            if (s && s.offsetHeight) s.scrollIntoView({ behavior: "smooth", block: "start" });
            else openRegistro();
          }
        });
      });
    }
  }

  function openRegistroSiHash() {
    if (location.hash === "#registro") openRegistro();
  }

  /* ═══════════ RESULTADOS DE LA JORNADA ═══════════ */

  function _resultsMap(data) {
    const map = {};
    ((data && data.picks) || []).forEach((p) => {
      map[`${p.partido}|${p.mercado}|${p.pick}`] = p.estado;
    });
    return map;
  }

  async function fetchDayResults(day) {
    try {
      const r = await api(`/api/resultados?day=${encodeURIComponent(day)}`);
      if (r && r.ok) return r;
    } catch (e) { /* modo estático */ }
    try {
      const r = await fetch(`data/resultados-${day}.json`);
      if (r.ok) return await r.json();
    } catch (e) { /* sin archivo */ }
    return null;
  }

  function renderDayResults(container, data) {
    if (!container) return;
    const head = `<div class="flex items-center gap-2">
      <span class="material-symbols-outlined text-primary text-[22px]">fact_check</span>
      <h2 class="font-headline-lg text-headline-lg font-bold text-primary">Resultados de la Jornada</h2>
    </div>`;
    if (!data || !(data.picks || []).length) {
      container.innerHTML = `<header class="mb-3">${head}
        <p class="font-label-sm text-label-sm text-on-surface-variant mt-1">Sin picks registrados para esta fecha.</p></header>`;
      return;
    }
    const t = data.total || {};
    const card = (label, value, cls) => `<div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-3.5">
      <span class="block font-label-sm text-label-sm text-on-surface-variant">${label}</span>
      <span class="win-big text-[22px] font-bold ${cls}">${value || 0}</span>
      <span class="block font-label-sm text-[10px] text-on-surface-variant mt-1">picks</span>
    </div>`;
    const rows = (data.picks || []).map((p) => `
      <tr class="hover:bg-surface-bright transition-colors">
        <td class="py-2.5 px-4 text-on-surface font-medium col-optional">${esc(SPORT_NAMES[p.deporte] || p.deporte)}</td>
        <td class="py-2.5 px-4 text-primary font-semibold">${esc(p.partido)}</td>
        <td class="py-2.5 px-4 text-on-surface-variant font-label-sm text-label-sm col-optional">${esc(p.mercado)}</td>
        <td class="py-2.5 px-4 font-label-sm text-label-sm font-semibold text-primary">${esc(p.pick)}</td>
        <td class="py-2.5 px-4 font-label-md text-label-md text-right text-primary">${fmtOdds(p.cuota)}</td>
        <td class="py-2.5 px-4 font-label-md text-label-md text-right text-primary font-medium">${fmtProb(p.prob)}</td>
        <td class="py-2.5 px-4 text-center whitespace-nowrap">${estadoBadge(p.estado)}</td>
      </tr>`).join("");
    container.innerHTML = `
      <header class="mb-4">${head}
        <p class="font-label-sm text-label-sm text-on-surface-variant mt-1">${esc(data.day)} · ${t.n || 0} picks</p>
      </header>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        ${card("Ganados", t.ganados, "text-accent-emerald")}
        ${card("Perdidos", t.perdidos, "text-accent-crimson")}
        ${card("Anulados", t.anulados, "text-on-surface")}
        ${card("Pendientes", t.pendientes, "text-on-surface")}
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-x-auto shadow-sm">
        <table class="reg-table w-full text-left border-collapse">
          <thead><tr class="border-b border-outline-variant bg-surface-bright">
            <th class="py-2.5 px-4 font-label-sm text-label-sm text-on-surface-variant font-semibold col-optional">DEPORTE</th>
            <th class="py-2.5 px-4 font-label-sm text-label-sm text-on-surface-variant font-semibold">PARTIDO</th>
            <th class="py-2.5 px-4 font-label-sm text-label-sm text-on-surface-variant font-semibold col-optional">MERCADO</th>
            <th class="py-2.5 px-4 font-label-sm text-label-sm text-on-surface-variant font-semibold">PICK</th>
            <th class="py-2.5 px-4 font-label-sm text-label-sm text-on-surface-variant font-semibold text-right">CUOTA</th>
            <th class="py-2.5 px-4 font-label-sm text-label-sm text-on-surface-variant font-semibold text-right">PROB.</th>
            <th class="py-2.5 px-4 font-label-sm text-label-sm text-on-surface-variant font-semibold text-center">ESTADO</th>
          </tr></thead>
          <tbody class="divide-y divide-surface-container">${rows}</tbody>
        </table>
      </div>`;
  }

  /* ═══════════ MODO EN VIVO ═══════════ */

  function renderSportPills() {
    els.sportPills.innerHTML = "";
    state.sports.forEach((s) => {
      const btn = document.createElement("button");
      btn.className = "pill";
      btn.dataset.key = s.key;
      btn.innerHTML = `<span class="material-symbols-outlined">${esc(s.icon)}</span>${esc(s.name)}`;
      btn.addEventListener("click", () => selectSport(s.key));
      els.sportPills.appendChild(btn);
    });
    if (state.sports.length) selectSport(state.sports[0].key, true);
  }
  function selectSport(key, force = false) {
    if (!force && key === state.currentSport?.key) return;
    const sport = state.sports.find((s) => s.key === key);
    if (!sport) return;
    state.currentSport = sport;
    document.querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p.dataset.key === key));
    els.leagueSelect.innerHTML = "";
    const opts = [];
    if (sport.leagues.length > 1) opts.push(new Option("Todas las ligas", "ALL"));
    sport.leagues.forEach((lg) => opts.push(new Option(lg.name, lg.code)));
    opts.forEach((o) => els.leagueSelect.add(o));
    state.currentLeague = opts[0].value;
    if (!els.dateInput.value) els.dateInput.value = shiftDate(0);
  }
  async function predict(force = false) {
    if (state.loading) return;
    if (!state.currentSport || !state.currentLeague) { showError("Selecciona deporte y liga."); return; }
    hideError();
    els.resultsSection.classList.add("hidden");
    els.loadingSection.classList.remove("hidden");
    els.loadingText.textContent = `Consultando al modelo de ${state.currentSport.name} (${state.currentLeague})… puede tardar unos segundos`;
    setBtnLoading(true);
    try {
      const data = await api("/api/predict", {
        sport: state.currentSport.key, league: state.currentLeague,
        date: els.dateInput.value, refresh: force ? 1 : 0,
      });
      els.loadingSection.classList.add("hidden");
      els.resultsSection.classList.remove("hidden");
      const results = await fetchDayResults(els.dateInput.value);
      const rmap = _resultsMap(results);
      renderPicks(data.picks || [], els.picksGrid, els.picksCount, rmap);
      attachTierFilter(data.picks || [], els.picksGrid, els.picksCount, rmap);
      renderDayResults($("liveDayResults"), results);
      const n = renderGames(data.predictions || [], els.gamesList);
      if (n === 0) els.emptyState.classList.remove("hidden"); else els.emptyState.classList.add("hidden");
      els.gamesCount.textContent = n ? `(${n})` : "";
      if (data.elapsed_s) els.elapsedText.textContent = `modelo ${data.sport_name || ""} · ${data.elapsed_s}s`;
      if (data.message) els.dateHint.textContent = data.message;
      renderLeagueFilter(data);
    } catch (err) {
      els.loadingSection.classList.add("hidden");
      els.resultsSection.classList.add("hidden");
      showError(err.message || "Error desconocido");
    } finally {
      setBtnLoading(false);
    }
  }
  function renderLeagueFilter(data) {
    const prev = document.getElementById("leagueFilterBar");
    if (prev) prev.remove();
    if (!data.all_leagues || !data.predictions || !data.predictions.length) return;
    const codes = [...new Set(data.predictions.map((g) => g.league_code).filter(Boolean))];
    if (codes.length < 2) return;
    const bar = document.createElement("div");
    bar.id = "leagueFilterBar";
    bar.className = "flex flex-wrap items-center gap-2 mb-4";
    bar.innerHTML = `<span class="font-mono text-xs text-text-muted uppercase tracking-wider">Liga:</span>`;
    const pills = [];
    const make = (label, code) => {
      const b = document.createElement("button");
      b.className = "chip" + (code === "" ? " on" : "");
      b.textContent = label;
      b.addEventListener("click", () => {
        pills.forEach((x) => x.classList.remove("on")); b.classList.add("on");
        const preds = (data.predictions || []).filter((g) => !code || g.league_code === code);
        const pks = (data.picks || []).filter((p) => !code || p.league_code === code);
        renderGames(preds, els.gamesList);
        renderPicks(pks, els.picksGrid, els.picksCount);
        attachTierFilter(pks, els.picksGrid, els.picksCount);
        els.gamesCount.textContent = preds.length ? `(${preds.length})` : "";
        if (preds.length === 0) els.emptyState.classList.remove("hidden"); else els.emptyState.classList.add("hidden");
      });
      return b;
    };
    pills.push(make("Todas", ""));
    codes.forEach((c) => pills.push(make(c, c)));
    pills.forEach((b) => bar.appendChild(b));
    els.resultsSection.insertBefore(bar, els.resultsSection.firstChild);
  }

  let healthTimer = null;
  function scheduleHealth(ms) { if (healthTimer) clearInterval(healthTimer); healthTimer = setInterval(refreshHealth, ms); }

  /* ── Recuento de picks ─────────────────────────────────── */

  const auditSportNames = { futbol: "Fútbol", beisbol: "Béisbol", tenis: "Tenis", amfut: "NFL/NCAAF", basquet: "Básquetbol" };
  const tierOrder = ["TOP PICK", "MUY BUENO", "BUENO", "DESTACADO"];

  function auditCard(title, g, p, sub) {
    const n = g + p;
    const pct = n ? Math.round(100 * g / n) : 0;
    const good = pct >= 55;
    return `<div class="bg-surface-pure rounded-lg border border-border-subtle p-4">
      <div class="font-mono text-xs text-text-muted uppercase tracking-wider mb-1">${esc(title)}</div>
      <div class="font-headline text-2xl font-semibold ${good ? "text-emerald" : "text-on-surface"}">${pct}%</div>
      <div class="font-mono text-xs text-text-muted">${g}G · ${p}P${sub ? ` · ${esc(sub)}` : ""}</div>
    </div>`;
  }

  async function runAudit(force) {
    const btn = $("btnAudit");
    const lbl = $("btnAuditLabel");
    if (btn.classList.contains("spinning")) return;
    btn.classList.add("spinning");
    btn.disabled = true;
    lbl.textContent = force ? "Contando…" : "Cargando…";
    const panel = $("auditPanel");
    const body = $("auditBody");
    panel.classList.remove("hidden");
    body.textContent = "Cargando…";
    try {
      const resp = await fetch(force ? "/api/audit" : "/api/audit", {
        method: force ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        body: force ? "{}" : undefined,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const t = data.total || {};
      const bySport = data.by_sport || {};
      const byTier = data.by_tier || {};
      const sports = Object.keys(bySport);
      const tiers = tierOrder.filter((k) => byTier[k]);
      let html = `<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">`;
      html += auditCard("Total", t.ganados || 0, t.perdidos || 0, `último audit ${data.last_audit || "-"}`);
      sports.forEach((s) => {
        const v = bySport[s];
        html += auditCard(auditSportNames[s] || s, v.ganados || 0, v.perdidos || 0);
      });
      tiers.forEach((k) => {
        const v = byTier[k];
        html += auditCard(k, v.ganados || 0, v.perdidos || 0);
      });
      html += `</div>`;
      if (sports.length) {
        html += `<p class="font-mono text-xs text-text-muted">Detalle completo: <code>predicciones/picks_tracker.csv</code> (Excel) · resumen en <code>predicciones/resumen.json</code></p>`;
      } else {
        html += `<p class="font-headline text-sm text-text-muted">Aún no hay picks auditados. Cada noche se audita ayer automáticamente; también puedes pedir el recuento con este botón.</p>`;
      }
      body.innerHTML = html;
    } catch (err) {
      body.textContent = "Error al obtener el recuento: " + (err.message || err);
    } finally {
      btn.classList.remove("spinning");
      btn.disabled = false;
      lbl.textContent = "Recuento";
    }
  }
  async function refreshHealth() {
    try {
      const data = await api("/api/health");
      const workers = data.workers || [];
      const running = workers.filter((w) => w.running);
      const ready = running.filter((w) => w.ready);
      const dormant = workers.filter((w) => !w.running);
      const failing = running.filter((w) => w.error);
      const loading = running.filter((w) => !w.ready && !w.error);

      if (failing.length) {
        els.healthDot.className = "status-dot err";
        els.healthText.textContent = `error en: ${failing.map((b) => b.sport).join(", ")}`;
        scheduleHealth(5000);
      } else if (loading.length) {
        els.healthDot.className = "status-dot wait";
        els.healthText.textContent = `activando: ${loading.map((b) => b.sport).join(", ")} · cargando modelos…`;
        scheduleHealth(5000);
      } else if (running.length === 0) {
        els.healthDot.className = "status-dot wait";
        els.healthText.textContent = "modelos en reposo · se activan al predecir";
        scheduleHealth(30000);
      } else {
        els.healthDot.className = "status-dot ok";
        const dormTxt = dormant.length ? ` · ${dormant.length} en reposo` : "";
        els.healthText.textContent = `${ready.length}/${running.length} modelos listos${dormTxt}`;
        scheduleHealth(30000);
      }
    } catch (err) {
      els.healthDot.className = "status-dot err";
      els.healthText.textContent = "gateway sin conexión";
      scheduleHealth(5000);
    }
  }
  async function refreshAlerts() {
    let alerts = [];
    try {
      const resp = await fetch("api/status");
      if (resp.ok) { const d = await resp.json(); alerts = d.alerts || []; }
    } catch (e) { /* gateway fuera -> modo estatico */ }
    if (!alerts.length) {
      try {
        const r2 = await fetch("data/alerts.json");
        if (r2.ok) { const d = await r2.json(); alerts = d.alerts || []; }
      } catch (e2) { /* sin alertas */ }
    }
    const dot = els.alertDot;
    if (!dot) return;
    if (!alerts.length) {
      dot.style.background = "#059669";
      dot.title = "Sin avisos";
    } else {
      const hasError = alerts.some((a) => a.level === "error");
      dot.style.background = hasError ? "#B91C1C" : "#9CA3AF";
      const summary = alerts.map((a) => a.title || "Aviso").join(" · ");
      dot.title = `${alerts.length} aviso${alerts.length === 1 ? "" : "s"}: ${summary}`;
    }
  }
  function initLive() {
    state.mode = "live";
    els.controlBar.classList.remove("hidden");
    els.dateInput.value = shiftDate(0);
    document.querySelectorAll(".chip").forEach((c) => {
      if (c.dataset.offset === "0") c.classList.add("on");
      c.addEventListener("click", () => {
        els.dateInput.value = shiftDate(parseInt(c.dataset.offset, 10));
        document.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
        c.classList.add("on");
      });
    });
    els.btnPredict.addEventListener("click", () => predict(false));
    els.btnRefresh.addEventListener("click", () => predict(true));
    $("btnAudit").addEventListener("click", () => runAudit(true));
    $("auditClose").addEventListener("click", () => $("auditPanel").classList.add("hidden"));
    els.leagueSelect.addEventListener("change", () => { state.currentLeague = els.leagueSelect.value; });
    document.querySelectorAll(".nav-link").forEach((n) => {
      n.addEventListener("click", () => {
        if (n.dataset.nav === "registro") return; // lo maneja wireRegistro
        if (registroState.prev) closeRegistro();
        if (n.dataset.nav === "dashboard") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
        if (n.dataset.nav === "cartelera") {
          const sec = $("carteleraSection");
          if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        if (n.dataset.nav === "modelos") {
          const stats = $("statsSection");
          if (stats && stats.offsetHeight) stats.scrollIntoView({ behavior: "smooth", block: "start" });
          else openRegistro();
          return;
        }
        const sport = state.sports.find((s) => s.key === n.dataset.nav);
        if (sport) selectSport(sport.key);
      });
    });
    wireRegistro();
    window.addEventListener("scroll", () => {
      document.querySelector(".nav-blur").classList.toggle("scrolled", window.scrollY > 8);
    }, { passive: true });
    refreshHealth();
    refreshAlerts();
    api("/api/sports").then((data) => {
      state.sports = data.sports || [];
      renderSportPills();
    }).catch((err) => showError("No se pudo cargar el catálogo de deportes: " + err.message));
  }

  /* ═══════════ MODO ESTÁTICO (publicado) ═══════════ */

  function dayLabel(d, today) {
    if (d === today) return "Hoy";
    const t = new Date(today + "T12:00:00");
    const dt = new Date(d + "T12:00:00");
    const diff = Math.round((dt - t) / 86400000);
    if (diff === -1) return "Ayer";
    if (diff === 1) return "Mañana";
    return d;
  }
  function orderDays(dates, today) {
    const set = new Set(dates);
    const t = new Date(today + "T12:00:00");
    const want = [-1, 0, 1].map((off) => {
      const d = new Date(t); d.setDate(t.getDate() + off); return fmtDate(d);
    });
    const ordered = want.filter((d) => set.has(d));
    dates.forEach((d) => { if (!ordered.includes(d)) ordered.push(d); });
    return ordered;
  }

  function emptyNote(msg) {
    return `<div class="text-center py-20 reveal">
      <span class="material-symbols-outlined text-5xl text-text-muted/40 block mb-4">event_busy</span>
      <p class="font-headline text-sm text-text-muted">${esc(msg)}</p>
    </div>`;
  }

  async function initStatic() {
    state.mode = "static";
    wireRegistro();
    els.controlBar.classList.add("hidden");
    const hero = $("heroHeader");
    if (hero) hero.style.display = "none";
    const healthWrap = $("healthWrap");
    if (healthWrap) healthWrap.style.display = "none";
    els.staticRoot.classList.remove("hidden");
    refreshAlerts();

    let daysData = null;
    try { const r = await fetch("data/days.json"); if (r.ok) daysData = await r.json(); } catch (e) {}
    if (!daysData || !(daysData.days || []).length) {
      els.staticRoot.innerHTML = emptyNote("Aún no hay predicciones publicadas.");
      return;
    }
    const dates = daysData.days.map((d) => d.date).filter(Boolean);
    const today = fmtDate(new Date());
    const ordered = orderDays(dates, today);
    const labels = ordered.map((d) => ({ date: d, label: dayLabel(d, today) }));

    els.staticRoot.innerHTML = `
      <header class="mb-8 reveal">
        <div class="flex items-center gap-2 mb-2">
          <div class="inline-flex items-center justify-center w-6 h-6 rounded bg-surface-container-high text-primary">
            <span class="material-symbols-outlined text-[16px]">bolt</span>
          </div>
          <span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Publicadas automáticamente</span>
        </div>
        <h1 class="font-display-lg text-headline-lg-mobile md:text-display-lg text-primary tracking-tight font-bold">Predicciones del Día</h1>
        <p class="font-body-lg text-body-lg text-on-surface-variant mt-2 max-w-3xl">Selecciona el día y el deporte.</p>
      </header>
      <div class="flex flex-wrap items-center gap-2 mb-3" id="staticDayTabs"></div>
      <div class="font-label-sm text-label-sm text-on-surface-variant mb-6" id="staticDayInfo"></div>
      <div id="staticPanels"></div>
      <div id="staticEmpty" class="hidden"></div>
      <div id="staticDayResults" class="mt-12"></div>
      <div id="statsSection"></div>`;

    const tabs = $("staticDayTabs");
    const tomorrow = shiftDate(1);
    const defaultDate = ordered.includes(tomorrow) ? tomorrow
      : (ordered.includes(today) ? today : ordered[0]);
    labels.forEach((l, i) => {
      const b = document.createElement("button");
      b.className = "chip" + (l.date === defaultDate ? " on" : "");
      b.textContent = l.label;
      b.dataset.date = l.date;
      b.addEventListener("click", () => {
        tabs.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        loadDayAndRender(l.date);
      });
      tabs.appendChild(b);
    });

    loadDayAndRender(defaultDate);
    renderStats();
    openRegistroSiHash();
  }

  async function renderStats() {
    let stats = null;
    try { const r = await fetch("data/stats.json"); if (r.ok) stats = await r.json(); } catch (e) {}
    const el = $("statsSection");
    if (!el || !stats) return;
    const total = stats.total || {};
    const bySport = stats.by_sport || {};
    const byTier = stats.by_tier || {};
    const byMarket = stats.by_market || {};
    const tiers = Object.keys(byTier);
    const markets = Object.keys(byMarket);
    if (!tiers.length && !markets.length && !total.n) return;
    const nOf = (c) => c && (c.n || ((c.ganados || 0) + (c.perdidos || 0)));
    const pct = (c) => {
      const n = nOf(c);
      if (!n) return 0;
      if (c.hits != null) return Math.round(100 * c.hits / n);
      return Math.round(100 * (c.ganados || 0) / n);
    };
    const rate = (c) => {
      const n = nOf(c);
      if (!n) return "—";
      if (c.hits != null) return `${c.hits}/${c.n} (${pct(c)}%)`;
      return `${c.ganados || 0}G · ${c.perdidos || 0}P (${pct(c)}%)`;
    };
    let html = `
      <header class="mt-12 mb-4 reveal">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-[22px]">insights</span>
          <h2 class="font-headline-lg text-headline-lg font-bold text-primary">Rendimiento Real</h2>
        </div>
        <p class="font-label-sm text-label-sm text-on-surface-variant mt-1">Aciertos de los picks publicados vs resultados (se acumula cada día)</p>
      </header>`;
    const statCard = (label, value, detail) => `<div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-3.5">
      <span class="block font-label-sm text-label-sm text-on-surface-variant">${esc(label)}</span>
      <span class="win-big text-[22px] font-bold ${value != null && value >= 55 ? "text-accent-emerald" : "text-primary"}">${value == null ? "—" : value + "%"}</span>
      <span class="block font-label-sm text-[10px] text-on-surface-variant mt-1">${esc(detail)}</span>
    </div>`;
    if (total && total.n) {
      const tg = total.ganados || 0, tp = total.perdidos || 0;
      const p = Math.round(100 * tg / total.n);
      html += `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">`;
      html += statCard("Total", p, `${tg}G · ${tp}P`);
      const sportNames = { futbol: "Fútbol", beisbol: "Béisbol", tenis: "Tenis", amfut: "NFL/NCAAF", basquet: "Básquetbol" };
      Object.keys(bySport).forEach((s) => {
        const v = bySport[s];
        const vn = (v.ganados || 0) + (v.perdidos || 0);
        const vp = vn ? Math.round(100 * (v.ganados || 0) / vn) : null;
        html += statCard(sportNames[s] || s, vp, `${v.ganados || 0}G · ${v.perdidos || 0}P`);
      });
      html += `</div>`;
    }
    if (tiers.length) {
      html += `
        <div class="mb-6">
          <h3 class="font-headline-md text-headline-md font-semibold text-primary mb-3">Por clasificación</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            ${tiers.map((t) => {
              const c = byTier[t];
              return statCard(t, pct(c), rate(c));
            }).join("")}
          </div>
        </div>`;
    }
    if (markets.length) {
      html += `
        <div>
          <h3 class="font-headline-md text-headline-md font-semibold text-primary mb-3">Por mercado</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            ${markets.map((m) => statCard(m, pct(byMarket[m]), rate(byMarket[m]))).join("")}
          </div>
        </div>`;
    }
    el.innerHTML = html;
  }

  function sportInfo(sports, key) {
    return (sports || []).find((s) => s.key === key) || { name: key, icon: "sports" };
  }

  async function loadDayAndRender(date) {
    let day = null;
    try { const r = await fetch(`data/picks-${date}.json`); if (r.ok) day = await r.json(); } catch (e) {}
    let results = null;
    try { const rr = await fetch(`data/resultados-${date}.json`); if (rr.ok) results = await rr.json(); } catch (e) {}
    const rmap = _resultsMap(results);
    const info = $("staticDayInfo");
    const panels = $("staticPanels");
    const empty = $("staticEmpty");

    if (!day) {
      panels.innerHTML = "";
      empty.innerHTML = emptyNote("No hay datos para esta fecha.");
      empty.classList.remove("hidden");
      if (info) info.textContent = `Fecha ${date}`;
      return;
    }
    const res = day.results || {};
    const sports = day.sports || [];
    const keys = Object.keys(res).filter((k) => {
      const r = res[k] || {};
      return (r.predictions && r.predictions.length) || (r.picks && r.picks.length);
    });

    if (info) {
      info.textContent = `${fmtDateLong(date)} · ${day.sports_total || "0 partidos"} · generado ${(day.generated_at || "").replace("T", " ")}`;
    }

    if (!keys.length) {
      panels.innerHTML = "";
      empty.innerHTML = emptyNote("No hay predicciones para este día.");
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    panels.innerHTML = keys.map((k) => {
      const infoSport = sportInfo(sports, k);
      return `
        <div class="static-panel hidden" data-panel="${k}">
          <div class="flex items-center gap-2 mb-5">
            <span class="material-symbols-outlined text-primary text-[20px]">${esc(infoSport.icon)}</span>
            <h2 class="font-headline-lg text-headline-lg font-bold text-primary">${esc(infoSport.name)}</h2>
          </div>
          <div class="mb-10">
            <div class="flex items-baseline gap-2 mb-4">
              <h3 class="font-headline-lg text-headline-lg font-bold text-primary">Picks</h3>
              <span class="font-label-md text-label-md text-on-surface-variant" data-pickcount="${k}"></span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-picks="${k}"></div>
          </div>
          <div class="mb-10">
            <div class="flex items-baseline gap-2 mb-4">
              <h3 class="font-headline-lg text-headline-lg font-bold text-primary">Cartelera</h3>
              <span class="font-label-md text-label-md text-on-surface-variant" data-gamecount="${k}"></span>
            </div>
            <div class="bg-surface-container-lowest border border-outline-variant rounded-xl divide-y divide-surface-container shadow-sm overflow-hidden" data-games="${k}"></div>
          </div>
        </div>`;
    }).join("");

    keys.forEach((k) => {
      const r = res[k] || {};
      const picksEl = panels.querySelector(`[data-picks="${k}"]`);
      const picksCountEl = panels.querySelector(`[data-pickcount="${k}"]`);
      renderPicks(r.picks || [], picksEl, picksCountEl, rmap);
      attachTierFilter(r.picks || [], picksEl, picksCountEl, rmap);
      const n = renderGames(r.predictions || [], panels.querySelector(`[data-games="${k}"]`));
      panels.querySelector(`[data-gamecount="${k}"]`).textContent = n ? `(${n})` : "(sin partidos)";
    });
    renderDayResults($("staticDayResults"), results);

    // Tabs por deporte (solo los que tienen contenido)
    const sportTabs = document.createElement("div");
    sportTabs.className = "flex flex-wrap gap-2 mb-6";
    keys.forEach((k, i) => {
      const infoSport = sportInfo(sports, k);
      const b = document.createElement("button");
      b.className = "pill" + (i === 0 ? " active" : "");
      b.innerHTML = `<span class="material-symbols-outlined">${esc(infoSport.icon)}</span>${esc(infoSport.name)}`;
      b.addEventListener("click", () => {
        sportTabs.querySelectorAll(".pill").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        panels.querySelectorAll(".static-panel").forEach((p) => p.classList.add("hidden"));
        panels.querySelector(`[data-panel="${k}"]`).classList.remove("hidden");
      });
      sportTabs.appendChild(b);
    });
    panels.insertBefore(sportTabs, panels.firstChild);
    panels.querySelector(".static-panel").classList.remove("hidden");

    // Sub-menú de ligas para cualquier deporte con "Todas las ligas"
    Object.keys(res).forEach((k) => {
      const r = res[k];
      if (!r || !r.all_leagues || !r.predictions || !r.predictions.length) return;
      const codes = [...new Set(r.predictions.map((g) => g.league_code).filter(Boolean))];
      if (codes.length < 2) return;
      const box = panels.querySelector(`[data-panel="${k}"]`);
      if (!box) return;
      const bar = document.createElement("div");
      bar.className = "flex flex-wrap items-center gap-2 mb-4";
      bar.innerHTML = `<span class="font-mono text-xs text-text-muted uppercase tracking-wider">Liga:</span>`;
      const mk = (label, code) => {
        const b = document.createElement("button");
        b.className = "chip" + (code === "" ? " on" : "");
        b.textContent = label;
        b.addEventListener("click", () => {
          bar.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
          b.classList.add("on");
          const preds = r.predictions.filter((g) => !code || g.league_code === code);
          const pks = (r.picks || []).filter((p) => !code || p.league_code === code);
          renderGames(preds, box.querySelector(`[data-games="${k}"]`));
          const picksEl = box.querySelector(`[data-picks="${k}"]`);
          const picksCountEl = box.querySelector(`[data-pickcount="${k}"]`);
          renderPicks(pks, picksEl, picksCountEl);
          attachTierFilter(pks, picksEl, picksCountEl);
          box.querySelector(`[data-gamecount="${k}"]`).textContent = preds.length ? `(${preds.length})` : "(sin partidos)";
        });
        return b;
      };
      bar.appendChild(mk("Todas", ""));
      codes.forEach((c) => bar.appendChild(mk(c, c)));
      box.insertBefore(bar, box.firstChild);
    });
  }

  /* ═══════════ init ═══════════ */

  async function init() {
    // Modo estático: si existe data/days.json renderizamos desde ahí.
    try {
      const resp = await fetch("data/days.json", { method: "GET" });
      if (resp.ok) { initStatic(); return; }
    } catch (e) { /* sin red -> modo en vivo */ }
    initLive();
  }

  document.addEventListener("DOMContentLoaded", init);
})();