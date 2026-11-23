/* Picks IA: capa visual separada para kronos-picks-web. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const pct = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;
  const odds = (value) => Number(value || 0).toFixed(2);

  function card(pick) {
    const positive = (pick.factores_positivos || []).map(esc).join(" · ");
    const risks = (pick.riesgos || []).map(esc).join(" · ");
    const label = pick.etiqueta === "VALOR IA" ? "Valor IA" : "Seguro IA";
    const labelClass = pick.etiqueta === "VALOR IA" ? "ai-label-value" : "ai-label-safe";
    return `<article class="ai-value-card">
      <div class="ai-value-head">
        <span class="${labelClass}">${label}</span>
        <span class="ai-score">IA ${(Number(pick.score_ia || 0) * 100).toFixed(0)}</span>
      </div>
      <div class="ai-value-meta">${esc(pick.sport)} · ${esc(pick.market)} · ${esc(pick.league_label || pick.league_code || "")}</div>
      <h3>${esc(pick.match)}</h3>
      <p class="ai-pick-line">Pick: <strong>${esc(pick.pick)}</strong></p>
      <div class="ai-numbers">
        <span><small>PROB.</small><b>${pct(pick.prob)}</b></span>
        <span><small>CUOTA</small><b>${odds(pick.odds)}</b></span>
        <span><small>EV</small><b>${pct(pick.ev)}</b></span>
        <span><small>UNIDADES</small><b>${Number(pick.unidades || 0).toFixed(2)}</b></span>
      </div>
      ${pick.explicacion ? `<p class="ai-explanation">${esc(pick.explicacion)}</p>` : ""}
      ${positive ? `<p class="ai-factors"><strong>A favor:</strong> ${positive}</p>` : ""}
      ${risks ? `<p class="ai-risks"><strong>Riesgos:</strong> ${risks}</p>` : ""}
    </article>`;
  }

  async function load(day) {
    const section = $("aiValueSection");
    const grid = $("aiValueGrid");
    if (!section || !grid || !day) return;
    try {
      const response = await fetch(`ai/ai-picks-${encodeURIComponent(day)}.json`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (!Array.isArray(data.picks) || !data.picks.length) return;
      grid.innerHTML = data.picks.map(card).join("");
      $("aiValueCount").textContent = `(${data.picks.length})`;
      $("aiValueMeta").textContent = `${data.model || "Ollama"} · ${data.status || "ok"}`;
      section.classList.remove("hidden");
    } catch (_) {
      // La web normal nunca debe fallar si el archivo IA todavía no existe.
    }
  }

  function init() {
    const date = $("dateInput");
    if (!date) return;
    const refresh = () => load(date.value);
    date.addEventListener("change", refresh);
    setTimeout(refresh, 900);
  }
  document.addEventListener("DOMContentLoaded", init);
})();
