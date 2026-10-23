// Tatty's pages: Features (the features in Tatty's root folder), one feature
// (where it stands in the workflow, its documents on the left, each readable in
// place) and the Toolbox (app.js's Status / Connections / Docs tabs).
// Uses app.js's $, el, api, markdown, cmdCell, say, loaded and loadStatus.
"use strict";

const pageEls = { modes: $("#page-modes"), mode: $("#page-mode"), home: $("#page-home"),
  feature: $("#page-feature"), toolbox: $("#page-toolbox") };
// A page of one mode's own: going to it switches to that mode, so a link never
// shows a mode's pages in another mode's colours. The rest belong to every mode.
const PAGE_MODE = { home: "engineering", feature: "engineering" };
const featureCache = new Map(); // name -> the last /api/feature answer
let homeTimer = null;

// ------------------------------------------------------------- words

const PHASES = {
  exploring: "Exploring", explored: "Explored", planning: "Planning", "signed-off": "Plan signed off",
  "breakdown-draft": "Breaking down", "breakdown-written": "Ready to build", building: "Building",
  complete: "Complete", "breakdown-orphan": "Breakdown only", empty: "Not started",
  "lite-focus": "Exploring", "lite-brief": "Brief written", debugging: "Debugging",
  "debug-done": "Root cause found", debugged: "Written up",
};
const ROUTES = { full: "Feature", lite: "Small change", bug: "Bug", new: "New" };
const EVENTS = {
  "explore.focus_confirmed": "Exploration focus confirmed", "explore.documented": "Familiarisation written",
  "plan.familiarisation_closed": "Familiarisation stage closed", "plan.requirements_closed": "Requirements closed",
  "plan.scope_closed": "Scope & Constraints closed", "plan.approach_closed": "Approach closed",
  "plan.design_closed": "Technical Design closed", "plan.whole_closed": "Whole-plan challenge closed",
  "plan.signed_off": "Plan signed off", "breakdown.written": "Task Breakdown written",
  "lite.brief_written": "Lite Brief written", "build.unit_validated": "validated",
  "build.complete": "Build complete", "debug.root_cause_confirmed": "Root cause confirmed",
  "debug.report_written": "Debug Report written",
};

function ago(seconds) {
  const d = Date.now() / 1000 - seconds;
  if (d < 90) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 14) return `${Math.round(d / 86400)} days ago`;
  return new Date(seconds * 1000).toLocaleDateString();
}

const chip = (text, cls) => el("span", { class: "chip " + (cls || "") }, text);
const statusClass = s => {
  s = (s || "").toLowerCase();
  if (/done|closed|complete|validated/.test(s)) return "done";
  if (/progress|ready|pending|implemented|reopened/.test(s)) return "now";
  if (/blocked|failed/.test(s)) return "bad";
  if (/skipped|dropped/.test(s)) return "skip";
  return "todo";
};
// (Width set through the DOM: the page's CSP refuses inline style attributes.)
function bar(done, total, label) {
  if (!total) return "";
  const fill = el("span");
  fill.style.width = `${Math.round(100 * done / total)}%`;
  return el("div", { class: "bar", title: label || `${done} of ${total}` }, fill, el("em", {}, label || `${done} of ${total}`));
}

function copyable(text) {
  return el("span", { class: "copyable" }, el("code", {}, text),
    el("button", { type: "button", title: "Copy", onclick: e => { e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(text); } }, "Copy"));
}

// ------------------------------------------------------------- routing
// #modes · #mode · #home · #feature/<name> · #feature/<name>/doc/<file> · #toolbox

