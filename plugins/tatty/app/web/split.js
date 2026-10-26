// The documents split: beside a workflow tab (#workflows/<tag>) or a chat's tab
// (#chats/<id>), a second pane with tabs of its own for the documents its links
// point at, so following a link (a planning ID, a [[wikilink]], a hover card's
// "Open in …") no longer takes you off the workflow; and for chats (chat.js): a
// side chat about a piece of the workflow, or a new chat from the pane's "+".
// One pane serves every such tab. A divider between the two sides can be
// dragged (or moved with the arrow keys) to choose their widths.
// Uses app.js's el and api, features.js's showDoc, goToTarget, featureCache,
// docMode, editing, parseRoute and route, and chat.js's chatView, chatList,
// newChat, closeChat, openSideChat, selectionPick and pieceContext (at call time).
"use strict";

const PANE_KEY = "tt-docpane";   // sessionStorage: the open tabs, so a reload keeps them
const SPLIT_KEY = "tt-split";    // localStorage: the workflow's share of the width
const SIDE_MIN = 280;            // px each side keeps
const SPLIT_LIMITS = [0.2, 0.8]; // the workflow side's share, at its least and most

let paneTabs = [];       // [{ key, feature, file, at, title }] or, a chat, [{ kind: "chat", key, chat, feature, title }]
let paneActive = "";     // the key of the tab on show
let paneShownKey = "";   // the key of the document drawn in paneMain ("" when none is)
let paneRequest = 0;     // counts the draws, so only the latest applies
let paneScroll = 0;      // where the document was scrolled to, kept across being moved
let paneChat = null;     // the chat drawn in the pane (chat.js's chatView), or null
let paneNode = null, paneStrip = null, paneMain = null; // the pane: one element, moved into each page that shows it
let splitNode = null, splitLeft = null, splitDiv = null; // the layout on screen
let lastHash = location.hash; // where the person was before the route that is being decided
let splitFrac = (() => {
  const f = parseFloat(localStorage.getItem(SPLIT_KEY));
  return f >= SPLIT_LIMITS[0] && f <= SPLIT_LIMITS[1] ? f : 0.5;
})();

try {
  const saved = JSON.parse(sessionStorage.getItem(PANE_KEY) || "null");
  if (saved && Array.isArray(saved.tabs)) {
    paneTabs = saved.tabs.filter(t => t && (t.kind === "chat" ? /^c-[0-9a-f]{8}$/.test(t.chat) :
      typeof t.feature === "string" && typeof t.file === "string"))
      .map(t => t.kind === "chat"
        ? { kind: "chat", key: "chat/" + t.chat, chat: t.chat, feature: String(t.feature || ""), title: String(t.title || "Chat") }
        : { key: t.feature + "/" + t.file, feature: t.feature, file: t.file, at: String(t.at || ""), title: String(t.title || t.file) });
    paneActive = paneTabs.some(t => t.key === saved.active) ? saved.active : (paneTabs[0] || {}).key || "";
  }
} catch { /* a tab list that doesn't read is no tab list */ }

const savePane = () => sessionStorage.setItem(PANE_KEY, JSON.stringify({ tabs: paneTabs, active: paneActive }));
const paneActiveTab = () => paneTabs.find(t => t.key === paneActive) || null;
const discardable = () => {
  const chatting = paneChat && paneShownKey === "chat/" + paneChat.id && paneChat.dirty();
  if (chatting) return confirm("Discard the message you haven't sent?");
  return !(editing && editing.dirty()) || confirm("Discard your unsaved changes?");
};
// Where the split (and so the pane) is: a workflow's tab or a chat's.
const splitRoute = r => !!(r.tag || r.chat);

function ensurePane() {
  if (paneNode) return;
  paneStrip = el("nav", { class: "wtabs dtabs", "aria-label": "Documents" });
  paneMain = el("div", { class: "fmain dpane-main" });
  paneMain.addEventListener("scroll", () => { if (paneMain.isConnected) paneScroll = paneMain.scrollTop; });
  paneNode = el("section", { class: "dpane", "aria-label": "Documents" }, paneStrip, paneMain);
}

