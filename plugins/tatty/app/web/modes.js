// Tatty's modes: the TT toolbox's discipline plugins (engineering, design,
// production), as the page sees them. The landing page (#modes) offers the ones
// installed, the top bar's radio switches between them, and the mode sets the
// app's accent colour, which is all a mode changes (theme.css). The choice is
// the page's own, remembered in localStorage; the server only says which
// plugins are installed (/api/status's modes).
// Uses app.js's $, el, tell and host; features.js routes to the pages below.
"use strict";

const MODE_INFO = {
  engineering: { label: "Engineering", blurb: "Plan, build, debug and review code." },
  design: { label: "Design", blurb: "The design discipline's skills." },
  production: { label: "Production", blurb: "The production discipline's skills." },
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

// #modes: pick a mode. Only ever shown with more than one installed (features.js
// sends the single-mode case straight to its home page), or with none at all.
function renderLanding(box) {
  const head = el("div", { class: "home-head" },
    el("div", {}, el("h2", {}, "Where are you working?"),
      el("div", { class: "dim small" }, "Your TT toolbox plugins. The top bar switches between them later.")));
  if (!installedModes.length) {
    box.replaceChildren(head, el("div", { class: "card toolbox-missing" },
      el("strong", {}, "No discipline plugin installed. "),
      "Tatty shows the TT toolbox's work, one discipline at a time. Install one and it turns up here:",
      el("p", { class: "mono small" }, "/plugin install engineering@tims-ai-toolbox"),
      el("span", { class: "dim" }, "For development, TATTY_MODES names the modes instead.")));
    return;
  }
  box.replaceChildren(head, el("div", { class: "fgrid" }, installedModes.map(id =>
    el("a", { class: "fcard mode-card", "data-mode": id, href: "#mode", onclick: () => applyMode(id) },
      el("div", { class: "fcard-top" }, el("strong", {}, modeDot(id), MODE_INFO[id].label)),
      el("p", { class: "ftext" }, MODE_INFO[id].blurb)))));
}

// #mode: the mode's own home page. A placeholder for now.
function renderModeHome(box) {
  const info = MODE_INFO[currentMode];
  box.replaceChildren(el("div", { class: "mode-home pad" },
    el("div", { class: "mode-home-head" }, modeDot(currentMode), el("h2", {}, info.label)),
    el("p", {}, info.blurb),
    el("p", { class: "dim" }, `This is the ${info.label} home page. There is nothing on it yet.`),
    el("div", { class: "mode-home-links" },
      currentMode === "engineering" ? el("a", { href: "#home" }, "Your features →") : "",
      installedModes.length > 1 ? el("a", { href: "#modes" }, "All modes") : "")));
}

// The remembered mode's colour is on before the first paint; the server's answer
// confirms or corrects it a moment later (setInstalledModes, from app.js's boot).
applyMode(storedMode());