function parseRoute() {
  const parts = location.hash.replace(/^#/, "").split("/").map(p => { try { return decodeURIComponent(p); } catch { return p; } });
  if (parts[0] === "feature" && parts[1]) {
    const doc = parts[2] === "doc" ? parts[3] : null;
    return { page: "feature", name: parts[1], doc, at: doc && parts[4] === "at" ? parts[5] : null };
  }
  if (parts[0] === "toolbox") return { page: "toolbox" };
  if (parts[0] === "modes") return { page: "modes" };
  if (parts[0] === "home") return { page: "home" };
  // #mode, and nothing asked for: the mode's home page, or the landing page
  // when there is no mode yet to show one of.
  return { page: currentMode ? "mode" : "modes" };
}
// #feature/<name>[/doc/<file>[/at/<heading, or ^block>]], each part encoded
const featureHref = (name, doc, at) => "#feature/" + encodeURIComponent(name) +
  (doc ? "/doc/" + encodeURIComponent(doc) + (at ? "/at/" + encodeURIComponent(at) : "") : "");

function showPage(which) {
  for (const [k, n] of Object.entries(pageEls)) n.classList.toggle("on", k === which);
  for (const a of document.querySelectorAll(".pnav a")) a.classList.toggle("on", a.dataset.page === (which === "feature" ? "home" : which));
  renderNav();
  clearInterval(homeTimer);
}

async function route() {
  if (companion && !document.body.classList.contains("expanded")) return; // the bubble shows the feed only
  const r = parseRoute();
  // A page of one mode's own is shown in that mode (modes.js).
  const owner = PAGE_MODE[r.page];
  if (owner && owner !== currentMode && installedModes.includes(owner)) applyMode(owner);
  // With one mode installed there is nothing to pick: straight to its home page.
  if (r.page === "modes" && installedModes.length === 1) { location.replace("#mode"); return; }
  showPage(r.page);
  if (r.page === "modes") renderLanding(pageEls.modes);
  else if (r.page === "mode") renderModeHome(pageEls.mode);
  else if (r.page === "home") {
    await renderHome();
    homeTimer = setInterval(() => { if (!document.hidden) renderHome(true); }, 30000);
  } else if (r.page === "feature") await renderFeature(r.name, r.doc, r.at);
  else if (!loaded.has("status")) { loaded.add("status"); loadStatus(); }
}

// The top bar's radio (modes.js): the mode changes, and a page of another
// mode's own -- or the landing page, where picking a mode means going into it --
// gives way to the new mode's home page.
function switchMode(id) {
  if (id === currentMode) return;
  applyMode(id);
  const r = parseRoute();
  const owner = PAGE_MODE[r.page];
  if (r.page === "modes" || (owner && owner !== id)) {
    if (location.hash === "#mode") route(); else location.hash = "#mode";
    return;
  }
  route();
}

window.addEventListener("hashchange", route);
document.addEventListener("tt-expanded", route);
$("#chat-toggle").addEventListener("click", () => document.body.classList.toggle("nochat"));

// A document link ([[Doc#Heading]], [[Doc#^block]], [[#Heading]], Doc.md#part)
// opens the document in place, at that heading or block. The document is found
// as Obsidian finds it: by name, in this feature, else in another feature under
// Tatty's root (the server looks). Outside a feature page a link does nothing.
document.addEventListener("click", async e => {
  const a = e.target.closest("a.doclink");
  if (!a) return;
  e.preventDefault();
  const r = parseRoute();
  const f = r.page === "feature" && featureCache.get(r.name);
  if (!f) return;
  const want = a.dataset.doc || "", at = a.dataset.at || "";
  let name = f.name, file = null;
  if (!want) file = r.doc; // [[#Heading]]: this document
  else {
    const hit = [...f.docList, ...f.notes].find(d => d.file.replace(/\.md$/i, "").split("/").pop().toLowerCase() === want.toLowerCase());
    if (hit) file = hit.file;
    else {
      try { const got = await api(`/api/resolve?name=${encodeURIComponent(f.name)}&target=${encodeURIComponent(want)}`); name = got.name; file = got.file; } catch { /* missing */ }
    }
  }
  if (!file) { a.classList.add("missing"); a.title = `No document called “${want}” under Tatty's root`; return; }
  location.hash = featureHref(name, file, at);
});

// The heading or block a link points at, inside a rendered document.
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function findTarget(main, at) {
  if (!at) return null;
  if (at.startsWith("^")) return main.querySelector(`[data-block="${CSS.escape(at.slice(1))}"]`);
  const want = norm(at.split("#").pop());
  const heads = [...main.querySelectorAll(".md h1, .md h2, .md h3, .md h4, .md h5, .md h6")];
  return heads.find(h => norm(h.textContent) === want) || heads.find(h => norm(h.textContent).startsWith(want)) || null;
}

function goToTarget(main, at) {
  const hit = findTarget(main, at);
  const head = main.querySelector(".doc-head");
  const miss = head && head.querySelector(".at-missing");
  if (miss) miss.remove();
  if (!at) { main.scrollTop = 0; return; }
  if (!hit) {
    if (head) head.append(el("span", { class: "at-missing small st missing" }, `“${at}” isn't in this document; showing it from the top.`));
    main.scrollTop = 0;
    return;
  }
  // a ticket or unit that is folded up (views.js's <details>) opens to show it
  for (let d = hit.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true;
  hit.scrollIntoView({ block: "start" });
  for (const n of main.querySelectorAll(".target-flash")) n.classList.remove("target-flash");
  void hit.offsetWidth; // restart the highlight
  hit.classList.add("target-flash");
  hit.addEventListener("animationend", () => hit.classList.remove("target-flash"), { once: true });
}

// ------------------------------------------------------------- home

async function renderHome(quiet) {
  const box = pageEls.home;
  if (!quiet) box.replaceChildren(el("p", { class: "dim pad" }, "Looking for features…"));
  let data;
  try { data = await api("/api/features"); } catch (e) { box.replaceChildren(el("p", { class: "st missing pad" }, String(e))); return; }
  const r = data.root;
  if (!r.isSet || !r.exists) { box.replaceChildren(rootSetup(r)); return; }
  // Tatty only reads the workflow: without the TT toolbox there's nothing to show of it.
  const missing = data.toolbox ? "" : el("div", { class: "card toolbox-missing" },
    el("strong", {}, "Tatty can't find the TT toolbox. "),
    "Tatty shows the toolbox's workflow, so install the toolbox (its core and engineering plugins) and Tatty will show where each feature stands. ",
    el("span", { class: "dim" }, "For development, set TATTY_TOOLBOX to a Tims-AI-Toolbox checkout."));
  const head = el("div", { class: "home-head" },
    el("div", {}, el("h2", {}, "Features"),
      el("div", { class: "dim small root-line" }, "Root: ", copyable(r.root),
        el("button", { type: "button", class: "primary", title: "Choose another root folder in Explorer", onclick: () => pickRoot(r) }, "Change…"))),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "primary", onclick: () => newFeatureForm.toggle() }, "New feature…"),
      el("button", { type: "button", onclick: () => renderHome() }, "Refresh")),
    homeNote);
  const form = newFeatureForm.node();
  if (!data.features.length) {
    box.replaceChildren(missing, head, form, el("div", { class: "card empty-state" },
      el("p", {}, "No features yet. ", el("strong", {}, "New feature…"), " makes one here and starts it with the workflow."),
      el("p", { class: "dim small" }, "Or make a folder in the features folder yourself.")));
    return;
  }
  box.replaceChildren(missing, head, form, el("div", { class: "fgrid" }, data.features.map(featureCard)));
}

