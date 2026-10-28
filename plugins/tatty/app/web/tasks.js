// Tatty's own task boards (#tasks, #tasks/<board>[/backlog|/completed][/task/<id>]):
// the production mode's tracker for a project that has none of its own. A board
// is a folder under <root>/tasks holding one markdown file per task, which the
// server reads and writes (server.py, "tasks"), so a task can be edited in
// Obsidian too and the board follows. Here: the list of boards, the backlog, the
// Completed page with how far you've come, and a panel to write and edit a task.
// The board itself (columns, cards you drag between them, the Start workflow
// section) is taskboard.js's, which the Jira page uses too.
// Uses app.js's el, api, mdNode and tell, features.js's ago, chip, copyable,
// pickFolder and pickRoot, and taskboard.js's makeTaskBoard.
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
  let t = null;       // the board on screen: { name, box, lists, open, tb } (tb is its taskboard.js board)
  let refreshTimer = null;

  // The board's own state (data, view, filter) lives in taskboard.js.
  const st = () => t.tb.s;
  const data = () => t.tb.s.data;
  const refresh = id => t && t.tb.refresh(id);
  const stripSay = (text, bad, extra) => t.tb.stripSay(text, bad, extra);
  const say = text => { if (t) t.tb.say(text); };
  const columnOf = id => t.tb.columnOf(id);
  const listName = id => t.tb.listName(id);
  const removePanel = () => { if (t) t.tb.removePanel(); };

  // The board on screen goes (the list of boards, another board).
  function leaveBoard() {
    if (t) { t.tb.destroy(); t = null; }
  }

  // ----------------------------------------------------------- the list of boards

  async function renderTasks(box) {
    listBox = box;
    leaveBoard();
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
    if (t && t.name === name && t.box === box && data()) {
      if (st().view !== view) {
        st().view = view;
        drawFrame();
      }
      openTask(task);
      return;
    }
    leaveBoard();
    box.replaceChildren(el("p", { class: "dim pad" }, "Opening the board…"));
    let d;
    try { d = await api("/api/tasks/board?name=" + enc(name)); } catch (e) {
      box.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e), " ", el("a", { href: "#tasks" }, "All boards")));
      return;
    }
    t = { name, box, lists: {}, open: null };
    t.tb = makeTaskBoard(boardOptions(name, box));
    st().data = d;
    st().view = view;
    drawFrame();
    openTask(task);
  }

  // What taskboard.js asks of this page (see its header).
  function boardOptions(name, box) {
    return {
      box, id: "tasks", item: "task", noun: "task", client,
      load: () => api("/api/tasks/board?name=" + enc(name)),
      cardBody: x => [
        el("div", { class: "tcard-top" }, el("span", { class: "jkey" }, x.id), x.priority ? chip(x.priority, prioClass(x.priority)) : ""),
        el("div", { class: "tsum" }, x.title),
        x.labels.length ? el("div", { class: "tlabels" }, x.labels.map(l => el("span", { class: "tlabel" }, l))) : ""],
      cardFoot: x => x.problems.length ? el("div", { class: "small st missing" }, x.problems[0]) : "",
      open: id => { location.hash = tasksHref(t.name, st().view, id); },
      move: (id, to, before) => send("/api/tasks/move", { name: t.name, id, to, before }),
      ops: { add: true, rename: true, move: true, remove: true },
      colOp: body => send("/api/tasks/columns", { name: t.name, ...body }),
      foot: c => quickAdd(c.id),
      railMore: (c, total) => el("a", { class: "small tall", href: tasksHref(t.name, "backlog") }, `All ${total} in the backlog →`),
      unsortedNote: "Their Status names no column. Drag one onto a column, or name a column to match.",
      head: drawHead,
      // the list on screen is read again as far as it was shown; the others when next shown
      reload: async () => {
        for (const k of Object.keys(t.lists)) if (k !== st().view) delete t.lists[k];
        if (st().view !== "board") await loadList(st().view, true);
      },
      drawView,
      afterRefresh: () => { if (t.open && t.open.id !== "new") panelChanged(); },
      onFilter: loadListSoon,
      escape: () => closePanel(),
      newItem: () => { location.hash = tasksHref(t.name, st().view, "new"); },
    };
  }

  // Which list a status puts a task in, as the server says (task_place).
  function placeOf(status) {
    const s = (status || "").trim().replace(/\s+/g, " ").toLowerCase();
    if (!s || s === "backlog") return "backlog";
    if (s === "completed") return "completed";
    const c = data().columns.find(x => x.name.toLowerCase() === s);
    return c ? c.id : "unsorted";
  }
  const prioClass = p => /highest|critical|urgent|blocker/i.test(p) ? "bad" : /high/i.test(p) ? "now" : "todo";

  // The bar, the tabs and the strip; the body below is drawBody's.
  function drawFrame() {
    const tab = (v, label) => el("a", { class: "ttab" + (st().view === v ? " on" : ""), href: tasksHref(t.name, v), "data-view": v,
      "aria-current": st().view === v ? "page" : null }, label);
    t.tabs = { backlog: tab("backlog", ""), completed: tab("completed", "") };
    t.clear = el("button", { type: "button", id: "tasks-clear", onclick: clearDone });
    const head = el("div", { class: "board-bar tasks-bar" },
      el("a", { href: "#tasks" }, "← All boards"), el("h2", {}, t.name),
      el("nav", { class: "ttabs", "aria-label": "Lists" }, tab("board", "Board"), t.tabs.backlog, t.tabs.completed),
      el("span", { class: "spacer" }), t.tb.filterField(),
      el("button", { type: "button", class: "primary", id: "tasks-new", title: "A new task (n)",
        onclick: () => { location.hash = tasksHref(t.name, st().view, "new"); } }, "+ New task"),
      st().view === "board" ? t.clear : "");
    t.problems = el("div", {});
    t.tb.frame(head, t.problems);
    drawHead();
    t.tb.drawBody();
  }

  // The counts in the bar, and the problems, kept current without rebuilding
  // the bar (which would lose what is being typed in the filter).
  function drawHead() {
    const d = data();
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
    return el("details", { class: "card board-problems tproblems", open: data().broken },
      el("summary", { class: "st missing" }, `${problems.length} file${problems.length === 1 ? "" : "s"} to look at`),
      data().broken ? el("p", { class: "small" }, "Changes are refused until board.json reads again, so nothing you're fixing is written over.") : "",
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

  // The body for the Backlog and Completed pages (the board's is taskboard.js's).
  function drawView(view) {
    if (!t.lists[view]) {
      st().body.replaceChildren(el("p", { class: "dim pad" }, "Reading the list…"));
      loadList(view).then(() => { if (t && t.lists[st().view]) t.tb.drawBody(); });
    } else if (view === "backlog") drawBacklog();
    else drawCompleted();
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
        st().refocusAdd = to;
      } catch (err) { stripSay(String(err.message || err), true); }
      await refresh();
    });
    return input;
  }

  async function clearDone() {
    const done = columnOf(data().done);
    t.clear.disabled = true;
    try {
      const r = await send("/api/tasks/clear", { name: t.name });
      say(`${r.cleared} task${r.cleared === 1 ? "" : "s"} moved to Completed`);
      stripSay(r.cleared ? `${r.cleared} task${r.cleared === 1 ? "" : "s"} from ${done ? done.name : "done"} went to Completed. Well done!` : "Nothing to clear.", false,
        r.cleared ? el("a", { href: tasksHref(t.name, "completed") }, "See how far you've come →") : "");
    } catch (e) { stripSay(String(e.message || e), true); }
    await refresh();
  }

  // ----------------------------------------------------------- the backlog

  function loadListSoon() {
    clearTimeout(loadListSoon.timer);
    loadListSoon.timer = setTimeout(async () => {
      if (!t || st().view === "board") return;
      await loadList(st().view);
      if (t && st().view !== "board") t.tb.drawBody();
    }, 250);
  }

  // A list from the server: the first page, or as many as are on screen already.
  async function loadList(which, keep) {
    const cur = t.lists[which];
    const limit = keep && cur ? Math.max(100, cur.items.length) : 100;
    try {
      t.lists[which] = await api(`/api/tasks/list?name=${enc(t.name)}&in=${which}&offset=0&limit=${limit}&q=${enc(st().filter.trim())}`);
    } catch (e) { stripSay(String(e.message || e), true); }
  }

  async function loadMore(which) {
    const cur = t.lists[which];
    try {
      const r = await api(`/api/tasks/list?name=${enc(t.name)}&in=${which}&offset=${cur.items.length}&limit=100&q=${enc(st().filter.trim())}`);
      cur.items.push(...r.items);
      cur.total = r.total;
    } catch (e) { stripSay(String(e.message || e), true); }
    const keep = t.box.scrollTop;
    t.tb.drawBody();
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
    const L = t.lists.backlog, first = data().columns[0];
    const rows = el("div", { class: "tcards tlist", "data-list": "backlog", role: "list", "aria-label": "Backlog" },
      L.items.map(x => {
        const r = t.tb.card(x);
        r.classList.add("trow");
        r.append(el("div", { class: "trow-acts" },
          el("span", { class: "dim small" }, x.created),
          first ? el("button", { type: "button", title: `Onto the board, in ${first.name}`, onclick: () => t.tb.moveTask(x.id, first.id, null) }, `→ ${first.name}`) : "",
          el("button", { type: "button", title: "To the top of the backlog", onclick: () => t.tb.moveTask(x.id, "backlog", L.items[0] && L.items[0].id !== x.id ? L.items[0].id : null) }, "Top")));
        return r;
      }));
    const left = L.total - L.items.length;
    st().body.replaceChildren(el("div", { class: "tlist-page" },
      el("p", { class: "dim small" }, L.total ? `${L.total} task${L.total === 1 ? "" : "s"} waiting, in the order you'll take them. Drag to reorder (or Alt+↑/↓), and Alt+→ puts one on the board.`
        : ""),
      quickAdd("backlog"),
      L.items.length ? rows : el("div", { class: "empty-state" }, el("p", {}, st().filter.trim() ? "Nothing in the backlog matches." : "The backlog is empty. Add a task above, or press + New task.")),
      left > 0 ? moreRow("backlog", left) : ""));
    t.tb.wireCards(rows, !st().filter.trim()); // a filtered list can't say where a dropped card goes among the hidden ones
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
    const first = data().columns[0];
    const list = el("div", { class: "tdone-list" });
    let group = "", ul = null;
    for (const x of L.items) {
      const g = groupOf(x.done);
      if (g !== group) {
        group = g;
        ul = el("div", { class: "tcards tlist", role: "list", "aria-label": g });
        list.append(el("h4", { class: "tgroup" }, g), ul);
      }
      const r = t.tb.card(x);
      r.classList.add("trow");
      r.append(el("div", { class: "trow-acts" }, el("span", { class: "dim small" }, x.done),
        first ? el("button", { type: "button", title: `Back onto the board, in ${first.name}`, onclick: () => t.tb.moveTask(x.id, first.id, null) }, "Reopen") : ""));
      ul.append(r);
    }
    const left = L.total - L.items.length;
    st().body.replaceChildren(el("div", { class: "tdone-page" },
      el("div", { class: "tdone-head" },
        el("div", { class: "tbig" }, el("strong", { id: "tasks-total" }, String(s.total)), el("span", {}, s.total === 1 ? " task completed" : " tasks completed")),
        el("div", { class: "tstats" }, tile(s.thisWeek, "this week"), tile(s.thisMonth, "this month"), tile(s.bestWeek, "best week"),
          tile(s.streakWeeks, s.streakWeeks === 1 ? "week streak" : "weeks streak"))),
      el("p", { class: "tcheer", id: "tasks-cheer" }, cheer(s)),
      bars,
      L.items.length ? list : (st().filter.trim() && s.total ? el("p", { class: "dim" }, "Nothing completed matches.") : ""),
      left > 0 ? moreRow("completed", left) : ""));
    t.tb.wireCards(list, false); // open with a click or Enter; Reopen to bring one back
  }

  // ----------------------------------------------------------- the task panel

  async function openTask(id) {
    if (!id) { closePanel(true); return; }
    if (t.open && t.open.id === id && t.tb.hasPanel()) return;
    if (id === "new") {
      t.open = { id: "new", d: { id: "", title: "", status: "", priority: "", labels: [], description: "", extra: [], sections: [] }, write: true };
      drawPanel();
      return;
    }
    let d;
    try { d = await api(`/api/tasks/task?name=${enc(t.name)}&id=${enc(id)}`); } catch (e) {
      stripSay(`Can't open ${id}: ${e.message || e}`, true);
      history.replaceState(null, "", tasksHref(t.name, st().view));
      return;
    }
    if (!t) return;
    t.open = { id: d.id, d, write: !d.description };
    drawPanel();
  }

  function closePanel(force) {
    if (!t || !t.open) { removePanel(); return true; }
    if (!force && dirty() && !confirm("Discard your changes to this task?")) return false;
    t.open = null;
    removePanel();
    if (location.hash.includes("/task/")) history.replaceState(null, "", tasksHref(t.name, st().view));
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
    const prios = data().options.priorities || [];
    o.place = isNew ? "backlog" : placeOf(d.status);
    const f = o.f = {
      title: el("input", { id: "task-title", value: d.title, "aria-label": "Title", placeholder: "What needs doing?" }),
      status: el("select", { id: "task-status", "aria-label": "Status" },
        [["backlog", "Backlog"], ...data().columns.map(c => [c.id, c.name]), ["completed", "Completed"]]
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
      o.place === "completed" || o.place === data().done ? "done" : o.place === "backlog" ? "todo" : "now");
    const head = el("div", { class: "jticket-head" },
      isNew ? el("strong", {}, "New task") : el("span", { class: "jkey" }, d.id), placeChip,
      el("span", { class: "spacer" }),
      el("button", { type: "button", class: "right", title: "Close (Esc)", "aria-label": "Close", onclick: () => closePanel() }, "×"));
    const panel = el("aside", { class: "tpanel", role: "dialog", "aria-label": isNew ? "New task" : `${d.id}: ${d.title}`, tabindex: "-1" },
      head, o.banner, body, actions, o.msg, isNew || o.raw ? "" : startSection(d));
    panel.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save(); }
    });
    t.tb.showPanel(panel);
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
        history.replaceState(null, "", tasksHref(t.name, st().view));
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
      history.replaceState(null, "", tasksHref(t.name, st().view));
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

  // Start workflow, as on a Jira ticket: the feature's name and project, then the
  // server makes the folder, writes the task in as its Ticket, starts the
  // session and moves the task to the board's start column (taskboard.js draws it).
  function startSection(d) {
    const clean = s => s.replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, "");
    const start = columnOf(data().options.startColumn);
    return t.tb.startSection({
      id: d.id,
      started: d.feature || (data().started || {})[d.id],
      name: clean(d.title) ? `${d.id} - ${clean(d.title)}`.slice(0, 70).replace(/[ .-]+$/, "") : d.id,
      project: data().options.project || "",
      workdir: data().options.workdir || "",
      moves: start ? `${d.id} moves to ${start.name}.` : "",
      send: fields => send("/api/tasks/start", { name: t.name, ...fields }),
      close: closePanel,
      after: () => refresh(),
      cancelled: r => {
        const moved = r.movedTo ? `${d.id} is back in ${r.movedTo}. ` : "";
        stripSay(`Workflow cancelled. ${moved}${r.folder === "removed" ? "The empty feature folder was moved to features/.deleted." : "The feature folder was kept."}`);
      },
    });
  }

  // ----------------------------------------------------------- events

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
    t.tb.refreshSoon();
  });

  // Leaving the board for another page closes the panel without asking: the
  // hash has gone already, so there is nothing to stay on.
  window.addEventListener("hashchange", () => { if (t && !location.hash.startsWith("#tasks/")) { t.open = null; removePanel(); } });

  return { renderTasks, renderTaskBoard };
})();
