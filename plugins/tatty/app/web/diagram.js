// A generated diagram (server.py "diagrams"; diagram.py reads the code): classes as boxes in a
// simplified class diagram (a «stereotype», the name, a few members), in frames for the groups
// they are in (area > assembly > namespace), with the links between them: inherits and implements
// (a hollow triangle), has (a field or property of that type: a filled arrow), creates and uses (an
// open arrow), data flow (a thick one, from a plan). Drawn on the whiteboard (whiteboard.js), read-only:
// boxes drag (where a person puts one is kept, kind "diagram"), the view pans and zooms.
//   Zoomed out, the innermost open groups turn solid (one tile the size of the frame, its links
//   lifted to it), then the groups round those: the picture keeps its place, only the detail goes.
//   Opening or closing a group lays the diagram out again.
//   A review or a plan has units (work units, or the plan's steps): each can be turned off, and
//   what only it added goes. The layout is made with every unit on, so things stay where they are.
//   Unchanged types a change links to are greyed.
// diagramPanel(o) is the whole page part (made / stale / Generate, the progress of a run, the
// diagram); makeDiagram(o) the diagram itself. Hosts: features.js (#feature/<n>/diagram) and
// the Project diagram page (#diagram).
// Uses app.js's el and api, ids.js's place (the hover card's spot), usage.js's fmtUsd.
"use strict";

const DG_W = 248, DG_MEMBER_H = 17, DG_HEAD_H = 48, DG_MEMBERS = 5;
const DG_GROUP_W = 230, DG_GROUP_H = 76;
const DG_SOLID = [0.4, 0.22]; // below the first, the innermost open groups go solid; below the second, the next ones out too
const DG_MAX_LINES = 1500;
const DG_READ = 0.6; // the zoom a class's words read at
const DG_SWAP_MS = 220; // how long the zoom must rest before the detail changes
const DG_BUSY = 40, DG_PER_BOX = 3; // more boxes drawn than DG_BUSY: each keeps its DG_PER_BOX strongest links
const DG_KINDS = [
  { id: "inherits", label: "inherits", end: "tri" },
  { id: "implements", label: "implements", end: "tri" },
  { id: "has", label: "has (a field)", end: "arrow" },
  { id: "creates", label: "creates", end: "open" },
  { id: "uses", label: "uses", end: "open" },
  { id: "dataflow", label: "data flow", end: "arrow" },
];
const DG_RANK = { inherits: 0, implements: 0, has: 1, creates: 2, uses: 3, dataflow: 4 };
const DG_STATES = { added: "added", changed: "changed", touched: "edited", removed: "removed", planned: "planned", unchanged: "unchanged" };