function featureCard(f) {
  const building = f.tasks.total > 0 && f.phase !== "complete";
  return el("a", { class: "fcard route-" + f.route, href: featureHref(f.name) },
    el("div", { class: "fcard-top" }, el("strong", {}, f.name), chip(ROUTES[f.route] || f.route, "route")),
    f.live ? el("div", {}, chip(`● Live: ${f.live.name}`, "live")) : "",
    el("div", {}, chip(PHASES[f.phase] || f.phase || "—", f.phase === "complete" ? "done" : f.phase === "empty" ? "todo" : "now"),
      f.stage && f.phase !== "complete" ? el("span", { class: "dim small" }, " · " + f.stage) : ""),
    el("p", { class: "ftext" }, f.text || ""),
    building ? bar(f.tasks.done, f.tasks.total, `${f.units.done} of ${f.units.total} units · ${f.tasks.done} of ${f.tasks.total} tasks`) : "",
    el("div", { class: "fcard-foot dim small" }, `${f.docs} document${f.docs === 1 ? "" : "s"} · updated ${ago(f.updated)}`),
    f.next ? el("div", { class: "fnext" }, copyable(f.next)) : "");
}

// ------------------------------------------------------------- a new feature
// New feature… makes <root>/features/<name>, then opens it with the Start panel
// on "let tt-workflow carry on": the workflow links the folder and starts the
// feature itself. Tatty asks nothing of the workflow but its usual command.

let openStartFor = null; // a feature just made: open its Start panel
const newFeatureForm = (() => {
  let shown = false, node = null;
  const draw = () => {
    const input = el("input", { placeholder: "a name for the feature, e.g. Settings page", "aria-label": "Feature name" });
    const msg = el("span", { class: "small st missing" });
    node = el("form", { class: "card new-feature", onsubmit: async e => {
      e.preventDefault();
      try {
        const r = await api("/api/new-feature", { name: input.value });
        shown = false;
        openStartFor = r.name;
        featureCache.delete(r.name);
        location.hash = featureHref(r.name);
      } catch (err) { msg.textContent = String(err.message || err); }
    } },
      el("strong", {}, "New feature"),
      el("div", { class: "row" }, input, el("button", { type: "submit", class: "primary" }, "Create"),
        el("button", { type: "button", onclick: () => { shown = false; node.remove(); } }, "Cancel")),
      el("p", { class: "dim small" }, "Makes a folder for it in Tatty's features folder, then starts it with tt-workflow in a new session."),
      msg);
    setTimeout(() => input.focus(), 0);
    return node;
  };
  return {
    node: () => (shown ? draw() : ""),
    toggle() { shown = !shown; if (shown) { const head = document.querySelector("#page-home .home-head"); if (head) head.after(draw()); } else if (node) node.remove(); },
  };
})();

// ------------------------------------------------------------- the root folder
// Chosen in Windows' own folder dialog: the companion opens it itself (and
// answers "picked:<folder>"); in a browser the server opens it. Typing a path is
// only offered where there is no dialog (not Windows).

const homeNote = el("p", { class: "home-note small" });
const note = (text, bad) => { homeNote.textContent = text; homeNote.className = "home-note small " + (bad ? "st missing" : "ok"); };

async function useRoot(path) {
  try {
    const r = await api("/api/root", { path, create: true });
    note(`Tatty's root is now ${r.root}. Features live in ${r.features}.`);
    if (parseRoute().page !== "home") location.hash = "#home";
    else renderHome();
  } catch (e) { note(String(e.message || e), true); renderHome(true); }
}

// pickFolder: Windows' folder dialog, from the companion or the server; resolves
// the chosen folder, or null when cancelled (or there is no dialog).
let pendingPick = null;
async function pickFolder(title, start) {
  if (host) return new Promise(resolve => { pendingPick = resolve; tell("pick-folder", JSON.stringify({ title, start: start || "" })); });
  const got = await api("/api/pick-folder", { title, start: start || "" });
  return got.path || null;
}

async function pickRoot(r) {
  note("Choose a folder in the dialog…");
  try {
    const path = await pickFolder("Choose Tatty's root folder", r && r.isSet ? r.root : "");
    if (path) useRoot(path); else note("No folder chosen; the root is unchanged.");
  } catch (e) { note(String(e.message || e), true); }
}

if (host) host.addEventListener("message", m => {
  if (typeof m.data !== "string" || !m.data.startsWith("picked:")) return;
  const path = m.data.slice(7) || null;
  if (pendingPick) { const p = pendingPick; pendingPick = null; p(path); }
  else if (path) useRoot(path); // the tray's "Change root folder…"
});

