// Which stages a feature's workflow includes. The toolbox keeps the choice in the feature's folder
// (stages.sh) and its workflow follows it; this file is the Stages button on a feature's page (a menu
// with a tick per stage, planning stages indented under Plan), the one-line summary in the Start
// panel, and the tracker's filter. The server's f.profile is { route, stages: [{ key, label, level, on,
// locked, why }] }, or null when the installed toolbox is too old to have stages (then nothing shows).
// The menu is split.js's showMenu: a locked stage is a disabled row whose tooltip says why.

let reopenStages = null; // the feature whose menu to open again once the page has redrawn after a change

function stagesButton(f) {
  if (!f.profile) return "";
  const btn = el("button", { type: "button", id: "feature-stages", "aria-haspopup": "menu", "aria-expanded": "false",
    title: "Choose which stages this feature's workflow includes" }, "Stages ▾");
  let closedAt = 0;
  const closed = () => { btn.setAttribute("aria-expanded", "false"); closedAt = Date.now(); };
  const change = async s => {
    btn.setAttribute("aria-expanded", "false");
    try { await api("/api/stages", { name: f.name, stage: s.key, on: !s.on }); } catch (e) { alert(e.message || e); return; }
    reopenStages = f.name;
    featureCache.delete(f.name);
    route();
  };
  const open = () => {
    const r = btn.getBoundingClientRect();
    btn.setAttribute("aria-expanded", "true");
    showMenu(Math.max(4, r.right - 260), r.bottom + 4, f.profile.stages.map(s => ({
      label: (s.level === "plan" ? "    " : "") + (s.on ? "☑ " : "☐ ") + s.label,
      ok: !s.locked, why: s.why, title: s.on ? "Leave this stage out" : "Include this stage",
      run: () => change(s) })), "Stages", "Which stages this workflow includes", closed); // split.js
  };
  btn.addEventListener("click", () => { if (Date.now() - closedAt >= 250) open(); });
  if (reopenStages === f.name) { // the page is drawn after this returns: open again once the button is on it
    reopenStages = null;
    const again = n => { if (btn.isConnected) open(); else if (n < 40) setTimeout(() => again(n + 1), 50); };
    setTimeout(() => again(0), 0);
  }
  return btn;
}

// One line in the Start panel: what the session about to start will work through.
function stagesLine(f) {
  if (!f.profile) return "";
  const on = f.profile.stages.filter(s => s.on);
  const left = f.profile.stages.filter(s => !s.on).map(s => s.label);
  return el("div", { class: "small dim", id: "start-stages" },
    `Stages: ${on.length} of ${f.profile.stages.length} included` + (left.length ? ` (left out: ${left.join(", ")})` : "") + ". The Stages button on this page changes them.");
}

// The tracker's steps without the ones the feature's stages leave out (only Explore and Review can be,
// on the routes that have them; Plan going is the lite route itself). `at` keeps pointing at the same step.
function withProfile(f, p) {
  const names = { explore: "Explore", review: "Review" };
  const off = new Set((f.profile?.stages || []).filter(s => !s.on && names[s.key]).map(s => names[s.key]));
  if (!off.size) return p;
  const keep = p.steps.map(s => !off.has(s));
  let at = 0;
  for (let i = 0; i < p.at; i++) if (keep[i]) at++;
  return { ...p, steps: p.steps.filter((_, i) => keep[i]), at };
}
