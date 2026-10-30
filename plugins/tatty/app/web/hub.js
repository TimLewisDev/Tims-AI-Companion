// The Hub: the page Tatty opens on, where a project is picked. A project is its own
// root folder (features, design, tasks, archive) and, optionally, a default code
// repo its sessions start in. Opening one makes its folder Tatty's root.
// Uses app.js's $, el, api, token, companion, tell, host, pageOpened and hubPending, features.js's pageEls, ago,
// copyable, pickFolder, openSidePanel and featureCache, and modes.js's currentMode. See server.py's "the Hub".
"use strict";

let hubDraw = 0;

// Where the window goes once a project is open: the mode's home page, or the landing page.
function leaveHub() {
  if (parseRoute().page !== "hub") return;
  if (location.hash === "#mode") route(); else location.hash = "#mode";
}

// The server's word on whether the Hub is up: at boot (the status), and on its "hub" events.
function setHubPending(on) {
  on = !!on;
  if (on === hubPending) return;
  hubPending = on;
  if (on) showHub(); else leaveHub();
}

function showHub() {
  if (companion) $("#expand").click(); // the Hub is the full panel, not the bubble
  if (location.hash === "#hub") route(); else location.hash = "#hub";
}

document.addEventListener("tt-event", e => {
  if (e.detail.type === "hub" && e.detail.ts * 1000 >= pageOpened - 5000) setHubPending(e.detail.pending);
});
if (host) host.addEventListener("message", m => {
  if (m.data !== "hub") return;
  api("/api/hub", { action: "show" }).catch(() => { /* an older server: the page alone */ showHub(); });
});

async function openProject(id, msg) {
  msg.className = "home-note small dim";
  msg.textContent = "Opening…";
  try {
    const got = await api("/api/hub", { action: "open", id });
    hubPending = false;
    featureCache.clear();
    leaveHub();
  } catch (e) { msg.className = "home-note small st missing"; msg.textContent = String(e.message || e); }
}

function hubProjectCard(p, active, redraw, msg) {
  const lines = [
    el("div", { class: "hub-path" }, "Folder: ", copyable(p.root)),
    p.repo ? el("div", { class: "hub-path" }, "Code: ", copyable(p.repo), p.repoExists ? "" : el("span", { class: "st missing" }, " (missing)")) : "",
    el("div", { class: "dim small" },
      p.features === 1 ? "1 feature" : `${p.features} features`, " · ",
      p.lastOpened ? `opened ${ago(p.lastOpened)}` : "not opened yet"),
  ];
  const edit = el("button", { type: "button", title: "Rename it, or set the code repo its sessions start in", onclick: () => hubEditPanel(p, redraw) }, "Edit…");
  const forget = el("button", { type: "button", title: "Take it off this list. Its folders stay where they are.", disabled: active,
    onclick: async () => {
      if (!confirm(`Forget “${p.name}”? Its folders stay where they are; only this entry goes.`)) return;
      try { await api("/api/hub", { action: "forget", id: p.id }); redraw(); } catch (e) { msg.className = "home-note small st missing"; msg.textContent = String(e.message || e); }
    } }, "Forget");
  return el("div", { class: "fcard hub-card" + (active ? " hub-active" : "") + (p.exists ? "" : " hub-missing"), "data-project": p.id },
    el("div", { class: "fcard-top" }, el("strong", {}, p.name), active ? el("span", { class: "chip now" }, "open") : ""),
    ...lines,
    p.exists ? "" : el("p", { class: "st missing small" }, "This folder is missing. Put it back, or forget the project."),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", disabled: !p.exists, onclick: () => openProject(p.id, msg) }, active ? "Continue" : "Open"),
      edit, forget));
}