function rootSetup(r) {
  const msg = homeNote;
  const typed = r.picker ? "" : (() => {
    const input = el("input", { value: r.default, "aria-label": "Root folder" });
    return el("form", { class: "row", onsubmit: e => { e.preventDefault(); useRoot(input.value.trim()); } },
      input, el("button", { type: "submit" }, "Use this folder"));
  })();
  return el("div", { class: "card root-setup" },
    el("h2", {}, "Where should Tatty work?"),
    el("p", {}, "Tatty keeps the features you work on in a root folder of your own, one folder per feature under ",
      el("code", {}, "features"), ". It's never inside the Claude folder."),
    el("div", { class: "root-choices" },
      el("button", { type: "button", class: "primary", onclick: () => useRoot(r.default) }, `Create ${r.default}`),
      r.picker ? el("button", { type: "button", onclick: () => pickRoot(r) }, "Choose a folder…") : ""),
    typed,
    el("p", { class: "dim small" }, "A ", el("code", {}, "features"), " folder is made inside it if there isn't one."),
    msg);
}

// ------------------------------------------------------------- one feature

let shown = null; // the document on screen: { name, file, main }

async function renderFeature(name, doc, at) {
  const box = pageEls.feature;
  // The same document, another part of it ([[#Heading]], or Back): just scroll.
  const same = doc && shown && shown.name === name && shown.file === doc && shown.main.isConnected;
  if (same) { if (docMode.get() === "view") goToTarget(shown.main, at); return; }
  if (shown && editing && editing.dirty() && !confirm("Discard your unsaved changes?")) {
    location.hash = featureHref(shown.name, shown.file); // stay where the edit is
    return;
  }
  shown = null;
  let f = featureCache.get(name);
  if (!f || !doc) {
    if (!f) box.replaceChildren(el("p", { class: "dim pad" }, "Reading the feature…"));
    try { f = await api("/api/feature?name=" + encodeURIComponent(name)); featureCache.set(name, f); } catch (e) {
      box.replaceChildren(el("p", { class: "st missing pad" }, `Can't read ${name}: ${e.message || e}`), el("p", { class: "pad" }, el("a", { href: "#home" }, "Back to features")));
      return;
    }
  }
  const main = el("div", { class: "fmain" });
  box.replaceChildren(el("div", { class: "fpage" }, featureNav(f, doc), main));
  if (doc) {
    if (await showDoc(f, doc, main, at)) { shown = { name, file: doc, main }; goToTarget(main, at); }
  } else main.append(overview(f));
}

function featureNav(f, current) {
  const item = (label, href, on, sub) => el("a", { class: "fnav-item" + (on ? " on" : ""), href }, el("span", {}, label), sub ? el("span", { class: "dim small" }, sub) : "");
  const docs = f.docList.map(d => item(d.doc, featureHref(f.name, d.file), current === d.file, (f.docList.some(o => o.prefix !== d.prefix) ? d.prefix + " · " : "") + ago(d.updated)));
  const groups = new Map();
  for (const n of f.notes) { if (!groups.has(n.group)) groups.set(n.group, []); groups.get(n.group).push(n); }
  const notesOpen = f.notes.some(n => n.file === current);
  return el("nav", { class: "fnav" },
    el("a", { class: "fnav-back small", href: "#home" }, "← Features"),
    el("h3", {}, f.name),
    item("Overview", featureHref(f.name), !current),
    el("div", { class: "fnav-head" }, "Documents"),
    docs.length ? docs : el("p", { class: "dim small" }, "None yet."),
    f.notes.length ? el("details", { class: "fnav-notes", open: notesOpen },
      el("summary", {}, `Working notes (${f.notes.length})`),
      [...groups].map(([g, ns]) => el("div", {}, el("div", { class: "dim small" }, g),
        ns.map(n => item(n.name, featureHref(f.name, n.file), current === n.file))))) : "");
}

// The steps of the feature's route, and which one it is on.
function pipeline(f) {
  const p = f.phase;
  if (f.route === "lite") {
    const at = { "lite-focus": 0, "lite-brief": 2, building: 2, complete: 3 }[p] ?? 0;
    return { steps: ["Explore", "Lite Brief", "Build", "Done"], at, done: p === "complete" };
  }
  if (f.route === "bug") {
    const kinds = new Set(f.docList.map(d => d.doc));
    const at = p === "debugging" ? 0 : p === "debug-done" ? 1 : p === "complete" ? 3 : kinds.has("Lite Brief") ? 2 : p === "debugged" ? 2 : 1;
    return { steps: ["Debug", "Write-up", "Fix", "Done"], at, done: p === "complete" };
  }
  const at = { empty: 0, exploring: 0, explored: 1, planning: 1, "signed-off": 2, "breakdown-draft": 2, "breakdown-orphan": 2,
    "breakdown-written": 3, building: 3, complete: 4 }[p] ?? 0;
  return { steps: ["Explore", "Plan", "Breakdown", "Build", "Done"], at, done: p === "complete" };
}

function tracker(f) {
  const { steps, at, done } = pipeline(f);
  return el("ol", { class: "tracker" }, steps.map((s, i) => {
    const state = done || i < at ? "done" : i === at ? "now" : "todo";
    const sub = s === "Plan" && f.stages.length ? el("div", { class: "substeps" },
      f.stages.map(st => el("span", { class: "chip " + statusClass(st.status), title: `${st.stage}: ${st.status}` + (st.ts ? ` (${new Date(st.ts).toLocaleDateString()})` : "") }, st.stage))) : "";
    const units = s === "Build" && f.tasks.total ? el("div", { class: "substeps" }, bar(f.tasks.done, f.tasks.total)) : "";
    return el("li", { class: state }, el("span", { class: "dot" }, state === "done" ? "✓" : String(i + 1)), el("span", { class: "label" }, s), sub, units);
  }));
}

