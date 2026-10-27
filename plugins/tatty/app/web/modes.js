// Tatty's modes: the TT toolbox's discipline plugins (engineering, design,
// production), as the page sees them. The landing page (#modes) offers the ones
// installed, the top bar's radio switches between them, and the mode sets the
// app's accent colour, which is all a mode changes (theme.css). The choice is
// the page's own, remembered in localStorage; the server only says which
// plugins are installed (/api/status's modes).
// Uses app.js's el, api and tell; features.js routes to the pages below.
"use strict";

const MODE_INFO = {
  engineering: { label: "Engineering", blurb: "Plan, build, debug and review code." },
  design: { label: "Design", blurb: "Turn design documents into user stories, and work them on a board." },
  production: { label: "Production", blurb: "Track the work: your Jira sprint, or task boards of Tatty's own." },
};
const MODE_ORDER = ["engineering", "design", "production"];

let installedModes = []; // the plugins the server found, in MODE_ORDER
let currentMode = "";    // the one on screen; "" until one is picked

// localStorage can be refused (a locked-down browser); the mode is then just
// forgotten when the window closes.
const storedMode = () => { try { return localStorage.getItem("tt-mode") || ""; } catch { return ""; } };
const storeMode = id => { try { localStorage.setItem("tt-mode", id); } catch { /* not remembered */ } };

// The mode on screen: its colour (theme.css reads body[data-mode]), the top
// bar, the nav, and the tray app's own drawing of Tatty.
function applyMode(id) {
  const next = MODE_INFO[id] ? id : "";
  currentMode = next;
  if (next) {
    document.body.dataset.mode = next;
    storeMode(next);
  } else delete document.body.dataset.mode;
  tell("mode", next);
  renderSwitcher();
  renderNav();
}

// What the server says is installed, at boot and on every status poll (a plugin
// installed while Tatty is open turns up without a reload). Keeps the mode on
// screen if it is still installed, else the one remembered, else the only one.
function setInstalledModes(list) {
  installedModes = MODE_ORDER.filter(m => (list || []).includes(m));
  const want = installedModes.includes(currentMode) ? currentMode
    : installedModes.includes(storedMode()) ? storedMode()
      : installedModes.length === 1 ? installedModes[0] : "";
  applyMode(want);
}

const modeDot = id => el("span", { class: "mode-dot", "data-mode": id });

// A compact radio over the modes installed, in one box: the mode on screen is
// the segment that looks pressed in, in that mode's colour. With one mode it is
// the one segment, pressed, so the bar still names the mode; with none, nothing.
// It goes in every .mode-switch slot (the title bar's and the header's, of which
// only one is on screen: style.css), so each gets its own copy of the nodes.
function renderSwitcher() {
  const only = installedModes.length === 1;
  for (const box of document.querySelectorAll(".mode-switch")) {
    if (!installedModes.length) { box.replaceChildren(); continue; }
    box.replaceChildren(el("div", { class: "modeswitch", role: "radiogroup", "aria-label": "Mode" },
      installedModes.map(id => el("button", {
        type: "button", class: "mode-seg" + (id === currentMode ? " on" : ""), role: "radio",
        "aria-checked": id === currentMode ? "true" : "false",
        title: only ? `${MODE_INFO[id].label}: the only discipline plugin installed` : MODE_INFO[id].blurb,
        onclick: () => switchMode(id), // features.js: the mode, and the page it leaves you on
      }, MODE_INFO[id].label))));
  }
}

// A nav item for one mode's pages (data-mode) is shown only in that mode. With
// no discipline plugin installed nothing is hidden: Tatty can still show the
// workflow from the toolbox's core alone.
function renderNav() {
  for (const a of document.querySelectorAll(".pnav a")) {
    const owner = a.dataset.mode;
    a.classList.toggle("hidden", !!owner && installedModes.length > 0 && owner !== currentMode);
  }
}

// ------------------------------------------------------------- the pages

// A mode just added: what it still needs, said on the next render of the page.
let added = "";

// #modes: every discipline the toolbox has. The ones installed are the modes to
// work in; the rest are greyed, with Add to install the plugin.
function renderLanding(box) {
  const note = added ? el("p", { class: "home-note small ok" },
    `${MODE_INFO[added].label} is installed. Its skills reach Claude Code in sessions started from now on.`) : "";
  added = ""; // said once
  const head = el("div", { class: "home-head" },
    el("div", {}, el("h2", {}, "Where are you working?"),
      el("div", { class: "dim small" }, "Your TT toolbox plugins. The title bar switches between them later."),
      note));
  box.replaceChildren(head, el("div", { class: "fgrid" }, MODE_ORDER.map(id => modeCard(id, box))));
}

