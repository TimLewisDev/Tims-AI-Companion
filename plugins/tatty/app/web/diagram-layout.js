// Where a diagram's boxes go: a layered layout (what a thing relies on sits above it, so the
// arrows point up, as a class diagram's do), done inside each open group and then for the groups
// themselves. No library: longest-path layers, cycles broken by a depth-first walk, a few
// barycentre sweeps to cut crossings, rows wrapped when a layer is too wide, and the boxes with
// no link to a sibling packed in a grid underneath. The same input always gives the same picture.
// Used by diagram.js.
"use strict";

const DL_GAP_X = 36, DL_GAP_Y = 64, DL_PAD = 18, DL_HEAD = 34, DL_SWEEPS = 4;

// layoutBoxes(items, links) -> { pos: {id: [x, y]}, w, h }
//   items: [{ id, w, h }] (in the order to keep when nothing else decides)
//   links: [[from, to]]: from relies on to (to goes above)
function layoutBoxes(items, links) {
  const ids = items.map(i => i.id), at = new Map(ids.map((id, i) => [id, i]));
  const size = new Map(items.map(i => [i.id, i]));
  const out = new Map(ids.map(id => [id, new Set()])), inn = new Map(ids.map(id => [id, new Set()]));
  for (const [a, b] of links) {
    if (a === b || !at.has(a) || !at.has(b)) continue;
    out.get(a).add(b);
    inn.get(b).add(a);
  }
  // cycles: a depth-first walk in the given order; an edge back to the walk's path is turned round
  const state = new Map(), up = new Map(ids.map(id => [id, new Set()])); // up: id -> what goes above it
  const walk = start => {
    const stack = [[start, [...out.get(start)]]];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (!top[1].length) { state.set(top[0], 2); stack.pop(); continue; }
      const next = top[1].shift();
      if (state.get(next) === 1) { up.get(next).add(top[0]); continue; } // back edge: reversed
      up.get(top[0]).add(next);
      if (!state.get(next)) { state.set(next, 1); stack.push([next, [...out.get(next)]]); }
    }
  };
  for (const id of ids) if (!state.get(id)) walk(id);
  const linked = ids.filter(id => out.get(id).size || inn.get(id).size);
  const loose = ids.filter(id => !out.get(id).size && !inn.get(id).size);
  // layers: longest path from the top (a thing goes one below the lowest of what it relies on)
  const rank = new Map();
  const deep = id => { // iterative for long chains
    const todo = [id];
    while (todo.length) {
      const cur = todo[todo.length - 1];
      const missing = [...up.get(cur)].filter(u => !rank.has(u));
      if (missing.length) { for (const m of missing) { rank.set(m, -1); todo.push(m); } continue; }
      todo.pop();
      let r = 0;
      for (const u of up.get(cur)) r = Math.max(r, (rank.get(u) < 0 ? 0 : rank.get(u)) + 1);
      rank.set(cur, r);
    }
  };
  for (const id of linked) if (!rank.has(id) || rank.get(id) < 0) deep(id);
  const layers = [];
  for (const id of linked) (layers[rank.get(id)] = layers[rank.get(id)] || []).push(id);
  const L = layers.filter(Boolean);
  // order: barycentres of the neighbours in the layer above, then below, a few times
  const pos = new Map();
  const index = () => L.forEach(row => row.forEach((id, i) => pos.set(id, i)));
  index();
  const bary = (id, side) => {
    const ns = [...(side === "up" ? up.get(id) : inn.get(id) || [])].filter(n => pos.has(n));
    const also = side === "up" ? [...out.get(id)].filter(n => pos.has(n)) : [];
    const all = [...ns, ...also];
    return all.length ? all.reduce((s, n) => s + pos.get(n), 0) / all.length : pos.get(id);
  };
  for (let k = 0; k < DL_SWEEPS; k++) {
    const order = k % 2 ? [...L].reverse() : L;
    for (const row of order) {
      const b = new Map(row.map(id => [id, bary(id, k % 2 ? "down" : "up")]));
      row.sort((x, y) => b.get(x) - b.get(y) || at.get(x) - at.get(y));
      row.forEach((id, i) => pos.set(id, i));
    }
  }
  // rows: a layer wider than the limit wraps
  const area = items.reduce((s, i) => s + (i.w + DL_GAP_X) * (i.h + DL_GAP_Y), 0);
  const limit = Math.max(900, Math.sqrt(area) * 1.7);
  const rows = [];
  for (const row of L) {
    let cur = [], w = 0;
    for (const id of row) {
      const iw = size.get(id).w + DL_GAP_X;
      if (cur.length && w + iw > limit) { rows.push({ ids: cur, w: w - DL_GAP_X }); cur = []; w = 0; }
      cur.push(id); w += iw;
    }
    if (cur.length) rows.push({ ids: cur, w: w - DL_GAP_X });
  }
  const width = Math.max(0, ...rows.map(r => r.w));
  const result = {};
  let y = 0;
  for (const r of rows) {
    let x = (width - r.w) / 2, h = 0;
    for (const id of r.ids) { result[id] = [Math.round(x), y]; x += size.get(id).w + DL_GAP_X; h = Math.max(h, size.get(id).h); }
    y += h + DL_GAP_Y;
  }
  // the loose ones: a grid under the rest, as wide as it (or as the limit)
  if (loose.length) {
    const gw = Math.max(width, Math.min(limit, loose.reduce((s, id) => s + size.get(id).w + DL_GAP_X, 0)));
    let x = 0, h = 0;
    if (rows.length) y += 8;
    for (const id of loose) {
      const it = size.get(id);
      if (x && x + it.w > gw) { x = 0; y += h + DL_GAP_X; h = 0; }
      result[id] = [Math.round(x), y];
      x += it.w + DL_GAP_X; h = Math.max(h, it.h);
    }
    y += h + DL_GAP_Y;
  }
  const w = Math.max(0, ...items.map(i => (result[i.id] ? result[i.id][0] + i.w : 0)));
  const h = Math.max(0, ...items.map(i => (result[i.id] ? result[i.id][1] + i.h : 0)));
  return { pos: result, w, h };
}

