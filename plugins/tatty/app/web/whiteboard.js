// A whiteboard: a board you pan and zoom (drag with the middle button, the
// wheel or a pinch), holding the host page's cards (stories, documents) and what a person
// puts on it: text fields, comments pinned to a card, a text or a spot, and
// lines that join any two things. The host builds its card nodes and says what
// a click on one does; the board places and moves them, and saves where
// everything is and what was added (POST /api/whiteboard; server.py,
// "whiteboards"). Used by stories.js (a User Stories board), whiteboards.js
// (blank ones) and features.js (a feature's).
// Uses app.js's el, api, mdNode and calm.
"use strict";

const WB_TOOLS = [
  { id: "select", label: "↖", key: "v", title: "Select and move (V)" },
  { id: "text", label: "T", key: "t", title: "Text: click where it goes (T)" },
  { id: "comment", label: "💬", key: "c", title: "Comment: click a card, a text or a spot (C)" },
  { id: "line", label: "↗", key: "l", title: "Line: click one thing, then another (L)" },
];
const WB_ZMIN = 0.2, WB_ZMAX = 2.5;
const WB_LINE_PAD = 40; // room round the lines in their layer: arrowheads, labels, the hit stroke
const WB_COMMENT = 26; // a comment's marker, square

// makeWhiteboard(o) -> the board. o:
//   key: { kind, ref }: where it saves (design / feature / blank, and which)
//   data: { cards, view, items, lines }, as the server gives it
//   id: the board node's id (its world is <id>-world, its Fit button <id>-fit)
//   place(id, cards): where a card with no place goes, [x, y]
//   onOpen(id): a click (no move), Enter or Space on a host card
//   onMoved(id): a host card was dragged somewhere new
//   onEscape(): Esc with nothing else to stop
//   onError(text): a change the server refused (the board reloads)
//   tools: [{ id, label, key, title, at(x, y) }]: the host's own placing tools
//   corner: a node pinned top right (stories' group panel)
//   empty: what an empty board says
// The board: { element, setCards(list), frame(ids, ease), outline(ids, label, cls),
//   reload(data), zoomBy(f), toWorld(cx, cy), setTool(id), cardAt(id) }.
// A card is { id, node, w, h }; the board positions its node and marks it.
function makeWhiteboard(o) {
  const me = Math.random().toString(36).slice(2, 10); // this board's client id: its own changes aren't news to it
  const uid = "wb" + me;
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const clampZ = z => Math.min(WB_ZMAX, Math.max(WB_ZMIN, z));
  const newId = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const norm = d => ({ cards: { ...((d && d.cards) || {}) }, view: (d && d.view) || {},
    items: { ...((d && d.items) || {}) }, lines: { ...((d && d.lines) || {}) } });

  let data = norm(o.data);
  let view = { x: num(data.view.x, 40), y: num(data.view.y, 30), z: clampZ(num(data.view.z, 1)) };
  const cards = new Map(); // id -> { node, w, h }
  const nodes = new Map(); // item id -> node
  const fresh = new Set(); // items made here and not saved yet (they have no text)
  let tool = "select", sel = null, lineFrom = "", editing = "", openComment = "", hideResolved = false, pending = false;

  // ----------------------------------------------------------- the nodes

  const marker = svg("marker", { id: uid + "-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5",
    markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
  marker.append(svg("path", { d: "M0,0 L10,5 L0,10 z", class: "wbarrowhead" }));
  const defs = svg("defs");
  defs.append(marker);
  const linesG = svg("g");
  const layer = svg("svg", { class: "wblines", width: "0", height: "0" });
  layer.append(defs, linesG);
  const frameBox = el("div", { class: "gframe", hidden: true });
  const cardsBox = el("div", { class: "wblayer wbcards" });
  const itemsBox = el("div", { class: "wblayer" });
  // The world is the camera (where the view is) and its content what is on the
  // board, in the board's own units (see "drawing").
  const content = el("div", { class: "wbcontent" }, layer, frameBox, cardsBox, itemsBox);
  const world = el("div", { class: "world", id: o.id ? o.id + "-world" : null }, content);

  const tools = [...WB_TOOLS, ...(o.tools || [])];
  const toolBtns = new Map();
  const resolvedBtn = el("button", { type: "button", class: "wbtool wbresolved", title: "Hide resolved comments", "aria-pressed": "false",
    onclick: () => {
      hideResolved = !hideResolved;
      resolvedBtn.classList.toggle("on", hideResolved);
      resolvedBtn.setAttribute("aria-pressed", String(hideResolved));
      layout();
    } }, "✓");
  const toolbar = el("div", { class: "wbtools wbui", role: "toolbar", "aria-label": "Whiteboard tools" },
    tools.map(t => {
      const btn = el("button", { type: "button", class: "wbtool", "data-tool": t.id, title: t.title, "aria-label": t.title,
        onclick: () => setTool(tool === t.id ? "select" : t.id) }, t.label);
      toolBtns.set(t.id, btn);
      return btn;
    }), el("span", { class: "wbsep" }), resolvedBtn);
  const zoomPct = el("span", { class: "zoom-pct" });
  const zoomctl = el("div", { class: "zoomctl wbui" },
    el("button", { type: "button", title: "Zoom out", onclick: () => zoomBy(1 / 1.25) }, "−"), zoomPct,
    el("button", { type: "button", title: "Zoom in", onclick: () => zoomBy(1.25) }, "+"),
    el("button", { type: "button", title: "Show everything", id: o.id ? o.id + "-fit" : null, onclick: () => frame(null, true) }, "Fit"));
  const pop = el("div", { class: "wbpop wbui", hidden: true });
  const hint = el("div", { class: "wbhint", hidden: true, role: "status" });
  const empty = o.empty ? el("div", { class: "wbempty dim" }, o.empty) : "";
  if (o.corner) o.corner.classList.add("wbui");
  const board = el("div", { class: "board wb", id: o.id || null, tabindex: "0" }, world, toolbar, zoomctl, o.corner || "", pop, hint, empty);

  // ----------------------------------------------------------- where things are

  function toWorld(cx, cy) {
    const r = board.getBoundingClientRect();
    return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z];
  }

  const pinnable = id => cards.has(id) || (data.items[id] && data.items[id].type === "text");

  // Where a comment shows: on its card's or text's top-right corner while that is
  // on the board, else where it was put.
  function commentAt(it) {
    const t = it.pin && pinnable(it.pin) ? boxOf(it.pin) : null;
    return t ? [t.x + t.w - WB_COMMENT + 6, t.y - WB_COMMENT / 2] : [it.x, it.y];
  }

  // A thing's box on the board: a card, a text field or a comment's marker; null
  // when it isn't there (or is hidden).
  function boxOf(id) {
    const c = cards.get(id);
    if (c) {
      const p = data.cards[id];
      return Array.isArray(p) ? { x: p[0], y: p[1], w: c.w, h: c.h } : null;
    }
    const it = data.items[id];
    if (!it) return null;
    if (it.type === "comment") {
      if (it.resolved && hideResolved) return null;
      const at = commentAt(it);
      return { x: at[0], y: at[1], w: WB_COMMENT, h: WB_COMMENT };
    }
    const n = nodes.get(id);
    return { x: it.x, y: it.y, w: it.w, h: (n && n.offsetHeight) || 40 };
  }

  const centre = b => [b.x + b.w / 2, b.y + b.h / 2];
  // Where the line from a box's centre towards a point leaves the box.
  function edge(b, to) {
    const [cx, cy] = centre(b), dx = to[0] - cx, dy = to[1] - cy;
    if (!dx && !dy) return [cx, cy];
    const k = Math.min(dx ? (b.w / 2 + 4) / Math.abs(dx) : Infinity, dy ? (b.h / 2 + 4) / Math.abs(dy) : Infinity);
    return [cx + dx * Math.min(1, k), cy + dy * Math.min(1, k)];
  }

  // ----------------------------------------------------------- drawing

  // The world is a layer of its own for good (whiteboard.css), so the board's
  // cards are drawn into it once and the view moves the picture: a pan never draws
  // them again, nor does a zoom while it goes on (the picture is scaled, soft). The
  // content is drawn at `drawn`, the zoom it was last drawn sharp at, and the
  // world carries the rest of the zoom; when a zoom settles (a pause in the wheel,
  // an ease's end, a button) the content is drawn once at the new zoom. Making and
  // dropping the layer per move cost two full drawings each time, felt as a hitch.
  const WB_SETTLE = 250; // ms of no wheel before the content is drawn sharp
  const WB_SHRUNK = 0.6; // zoomed out past this share of `drawn` mid-gesture: draw again,
  // or the picture has to fill far more of the board at the larger size
  let queued = 0, still = null, easeTimer = null, rect = null, gesture = false;
  let drawn = view.z, drawnAt = 0;

  function draw() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z / drawn})`;
    if (drawnAt !== drawn) { content.style.transform = `scale(${drawn})`; drawnAt = drawn; }
    const pct = Math.round(view.z * 100) + "%";
    if (zoomPct.textContent !== pct) zoomPct.textContent = pct; // a pan leaves it as it is: nothing to draw again
    movePop();
  }

  // A gesture is moving the view (an ease going on stops where it was going).
  // hold: until settle (a pan), else until a pause (the wheel).
  function moving(hold) {
    gesture = true;
    clearTimeout(easeTimer);
    world.classList.remove("easing");
    world.classList.add("moving");
    clearTimeout(still);
    if (!hold) still = setTimeout(settle, WB_SETTLE);
  }

  // The view has stopped: on whole device pixels (a picture between them is
  // soft), the content sharp at the zoom it is at.
  function settle() {
    clearTimeout(still);
    clearTimeout(easeTimer);
    if (queued) { cancelAnimationFrame(queued); queued = 0; }
    gesture = false;
    rect = null;
    world.classList.remove("moving", "easing");
    const d = window.devicePixelRatio || 1;
    view.x = Math.round(view.x * d) / d;
    view.y = Math.round(view.y * d) / d;
    drawn = view.z;
    draw();
  }

  // The view on the next frame: however many moves come before it, it's drawn once.
  function queueView() {
    if (!queued) queued = requestAnimationFrame(() => {
      queued = 0;
      if (gesture && view.z < drawn * WB_SHRUNK) drawn = view.z;
      draw();
    });
  }
  function flushView() { if (queued) { cancelAnimationFrame(queued); queued = 0; draw(); } }

  // The view now (not mid-gesture: sharp at once). ease, with the view it eases
  // from: the content is drawn first at the smaller of the two zooms, so the
  // picture that moves has all of the board it will show, then sharp at the end.
  function applyView(ease, from) {
    if (queued) { cancelAnimationFrame(queued); queued = 0; }
    clearTimeout(easeTimer);
    if (ease && from && !calm()) {
      const low = Math.min(from.z, view.z);
      if (low !== drawn) { // (an ease still going on is taken over from where it is, unless this)
        world.classList.remove("easing");
        drawn = low;
        world.style.transform = `translate(${from.x}px, ${from.y}px) scale(${from.z / drawn})`;
        content.style.transform = `scale(${drawn})`;
        drawnAt = drawn;
        getComputedStyle(world).transform; // the ease starts from this picture, not the one before
      }
      world.classList.add("easing");
      draw();
      easeTimer = setTimeout(settle, 400);
      return;
    }
    world.classList.remove("easing");
    if (!gesture) drawn = view.z;
    draw();
  }

  function positionCard(id) {
    const c = cards.get(id), p = data.cards[id];
    if (!c || !Array.isArray(p)) return;
    c.node.style.left = p[0] + "px";
    c.node.style.top = p[1] + "px";
  }

  // Comments follow what they're pinned to, and lines follow both ends.
  function layout() {
    for (const [id, it] of Object.entries(data.items)) {
      const n = nodes.get(id);
      if (!n) continue;
      n.hidden = it.type === "comment" && it.resolved && hideResolved && openComment !== id;
      const at = it.type === "comment" ? commentAt(it) : [it.x, it.y];
      n.style.left = at[0] + "px";
      n.style.top = at[1] + "px";
      if (it.type === "text") n.style.width = it.w + "px";
    }
    drawLines();
    if (empty) empty.hidden = cards.size + Object.keys(data.items).length > 0;
  }

  function drawLines() {
    linesG.replaceChildren();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [id, ln] of Object.entries(data.lines)) {
      const a = boxOf(ln.from), b = boxOf(ln.to);
      if (!a || !b) continue; // an end is gone (or hidden): kept, not drawn
      const p1 = edge(a, centre(b)), p2 = edge(b, centre(a));
      x0 = Math.min(x0, p1[0], p2[0]); y0 = Math.min(y0, p1[1], p2[1]);
      x1 = Math.max(x1, p1[0], p2[0]); y1 = Math.max(y1, p1[1], p2[1]);
      const d = `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]}`;
      const g = svg("g", { class: "wbline" + (sel && sel.id === id ? " sel" : ""), "data-line": id });
      const stroke = svg("path", { d, class: "wbstroke" });
      if (ln.arrow) stroke.setAttribute("marker-end", `url(#${uid}-arrow)`);
      g.append(svg("path", { d, class: "wbhit" }), stroke);
      if (ln.label) {
        const t = svg("text", { x: String((p1[0] + p2[0]) / 2), y: String((p1[1] + p2[1]) / 2 - 6), class: "wblabel", "text-anchor": "middle" });
        t.textContent = ln.label;
        g.append(t);
      }
      linesG.append(g);
    }
    // The layer is only as big as its lines: a huge one is slow to draw and to move.
    const has = x0 <= x1, pad = WB_LINE_PAD;
    if (!has) x0 = y0 = x1 = y1 = 0;
    layer.style.left = x0 - pad + "px";
    layer.style.top = y0 - pad + "px";
    layer.setAttribute("width", has ? String(x1 - x0 + pad * 2) : "0");
    layer.setAttribute("height", has ? String(y1 - y0 + pad * 2) : "0");
    linesG.setAttribute("transform", `translate(${pad - x0},${pad - y0})`);
    movePop();
  }

  function textNode(id, it) {
    const n = el("div", { class: "wbtext" + (it.colour ? ` filled g${it.colour - 1}` : "") + (sel && sel.id === id ? " sel" : ""),
      "data-wb": id, tabindex: "0", role: "note", "aria-label": "Text" });
    if (editing === id) {
      const ta = el("textarea", { class: "wbtext-edit", rows: String(Math.max(2, it.text.split("\n").length)), "aria-label": "Text", placeholder: "Write here (markdown)" });
      ta.value = it.text;
      ta.addEventListener("keydown", e => {
        if (e.key === "Escape") { e.stopPropagation(); finishText(id, null); }
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.blur(); }
      });
      ta.addEventListener("input", () => { ta.rows = Math.max(2, ta.value.split("\n").length); drawLines(); });
      ta.addEventListener("blur", () => finishText(id, ta.value));
      n.append(ta);
      setTimeout(() => ta.focus(), 0);
    } else n.append(it.text.trim() ? mdNode(it.text) : el("div", { class: "dim small" }, "Double-click to write"));
    n.append(el("span", { class: "wbgrip", title: "Drag to set the width" }));
    return n;
  }

  function commentNode(id, it) {
    const open = openComment === id;
    const n = el("div", { class: "wbcomment" + (it.resolved ? " resolved" : "") + (open ? " open" : "") + (sel && sel.id === id ? " sel" : ""),
      "data-wb": id, tabindex: "0", role: "note", "aria-label": "Comment", title: it.text || "Comment" },
    el("span", { class: "wbdot" }, it.resolved ? "✓" : "💬"));
    if (open) {
      const ta = el("textarea", { rows: "3", "aria-label": "Comment", placeholder: "Write a comment" });
      ta.value = it.text;
      // blur keeps the words without drawing again: a click on the buttons below must still land
      ta.addEventListener("blur", () => keepComment(id, ta.value));
      ta.addEventListener("keydown", e => {
        if (e.key === "Escape") { e.stopPropagation(); keepComment(id, ta.value); closeComment(); }
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); keepComment(id, ta.value); closeComment(); }
      });
      n.append(el("div", { class: "wbbubble wbui" }, ta,
        el("div", { class: "wbbubble-acts" },
          el("button", { type: "button", class: "wbresolve", onclick: () => { keepComment(id, ta.value); resolve(id, !it.resolved); } }, it.resolved ? "Reopen" : "Resolve"),
          el("span", { class: "spacer" }),
          el("button", { type: "button", class: "wbdelete", onclick: () => removeThing(id) }, "Delete"),
          el("button", { type: "button", class: "primary", onclick: () => { keepComment(id, ta.value); closeComment(); } }, "Done")),
        it.at ? el("div", { class: "dim small" }, it.at + (it.pin ? ` · on ${pinLabel(it.pin)}` : "")) : ""));
      setTimeout(() => ta.focus(), 0);
    }
    return n;
  }

  const pinLabel = id => cards.has(id) ? id : "a text";

  function drawItem(id) {
    const it = data.items[id], old = nodes.get(id);
    if (!it) { if (old) old.remove(); nodes.delete(id); layout(); return; }
    const n = it.type === "text" ? textNode(id, it) : commentNode(id, it);
    if (old) old.replaceWith(n); else itemsBox.append(n);
    nodes.set(id, n);
    layout();
  }

  function drawItems() {
    itemsBox.replaceChildren();
    nodes.clear();
    for (const [id, it] of Object.entries(data.items)) {
      const n = it.type === "text" ? textNode(id, it) : commentNode(id, it);
      nodes.set(id, n);
      itemsBox.append(n);
    }
    layout();
  }

  // ----------------------------------------------------------- the toolbar and the pop-up

  function setTool(id) {
    tool = tools.some(t => t.id === id) ? id : "select";
    for (const [t, btn] of toolBtns) btn.classList.toggle("on", t === tool);
    board.dataset.tool = tool;
    cancelLine();
    say(tool === "line" ? "Click the thing the line starts from (Esc to stop)."
      : tool === "select" ? "" : `Click where it goes (Esc to stop).`);
  }

  function say(text) { hint.textContent = text; hint.hidden = !text; }

  function select(s) {
    sel = s && (data.items[s.id] || data.lines[s.id]) ? s : null;
    for (const [id, n] of nodes) n.classList.toggle("sel", !!sel && sel.id === id);
    drawLines();
    buildPop();
  }

  // What can be done to the selected thing, over it: a line's arrow, label and
  // Delete; a text's colour and Delete.
  function buildPop() {
    const ln = sel && data.lines[sel.id], it = sel && data.items[sel.id];
    if (ln) {
      const label = el("input", { value: ln.label || "", placeholder: "label", "aria-label": "Line label", class: "wblabel-in" });
      label.addEventListener("change", () => {
        ln.label = label.value.trim().slice(0, 200);
        save({ lines: { upsert: [{ id: sel.id, ...ln }] } });
        drawLines();
      });
      label.addEventListener("keydown", e => { if (e.key === "Enter") label.blur(); });
      pop.replaceChildren(
        el("button", { type: "button", class: "wbarrow" + (ln.arrow ? " on" : ""), title: "Arrowhead", "aria-pressed": String(!!ln.arrow),
          onclick: () => { ln.arrow = !ln.arrow; save({ lines: { upsert: [{ id: sel.id, ...ln }] } }); drawLines(); buildPop(); } }, "→"),
        label,
        el("button", { type: "button", class: "wbdelete", title: "Delete the line", onclick: () => removeThing(sel.id) }, "🗑"));
    } else if (it && it.type === "text") {
      pop.replaceChildren(
        ...Array.from({ length: 9 }, (_, c) => el("button", { type: "button", class: "wbswatch" + (c ? ` g${c - 1}` : " plain") + (it.colour === c ? " on" : ""),
          title: c ? "Colour" : "No colour", "aria-label": c ? `Colour ${c}` : "No colour",
          onclick: () => { it.colour = c; saveItem(sel.id); drawItem(sel.id); buildPop(); } })),
        el("button", { type: "button", class: "wbdelete", title: "Delete the text", onclick: () => removeThing(sel.id) }, "🗑"));
    } else {
      pop.hidden = true;
      return;
    }
    pop.hidden = false;
    movePop();
  }

  function movePop() {
    if (pop.hidden || !sel) return;
    let at = null;
    const ln = data.lines[sel.id];
    if (ln) {
      const a = boxOf(ln.from), b = boxOf(ln.to);
      if (a && b) at = [(centre(a)[0] + centre(b)[0]) / 2, (centre(a)[1] + centre(b)[1]) / 2 + 14];
    } else {
      const b = boxOf(sel.id);
      if (b) at = [b.x, b.y - 8];
    }
    if (!at) { pop.hidden = true; return; }
    pop.style.left = view.x + at[0] * view.z + "px";
    pop.style.top = view.y + at[1] * view.z + "px";
    pop.classList.toggle("above", !ln);
  }

  // ----------------------------------------------------------- changes

  // One batch to the server; on a refusal, the board as the server has it.
  function save(ops) {
    return api("/api/whiteboard", { kind: o.key.kind, ref: o.key.ref, client: me, ...ops })
      .catch(e => { if (o.onError) o.onError(String(e.message || e)); reload(); });
  }

  let viewTimer = null;
  function saveView() {
    clearTimeout(viewTimer);
    const v = { ...view };
    viewTimer = setTimeout(() => save({ view: v }), 600);
  }

  function saveItem(id) {
    const it = data.items[id];
    if (!it || (fresh.has(id) && !it.text.trim())) return;
    fresh.delete(id);
    save({ items: { upsert: [{ id, ...it }] } });
  }

  function place(t, x, y, on) {
    setTool("select");
    if (t === "text") {
      const id = newId();
      data.items[id] = { type: "text", x, y: y - 12, w: 220, text: "", colour: 0 };
      fresh.add(id);
      editing = id;
      drawItem(id);
      select({ kind: "item", id });
    } else if (t === "comment") {
      const id = newId();
      data.items[id] = { type: "comment", x: x - WB_COMMENT / 2, y: y - WB_COMMENT / 2, text: "", pin: on && pinnable(on) ? on : null, resolved: false };
      fresh.add(id);
      openComment = id;
      drawItem(id);
    } else {
      const host = (o.tools || []).find(h => h.id === t);
      if (host) host.at(x, y);
    }
  }

  function finishText(id, text) {
    if (editing !== id) return;
    editing = "";
    const it = data.items[id];
    if (!it) return;
    if (text === null ? !it.text.trim() : !text.trim()) { removeThing(id); return; } // nothing written: no text field
    if (text !== null && text !== it.text) { it.text = text.replace(/\r\n/g, "\n"); saveItem(id); }
    else if (fresh.has(id)) saveItem(id);
    drawItem(id);
    afterEdit();
  }

  function editText(id) {
    if (!data.items[id] || data.items[id].type !== "text") return;
    closeComment();
    editing = id;
    drawItem(id);
  }

  function keepComment(id, text) {
    const it = data.items[id];
    if (!it || text === it.text) return;
    it.text = text.replace(/\r\n/g, "\n");
    if (it.text.trim() || !fresh.has(id)) { fresh.delete(id); save({ items: { upsert: [{ id, ...it }] } }); }
  }

  function openC(id) {
    if (openComment && openComment !== id) closeComment();
    openComment = id;
    select(null);
    drawItem(id);
  }

  function closeComment() {
    const id = openComment;
    if (!id) return;
    openComment = "";
    const it = data.items[id];
    if (it && !it.text.trim()) { removeThing(id); return; } // an empty comment isn't kept
    drawItem(id);
    afterEdit();
  }

  function resolve(id, on) {
    const it = data.items[id];
    if (!it) return;
    it.resolved = on;
    saveItem(id);
    openComment = "";
    drawItem(id);
  }

  // Remove an item (its lines with it; the comments on it stay where they show)
  // or a line. A host card is the host's: never removed here.
  function removeThing(id) {
    if (data.items[id]) {
      const unpinned = [];
      for (const [cid, c] of Object.entries(data.items)) {
        if (c.pin === id) { [c.x, c.y] = commentAt(c); c.pin = null; unpinned.push({ id: cid, ...c }); }
      }
      const gone = Object.keys(data.lines).filter(l => data.lines[l].from === id || data.lines[l].to === id);
      for (const l of gone) delete data.lines[l];
      delete data.items[id];
      const wasFresh = fresh.delete(id);
      if (!wasFresh || gone.length || unpinned.length) save({ items: { upsert: unpinned, remove: [id] } });
    } else if (data.lines[id]) {
      delete data.lines[id];
      save({ lines: { remove: [id] } });
    } else return;
    if (editing === id) editing = "";
    if (openComment === id) openComment = "";
    if (sel && sel.id === id) sel = null;
    drawItems();
    buildPop();
    afterEdit();
  }

  function startLine(id) {
    lineFrom = id;
    const n = cards.has(id) ? cards.get(id).node : nodes.get(id);
    if (n) n.classList.add("linefrom");
    say("Now click the thing it goes to (Esc to stop).");
  }

  function cancelLine() {
    if (!lineFrom) return;
    for (const n of board.querySelectorAll(".linefrom")) n.classList.remove("linefrom");
    lineFrom = "";
  }

  function lineTo(id) {
    if (!id) { setTool("select"); return; }
    if (!lineFrom) { startLine(id); return; }
    if (id === lineFrom) return;
    const lid = newId();
    data.lines[lid] = { from: lineFrom, to: id, arrow: true, label: "" };
    save({ lines: { upsert: [{ id: lid, ...data.lines[lid] }] } });
    setTool("select");
    select({ kind: "line", id: lid });
  }

  // ----------------------------------------------------------- input

  let drag = null;
  const startOf = id => cards.has(id) ? [...data.cards[id]]
    : data.items[id].type === "comment" ? commentAt(data.items[id]) : [data.items[id].x, data.items[id].y, data.items[id].w];

  // The middle button moves the view, wherever it is pressed (a finger does too,
  // on the background, as there is no middle button on a touch screen). The
  // left and right buttons are for the things on the board: a left drag on the
  // background moves nothing.
  board.addEventListener("pointerdown", e => {
    const over = e.target.closest(".wbui, button, input, textarea, select, a");
    if (e.button === 1 || (e.pointerType === "touch" && !over && !e.target.closest("[data-wb], [data-line]"))) {
      if (over && e.button === 1 && e.target.closest(".wbui, textarea, input, select")) return;
      e.preventDefault();
      drag = { id: "", pan: true, x0: e.clientX, y0: e.clientY, moved: false, start: [view.x, view.y] };
      try { board.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: no capture needed */ }
      board.classList.add("panning");
      moving(true);
      return;
    }
    if (e.button !== 0 || over) return;
    let thing = e.target.closest("[data-wb]");
    if (openComment && (!thing || thing.dataset.wb !== openComment)) {
      closeComment();
      if (thing && nodes.has(thing.dataset.wb)) thing = nodes.get(thing.dataset.wb); // drawn again
    }
    const id = thing && (cards.has(thing.dataset.wb) || data.items[thing.dataset.wb]) ? thing.dataset.wb : "";
    if (tool === "line") { lineTo(id); return; }
    if (tool !== "select") { const [x, y] = toWorld(e.clientX, e.clientY); place(tool, x, y, id); return; }
    const line = !id && e.target.closest("[data-line]");
    if (line) { select({ kind: "line", id: line.dataset.line }); return; }
    if (editing && editing !== id) document.activeElement && document.activeElement.blur();
    drag = { id, grip: !!e.target.closest(".wbgrip"), x0: e.clientX, y0: e.clientY, moved: false, node: id ? thing : null,
      start: id ? startOf(id) : null };
    try { board.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: no capture needed */ }
  });
  // No autoscroll on a middle press, and the right button's menu is the board's
  // to use (a text being written keeps its own: spelling, paste).
  board.addEventListener("mousedown", e => { if (e.button === 1) e.preventDefault(); });
  board.addEventListener("auxclick", e => { if (e.button === 1) e.preventDefault(); });
  board.addEventListener("contextmenu", e => { if (!e.target.closest("input, textarea")) e.preventDefault(); });

  board.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const s = drag.start;
    if (!drag.id) {
      if (!drag.pan) return; // a left drag on the background: nothing to move
      view.x = s[0] + dx;
      view.y = s[1] + dy;
      queueView();
      return;
    }
    const kx = dx / view.z, ky = dy / view.z;
    if (cards.has(drag.id)) {
      data.cards[drag.id] = [s[0] + kx, s[1] + ky];
      positionCard(drag.id);
    } else {
      const it = data.items[drag.id];
      if (!it) return;
      if (drag.grip) it.w = Math.round(Math.max(80, Math.min(1200, s[2] + kx)));
      else {
        it.x = s[0] + kx;
        it.y = s[1] + ky;
        if (it.type === "comment") it.pin = null; // dragged off what it was on
      }
    }
    drag.node.classList.add("dragging");
    layout();
  });

  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    board.classList.remove("panning");
    if (d.pan) {
      flushView();
      settle();
      if (d.moved) saveView();
      return;
    }
    if (!d.id) {
      if (!d.moved) { if (openComment) closeComment(); select(null); }
      return;
    }
    d.node.classList.remove("dragging");
    if (d.moved) {
      if (cards.has(d.id)) {
        save({ cards: { [d.id]: data.cards[d.id] } });
        if (o.onMoved) o.onMoved(d.id);
      } else {
        // a comment let go over a card or a text pins to it
        const it = data.items[d.id];
        if (it && it.type === "comment") {
          const b = boxOf(d.id), c = centre(b);
          const on = [...cards.keys(), ...Object.keys(data.items).filter(k => data.items[k].type === "text")]
            .find(k => { const t = boxOf(k); return t && c[0] >= t.x && c[0] <= t.x + t.w && c[1] >= t.y && c[1] <= t.y + t.h; });
          if (on) it.pin = on;
        }
        saveItem(d.id);
        layout();
      }
    } else if (cards.has(d.id)) { if (o.onOpen) o.onOpen(d.id); }
    else if (data.items[d.id].type === "comment") openC(d.id);
    else select({ kind: "item", id: d.id });
  };
  board.addEventListener("pointerup", end);
  board.addEventListener("pointercancel", end);

  board.addEventListener("dblclick", e => {
    if (e.target.closest(".wbui, textarea, input")) return;
    const t = e.target.closest(".wbtext");
    if (t) editText(t.dataset.wb);
    else if (!e.target.closest("[data-wb], [data-line]") && tool === "select") {
      const [x, y] = toWorld(e.clientX, e.clientY);
      place("text", x, y, "");
    }
  });

  board.addEventListener("wheel", e => {
    if (e.target.closest(".wbui, textarea")) return;
    e.preventDefault();
    moving();
    const r = rect || (rect = board.getBoundingClientRect()); // read once a burst of wheel turns
    zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top, true);
  }, { passive: false });

  board.addEventListener("keydown", e => {
    if (e.target.closest("input, textarea, select")) return;
    const on = e.target.closest && e.target.closest("[data-wb]");
    const id = on ? on.dataset.wb : "";
    if (id && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      if (cards.has(id)) { if (o.onOpen) o.onOpen(id); }
      else if (data.items[id] && data.items[id].type === "text") editText(id);
      else if (data.items[id]) openC(id);
      return;
    }
    if (e.key === "Escape") {
      if (lineFrom || tool !== "select") setTool("select");
      else if (openComment) closeComment();
      else if (sel) select(null);
      else if (o.onEscape) o.onEscape();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); removeThing(sel.id); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(1 / 1.25);
    else {
      const t = tools.find(x => x.key === e.key.toLowerCase());
      if (t) setTool(t.id);
    }
  });

  // ----------------------------------------------------------- the view

  // Zoom about a point of the board (its centre by default), keeping it still;
  // soon: drawn on the next frame (the wheel), not now.
  function zoomBy(f, cx, cy, soon) {
    if (cx === undefined) { const r = board.getBoundingClientRect(); cx = r.width / 2; cy = r.height / 2; }
    const z = clampZ(view.z * f), k = z / view.z;
    view = { x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, z };
    if (soon) queueView(); else applyView(false);
    saveView();
  }

  // Frame these things (everything when ids is null): zoom and pan so they fill
  // the board, the corner panel's side left clear.
  function frame(ids, ease) {
    const all = ids || [...cards.keys(), ...Object.keys(data.items)];
    const boxes = all.map(boxOf).filter(Boolean);
    if (!boxes.length) return;
    const from = { ...view };
    const minX = Math.min(...boxes.map(b => b.x)), minY = Math.min(...boxes.map(b => b.y));
    const maxX = Math.max(...boxes.map(b => b.x + b.w)), maxY = Math.max(...boxes.map(b => b.y + b.h));
    const r = board.getBoundingClientRect(), pad = 48, right = o.corner ? Math.min(260, r.width * 0.3) : 0;
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const z = clampZ(Math.min(1.4, (r.width - right - pad * 2) / w, (r.height - pad * 2) / h));
    view = { z, x: pad + ((r.width - right - pad * 2) - w * z) / 2 - minX * z, y: pad + ((r.height - pad * 2) - h * z) / 2 - minY * z };
    applyView(ease, from);
    saveView();
  }

  // A labelled frame round these things (none: no frame), in a colour class.
  function outline(ids, label, cls) {
    const boxes = (ids || []).map(boxOf).filter(Boolean);
    frameBox.hidden = !boxes.length;
    if (!boxes.length) return;
    const minX = Math.min(...boxes.map(b => b.x)) - 14, minY = Math.min(...boxes.map(b => b.y)) - 30;
    frameBox.className = "gframe" + (cls ? " " + cls : "");
    frameBox.style.left = minX + "px";
    frameBox.style.top = minY + "px";
    frameBox.style.width = Math.max(...boxes.map(b => b.x + b.w)) + 14 - minX + "px";
    frameBox.style.height = Math.max(...boxes.map(b => b.y + b.h)) + 14 - minY + "px";
    frameBox.textContent = label || "";
  }

  // ----------------------------------------------------------- the host's cards, and keeping up

  function setCards(list) {
    const keep = new Set(list.map(c => c.id));
    for (const [id, c] of cards) if (!keep.has(id)) { c.node.remove(); cards.delete(id); }
    const placed = {};
    for (const c of list) {
      const old = cards.get(c.id);
      if (old && old.node !== c.node) old.node.remove();
      c.node.classList.add("wbcard");
      c.node.dataset.wb = c.id;
      cards.set(c.id, { node: c.node, w: c.w, h: c.h });
      if (!Array.isArray(data.cards[c.id])) {
        data.cards[c.id] = o.place ? o.place(c.id, data.cards) : [0, 0];
        placed[c.id] = data.cards[c.id];
      }
      if (c.node.parentNode !== cardsBox) cardsBox.append(c.node);
      positionCard(c.id);
    }
    if (Object.keys(placed).length) save({ cards: placed });
    layout();
  }

  // The board as the server has it now (another window changed it). Put off
  // while a text or a comment is being written, so the words aren't lost.
  function take(d) {
    if (editing || openComment) { pending = d || true; return; }
    const keep = Object.fromEntries([...fresh].filter(id => data.items[id]).map(id => [id, data.items[id]]));
    const next = norm(d);
    data = { ...next, items: { ...next.items, ...keep } };
    for (const id of cards.keys()) positionCard(id);
    if (sel && !data.items[sel.id] && !data.lines[sel.id]) sel = null;
    drawItems();
    buildPop();
  }

  async function reload() {
    try { take(await api(`/api/whiteboard?kind=${encodeURIComponent(o.key.kind)}&ref=${encodeURIComponent(o.key.ref)}`)); }
    catch { /* the next change or event tries again */ }
  }

  function afterEdit() {
    if (!pending || editing || openComment) return;
    const d = pending;
    pending = false;
    if (d === true) reload(); else take(d);
  }

  let seen = false;
  const onEvent = e => {
    if (!board.isConnected) { if (seen) document.removeEventListener("tt-event", onEvent); return; }
    seen = true;
    const ev = e.detail;
    if (ev.type === "whiteboard" && ev.kind === o.key.kind && ev.ref === o.key.ref && ev.client !== me) {
      if (editing || openComment) pending = true; else reload();
    }
  };
  document.addEventListener("tt-event", onEvent);

  setTool("select");
  drawItems();
  applyView(false);
  return { element: board, setCards, frame, outline, zoomBy, toWorld, setTool, reload: take,
    cardAt: id => data.cards[id] };
}
