// The design mode's User Stories boards (#designs, #design/<name>[/card/<id>]).
// A board is a folder under <root>/design holding a design document and its
// "<name> - User Stories.md", which the toolbox's tt-user-stories skill writes:
// the server runs the skill headless to draft and alter stories, and changes
// them through its stories.sh when you click (server.py, "design"). Here the
// stories are sticky notes on a whiteboard (whiteboard.js) you can pan, zoom
// and rearrange, and add stories, text, comments and lines to; where each note
// sits, and what else is on the board, is Tatty's own (saved per board), never
// in the document.
// Uses app.js's $, el, api, markdown, host and tell, features.js's pageEls,
// ago, chip, copyable, pickRoot and pendingPick, and whiteboard.js's
// makeWhiteboard.
"use strict";

const designHref = (name, card) => "#design/" + encodeURIComponent(name) + (card ? "/card/" + encodeURIComponent(card) : "");

// pickFile: Windows' file dialog for a markdown document, from the companion or
// the server; resolves the chosen file, or null when cancelled.
async function pickFile(title, start) {
  if (host) return new Promise(resolve => { pendingPick = resolve; tell("pick-file", JSON.stringify({ title, start: start || "" })); });
  const got = await api("/api/pick-file", { title, start: start || "" });
  return got.path || null;
}