function drawPaneTabs() {
  markRail(); // features.js: the rail's documents that are open here
  if (!paneNode) return;
  paneStrip.replaceChildren(...paneTabs.map(t => {
    if (t.kind === "chat") {
      const c = chatList.get(t.chat);
      if (c && c.title) t.title = c.title;
      return el("span", { class: "wtab chat" + (t.key === paneActive ? " on" : ""), "data-key": t.key },
        el("a", { href: "#", title: c ? `${c.kind === "side" ? "Side chat" : "Chat"} in ${c.project}` : "Chat",
          onclick: e => { e.preventDefault(); activatePaneTab(t.key); } }, el("span", { class: "chat-mark", "aria-hidden": "true" }, "💬"), t.title),
        el("button", { type: "button", class: "x", title: "Close this chat", "aria-label": "Close " + t.title, onclick: () => closePaneTab(t.key) }, "×"));
    }
    const same = paneTabs.some(o => o !== t && o.title === t.title);
    return el("span", { class: "wtab" + (t.key === paneActive ? " on" : ""), "data-key": t.key },
      el("a", { href: "#", title: `${t.feature} › ${t.file}`, onclick: e => { e.preventDefault(); activatePaneTab(t.key); } }, same ? `${t.feature} · ${t.title}` : t.title),
      el("button", { type: "button", class: "x", title: "Close this document", "aria-label": "Close " + t.title, onclick: () => closePaneTab(t.key) }, "×"));
  }), el("button", { type: "button", class: "wtab-add", title: "New chat in the side panel", "aria-label": "New chat in the side panel",
    onclick: () => newChat("pane") }, "+"));
}

// Draws the tab, a document or a chat, into the pane.
function showPaneTab(tab) {
  if (tab.kind === "chat") showPaneChat(tab); else { paneChat = null; showPaneDoc(tab); }
}

// A chat's view is built afresh each time its tab is shown; its messages are the server's.
function showPaneChat(tab) {
  paneRequest++;
  editing = null;
  paneChat = chatView(tab.chat);
  paneMain.replaceChildren(el("div", { class: "dpane-host dpane-chat" }, paneChat.node));
  paneShownKey = tab.key;
  paneChat.focus();
}

// Draws the tab's document into the pane. Each draw is built in a element of its
// own and swapped in once it is ready, so a slow one can't land on top of a newer.
async function showPaneDoc(tab) {
  const mine = ++paneRequest;
  paneShownKey = "";
  paneMain.replaceChildren(el("p", { class: "dim" }, "Opening…"));
  let f;
  try { f = await featureOf(tab.feature); } catch (e) {
    if (mine === paneRequest) paneMain.replaceChildren(el("p", { class: "st missing" }, `Can't read ${tab.feature}: ${e.message || e}`));
    return;
  }
  if (mine !== paneRequest) return;
  const meta = [...f.docList, ...f.notes].find(x => x.file === tab.file);
  if (meta && (meta.doc || meta.name) && tab.title !== (meta.doc || meta.name)) { tab.title = meta.doc || meta.name; savePane(); drawPaneTabs(); }
  const host = el("div", { class: "dpane-host" });
  const ok = await showDoc(f, tab.file, host, tab.at);
  if (mine !== paneRequest) return;
  paneMain.replaceChildren(host);
  if (ok) { paneShownKey = tab.key; goToTarget(paneMain, tab.at); }
}

function activatePaneTab(key) {
  const tab = paneTabs.find(t => t.key === key);
  if (!tab || (key === paneActive && paneShownKey === key)) return;
  if (!discardable()) return;
  paneActive = key;
  savePane();
  drawPaneTabs();
  showPaneTab(tab);
}