// ------------------------------------------------------------- starting the next step
// Start… opens a panel: the project the new session runs in, the command, the
// session's name, a box for each <placeholder>; Start session has the server
// open a new Claude session (session-handoff.sh) started with the command.

const PROJECT_FROM = { chosen: "chosen by you", link: "from the tt-workflow link", ledger: "from the events ledger", docs: "from the documents" };
const placeholders = cmd => [...cmd.matchAll(/<([^<>]{1,60})>/g)].map(m => m[1]);

async function chooseProject(f) {
  const path = await pickFolder(`Choose the project (repo) for ${f.name}`, f.project || "");
  if (!path) return false;
  const r = await api("/api/project", { name: f.name, path });
  f.project = r.project; f.projectFrom = r.projectFrom;
  return true;
}

function projectLine(f, onChange) {
  return el("div", { class: "project-line small" }, "Sessions run in ",
    f.project ? copyable(f.project) : el("strong", { class: "st missing" }, "no project chosen yet"),
    f.project ? el("span", { class: "dim" }, ` (${PROJECT_FROM[f.projectFrom] || f.projectFrom})`) : "",
    el("button", { type: "button", onclick: async () => { try { if (await chooseProject(f)) onChange(); } catch (e) { alert(e.message || e); } } },
      f.project ? "Change…" : "Choose project…"));
}

function startPanel(f, row, index, close) {
  const cmd = command(row);
  const inputs = placeholders(cmd).map(ph => ({ ph, input: el("input", { placeholder: ph, "aria-label": ph }) }));
  const preview = el("code", {});
  const name = row.phase === "empty" ? `${f.name} : Start` : `${row.prefix || f.name} : ${row.stage || "Next"}`;
  const result = el("div", { class: "start-result" });
  const go = el("button", { type: "button", class: "primary" }, "Start session");
  const refresh = () => {
    let c = cmd;
    for (const { ph, input } of inputs) c = c.replace(`<${ph}>`, input.value.trim() || `<${ph}>`);
    preview.textContent = c;
    go.disabled = !f.project || inputs.some(i => !i.input.value.trim());
  };
  for (const { input } of inputs) input.addEventListener("input", refresh);
  const panel = el("div", { class: "start-panel" });
  const draw = () => {
    panel.replaceChildren(
      el("div", { class: "start-title" }, "Start a new Claude session"),
      projectLine(f, () => { draw(); refresh(); }),
      inputs.length ? el("div", { class: "start-inputs" }, inputs.map(({ ph, input }) => el("label", {}, el("span", { class: "dim small" }, ph), input))) : "",
      el("div", { class: "small" }, "running ", preview),
      el("div", { class: "small dim" }, "named ", el("strong", {}, name)),
      el("div", { class: "start-actions" }, go, el("button", { type: "button", onclick: close }, "Cancel")),
      result);
  };
  go.addEventListener("click", async () => {
    go.disabled = true;
    result.replaceChildren(el("span", { class: "dim small" }, "Opening a new session…"));
    tell("allow-foreground");
    const values = Object.fromEntries(inputs.map(({ ph, input }) => [ph, input.value.trim()]));
    try {
      const r = await api("/api/start", { name: f.name, row: index, values });
      if (r.ok) {
        // show it live straight away: the panel fills in as the session reports
        sessionInfo.set(r.tag, { tag: r.tag, feature: f.name, name: r.name, command: r.command, project: r.project,
          started: Date.now() / 1000, status: "starting" });
        f.sessions = [sessionInfo.get(r.tag), ...(f.sessions || [])];
        f.showWhere = false;
        const main = $(".fmain");
        if (main) main.replaceChildren(overview(f));
      }
      else result.replaceChildren(el("p", { class: "st missing" }, "Couldn't open a terminal here. Run this yourself:"), el("pre", {}, r.said));
    } catch (e) { result.replaceChildren(el("p", { class: "st missing" }, String(e.message || e))); go.disabled = false; }
  });
  draw(); refresh();
  return panel;
}

// ------------------------------------------------------------- a started session, live
// While a session Start opened is running, the feature page shows it instead of
// "Where it stands": what it is doing (each tool call, prompt and reply, as its
// Tatty mod reports them), its questions to answer in place, and a box to
// message it. Events come from app.js's stream ("tt-event"); history is replayed
// when the page connects, so the panel can be drawn at any time.

const sessionEvents = new Map(); // tag -> [activity / ask / say events]
const sessionInfo = new Map();   // tag -> the latest "session" event
const LIVE = new Set(["starting", "running", "lost", "unseen"]);
let livePanel = null;            // the panel on screen: { tag, update(ev) }
let usageView = null;            // the usage widget on screen: { tag, update(usage) }

document.addEventListener("tt-event", e => {
  const ev = e.detail;
  if (!ev.tag) return;
  if (ev.type === "session") {
    sessionInfo.set(ev.tag, ev);
    if (usageView && usageView.tag === ev.tag) usageView.update(ev.usage);
  }
  else {
    if (!sessionEvents.has(ev.tag)) sessionEvents.set(ev.tag, []);
    sessionEvents.get(ev.tag).push(ev);
  }
  if (livePanel && livePanel.tag === ev.tag) livePanel.update(ev);
  else if (ev.type === "session") {
    // a session of the feature on screen started, or changed: show it (once,
    // however many session events arrive together, as on a reconnect's replay)
    const r = parseRoute();
    if (r.page === "feature" && !r.doc && ev.feature === r.name) {
      clearTimeout(redrawSoon);
      redrawSoon = setTimeout(() => { featureCache.delete(r.name); route(); }, 300);
    }
  }
});
let redrawSoon = null;

