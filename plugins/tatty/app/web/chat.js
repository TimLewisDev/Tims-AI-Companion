// Chats: Claude conversations of their own, headless (server.py's "chats"), each
// in a tab. A main chat is opened by the "+" on either side of the split: in the
// workflow tabs' strip (#chats/<id>, with the documents pane beside it, as a
// workflow tab has) or in the pane's own strip. A side chat is about a piece of
// a workflow -- selected text (right-click, "Ask about this in a side chat") or a
// code block (its "Ask about it in a side chat") -- and opens in the pane beside
// it, holding that piece and what is around it, which go in front of the first
// message. A chat only reads, and carries no tag: nothing of it reaches the
// workflow it came from, which carries on as it was.
// Uses app.js's el, api, mdNode, mdSource and linkIds (ids.js); features.js's
// parseRoute, sessionInfo, pageEls, homeDraw, workflowTabs, drawTabs, loadTabs,
// featureOf, featureNav, documentsRail, markRail and refreshRail; split.js's
// pane (openChatInPane, paneTabs, paneActiveTab, splitLayout, showMenu), at call time.
"use strict";

const SECRETISH = /(token|password|passwd|secret|api[_-]?key)\s*[=:]|[A-Za-z0-9+/_-]{32,}/i;
const chatList = new Map();  // id -> each open chat, as /api/chats gives it (no messages)
const chatViews = new Map(); // id -> Set of the views drawn of it (a tab in the strip, the pane)
let lastPointer = { x: 200, y: 200 }; // where a menu with no button to sit by opens

document.addEventListener("pointerdown", e => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);

async function loadChats() {
  try {
    const list = await api("/api/chats");
    chatList.clear();
    for (const c of list) chatList.set(c.id, c);
  } catch { /* the badge says so */ }
}

// ------------------------------------------------------------- one chat

// A chat's view: its context (for a side chat), its messages, and a box to send
// another. { id, node, dirty(), focus() }; it follows the chat's "chat" events.
function chatView(id) {
  const head = el("div", { class: "chat-head" });
  const ctxSlot = el("div", { class: "chat-context-slot" });
  const list = el("ol", { class: "chat-msgs", "aria-live": "polite" });
  const step = el("div", { class: "chat-step dim small" });
  const box = el("textarea", { rows: 3, class: "chat-box", "aria-label": "Your message",
    placeholder: "Ask something…  (Enter sends, Shift+Enter for a new line)" });
  const stop = el("button", { type: "button", class: "chat-stop", title: "Stop this answer" }, "Stop");
  const send = el("button", { type: "submit", class: "primary chat-send" }, "Send");
  const said = el("span", { class: "dim small chat-said" });
  const form = el("form", { class: "chat-form" }, box, el("div", { class: "chat-actions" }, said, stop, send),
    el("div", { class: "note dim small" }, "Never paste a token, password or key here; enter secrets in your own shell or through ",
      el("code", {}, "/mcp"), "."));
  const node = el("section", { class: "chat", "data-chat": id }, head, ctxSlot, list, step, form);
  let chat = null, drawn = -1, loading = 0;

  const draw = () => {
    if (!chat) return;
    const where = [chat.feature, chat.project].filter(Boolean).join(" · ");
    head.replaceChildren(el("h3", {}, chat.title || "Chat"),
      el("div", { class: "dim small" }, chat.kind === "side" ? "Side chat" : "Chat", where ? " · " + where : "",
        chat.cost ? ` · $${chat.cost.toFixed(2)} so far` : ""));
    ctxSlot.replaceChildren(chat.context ? contextChip(chat) : "");
    if (drawn !== chat.messages.length) {
      drawn = chat.messages.length;
      list.replaceChildren(...(chat.messages.length ? chat.messages.map(m => chatMessage(m, chat))
        : [el("li", { class: "chat-msg dim" }, chat.kind === "side"
          ? "Ask your question about it: the context above goes in front of your first message."
          : `Ask anything. The chat can read ${chat.project} and use the toolbox's skills, but can't change anything.`)]));
      list.scrollTop = list.scrollHeight;
    }
    const busy = !!chat.busy;
    node.classList.toggle("busy", busy);
    step.textContent = busy ? (chat.step || "Thinking") + "…" : "";
    stop.hidden = !busy || chat.step === "Summarising";
    send.disabled = busy;
  };
  const load = async () => {
    const mine = ++loading;
    let c;
    try { c = await api("/api/chat?id=" + encodeURIComponent(id)); } catch (e) {
      if (mine === loading) head.replaceChildren(el("p", { class: "st missing" }, `Can't read this chat: ${e.message || e}`));
      return;
    }
    if (mine !== loading) return;
    chat = c;
    const was = chatList.get(id);
    chatList.set(id, { ...was, ...c, messages: undefined, context: undefined });
    draw();
  };

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const text = box.value.trim();
    if (!text || (chat && chat.busy)) return;
    if (SECRETISH.test(text) && !confirm("That looks like it might hold a secret. Send it anyway?")) return;
    said.textContent = "";
    send.disabled = true;
    try { chat = await api("/api/chat/say", { id, text }); box.value = ""; } catch (err) { said.textContent = String(err.message || err); }
    send.disabled = false;
    draw();
  });
  box.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  stop.addEventListener("click", async () => { try { await api("/api/chat/stop", { id }); } catch (err) { said.textContent = String(err.message || err); } });

  const view = {
    id, node,
    dirty: () => !!box.value.trim(),
    focus: () => requestAnimationFrame(() => box.focus()),
    update(ev) {
      // a step while it answers needs no read of the chat; anything else does
      if (chat && ev.busy && ev.step && !ev.done && !ev.new) { chat.busy = true; chat.step = ev.step; draw(); }
      else load();
    },
  };
  if (!chatViews.has(id)) chatViews.set(id, new Set());
  chatViews.get(id).add(view);
  load();
  return view;
}

