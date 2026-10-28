// The board that Tatty's Tasks (tasks.js) and Jira (jira.js) pages share, as
// whiteboard.js is the one the design pages share: columns of cards you drag
// between (or move with Alt+arrows), a filter, the ⋯ menu of each column, the
// panel at the right, and the Start workflow section with its Start lite and the
// folder the work is done in. A page makes one with makeTaskBoard(o) and keeps
// what is its own: where the data comes from, what a card shows, what a drop
// does, and the panel's fields.
//
// o (the host's):
//   box, id, item   the page's element; the prefix of the board's DOM ids
//                   (id "tasks": #tasks-board, #tasks-filter, ...); of the panel's
//                   (item "task": #task-start, #task-start-lite, #task-workdir, ...)
//   noun            "task" or "ticket", for what the board says
//   client          sent with a cancel, so the host's own event isn't news to it
//   load()          the board's data, as { columns: [{ id, name, tasks[], cat? }],
//                   unsorted?: [], done?: columnId, backlog?: { total, items[] },
//                   hidden?: [{ id, name, count }], workflows, started, options }
//                   (a card is { id, title, ... })
//   cardBody(x)     the nodes on a card (the id, the title, ...); cardFoot(x) after
//                   the workflow line; cardClass(x) an extra class
//   open(id)        a click or Enter on a card
//   move(id, to, before)   what a drop does (a promise; it throws to refuse);
//                   canDrop(id, to) says no before it happens
//   ops             the column menu: { add, rename, move, remove, hide }; colOp(body)
//                   does one ({ op, id, value, index, to }) and may answer new data
//   foot(col)       the foot of a column ("+ Add a task"); railMore(col); unsortedNote
//   empty()         a node in place of the board, or null
//   head()          the host's header, drawn again whenever the data is new
//   reload()        (async) after new data, before the body is drawn
//   drawView(view)  the body for a view other than the board
//   afterRefresh(), onFilter(), escape(), newItem(), isOpen()
// Returns { s, frame, filterField, drawBody, drawBoard, card, wireCards, moveTask,
//   refresh, refreshSoon, say, stripSay, showPanel, removePanel, startSection,
//   workflowSection, wfWords, wfLine, destroy }; s is the state (data, view, filter, ...).
// Uses app.js's el, api and tell, and features.js's chip, copyable, featureHref,
// pickFolder, cancelWorkflow, cancelWorkflowText, sessionStatus, sessionInfo,
// sessionEvents, ROUTES and PHASES; models.js's modelPicker.
"use strict";

const TB_MODE_SHORT = { starting: "opening", thinking: "working", tool: "working", ask: "waiting for you", idle: "idle", lost: "not heard from", ended: "ended" };
const TB_WORKFLOW_EVENTS = new Set(["session", "milestone", "ask", "answered"]);