// makeDiagram(o) -> { element, refresh(view) }. o:
//   view: GET /api/diagram's answer (groups, gedges, nodes, edges, units, counts)
//   board: { data, ref }: the whiteboard of kind "diagram" (where boxes were dragged, the view)
//   scope: "project" | "feature"; fetchGroup(id) -> { nodes, edges, ends } (project: a group's classes)
//   onSummarise(ids): ask for summaries (the hover card's button)
function makeDiagram(o) {
  const S = {
    groups: new Map(), nodes: new Map(), edges: new Map(), gedges: [], ends: new Map(), loaded: new Set(),
    expanded: new Set(), pins: {}, kinds: new Set(DG_KINDS.map(k => k.id)), units: [], on: new Set(),
    unchanged: true, focus: "", hover: "", context: "", search: "", solid: 0, layout: null, layoutKey: "",
  };
  const project = o.scope === "project";
  const store = `tatty.diagram.${o.board.ref}`;

  function take(view) {
    S.groups.clear();
    for (const g of view.groups || []) S.groups.set(g.id, { ...g, kids: [], nodes: [], count: 0 });
    for (const g of S.groups.values()) if (g.parent && S.groups.has(g.parent)) S.groups.get(g.parent).kids.push(g.id);
    S.gedges = view.gedges || [];
    S.nodes.clear(); S.edges.clear(); S.ends.clear(); S.loaded.clear();
    if (!project) {
      for (const g of S.groups.values()) if (!g.kids.length) S.loaded.add(g.id);
      addNodes(view.nodes || [], view.edges || [], {});
    }
    const counts = view.counts || {};
    for (const [gid, n] of Object.entries(counts)) { for (let g = S.groups.get(gid); g; g = S.groups.get(g.parent)) g.count += n; }
    if (!project) for (const n of S.nodes.values()) for (let g = S.groups.get(n.group); g; g = S.groups.get(g.parent)) g.count++;
    S.units = view.units || [];
    S.on = new Set(S.units.map(u => u.id));
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(store) || "null"); } catch { saved = null; }
    // first look: a review or a plan opens the groups with a change in them; the unchanged types
    // they reach stay closed (a greyed tile) until opened
    S.expanded = new Set(saved && Array.isArray(saved.open) ? saved.open.filter(id => S.groups.has(id))
      : project ? [] : [...S.groups.keys()].filter(changedIn));
    if (saved && Array.isArray(saved.kinds)) S.kinds = new Set(saved.kinds);
    S.layoutKey = "";
  }

  // A group with a changed (added, removed, planned ...) type somewhere in it.
  function changedIn(gid) {
    const g = S.groups.get(gid);
    return !!g && (g.nodes.some(n => S.nodes.get(n).state !== "unchanged") || g.kids.some(changedIn));
  }

  function addNodes(nodes, edges, ends) {
    for (const n of nodes) {
      S.nodes.set(n.id, n);
      const g = S.groups.get(n.group);
      if (g && !g.nodes.includes(n.id)) g.nodes.push(n.id);
    }
    for (const e of edges) S.edges.set(e.id, e);
    for (const [id, g] of Object.entries(ends || {})) if (g) S.ends.set(id, g);
  }

  const keep = () => { try { localStorage.setItem(store, JSON.stringify({ open: [...S.expanded], kinds: [...S.kinds] })); } catch { /* private mode */ } };

  // ----------------------------------------------------------- what is shown

  const unitsOn = x => !S.units.length || !(x.units && x.units.length) || x.units.some(u => S.on.has(u));
  const changedLook = n => n.state !== "unchanged" && unitsOn(n);
  // A box is shown: a change (added, removed, planned) only while one of its units is on; a changed
  // type always (it was there before); an unchanged one while it links to a change that is shown.
  function shownNodes() {
    const shown = new Set();
    for (const n of S.nodes.values()) {
      if (n.state === "unchanged") continue;
      if ((n.state === "added" || n.state === "removed" || n.state === "planned") && !unitsOn(n)) continue;
      shown.add(n.id);
    }
    if (project) { for (const n of S.nodes.values()) shown.add(n.id); return shown; }
    if (S.unchanged) {
      for (const e of S.edges.values()) {
        if (!S.kinds.has(e.kind) || !unitsOn(e)) continue;
        const a = S.nodes.get(e.from), b = S.nodes.get(e.to);
        if (!a || !b) continue;
        if (shown.has(a.id) && b.state === "unchanged" && changedLook(a)) shown.add(b.id);
        if (shown.has(b.id) && a.state === "unchanged" && changedLook(b)) shown.add(a.id);
      }
    }
    return shown;
  }

  // The tree to lay out: open groups are frames, closed ones tiles, classes cards. allOn: every
  // unit on (the layout), else what the units now on show.
  function tree(shown) {
    const frameLabel = {};
    const visit = gid => {
      const g = S.groups.get(gid);
      if (!g) return null;
      if (!S.expanded.has(gid)) {
        if (!project && !hasShown(gid, shown)) return null;
        return { id: "g:" + gid, w: DG_GROUP_W, h: DG_GROUP_H, group: gid };
      }
      const kids = [];
      for (const k of sortBy(g.kids, id => S.groups.get(id).label)) { const v = visit(k); if (v) kids.push(v); }
      if (project && !g.kids.length && !S.loaded.has(gid)) kids.push({ id: "w:" + gid, w: DG_W, h: 50, wait: gid });
      for (const nid of sortBy(g.nodes, id => S.nodes.get(id).label)) if (shown.has(nid)) kids.push(cardSize(S.nodes.get(nid)));
      if (!kids.length) return null;
      // a group with one group in it and nothing else: one frame, both names on it
      if (kids.length === 1 && kids[0].frame) {
        frameLabel[kids[0].id] = short(g) + " › " + (frameLabel[kids[0].id] || short(S.groups.get(kids[0].group)));
        return kids[0];
      }
      return { id: "f:" + gid, frame: true, group: gid, kids, minW: 200 };
    };
    const roots = sortBy([...S.groups.values()].filter(g => !g.parent || !S.groups.has(g.parent)).map(g => g.id), id => S.groups.get(id).label);
    const kids = roots.map(visit).filter(Boolean);
    return { kids, frameLabel };
  }

  const hasShown = (gid, shown) => {
    const g = S.groups.get(gid);
    return g.nodes.some(n => shown.has(n)) || g.kids.some(k => hasShown(k, shown));
  };
  const sortBy = (ids, f) => [...ids].sort((a, b) => String(f(a)).localeCompare(String(f(b))));

  function cardSize(n) {
    const m = Math.min(DG_MEMBERS, (n.members || []).length);
    const more = (n.members || []).length > DG_MEMBERS ? 1 : 0;
    return { id: "c:" + n.id, w: DG_W, h: DG_HEAD_H + (m + more) * DG_MEMBER_H + (m ? 10 : 0), node: n.id };
  }

  // A group's name, without its parent's name in front (Game.Core › ….Client.Data).
  function short(g) {
    if (!g) return "";
    const p = S.groups.get(g.parent);
    return p && g.label.startsWith(p.label + ".") ? "…" + g.label.slice(p.label.length) : g.label;
  }

  // ----------------------------------------------------------- the board

  const wbData = o.board.data || {};
  let ready = false;
  S.pins = { ...(wbData.cards || {}) }; // where a person dragged things
  const wb = makeWhiteboard({
    id: o.id || "dgboard", key: { kind: "diagram", ref: o.board.ref }, data: wbData, readOnly: true,
    savePlaced: false, zmin: 0.06, place: id => (S.layout && S.layout.pos[id]) || [0, 0],
    onOpen: id => open(id), onZoom: z => zoomed(z), onDragging: id => dragging(id),
    onMoved: id => moved(id), onEscape: () => { if (S.focus) setFocus(""); },
    empty: "Nothing to show with these choices.",
  });
  const frameEls = new Map(); // frame id -> node
  const cardEls = new Map(); // card id -> { node, w, h, look }
  let built = null; // { t, frames, parentFrame, cards, rects }
  let lastDrawn = null, lastSolid = new Set(); // what the last render drew (the lines are drawn again on hover)

  function layout(shownAll) {
    const t = tree(shownAll);
    const key = JSON.stringify([[...S.expanded].sort(), [...S.loaded].sort(), shownAll.size, [...S.kinds].sort()]);
    if (key !== S.layoutKey) {
      const cards = new Set();
      const walk = n => { if (n.frame) n.kids.forEach(walk); else cards.add(n.id); };
      t.kids.forEach(walk);
      S.layout = layoutTree(t, layoutLinks(cards, t));
      S.layoutKey = key;
    }
    return t;
  }

  // The links the layout uses: between the cards they land on, inherits before the rest.
  function layoutLinks(cards, t) {
    const rep = repFor(cards, new Set());
    const out = [];
    for (const e of S.edges.values()) {
      if (!S.kinds.has(e.kind)) continue;
      const a = rep(e.from), b = rep(e.to);
      if (a && b && a !== b) out.push([a, b, DG_RANK[e.kind]]);
    }
    if (project) for (const g of S.gedges) {
      if (S.loaded.has(g.from) || S.loaded.has(g.to)) continue;
      const a = repGroup(g.from, cards, new Set()), b = repGroup(g.to, cards, new Set());
      if (a && b && a !== b) out.push([a, b, 3]);
    }
    return out.sort((x, y) => x[2] - y[2]).map(x => [x[0], x[1]]);
  }

  // Which card a class's links go to: its own when it is drawn, else the nearest group drawn
  // (a closed tile, or a solid frame).
  function repFor(cards, solid) {
    return id => {
      if (cards.has("c:" + id)) return "c:" + id;
      const n = S.nodes.get(id);
      const g = n ? n.group : S.ends.get(id);
      return g ? repGroup(g, cards, solid) : null;
    };
  }
  function repGroup(gid, cards, solid) {
    let best = null;
    for (let g = S.groups.get(gid); g; g = S.groups.get(g.parent)) {
      if (cards.has("g:" + g.id)) best = "g:" + g.id;
      if (solid.has("f:" + g.id)) best = "s:" + g.id;
    }
    return best;
  }

  // ----------------------------------------------------------- drawing

  function render(relayout) {
    if (relayout) S.layoutKey = "";
    const allUnits = S.on;
    S.on = new Set(S.units.map(u => u.id));
    const shownAll = shownNodes();
    S.on = allUnits;
    const t = layout(shownAll);
    const shown = shownNodes();
    // frames and which frame each thing is in
    const frames = new Map(), parentFrame = new Map(), cards = new Map();
    const walk = (n, pf) => {
      parentFrame.set(n.id, pf);
      if (n.frame) { frames.set(n.id, n); n.kids.forEach(k => walk(k, n.id)); }
      else cards.set(n.id, n);
    };
    t.kids.forEach(k => walk(k, ""));
    built = { t, frames, parentFrame, cards };
    // the solid frames at this zoom: innermost first
    const depth = new Map();
    // (how many frames down the nearest classes are: a frame of closed groups only has no detail to hide)
    const depthOf = f => {
      if (depth.has(f.id)) return depth.get(f.id);
      const own = f.kids.some(k => !k.frame && !k.group);
      const below = f.kids.filter(k => k.frame).map(depthOf).filter(d => d !== Infinity);
      const d = below.length ? Math.max(...below) + 1 : own ? 0 : Infinity;
      depth.set(f.id, d);
      return d;
    };
    const solid = new Set();
    for (const f of frames.values()) if (depthOf(f) < S.solid) solid.add(f.id);
    // a solid frame inside another solid one isn't drawn: the outer one is
    const underSolid = id => { for (let p = parentFrame.get(id); p; p = parentFrame.get(p)) if (solid.has(p)) return true; return false; };
    const pos = id => S.pins[id] || (S.layout && S.layout.pos[id]) || [0, 0];
    const rects = frameRects(t, pos);
    built.rects = rects;
    // the cards drawn
    const list = [], place = {};
    for (const c of cards.values()) {
      if (underSolid(c.id)) continue;
      if (c.node && !shown.has(c.node)) continue;
      list.push(cardFor(c));
      place[c.id] = pos(c.id);
    }
    for (const f of solid) {
      if (underSolid(f)) continue;
      const r = rects.get(f);
      if (!r) continue;
      const gid = frames.get(f).group, sid = "s:" + gid;
      list.push(solidFor(gid, r, t.frameLabel[f]));
      place[sid] = [r.x, r.y];
    }
    wb.setCards(list);
    wb.placeCards(place);
    drawFrames(rects, solid, underSolid, t.frameLabel);
    lastDrawn = new Set(list.map(c => c.id));
    lastSolid = solid;
    drawLines(lastDrawn, solid);
    markFocus();
  }

  // Each frame's box from where its cards and frames are now (a dragged card stretches its frame).
  function frameRects(t, pos) {
    const rects = new Map();
    const box = n => {
      if (!n.frame) { const p = pos(n.id); return { x: p[0], y: p[1], w: n.w, h: n.h }; }
      const kids = n.kids.map(box);
      const x0 = Math.min(...kids.map(b => b.x)) - DL_PAD, y0 = Math.min(...kids.map(b => b.y)) - DL_HEAD;
      const x1 = Math.max(...kids.map(b => b.x + b.w)) + DL_PAD, y1 = Math.max(...kids.map(b => b.y + b.h)) + DL_PAD;
      const r = { x: x0, y: y0, w: Math.max(n.minW || 0, x1 - x0), h: y1 - y0 };
      rects.set(n.id, r);
      return r;
    };
    t.kids.forEach(box);
    return rects;
  }

  function drawFrames(rects, solid, underSolid, labels) {
    const keepIds = new Set();
    for (const [fid, r] of rects) {
      if (solid.has(fid) || underSolid(fid)) continue;
      keepIds.add(fid);
      let n = frameEls.get(fid);
      const gid = fid.slice(2), g = S.groups.get(gid);
      const label = labels[fid] || short(g);
      if (!n || n.dataset.label !== label) {
        const nn = el("div", { class: `dgframe lv${Math.min(3, g ? g.level : 0)}`, "data-label": label },
          el("div", { class: "dgframe-head" },
            el("button", { type: "button", class: "dgframe-close wbui", title: `Close ${g ? g.label : ""}`, "aria-label": "Close the group",
              onclick: e => { e.stopPropagation(); toggle(gid, false); } }, "▾"),
            el("span", { class: "dgframe-label", title: g ? g.label : "" }, label),
            el("span", { class: "dim small" }, g && g.count ? ` ${g.count}` : "")));
        if (n) n.replaceWith(nn); else wb.back.append(nn);
        frameEls.set(fid, nn);
        n = nn;
      }
      n.style.left = r.x + "px"; n.style.top = r.y + "px";
      n.style.width = r.w + "px"; n.style.height = r.h + "px";
    }
    for (const [fid, n] of frameEls) if (!keepIds.has(fid)) { n.remove(); frameEls.delete(fid); }
  }

  // ----------------------------------------------------------- the boxes

  function cardFor(c) {
    if (c.wait) return reuse(c.id, "wait", () => el("div", { class: "dgcard dgwait dim" }, "Loading its classes…"), c);
    if (c.group) {
      const g = S.groups.get(c.group);
      const quiet = !project && !changedIn(g.id); // only unchanged types a change reaches
      const look = `g|${g.label}|${g.count}|${hit(g.label)}|${quiet}`;
      return reuse(c.id, look, () => el("div", { class: `dggroup lv${Math.min(3, g.level)}` + (quiet ? " dg-quiet" : "") + (hit(g.label) ? " dg-hit" : ""), tabindex: "0", role: "button",
        "aria-label": `Open ${g.label}` },
      el("div", { class: "dggroup-kind dim small" }, levelName(g)),
      el("div", { class: "dggroup-name", title: g.label }, short(g)),
      el("div", { class: "dim small" }, (g.count ? `${g.count}${quiet ? " unchanged" : ""} type${g.count === 1 ? "" : "s"} · ` : "") + "open ▸")), c);
    }
    const n = S.nodes.get(c.node);
    const st = changedLook(n) ? n.state : "unchanged";
    const look = `c|${st}|${hit(n.label)}|${(n.members || []).length}`;
    return reuse(c.id, look, () => {
      const ms = orderMembers(n.members || []).slice(0, DG_MEMBERS);
      const more = (n.members || []).length - ms.length;
      return el("div", { class: `dgcard dg-${st}` + (hit(n.label) ? " dg-hit" : ""), tabindex: "0", role: "button", "aria-label": n.label },
        el("div", { class: "dgcard-head" },
          el("div", { class: "dgstereo" }, n.stereo && n.stereo !== "class" ? `«${n.stereo}»` : "", st !== "unchanged" ? el("span", { class: "dgstate" }, DG_STATES[st] || st) : ""),
          el("div", { class: "dgname", title: n.id }, n.label)),
        ms.length ? el("ul", { class: "dgmembers" }, ms.map(m => el("li", { class: "dgm " + (st !== "unchanged" && m.state ? "m-" + m.state : ""), title: m.sig },
          el("span", { class: "dgvis" }, VIS[m.vis] || "·"), memberText(m)))) : "",
        more > 0 ? el("div", { class: "dgmore dim small" }, `+${more} more`) : "");
    }, c);
  }

  function solidFor(gid, r, label) {
    const g = S.groups.get(gid);
    const sid = "s:" + gid;
    const look = `s|${Math.round(r.w)}x${Math.round(r.h)}|${label || ""}|${g.count}`;
    return reuse(sid, look, () => {
      // the name as big as the tile allows, so it reads at the zoom the tile is drawn at
      const name = el("div", { class: "dgsolid-name", title: g.label }, label || short(g));
      const n = el("div", { class: "dgsolid-n" }, g.count ? `${g.count} type${g.count === 1 ? "" : "s"}` : "");
      const len = Math.max(8, (label || short(g)).length);
      const px = Math.round(Math.max(40, Math.min(r.w * 1.6 / len, r.h / 4, 900)));
      name.style.fontSize = px + "px";
      n.style.fontSize = Math.round(px * 0.6) + "px";
      return el("div", { class: `dgsolid lv${Math.min(3, g.level)}`, tabindex: "0", role: "button", "aria-label": g.label }, name, n);
    }, { w: r.w, h: r.h });
  }

  function reuse(id, look, make, size) {
    const cur = cardEls.get(id);
    if (cur && cur.look === look && cur.w === size.w && cur.h === size.h) return { id, node: cur.node, w: cur.w, h: cur.h };
    const node = make();
    node.classList.add("dgbox");
    if (size.w) node.style.width = size.w + "px";
    if (size.h) node.style.height = size.h + "px";
    cardEls.set(id, { node, look, w: size.w, h: size.h });
    return { id, node, w: size.w, h: size.h };
  }

  const VIS = { public: "+", protected: "#", internal: "~", private: "−" };
  const orderMembers = ms => [...ms].sort((a, b) => (b.state ? 1 : 0) - (a.state ? 1 : 0)
    || "public protected internal private".indexOf(a.vis) - "public protected internal private".indexOf(b.vis));
  const memberText = m => m.sig.replace(/^((public|private|protected|internal|static|override|virtual|abstract|readonly|sealed|async|new|extern|const|event)\s+)+/g, "");
  const levelName = g => g.id.startsWith("r:") ? "area" : g.id.startsWith("a:") ? "assembly" : "namespace";
  const hit = label => !!S.search && String(label).toLowerCase().includes(S.search);

  // ----------------------------------------------------------- the lines

  function drawLines(drawn, solid) {
    const rep = repFor(new Set([...drawn].filter(id => id.startsWith("c:") || id.startsWith("g:"))), solid);
    const pairs = new Map();
    const add = (a, b, kind, n, st, label) => {
      if (!a || !b || a === b || !drawn.has(a) || !drawn.has(b)) return;
      const flow = kind === "dataflow"; // (its own line, with what flows on it: never folded into a stronger kind)
      const key = `${a}>${b}` + (flow ? "~flow" : "");
      let p = pairs.get(key);
      if (!p) pairs.set(key, p = { a, b, kinds: {}, n: 0, states: new Set(), label: "", flow });
      p.kinds[kind] = (p.kinds[kind] || 0) + n;
      p.n += n;
      p.states.add(st);
      if (label && !p.label) p.label = label;
    };
    for (const e of S.edges.values()) {
      if (!S.kinds.has(e.kind) || !unitsOn(e)) continue;
      const st = e.state === "unchanged" || !unitsOn(e) ? "unchanged" : e.state;
      add(rep(e.from), rep(e.to), e.kind, 1, st, e.label || "");
    }
    if (project) for (const g of S.gedges) {
      if (S.loaded.has(g.from) || S.loaded.has(g.to)) continue;
      const a = repGroup(g.from, drawnSet(drawn), solid), b = repGroup(g.to, drawnSet(drawn), solid);
      for (const [k, n] of Object.entries(g.kinds)) if (S.kinds.has(k)) add(a, b, k, n, "unchanged", "");
    }
    let lines = [...pairs.values()];
    // Many tiles: each keeps only its strongest few links (a tangle shows nothing); the one in
    // focus or under the pointer keeps all of its own.
    const near = S.focus || S.hover;
    if (drawn.size > DG_BUSY) {
      const best = new Map();
      for (const p of lines) for (const end of [p.a, p.b]) { if (!best.has(end)) best.set(end, []); best.get(end).push(p); }
      const keepSet = new Set();
      for (const list of best.values()) list.sort((x, y) => y.n - x.n).slice(0, DG_PER_BOX).forEach(p => keepSet.add(p));
      lines = lines.filter(p => keepSet.has(p) || p.a === near || p.b === near);
    }
    if (lines.length > DG_MAX_LINES) lines = lines.sort((x, y) => y.n - x.n).slice(0, DG_MAX_LINES);
    S.cut = pairs.size - lines.length;
    const featureDim = !project;
    wb.setLines(lines.map(p => {
      const kind = Object.keys(p.kinds).sort((x, y) => DG_RANK[x] - DG_RANK[y])[0];
      const st = p.states.has("added") ? "added" : p.states.has("removed") ? "removed" : "unchanged";
      const end = DG_KINDS.find(k => k.id === kind).end;
      const mine = near && touchesFocus(p, near);
      const label = p.label || (mine && p.n > 1 ? String(p.n) : "");
      const faint = !near && S.context && !inContext(p.a) && !inContext(p.b);
      return { id: `${p.a}>${p.b}` + (p.flow ? "~flow" : ""), from: p.a, to: p.b, end, label: p.flow ? p.label || label : label,
        cls: `k-${kind} st-${st}` + (near && !mine ? " dg-off" : mine ? " dg-near" : faint ? " dg-faint" : ""),
        dim: featureDim && st === "unchanged" };
    }));
    if (o.onCount) o.onCount({ lines: lines.length, cut: S.cut });
  }
  const drawnSet = d => new Set([...d].filter(id => id.startsWith("g:")));
  const touchesFocus = (p, id) => p.a === id || p.b === id;
  // A drawn box is inside the group opened last (links with neither end in it are drawn faint).
  function inContext(id) {
    if (!S.context || !built) return true;
    const f = "f:" + S.context;
    if (id === "s:" + S.context) return true;
    for (let p = built.parentFrame.get(id); p; p = built.parentFrame.get(p)) if (p === f) return true;
    return false;
  }

  // ----------------------------------------------------------- doing things

  function open(id) {
    if (id.startsWith("g:")) { toggle(id.slice(2), true); return; }
    if (id.startsWith("s:")) { zoomInOn(id); return; }
    if (id.startsWith("c:")) setFocus(S.focus === id ? "" : id);
  }

  async function toggle(gid, on) {
    // a group with one group in it and nothing else opens that one too (and so on down)
    if (on) for (let g = S.groups.get(gid); g && g.kids.length === 1 && !g.nodes.length; g = S.groups.get(g.kids[0])) {
      S.expanded.add(g.id);
      gid = g.kids[0];
    }
    if (on) S.expanded.add(gid); else S.expanded.delete(gid);
    S.context = on ? gid : S.groups.get(gid) && S.expanded.has(S.groups.get(gid).parent) ? S.groups.get(gid).parent : "";
    keep();
    hidePeek();
    if (on && project && !S.groups.get(gid).kids.length && !S.loaded.has(gid)) {
      render(true);
      try {
        const got = await o.fetchGroup(gid);
        addNodes(got.nodes || [], got.edges || [], got.ends || {});
      } catch (e) { if (o.onError) o.onError(String(e.message || e)); }
      S.loaded.add(gid);
    }
    render(true);
    if (on) setTimeout(() => { const f = built && built.rects.get("f:" + gid); if (f) wb.frame(framedIds(gid), true); }, 0);
  }

  // The cards and tiles inside a group (to frame the view on it).
  function framedIds(gid) {
    const out = [];
    for (const [id] of built.cards) {
      for (let p = built.parentFrame.get(id); p; p = built.parentFrame.get(p)) if (p === "f:" + gid) { out.push(id); break; }
    }
    return out.length ? out : null;
  }

  // A solid group clicked: its classes, near enough to read (a big group is then panned round).
  function zoomInOn(sid) {
    const ids = framedIds(sid.slice(2));
    clearTimeout(solidTimer);
    S.solid = 0;
    render(false);
    wb.frame(ids, true);
    const z = wb.view().z;
    if (z < DG_READ) wb.zoomBy(DG_READ / z);
  }

  function setFocus(id) {
    S.focus = id;
    render(false);
  }

  // A focused class: it and what it links to stand out, the rest steps back.
  function markFocus() {
    const near = new Set();
    if (S.focus) {
      near.add(S.focus);
      const id = S.focus.slice(2);
      for (const e of S.edges.values()) {
        if (e.from === id) near.add("c:" + e.to);
        if (e.to === id) near.add("c:" + e.from);
      }
    }
    for (const [cid, c] of cardEls) c.node.classList.toggle("dg-off", !!S.focus && !near.has(cid));
    for (const [cid, c] of cardEls) c.node.classList.toggle("dg-focus", cid === S.focus);
  }

  function zoomed(z) {
    if (!ready) return; // (the board tells the first zoom while it is being made)
    wb.element.classList.toggle("dg-far", z < 0.5);
    const solid = z < DG_SOLID[1] ? 2 : z < DG_SOLID[0] ? 1 : 0;
    clearTimeout(solidTimer);
    if (solid === S.solid) return;
    // the detail swaps once the zoom pauses: rebuilding the boxes mid-gesture would hitch it
    solidTimer = setTimeout(() => {
      S.solid = solid;
      hidePeek();
      if (built) render(false);
    }, DG_SWAP_MS);
  }
  let solidTimer = 0;

  let frameQueued = 0;
  function dragging(id) {
    if (frameQueued || !built) return;
    frameQueued = requestAnimationFrame(() => {
      frameQueued = 0;
      const p = wb.cardAt(id);
      if (p) S.pins[id] = p;
      const pos = cid => S.pins[cid] || (S.layout && S.layout.pos[cid]) || [0, 0];
      built.rects = frameRects(built.t, pos);
      drawFrames(built.rects, new Set(), () => false, built.t.frameLabel);
    });
  }

  function moved(id) {
    const p = wb.cardAt(id);
    if (!p) return;
    if (id.startsWith("s:")) { // a solid group dragged: everything in it goes with it
      const gid = id.slice(2), r = built.rects.get("f:" + gid);
      if (r) {
        const dx = p[0] - r.x, dy = p[1] - r.y, pos = {};
        for (const cid of framedIds(gid) || []) {
          const at = S.pins[cid] || (S.layout && S.layout.pos[cid]);
          if (at) pos[cid] = S.pins[cid] = [at[0] + dx, at[1] + dy];
        }
        wb.forget([id]);
        wb.placeCards(pos, true);
      }
    } else S.pins[id] = p;
    render(false);
  }

  // ----------------------------------------------------------- the hover card

  let peekEl = null, peekFor = "", peekOpen = 0, peekClose = 0;
  function hidePeek() {
    clearTimeout(peekOpen); clearTimeout(peekClose);
    if (peekEl) peekEl.remove();
    peekEl = null; peekFor = "";
    if (S.hover) { S.hover = ""; if (built && lastDrawn) drawLines(lastDrawn, lastSolid); }
  }
  wb.element.addEventListener("pointerover", e => {
    const box = e.target.closest && e.target.closest(".dgbox");
    if (!box || wb.element.classList.contains("panning") || box.classList.contains("dragging")) return;
    const id = box.dataset.wb;
    clearTimeout(peekClose);
    if (peekFor === id) return;
    clearTimeout(peekOpen);
    peekFor = id;
    peekOpen = setTimeout(() => showPeek(id, box), 350);
  });
  wb.element.addEventListener("pointerout", e => {
    const box = e.target.closest && e.target.closest(".dgbox");
    if (!box || (e.relatedTarget && box.contains(e.relatedTarget))) return;
    clearTimeout(peekOpen);
    if (peekFor && !peekEl) peekFor = "";
    peekClose = setTimeout(hidePeek, 200);
  });
  wb.element.addEventListener("pointerdown", () => hidePeek());
  wb.element.addEventListener("wheel", () => hidePeek(), { passive: true });

  function showPeek(id, box) {
    if (!box.isConnected) return;
    if (S.hover !== id) { S.hover = id; if (built) drawLines(lastDrawn, lastSolid); }
    const card = peekCard(id);
    if (!card) return;
    if (peekEl) peekEl.remove();
    peekEl = card;
    card.addEventListener("pointerenter", () => clearTimeout(peekClose));
    card.addEventListener("pointerleave", () => { peekClose = setTimeout(hidePeek, 200); });
    document.body.append(card);
    place(card, box);
  }

  function peekCard(id) {
    if (id.startsWith("c:")) {
      const n = S.nodes.get(id.slice(2));
      if (!n) return null;
      const links = [...S.edges.values()].filter(e => e.from === n.id || e.to === n.id);
      const st = changedLook(n) ? n.state : "unchanged";
      return el("div", { class: "peek card dgpeek", role: "tooltip" },
        el("div", { class: "peek-head" }, el("span", { class: "chip" }, n.stereo || n.kind), st !== "unchanged" ? el("span", { class: `chip dg-chip-${st}` }, DG_STATES[st] || st) : "",
          el("span", { class: "dim small" }, n.id.slice(0, Math.max(0, n.id.length - n.label.length - 1)))),
        el("div", { class: "peek-title" }, n.label),
        n.summary ? el("p", { class: "dgsum" }, n.summary)
          : el("p", { class: "dim small" }, "No summary yet. ",
            o.onSummarise ? el("button", { type: "button", class: "linkish", onclick: () => o.onSummarise([n.id], n.group) }, "Write summaries for this group") : ""),
        n.file ? el("div", { class: "dim small mono" }, `${n.file}${n.line ? ":" + n.line : ""}`) : "",
        (n.units || []).length ? el("div", { class: "dim small" }, "In " + n.units.join(", ")) : "",
        (n.members || []).length ? el("ul", { class: "dgpeek-members" }, orderMembers(n.members).slice(0, 14).map(m =>
          el("li", { class: st !== "unchanged" && m.state ? "m-" + m.state : "" }, el("span", { class: "dgvis" }, VIS[m.vis] || "·"), memberText(m)))) : "",
        el("div", { class: "dim small" }, `${links.filter(e => e.from === n.id).length} link(s) out, ${links.filter(e => e.to === n.id).length} in`));
    }
    const gid = id.slice(2), g = S.groups.get(gid);
    if (!g) return null;
    return el("div", { class: "peek card dgpeek", role: "tooltip" },
      el("div", { class: "peek-head" }, el("span", { class: "chip" }, levelName(g))),
      el("div", { class: "peek-title" }, g.label),
      g.summary ? el("p", { class: "dgsum" }, g.summary)
        : el("p", { class: "dim small" }, "No summary yet. ",
          o.onSummarise ? el("button", { type: "button", class: "linkish", onclick: () => o.onSummarise([], gid) }, "Write one") : ""),
      el("div", { class: "dim small" }, `${g.count} type${g.count === 1 ? "" : "s"}` + (g.kids.length ? `, ${g.kids.length} group(s) inside` : "")));
  }

  // ----------------------------------------------------------- the bar over the board

  const unitBar = el("div", { class: "dgunits" });
  const kindBar = el("div", { class: "dgkinds" });
  const search = el("input", { type: "search", class: "dgsearch", placeholder: "Find a class or group", "aria-label": "Find a class or group" });
  search.addEventListener("input", () => { S.search = search.value.trim().toLowerCase(); render(false); });
  search.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const ids = [...cardEls.entries()].filter(([, c]) => c.node.classList.contains("dg-hit") && c.node.isConnected).map(([id]) => id);
    if (ids.length) wb.frame(ids, true);
  });
  const unchangedBtn = el("button", { type: "button", class: "chip dgtoggle on", "aria-pressed": "true",
    title: "The types a change links to that are not changed themselves (greyed)",
    onclick: () => { S.unchanged = !S.unchanged; unchangedBtn.classList.toggle("on", S.unchanged); unchangedBtn.setAttribute("aria-pressed", String(S.unchanged)); render(false); } }, "Unchanged links");
  const tools = el("div", { class: "dgtools" },
    el("button", { type: "button", class: "small", title: "Open every group", onclick: () => { for (const g of S.groups.values()) if (!project || g.level < 2) S.expanded.add(g.id); keep(); render(true); } }, "Open all"),
    el("button", { type: "button", class: "small", title: "Close every group", onclick: () => { S.expanded.clear(); keep(); render(true); } }, "Close all"),
    el("button", { type: "button", class: "small", title: "Forget where boxes were dragged", onclick: () => { wb.forget(Object.keys(S.pins)); S.pins = {}; render(true); } }, "Reset layout"));

  function drawBars() {
    unitBar.replaceChildren();
    if (S.units.length) {
      const all = S.units.every(u => S.on.has(u.id));
      unitBar.append(el("span", { class: "dim small" }, o.unitWord || "Units:"),
        el("button", { type: "button", class: "chip dgunit" + (all ? " on" : ""), "aria-pressed": String(all),
          onclick: () => { S.on = all ? new Set() : new Set(S.units.map(u => u.id)); drawBars(); render(false); } }, "All"),
        ...S.units.map(u => el("button", { type: "button", class: "chip dgunit" + (S.on.has(u.id) ? " on" : ""), "aria-pressed": String(S.on.has(u.id)),
          title: u.label !== u.id ? u.label : "", onclick: () => { if (S.on.has(u.id)) S.on.delete(u.id); else S.on.add(u.id); drawBars(); render(false); } }, u.id)));
    }
    if (!project) unitBar.append(unchangedBtn);
    kindBar.replaceChildren(...DG_KINDS.map(k => el("button", { type: "button", class: `chip dgkind k-${k.id}` + (S.kinds.has(k.id) ? " on" : ""),
      "aria-pressed": String(S.kinds.has(k.id)), onclick: () => { if (S.kinds.has(k.id)) S.kinds.delete(k.id); else S.kinds.add(k.id); keep(); drawBars(); render(true); } },
    el("span", { class: "dgkey" }), k.label)));
  }

  const bar = el("div", { class: "dgbar" }, search, unitBar, el("span", { class: "spacer" }), kindBar, tools);
  const element = el("div", { class: "dgwrap" }, bar, wb.element);

  function refresh(view) {
    take(view);
    drawBars();
    render(true);
  }
  ready = true;
  refresh(o.view);
  // (a diagram made again can lay out differently: a view saved before means little, so it opens fitted)
  setTimeout(() => wb.frame(null, false), 0);
  return { element, refresh, frame: ids => wb.frame(ids, true), state: S, board: wb };
}