const TOOL_ICONS = { Read: "📄", Edit: "✏️", Write: "📝", Bash: "⌨️", Grep: "🔎", Glob: "🗂️", Agent: "🤖", Skill: "🧩", WebFetch: "🌐", AskUserQuestion: "❓", TodoWrite: "☑️" };

function sessionStatus(s, events) {
  const openAsk = events.some(ev => ev.type === "ask" && !answers.has(ev.id));
  if (s.status === "ended") return ["Ended", "done"];
  if (s.status === "unseen") return ["Can't see this session (Tatty's plugin isn't loaded in it)", "bad"];
  if (s.status === "lost") return ["Not heard from for a while", "bad"];
  if (s.status === "starting") return ["Opening the session…", "now"];
  if (openAsk) return ["Waiting for your answer", "bad"];
  const acts = events.filter(ev => ev.type === "activity");
  const last = acts[acts.length - 1];
  const done = new Set(acts.filter(a => a.kind === "tool-done").map(a => a.id));
  const running = [...acts].reverse().find(a => a.kind === "tool" && !done.has(a.id));
  if (running) return [`Working: ${running.tool}${running.text ? " · " + running.text : ""}`, "now"];
  if (!last || last.kind === "reply") return ["Idle: waiting for you", "todo"];
  return ["Working…", "now"];
}

function activityRow(ev, rows) {
  if (ev.type === "say") return el("li", { class: "act you" }, el("span", { class: "who" }, "You"), el("span", {}, ev.text));
  if (ev.kind === "tool") {
    const li = el("li", { class: "act tool running", "data-id": ev.id },
      el("span", { class: "icon" }, TOOL_ICONS[ev.tool] || "•"), el("strong", {}, ev.tool), el("span", { class: "dim" }, ev.text || ""),
      el("span", { class: "state" }, "…"));
    rows.set(ev.id, li);
    return li;
  }
  if (ev.kind === "tool-done") {
    const li = rows.get(ev.id);
    if (li) { li.classList.remove("running"); li.classList.toggle("failed", !ev.ok); li.querySelector(".state").textContent = ev.ok ? "✓" : "✗"; }
    return null;
  }
  if (ev.kind === "prompt") return el("li", { class: "act you" }, el("span", { class: "who" }, "Prompt"), el("span", {}, ev.text));
  if (ev.kind === "reply") {
    const body = mdNode(ev.text);
    const li = el("li", { class: "act reply" }, el("span", { class: "who" }, "Claude"), body);
    if (ev.text.split("\n").length > 8 || ev.text.length > 700) {
      li.classList.add("folded");
      li.append(el("button", { type: "button", class: "more", onclick: e => { li.classList.toggle("folded"); e.target.textContent = li.classList.contains("folded") ? "More" : "Less"; } }, "More"));
    }
    return li;
  }
  return el("li", { class: "act" }, ev.text || "");
}

function sessionPanel(f, s, showWhere, quiet) {
  const tag = s.tag;
  const events = () => sessionEvents.get(tag) || [];
  const status = el("span", { class: "chip" });
  const doing = el("div", { class: "dim small live-meta" });
  const questions = el("div", { class: "live-questions" });
  const list = el("ol", { class: "activity" });
  const rows = new Map();
  const shownAsks = new Set();
  const say = el("textarea", { rows: 2, placeholder: "Message this session…  (Enter sends)" });
  const sent = el("span", { class: "dim small" });
  const send = async () => {
    const text = say.value.trim();
    if (!text) return;
    try { await api("/api/say", { text, tag }); say.value = ""; sent.textContent = "Sent; it reaches the session when it's ready."; } catch (e) { sent.textContent = String(e.message || e); }
  };
  say.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });

  const add = ev => {
    if (ev.type === "ask") {
      if (shownAsks.has(ev.id)) return;
      shownAsks.add(ev.id);
      questions.append(questionCard(ev));
      return;
    }
    if (ev.type !== "activity" && ev.type !== "say") return;
    const li = activityRow(ev, rows);
    if (li) { list.append(li); while (list.children.length > 120) list.firstChild.remove(); }
  };
  const refresh = () => {
    const info = sessionInfo.get(tag) || s;
    const [text, cls] = sessionStatus(info, events());
    status.textContent = text;
    status.className = "chip " + cls;
    doing.textContent = `started ${ago(info.started)} · in ${info.project} · ${info.command}`;
    list.scrollTop = list.scrollHeight;
  };
  for (const ev of events()) add(ev);
  const ended = () => (sessionInfo.get(tag) || s).status === "ended";
  const panel = el("section", { class: "card live" },
    el("div", { class: "live-head" }, el("span", { class: "pulse" }), el("h4", {}, s.name), status,
      el("button", { type: "button", class: "right", title: "The feature's steps, to start another", onclick: showWhere }, "Where it stands")),
    doing, questions,
    list.childElementCount || !ended() ? list : el("p", { class: "dim small" }, "Nothing was reported."),
    ended() ? "" : el("div", { class: "live-say" }, say, el("button", { type: "button", onclick: send }, "Send"), sent));
  if (!list.childElementCount && !ended()) list.append(el("li", { class: "act dim" }, "Waiting for the session to report in…"));
  refresh();
  if (quiet) return panel; // an ended session's record: nothing more will come
  livePanel = {
    tag, update(ev) {
      if (list.firstChild && list.firstChild.classList.contains("dim")) list.firstChild.remove();
      add(ev);
      refresh();
      if (ev.type === "session" && ev.status === "ended") { featureCache.delete(f.name); route(); }
    },
  };
  return panel;
}