function hubEditPanel(p, redraw) {
  openSidePanel(`Edit ${p.name}`, msg => {
    const name = el("input", { value: p.name, "aria-label": "Project name", maxlength: "80" });
    const repo = el("input", { value: p.repo || "", "aria-label": "Code repo", placeholder: "(optional) a git repo for its sessions" });
    return el("form", { class: "hub-form", onsubmit: async e => {
      e.preventDefault();
      try { await api("/api/hub", { action: "update", id: p.id, name: name.value, repo: repo.value.trim() }); closeSidePanel(); redraw(); }
      catch (err) { msg.className = "home-note small st missing"; msg.textContent = String(err.message || err); }
    } },
    el("label", {}, "Name", name),
    el("label", {}, "Code repo", el("div", { class: "row" }, repo,
      el("button", { type: "button", onclick: async () => { const got = await pickFolder("Choose the project's code repo", repo.value); if (got) repo.value = got; } }, "Browse…"))),
    el("button", { type: "submit", class: "primary" }, "Save"));
  });
}

function hubNewForm(data, msg) {
  const name = el("input", { "aria-label": "Project name", maxlength: "80", placeholder: "e.g. Payments app" });
  const root = el("input", { "aria-label": "Project folder", placeholder: `${data.default}/<name>` });
  const repo = el("input", { "aria-label": "Code repo", placeholder: "(optional) a git repo for its sessions" });
  const browse = (input, title) => el("button", { type: "button", onclick: async () => {
    try { const got = await pickFolder(title, input.value); if (got) { input.value = got; if (!name.value && input !== repo) name.value = got.split(/[\\/]/).filter(Boolean).pop() || ""; } } catch (e) { /* no dialog */ }
  } }, "Browse…");
  return el("form", { class: "card hub-new", onsubmit: async e => {
    e.preventDefault();
    if (!name.value.trim() && !root.value.trim()) { msg.className = "home-note small st missing"; msg.textContent = "Give the project a name."; return; }
    try {
      const got = await api("/api/hub", { action: "add", name: name.value.trim(), root: root.value.trim(), repo: repo.value.trim(), create: true, open: true });
      hubPending = false;
      featureCache.clear();
      leaveHub();
    } catch (err) { msg.className = "home-note small st missing"; msg.textContent = String(err.message || err); }
  } },
  el("h3", {}, "New project"),
  el("p", { class: "dim small" }, "A project is a folder of its own where Tatty keeps its features, designs and tasks. Pick a folder that already holds one to add it."),
  el("label", {}, "Name", name),
  el("label", {}, "Folder", el("div", { class: "row" }, root, data.picker ? browse(root, "Choose the project's folder") : "")),
  el("label", {}, "Code repo", el("div", { class: "row" }, repo, data.picker ? browse(repo, "Choose the project's code repo") : "")),
  el("button", { type: "submit", class: "primary" }, "Create and open"));
}

async function renderHub(box) {
  const mine = ++hubDraw;
  const msg = el("p", { class: "home-note small" });
  const redraw = () => renderHub(box);
  let data;
  try { data = await api("/api/hub"); } catch (e) {
    box.replaceChildren(el("p", { class: "st missing pad" }, "The Hub didn't load: " + String(e.message || e) + " (Is the Tatty server older than this page? Restart Tatty.)"));
    return;
  }
  if (mine !== hubDraw) return;
  hubPending = data.pending;
  const list = data.projects.length
    ? el("div", { class: "fgrid hub-grid" }, data.projects.map(p => hubProjectCard(p, p.id === data.active, redraw, msg)))
    : el("div", { class: "card empty-state" }, el("h3", {}, "No projects yet"), el("p", {}, "Make your first one below: Tatty works in a folder per project."));
  box.replaceChildren(
    el("div", { class: "hub" },
      el("div", { class: "home-head" }, el("div", {},
        el("h2", {}, "Which project are you working on?"),
        el("div", { class: "dim small" }, data.locked
          ? "TATTY_ROOT fixes Tatty's root folder in this environment, so opening a project here won't change it."
          : "Each project has its own folder of features, designs and tasks."))),
      list, hubNewForm(data, msg), msg));
}