// ----------------------------------------------------------- the page part

// diagramPanel(o) -> element. o: { scope: "project" | "feature", feature, kind, title, intro }
function diagramPanel(o) {
  const q = new URLSearchParams({ scope: o.scope, ...(o.feature ? { feature: o.feature } : {}), ...(o.kind ? { kind: o.kind } : {}) });
  const head = el("div", { class: "dghead" });
  const note = el("div", { class: "dgnote small", role: "status" });
  const body = el("div", { class: "dgbody" }, el("p", { class: "dim pad" }, "Opening the diagram…"));
  const wrap = el("div", { class: "dgpanel" + (o.scope === "project" ? " dgproject" : "") }, head, note, body);
  let view = null, run = "", diagram = null;

  async function load() {
    try { view = await api("/api/diagram?" + q); } catch (e) { body.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e))); return; }
    run = view.running && view.running[0] || run;
    drawHead();
    if (!view.exists) { body.replaceChildren(emptyState()); return; }
    let board = {};
    try { board = await api(`/api/whiteboard?kind=diagram&ref=${encodeURIComponent(view.board)}`); } catch { board = {}; }
    if (diagram && diagram.element.isConnected) { diagram.refresh(view); return; }
    diagram = makeDiagram({ view, board: { data: board, ref: view.board }, scope: o.scope, id: "dgboard",
      unitWord: o.kind === "plan" ? "Steps:" : "Work units:",
      fetchGroup: gid => api("/api/diagram?" + new URLSearchParams({ scope: "project", group: gid })),
      onSummarise: (ids, gid) => summarise(ids, gid),
      onError: t => { note.textContent = t; },
      onCount: c => { cutNote.textContent = c.cut ? `${c.cut} weaker links not drawn` : ""; } });
    body.replaceChildren(diagram.element);
  }
  const cutNote = el("span", { class: "dim small" });

  function drawHead() {
    const v = view;
    const facts = [];
    if (v.exists) {
      if (v.generated) facts.push(`made ${typeof ago === "function" ? ago(v.generated) : new Date(v.generated * 1000).toLocaleString()}`);
      if (o.scope === "project" && v.nodeCount) facts.push(`${v.nodeCount} types, ${v.edgeCount} links`);
      if (v.stamp && v.stamp.branch) facts.push(`${v.stamp.branch} against ${v.stamp.against}`);
      if (v.cost) facts.push(typeof fmtUsd === "function" ? fmtUsd(v.cost) : `$${v.cost}`);
    } else if (o.scope === "feature" && o.kind === "review" && v.branch) facts.push(`${v.branch} against ${v.base || "?"}`);
    const going = !!run;
    head.replaceChildren(
      el("div", { class: "dghead-title" }, el("strong", {}, o.title || "Diagram"), facts.length ? el("span", { class: "dim small" }, " · " + facts.join(" · ")) : "", " ", cutNote),
      v.stale ? el("span", { class: "dgstale small" }, v.stale) : "",
      el("span", { class: "spacer" }),
      going ? el("button", { type: "button", onclick: cancel }, "Stop")
        : el("button", { type: "button", class: v.exists && !v.stale ? "" : "primary", onclick: generate }, v.exists ? "Make again" : "Make the diagram"));
  }

  function emptyState() {
    const v = view;
    const parts = [el("p", {}, o.intro || "")];
    if (o.scope === "project") {
      const repo = el("input", { type: "text", value: v.repo || "", placeholder: "P:/path/to/the/repo", class: "dgrepo", "aria-label": "The code repository" });
      const excl = el("input", { type: "text", value: ((v.settings && v.settings.exclude) || []).join(", "), class: "dgrepo", "aria-label": "Folders left out" });
      parts.push(el("label", { class: "dgfield" }, el("span", {}, "Code repository"), repo),
        el("label", { class: "dgfield" }, el("span", {}, "Folders left out (start of the path, comma between)"), excl),
        el("button", { type: "button", class: "primary", onclick: async () => {
          try {
            await api("/api/diagram/settings", { repo: repo.value.trim(), exclude: excl.value.split(",").map(x => x.trim()).filter(Boolean) });
            await generate();
          } catch (e) { note.textContent = String(e.message || e); }
        } }, "Make the diagram"));
    } else if (o.kind === "review" && !v.repo) parts.push(el("p", { class: "dim" }, "No repository is known for this feature yet."));
    else if (o.kind === "plan" && !v.plan) parts.push(el("p", { class: "dim" }, "There is no plan to draw yet."));
    return el("div", { class: "dgempty pad" }, ...parts);
  }

  async function generate() {
    const id = "dg" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    note.textContent = "Starting…";
    try {
      await api("/api/diagram/generate", { scope: o.scope, feature: o.feature, kind: o.kind, runId: id });
      run = id;
      drawHead();
    } catch (e) { note.textContent = String(e.message || e); }
  }

  async function cancel() {
    if (!run) return;
    try { await api("/api/diagram/cancel", { runId: run }); } catch (e) { note.textContent = String(e.message || e); }
  }

  async function summarise(ids, gid) {
    try {
      await api("/api/diagram/summarise", { scope: o.scope, feature: o.feature, kind: o.kind, group: gid, ids,
        runId: "ds" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
      note.textContent = "Writing the summaries…";
    } catch (e) { note.textContent = String(e.message || e); }
  }

  const onEvent = e => {
    if (!wrap.isConnected) { if (seen) document.removeEventListener("tt-event", onEvent); return; }
    seen = true;
    const ev = e.detail;
    if (ev.type !== "diagram") return;
    if (ev.summaries) {
      const cost = ev.cost ? ` (${typeof fmtUsd === "function" ? fmtUsd(ev.cost) : "$" + ev.cost})` : "";
      note.textContent = ev.error ? ev.error : ev.done ? `Summaries written${cost}.` : ev.step || "";
      if (ev.done && !ev.error) load();
      return;
    }
    if (!run || ev.runId !== run) return;
    if (ev.step) note.textContent = ev.step;
    if (ev.done) {
      run = "";
      note.textContent = ev.ok ? "" : ev.error;
      load();
    }
  };
  let seen = false;
  document.addEventListener("tt-event", onEvent);
  load();
  return wrap;
}

// ----------------------------------------------------------- the hosts

// The Project diagram page (#diagram, a tile on the Engineering home).
function renderProjectDiagram(box) {
  box.replaceChildren(diagramPanel({ scope: "project", title: "Project diagram",
    intro: "Draws how the project's C# code fits together: its areas, assemblies and namespaces, the classes in them and the links " +
      "between them. Nothing is built or run: git is read, and a file is only read again when it changes. Zoom out for the groups, " +
      "click a group to open it, hover over anything for what it is." }));
}

// A feature's Diagram tab (#feature/<name>/diagram[/plan|/review]): the plan's diagram, or the branch's.
async function featureDiagram(f, main, which) {
  main.classList.add("fmain-board", "fmain-diagram");
  main.replaceChildren(el("p", { class: "dim pad" }, "Opening the diagram…"));
  let kinds = { plan: false, review: false };
  try { kinds = (await api("/api/diagram?" + new URLSearchParams({ scope: "feature", feature: f.name, kind: "review" }))).kinds || kinds; } catch { /* the panel says why */ }
  const kind = which === "plan" || which === "review" ? which : kinds.review ? "review" : kinds.plan ? "plan" : "review";
  const tab = (k, label, can) => el("a", { href: featureDiagramHref(f.name, k), class: k === kind ? "on" : "", title: can ? "" : "Not available yet" }, label);
  const intro = kind === "review"
    ? "The types this feature's branch adds, changes and removes, against the commit it left its base at, with the unchanged types they link to greyed. Turn work units on and off to see what each did."
    : "The classes and data flow the feature's plan will add, drawn by a model from the Comprehensive Tech Plan and joined to the code it names.";
  main.replaceChildren(el("div", { class: "dgtabs" }, tab("review", "Review: the branch", kinds.review), tab("plan", "Plan", kinds.plan)),
    diagramPanel({ scope: "feature", feature: f.name, kind, title: kind === "review" ? "What the branch changes" : "What the plan adds", intro }));
}