// The panel's derived states (lost, unseen) change with time, not events: ask again now and then.
setInterval(async () => {
  if (!livePanel || document.hidden || parseRoute().page !== "feature") return;
  try {
    for (const s of await api("/api/sessions?name=" + encodeURIComponent(parseRoute().name))) {
      const was = sessionInfo.get(s.tag);
      sessionInfo.set(s.tag, s);
      if (usageView && usageView.tag === s.tag) usageView.update(s.usage);
      if (livePanel.tag === s.tag && (!was || was.status !== s.status)) livePanel.update({ type: "session", ...s });
    }
  } catch { /* the badge says so */ }
}, 10000);

// A step's command with Copy, Ask and Start…
function stepActions(f, row, index, openNow) {
  const cmd = command(row);
  if (!cmd) return "";
  const slot = el("div");
  const start = el("button", { type: "button", class: "primary", title: "Open a new Claude session that runs this" }, "Start…");
  const close = () => { slot.replaceChildren(); start.disabled = false; };
  const open = () => { start.disabled = true; slot.replaceChildren(startPanel(f, row, index, close)); };
  start.addEventListener("click", open);
  if (openNow) open();
  const cell = cmdCell(cmd, f.name);
  cell.prepend(start);
  return el("div", {}, cell, slot);
}

function overview(f) {
  const stand = (f.rows || []).map((r, i) => r.kind ? el("div", { class: "stand " + r.kind },
    el("p", {}, r.kind === "warn" ? "⚠ " : r.kind === "alt" ? "Or: " : "", r.text),
    stepActions(f, r, i)) : "");
  // Every feature can also be handed to tt-workflow, which works out its next step
  // (and starts a new one): the workflow's own entry point, nothing of Tatty's.
  if (f.workflowStep) stand.push(el("div", { class: "stand alt" }, el("p", {}, f.workflowStep.text),
    stepActions(f, f.workflowStep, "workflow", openStartFor === f.name)));
  if (openStartFor === f.name) openStartFor = null;
  if (!f.toolbox) stand.unshift(el("p", { class: "st missing" }, "Tatty can't find the TT toolbox, so it can't say where this feature stands."));
  const units = f.unitList.length ? el("section", { class: "card" }, el("h4", {}, "Build"),
    bar(f.tasks.done, f.tasks.total, `${f.units.done} of ${f.units.total} work units done · ${f.tasks.done} of ${f.tasks.total} tasks implemented or done`),
    el("table", { class: "units" }, el("tbody", {}, f.unitList.map(u => el("tr", {},
      el("td", { class: "mono" }, u.id), el("td", {}, u.outcome), el("td", {}, chip(u.status || "—", statusClass(u.status)))))))) : "";
  const events = f.events.length ? el("section", { class: "card" }, el("h4", {}, "Timeline"),
    el("ul", { class: "timeline" }, f.events.map(e => el("li", {},
      el("span", { class: "dim small mono" }, e.ts ? new Date(e.ts).toLocaleString() : ""),
      el("span", {}, (e.qualifier ? e.qualifier + " " : "") + (EVENTS[e.event] || e.event)),
      e.approx ? el("span", { class: "dim small", title: "Recorded when Tatty noticed it, not when it happened" }, " (noticed)") : "")))) : "";
  const redraw = () => { const main = $(".fmain"); if (main) main.replaceChildren(overview(f)); };
  const where = el("section", { class: "card" }, el("h4", {}, "Where it stands"),
    stand.some(Boolean) ? stand : el("p", { class: "dim" }, "Nothing to report."),
    (f.rows || []).some(r => command(r)) ? projectLine(f, redraw) : "");
  // A session Start opened that is still going takes the place of "Where it stands".
  livePanel = null;
  const live = (f.sessions || []).map(s => sessionInfo.get(s.tag) || s).find(s => LIVE.has(s.status));
  let process = where;
  if (live) {
    const panel = sessionPanel(f, live, () => { f.showWhere = !f.showWhere; redraw(); });
    process = f.showWhere ? el("div", {}, panel, where) : panel;
  }
  const last = !live && (f.sessions || []).map(s => sessionInfo.get(s.tag) || s)[0];
  const ended = last && last.status === "ended" ? el("details", { class: "card ended-session" },
    el("summary", {}, `Last session: ${last.name}, ended`), sessionPanel(f, last, () => {}, true)) : "";
  // What the live session has used so far, or the last one's final total: above the Timeline.
  usageView = null;
  const shown = live || last;
  let usage = "";
  if (shown) {
    const w = usageWidget(shown.usage);
    usageView = { tag: shown.tag, update: w.update };
    usage = w.node;
  }
  return el("div", { class: "overview" },
    el("div", { class: "ov-head" },
      el("h2", {}, f.name), chip(ROUTES[f.route] || f.route, "route"),
      chip(PHASES[f.phase] || f.phase || "—", f.phase === "complete" ? "done" : "now"),
      el("span", { class: "dim small" }, "updated " + ago(f.updated)),
      el("button", { type: "button", class: "right", onclick: () => { featureCache.delete(f.name); route(); } }, "Refresh")),
    el("div", { class: "dim small" }, copyable(f.folder)),
    tracker(f),
    process, ended,
    units, usage, events);
}