const { renderDesigns, renderBoard } = (() => {
  const CARD_W = 230, CARD_H = 156, GAP_X = 40, GAP_Y = 22;
  let listBox = null;
  let b = null; // the board on screen: { name, box, data, wb, cards, focus, ... }
  let boardRequest = 0;

  // ----------------------------------------------------------- the list of boards

  async function renderDesigns(box) {
    listBox = box;
    b = null;
    box.replaceChildren(el("p", { class: "dim pad" }, "Looking for boards…"));
    let d;
    try { d = await api("/api/designs"); } catch (e) { box.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e))); return; }
    const msg = el("p", { class: "home-note small" });
    const head = el("div", { class: "home-head" },
      el("div", {}, el("h2", {}, "User Stories"),
        el("div", { class: "dim small root-line" }, "Boards in ", copyable(d.folder))),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "primary", id: "new-board", disabled: !d.isSet || !d.plugin,
          onclick: () => form.hidden = !form.hidden }, "New from a design document…"),
        el("button", { type: "button", onclick: () => renderDesigns(box) }, "Refresh")));
    const form = newBoardForm(d, msg);
    form.hidden = true;
    const warn = !d.isSet
      ? el("div", { class: "card toolbox-missing" }, el("strong", {}, "Choose Tatty's root folder first. "),
        "Boards live in its design folder. ", el("button", { type: "button", onclick: () => pickRoot(d) }, "Choose…"))
      : !d.plugin
        ? el("div", { class: "card toolbox-missing" }, el("strong", {}, "The design plugin isn't installed. "),
          "The board needs the toolbox's tt-user-stories skill: add the Design mode on ", el("a", { href: "#modes" }, "the modes page"), ".")
        : !d.claude ? el("div", { class: "card toolbox-missing" }, "There's no claude command on this machine's PATH, so Tatty can open boards but can't write stories.") : "";
    const cards = d.designs.map(x => el("a", { class: "fcard board-card", href: designHref(x.name) },
      el("div", { class: "fcard-top" }, el("strong", {}, x.name), x.running ? chip("● Writing", "live") : ""),
      el("div", {}, chip(`${x.stories} stor${x.stories === 1 ? "y" : "ies"}`, x.stories ? "done" : "todo"),
        x.proposed ? chip(`${x.proposed} proposed`, "now") : "", x.groups ? el("span", { class: "dim small" }, ` · ${x.groups} group${x.groups === 1 ? "" : "s"}`) : ""),
      el("div", { class: "fcard-foot dim small" }, x.doc || "no stories document", ` · updated ${ago(x.updated)}`)));
    box.replaceChildren(warn, head, msg, form, cards.length ? el("div", { class: "fgrid" }, cards)
      : el("div", { class: "card empty-state" }, el("p", {}, "No boards yet. ", el("strong", {}, "New from a design document…"),
        " copies a design document into a board of its own and has Tatty write its user stories.")));
  }

  function newBoardForm(d, msg) {
    const name = el("input", { placeholder: "a name for the board, e.g. Inventory", "aria-label": "Board name", id: "board-name" });
    const file = el("span", { class: "dim small", id: "board-file" }, "No design document chosen.");
    let chosen = "";
    const pick = el("button", { type: "button", onclick: async () => {
      try {
        const p = await pickFile("Choose the design document", chosen);
        if (p) {
          chosen = p;
          file.textContent = p;
          if (!name.value) name.value = p.replace(/^.*[\\/]/, "").replace(/\.md$/i, "").replace(/ - .*$/, "");
        }
      } catch (e) { msg.textContent = String(e.message || e); }
    } }, "Choose design document…");
    const go = el("button", { type: "submit", class: "primary" }, "Create and write stories");
    return el("form", { class: "card new-feature", id: "new-board-form", onsubmit: async e => {
      e.preventDefault();
      if (!chosen) { msg.textContent = "Choose the design document first."; return; }
      go.disabled = true;
      try {
        const r = await api("/api/new-design", { name: name.value, intake: chosen });
        if (d.claude) await api("/api/stories/run", { name: r.name, mode: "draft" }).catch(err => { msg.textContent = String(err.message || err); });
        location.hash = designHref(r.name);
      } catch (err) { msg.textContent = String(err.message || err); go.disabled = false; }
    } },
      el("strong", {}, "New board"),
      el("div", { class: "row" }, name, pick), el("div", {}, file),
      el("div", { class: "row" }, go),
      el("p", { class: "dim small" }, "Copies the document into ", el("code", {}, d.folder + "/<name>"),
        ", then Tatty writes its user stories in the background (a headless Claude run). Suggested and merged stories wait as Proposed for you."));
  }

  // ----------------------------------------------------------- one board

  async function renderBoard(box, name, card) {
    const request = ++boardRequest;
    const route = location.hash;
    if (b && b.name === name && b.box === box && b.data) { openCard(card); return; }
    listBox = null;
    box.replaceChildren(el("p", { class: "dim pad" }, "Opening the board…"));
    let data;
    try { data = await api("/api/design?name=" + encodeURIComponent(name)); } catch (e) {
      if (request !== boardRequest || location.hash !== route) return;
      box.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e), " ", el("a", { href: "#designs" }, "All boards")));
      return;
    }
    if (request !== boardRequest || location.hash !== route) return;
    b = { name, box, data, focus: "", fresh: new Set(), cards: new Map(), busy: new Set(), run: data.run, runNote: "", editing: false };
    drawBoard();
    openCard(card);
  }

  const story = id => b && b.data.stories.find(s => s.id === id);
  const colourOf = g => {
    const hit = b.data.groups.find(x => x.name === g);
    return hit ? "g" + hit.colour : "gu";
  };
  // A little tilt per note, the same every time for the same story.
  const tilt = id => "rot" + ([...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 5);

  function drawBoard() {
    const d = b.data;
    b.strip = el("div", { class: "run-strip", id: "run-strip" });
    b.panel = el("div", { class: "gpanel", id: "group-panel" });
    b.overlay = el("div", { class: "scard-overlay", id: "card-overlay", hidden: true, onclick: e => { if (e.target === b.overlay) closeCard(); } });
    b.wb = makeWhiteboard({
      id: "board", key: { kind: "design", ref: b.name }, data: d.layout, place, corner: b.panel,
      onOpen: id => { location.hash = designHref(b.name, id); },
      onMoved: () => { if (b.focus) focusGroup(b.focus, false); },
      onEscape: () => { if (b.focus) focusGroup("", false); },
      onError: text => stripSay(text, true),
      tools: d.plugin && d.doc ? [{ id: "story", label: "＋", key: "s", title: "Story: click where it goes (S)", at: newStory }] : [],
    });
    b.board = b.wb.element;
    const top = el("div", { class: "board-bar" },
      el("a", { href: "#designs", class: "small" }, "← All boards"),
      el("h2", {}, b.name),
      el("span", { class: "dim small" }, d.doc ? `${d.stories.length} stor${d.stories.length === 1 ? "y" : "ies"} · ${d.doc}` : ""),
      el("span", { class: "spacer" }),
      d.doc && d.stories.some(s => s.status === "Accepted") ? el("button", { type: "button", id: "export-tasks", onclick: openExport,
        title: "Copy accepted stories into a Tasks board's backlog, one task each" }, "Export to Tasks") : "",
      d.plugin && d.doc ? el("button", { type: "button", id: "write-stories", onclick: () => run({ mode: "draft" }),
        title: d.stories.length ? "Read the design again and add what's missing (new stories wait as Proposed)" : "Write the stories from the design document" },
      d.stories.length ? "Look for more" : "Write stories") : "");
    const problems = (d.problems || []).length || d.error
      ? el("div", { class: "card toolbox-missing board-problems" }, el("strong", {}, d.error ? d.error + " " : "The document was edited out of its layout: "),
        (d.problems || []).slice(0, 4).join("; "), (d.problems || []).length ? el("span", { class: "dim small" }, " (run stories.sh tidy, or fix it by hand)") : "")
      : "";
    b.box.replaceChildren(el("div", { class: "board-page" }, top, problems, b.strip, b.board, b.overlay));
    drawCards();
    drawPanel();
    drawStrip();
  }

  // A card with no place yet goes in a column for its group, under the ones
  // already there (the whiteboard saves the place, so it stays).
  function place(id, pos) {
    const s = story(id);
    const group = s ? s.group : "Ungrouped";
    const col = Math.max(0, [...b.data.groups.map(g => g.name), "Ungrouped"].indexOf(group));
    const below = b.data.stories.filter(o => o.id !== id && o.group === group && Array.isArray(pos[o.id])).map(o => pos[o.id][1] + CARD_H + GAP_Y);
    return [col * (CARD_W + GAP_X), below.length ? Math.max(...below) : 0];
  }

  function drawCards() {
    b.cards.clear();
    const list = [];
    for (const s of b.data.stories) {
      const proposed = s.status === "Proposed";
      const went = (b.data.exported || {})[s.id];
      const n = el("div", { class: `scard ${colourOf(s.group)} ${tilt(s.id)}${proposed ? " proposed" : ""}${b.fresh.has(s.id) ? " fresh" : ""}${b.busy.has(s.id) ? " busy" : ""}`,
        "data-id": s.id, tabindex: "0", role: "button", "aria-label": `${s.id}: ${s.title}` },
      el("div", { class: "scard-top" }, el("span", { class: "sid" }, s.id), el("span", { class: "sgroup" }, s.group),
        proposed ? el("span", { class: "sbadge" }, "Proposed") : "",
        went ? el("button", { type: "button", class: "stask" + (went.changed ? " changed" : ""),
          title: `${went.task} on the Tasks board "${went.board}"` + (went.changed ? " (the story changed after it went)" : ""),
          onclick: e => { e.stopPropagation(); location.hash = tasksHref(went.board, "", went.task); } },
        went.task, went.changed ? " ✎" : "") : ""),
      el("div", { class: "stitle" }, s.title),
      el("div", { class: "sline" }, `As ${s.article} ${s.as}, I want ${s.want}, so that ${s.soThat}.`),
      el("div", { class: "sfoot" }, `${s.criteria.length} criteri${s.criteria.length === 1 ? "on" : "a"}`,
        s.origin !== "Design doc" ? ` · ${s.origin}` : "", s.altered ? ` · altered ${s.altered}×` : ""),
      proposed ? el("div", { class: "sacts" },
        el("button", { type: "button", class: "s-accept", title: "Accept", "aria-label": `Accept ${s.id}`, onclick: e => { e.stopPropagation(); accept(s); } }, "✓"),
        el("button", { type: "button", class: "s-reject", title: "Reject (bin it)", "aria-label": `Reject ${s.id}`, onclick: e => { e.stopPropagation(); reject(s, ""); } }, "🗑")) : "");
      b.cards.set(s.id, n);
      list.push({ id: s.id, node: n, w: CARD_W, h: CARD_H });
    }
    b.wb.setCards(list);
    focusGroup(b.focus, false);
  }

  function drawPanel() {
    const d = b.data;
    const rows = d.groups.map(g => groupRow(g));
    const loose = d.stories.filter(s => s.group === "Ungrouped").length;
    if (loose) rows.push(groupRow({ name: "Ungrouped", count: loose, description: "Stories in no group", colour: -1 }));
    const input = el("input", { placeholder: "New group", "aria-label": "New group name", id: "group-new" });
    b.panel.replaceChildren(el("div", { class: "gpanel-head" }, el("strong", {}, "Groups"), el("span", { class: "dim small" }, String(d.groups.length))),
      el("ul", { class: "glist" }, rows),
      el("form", { class: "gadd", onsubmit: e => { e.preventDefault(); if (input.value.trim()) change({ action: "group", op: "add", group: input.value }); } },
        input, el("button", { type: "submit", title: "Add a group" }, "+")));
  }

  function groupRow(g) {
    const loose = g.colour === -1;
    const li = el("li", { class: "grow" + (b.focus === g.name ? " on" : ""), "data-group": g.name, title: g.description || "" });
    const label = el("button", { type: "button", class: "gname", onclick: () => focusGroup(b.focus === g.name ? "" : g.name, true),
      ondblclick: () => { if (!loose) renameRow(li, g); } },
    el("span", { class: "swatch " + (loose ? "gu" : "g" + g.colour) }), el("span", { class: "gtext" }, g.name), el("span", { class: "gcount dim" }, String(g.count)));
    const rm = loose ? "" : el("button", { type: "button", class: "gremove", title: `Remove ${g.name}`, "aria-label": `Remove ${g.name}`, onclick: () => {
      li.replaceChildren(el("span", { class: "small" }, `Remove ${g.name}? `, g.count ? `Its ${g.count} stor${g.count === 1 ? "y goes" : "ies go"} to Ungrouped.` : ""),
        el("button", { type: "button", class: "primary", onclick: () => change({ action: "group", op: "remove", group: g.name }) }, "Remove"),
        el("button", { type: "button", onclick: drawPanel }, "Keep"));
    } }, "×");
    li.append(label, rm);
    return li;
  }

  function renameRow(li, g) {
    const input = el("input", { value: g.name, "aria-label": "Group name" });
    li.replaceChildren(el("form", { class: "gadd", onsubmit: e => {
      e.preventDefault();
      const to = input.value.trim();
      if (to && to !== g.name) { if (b.focus === g.name) b.focus = to; change({ action: "group", op: "rename", group: g.name, value: to }); } else drawPanel();
    } }, input, el("button", { type: "submit" }, "Rename"), el("button", { type: "button", onclick: drawPanel }, "×")));
    input.focus();
    input.select();
  }

  // A group in focus: its cards outlined and in front, the rest dimmed, and a
  // frame drawn round them; frame=true also brings them into view.
  function focusGroup(name, frameIt) {
    b.focus = name;
    const ids = name ? b.data.stories.filter(s => s.group === name).map(s => s.id) : [];
    for (const [id, n] of b.cards) {
      n.classList.toggle("hl", !!name && ids.includes(id));
      n.classList.toggle("dim", !!name && !ids.includes(id));
    }
    for (const li of b.panel.querySelectorAll(".grow")) li.classList.toggle("on", li.dataset.group === name);
    b.wb.outline(ids, name, colourOf(name));
    if (frameIt && ids.length) b.wb.frame(ids, true);
  }

  // ----------------------------------------------------------- one card, opened

  function openCard(id) {
    if (!b || !b.overlay) return;
    if (b.adding && !id) return; // the new story's form stays open
    b.editing = false;
    b.exporting = null;
    b.adding = null;
    const s = id && story(id);
    if (!s) { b.overlay.hidden = true; return; }
    b.open = id;
    drawOpen(s);
    b.overlay.hidden = false;
  }

  function closeCard() {
    b.overlay.hidden = true;
    b.open = "";
    b.exporting = null;
    b.adding = null;
    b.editing = false;
    if (location.hash !== designHref(b.name)) history.replaceState(null, "", designHref(b.name));
  }

  function drawOpen(s) {
    const proposed = s.status === "Proposed";
    const msg = el("p", { class: "small st missing", id: "card-msg" });
    const head = el("div", { class: "ocard-head" }, el("span", { class: "sid" }, s.id),
      el("span", { class: "chip " + (proposed ? "now" : "done") }, s.status),
      el("span", { class: "dim small" }, s.origin + (s.altered ? ` · altered ${s.altered}×` : "") + (s.source ? ` · ${s.source}` : "")),
      el("span", { class: "spacer" }),
      b.editing ? "" : el("button", { type: "button", id: "card-edit", onclick: () => { b.editing = true; drawOpen(s); } }, "Edit"),
      el("button", { type: "button", class: "oclose", title: "Close", "aria-label": "Close", onclick: closeCard }, "×"));
    const body = b.editing ? editForm(s, msg) : viewBody(s);
    const acts = proposed && !b.editing ? proposedActions(s, msg) : "";
    b.overlay.replaceChildren(el("div", { class: `ocard ${colourOf(s.group)}`, role: "dialog", "aria-label": s.title }, head, body, acts, msg));
  }

  function viewBody(s) {
    const details = el("div", { class: "md" });
    details.innerHTML = s.details ? markdown(s.details) : "<p class=\"dim\">No details.</p>";
    return el("div", { class: "obody" },
      el("h3", { class: "otitle" }, s.title),
      el("div", { class: "dim small" }, "Group: ", el("strong", {}, s.group)),
      el("p", { class: "oline" }, el("strong", {}, `As ${s.article} `), s.as, el("strong", {}, ", I want "), s.want, el("strong", {}, ", so that "), s.soThat, "."),
      el("h4", {}, "Details"), details,
      el("h4", {}, "Acceptance criteria"),
      el("ul", { class: "ocrit" }, s.criteria.map(c => el("li", {}, c))));
  }

  // A blank story's form where the Story tool was clicked: written here (stories.sh
  // add, no tokens), or said in a line for the headless skill to write.
  function newStory(x, y) {
    b.open = "";
    b.exporting = null;
    b.adding = [Math.round(x - CARD_W / 2), Math.round(y - 20)];
    const at = b.adding;
    const blank = { id: "", title: "", group: b.focus || "Ungrouped", article: "a", as: "", want: "", soThat: "", source: "", details: "", criteria: [""], hash: "" };
    const msg = el("p", { class: "small st missing", id: "card-msg" });
    const note = el("input", { id: "story-note", "aria-label": "The story in a line", placeholder: "or say it in a line, e.g. players can drop what they carry" });
    const write = el("button", { type: "button", id: "story-write", onclick: async () => {
      if (!note.value.trim()) { msg.textContent = "Say the story in a line first."; return; }
      write.disabled = true;
      const d = await change({ action: "add", note: note.value, at }, msg);
      write.disabled = false;
      if (d) { if (d.added) b.busy.add(d.added); drawCards(); closeCard(); stripSay(d.runError || "", !!d.runError); }
    } }, "Write it for me");
    b.overlay.replaceChildren(el("div", { class: "ocard gu", role: "dialog", "aria-label": "New story" },
      el("div", { class: "ocard-head" }, el("strong", {}, "New story"), el("span", { class: "spacer" }),
        el("button", { type: "button", class: "oclose", title: "Close", "aria-label": "Close", onclick: closeCard }, "×")),
      editForm(blank, msg, body => ({ ...body, action: "add", at }), d => { if (d.added) b.fresh.add(d.added); drawCards(); closeCard(); }, closeCard),
      b.data.claude ? el("div", { class: "oacts" }, el("div", { class: "alter" }, note, write),
        el("p", { class: "dim small" }, "Tatty has the user-stories skill write it from your line (a headless Claude run, about $0.10). It waits as Proposed for you.")) : "",
      msg));
    b.overlay.hidden = false;
  }

  // The story's fields. make(fields): the change to send (an edit of s by default);
  // saved(answer) and cancel(): what follows.
  function editForm(s, msg, make, saved, cancel) {
    make = make || (body => ({ ...body, action: "edit", id: s.id, hash: s.hash }));
    saved = saved || (() => { b.editing = false; const now = story(s.id); if (now) drawOpen(now); });
    cancel = cancel || (() => { b.editing = false; drawOpen(s); });
    const f = {
      title: el("input", { value: s.title, id: "edit-title", "aria-label": "Title" }),
      group: el("select", { id: "edit-group", "aria-label": "Group" },
        [...b.data.groups.map(g => g.name), "Ungrouped"].map(g => el("option", { value: g, selected: g === s.group }, g))),
      as: el("input", { value: s.as, "aria-label": "As a" }),
      want: el("input", { value: s.want, "aria-label": "I want" }),
      soThat: el("input", { value: s.soThat, "aria-label": "so that" }),
      source: el("input", { value: s.source, "aria-label": "Source", placeholder: "the design's section, e.g. § Pickup" }),
      details: el("textarea", { rows: "6", "aria-label": "Details", id: "edit-details" }),
    };
    f.details.value = s.details;
    const crit = el("ol", { class: "ecrit", id: "edit-criteria" });
    const critRow = text => {
      const input = el("input", { value: text, "aria-label": "Criterion" });
      const li = el("li", {}, input,
        el("button", { type: "button", title: "Up", onclick: () => li.previousElementSibling && li.previousElementSibling.before(li) }, "↑"),
        el("button", { type: "button", title: "Down", onclick: () => li.nextElementSibling && li.nextElementSibling.after(li) }, "↓"),
        el("button", { type: "button", title: "Remove", onclick: () => li.remove() }, "×"));
      return li;
    };
    s.criteria.forEach(c => crit.append(critRow(c)));
    const save = el("button", { type: "submit", class: "primary", id: "edit-save" }, "Save");
    return el("form", { class: "obody oedit", onsubmit: async e => {
      e.preventDefault();
      save.disabled = true;
      const role = f.as.value.trim();
      const board = b;
      const d = await change(make({ title: f.title.value, group: f.group.value,
        as: role === s.as && s.as ? `${s.article} ${role}` : role, want: f.want.value, soThat: f.soThat.value, source: f.source.value,
        details: f.details.value, criteria: [...crit.querySelectorAll("input")].map(i => i.value).filter(v => v.trim()) }), msg);
      if (b !== board) return;
      save.disabled = false;
      if (d) saved(d);
    } },
      lab("Title", f.title), lab("Group", f.group),
      el("div", { class: "eline" }, lab(`As ${s.article}`, f.as), lab("I want", f.want), lab("so that", f.soThat)),
      lab("Details", f.details),
      el("div", { class: "elab" }, el("span", {}, "Acceptance criteria"), crit,
        el("button", { type: "button", onclick: () => { const r = critRow(""); crit.append(r); r.querySelector("input").focus(); } }, "+ Add a criterion")),
      lab("Source", f.source),
      el("div", { class: "row" }, save, el("button", { type: "button", onclick: cancel }, "Cancel")));
  }
  const lab = (text, input) => el("label", { class: "elab" }, el("span", {}, text), input);

  function proposedActions(s, msg) {
    const reason = el("input", { placeholder: "why (optional)", "aria-label": "Reason for rejecting", id: "reject-reason" });
    const note = el("textarea", { rows: "3", placeholder: "Say what to change, e.g. \"split the full-bag case into its own story\"", "aria-label": "What to change", id: "alter-note" });
    const busy = b.busy.has(s.id);
    const send = el("button", { type: "button", id: "alter-send", disabled: busy || (b.run && b.run.status === "running"), onclick: async () => {
      if (!note.value.trim()) { msg.textContent = "Say what to change first."; return; }
      const board = b;
      if (await run({ mode: "alter", id: s.id, note: note.value }, msg) && b === board) { b.busy.add(s.id); drawCards(); drawOpen(s); }
    } }, busy ? "Rewriting…" : "Ask for changes");
    return el("div", { class: "oacts" },
      el("div", { class: "row" },
        el("button", { type: "button", class: "primary", id: "card-accept", onclick: () => accept(s, msg) }, "✓ Accept"),
        reason, el("button", { type: "button", id: "card-reject", onclick: () => reject(s, reason.value, msg) }, "🗑 Reject")),
      el("div", { class: "alter" }, note, send),
      el("p", { class: "dim small" }, "Accepting a merge retires the stories it merges. A rejected story moves to the document's Retired list, so it isn't suggested again."));
  }

  async function accept(s, msg) {
    const board = b;
    if (await change({ action: "accept", id: s.id, hash: s.hash }, msg) && b === board && board.open === s.id) closeCard();
  }

  async function reject(s, reason, msg) {
    const board = b;
    if (await change({ action: "reject", id: s.id, hash: s.hash, reason }, msg) && b === board && board.open === s.id) closeCard();
  }

  // ----------------------------------------------------------- export to Tasks

  // The accepted stories not yet on a Tasks board, ticked, to go into one board's
  // backlog as a task each. The server writes the tasks itself: no headless run.
  async function openExport() {
    b.open = "";
    b.exporting = { boards: null };
    b.overlay.replaceChildren(el("div", { class: "ocard xcard", role: "dialog", "aria-label": "Export to Tasks" },
      el("p", { class: "dim" }, "Finding your task boards…")));
    b.overlay.hidden = false;
    let boards = [];
    try { boards = (await api("/api/tasks")).boards.map(x => x.name); } catch { /* none to offer: a new one is */ }
    if (!b.exporting) return;
    b.exporting.boards = boards;
    drawExport();
  }

  function drawExport(note) {
    const d = b.data, went = d.exported || {}, boards = b.exporting.boards;
    const open = d.stories.filter(s => s.status === "Accepted" && !went[s.id]);
    const msg = el("p", { class: "small st missing", id: "export-msg" }, note || "");
    const ticks = [];
    const go = el("button", { type: "button", class: "primary", id: "export-go" });
    const count = () => {
      const n = ticks.filter(c => c.checked).length;
      go.disabled = !n;
      go.textContent = `Export ${n} stor${n === 1 ? "y" : "ies"}`;
    };
    const groups = [...d.groups.map(g => g.name), "Ungrouped"]
      .map(g => ({ g, list: open.filter(s => s.group === g) })).filter(x => x.list.length);
    const list = el("div", { class: "xlist", id: "export-list" }, groups.map(({ g, list }) =>
      el("fieldset", { class: "xgroup" }, el("legend", {}, g), list.map(s => {
        const c = el("input", { type: "checkbox", checked: true, "data-id": s.id, onchange: count });
        ticks.push(c);
        return el("label", { class: "xrow" }, c, el("span", { class: "sid" }, s.id), el("span", {}, s.title));
      }))));
    const fresh = !boards.includes(b.name);
    const pick = el("select", { id: "export-board", "aria-label": "Tasks board" },
      fresh ? el("option", { value: "", selected: true }, `New board: ${b.name}`) : "",
      boards.map(n => el("option", { value: n, selected: n === b.name }, n)));
    go.addEventListener("click", async () => {
      const ids = {};
      for (const c of ticks) if (c.checked) ids[c.dataset.id] = story(c.dataset.id).hash;
      go.disabled = true;
      msg.textContent = "";
      try {
        const r = await api("/api/stories/export", { name: b.name, ids, board: pick.value || b.name, newBoard: !pick.value });
        const x = r.export;
        take(r);
        b.overlay.replaceChildren(el("div", { class: "ocard xcard", role: "dialog", "aria-label": "Exported" },
          el("div", { class: "ocard-head" }, el("strong", {}, "Exported"), el("span", { class: "spacer" }),
            el("button", { type: "button", class: "oclose", title: "Close", "aria-label": "Close", onclick: closeCard }, "×")),
          el("p", {}, `${x.created.length} task${x.created.length === 1 ? "" : "s"} added to the backlog of "${x.board}"`,
            x.skipped.length ? ` (${x.skipped.length} already there)` : "", "."),
          el("div", { class: "row" },
            el("button", { type: "button", class: "primary", id: "export-open", onclick: () => { location.hash = tasksHref(x.board, "backlog"); } }, "Open the backlog →"),
            el("button", { type: "button", onclick: closeCard }, "Stay here"))));
        b.exporting = null;
      } catch (e) {
        if (e.status === 409) { b.exporting.note = String(e.message || e); reload(); } else msg.textContent = String(e.message || e);
        go.disabled = false;
      }
    });
    const all = on => () => { for (const c of ticks) c.checked = on; count(); };
    b.overlay.replaceChildren(el("div", { class: "ocard xcard", role: "dialog", "aria-label": "Export to Tasks" },
      el("div", { class: "ocard-head" }, el("strong", {}, "Export to Tasks"), el("span", { class: "spacer" }),
        el("button", { type: "button", class: "oclose", title: "Close", "aria-label": "Close", onclick: closeCard }, "×")),
      open.length
        ? [el("p", { class: "dim small" }, "Each story becomes a task in the board's backlog: its title, its group as a label, the story and its details as the description, and its acceptance criteria. Proposed stories wait until they're accepted."),
          el("div", { class: "row small" }, el("button", { type: "button", onclick: all(true) }, "All"), el("button", { type: "button", onclick: all(false) }, "None")),
          list,
          el("div", { class: "row" }, el("label", { class: "small" }, "Into ", pick), el("span", { class: "spacer" }), go)]
        : el("p", {}, "Every accepted story is on a Tasks board already."),
      msg));
    count();
  }

  // ----------------------------------------------------------- changes and runs

  // One change through the server (stories.sh): the answer is the board again
  // (null when it was refused).
  async function change(body, msg) {
    const board = b;
    if (!board) return false;
    try {
      const d = await api("/api/stories", { name: board.name, ...body });
      if (b !== board) return false;
      take(d);
      if (d.run) { b.run = d.run; drawStrip(); }
      return d;
    } catch (e) {
      if (b !== board) return false;
      const text = String(e.message || e);
      if (msg) msg.textContent = text; else stripSay(text, true);
      if (e.status === 409) reload(board);
      return null;
    }
  }

  async function run(body, msg) {
    const board = b;
    if (!board) return false;
    try {
      const r = await api("/api/stories/run", { name: board.name, ...body });
      if (b !== board) return false;
      board.run = r.run;
      board.runNote = "";
      drawStrip();
      return true;
    } catch (e) {
      if (b !== board) return false;
      const text = String(e.message || e);
      if (msg) msg.textContent = text; else stripSay(text, true);
      return false;
    }
  }

  function take(d) {
    b.data = d;
    b.wb.reload(d.layout);
    drawCards();
    drawPanel();
    if (b.open) { const s = story(b.open); if (s && !b.editing) drawOpen(s); else if (!s) closeCard(); }
    if (b.exporting && b.exporting.boards && b.exporting.note !== undefined) {
      const note = b.exporting.note;
      delete b.exporting.note;
      drawExport(note);
    }
  }

  let reloadTimer = null;
  function reload(board = b) {
    if (!board) return;
    clearTimeout(reloadTimer);
    const name = board.name;
    reloadTimer = setTimeout(async () => {
      if (b !== board) return;
      try {
        const data = await api("/api/design?name=" + encodeURIComponent(name));
        if (b === board) take(data);
      } catch { /* the next event tries again */ }
    }, 250);
  }

  function stripSay(text, bad) { b.runNote = text; b.runBad = !!bad; drawStrip(); }

  function drawStrip() {
    const r = b.run;
    if (r && r.status === "running") {
      b.strip.className = "run-strip on";
      b.strip.replaceChildren(el("span", { class: "spinner" }),
        el("strong", {}, r.mode === "alter" ? `Rewriting ${r.id}… ` : "Writing stories… "),
        el("span", { class: "dim" }, r.step || ""), r.steps ? el("span", { class: "dim small" }, ` · ${r.steps} step${r.steps === 1 ? "" : "s"}`) : "",
        el("span", { class: "spacer" }),
        el("button", { type: "button", id: "run-stop", onclick: () => api("/api/stories/cancel", {}).catch(() => {}) }, "Stop"));
    } else if (b.runNote) {
      b.strip.className = "run-strip on" + (b.runBad ? " bad" : "");
      b.strip.replaceChildren(el("span", {}, b.runNote), el("span", { class: "spacer" }),
        el("button", { type: "button", onclick: () => { b.runNote = ""; drawStrip(); } }, "×"));
    } else {
      b.strip.className = "run-strip";
      b.strip.replaceChildren();
    }
  }

  document.addEventListener("tt-event", e => {
    const ev = e.detail;
    // A task deleted on a board this one exported to frees its story to go again.
    if (ev.type === "tasks" && b && b.data && b.box.classList.contains("on") && ev.name
      && Object.values(b.data.exported || {}).some(x => x.board === ev.name)) { reload(); return; }
    if (ev.type !== "stories") return;
    if (listBox && listBox.classList.contains("on")) { if (ev.done || ev.run) renderDesigns(listBox); return; }
    if (!b || ev.name !== b.name || !b.box.classList.contains("on")) return;
    if (ev.run) { b.run = ev.run; drawStrip(); }
    if (ev.done) {
      b.run = null;
      if (ev.id) b.busy.delete(ev.id);
      for (const id of [...(ev.new || []), ...(ev.altered || [])]) b.fresh.add(id);
      const parts = [];
      if ((ev.new || []).length) parts.push(`${ev.new.length} new stor${ev.new.length === 1 ? "y" : "ies"}`);
      if ((ev.altered || []).length) parts.push(`${ev.altered.length} rewritten`);
      stripSay(ev.error ? ev.error : (parts.join(", ") || ev.note || "Done.") + (ev.cost ? ` · $${ev.cost.toFixed(2)}` : ""), !ev.ok);
    }
    if (ev.changed) reload();
  });

  return { renderDesigns, renderBoard };
})();
