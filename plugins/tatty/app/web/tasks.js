// Tatty's own task boards (#tasks, #tasks/<board>[/backlog|/completed][/task/<id>]):
// the production mode's tracker for a project that has none of its own. A board
// is a folder under <root>/tasks holding one markdown file per task, which the
// server reads and writes (server.py, "tasks"), so a task can be edited in
// Obsidian too and the board follows. Here: the board's columns, with cards you
// drag between them (or move with Alt+arrows), the backlog, the Completed page
// with how far you've come, and a panel to write, edit and start a workflow
// from a task.
// Uses app.js's el, api, mdNode and tell, and features.js's ago, chip, copyable,
// featureHref, pickFolder and pickRoot.
"use strict";

const tasksHref = (board, view, task) => "#tasks/" + encodeURIComponent(board) +
  (view && view !== "board" ? "/" + view : "") + (task ? "/task/" + encodeURIComponent(task) : "");

const { renderTasks, renderTaskBoard } = (() => {
  // This page's own id, sent with each change: the server repeats it in the
  // "tasks" event, so a change this page made isn't news to it.
  const client = Math.random().toString(36).slice(2, 10);
  const send = (path, body) => api(path, { ...body, client });
  const enc = encodeURIComponent;
  let listBox = null; // the list of boards, while it is on screen
  let t = null;       // the board on screen: { name, box, view, data, lists, filter, drag, open, ... }
  let panelNodes = []; // the task panel and its shade, when open

  // localStorage can be refused; the backlog rail is then shown each time.
  const storedRail = () => { try { return localStorage.getItem("tt-tasks-rail") !== "off"; } catch { return true; } };
  const storeRail = on => { try { localStorage.setItem("tt-tasks-rail", on ? "on" : "off"); } catch { /* not remembered */ } };

  // ----------------------------------------------------------- the list of boards

  async function renderTasks(box) {
    listBox = box;
    t = null;
    removePanel();
    closeSidePanel();
    box.replaceChildren(el("p", { class: "dim pad" }, "Looking for boards…"));
    let d;
    try { d = await api("/api/tasks"); } catch (e) { box.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e))); return; }
    if (listBox !== box) return;
    const newBoard = () => openSidePanel("New board", msg => newBoardForm(d, msg));
    const head = el("div", { class: "home-head" },
      el("div", {}, el("h2", {}, "Tasks"),
        el("div", { class: "dim small root-line" }, "Boards in ", copyable(d.folder))),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "primary", id: "new-task-board", disabled: !d.isSet, onclick: newBoard }, "New board…"),
        el("button", { type: "button", onclick: () => renderTasks(box) }, "Refresh")));
    const warn = !d.isSet ? el("div", { class: "card toolbox-missing" }, el("strong", {}, "Choose Tatty's root folder first. "),
      "Task boards live in its tasks folder. ", el("button", { type: "button", onclick: () => pickRoot(d) }, "Choose…")) : "";
    const cards = d.boards.map(x => el("a", { class: "fcard board-card task-board-card", href: tasksHref(x.name), "data-board": x.name },
      el("div", { class: "fcard-top" }, el("strong", {}, x.name), x.thisWeek ? chip(`${x.thisWeek} done this week`, "done") : ""),
      el("div", {}, chip(`${x.board} on the board`, x.board ? "now" : "todo"), chip(`${x.backlog} in the backlog`, "todo"),
        chip(`${x.completed} completed`, x.completed ? "done" : "todo")),
      el("div", { class: "fcard-foot dim small" }, x.columns.join(" → "), ` · updated ${ago(x.updated)}`,
        x.problems ? el("span", { class: "st missing" }, ` · ${x.problems} file${x.problems === 1 ? "" : "s"} to look at`) : "")));
    box.replaceChildren(warn, head, cards.length ? el("div", { class: "fgrid" }, cards)
      : el("div", { class: "card empty-state" }, el("p", {}, "No task boards yet. ", el("strong", {}, "New board…"),
        " makes one for a project: a backlog, a board with the columns you choose, and a page of everything you've completed."),
        d.isSet ? el("button", { type: "button", class: "primary", onclick: newBoard }, "New board…") : ""));
  }

  function newBoardForm(d, msg) {
    const name = el("input", { id: "task-board-name", placeholder: "a name for the board, e.g. My Game", "aria-label": "Board name" });
    const cols = el("input", { id: "task-board-columns", value: d.columns.join(", "), "aria-label": "Columns" });
    const go = el("button", { type: "submit", class: "primary" }, "Create board");
    return el("form", { class: "card new-feature", id: "new-task-board-form", onsubmit: async e => {
      e.preventDefault();
      go.disabled = true;
      try {
        const r = await send("/api/tasks/new-board", { name: name.value, columns: cols.value.split(",").map(s => s.trim()).filter(Boolean) });
        location.hash = tasksHref(r.name);
      } catch (err) {
        msg.className = "home-note small st missing";
        msg.textContent = String(err.message || err);
        go.disabled = false;
      }
    } },
      el("strong", {}, "New board"),
      el("label", { class: "tfield" }, el("span", { class: "dim small" }, "Name"), name),
      el("label", { class: "tfield" }, el("span", { class: "dim small" }, "Columns, left to right (the last one is for done)"), cols),
      el("div", { class: "row" }, go),
      el("p", { class: "dim small" }, "Makes ", el("code", {}, d.folder + "/<name>"),
        ": a board.json, and an items folder with one markdown file per task, which you can edit in Obsidian too."));
  }

  // ----------------------------------------------------------- one board

  async function renderTaskBoard(box, name, view, task) {
    listBox = null;
    view = view || "board";
    if (t && t.name === name && t.box === box && t.data) {
      if (t.view !== view) {
        t.view = view;
        drawFrame();
      }
      openTask(task);
      return;
    }
    removePanel();
    box.replaceChildren(el("p", { class: "dim pad" }, "Opening the board…"));
    let data;
    try { data = await api("/api/tasks/board?name=" + enc(name)); } catch (e) {
      t = null;
      box.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e), " ", el("a", { href: "#tasks" }, "All boards")));
      return;
    }
    t = { name, box, view, data, lists: {}, filter: "", drag: null, pending: false, open: null, note: "", bad: false, rail: storedRail() };
    drawFrame();
    openTask(task);
  }

  const columnOf = id => t.data.columns.find(c => c.id === id);
  const listName = id => id === "backlog" ? "Backlog" : id === "completed" ? "Completed" : (columnOf(id) || { name: id }).name;
  // Which list a status puts a task in, as the server says (task_place).
  function placeOf(status) {
    const s = (status || "").trim().replace(/\s+/g, " ").toLowerCase();
    if (!s || s === "backlog") return "backlog";
    if (s === "completed") return "completed";
    const c = t.data.columns.find(x => x.name.toLowerCase() === s);
    return c ? c.id : "unsorted";
  }
  const prioClass = p => /highest|critical|urgent|blocker/i.test(p) ? "bad" : /high/i.test(p) ? "now" : "todo";

  // The bar, the tabs and the strip; the body below is drawBody's.
  function drawFrame() {
    const d = t.data;
    const tab = (v, label) => el("a", { class: "ttab" + (t.view === v ? " on" : ""), href: tasksHref(t.name, v), "data-view": v,
      "aria-current": t.view === v ? "page" : null }, label);
    t.tabs = { backlog: tab("backlog", ""), completed: tab("completed", "") };
    t.clear = el("button", { type: "button", id: "tasks-clear", onclick: clearDone });
    t.filterBox = el("input", { type: "search", id: "tasks-filter", placeholder: "Filter (/)", "aria-label": "Filter tasks", value: t.filter });
    t.filterBox.addEventListener("input", () => {
      t.filter = t.filterBox.value;
      if (t.view === "board") applyFilter(); else loadListSoon();
    });
    const head = el("div", { class: "board-bar tasks-bar" },
      el("a", { href: "#tasks" }, "← All boards"), el("h2", {}, t.name),
      el("nav", { class: "ttabs", "aria-label": "Lists" }, tab("board", "Board"), t.tabs.backlog, t.tabs.completed),
      el("span", { class: "spacer" }), t.filterBox,
      el("button", { type: "button", class: "primary", id: "tasks-new", title: "A new task (n)",
        onclick: () => { location.hash = tasksHref(t.name, t.view, "new"); } }, "+ New task"),
      t.view === "board" ? t.clear : "");
    t.problems = el("div", {});
    t.strip = el("div", { class: "run-strip", id: "tasks-strip" });
    t.live = el("div", { class: "sr-only", "aria-live": "polite", id: "tasks-live" });
    t.body = el("div", { class: "tasks-body" });
    t.box.replaceChildren(el("div", { class: "tasks-page", "data-view": t.view }, head, t.problems, t.strip, t.body, t.live));
    drawHead();
    drawStrip();
    drawBody();
  }

  // The counts in the bar, and the problems, kept current without rebuilding
  // the bar (which would lose what is being typed in the filter).
  function drawHead() {
    const d = t.data;
    t.tabs.backlog.textContent = `Backlog (${d.backlog.total})`;
    t.tabs.completed.textContent = `Completed (${d.completed.total})`;
    const done = columnOf(d.done);
    const n = done ? done.tasks.length : 0;
    t.clear.textContent = `Clear done (${n})`;
    t.clear.disabled = !n;
    t.clear.title = done ? `Send everything in ${done.name} to Completed` : "";
    t.problems.replaceChildren(d.problems.length ? problemsNote(d.problems) : "");
  }

  // Files Tatty can't place: no ID, an ID another file has, a name and title
  // that disagree, a board.json that won't read. Never fixed silently.
  function problemsNote(problems) {
    const fixable = p => /no task ID|is .*'s too|its name says/.test(p.problem) && p.file !== "board.json";
    return el("details", { class: "card board-problems tproblems", open: t.data.broken },
      el("summary", { class: "st missing" }, `${problems.length} file${problems.length === 1 ? "" : "s"} to look at`),
      t.data.broken ? el("p", { class: "small" }, "Changes are refused until board.json reads again, so nothing you're fixing is written over.") : "",
      el("ul", { class: "small" }, problems.map(p => el("li", {}, el("code", {}, p.file), " ", p.problem, " ",
        fixable(p) ? el("button", { type: "button", class: "tadopt", onclick: () => adopt(p.file) }, "Give it an ID of its own") : ""))));
  }

  async function adopt(file) {
    try {
      const r = await send("/api/tasks/adopt", { name: t.name, file });
      say(`${file} is ${r.task.id} now`);
    } catch (e) { stripSay(String(e.message || e), true); }
    refresh();
  }

  function drawBody() {
    closeMenu();
    if (t.view === "board") drawBoardView();
    else if (!t.lists[t.view]) {
      t.body.replaceChildren(el("p", { class: "dim pad" }, "Reading the list…"));
      loadList(t.view).then(() => { if (t && t.lists[t.view]) drawBody(); });
    } else if (t.view === "backlog") drawBacklog();
    else drawCompleted();
  }

  // ----------------------------------------------------------- the board view

  function drawBoardView() {
    const d = t.data;
    const cols = [];
    if (t.rail) cols.push(column({ id: "backlog", name: "Backlog", tasks: d.backlog.items, total: d.backlog.total, rail: true }));
    if (d.unsorted.length) cols.push(column({ id: "unsorted", name: "Not on a column", tasks: d.unsorted, unsorted: true }));
    for (const c of d.columns) cols.push(column(c));
    cols.push(addColumn());
    const rail = el("button", { type: "button", class: "trail-toggle", id: "tasks-rail",
      title: t.rail ? "Hide the backlog beside the board" : "Show the backlog beside the board, to drag tasks from",
      onclick: () => { t.rail = !t.rail; storeRail(t.rail); drawBody(); } }, t.rail ? "‹ Hide backlog" : "Backlog ›");
    t.board = el("div", { class: "tboard", id: "tasks-board" }, cols);
    t.body.replaceChildren(el("div", { class: "tboard-tools" }, rail,
      el("span", { class: "dim small" }, "Drag a card to move it, or focus it and use Alt+arrows. Enter opens it.")), t.board);
    wireCards(t.board, true);
    applyFilter();
  }

  function column(c) {
    const done = c.id === t.data.done;
    const total = c.total != null ? c.total : c.tasks.length;
    const head = el("div", { class: "tcol-head" },
      el("h3", {}, c.name, " ", el("span", { class: "dim tcount" }, String(total))),
      done ? el("span", { class: "dim small", title: "The last column is the done one: Clear done sends its tasks to Completed" }, "✓") : "",
      c.rail || c.unsorted ? "" : colMenuButton(c));
    const list = el("div", { class: "tcards", "data-list": c.id, role: "list", "aria-label": c.name }, c.tasks.map(card));
    const more = c.rail && total > c.tasks.length
      ? el("a", { class: "small tall", href: tasksHref(t.name, "backlog") }, `All ${total} in the backlog →`) : "";
    const foot = c.unsorted
      ? el("p", { class: "dim small" }, "Their Status names no column. Drag one onto a column, or name a column to match.")
      : quickAdd(c.id);
    return el("section", { class: "tcol" + (done ? " tdone" : "") + (c.rail ? " trail" : "") + (c.unsorted ? " tunsorted" : ""), "data-col": c.id },
      head, list, more, foot);
  }

  // A task's workflow in a few words (route · stage · session), for its card; the
  // server sends one for each started task that isn't done (t.data.workflows).
  const MODE_SHORT = { starting: "opening", thinking: "working", tool: "working", ask: "waiting for you", idle: "idle", lost: "not heard from", ended: "ended" };
  function wfWords(w) {
    if (!w || w.missing) return null;
    const s = w.session;
    let word = "no session";
    if (s) {
      const [, , mode, , n] = sessionStatus(sessionInfo.get(s.tag) || s, sessionEvents.get(s.tag) || []);
      word = mode === "agents" ? `${n} subagent${n > 1 ? "s" : ""} working` : MODE_SHORT[mode] || s.status;
    }
    return [ROUTES[w.route] || w.route, PHASES[w.phase] || w.stage || w.phase, word];
  }
  function wfLine(id) {
    const words = wfWords(((t.data || {}).workflows || {})[id]);
    return words ? words.join(" · ") : "";
  }

  function card(x) {
    const started = x.feature || (t.data.started || {})[x.id];
    return el("div", { class: "tcard", tabindex: "0", role: "listitem", "data-id": x.id, "aria-label": `${x.id}: ${x.title}` },
      el("div", { class: "tcard-top" }, el("span", { class: "jkey" }, x.id), x.priority ? chip(x.priority, prioClass(x.priority)) : ""),
      el("div", { class: "tsum" }, x.title),
      x.labels.length ? el("div", { class: "tlabels" }, x.labels.map(l => el("span", { class: "tlabel" }, l))) : "",
      started ? el("div", { class: "small jstarted" }, wfLine(x.id) || "Feature: " + started) : "",
      x.problems.length ? el("div", { class: "small st missing" }, x.problems[0]) : "");
  }

  // The board's filter hides the cards that don't match (the lists ask the server).
  function applyFilter() {
    const words = t.filter.toLowerCase().split(/\s+/).filter(Boolean);
    for (const c of t.board.querySelectorAll(".tcard")) {
      c.hidden = !!words.length && !words.every(w => c.textContent.toLowerCase().includes(w));
    }
  }

  // "+ Add a task" at the foot of a list: Enter makes it there, and the box is
  // ready for the next one.
  function quickAdd(to) {
    const input = el("input", { class: "tquick", "data-list": to, placeholder: "+ Add a task", "aria-label": `Add a task to ${listName(to)}` });
    input.addEventListener("keydown", async e => {
      if (e.key === "Escape") { input.value = ""; input.blur(); return; }
      if (e.key !== "Enter" || !input.value.trim()) return;
      e.preventDefault();
      input.disabled = true;
      try {
        const r = await send("/api/tasks/create", { name: t.name, title: input.value, to });
        say(`${r.task.id} added to ${listName(to)}`);
        t.refocusAdd = to;
      } catch (err) { stripSay(String(err.message || err), true); }
      await refresh();
    });
    return input;
  }

  function addColumn() {
    const box = el("section", { class: "tcol tnewcol" });
    const start = () => {
      const input = el("input", { id: "tasks-new-column", placeholder: "the column's name", "aria-label": "New column's name" });
      input.addEventListener("keydown", e => {
        if (e.key === "Escape") drawBody();
        else if (e.key === "Enter" && input.value.trim()) colOp({ op: "add", value: input.value, index: Math.max(0, t.data.columns.length - 1) });
      });
      const done = columnOf(t.data.done);
      box.replaceChildren(input, el("div", { class: "dim small" },
        done ? `Enter adds it just before ${done.name}, which stays the done column. Its ⋯ menu moves it.` : "Enter adds it."));
      input.focus();
    };
    box.append(el("button", { type: "button", id: "tasks-add-column", onclick: start }, "+ Add column"));
    return box;
  }

  // ----------------------------------------------------------- columns

  function colMenuButton(c) {
    return el("button", { type: "button", class: "tcol-menu", title: `${c.name}: rename, move or delete`, "aria-label": `${c.name} column menu`,
      "aria-haspopup": "true", onclick: e => { e.stopPropagation(); openColMenu(c, e.currentTarget); } }, "⋯");
  }

  function openColMenu(c, btn) {
    closeMenu();
    const cols = t.data.columns, i = cols.findIndex(x => x.id === c.id);
    const item = (label, fn, off) => el("button", { type: "button", role: "menuitem", disabled: !!off, onclick: fn }, label);
    const menu = el("div", { class: "tmenu", role: "menu", "aria-label": `${c.name} column` },
      item("Rename", () => { closeMenu(); renameColumn(c); }),
      item("Move left", () => colOp({ op: "move", id: c.id, index: i - 1 }), i === 0),
      item("Move right", () => colOp({ op: "move", id: c.id, index: i + 1 }), i === cols.length - 1),
      item("Delete…", () => deleteColumn(c, menu), cols.length === 1));
    menu.addEventListener("click", e => e.stopPropagation());
    btn.closest(".tcol-head").append(menu);
    t.menu = menu;
    menu.querySelector("button:not([disabled])").focus();
  }

  function closeMenu() {
    if (t && t.menu) { t.menu.remove(); t.menu = null; }
  }

  function renameColumn(c) {
    const h3 = t.board.querySelector(`.tcol[data-col="${CSS.escape(c.id)}"] h3`);
    const input = el("input", { class: "tcol-rename", value: c.name, "aria-label": `Rename ${c.name}` });
    input.addEventListener("keydown", e => {
      if (e.key === "Escape") drawBody();
      else if (e.key === "Enter") {
        if (input.value.trim() && input.value.trim() !== c.name) colOp({ op: "rename", id: c.id, value: input.value });
        else drawBody();
      }
    });
    input.addEventListener("blur", () => { if (input.isConnected && t.board.contains(input)) setTimeout(() => { if (input.isConnected) drawBody(); }, 150); });
    h3.replaceWith(input);
    input.focus();
    input.select();
  }

  function deleteColumn(c, menu) {
    const n = c.tasks.length;
    const to = el("select", { "aria-label": "Where its tasks go" },
      el("option", { value: "backlog" }, "the backlog"),
      t.data.columns.filter(x => x.id !== c.id).map(x => el("option", { value: x.id }, x.name)));
    menu.replaceChildren(
      el("div", { class: "small" }, n ? `Its ${n} task${n === 1 ? "" : "s"} go to ` : `${c.name} is empty.`, n ? to : ""),
      el("div", { class: "row" },
        el("button", { type: "button", class: "primary", onclick: () => colOp({ op: "remove", id: c.id, to: to.value }) }, `Delete ${c.name}`),
        el("button", { type: "button", onclick: closeMenu }, "Cancel")));
  }

  async function colOp(body) {
    try {
      t.data = await send("/api/tasks/columns", { name: t.name, ...body });
      closeMenu();
      drawHead();
      drawBody();
    } catch (e) { stripSay(String(e.message || e), true); }
  }

  async function clearDone() {
    const done = columnOf(t.data.done);
    t.clear.disabled = true;
    try {
      const r = await send("/api/tasks/clear", { name: t.name });
      say(`${r.cleared} task${r.cleared === 1 ? "" : "s"} moved to Completed`);
      stripSay(r.cleared ? `${r.cleared} task${r.cleared === 1 ? "" : "s"} from ${done ? done.name : "done"} went to Completed. Well done!` : "Nothing to clear.", false,
        r.cleared ? el("a", { href: tasksHref(t.name, "completed") }, "See how far you've come →") : "");
    } catch (e) { stripSay(String(e.message || e), true); }
    await refresh();
  }

  // ----------------------------------------------------------- moving cards
  // Pointer events, as the User Stories board drags its notes: a press, then 4 px
  // of movement makes it a drag (less is a click, which opens the task). The card
  // stays where it was, hidden, while a ghost follows the pointer and a
  // placeholder shows where it will land; the drop moves it there and tells the
  // server (to which list, before which card). No HTML5 drag and drop: it can't
  // be styled, and it answers neither touch nor DevTools' mouse input.

  function wireCards(root, drags) {
    root.addEventListener("pointerdown", e => {
      if (e.button !== 0 || t.drag) return;
      const c = e.target.closest(".tcard");
      if (!c || e.target.closest("button, input, select, textarea, a")) return;
      t.drag = { id: c.dataset.id, card: c, root, drags, x0: e.clientX, y0: e.clientY, moved: false,
        from: c.parentElement.dataset.list, next: nextId(c) };
      try { root.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: no capture needed */ }
    });
    root.addEventListener("pointermove", e => {
      const d = t && t.drag;
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
    });
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
  // by the cards' middles. Nothing is dropped into "Not on a column".
  function placeAt(x, y) {
    const d = t.drag;
    const under = document.elementFromPoint(x, y);
    let list = under && under.closest(".tcards");
    if (!list) {
      const col = under && under.closest(".tcol");
      list = col && col.querySelector(".tcards");
    }
    if (!list || !d.root.contains(list) || (list.dataset.list === "unsorted" && d.from !== "unsorted")) return;
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
    const d = t.drag;
    if (!d || d.raf) return;
    const step = () => {
      d.raf = 0;
      if (!t || t.drag !== d) return;
      const under = document.elementFromPoint(d.x, d.y);
      const boxes = [under && under.closest(".tcards"), t.view === "board" ? t.board : t.box].filter(Boolean);
      let moved = false;
      for (const s of boxes) {
        const r = s.getBoundingClientRect(), edge = 36, speed = 14;
        const vy = d.y < r.top + edge ? -speed : d.y > r.bottom - edge ? speed : 0;
        const vx = s === t.board ? (d.x < r.left + edge ? -speed : d.x > r.right - edge ? speed : 0) : 0;
        const was = [s.scrollTop, s.scrollLeft];
        if (vy) s.scrollTop += vy;
        if (vx) s.scrollLeft += vx;
        if (s.scrollTop !== was[0] || s.scrollLeft !== was[1]) moved = true;
      }
      if (moved) {
        placeAt(d.x, d.y);
        d.raf = requestAnimationFrame(step);
      }
    };
    d.raf = requestAnimationFrame(step);
  }

  async function endDrag(cancel) {
    const d = t && t.drag;
    if (!d) return;
    t.drag = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    if (!d.moved) {
      if (!cancel) location.hash = tasksHref(t.name, t.view, d.id);
      return;
    }
    d.ghost.remove();
    document.body.classList.remove("tdrag-on");
    d.card.classList.remove("tdragging");
    const list = d.place.parentElement;
    if (cancel || !list) {
      d.place.remove();
      if (t.pending) refresh();
      return;
    }
    list.insertBefore(d.card, d.place);
    d.place.remove();
    const to = list.dataset.list, before = nextId(d.card);
    if (to === d.from && before === d.next) {
      if (t.pending) refresh();
      return;
    }
    await moveTask(d.id, to, before);
  }

  async function moveTask(id, to, before, focus) {
    try {
      await send("/api/tasks/move", { name: t.name, id, to, before });
      t.moved = { id, to };
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
      location.hash = tasksHref(t.name, t.view, c.dataset.id);
      return;
    }
    if (!e.altKey || !e.key.startsWith("Arrow") || t.view === "completed") return;
    e.preventDefault();
    const list = c.parentElement.dataset.list, id = c.dataset.id;
    const order = ["backlog", ...t.data.columns.map(x => x.id)];
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const right = e.key === "ArrowRight";
      const j = list === "unsorted" ? (right ? 1 : 0) : order.indexOf(list) + (right ? 1 : -1);
      if (j >= 0 && j < order.length) moveTask(id, order[j], null, true);
    } else {
      const sibs = [...c.parentElement.querySelectorAll(".tcard")].filter(x => !x.hidden).map(x => x.dataset.id);
      const k = sibs.indexOf(id);
      if (e.key === "ArrowUp" && k > 0) moveTask(id, list, sibs[k - 1], true);
      else if (e.key === "ArrowDown" && k < sibs.length - 1) moveTask(id, list, sibs[k + 2] || null, true);
    }
  }

  // ----------------------------------------------------------- the backlog

  function loadListSoon() {
    clearTimeout(loadListSoon.timer);
    loadListSoon.timer = setTimeout(async () => {
      if (!t || t.view === "board") return;
      await loadList(t.view);
      if (t && t.view !== "board") drawBody();
    }, 250);
  }

  // A list from the server: the first page, or as many as are on screen already.
  async function loadList(which, keep) {
    const cur = t.lists[which];
    const limit = keep && cur ? Math.max(100, cur.items.length) : 100;
    try {
      t.lists[which] = await api(`/api/tasks/list?name=${enc(t.name)}&in=${which}&offset=0&limit=${limit}&q=${enc(t.filter.trim())}`);
    } catch (e) { stripSay(String(e.message || e), true); }
  }

  async function loadMore(which) {
    const cur = t.lists[which];
    try {
      const r = await api(`/api/tasks/list?name=${enc(t.name)}&in=${which}&offset=${cur.items.length}&limit=100&q=${enc(t.filter.trim())}`);
      cur.items.push(...r.items);
      cur.total = r.total;
    } catch (e) { stripSay(String(e.message || e), true); }
    const keep = t.box.scrollTop;
    drawBody();
    t.box.scrollTop = keep;
  }

  // The rest of a long list, a page at a time, when its end comes into view
  // (and on a click, for anything without IntersectionObserver).
  function moreRow(which, left) {
    const btn = el("button", { type: "button", class: "tmore-btn", onclick: () => loadMore(which) }, `Show ${Math.min(100, left)} more`);
    const row = el("div", { class: "tmore dim small" }, `${left} more… `, btn);
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(es => {
        if (es.some(x => x.isIntersecting)) { io.disconnect(); loadMore(which); }
      }, { root: t.box });
      io.observe(row);
    }
    return row;
  }

  function drawBacklog() {
    const L = t.lists.backlog, first = t.data.columns[0];
    const rows = el("div", { class: "tcards tlist", "data-list": "backlog", role: "list", "aria-label": "Backlog" },
      L.items.map(x => {
        const r = card(x);
        r.classList.add("trow");
        r.append(el("div", { class: "trow-acts" },
          el("span", { class: "dim small" }, x.created),
          first ? el("button", { type: "button", title: `Onto the board, in ${first.name}`, onclick: () => moveTask(x.id, first.id, null) }, `→ ${first.name}`) : "",
          el("button", { type: "button", title: "To the top of the backlog", onclick: () => moveTask(x.id, "backlog", L.items[0] && L.items[0].id !== x.id ? L.items[0].id : null) }, "Top")));
        return r;
      }));
    const left = L.total - L.items.length;
    t.body.replaceChildren(el("div", { class: "tlist-page" },
      el("p", { class: "dim small" }, L.total ? `${L.total} task${L.total === 1 ? "" : "s"} waiting, in the order you'll take them. Drag to reorder (or Alt+↑/↓), and Alt+→ puts one on the board.`
        : ""),
      quickAdd("backlog"),
      L.items.length ? rows : el("div", { class: "empty-state" }, el("p", {}, t.filter.trim() ? "Nothing in the backlog matches." : "The backlog is empty. Add a task above, or press + New task.")),
      left > 0 ? moreRow("backlog", left) : ""));
    wireCards(rows, !t.filter.trim()); // a filtered list can't say where a dropped card goes among the hidden ones
  }

  // ----------------------------------------------------------- completed

  const day = s => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ""); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
  const mondayOf = d => { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };
  const shortDate = d => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });

  function groupOf(done) {
    const d = day(done);
    if (!d) return "Undated";
    const weeks = Math.round((mondayOf(new Date()) - mondayOf(d)) / (7 * 864e5));
    if (weeks <= 0) return "This week";
    if (weeks === 1) return "Last week";
    if (weeks < 8) return `Week of ${shortDate(mondayOf(d))}`;
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  // What the page says about how it's going; always there, whatever the motion setting.
  function cheer(s) {
    if (!s.total) return "Nothing completed yet. Finish a task on the board and press Clear done: it lands here.";
    if (s.thisWeek && s.thisWeek >= s.bestWeek && s.total > s.thisWeek) return `🎉 ${s.thisWeek} done this week: your best week yet!`;
    if (s.thisWeek) return `${s.thisWeek} done this week. ` + (s.streakWeeks > 1 ? `That's ${s.streakWeeks} weeks in a row.` : "Keep it going!");
    return `${s.total} done so far. Your best week was ${s.bestWeek}.` + (s.streakWeeks ? ` A ${s.streakWeeks}-week streak is still alive.` : "");
  }

  function drawCompleted() {
    const L = t.lists.completed, s = L.stats;
    const tile = (n, label) => el("div", { class: "tstat" }, el("strong", {}, String(n)), el("span", { class: "dim small" }, label));
    const max = Math.max(1, ...s.weeks.map(w => w.count));
    const bars = el("div", { class: "tweeks", role: "img", id: "tasks-weeks",
      "aria-label": "Tasks completed in each of the last 12 weeks: " + s.weeks.map(w => w.count).join(", ") },
      s.weeks.map(w => {
        const bar = el("span", { class: "tbar" + (w.count ? "" : " zero"), title: `${w.count} in the week of ${shortDate(day(w.start))}` });
        bar.style.height = Math.round(3 + 57 * w.count / max) + "px"; // (through the DOM: the CSP refuses inline styles)
        return el("div", { class: "tweek" }, el("span", { class: "tbar-n small" }, w.count ? String(w.count) : ""), bar,
          el("span", { class: "dim tiny" }, shortDate(day(w.start))));
      }));
    const first = t.data.columns[0];
    const list = el("div", { class: "tdone-list" });
    let group = "", ul = null;
    for (const x of L.items) {
      const g = groupOf(x.done);
      if (g !== group) {
        group = g;
        ul = el("div", { class: "tcards tlist", role: "list", "aria-label": g });
        list.append(el("h4", { class: "tgroup" }, g), ul);
      }
      const r = card(x);
      r.classList.add("trow");
      r.append(el("div", { class: "trow-acts" }, el("span", { class: "dim small" }, x.done),
        first ? el("button", { type: "button", title: `Back onto the board, in ${first.name}`, onclick: () => moveTask(x.id, first.id, null) }, "Reopen") : ""));
      ul.append(r);
    }
    const left = L.total - L.items.length;
    t.body.replaceChildren(el("div", { class: "tdone-page" },
      el("div", { class: "tdone-head" },
        el("div", { class: "tbig" }, el("strong", { id: "tasks-total" }, String(s.total)), el("span", {}, s.total === 1 ? " task completed" : " tasks completed")),
        el("div", { class: "tstats" }, tile(s.thisWeek, "this week"), tile(s.thisMonth, "this month"), tile(s.bestWeek, "best week"),
          tile(s.streakWeeks, s.streakWeeks === 1 ? "week streak" : "weeks streak"))),
      el("p", { class: "tcheer", id: "tasks-cheer" }, cheer(s)),
      bars,
      L.items.length ? list : (t.filter.trim() && s.total ? el("p", { class: "dim" }, "Nothing completed matches.") : ""),
      left > 0 ? moreRow("completed", left) : ""));
    wireCards(list, false); // open with a click or Enter; Reopen to bring one back
  }

  // ----------------------------------------------------------- keeping up

  // The board again from the server, drawn where you were: the scroll of the
  // board and of each list, the card in focus, a half-typed quick add.
  async function refresh(focusId) {
    if (!t) return;
    const me = t;
    let data;
    try { data = await api("/api/tasks/board?name=" + enc(t.name)); } catch (e) { stripSay(String(e.message || e), true); return; }
    if (t !== me) return;
    if (t.drag) { t.pending = true; return; }
    t.pending = false;
    t.data = data;
    // the list on screen is read again as far as it was shown; the others when next shown
    for (const k of Object.keys(t.lists)) if (k !== t.view) delete t.lists[k];
    if (t.view !== "board") await loadList(t.view, true);
    if (t !== me) return;
    const active = document.activeElement;
    const focused = focusId || (active && active.classList && active.classList.contains("tcard") ? active.dataset.id : null);
    const typing = active && active.classList && active.classList.contains("tquick") ? { list: active.dataset.list, value: active.value } : null;
    const keep = { page: t.box.scrollTop, board: t.board ? t.board.scrollLeft : 0,
      lists: Object.fromEntries([...t.body.querySelectorAll(".tcards")].map(l => [l.dataset.list, l.scrollTop])) };
    drawHead();
    drawBody();
    t.box.scrollTop = keep.page;
    if (t.board && t.view === "board") t.board.scrollLeft = keep.board;
    for (const l of t.body.querySelectorAll(".tcards")) if (keep.lists[l.dataset.list] != null) l.scrollTop = keep.lists[l.dataset.list];
    const add = t.refocusAdd || (typing && typing.list);
    t.refocusAdd = null;
    if (add) {
      const box = t.body.querySelector(`.tquick[data-list="${CSS.escape(add)}"]`);
      if (box) { box.value = typing && typing.list === add ? typing.value : ""; box.focus(); }
    } else if (focused) {
      const c = t.body.querySelector(`.tcard[data-id="${CSS.escape(focused)}"]`);
      if (c) {
        c.focus();
        if (focusId) {
          const sibs = [...c.parentElement.querySelectorAll(".tcard")];
          say(`${focusId} in ${listName(c.parentElement.dataset.list)}, ${sibs.indexOf(c) + 1} of ${sibs.length}`);
        }
      } else if (focusId) say(`${focusId} moved to ${listName((t.moved || {}).to)}`);
    }
    if (t.open && t.open.wfFill) t.open.wfFill();
    if (t.open && t.open.id !== "new") panelChanged();
  }

  let refreshTimer = null;
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(), 250);
  }

  const say = text => { if (t && t.live) t.live.textContent = text; };

  function stripSay(text, bad, extra) { t.note = text; t.bad = !!bad; t.noteExtra = extra || ""; drawStrip(); }

  function drawStrip() {
    if (!t.note) { t.strip.className = "run-strip"; t.strip.replaceChildren(); return; }
    t.strip.className = "run-strip on" + (t.bad ? " bad" : "");
    t.strip.replaceChildren(el("span", {}, t.note), " ", t.noteExtra || "", el("span", { class: "spacer" }),
      el("button", { type: "button", "aria-label": "Dismiss", onclick: () => { t.note = ""; drawStrip(); } }, "×"));
  }

  // ----------------------------------------------------------- the task panel

  async function openTask(id) {
    if (!id) { closePanel(true); return; }
    if (t.open && t.open.id === id && panelNodes.length) return;
    if (id === "new") {
      t.open = { id: "new", d: { id: "", title: "", status: "", priority: "", labels: [], description: "", extra: [], sections: [] }, write: true };
      drawPanel();
      return;
    }
    let d;
    try { d = await api(`/api/tasks/task?name=${enc(t.name)}&id=${enc(id)}`); } catch (e) {
      stripSay(`Can't open ${id}: ${e.message || e}`, true);
      history.replaceState(null, "", tasksHref(t.name, t.view));
      return;
    }
    if (!t) return;
    t.open = { id: d.id, d, write: !d.description };
    drawPanel();
  }

  function removePanel() {
    for (const n of panelNodes) n.remove();
    panelNodes = [];
  }

  function closePanel(force) {
    if (!t || !t.open) { removePanel(); return true; }
    if (!force && dirty() && !confirm("Discard your changes to this task?")) return false;
    t.open = null;
    removePanel();
    if (location.hash.includes("/task/")) history.replaceState(null, "", tasksHref(t.name, t.view));
    return true;
  }

  const labelsText = v => v.split(",").map(s => s.trim()).filter(Boolean).join(", ");

  function dirty() {
    const o = t && t.open;
    if (!o || !o.f) return false;
    if (o.raw) return o.rawBox.value.replace(/\r/g, "") !== o.d.text;
    const f = o.f, d = o.d;
    return f.title.value.trim() !== d.title || f.priority.value !== d.priority || labelsText(f.labels.value) !== d.labels.join(", ")
      || f.desc.value.trim() !== (d.description || "").trim() || f.status.value !== o.place;
  }

  function drawPanel() {
    const o = t.open, d = o.d, isNew = o.id === "new";
    removePanel();
    const prios = t.data.options.priorities || [];
    o.place = isNew ? "backlog" : placeOf(d.status);
    const f = o.f = {
      title: el("input", { id: "task-title", value: d.title, "aria-label": "Title", placeholder: "What needs doing?" }),
      status: el("select", { id: "task-status", "aria-label": "Status" },
        [["backlog", "Backlog"], ...t.data.columns.map(c => [c.id, c.name]), ["completed", "Completed"]]
          .map(([v, n]) => el("option", { value: v, selected: v === o.place }, n)),
        o.place === "unsorted" ? el("option", { value: "unsorted", selected: true, disabled: true }, `${d.status} (no such column)`) : ""),
      priority: el("select", { id: "task-priority", "aria-label": "Priority" },
        ["", ...prios].map(p => el("option", { value: p, selected: p === d.priority }, p || "None")),
        d.priority && !prios.includes(d.priority) ? el("option", { value: d.priority, selected: true }, d.priority) : ""),
      labels: el("input", { id: "task-labels", value: d.labels.join(", "), placeholder: "comma separated, e.g. ui, input", "aria-label": "Labels" }),
      desc: el("textarea", { id: "task-desc", rows: "10", "aria-label": "Description", placeholder: "What it is, why, and how you'll know it's done. Markdown." }),
    };
    f.desc.value = d.description || "";
    o.msg = el("div", { class: "small", id: "task-msg" });
    o.banner = el("div", { class: "tbanner", hidden: true, id: "task-banner" });

    // The description: Write, or Preview (as it reads); a click on the preview writes.
    const preview = el("div", { class: "tpreview", id: "task-preview", tabindex: "0", title: "Click to edit" });
    const wbtn = el("button", { type: "button", role: "tab", id: "task-write" }, "Write");
    const pbtn = el("button", { type: "button", role: "tab", id: "task-show" }, "Preview");
    const show = write => {
      o.write = write;
      f.desc.hidden = !write;
      preview.hidden = write;
      wbtn.classList.toggle("on", write);
      pbtn.classList.toggle("on", !write);
      wbtn.setAttribute("aria-selected", String(write));
      pbtn.setAttribute("aria-selected", String(!write));
      if (!write) preview.replaceChildren(mdNode(f.desc.value.trim() || "*No description yet.*"));
    };
    wbtn.addEventListener("click", () => { show(true); f.desc.focus(); });
    pbtn.addEventListener("click", () => show(false));
    preview.addEventListener("click", e => { if (!e.target.closest("a")) { show(true); f.desc.focus(); } });
    preview.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); show(true); f.desc.focus(); } });

    const facts = isNew ? [] : [["Created", d.created], ["Done", d.done], ...d.extra, ["File", d.file]].filter(x => x[1]);
    const form = el("div", { class: "tform" },
      el("label", { class: "tfield" }, el("span", { class: "dim small" }, "Title"), f.title),
      el("div", { class: "trow2" },
        el("label", { class: "tfield" }, el("span", { class: "dim small" }, "Status"), f.status),
        el("label", { class: "tfield" }, el("span", { class: "dim small" }, "Priority"), f.priority)),
      el("label", { class: "tfield" }, el("span", { class: "dim small" }, "Labels"), f.labels),
      el("div", { class: "tfield" }, el("div", { class: "tdesc-head" }, el("span", { class: "dim small" }, "Description"),
        el("div", { class: "tdesc-tabs", role: "tablist" }, wbtn, pbtn)), f.desc, preview),
      facts.length ? el("dl", { class: "jfacts small" }, facts.flatMap(([k, v]) => [el("dt", { class: "dim" }, k), el("dd", {}, v)])) : "",
      ...(d.sections || []).map(s => el("div", { class: "tsection" }, el("h4", {}, s.heading),
        el("div", { class: "dim small" }, "Kept as it is in the file; Edit whole file changes it."), mdNode(s.text || "*(empty)*"))));

    // Edit whole file: the markdown as it is on disk, saved as it is.
    o.rawBox = el("textarea", { id: "task-raw", rows: "22", class: "traw", "aria-label": "The task's whole file", spellcheck: "false" });
    o.rawBox.value = d.text || "";
    const body = el("div", {}, o.raw ? o.rawBox : form);
    const rawBtn = el("button", { type: "button", id: "task-raw-toggle", onclick: () => {
      if (dirty() && !confirm("Switch without saving? Your changes here are dropped.")) return;
      o.raw = !o.raw;
      drawPanel();
    } }, o.raw ? "Back to the form" : "Edit whole file");

    const saveBtn = el("button", { type: "button", class: "primary", id: "task-save", title: "Ctrl+Enter", onclick: save }, isNew ? "Create task" : "Save");
    const actions = el("div", { class: "start-actions tactions" }, saveBtn,
      el("button", { type: "button", id: "task-cancel", onclick: () => closePanel() }, isNew ? "Cancel" : "Close"),
      el("span", { class: "spacer" }),
      isNew ? "" : rawBtn,
      isNew ? "" : el("button", { type: "button", id: "task-delete", class: "tdanger", onclick: del }, "Delete…"));

    const placeChip = isNew ? "" : chip(o.place === "unsorted" ? d.status : listName(o.place),
      o.place === "completed" || o.place === t.data.done ? "done" : o.place === "backlog" ? "todo" : "now");
    const head = el("div", { class: "jticket-head" },
      isNew ? el("strong", {}, "New task") : el("span", { class: "jkey" }, d.id), placeChip,
      el("span", { class: "spacer" }),
      el("button", { type: "button", class: "right", title: "Close (Esc)", "aria-label": "Close", onclick: () => closePanel() }, "×"));
    const panel = el("aside", { class: "tpanel", role: "dialog", "aria-label": isNew ? "New task" : `${d.id}: ${d.title}`, tabindex: "-1" },
      head, o.banner, body, actions, o.msg, isNew || o.raw ? "" : startSection(d));
    panel.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save(); }
    });
    const shade = el("div", { class: "tshade", onclick: () => closePanel() });
    document.body.append(shade, panel);
    panelNodes = [shade, panel];
    if (!o.raw) show(o.write);
    (isNew ? f.title : panel).focus();
  }

  function banner(text, ...acts) {
    const o = t.open;
    o.banner.hidden = false;
    o.banner.replaceChildren(el("span", {}, text), ...acts);
  }

  async function save() {
    const o = t.open, f = o.f;
    o.msg.className = "small";
    if (o.id === "new") {
      const title = f.title.value.trim();
      if (!title) { o.msg.className = "small st missing"; o.msg.textContent = "A task needs a title."; f.title.focus(); return; }
      try {
        const r = await send("/api/tasks/create", { name: t.name, title, to: f.status.value, priority: f.priority.value,
          labels: f.labels.value, description: f.desc.value });
        t.open = null;
        removePanel();
        history.replaceState(null, "", tasksHref(t.name, t.view));
        say(`${r.task.id} created in ${listName(f.status.value)}`);
        await refresh(r.task.id);
      } catch (e) { o.msg.className = "small st missing"; o.msg.textContent = String(e.message || e); }
      return;
    }
    const body = { name: t.name, id: o.id, rev: o.d.rev };
    if (o.raw) body.text = o.rawBox.value;
    else {
      if (f.title.value.trim() !== o.d.title) body.title = f.title.value;
      if (f.priority.value !== o.d.priority) body.priority = f.priority.value;
      if (labelsText(f.labels.value) !== o.d.labels.join(", ")) body.labels = f.labels.value;
      if (f.desc.value.trim() !== (o.d.description || "").trim()) body.description = f.desc.value;
      if (f.status.value !== o.place && f.status.value !== "unsorted") body.to = f.status.value;
    }
    if (Object.keys(body).length === 3) { o.msg.textContent = "Nothing has changed."; return; }
    try {
      const r = await send("/api/tasks/save", body);
      o.d = r.task;
      t.open.write = !o.d.description;
      drawPanel();
      t.open.msg.className = "small ok";
      t.open.msg.textContent = "Saved.";
      refresh();
    } catch (e) {
      if (e.status !== 409) { o.msg.className = "small st missing"; o.msg.textContent = String(e.message || e); return; }
      // Changed on disk meanwhile: what was typed stays, the next Save is made
      // over the file as it is now (knowingly), or Reload shows it.
      try { o.d = await api(`/api/tasks/task?name=${enc(t.name)}&id=${enc(o.id)}`); } catch { /* the banner says it anyway */ }
      if (!o.raw) o.place = placeOf(o.d.status);
      banner("This task changed on disk since you opened it. Your changes are still here: Save again to keep yours, or Reload to see the file as it is now. ",
        el("button", { type: "button", id: "task-reload", onclick: () => { t.open.write = !o.d.description; drawPanel(); } }, "Reload"));
    }
  }

  async function del() {
    const o = t.open;
    if (!confirm(`Delete ${o.id}? Its file moves to the board's .deleted folder, so it can be brought back by hand.`)) return;
    try {
      await send("/api/tasks/delete", { name: t.name, id: o.id, rev: o.d.rev });
      t.open = null;
      removePanel();
      history.replaceState(null, "", tasksHref(t.name, t.view));
      say(`${o.id} deleted`);
      refresh();
    } catch (e) {
      o.msg.className = "small st missing";
      o.msg.textContent = e.status === 409 ? "It changed on disk since you opened it: look again before deleting it." : String(e.message || e);
    }
  }

  // The open task changed on disk (an edit in Obsidian, another window): a form
  // with nothing typed in it just shows the new one; one with changes asks.
  async function panelChanged() {
    const o = t.open;
    let now;
    try { now = await api(`/api/tasks/task?name=${enc(t.name)}&id=${enc(o.id)}`); } catch { return; }
    if (!t || t.open !== o || now.rev === o.d.rev) return;
    if (!dirty()) { o.d = now; drawPanel(); return; }
    banner("This task just changed on disk. ",
      el("button", { type: "button", onclick: () => { o.d = now; drawPanel(); } }, "Reload"), " ",
      el("button", { type: "button", onclick: () => { o.banner.hidden = true; } }, "Keep editing"));
  }

  // The workflow started from this task: which route it is on, where it stands, its
  // session, a way to its feature and its tab, and Cancel. The box is filled again
  // whenever the board is read (the status of its session moves without the task's
  // file changing).
  function workflowSection(d, feature) {
    const box = el("div", { class: "start-panel", id: "task-workflow" });
    if (t.open) t.open.wfBox = box;
    const fill = () => {
      const w = ((t.data || {}).workflows || {})[d.id];
      const words = wfWords(w);
      const s = w && w.session;
      const cancel = el("button", { type: "button", id: "task-cancel-workflow", onclick: async () => {
        cancel.disabled = true;
        const r = await cancelWorkflow(feature, cancelWorkflowText(feature, { id: d.id },
          w ? w.ticketOnly : false, !!s && s.status !== "ended"), client);
        if (!r) { cancel.disabled = false; return; }
        await refresh();
        const moved = r.movedTo ? `${d.id} is back in ${r.movedTo}. ` : "";
        stripSay(`Workflow cancelled. ${moved}${r.folder === "removed" ? "The empty feature folder was moved to features/.deleted." : "The feature folder was kept."}`);
      } }, "Cancel workflow");
      box.replaceChildren(
        el("div", { class: "start-title" }, "A workflow was started from this task"),
        words ? el("div", { id: "task-workflow-state" }, chip(words[0], "route"), " ", chip(words[1], "now"), " ",
          s ? el("a", { href: "#workflows/" + encodeURIComponent(s.tag), onclick: () => closePanel(true), title: s.name }, words[2])
            : el("span", { class: "dim" }, words[2]))
          : el("div", { class: "dim small" }, w && w.missing ? "Its feature folder is gone." : "Where it stands shows once the board has been read."),
        el("div", { class: "start-actions" },
          el("a", { href: featureHref(feature), onclick: () => closePanel(true) }, feature + " →"), " ", cancel));
    };
    fill();
    if (t.open) t.open.wfFill = fill;
    return box;
  }

  // Start workflow, as on a Jira ticket: the feature's name and project, then the
  // server makes the folder, writes the task in as its Ticket, starts the
  // session and moves the task to the board's start column.
  function startSection(d) {
    const started = d.feature || (t.data.started || {})[d.id];
    if (started) return workflowSection(d, started);
    const clean = s => s.replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, "");
    const name = el("input", { id: "task-feature", value: clean(d.title) ? `${d.id} - ${clean(d.title)}`.slice(0, 70).replace(/[ .-]+$/, "") : d.id,
      "aria-label": "Feature name" });
    let project = t.data.options.project || "";
    let workdir = t.data.options.workdir || "";
    const where = el("span", {});
    const whereWork = el("span", {});
    const go = el("button", { type: "button", class: "primary", id: "task-start" }, "Start workflow");
    const goLite = el("button", { type: "button", id: "task-start-lite" }, "Start lite");
    const result = el("div", { class: "start-result" });
    const picker = modelPicker("task-start-" + d.id);
    const drawWhere = () => {
      where.replaceChildren(project ? copyable(project) : el("strong", { class: "st missing" }, "no project chosen yet"));
      whereWork.replaceChildren(workdir ? copyable(workdir) : el("span", { class: "dim" }, "the project itself"));
      go.disabled = goLite.disabled = !project || !name.value.trim();
    };
    const choose = el("button", { type: "button", onclick: async () => {
      try { const p = await pickFolder(`Choose the project (repo) for ${d.id}`, project); if (p) { project = p; drawWhere(); } }
      catch (e) { alert(e.message || e); }
    } }, "Choose…");
    const chooseWork = el("button", { type: "button", id: "task-workdir", onclick: async () => {
      try { const p = await pickFolder(`Choose the folder ${d.id} is worked on in`, workdir || project); if (p) { workdir = p; drawWhere(); } }
      catch (e) { alert(e.message || e); }
    } }, "Choose…");
    const clearWork = el("button", { type: "button", onclick: () => { workdir = ""; drawWhere(); } }, "Clear");
    name.addEventListener("input", drawWhere);
    const begin = mode => async () => {
      go.disabled = goLite.disabled = true;
      result.replaceChildren(el("span", { class: "dim small" }, "Making the feature and opening a session…"));
      tell("allow-foreground");
      try {
        const r = await send("/api/tasks/start", { name: t.name, id: d.id, project, workdir, mode, feature: name.value.trim(), ...picker.fields() });
        if (r.ok) {
          closePanel(true);
          location.hash = featureHref(r.feature); // its page shows the session as it runs
          return;
        }
        result.replaceChildren(el("p", { class: "st missing" }, "Couldn't open a terminal here. Run this yourself:"), el("pre", {}, r.said));
        refresh();
      } catch (e) {
        result.replaceChildren(el("p", { class: "st missing" }, String(e.message || e)));
        drawWhere();
      }
    };
    go.addEventListener("click", begin("full"));
    goLite.addEventListener("click", begin("lite"));
    const start = columnOf(t.data.options.startColumn);
    drawWhere();
    return el("div", { class: "start-panel" },
      el("div", { class: "start-title" }, "Start a workflow from this task"),
      el("label", { class: "jname" }, el("span", { class: "dim small" }, "Feature folder"), name),
      el("div", { class: "project-line small" }, "Linked project (the session runs here) ", where, " ", choose),
      el("div", { class: "project-line small" }, "Works in ", whereWork, " ", chooseWork, " ", clearWork),
      picker.node,
      el("div", { class: "small dim" }, "Writes the task into the feature's folder as its Ticket and opens a new Claude session. ",
        "Start workflow plans it in full; Start lite writes a one-page brief for a small change. ",
        "When it works in another folder, code, git and checks are for that folder only",
        start ? `. ${d.id} moves to ${start.name}.` : "."),
      el("div", { class: "start-actions" }, go, " ", goLite),
      result);
  }

  // ----------------------------------------------------------- events and keys

  // A change on disk (a hand edit, another window) or by this server's own
  // timer: the board is read again (cheap). This page's own changes it has
  // already drawn.
  document.addEventListener("tt-event", e => {
    const ev = e.detail;
    if (ev.type !== "tasks" || (ev.client && ev.client === client)) return;
    if (listBox && listBox.classList.contains("on")) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { if (listBox && listBox.classList.contains("on")) renderTasks(listBox); }, 250);
      return;
    }
    if (!t || !ev.name || ev.name !== t.name || !t.box.classList.contains("on")) return;
    refreshSoon();
  });

  // A started task's session opening, asking, being answered or ending changes
  // what its card says; the board is read again for it (only while some task has
  // a workflow going).
  const WORKFLOW_EVENTS = new Set(["session", "milestone", "ask", "answered"]);
  document.addEventListener("tt-event", e => {
    if (!WORKFLOW_EVENTS.has(e.detail.type) || !t || !t.box.classList.contains("on")) return;
    if (Object.keys((t.data || {}).workflows || {}).length) refreshSoon();
  });

  document.addEventListener("keydown", e => {
    if (!t || !t.box.classList.contains("on")) return;
    if (e.key === "Escape") {
      if (t.drag && t.drag.moved) { e.preventDefault(); endDrag(true); }
      else if (t.menu) { closeMenu(); }
      else if (t.open) closePanel();
      return;
    }
    const typing = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
    if (typing || t.open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "n") { e.preventDefault(); location.hash = tasksHref(t.name, t.view, "new"); }
    else if (e.key === "/") { e.preventDefault(); t.filterBox.focus(); }
  });
  document.addEventListener("click", e => { if (t && t.menu && !t.menu.contains(e.target)) closeMenu(); });
  // Leaving the board for another page closes the panel without asking: the
  // hash has gone already, so there is nothing to stay on.
  window.addEventListener("hashchange", () => { if (t && !location.hash.startsWith("#tasks/")) { t.open = null; removePanel(); } });

  return { renderTasks, renderTaskBoard };
})();