function modeCard(id, box) {
  const info = MODE_INFO[id];
  const top = el("div", { class: "fcard-top" }, el("strong", {}, modeDot(id), info.label));
  const blurb = el("p", { class: "ftext" }, info.blurb);
  if (installedModes.includes(id)) {
    return el("a", { class: "fcard mode-card", "data-mode": id, href: "#mode", onclick: () => applyMode(id) }, top, blurb);
  }
  // Not installed: greyed, and Add has Claude Code install it from the toolbox's
  // marketplace (/api/mode/install). The card comes to life with the answer.
  const msg = el("div", { class: "small dim" });
  const add = el("button", { type: "button", class: "primary", title: `Install the toolbox's ${info.label.toLowerCase()} plugin` }, "Add");
  add.addEventListener("click", async () => {
    add.disabled = true;
    msg.className = "small dim";
    msg.textContent = "Installing…";
    try {
      const r = await api("/api/mode/install", { mode: id });
      added = id;
      setInstalledModes(r.modes); // the card becomes one of the modes
      renderLanding(box);
    } catch (e) {
      add.disabled = false;
      msg.className = "small st missing";
      msg.textContent = String(e.message || e); // the server says what to run by hand
    }
  });
  return el("div", { class: "fcard mode-card off", "data-mode": id }, top, blurb,
    el("div", { class: "mode-add" }, add, msg));
}

// The pages each mode owns, as cards on its home page. The labels are the nav's
// (index.html), so a card is named for the page it opens.
const MODE_PAGES = {
  engineering: [
    { href: "#home", label: "Features", icon: "features", blurb: "Your features, where each stands, and their documents." },
  ],
  design: [
    { href: "#designs", label: "User Stories", icon: "stories", blurb: "Your user story boards of sticky notes." },
  ],
  production: [
    { href: "#jira", label: "Jira", icon: "jira", blurb: "Your open-sprint tickets on a board." },
    { href: "#tasks", label: "Tasks", icon: "tasks", blurb: "Task boards of Tatty's own." },
  ],
};
// in every mode: the modes page is also where another discipline is added
const ALL_MODES_PAGE = { href: "#modes", label: "All modes", icon: "modes", blurb: "Switch discipline, or add another." };

// Line icons on a 24 grid, drawn in the text colour (so the accent, on a card).
// Built with createElementNS and attributes, not a style attribute: the page's
// content security policy has no inline styles.
const ICONS = {
  features: ["M12 3 3 8l9 5 9-5-9-5Z", "M3 12.5l9 5 9-5", "M3 17l9 5 9-5"],
  stories: ["M5 4h14v10l-6 6H5Z", "M13 20v-6h6", "M8 9h8", "M8 13h4"],
  jira: ["M4 4h4.5v16H4Z", "M9.75 4h4.5v10h-4.5Z", "M15.5 4H20v13h-4.5Z"],
  tasks: ["M4 4h16v16H4Z", "M8 12.5l2.5 2.5L16 9"],
  modes: ["M4 4h6.5v6.5H4Z", "M13.5 4H20v6.5h-6.5Z", "M4 13.5h6.5V20H4Z", "M13.5 13.5H20V20h-6.5Z"],
};

function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8",
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true",
  })) svg.setAttribute(k, v);
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

// #mode: the mode's own home page: its name, and a card for each page it owns.
function renderModeHome(box) {
  const info = MODE_INFO[currentMode];
  const pages = [...(MODE_PAGES[currentMode] || []), ALL_MODES_PAGE];
  box.replaceChildren(el("div", { class: "mode-home pad" },
    el("div", { class: "mode-home-head" }, modeDot(currentMode), el("h2", {}, info.label)),
    el("p", { class: "dim" }, info.blurb),
    el("div", { class: "mode-tiles" }, pages.map(p =>
      el("a", { class: "mode-tile", href: p.href },
        el("span", { class: "mode-tile-icon" }, icon(p.icon)),
        el("strong", {}, p.label),
        el("span", { class: "small dim" }, p.blurb))))));
}

// The remembered mode's colour is on before the first paint; the server's answer
// confirms or corrects it a moment later (setInstalledModes, from app.js's boot).
applyMode(storedMode());