function makeTaskBoard(o) {
  const ops = o.ops || {};
  const railKey = "tt-" + o.id + "-rail";
  // localStorage can be refused; the backlog rail is then shown each time.
  const storedRail = () => { try { return localStorage.getItem(railKey) !== "off"; } catch { return true; } };
  const storeRail = on => { try { localStorage.setItem(railKey, on ? "on" : "off"); } catch { /* not remembered */ } };
  const s = { data: null, view: "board", filter: "", drag: null, pending: false, note: "", bad: false, noteExtra: "", menu: null,
    moved: null, refocusAdd: null, rail: storedRail(), body: null, board: null, strip: null, live: null, filterBox: null, wfFill: null };
  let panelNodes = [];
  let refreshTimer = null;
  let gone = false;

  const columnOf = id => s.data.columns.find(c => c.id === id);
  const listName = id => id === "backlog" ? "Backlog" : id === "completed" ? "Completed" : (columnOf(id) || { name: id }).name;

  // ----------------------------------------------------------- the frame

  // The page: the host's header, what goes above the board (problems), the
  // strip that says how the last change went, the body and the live region.
  function frame(head, above) {
    s.strip = el("div", { class: "run-strip", id: o.id + "-strip" });
    s.live = el("div", { class: "sr-only", "aria-live": "polite", id: o.id + "-live" });
    s.body = el("div", { class: "tasks-body" });
    o.box.replaceChildren(el("div", { class: "tasks-page", "data-view": s.view }, head, above || "", s.strip, s.body, s.live));
    drawStrip();
  }

  // The filter box: on the board it hides the cards that don't match; for the
  // lists the host asks its server.
  function filterField() {
    s.filterBox = el("input", { type: "search", id: o.id + "-filter", placeholder: "Filter (/)", "aria-label": `Filter ${o.noun}s`, value: s.filter });
    s.filterBox.addEventListener("input", () => {
      s.filter = s.filterBox.value;
      if (s.view === "board") applyFilter(); else if (o.onFilter) o.onFilter();
    });
    return s.filterBox;
  }

  function applyFilter() {
    if (!s.board) return;
    const words = s.filter.toLowerCase().split(/\s+/).filter(Boolean);
    for (const c of s.board.querySelectorAll(".tcard")) {
      c.hidden = !!words.length && !words.every(w => c.textContent.toLowerCase().includes(w));
    }
  }

  function drawBody() {
    closeMenu();
    if (s.view === "board") drawBoard(); else if (o.drawView) o.drawView(s.view);
  }

  // ----------------------------------------------------------- the board

  function drawBoard() {
    const d = s.data;
    const empty = o.empty && o.empty();
    if (empty) { s.board = null; s.body.replaceChildren(empty); return; }
    const cols = [];
    if (d.backlog && s.rail) cols.push(column({ id: "backlog", name: "Backlog", tasks: d.backlog.items, total: d.backlog.total, rail: true }));
    if ((d.unsorted || []).length) cols.push(column({ id: "unsorted", name: "Not on a column", tasks: d.unsorted, unsorted: true }));
    for (const c of d.columns) cols.push(column(c));
    if (ops.add) cols.push(addColumn());
    const tools = [];
    if (d.backlog) {
      tools.push(el("button", { type: "button", class: "trail-toggle", id: o.id + "-rail",
        title: s.rail ? "Hide the backlog beside the board" : "Show the backlog beside the board, to drag tasks from",
        onclick: () => { s.rail = !s.rail; storeRail(s.rail); drawBody(); } }, s.rail ? "‹ Hide backlog" : "Backlog ›"));
    }
    tools.push(el("span", { class: "dim small" }, "Drag a card to move it, or focus it and use Alt+arrows. Enter opens it."));
    for (const h of d.hidden || []) {
      tools.push(el("button", { type: "button", class: "thidden", "data-col": h.id, title: `Show the ${h.name} column again`,
        onclick: () => colOp({ op: "show", id: h.id }) }, `Show ${h.name} (${h.count})`));
    }
    s.board = el("div", { class: "tboard", id: o.id + "-board" }, cols);
    s.body.replaceChildren(el("div", { class: "tboard-tools" }, tools), s.board);
    wireCards(s.board, true);
    applyFilter();
  }

  function column(c) {
    const done = c.id === s.data.done;
    const total = c.total != null ? c.total : c.tasks.length;
    const head = el("div", { class: "tcol-head" },
      el("h3", {}, c.name, " ", el("span", { class: "dim tcount" }, String(total))),
      done ? el("span", { class: "dim small", title: "The last column is the done one: Clear done sends its tasks to Completed" }, "✓") : "",
      c.rail || c.unsorted || !(ops.rename || ops.move || ops.remove || ops.hide) ? "" : colMenuButton(c));
    const list = el("div", { class: "tcards", "data-list": c.id, role: "list", "aria-label": c.name }, c.tasks.map(card));
    const more = c.rail && total > c.tasks.length && o.railMore ? o.railMore(c, total) : "";
    const foot = c.unsorted ? (o.unsortedNote ? el("p", { class: "dim small" }, o.unsortedNote) : "") : (o.foot ? o.foot(c) : "");
    return el("section", { class: "tcol" + (done ? " tdone" : "") + (c.rail ? " trail" : "") + (c.unsorted ? " tunsorted" : ""), "data-col": c.id,
      "data-cat": c.cat || null }, head, list, more, foot);
  }

  // A card's workflow in a few words (route · stage · session), for its line; the
  // server sends one for each started card that isn't done (data.workflows).
  function wfWords(w) {
    if (!w || w.missing) return null;
    const sess = w.session;
    let word = "no session";
    if (sess) {
      const [, , mode, , n] = sessionStatus(sessionInfo.get(sess.tag) || sess, sessionEvents.get(sess.tag) || []);
      word = mode === "agents" ? `${n} subagent${n > 1 ? "s" : ""} working` : TB_MODE_SHORT[mode] || sess.status;
    }
    return [ROUTES[w.route] || w.route, PHASES[w.phase] || w.stage || w.phase, word];
  }
  function wfLine(id) {
    const words = wfWords(((s.data || {}).workflows || {})[id]);
    return words ? words.join(" · ") : "";
  }

  function card(x) {
    const started = x.feature || (s.data.started || {})[x.id];
    return el("div", { class: "tcard" + (o.cardClass ? " " + (o.cardClass(x) || "") : ""), tabindex: "0", role: "listitem", "data-id": x.id,
      "aria-label": `${x.id}: ${x.title}` },
      ...o.cardBody(x),
      started ? el("div", { class: "small jstarted" }, wfLine(x.id) || "Feature: " + started) : "",
      o.cardFoot ? o.cardFoot(x) : "");
  }

  // ----------------------------------------------------------- columns

  function addColumn() {
    const box = el("section", { class: "tcol tnewcol" });
    const start = () => {
      const input = el("input", { id: o.id + "-new-column", placeholder: "the column's name", "aria-label": "New column's name" });
      input.addEventListener("keydown", e => {
        if (e.key === "Escape") drawBody();
        else if (e.key === "Enter" && input.value.trim()) colOp({ op: "add", value: input.value, index: Math.max(0, s.data.columns.length - 1) });
      });
      const done = columnOf(s.data.done);
      box.replaceChildren(input, el("div", { class: "dim small" },
        done ? `Enter adds it just before ${done.name}, which stays the done column. Its ⋯ menu moves it.` : "Enter adds it."));
      input.focus();
    };
    box.append(el("button", { type: "button", id: o.id + "-add-column", onclick: start }, "+ Add column"));
    return box;
  }

  function colMenuButton(c) {
    const verbs = [ops.rename && "rename", ops.move && "move", ops.hide && "hide", ops.remove && "delete"].filter(Boolean);
    return el("button", { type: "button", class: "tcol-menu", title: `${c.name}: ${verbs.join(", ")}`, "aria-label": `${c.name} column menu`,
      "aria-haspopup": "true", onclick: e => { e.stopPropagation(); openColMenu(c, e.currentTarget); } }, "⋯");
  }

  function openColMenu(c, btn) {
    closeMenu();
    const cols = s.data.columns, i = cols.findIndex(x => x.id === c.id);
    const item = (label, fn, off) => el("button", { type: "button", role: "menuitem", disabled: !!off, onclick: fn }, label);
    const menu = el("div", { class: "tmenu", role: "menu", "aria-label": `${c.name} column` },
      ops.rename ? item("Rename", () => { closeMenu(); renameColumn(c); }) : "",
      ops.move ? item("Move left", () => colOp({ op: "move", id: c.id, index: i - 1 }), i === 0) : "",
      ops.move ? item("Move right", () => colOp({ op: "move", id: c.id, index: i + 1 }), i === cols.length - 1) : "",
      ops.hide ? item("Hide", () => colOp({ op: "hide", id: c.id })) : "",
      ops.remove ? item("Delete…", () => deleteColumn(c, menu), cols.length === 1) : "");
    menu.addEventListener("click", e => e.stopPropagation());
    btn.closest(".tcol-head").append(menu);
    s.menu = menu;
    menu.querySelector("button:not([disabled])").focus();
  }

  function closeMenu() {
    if (s.menu) { s.menu.remove(); s.menu = null; }
  }

  function renameColumn(c) {
    const h3 = s.board.querySelector(`.tcol[data-col="${CSS.escape(c.id)}"] h3`);
    const input = el("input", { class: "tcol-rename", value: c.name, "aria-label": `Rename ${c.name}` });
    input.addEventListener("keydown", e => {
      if (e.key === "Escape") drawBody();
      else if (e.key === "Enter") {
        if (input.value.trim() && input.value.trim() !== c.name) colOp({ op: "rename", id: c.id, value: input.value });
        else drawBody();
      }
    });
    input.addEventListener("blur", () => { if (input.isConnected && s.board.contains(input)) setTimeout(() => { if (input.isConnected) drawBody(); }, 150); });
    h3.replaceWith(input);
    input.focus();
    input.select();
  }

  function deleteColumn(c, menu) {
    const n = c.tasks.length;
    const to = el("select", { "aria-label": `Where its ${o.noun}s go` },
      s.data.backlog ? el("option", { value: "backlog" }, "the backlog") : "",
      s.data.columns.filter(x => x.id !== c.id).map(x => el("option", { value: x.id }, x.name)));
    menu.replaceChildren(
      el("div", { class: "small" }, n ? `Its ${n} ${o.noun}${n === 1 ? "" : "s"} go to ` : `${c.name} is empty.`, n ? to : ""),
      el("div", { class: "row" },
        el("button", { type: "button", class: "primary", onclick: () => colOp({ op: "remove", id: c.id, to: to.value }) }, `Delete ${c.name}`),
        el("button", { type: "button", onclick: closeMenu }, "Cancel")));
  }

  async function colOp(body) {
    try {
      const d = await o.colOp(body);
      if (d) s.data = d; else await loadData();
      closeMenu();
      if (o.head) o.head();
      drawBody();
    } catch (e) { stripSay(String(e.message || e), true); }
  }

  // ----------------------------------------------------------- moving cards
  // Pointer events, as the User Stories board drags its notes: a press, then 4 px
  // of movement makes it a drag (less is a click, which opens the card). The card
  // stays where it was, hidden, while a ghost follows the pointer and a
  // placeholder shows where it will land; the drop moves it there and tells the
  // host (to which list, before which card). No HTML5 drag and drop: it can't
  // be styled, and it answers neither touch nor DevTools' mouse input.

  function wireCards(root, drags) {
    const down = e => {
      if (e.button !== 0 || s.drag) return;
      const c = e.target.closest(".tcard");
      if (!c || e.target.closest("button, input, select, textarea, a")) return;
      s.drag = { id: c.dataset.id, card: c, root, drags, x0: e.clientX, y0: e.clientY, moved: false,
        from: c.parentElement.dataset.list, next: nextId(c) };
      try { root.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: no capture needed */ }
    };
    const move = e => {
      const d = s.drag;
      if (!d || d.root !== root || !d.drags) return;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
        startDrag(d);
      }
      d.x = e.clientX;
      d.y = e.clientY;
      d.ghost.style.transform = `translate(${e.clientX - d.off[0]}px, ${e.clientY - d.off[1]}px)`;
      placeAt(d.x, d.y);
      autoScroll();
    };
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", () => endDrag(false));
    root.addEventListener("pointercancel", () => endDrag(true));
    root.addEventListener("keydown", cardKeys);
  }

  function startDrag(d) {
    d.moved = true;
    const r = d.card.getBoundingClientRect();
    d.off = [d.x0 - r.left, d.y0 - r.top];
    d.ghost = d.card.cloneNode(true);
    d.ghost.classList.add("tghost");
    d.ghost.removeAttribute("tabindex");
    d.ghost.setAttribute("aria-hidden", "true");
    d.ghost.style.width = r.width + "px";
    d.place = el("div", { class: "tplace", "aria-hidden": "true" });
    d.place.style.height = r.height + "px";
    d.card.after(d.place);
    d.card.classList.add("tdragging");
    document.body.append(d.ghost);
    document.body.classList.add("tdrag-on");
  }

  const nextId = c => {
    let n = c.nextElementSibling;
    while (n && (!n.classList.contains("tcard") || n.classList.contains("tdragging"))) n = n.nextElementSibling;
    return n ? n.dataset.id : null;
  };

  // The list under the pointer (or the column it is over), and the slot in it
  // by the cards' middles. Nothing is dropped into "Not on a column", or where
  // the host says no.
  function placeAt(x, y) {
    const d = s.drag;
    const under = document.elementFromPoint(x, y);
    let list = under && under.closest(".tcards");
    if (!list) {
      const col = under && under.closest(".tcol");
      list = col && col.querySelector(".tcards");
    }
    if (!list || !d.root.contains(list) || (list.dataset.list === "unsorted" && d.from !== "unsorted")) return;
    if (o.canDrop && list.dataset.list !== d.from && !o.canDrop(d.id, list.dataset.list)) return;
    const before = [...list.querySelectorAll(".tcard:not(.tdragging)")].find(c => {
      if (c.hidden) return false;
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    if (before) { if (d.place.nextElementSibling !== before) list.insertBefore(d.place, before); }
    else if (list.lastElementChild !== d.place) list.append(d.place);
  }

  // Near an edge of a list or of the board while dragging, it scrolls.
  function autoScroll() {
    const d = s.drag;
    if (!d || d.raf) return;
    const step = () => {
      d.raf = 0;
      if (s.drag !== d) return;
      const under = document.elementFromPoint(d.x, d.y);
      const boxes = [under && under.closest(".tcards"), s.view === "board" ? s.board : o.box].filter(Boolean);
      let moved = false;
      for (const b of boxes) {
        const r = b.getBoundingClientRect(), edge = 36, speed = 14;
        const vy = d.y < r.top + edge ? -speed : d.y > r.bottom - edge ? speed : 0;
        const vx = b === s.board ? (d.x < r.left + edge ? -speed : d.x > r.right - edge ? speed : 0) : 0;
        const was = [b.scrollTop, b.scrollLeft];
        if (vy) b.scrollTop += vy;
        if (vx) b.scrollLeft += vx;
        if (b.scrollTop !== was[0] || b.scrollLeft !== was[1]) moved = true;
      }
      if (moved) {
        placeAt(d.x, d.y);
        d.raf = requestAnimationFrame(step);
      }
    };
    d.raf = requestAnimationFrame(step);
  }

  async function endDrag(cancel) {
    const d = s.drag;
    if (!d) return;
    s.drag = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    if (!d.moved) {
      if (!cancel) o.open(d.id);
      return;
    }
    d.ghost.remove();
    document.body.classList.remove("tdrag-on");
    d.card.classList.remove("tdragging");
    const list = d.place.parentElement;
    if (cancel || !list) {
      d.place.remove();
      if (s.pending) refresh();
      return;
    }
    list.insertBefore(d.card, d.place);
    d.place.remove();
    const to = list.dataset.list, before = nextId(d.card);
    if (to === d.from && before === d.next) {
      if (s.pending) refresh();
      return;
    }
    await moveTask(d.id, to, before);
  }

  async function moveTask(id, to, before, focus) {
    try {
      await o.move(id, to, before);
      s.moved = { id, to };
    } catch (e) { stripSay(`Couldn't move ${id}: ${e.message || e}`, true); }
    await refresh(focus ? id : null);
  }

  // A card in focus: Enter opens it; Alt+←/→ moves it a list along (from the
  // first column, Alt+← is the backlog); Alt+↑/↓ moves it up or down its list.
  function cardKeys(e) {
    const c = e.target.closest && e.target.closest(".tcard");
    if (!c || e.target !== c) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      o.open(c.dataset.id);
      return;
    }
    if (!e.altKey || !e.key.startsWith("Arrow") || s.view === "completed") return;
    e.preventDefault();
    const list = c.parentElement.dataset.list, id = c.dataset.id;
    const order = [...(s.data.backlog ? ["backlog"] : []), ...s.data.columns.map(x => x.id)];
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const right = e.key === "ArrowRight";
      const j = list === "unsorted" ? (right ? 1 : 0) : order.indexOf(list) + (right ? 1 : -1);
      if (j >= 0 && j < order.length && (!o.canDrop || o.canDrop(id, order[j]))) moveTask(id, order[j], null, true);
    } else {
      const sibs = [...c.parentElement.querySelectorAll(".tcard")].filter(x => !x.hidden).map(x => x.dataset.id);
      const k = sibs.indexOf(id);
      if (e.key === "ArrowUp" && k > 0) moveTask(id, list, sibs[k - 1], true);
      else if (e.key === "ArrowDown" && k < sibs.length - 1) moveTask(id, list, sibs[k + 2] || null, true);
    }
  }

  // ----------------------------------------------------------- keeping up

  async function loadData() {
    s.data = await o.load();
  }

  // The board again from the host, drawn where you were: the scroll of the
  // board and of each list, the card in focus, a half-typed quick add.
  async function refresh(focusId) {
    if (gone) return;
    let data;
    try { data = await o.load(); } catch (e) { stripSay(String(e.message || e), true); return; }
    if (gone) return;
    if (s.drag) { s.pending = true; return; }
    s.pending = false;
    s.data = data;
    if (o.reload) await o.reload();
    if (gone) return;
    const active = document.activeElement;
    const focused = focusId || (active && active.classList && active.classList.contains("tcard") ? active.dataset.id : null);
    const typing = active && active.classList && active.classList.contains("tquick") ? { list: active.dataset.list, value: active.value } : null;
    const keep = { page: o.box.scrollTop, board: s.board ? s.board.scrollLeft : 0,
      lists: Object.fromEntries([...s.body.querySelectorAll(".tcards")].map(l => [l.dataset.list, l.scrollTop])) };
    if (o.head) o.head();
    drawBody();
    o.box.scrollTop = keep.page;
    if (s.board && s.view === "board") s.board.scrollLeft = keep.board;
    for (const l of s.body.querySelectorAll(".tcards")) if (keep.lists[l.dataset.list] != null) l.scrollTop = keep.lists[l.dataset.list];
    const add = s.refocusAdd || (typing && typing.list);
    s.refocusAdd = null;
    if (add) {
      const box = s.body.querySelector(`.tquick[data-list="${CSS.escape(add)}"]`);
      if (box) { box.value = typing && typing.list === add ? typing.value : ""; box.focus(); }
    } else if (focused) {
      const c = s.body.querySelector(`.tcard[data-id="${CSS.escape(focused)}"]`);
      if (c) {
        c.focus();
        if (focusId) {
          const sibs = [...c.parentElement.querySelectorAll(".tcard")];
          say(`${focusId} in ${listName(c.parentElement.dataset.list)}, ${sibs.indexOf(c) + 1} of ${sibs.length}`);
        }
      } else if (focusId) say(`${focusId} moved to ${listName((s.moved || {}).to)}`);
    }
    if (s.wfFill) s.wfFill();
    if (o.afterRefresh) o.afterRefresh();
  }

  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(), 250);
  }

  const say = text => { if (s.live) s.live.textContent = text; };

  function stripSay(text, bad, extra) { s.note = text; s.bad = !!bad; s.noteExtra = extra || ""; drawStrip(); }

  function drawStrip() {
    if (!s.strip) return;
    if (!s.note) { s.strip.className = "run-strip"; s.strip.replaceChildren(); return; }
    s.strip.className = "run-strip on" + (s.bad ? " bad" : "");
    s.strip.replaceChildren(el("span", {}, s.note), " ", s.noteExtra || "", el("span", { class: "spacer" }),
      el("button", { type: "button", "aria-label": "Dismiss", onclick: () => { s.note = ""; drawStrip(); } }, "×"));
  }

  // ----------------------------------------------------------- the panel
  // The host builds the panel's <aside class="tpanel"> (its own head and fields);
  // here is the dimmed page behind it, one at a time, and taking it away.

  // (A host that rebuilds its panel calls removePanel first, then builds: the
  // Start section it builds registers itself to be filled again.)
  function showPanel(aside) {
    for (const n of panelNodes) n.remove();
    const shade = el("div", { class: "tshade", onclick: () => { if (o.escape) o.escape(); } });
    document.body.append(shade, aside);
    panelNodes = [shade, aside];
  }

  function removePanel() {
    for (const n of panelNodes) n.remove();
    panelNodes = [];
    s.wfFill = null;
  }

  // ----------------------------------------------------------- Start workflow

  // The workflow started from a card: which route it is on, where it stands, its
  // session, a way to its feature and its tab, and Cancel. The box is filled again
  // whenever the board is read (the status of its session moves without the
  // card's own file changing). c: { id, feature, close(), cancelled(answer) }.
  function workflowSection(c) {
    const box = el("div", { class: "start-panel", id: o.item + "-workflow" });
    const fill = () => {
      const w = ((s.data || {}).workflows || {})[c.id];
      const words = wfWords(w);
      const sess = w && w.session;
      const cancel = el("button", { type: "button", id: o.item + "-cancel-workflow", onclick: async () => {
        cancel.disabled = true;
        const r = await cancelWorkflow(c.feature, cancelWorkflowText(c.feature, { id: c.id, stays: !!c.stays },
          w ? w.ticketOnly : false, !!sess && sess.status !== "ended"), o.client);
        if (!r) { cancel.disabled = false; return; }
        await refresh();
        c.cancelled(r);
      } }, "Cancel workflow");
      box.replaceChildren(
        el("div", { class: "start-title" }, `A workflow was started from this ${o.noun}`),
        words ? el("div", { id: o.item + "-workflow-state" }, chip(words[0], "route"), " ", chip(words[1], "now"), " ",
          sess ? el("a", { href: "#workflows/" + encodeURIComponent(sess.tag), onclick: () => c.close(true), title: sess.name }, words[2])
            : el("span", { class: "dim" }, words[2]))
          : el("div", { class: "dim small" }, w && w.missing ? (w.archived ? "Its feature is archived: restore it on the Features page." : "Its feature folder is gone.") : "Where it stands shows once the board has been read."),
        el("div", { class: "start-actions" },
          el("a", { href: featureHref(c.feature), onclick: () => c.close(true) }, c.feature + " →"), " ", cancel));
    };
    fill();
    s.wfFill = fill;
    return box;
  }

  // Start workflow, and Start lite: the feature's name, the project the session
  // runs in, the folder the work is done in when that is another, the model; then
  // the host's server makes the folder, writes the card in as its Ticket, starts
  // the session and moves the card on. c: { id, label, name, project, workdir,
  // started, send(fields), close(force), after(), more(answer), moves, cancelled(answer) }.
  function startSection(c) {
    if (c.started) return workflowSection({ id: c.id, feature: c.started, close: c.close, cancelled: c.cancelled, stays: c.stays });
    const name = el("input", { id: o.item + "-feature", value: c.name, "aria-label": "Feature name" });
    let project = c.project || "";
    let workdir = c.workdir || "";
    const where = el("span", {});
    const whereWork = el("span", {});
    const go = el("button", { type: "button", class: "primary", id: o.item + "-start" }, "Start workflow");
    const goLite = el("button", { type: "button", id: o.item + "-start-lite" }, "Start lite");
    const result = el("div", { class: "start-result" });
    const picker = modelPicker(o.item + "-start-" + c.id);
    const drawWhere = () => {
      where.replaceChildren(project ? copyable(project) : el("strong", { class: "st missing" }, "no project chosen yet"));
      whereWork.replaceChildren(workdir ? copyable(workdir) : el("span", { class: "dim" }, "the project itself"));
      go.disabled = goLite.disabled = !project || !name.value.trim();
    };
    const choose = el("button", { type: "button", onclick: async () => {
      try { const p = await pickFolder(`Choose the project (repo) for ${c.id}`, project); if (p) { project = p; drawWhere(); } }
      catch (e) { alert(e.message || e); }
    } }, "Choose…");
    const chooseWork = el("button", { type: "button", id: o.item + "-workdir", onclick: async () => {
      try { const p = await pickFolder(`Choose the folder ${c.id} is worked on in`, workdir || project); if (p) { workdir = p; drawWhere(); } }
      catch (e) { alert(e.message || e); }
    } }, "Choose…");
    const clearWork = el("button", { type: "button", onclick: () => { workdir = ""; drawWhere(); } }, "Clear");
    name.addEventListener("input", drawWhere);
    const begin = mode => async () => {
      go.disabled = goLite.disabled = true;
      result.replaceChildren(el("span", { class: "dim small" }, "Making the feature and opening a session…"));
      tell("allow-foreground");
      try {
        const r = await c.send({ id: c.id, project, workdir, mode, feature: name.value.trim(), ...picker.fields() });
        if (r.ok) {
          c.close(true);
          location.hash = featureHref(r.feature); // its page shows the session as it runs
          return;
        }
        result.replaceChildren(el("p", { class: "st missing" }, "Couldn't open a terminal here. Run this yourself:"), el("pre", {}, r.said),
          c.more ? c.more(r) : "");
        if (c.after) c.after(r);
      } catch (e) {
        result.replaceChildren(el("p", { class: "st missing" }, String(e.message || e)));
        drawWhere();
      }
    };
    go.addEventListener("click", begin("full"));
    goLite.addEventListener("click", begin("lite"));
    drawWhere();
    return el("div", { class: "start-panel" },
      el("div", { class: "start-title" }, `Start a workflow from this ${o.noun}`),
      el("label", { class: "jname" }, el("span", { class: "dim small" }, "Feature folder"), name),
      el("div", { class: "project-line small" }, "Linked project (the session runs here) ", where, " ", choose),
      el("div", { class: "project-line small" }, "Works in ", whereWork, " ", chooseWork, " ", clearWork),
      picker.node,
      el("div", { class: "small dim" }, `Writes the ${o.noun} into the feature's folder as its Ticket and opens a new Claude session. `,
        "Start workflow plans it in full; Start lite writes a one-page brief for a small change. ",
        "When it works in another folder, code, git and checks are for that folder only", c.moves ? `. ${c.moves}` : "."),
      el("div", { class: "start-actions" }, go, " ", goLite),
      result);
  }

  // ----------------------------------------------------------- events and keys

  // A started card's session opening, asking, being answered or ending changes
  // what its card says; the board is read again for it (only while some card
  // has a workflow going).
  const onWorkflow = e => {
    if (!TB_WORKFLOW_EVENTS.has(e.detail.type) || !o.box.classList.contains("on")) return;
    if (Object.keys((s.data || {}).workflows || {}).length) refreshSoon();
  };

  const onKey = e => {
    if (!o.box.classList.contains("on")) return;
    if (e.key === "Escape") {
      if (s.drag && s.drag.moved) { e.preventDefault(); endDrag(true); }
      else if (s.menu) closeMenu();
      else if (panelNodes.length && o.escape) o.escape();
      return;
    }
    const typing = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
    if (typing || panelNodes.length || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "n" && o.newItem) { e.preventDefault(); o.newItem(); }
    else if (e.key === "/" && s.filterBox) { e.preventDefault(); s.filterBox.focus(); }
  };
  const onClick = e => { if (s.menu && !s.menu.contains(e.target)) closeMenu(); };

  document.addEventListener("tt-event", onWorkflow);
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", onClick);

  // The board goes (another page, another board): its listeners and panel with it.
  function destroy() {
    gone = true;
    clearTimeout(refreshTimer);
    document.removeEventListener("tt-event", onWorkflow);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("click", onClick);
    removePanel();
    closeMenu();
  }

  return { s, frame, filterField, applyFilter, drawBody, drawBoard, card, wireCards, moveTask, refresh, refreshSoon, say, stripSay, drawStrip,
    showPanel, removePanel, startSection, workflowSection, wfWords, wfLine, columnOf, listName, destroy,
    isGone: () => gone, hasPanel: () => panelNodes.length > 0 };
}
