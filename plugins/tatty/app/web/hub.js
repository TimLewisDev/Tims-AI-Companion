// The Hub: the page Tatty opens on, where a project is picked. A project is its own
// root folder (features, design, tasks, archive) and, optionally, a default code
// repo its sessions start in. Opening one opens a window of its own for it (or brings
// that one forward) and the Hub, the window this page is in at launch, stays: it is the
// launcher, so several projects can be opened one after another. Which are open is watched
// (hubWatch), since their windows are opened and closed on their own. Each project is
// numbered in the order it was added, and its Tatty wears that number.
// Uses app.js's $, el, api, token, companion, tell, host, pageOpened and hubPending, features.js's pageEls, ago,
// copyable, pickFolder, openSidePanel and featureCache, and modes.js's currentMode. See server.py's "the Hub".
"use strict";

let hubDraw = 0;
let hubLlmRefresh = null;
let hubCatalogRefreshTimer = 0;
let hubCatalogRefreshPending = false;
let hubCatalogRefreshRunning = false;

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

// What to do once the server has answered an open: this window is the project's own (or the
// server has no windows to open: TATTY_ROOT fixes the root), so it carries on into the project;
// otherwise the project is in a window of its own now and this window is left as it is (the
// Hub as the launcher, or another project's window): the cards are drawn again, with the news.
function openedProject(data, p, redraw) {
  if (data.locked || data.self === p.id) {
    hubPending = false;
    featureCache.clear();
    homeData = null; homeJson = ""; // (features.js: the list of the project left)
    leaveHub();
    return;
  }
  redraw(`${p.name} is open in its own window.`);
}

async function openProject(p, data, msg, redraw) {
  msg.className = "home-note small dim";
  msg.textContent = "Opening…";
  try {
    await api("/api/hub", { action: "open", id: p.id });
    openedProject(data, p, redraw);
  } catch (e) { msg.className = "home-note small st missing"; msg.textContent = String(e.message || e); }
}

function hubProjectCard(p, data, redraw, msg) {
  // TATTY_ROOT fixes the root and opens no windows: the one it names is "this window" (it is the only one)
  const here = data.self === p.id || (data.locked && p.id === data.active);
  const active = p.open || here; // it has a window
  const lines = [
    el("div", { class: "hub-path" }, "Folder: ", copyable(p.root)),
    p.repo ? el("div", { class: "hub-path" }, "Code: ", copyable(p.repo), p.repoExists ? "" : el("span", { class: "st missing" }, " (missing)")) : "",
    el("div", { class: "dim small" },
      p.features === 1 ? "1 feature" : `${p.features} features`, p.key ? ` · new ones are ${p.key}-…` : "", " · ",
      p.lastOpened ? `opened ${ago(p.lastOpened)}` : "not opened yet"),
  ];
  const edit = el("button", { type: "button", title: "Rename it, or set the code repo its sessions start in", onclick: () => hubEditPanel(p, redraw) }, "Edit…");
  const forget = el("button", { type: "button", title: "Take it off this list. Its folders stay where they are.", disabled: active,
    onclick: async () => {
      if (!confirm(`Forget “${p.name}”? Its folders stay where they are; only this entry goes.`)) return;
      try { await api("/api/hub", { action: "forget", id: p.id }); redraw(); } catch (e) { msg.className = "home-note small st missing"; msg.textContent = String(e.message || e); }
    } }, "Forget");
  return el("div", { class: "fcard hub-card" + (active ? " hub-active" : "") + (p.exists ? "" : " hub-missing"), "data-project": p.id },
    el("div", { class: "fcard-top" }, el("span", { class: "hub-number", title: "Its Tatty wears this number" }, String(p.number)), el("strong", {}, p.name), active ? el("span", { class: "chip now" }, here ? "this window" : "open") : ""),
    ...lines,
    p.exists ? "" : el("p", { class: "st missing small" }, "This folder is missing. Put it back, or forget the project."),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", disabled: !p.exists, onclick: () => openProject(p, data, msg, redraw) }, here ? "Continue" : active ? "Show window" : "Open"),
      edit, forget));
}