// Closing a chat's tab closes the chat (asking first while it answers).
async function closePaneTab(key) {
  const i = paneTabs.findIndex(t => t.key === key);
  if (i < 0) return;
  const tab = paneTabs[i];
  if (key === paneActive && !discardable()) return;
  if (tab.kind === "chat" && !(await closeChat(tab.chat))) return;
  dropPaneTab(key);
}

// A chat closed elsewhere (its other tab, another window) leaves the pane too.
function dropChatFromPane(id) {
  if (paneTabs.some(t => t.key === "chat/" + id)) dropPaneTab("chat/" + id);
}

function dropPaneTab(key) {
  const i = paneTabs.findIndex(t => t.key === key);
  if (i < 0) return;
  paneTabs.splice(i, 1);
  if (key === paneActive) {
    const next = paneTabs[Math.min(i, paneTabs.length - 1)];
    paneActive = next ? next.key : "";
    paneShownKey = "";
    paneRequest++;
    editing = null;
    paneChat = null;
    if (next) showPaneTab(next); else paneMain.replaceChildren();
  }
  savePane();
  drawPaneTabs();
  splitSync();
}

// Opens a document in the pane when a workflow (or chat) tab is on screen: true
// if it did, false if the caller should go to the document's page as usual.
function openInPane(feature, file, at) {
  if (!splitRoute(parseRoute()) || !feature || !file) return false;
  at = at || "";
  const key = feature + "/" + file;
  const have = paneTabs.find(t => t.key === key);
  const drawn = !!have && paneActive === key && paneShownKey === key && paneMain.isConnected;
  if (!drawn && !discardable()) return true; // (declined: stay where the edit is)
  ensurePane();
  let tab = have;
  if (!tab) {
    const f = featureCache.get(feature);
    const meta = f && [...f.docList, ...f.notes].find(x => x.file === file);
    tab = { key, feature, file, at, title: meta ? (meta.doc || meta.name) : file.split("/").pop().replace(/\.md$/i, "") };
    paneTabs.push(tab);
  }
  tab.at = at;
  paneActive = key;
  savePane();
  drawPaneTabs();
  splitSync();
  if (drawn) { if (docMode.get() === "view") goToTarget(paneMain, at); }
  else { paneChat = null; showPaneDoc(tab); }
  return true;
}

// Opens a chat (as /api/chat/new gave it) in the pane, the same way: false off a
// workflow or chat tab, where it opens as a tab of its own instead (chat.js).
function openChatInPane(c) {
  if (!splitRoute(parseRoute())) return false;
  const key = "chat/" + c.id;
  let tab = paneTabs.find(t => t.key === key);
  if (tab && paneActive === key && paneShownKey === key && paneMain.isConnected) { paneChat.focus(); return true; }
  if (!discardable()) return true;
  ensurePane();
  if (!tab) {
    tab = { kind: "chat", key, chat: c.id, feature: c.feature || "", title: c.title || "Chat" };
    paneTabs.push(tab);
  }
  paneActive = key;
  savePane();
  drawPaneTabs();
  splitSync();
  showPaneChat(tab);
  return true;
}

// ------------------------------------------------------------- the layout

// .split holds the workflow's side and, while there are documents open, the
// divider and the pane. The workflow tab puts its own nodes in with this.
function splitLayout(leftNodes) {
  ensurePane();
  splitLeft = el("div", { class: "split-left" }, ...leftNodes);
  splitDiv = makeDivider();
  splitNode = el("div", { class: "split" }, splitLeft);
  splitSync();
  if (paneTabs.length && paneActive && !paneShownKey && !paneMain.firstChild) showPaneTab(paneActiveTab()); // after a reload
  return splitNode;
}

