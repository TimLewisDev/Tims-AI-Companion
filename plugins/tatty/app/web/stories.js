// The design mode's User Stories boards (#designs, #design/<name>[/card/<id>]).
// A board is a folder under <root>/design holding a design document and its
// "<name> - User Stories.md", which the toolbox's tt-user-stories skill writes:
// the server runs the skill headless to draft and alter stories, and changes
// them through its stories.sh when you click (server.py, "design"). Here the
// stories are sticky notes on a board you can pan, zoom and rearrange; where
// each note sits is Tatty's own (saved per board), never in the document.
// Uses app.js's $, el, api, markdown, calm, host and tell, and features.js's
// pageEls, ago, chip, copyable, pickRoot and pendingPick.
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
  const ZMIN = 0.2, ZMAX = 2.5;
  let listBox = null;
  let b = null; // the board on screen: { name, box, data, view, world, cards, focus, ... }

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
    if (b && b.name === name && b.box === box && b.data) { openCard(card); return; }
    listBox = null;
    box.replaceChildren(el("p", { class: "dim pad" }, "Opening the board…"));
    let data;
    try { data = await api("/api/design?name=" + encodeURIComponent(name)); } catch (e) {
      box.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e), " ", el("a", { href: "#designs" }, "All boards")));
      return;
    }
    b = { name, box, data, focus: "", fresh: new Set(), cards: new Map(), busy: new Set(), run: data.run, runNote: "", editing: false };
    const v = data.layout.view || {};
    b.view = { x: num(v.x, 40), y: num(v.y, 30), z: clampZ(num(v.z, 1)) };
    drawBoard();
    openCard(card);
  }

  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const clampZ = z => Math.min(ZMAX, Math.max(ZMIN, z));
  const story = id => b && b.data.stories.find(s => s.id === id);
  const colourOf = g => {
    const hit = b.data.groups.find(x => x.name === g);
    return hit ? "g" + hit.colour : "gu";
  };
  // A little tilt per note, the same every time for the same story.
  const tilt = id => "rot" + ([...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 5);

  function drawBoard() {
    const d = b.data;
    b.world = el("div", { class: "world", id: "board-world" });
    b.frame = el("div", { class: "gframe", hidden: true });
    b.world.append(b.frame);
    b.strip = el("div", { class: "run-strip", id: "run-strip" });
    b.panel = el("div", { class: "gpanel", id: "group-panel" });
    b.zoom = el("span", { class: "zoom-pct" });
    const board = el("div", { class: "board", id: "board", tabindex: "0" }, b.world, b.panel,
      el("div", { class: "zoomctl" },
        el("button", { type: "button", title: "Zoom out", onclick: () => zoomBy(1 / 1.25) }, "−"), b.zoom,
        el("button", { type: "button", title: "Zoom in", onclick: () => zoomBy(1.25) }, "+"),
        el("button", { type: "button", title: "Show every story", id: "fit-all", onclick: () => frame(d.stories.map(s => s.id), true) }, "Fit")));
    b.board = board;
    b.overlay = el("div", { class: "scard-overlay", id: "card-overlay", hidden: true, onclick: e => { if (e.target === b.overlay) closeCard(); } });
    const top = el("div", { class: "board-bar" },
      el("a", { href: "#designs", class: "small" }, "← All boards"),
      el("h2", {}, b.name),
      el("span", { class: "dim small" }, d.doc ? `${d.stories.length} stor${d.stories.length === 1 ? "y" : "ies"} · ${d.doc}` : ""),
      el("span", { class: "spacer" }),
      d.plugin && d.doc ? el("button", { type: "button", id: "write-stories", onclick: () => run({ mode: "draft" }),
        title: d.stories.length ? "Read the design again and add what's missing (new stories wait as Proposed)" : "Write the stories from the design document" },
      d.stories.length ? "Look for more" : "Write stories") : "");
    const problems = (d.problems || []).length || d.error
      ? el("div", { class: "card toolbox-missing board-problems" }, el("strong", {}, d.error ? d.error + " " : "The document was edited out of its layout: "),
        (d.problems || []).slice(0, 4).join("; "), (d.problems || []).length ? el("span", { class: "dim small" }, " (run stories.sh tidy, or fix it by hand)") : "")
      : "";
    b.box.replaceChildren(el("div", { class: "board-page" }, top, problems, b.strip, board, b.overlay));
    drawCards();
    drawPanel();
    drawStrip();
    applyView(false);
    wire(board);
  }

  // Cards that have no place yet go in a column for their group, under the
  // ones already there; their places are saved so they stay.
  function place() {
    const pos = b.data.layout.cards;
    const order = [...b.data.groups.map(g => g.name), "Ungrouped"];
    const added = {};
    for (const s of b.data.stories) {
      if (Array.isArray(pos[s.id])) continue;
      const col = Math.max(0, order.indexOf(s.group));
      const x = col * (CARD_W + GAP_X);
      const below = b.data.stories.filter(o => o.group === s.group && Array.isArray(pos[o.id])).map(o => pos[o.id][1] + CARD_H + GAP_Y);
      pos[s.id] = [x, below.length ? Math.max(...below) : 0];
      added[s.id] = pos[s.id];
    }
    if (Object.keys(added).length) api("/api/stories/layout", { name: b.name, cards: added }).catch(() => {});
  }

  function drawCards() {
    place();
    for (const n of b.cards.values()) n.remove();
    b.cards.clear();
    for (const s of b.data.stories) {
      const [x, y] = b.data.layout.cards[s.id];
      const proposed = s.status === "Proposed";
      const n = el("div", { class: `scard ${colourOf(s.group)} ${tilt(s.id)}${proposed ? " proposed" : ""}${b.fresh.has(s.id) ? " fresh" : ""}${b.busy.has(s.id) ? " busy" : ""}`,
        "data-id": s.id, tabindex: "0", role: "button", "aria-label": `${s.id}: ${s.title}` },
      el("div", { class: "scard-top" }, el("span", { class: "sid" }, s.id), el("span", { class: "sgroup" }, s.group),
        proposed ? el("span", { class: "sbadge" }, "Proposed") : ""),
      el("div", { class: "stitle" }, s.title),
      el("div", { class: "sline" }, `As ${s.article} ${s.as}, I want ${s.want}, so that ${s.soThat}.`),
      el("div", { class: "sfoot" }, `${s.criteria.length} criteri${s.criteria.length === 1 ? "on" : "a"}`,
        s.origin !== "Design doc" ? ` · ${s.origin}` : "", s.altered ? ` · altered ${s.altered}×` : ""),
      proposed ? el("div", { class: "sacts" },
        el("button", { type: "button", class: "s-accept", title: "Accept", "aria-label": `Accept ${s.id}`, onclick: e => { e.stopPropagation(); accept(s); } }, "✓"),
        el("button", { type: "button", class: "s-reject", title: "Reject (bin it)", "aria-label": `Reject ${s.id}`, onclick: e => { e.stopPropagation(); reject(s, ""); } }, "🗑")) : "");
      n.style.left = x + "px";
      n.style.top = y + "px";
      b.cards.set(s.id, n);
      b.world.append(n);
    }
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

  // ----------------------------------------------------------- the view

  function applyView(ease) {
    const w = b.world;
    w.classList.toggle("easing", !!ease && !calm());
    w.style.transform = `translate(${b.view.x}px, ${b.view.y}px) scale(${b.view.z})`;
    b.zoom.textContent = Math.round(b.view.z * 100) + "%";
    if (ease) setTimeout(() => w.classList.remove("easing"), 400);
  }

  let viewTimer = null;
  function saveView() {
    clearTimeout(viewTimer);
    const name = b.name, view = { ...b.view };
    viewTimer = setTimeout(() => api("/api/stories/layout", { name, view }).catch(() => {}), 600);
  }

  // Zoom about a point of the board (its centre by default), keeping it still.
  function zoomBy(f, cx, cy) {
    const r = b.board.getBoundingClientRect();
    if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
    const z = clampZ(b.view.z * f), k = z / b.view.z;
    b.view = { x: cx - (cx - b.view.x) * k, y: cy - (cy - b.view.y) * k, z };
    applyView(false);
    saveView();
  }

  // Frame the cards: zoom and pan so they fill the board (the group panel's
  // corner left clear).
  function frame(ids, ease) {
    const pos = ids.map(id => b.data.layout.cards[id]).filter(Array.isArray);
    if (!pos.length) return;
    const minX = Math.min(...pos.map(p => p[0])), minY = Math.min(...pos.map(p => p[1]));
    const maxX = Math.max(...pos.map(p => p[0])) + CARD_W, maxY = Math.max(...pos.map(p => p[1])) + CARD_H;
    const r = b.board.getBoundingClientRect(), pad = 48, right = Math.min(260, r.width * 0.3);
    const z = clampZ(Math.min(1.4, (r.width - right - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY)));
    b.view = { z, x: pad + ((r.width - right - pad * 2) - (maxX - minX) * z) / 2 - minX * z, y: pad + ((r.height - pad * 2) - (maxY - minY) * z) / 2 - minY * z };
    applyView(ease);
    saveView();
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
    const pos = ids.map(id => b.data.layout.cards[id]).filter(Array.isArray);
    b.frame.hidden = !pos.length;
    if (pos.length) {
      const minX = Math.min(...pos.map(p => p[0])) - 14, minY = Math.min(...pos.map(p => p[1])) - 30;
      b.frame.className = "gframe " + colourOf(name);
      b.frame.style.left = minX + "px";
      b.frame.style.top = minY + "px";
      b.frame.style.width = Math.max(...pos.map(p => p[0])) + CARD_W + 14 - minX + "px";
      b.frame.style.height = Math.max(...pos.map(p => p[1])) + CARD_H + 14 - minY + "px";
      b.frame.textContent = name;
      if (frameIt) frame(ids, true);
    }
  }

  // Pan by dragging the background, zoom with the wheel (or a pinch, which
  // arrives as a wheel with ctrl), move a card by dragging it; a click that
  // didn't move opens the card.
  function wire(board) {
    let drag = null;
    board.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target.closest(".gpanel, .zoomctl, button, input, textarea, select")) return;
      const card = e.target.closest(".scard");
      drag = { id: card ? card.dataset.id : "", x0: e.clientX, y0: e.clientY, moved: false, card,
        start: card ? [...b.data.layout.cards[card.dataset.id]] : [b.view.x, b.view.y] };
      try { board.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: no capture needed */ }
      if (!card) board.classList.add("panning");
    });
    board.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      if (drag.card) {
        const at = [drag.start[0] + dx / b.view.z, drag.start[1] + dy / b.view.z];
        b.data.layout.cards[drag.id] = at;
        drag.card.style.left = at[0] + "px";
        drag.card.style.top = at[1] + "px";
        drag.card.classList.add("dragging");
      } else {
        b.view.x = drag.start[0] + dx;
        b.view.y = drag.start[1] + dy;
        applyView(false);
      }
    });
    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      board.classList.remove("panning");
      if (d.card) {
        d.card.classList.remove("dragging");
        if (d.moved) {
          api("/api/stories/layout", { name: b.name, cards: { [d.id]: b.data.layout.cards[d.id] } }).catch(() => {});
          if (b.focus) focusGroup(b.focus, false);
        } else location.hash = designHref(b.name, d.id);
      } else if (d.moved) saveView();
    };
    board.addEventListener("pointerup", end);
    board.addEventListener("pointercancel", end);
    board.addEventListener("wheel", e => {
      if (e.target.closest(".gpanel")) return;
      e.preventDefault();
      const r = board.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    board.addEventListener("keydown", e => {
      const card = e.target.closest && e.target.closest(".scard");
      if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = designHref(b.name, card.dataset.id); }
      else if (e.key === "Escape" && b.focus) focusGroup("", false);
      else if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-") zoomBy(1 / 1.25);
    });
  }

  // ----------------------------------------------------------- one card, opened

  function openCard(id) {
    if (!b || !b.overlay) return;
    b.editing = false;
    const s = id && story(id);
    if (!s) { b.overlay.hidden = true; return; }
    b.open = id;
    drawOpen(s);
    b.overlay.hidden = false;
  }

  function closeCard() {
    b.overlay.hidden = true;
    b.open = "";
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

  function editForm(s, msg) {
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
      const ok = await change({ action: "edit", id: s.id, hash: s.hash, title: f.title.value, group: f.group.value,
        as: role === s.as ? `${s.article} ${role}` : role, want: f.want.value, soThat: f.soThat.value, source: f.source.value,
        details: f.details.value, criteria: [...crit.querySelectorAll("input")].map(i => i.value).filter(v => v.trim()) }, msg);
      save.disabled = false;
      if (ok) { b.editing = false; const now = story(s.id); if (now) drawOpen(now); }
    } },
      lab("Title", f.title), lab("Group", f.group),
      el("div", { class: "eline" }, lab(`As ${s.article}`, f.as), lab("I want", f.want), lab("so that", f.soThat)),
      lab("Details", f.details),
      el("div", { class: "elab" }, el("span", {}, "Acceptance criteria"), crit,
        el("button", { type: "button", onclick: () => { const r = critRow(""); crit.append(r); r.querySelector("input").focus(); } }, "+ Add a criterion")),
      lab("Source", f.source),
      el("div", { class: "row" }, save, el("button", { type: "button", onclick: () => { b.editing = false; drawOpen(s); } }, "Cancel")));
  }
  const lab = (text, input) => el("label", { class: "elab" }, el("span", {}, text), input);

  function proposedActions(s, msg) {
    const reason = el("input", { placeholder: "why (optional)", "aria-label": "Reason for rejecting", id: "reject-reason" });
    const note = el("textarea", { rows: "3", placeholder: "Say what to change, e.g. \"split the full-bag case into its own story\"", "aria-label": "What to change", id: "alter-note" });
    const busy = b.busy.has(s.id);
    const send = el("button", { type: "button", id: "alter-send", disabled: busy || (b.run && b.run.status === "running"), onclick: async () => {
      if (!note.value.trim()) { msg.textContent = "Say what to change first."; return; }
      if (await run({ mode: "alter", id: s.id, note: note.value }, msg)) { b.busy.add(s.id); drawCards(); drawOpen(s); }
    } }, busy ? "Rewriting…" : "Ask for changes");
    return el("div", { class: "oacts" },
      el("div", { class: "row" },
        el("button", { type: "button", class: "primary", id: "card-accept", onclick: () => accept(s, msg) }, "✓ Accept"),
        reason, el("button", { type: "button", id: "card-reject", onclick: () => reject(s, reason.value, msg) }, "🗑 Reject")),
      el("div", { class: "alter" }, note, send),
      el("p", { class: "dim small" }, "Accepting a merge retires the stories it merges. A rejected story moves to the document's Retired list, so it isn't suggested again."));
  }

  async function accept(s, msg) {
    if (await change({ action: "accept", id: s.id, hash: s.hash }, msg) && b.open === s.id) closeCard();
  }

  async function reject(s, reason, msg) {
    if (await change({ action: "reject", id: s.id, hash: s.hash, reason }, msg) && b.open === s.id) closeCard();
  }

  // ----------------------------------------------------------- changes and runs

  // One change through the server (stories.sh): the answer is the board again.
  async function change(body, msg) {
    try {
      const d = await api("/api/stories", { name: b.name, ...body });
      take(d);
      return true;
    } catch (e) {
      const text = String(e.message || e);
      if (msg) msg.textContent = text; else stripSay(text, true);
      if (e.status === 409) reload();
      return false;
    }
  }

  async function run(body, msg) {
    try {
      const r = await api("/api/stories/run", { name: b.name, ...body });
      b.run = r.run;
      b.runNote = "";
      drawStrip();
      return true;
    } catch (e) {
      const text = String(e.message || e);
      if (msg) msg.textContent = text; else stripSay(text, true);
      return false;
    }
  }

  function take(d) {
    const keep = b.data.layout;
    b.data = d;
    b.data.layout.cards = { ...keep.cards, ...d.layout.cards };
    drawCards();
    drawPanel();
    if (b.open) { const s = story(b.open); if (s && !b.editing) drawOpen(s); else if (!s) closeCard(); }
  }

  let reloadTimer = null;
  function reload() {
    clearTimeout(reloadTimer);
    const name = b.name;
    reloadTimer = setTimeout(async () => {
      if (!b || b.name !== name) return;
      try { take(await api("/api/design?name=" + encodeURIComponent(name))); } catch { /* the next event tries again */ }
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