function hubEditPanel(p, redraw) {
  openSidePanel(`Edit ${p.name}`, msg => {
    const name = el("input", { value: p.name, "aria-label": "Project name", maxlength: "80" });
    const repo = el("input", { value: p.repo || "", "aria-label": "Code repo", placeholder: "(optional) a git repo for its sessions" });
    const key = shortNameInput(p.key || "");
    return el("form", { class: "hub-form", onsubmit: async e => {
      e.preventDefault();
      try { await api("/api/hub", { action: "update", id: p.id, name: name.value, repo: repo.value.trim(), key: key.value.trim() }); closeSidePanel(); redraw(); }
      catch (err) { msg.className = "home-note small st missing"; msg.textContent = String(err.message || err); }
    } },
    el("label", {}, "Name", name),
    el("label", {}, "Short name", key, el("span", { class: "dim small" }, `Its new features are numbered ${key.value || "TAT"}-0001, …`)),
    el("label", {}, "Code repo", el("div", { class: "row" }, repo,
      el("button", { type: "button", onclick: async () => { const got = await pickFolder("Choose the project's code repo", repo.value); if (got) repo.value = got; } }, "Browse…"))),
    el("button", { type: "submit", class: "primary" }, "Save"));
  });
}

// A project's short name (TAT, STAR): what its new features are numbered under. Capitals and digits.
function shortNameInput(value) {
  const key = el("input", { value, "aria-label": "Short name", maxlength: "10", class: "tprefix", placeholder: "e.g. TAT" });
  key.addEventListener("input", () => { key.value = key.value.toUpperCase(); });
  return key;
}

function hubNewForm(data, msg, redraw) {
  const name = el("input", { "aria-label": "Project name", maxlength: "80", placeholder: "e.g. Payments app" });
  const key = shortNameInput("");
  name.addEventListener("input", () => { key.placeholder = (name.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().replace(/^[0-9]+/, "").slice(0, 3)) || "e.g. TAT"; });
  const root = el("input", { "aria-label": "Project folder", placeholder: `${data.default}/<name>` });
  const repo = el("input", { "aria-label": "Code repo", placeholder: "(optional) a git repo for its sessions" });
  const browse = (input, title) => el("button", { type: "button", onclick: async () => {
    try { const got = await pickFolder(title, input.value); if (got) { input.value = got; if (!name.value && input !== repo) name.value = got.split(/[\\/]/).filter(Boolean).pop() || ""; } } catch (e) { /* no dialog */ }
  } }, "Browse…");
  return el("form", { class: "card hub-new", onsubmit: async e => {
    e.preventDefault();
    if (!name.value.trim() && !root.value.trim()) { msg.className = "home-note small st missing"; msg.textContent = "Give the project a name."; return; }
    try {
      const got = await api("/api/hub", { action: "add", name: name.value.trim(), root: root.value.trim(), repo: repo.value.trim(), key: key.value.trim(), create: true, open: true });
      openedProject(data, got.project, redraw);
    } catch (err) { msg.className = "home-note small st missing"; msg.textContent = String(err.message || err); }
  } },
  el("h3", {}, "New project"),
  el("p", { class: "dim small" }, "A project is a folder of its own where Tatty keeps its features, designs and tasks. Pick a folder that already holds one to add it."),
  el("label", {}, "Name", name),
  el("label", {}, "Short name (its new features are numbered with it, e.g. TAT-0001)", key),
  el("label", {}, "Folder", el("div", { class: "row" }, root, data.picker ? browse(root, "Choose the project's folder") : "")),
  el("label", {}, "Code repo", el("div", { class: "row" }, repo, data.picker ? browse(repo, "Choose the project's code repo") : "")),
  el("button", { type: "submit", class: "primary" }, "Create and open"));
}