function chatMessage(m, chat) {
  if (m.role === "you") {
    return el("li", { class: "chat-msg you", "data-ts": String(m.ts || "") }, el("span", { class: "who" }, "You"),
      m.withContext ? el("span", { class: "with-context dim small", title: "Sent after the context above" }, " with the context") : "",
      el("div", { class: "text" }, m.text));
  }
  if (m.role === "error") return el("li", { class: "chat-msg error" }, el("span", { class: "who" }, "Not answered"), el("div", {}, m.text));
  const body = mdNode(m.text);
  linkIds(body, chat.feature); // ids.js
  const steps = (m.steps || []).length ? el("details", { class: "chat-steps dim small" },
    el("summary", {}, `${m.steps.length} step${m.steps.length === 1 ? "" : "s"}`), el("ul", {}, m.steps.map(s => el("li", {}, s)))) : "";
  return el("li", { class: "chat-msg claude", "data-ts": String(m.ts || "") }, el("span", { class: "who" }, "Claude"), steps, body);
}

// What a side chat is about: the summary, where it came from, the piece itself,
// and what is around it (folded away).
function contextChip(c) {
  const x = c.context, s = x.source;
  const sent = c.messages.some(m => m.withContext);
  const where = [s.feature && `Feature: ${s.feature}`, s.session && `Workflow: ${s.session}`,
    s.file && `Document: ${s.doc || s.file}`, s.heading && `Section: ${s.heading}`, s.lang && `Language: ${s.lang}`].filter(Boolean);
  const box = el("details", { class: "chat-context" + (sent ? " sent" : "") },
    el("summary", {}, el("strong", {}, s.from === "code" ? "Code block" : "Selected text"), " · ",
      el("span", { class: "chat-summary" }, x.summary || "…")),
    el("p", { class: "dim small" }, sent ? "This went in front of your first message." : "This goes in front of your first message.",
      x.summaryBy === "model" ? " The summary is the model's." : "", x.summaryNote ? " " + x.summaryNote : ""),
    where.length ? el("p", { class: "small" }, where.join(" · ")) : "",
    el("pre", { class: "chat-selected" }, x.selected),
    x.around ? el("details", { class: "chat-around" }, el("summary", { class: "dim small" }, "What is around it"), el("pre", {}, x.around)) : "");
  box.open = !sent;
  return box;
}