// A document is read in View (a viewer made for its kind, views.js; the plain
// markdown for a kind without one) or changed in Edit (its markdown, saved back to
// the file). It opens in View; the choice is kept for the session.
const docMode = {
  get: () => (sessionStorage.getItem("tt-doc-mode") === "edit" ? "edit" : "view"),
  set: m => sessionStorage.setItem("tt-doc-mode", m),
};
let editing = null; // the editor on screen: { dirty() }
window.addEventListener("beforeunload", e => { if (editing && editing.dirty()) e.preventDefault(); });

const docUrl = (f, file) => `/api/doc?name=${encodeURIComponent(f.name)}&file=${encodeURIComponent(file)}`;

// d is the /api/doc answer; it is kept current as the document is saved or reloaded.
function editor(f, file, d, meta, changed) {
  const ta = el("textarea", { class: "doc-edit", spellcheck: "false", "aria-label": "Document markdown" });
  ta.value = d.text;
  let base = d.text;
  const note = el("span", { class: "small dim" });
  const save = el("button", { type: "button", onclick: () => write(d.updated) }, "Save");
  const revert = el("button", { type: "button", onclick: () => { ta.value = base; sync(); } }, "Revert");
  const fix = el("span", { class: "ed-fix" });
  const sync = () => {
    const dirty = ta.value !== base;
    save.disabled = revert.disabled = !dirty;
    note.className = "small dim";
    note.textContent = dirty ? "Unsaved changes" : "";
  };
  const adopt = (text, updated) => { base = text; d.text = text; d.updated = updated; if (meta) meta.updated = updated; changed(updated); };
  async function write(expected) {
    fix.replaceChildren();
    try {
      const r = await api("/api/doc/save", { name: f.name, file, text: ta.value, expected });
      adopt(ta.value, r.updated);
      sync();
      note.textContent = "Saved";
    } catch (e) {
      if (e.status !== 409) { note.className = "small st missing"; note.textContent = `Couldn't save: ${e.message || e}`; return; }
      note.className = "small st missing";
      note.textContent = "This document changed on disk since you opened it.";
      fix.replaceChildren(
        el("button", { type: "button", onclick: async () => { const cur = await api(docUrl(f, file)); write(cur.updated); } }, "Overwrite with mine"),
        el("button", { type: "button", onclick: async () => { const cur = await api(docUrl(f, file)); ta.value = cur.text; adopt(cur.text, cur.updated); fix.replaceChildren(); sync(); } }, "Load the disk version"));
    }
  }
  ta.addEventListener("input", sync);
  ta.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (!save.disabled) write(d.updated); } });
  sync();
  editing = { dirty: () => ta.value !== base };
  return el("div", { class: "doc-editor" }, el("div", { class: "ed-bar" }, save, revert, note, fix), ta);
}

async function showDoc(f, file, main, at) {
  main.replaceChildren(el("p", { class: "dim" }, "Opening…"));
  editing = null;
  try {
    const d = await api(docUrl(f, file));
    const meta = [...f.docList, ...f.notes].find(x => x.file === file);
    const kind = meta && meta.doc;
    if (at) docMode.set("view"); // following a link to a heading: read it
    const body = el("div", { class: "doc-body" });
    const changedAt = el("span", { class: "dim small" }, "changed " + ago(d.updated));
    const buttons = {};
    // What a viewer may ask for: another document of this feature, by kind (a Task
    // Breakdown shows its tasks' status from the Task Status).
    const ctx = {
      sibling: async other => {
        const hit = f.docList.find(x => x.doc === other && meta && x.prefix === meta.prefix);
        if (!hit) return null;
        try { return (await api(docUrl(f, hit.file))).text; } catch { return null; }
      },
    };
    const render = () => {
      const mode = docMode.get();
      for (const [m, b] of Object.entries(buttons)) b.classList.toggle("on", m === mode);
      editing = null;
      body.replaceChildren(mode === "edit" ? editor(f, file, d, meta, u => { changedAt.textContent = "changed " + ago(u); })
        : viewOf(kind, d.text, ctx) || mdNode(d.text));
    };
    const pick = m => {
      if (m === docMode.get()) return;
      if (editing && editing.dirty() && !confirm("Discard your unsaved changes?")) return;
      docMode.set(m);
      render();
    };
    for (const [m, label] of [["view", "View"], ["edit", "Edit"]]) {
      buttons[m] = el("button", { type: "button", class: "mode-btn", title: m === "view" ? "Read it" : "Change its markdown", onclick: () => pick(m) }, label);
    }
    main.replaceChildren(
      el("div", { class: "doc-head" },
        el("h2", {}, meta ? (meta.doc || meta.name) : file),
        el("div", { class: "mode-toggle", role: "group", "aria-label": "Document mode" }, buttons.view, buttons.edit),
        changedAt,
        el("span", { class: "right" }, copyable(d.path))),
      body);
    render();
    main.scrollTop = 0;
    return true;
  } catch (e) { main.replaceChildren(el("p", { class: "st missing" }, `Can't open ${file}: ${e.message || e}`)); return false; }
}

// ------------------------------------------------------------- start

if (!companion) document.body.classList.add("full");
// The first page comes once app.js's boot knows which modes are installed.
booted.then(route);