// The "Connect an LLM" card. Tatty needs no LLM to run; the agentic features do.
async function hubLlmCard(msg, firstRun) {
  const card = el("div", { class: "card hub-llm", id: "hub-llm" });
  let timer = 0;
  const say = (text, bad) => { msg.className = "home-note small" + (bad ? " st missing" : " dim"); msg.textContent = text; };
  const actionInfo = {
    install: { label: "Install", path: "/api/llm-setup", action: "install", title: "Install it with winget" },
    "sign-in": { label: "Sign in", path: "/api/llm-setup", action: "signin", title: "Opens a terminal window running the tool's own sign-in" },
    connect: { label: "Connect", path: "/api/llms", action: "connect", title: "Let Tatty use it" },
    disconnect: { label: "Disconnect", path: "/api/llms", action: "disconnect" },
    refresh: { label: "Refresh", path: "/api/llms", action: "refresh" }
  };
  const readInventory = async () => {
    const [inventory, setup] = await Promise.all([
      loadModels(true),
      api("/api/llm-setup", { action: "check" })
    ]);
    return { inventory, setup };
  };
  const act = async (action, provider, busy) => {
    const operation = actionInfo[action];
    if (!operation) return;
    say(busy || "Working…");
    try {
      const result = await api(operation.path, { action: operation.action, provider });
      const { inventory, setup } = await readInventory();
      say(result.said || inventory.said || "");
      draw(inventory, setup);
    } catch (e) { say(String(e.message || e), true); }
  };
  const row = (provider, setupTools) => {
    const setup = setupTools.get(provider.provider);
    const job = setup && setup.job;
    const running = job && job.status === "running";
    const state = provider.state === "connected" ? el("span", { class: "chip now" }, "connected")
      : provider.state === "missing" ? el("span", { class: "st missing small" }, "unavailable · connected account, local CLI missing")
      : setup && setup.installed ? el("span", { class: "dim small" },
        setup.signedIn === false ? "installed · not signed in" : setup.signedIn === true ? "installed · signed in" : "installed")
      : el("span", { class: "dim small" }, provider.state === "available" ? "installed · not connected" : provider.state || "unknown");
    const buttons = (provider.actions || []).filter(action => actionInfo[action]).map(action => {
      const operation = actionInfo[action];
      const primary = action === "install" || (action === "sign-in" && setup && setup.signedIn === false)
        || (action === "connect" && setup && setup.signedIn === true);
      if (action === "install" && running) {
        return el("button", { type: "button", disabled: true, id: `llm-install-${provider.provider}` }, "Installing…");
      }
      return el("button", { type: "button", class: primary ? "primary" : "",
        id: `llm-${operation.action}-${provider.provider}`, title: operation.title || "",
        onclick: () => act(action, provider.provider, operation.label + "…") }, operation.label);
    });
    return el("div", { class: "hub-llm-row", "data-llm": provider.provider },
      el("strong", {}, (setup && setup.label) || provider.provider), state, el("div", { class: "actions" }, ...buttons),
      job && job.status === "error" ? el("div", { class: "st missing small hub-llm-note" }, job.message) : "");
  };
  function draw(d, setup) {
    clearTimeout(timer);
    const tools = new Map((setup && setup.tools || []).map(t => [t.provider, t]));
    const running = [...tools.values()].some(t => t.job && t.job.status === "running");
    if (running && card.isConnected) timer = setTimeout(async () => {
      try {
        const got = await readInventory();
        draw(got.inventory, got.setup);
      } catch (e) { say(String(e.message || e), true); }
    }, 3000);
    const messages = [
      setup && setup.toolbox === false
        ? el("p", { class: "st missing small" }, "The Tatty toolbox isn't installed, so connecting is unavailable. Run the installer's Repair.")
        : "",
      d.compatible === false && (!setup || setup.toolbox !== false)
        ? el("p", { class: "st missing small" }, d.error || "This toolbox is too old to connect LLMs. Update the core plugin.")
        : d.compatible !== false && (!d.catalog || !d.catalog.usable)
          ? el("p", { class: "st missing small" }, d.error || "The model catalog is unavailable. Refresh a provider and try again.")
          : d.compatible !== false && Array.isArray(d.models) && !d.models.length
            ? el("p", { class: "dim small" }, "The model catalog is empty. Connect a provider and refresh it.")
            : "",
      setup && !setup.winget ? el("p", { class: "dim small" }, "winget isn't available here: install a tool yourself.") : ""
    ];
    card.replaceChildren(
      el("h3", {}, firstRun ? "Step 1: connect an LLM (optional for now)" : "LLMs"),
      el("p", { class: "dim small" }, "Tatty runs without one. Agentic features (writing designs, running tasks, headless runs) use an LLM tool signed in on this machine. Install one, sign in, then connect it."),
      ...messages,
      el("div", { class: "hub-llm-list" }, (d.providers || []).map(provider => row(provider, tools))));
  }
  hubLlmRefresh = async () => {
    if (!card.isConnected || !pageEls.hub.classList.contains("on")) return;
    if (card.contains(document.activeElement)) { hubCatalogRefreshPending = true; return; }
    try {
      const { inventory, setup } = await readInventory();
      if (card.isConnected && !card.contains(document.activeElement)) draw(inventory, setup);
      else hubCatalogRefreshPending = true;
    } catch (e) { say(String(e.message || e), true); }
  };
  try {
    const { inventory, setup } = await readInventory();
    draw(inventory, setup);
  } catch (e) {
    card.replaceChildren(el("p", { class: "st missing small" }, "LLM setup didn't load: " + String(e.message || e)));
  }
  return card;
}