document.addEventListener("tt-event", e => {
  const ev = e.detail;
  if (ev.type !== "chat") return;
  const known = chatList.get(ev.id);
  if (known && "busy" in ev) known.busy = ev.busy;
  for (const v of [...(chatViews.get(ev.id) || [])]) {
    // a view no longer on screen, nor in the pane (which is moved, not drawn again), is gone
    if (!v.node.isConnected && !(paneNode && paneNode.contains(v.node))) { chatViews.get(ev.id).delete(v); continue; }
    v.update(ev);
  }
  if (ev.closed) {
    chatList.delete(ev.id);
    dropChatFromPane(ev.id); // split.js
    if (parseRoute().chat === ev.id) location.hash = "#home";
    else drawTabs();
  } else if (ev.new && !chatList.has(ev.id)) loadTabsSoon(); // (another window's new chat)
});

// ------------------------------------------------------------- opening one

// A side chat about a piece of a workflow ({ source, selected, around }, from
// pieceContext): in the pane beside it, or as a tab of its own off a workflow.
async function openSideChat(context, project = "") {
  const r = parseRoute();
  const here = r.chat ? chatList.get(r.chat) : null;
  const body = { kind: "side", tag: r.tag || "", context, project: project || (here ? here.project : ""),
    feature: (context.source && context.source.feature) || (here ? here.feature : "") };
  await makeChat(body);
}

// A new main chat, from a "+": in the pane ("pane") or as a tab in the strip ("strip").
// It works in the workflow's project, the chat's on a chat tab, else one asked for.
async function newChat(where) {
  const r = parseRoute();
  const here = r.chat ? chatList.get(r.chat) : null;
  const s = r.tag ? sessionInfo.get(r.tag) || {} : {};
  await makeChat({ kind: "main", tag: r.tag || "", feature: r.tag ? s.feature || "" : here ? here.feature : "",
    project: here ? here.project : "" }, where);
}

async function makeChat(body, where = "pane") {
  let c;
  try { c = await api("/api/chat/new", body); } catch (e) {
    if (e.status !== 400 || body.project || !/project/i.test(e.message)) { alert(e.message || e); return; }
    // nowhere to work out the project from: ask which
    const project = await pickChatProject();
    if (!project) return;
    try { c = await api("/api/chat/new", { ...body, project }); } catch (e2) { alert(e2.message || e2); return; }
  }
  chatList.set(c.id, c);
  if (where === "pane" && openChatInPane(c)) return; // split.js
  location.hash = "#chats/" + encodeURIComponent(c.id);
}

// Which folder a chat should work in: the ones Tatty knows of, or one picked in Explorer.
async function pickChatProject() {
  let list = [];
  try { list = await api("/api/chat/projects"); } catch { /* only the picker, then */ }
  return new Promise(resolve => {
    const items = list.slice(0, 8).map(p => ({ label: p.split("/").filter(Boolean).pop() || p, ok: true, title: p, run: () => resolve(p) }));
    items.push({ label: "Choose a folder…", ok: true, title: "Pick the folder in Explorer", run: async () => {
      try { const got = await api("/api/pick-folder", { title: "The folder this chat works in" }); resolve(got.path || null); }
      catch (e) { alert(e.message || e); resolve(null); }
    } });
    showMenu(lastPointer.x, lastPointer.y, items, "The folder this chat works in", "Work in…", () => resolve(null)); // split.js
  });
}

// ------------------------------------------------------------- what it is about

// Where a side chat can be asked from by selecting text: a workflow's replies,
// a chat's answers, and documents (in the pane or on a feature's page).
const PICKABLE = ".act.reply, .chat-msg.claude, .doc-body";

// The selection under a right-click, if it is text in one of those: { node, text }.
function selectionPick(target) {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const c = sel.getRangeAt(0).commonAncestorContainer;
  const at = c.nodeType === 1 ? c : c.parentElement;
  const host = at && at.closest(PICKABLE);
  if (!host || !host.contains(target)) return null;
  return { node: at, text };
}