// packBoxes(items, links) -> { pos, w, h }: shelves to a wide picture, in the order of the layers
// (what a thing relies on first), for boxes that are groups: layers of big frames would stack
// into one tall column.
function packBoxes(items, links) {
  const order = layoutBoxes(items.map(i => ({ id: i.id, w: 10, h: 10 })), links).pos;
  const ranked = [...items].sort((a, b) => (order[a.id][1] - order[b.id][1]) || (order[a.id][0] - order[b.id][0]));
  const area = items.reduce((s, i) => s + (i.w + DL_GAP_X) * (i.h + DL_GAP_Y), 0);
  const limit = Math.max(Math.max(...items.map(i => i.w)), Math.sqrt(area * 1.8));
  const pos = {};
  let x = 0, y = 0, h = 0, w = 0;
  for (const it of ranked) {
    if (x && x + it.w > limit) { x = 0; y += h + DL_GAP_Y; h = 0; }
    pos[it.id] = [x, y];
    x += it.w + DL_GAP_X; h = Math.max(h, it.h); w = Math.max(w, x - DL_GAP_X);
  }
  return { pos, w, h: y + h };
}

// layoutTree(root, links) -> { pos: {card id: [x, y]}, frames: {frame id: {x, y, w, h}} }
//   root: { kids: [node] }, a node is a card { id, w, h } or a frame { id, frame: true, kids: [node] }
//   links: [[from card, to card]]: lifted to the level of each frame's own children
function layoutTree(root, links) {
  const parent = new Map(); // card or frame id -> the frame (or "") it is directly in
  const mark = (n, p) => { parent.set(n.id, p); if (n.kids) n.kids.forEach(k => mark(k, n.id)); };
  root.kids.forEach(k => mark(k, ""));
  // the child of frame f that holds id (id itself when it is a child), or null
  const chain = id => { const c = []; for (let x = id; x !== undefined && x !== ""; x = parent.get(x)) c.push(x); return c; };
  const chains = new Map();
  const chainOf = id => { if (!chains.has(id)) chains.set(id, chain(id)); return chains.get(id); };
  const byFrame = new Map(); // frame id ("" for the root) -> [[child a, child b]]
  for (const [a, b] of links) {
    const ca = chainOf(a), cb = chainOf(b);
    if (!ca.length || !cb.length) continue;
    // the lowest frame both are in, and the children of it that hold each
    const sa = new Set(ca);
    let common = "", ia = ca.length - 1, ib = cb.length - 1;
    for (let j = 0; j < cb.length; j++) if (sa.has(cb[j]) && cb[j] !== a && cb[j] !== b) { common = cb[j]; ib = j - 1; ia = ca.indexOf(cb[j]) - 1; break; }
    if (common === "") { ia = ca.length - 1; ib = cb.length - 1; }
    const x = ca[ia], y = cb[ib];
    if (x === undefined || y === undefined || x === y) continue;
    if (!byFrame.has(common)) byFrame.set(common, []);
    byFrame.get(common).push([x, y]);
  }
  const pos = {}, frames = {};
  const size = n => { // lays out n's children (relative), returns n's size
    if (!n.frame) return { w: n.w, h: n.h };
    const items = n.kids.map(k => ({ id: k.id, ...size(k) }));
    const got = (n.kids.some(k => k.frame) ? packBoxes : layoutBoxes)(items, byFrame.get(n.id) || []);
    n._rel = got.pos;
    n._w = Math.max(got.w + DL_PAD * 2, n.minW || 160);
    n._h = got.h + DL_PAD + DL_HEAD;
    return { w: n._w, h: n._h };
  };
  const top = { id: "", frame: true, kids: root.kids };
  size(top);
  const place = (n, x, y) => {
    if (n.frame && n.id !== "") frames[n.id] = { x, y, w: n._w, h: n._h };
    if (!n.frame) { pos[n.id] = [x, y]; return; }
    const ox = n.id === "" ? 0 : x + DL_PAD, oy = n.id === "" ? 0 : y + DL_HEAD;
    for (const k of n.kids) { const r = n._rel[k.id]; place(k, ox + r[0], oy + r[1]); }
  };
  place(top, 0, 0);
  return { pos, frames };
}