function queueHubCatalogRefresh() {
  if (!pageEls.hub.classList.contains("on")) return;
  hubCatalogRefreshPending = true;
  clearTimeout(hubCatalogRefreshTimer);
  hubCatalogRefreshTimer = setTimeout(async () => {
    if (!hubCatalogRefreshPending || hubCatalogRefreshRunning || !hubLlmRefresh) return;
    if (document.activeElement && document.activeElement.closest("#hub-llm")) return;
    hubCatalogRefreshPending = false;
    hubCatalogRefreshRunning = true;
    try { await hubLlmRefresh(); }
    finally {
      hubCatalogRefreshRunning = false;
      if (hubCatalogRefreshPending && (!document.activeElement || !document.activeElement.closest("#hub-llm"))) queueHubCatalogRefresh();
    }
  }, 120);
}

document.addEventListener("tt-models-changed", queueHubCatalogRefresh);
document.addEventListener("focusout", () => {
  if (hubCatalogRefreshPending) queueHubCatalogRefresh();
});

// The projects' windows are opened and closed on their own, so while the Hub is on show it looks which are
// open every few seconds, and draws the cards again only if that changed (and not while the person is in the
// middle of something: a side panel, or the New project form with something typed in it).
let hubSeen = "";
const hubSig = d => JSON.stringify(d.projects.map(p => [p.id, p.open, p.name, p.number, p.exists]));
async function hubWatch() {
  if (document.hidden || !pageEls.hub.classList.contains("on") || sidePanelNodes.length) return;
  if ([...pageEls.hub.querySelectorAll(".hub-new input")].some(i => i.value)) return;
  let data;
  try { data = await api("/api/hub"); } catch { return; }
  if (pageEls.hub.classList.contains("on") && hubSig(data) !== hubSeen) renderHub(pageEls.hub);
}
setInterval(hubWatch, 5000);

// note: a line to show under the cards once they are drawn (what has just happened)
async function renderHub(box, note = "") {
  const mine = ++hubDraw;
  const msg = el("p", { class: "home-note small" });
  const redraw = said => renderHub(box, typeof said === "string" ? said : "");
  let data;
  try { data = await api("/api/hub"); } catch (e) {
    box.replaceChildren(el("p", { class: "st missing pad" }, "The Hub didn't load: " + String(e.message || e) + " (Is the Tatty server older than this page? Restart Tatty.)"));
    return;
  }
  if (mine !== hubDraw) return;
  hubSeen = hubSig(data);
  if (note) { msg.className = "home-note small dim"; msg.textContent = note; }
  hubPending = data.pending;
  const first = !data.projects.length;
  const llm = await hubLlmCard(msg, first);
  if (mine !== hubDraw) return;
  const list = data.projects.length
    ? el("div", { class: "fgrid hub-grid" }, data.projects.map(p => hubProjectCard(p, data, redraw, msg)))
    : el("div", { class: "card empty-state" }, el("h3", {}, "Welcome to Tatty"), el("p", {}, "Tatty works in a folder per project. Make your first one below" + " (you can connect an LLM first or later)."));
  box.replaceChildren(
    el("div", { class: "hub" },
      el("div", { class: "home-head" }, el("div", {},
        el("h2", {}, first ? "Get started" : "Which project are you working on?"),
        el("div", { class: "dim small" }, data.locked
          ? "TATTY_ROOT fixes Tatty's root folder in this environment, so opening a project here won't change it."
          : "Each project has its own folder of features, designs and tasks."))),
      first ? el("div", {}, list, llm, hubNewForm(data, msg, redraw)) : el("div", {}, list, hubNewForm(data, msg, redraw), llm),
      msg));
}