// What goes with a piece picked out of a page: where it came from (feature,
// workflow session, document and section, when), the piece, and the reply or
// document section it sits in.
function pieceContext(node, selected, from, lang = "") {
  const r = parseRoute();
  const source = { from, lang };
  const md = node.closest(".md");
  const raw = md ? mdSource.get(md) || "" : "";
  const reply = node.closest(".act.reply");
  const msg = node.closest(".chat-msg");
  let around = "";
  if (reply) {
    const s = sessionInfo.get(r.tag) || {};
    Object.assign(source, { tag: r.tag || "", session: s.name || "", feature: s.feature || "", ts: Number(reply.dataset.ts) || 0 });
    around = raw;
  } else if (msg) {
    const c = chatList.get((msg.closest(".chat") || { dataset: {} }).dataset.chat) || {};
    Object.assign(source, { feature: c.feature || "", ts: Number(msg.dataset.ts) || 0 });
    around = raw;
  } else {
    const t = node.closest(".dpane") ? paneActiveTab() : null;
    const onPage = !t && r.page === "feature";
    const docRoot = node.closest(".doc-body") || md;
    const head = node.closest(".fmain") && node.closest(".fmain").querySelector(".doc-head h2");
    const [heading, section] = docRoot ? sectionOf(docRoot, node, raw) : ["", ""];
    Object.assign(source, { feature: t ? t.feature : onPage ? r.name : "", file: t ? t.file || "" : onPage ? r.doc || "" : "",
      doc: t ? t.title : head ? head.textContent : "", heading });
    around = section;
  }
  if (!around && md) around = md.innerText;
  return { source, selected: selected.slice(0, 4000), around: around.slice(0, 6000) };
}