// Shows or hides the divider and the pane to match the open tabs.
function splitSync() {
  if (!splitNode) return;
  const open = paneTabs.length > 0;
  splitNode.classList.toggle("paned", open);
  if (!open) {
    splitDiv.remove();
    paneNode.remove();
    splitLeft.style.flexBasis = "";
    return;
  }
  if (paneNode.parentNode !== splitNode) {
    splitNode.append(splitDiv, paneNode);
    // (a moved element forgets how far it was scrolled)
    requestAnimationFrame(() => { if (paneMain.isConnected) paneMain.scrollTop = paneScroll; });
  }
  drawPaneTabs();
  setFraction(splitFrac, false);
}

function clampFraction(f) {
  const w = splitNode.getBoundingClientRect().width || 1000;
  const lo = Math.max(SPLIT_LIMITS[0], SIDE_MIN / w), hi = Math.min(SPLIT_LIMITS[1], 1 - (SIDE_MIN + 6) / w);
  return lo > hi ? 0.5 : Math.min(hi, Math.max(lo, f));
}

function setFraction(f, save) {
  const used = clampFraction(f);
  if (save) { splitFrac = used; localStorage.setItem(SPLIT_KEY, String(used)); }
  splitLeft.style.flexBasis = (used * 100).toFixed(2) + "%"; // (through the DOM: the CSP refuses inline styles)
  splitDiv.setAttribute("aria-valuenow", String(Math.round(used * 100)));
}

function makeDivider() {
  const d = el("div", { class: "split-div", role: "separator", "aria-orientation": "vertical", tabindex: "0",
    "aria-label": "Resize the workflow and the documents", "aria-valuemin": "20", "aria-valuemax": "80",
    title: "Drag to resize · double-click to reset" });
  let dragging = false;
  const at = e => { const r = splitNode.getBoundingClientRect(); return (e.clientX - r.left) / r.width; };
  d.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    dragging = true;
    d.setPointerCapture(e.pointerId);
    splitNode.classList.add("split-dragging");
    e.preventDefault();
  });
  d.addEventListener("pointermove", e => { if (dragging) setFraction(at(e), false); });
  const stop = e => {
    if (!dragging) return;
    dragging = false;
    splitNode.classList.remove("split-dragging");
    setFraction(at(e), true);
  };
  d.addEventListener("pointerup", stop);
  d.addEventListener("pointercancel", () => { dragging = false; splitNode.classList.remove("split-dragging"); setFraction(splitFrac, false); });
  d.addEventListener("dblclick", () => setFraction(0.5, true));
  d.addEventListener("keydown", e => {
    const moves = { ArrowLeft: splitFrac - 0.02, ArrowRight: splitFrac + 0.02, Home: 0, End: 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    setFraction(moves[e.key], true);
  });
  return d;
}

// Leaving the workflow tabs takes the pane off the page: an edit that isn't saved
// asks first (and a "no" stays where it was). A chat's unsent message stays in
// its box, which goes with the pane. Called by route() with the new route.
function paneLeaveBlocked(r) {
  if (splitRoute(r) || !paneNode || !paneNode.isConnected) return false;
  if (editing && editing.dirty()) {
    if (!confirm("Discard your unsaved changes?")) { location.hash = lastHash; return true; }
    editing = null;
    paneShownKey = ""; // drawn again from the file when the pane comes back
    paneMain.replaceChildren();
  }
  return false;
}

// ------------------------------------------------------------- the menu

// Tatty's own right-click menu, in place of the browser's (whose "open in a new
// window" opens nothing here). On a document link it offers the ways to open it:
// Open (as a click does), Open in side panel, Open in main panel. When the
// document is already open in the side panel, Open becomes Navigate to, which
// moves that document to the item the link names. On selected text in a
// workflow's reply, a chat's answer or a document it offers "Ask about this in a
// side chat" (chat.js). The "+" of a chat that needs a folder uses it too.
let linkMenu = null;
let linkMenuGone = null; // what to do when the menu goes without a choice

function closeLinkMenu() {
  if (linkMenu) linkMenu.remove();
  linkMenu = null;
  const gone = linkMenuGone;
  linkMenuGone = null;
  if (gone) gone();
}