// The heading a node sits under in a document, and that heading's section: from
// the markdown when there is some (the lines down to the next heading as high
// or higher), else from the page.
function sectionOf(root, node, raw) {
  const heads = [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const above = heads.filter(h => h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING || h.contains(node)).pop();
  if (!above) return ["", raw];
  const level = Number(above.tagName[1]), title = above.textContent.trim();
  if (raw) {
    const lines = raw.replace(/\r/g, "").split("\n");
    const start = lines.findIndex(l => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, "").trim() === title);
    if (start >= 0) {
      let end = start + 1;
      while (end < lines.length && !(/^#{1,6}\s/.test(lines[end]) && lines[end].match(/^#+/)[0].length <= level)) end++;
      return [title, lines.slice(start, end).join("\n")];
    }
  }
  const range = document.createRange();
  range.setStartBefore(above);
  const next = heads.slice(heads.indexOf(above) + 1).find(h => Number(h.tagName[1]) <= level);
  if (next) range.setEndBefore(next); else range.setEndAfter(root.lastChild || root);
  return [title, range.toString()];
}

// ------------------------------------------------------------- a chat's own tab

// #chats/<id>: a chat in the workflow tabs' strip, with the documents pane
// beside it (and, when it is about a feature, that feature's documents rail).
async function renderChatTab(id) {
  const box = pageEls.home;
  const mine = ++homeDraw;
  tabsActive = "chat:" + id;
  await loadTabs();
  if (mine !== homeDraw) return;
  const c = chatList.get(id);
  if (!c) {
    box.replaceChildren(workflowTabs(tabsActive, false), el("div", { class: "pad" },
      el("p", { class: "dim" }, "That chat isn't here any more: its tab was closed."),
      el("a", { href: "#home" }, "Back to the features")));
    return;
  }
  let rail = "";
  if (c.feature) {
    try { const f = await featureOf(c.feature); rail = documentsRail(featureNav(f, null, false, { side: true }), f.name); } catch { /* the chat is still there without it */ }
    if (mine !== homeDraw) return;
  }
  const v = chatView(id);
  box.replaceChildren(el("div", { class: "wf-layout" }, rail,
    splitLayout([workflowTabs(tabsActive, false), el("div", { class: "wf-body chat-body" }, v.node)])));
  v.focus();
  if (rail) {
    markRail();
    clearInterval(homeTimer);
    homeTimer = setInterval(refreshRail, 20000);
  }
}

// × on a chat's tab: it is closed for good (its conversation is kept by Claude Code).
async function closeChat(id) {
  const c = chatList.get(id);
  if (c && c.busy && !confirm("This chat is still answering. Stop it and close the tab?")) return false;
  try { await api("/api/chat/close", { id }); } catch (e) { if (e.status !== 404) { alert(e.message || e); return false; } }
  chatList.delete(id);
  return true;
}

// ------------------------------------------------------------- the compact window's chat

// The compact bubble's chat: the one conversation about the project Tatty is on
// (server.py's "compact chat"), read-only, kept between sessions. Its box is built
// once and only hidden while the bubble shows the questions, so what has been
// typed and not sent is still there when the chat comes back.
function compactChatView(mount) {
  const head = el("div", { class: "cchat-head dim small" });
  const list = el("ol", { class: "chat-msgs", "aria-live": "polite" });
  const step = el("div", { class: "chat-step dim small" });
  const box = el("textarea", { rows: 2, class: "chat-box", "aria-label": "Your message",
    placeholder: "Ask about this project…  (Enter sends, Shift+Enter for a new line)" });
  const stop = el("button", { type: "button", class: "chat-stop", title: "Stop this answer" }, "Stop");
  const send = el("button", { type: "submit", class: "primary chat-send" }, "Send");
  const said = el("span", { class: "dim small chat-said" });
  const form = el("form", { class: "chat-form" }, box, el("div", { class: "chat-actions" }, said, stop, send));
  const node = el("div", { class: "chat cchat" }, head, list, step, form);
  mount.replaceChildren(node);
  let chat = null, drawn = -1, problem = "", loading = 0;

  const draw = () => {
    const name = chat ? chat.project.split("/").filter(Boolean).pop() || chat.project : "";
    head.textContent = name ? `Chat · ${name}` : "Chat";
    head.title = chat ? chat.project : "";
    if (!chat) {
      list.replaceChildren(el("li", { class: "chat-msg " + (problem ? "error" : "dim") }, problem || "Loading…"));
      drawn = -1;
      send.disabled = !!problem;
      return;
    }
    if (drawn !== chat.messages.length) {
      drawn = chat.messages.length;
      list.replaceChildren(...(chat.messages.length ? chat.messages.map(m => chatMessage(m, { feature: "" }))
        : [el("li", { class: "chat-msg dim" }, `Ask about ${name}. The chat reads its documents when it needs them, and can't change anything.`)]));
      list.scrollTop = list.scrollHeight;
    }
    const busy = !!chat.busy;
    node.classList.toggle("busy", busy);
    step.textContent = busy ? (chat.step || "Thinking") + "…" : "";
    stop.hidden = !busy;
    send.disabled = busy;
  };
  const load = async () => {
    const mine = ++loading;
    try {
      const c = await api("/api/compact-chat");
      if (mine !== loading) return;
      chat = c;
      problem = "";
    } catch (e) {
      if (mine !== loading) return;
      chat = null;
      problem = String(e.message || e);
    }
    draw();
  };

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const text = box.value.trim();
    if (!text || !chat || chat.busy) return;
    if (SECRETISH.test(text) && !confirm("That looks like it might hold a secret. Send it anyway?")) return;
    said.textContent = "";
    send.disabled = true;
    try {
      chat = await api("/api/compact-chat/say", { project: chat.project, text });
      box.value = "";
    } catch (err) { said.textContent = String(err.message || err); }
    draw();
  });
  box.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  stop.addEventListener("click", async () => {
    try { await api("/api/compact-chat/stop", { project: chat ? chat.project : "" }); } catch (err) { said.textContent = String(err.message || err); }
  });

  document.addEventListener("tt-event", e => {
    const ev = e.detail;
    if (ev.type !== "compact-chat") return;
    // a step while it answers needs no read of the chat; anything else does
    if (chat && ev.project === chat.project && ev.busy && ev.step && !ev.done) { chat.busy = true; chat.step = ev.step; draw(); }
    else load();
  });
  // coming back to the chat reads it again (the project may have changed meanwhile)
  document.addEventListener("tt-compact-mode", e => {
    if (e.detail !== "chat") return;
    load();
    requestAnimationFrame(() => box.focus());
  });

  draw();
  load();
}

if (document.body.classList.contains("companion") && token) compactChatView(document.getElementById("compact-chat"));