function linkItems(target) {
  const onWorkflow = splitRoute(parseRoute());
  const usable = !!target && !target.missing;
  const inSide = usable && onWorkflow && paneTabs.some(t => t.key === target.name + "/" + target.file);
  const why = !target ? "There's no feature to look in here" : target.missing ? "That document isn't under Tatty's root" : "";
  return [
    { label: inSide ? "Navigate to" : "Open", ok: usable, why,
      title: inSide ? "Move the document in the side panel to this item" : "Open it as a click does",
      run: () => openItem(target.name, target.file, target.at) },
    { label: "Open in side panel", ok: usable && onWorkflow, why: why || "The side panel is beside a workflow",
      title: "Open it beside the workflow", run: () => openInPane(target.name, target.file, target.at) },
    { label: "Open in main panel", ok: usable, why, title: "Go to the document's page",
      run: () => openItem(target.name, target.file, target.at, "main") },
  ];
}

// The selected text's item: its context is read now, while the selection is still there.
function askItem(pick) {
  const context = pieceContext(pick.node, pick.text, "selection");
  return { label: "Ask about this in a side chat", ok: true, title: "Open a side chat about the selected text, beside the workflow",
    run: () => openSideChat(context) };
}

// items: [{ label, ok, why, title, run }]; heading: an optional line above them;
// gone: called when the menu goes without a choice.
function showMenu(x, y, items, label, heading = "", gone = null) {
  closeLinkMenu();
  const buttons = items.map(it => {
    const b = el("button", { type: "button", role: "menuitem", class: "linkmenu-item", title: it.ok ? it.title : it.why }, it.label);
    b.disabled = !it.ok;
    b.addEventListener("click", () => { linkMenuGone = null; closeLinkMenu(); it.run(); });
    return b;
  });
  linkMenu = el("div", { class: "linkmenu", role: "menu", "aria-label": label },
    heading ? el("div", { class: "linkmenu-head dim small" }, heading) : "", ...buttons);
  linkMenuGone = gone;
  document.body.append(linkMenu);
  // Beside the pointer, kept on the page (positions are set through the DOM: the CSP refuses inline styles)
  const w = linkMenu.offsetWidth, h = linkMenu.offsetHeight;
  linkMenu.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + "px";
  linkMenu.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + "px";
  (buttons.find(b => !b.disabled) || buttons[0]).focus();
}

document.addEventListener("contextmenu", async e => {
  if (!e.target.closest || e.target.closest("input, textarea")) return; // the browser's own, for editing
  const a = e.target.closest("a.doclink");
  const pick = selectionPick(e.target); // chat.js
  if (!a && !pick) return;
  e.preventDefault();
  closePeek(); // ids.js: the hover card, if one is up
  closeLinkMenu();
  const { clientX, clientY } = e;
  const items = pick ? [askItem(pick)] : [];
  if (a) items.push(...linkItems(await linkTarget(a)));
  showMenu(clientX, clientY, items, a ? "Open this link" : "Ask about this");
});

document.addEventListener("keydown", e => {
  if (!linkMenu) return;
  const live = [...linkMenu.querySelectorAll("button:not(:disabled)")];
  const at = live.indexOf(document.activeElement);
  if (e.key === "Escape") { e.preventDefault(); closeLinkMenu(); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (live.length) live[(at + (e.key === "ArrowDown" ? 1 : live.length - 1)) % live.length].focus();
  } else if (e.key === "Tab") closeLinkMenu();
});
document.addEventListener("pointerdown", e => { if (linkMenu && !linkMenu.contains(e.target)) closeLinkMenu(); }, true);
document.addEventListener("scroll", e => { if (linkMenu && !linkMenu.contains(e.target)) closeLinkMenu(); }, true);
window.addEventListener("hashchange", closeLinkMenu);
window.addEventListener("blur", closeLinkMenu);
window.addEventListener("resize", closeLinkMenu);
