// Tatty's looks: the themes sold in the shop (shop.json "themes"). A look dresses the whole
// app and draws the feature Overview's journey.
//
//   the whole app   looks.css: a palette (the neutrals of theme.css's layer 2) and a backdrop for
//                   each look, light and dark, keyed on data-look on <html>. The modes' accents are
//                   untouched. theme-init.js puts data-look on before the first paint, from a copy
//                   kept in localStorage; the wallet (server.py's "coins and the shop") is the truth.
//   the journey     each look is a module (look-<id>.js) that registers { id, name, cls, voc, draw,
//                   tick, play, hero?, panelIn? } here. It is loaded only when it is worn or shown in
//                   the shop. Minimal (Hairline) is built in, in the page's own colours, and is the
//                   fallback for every other look.
//
// A journey draws a model, never a feature: { nodes: [{k, l, plan, units}], st: [done|now|next|todo|
// skip|out], cur, mode: running|gate|decide|complete, units, dec, base }. features.js makes it from a
// feature (journeyModel); the shop draws a sample one. (waiting: a session is open but idle, the
// stage being worked on is where it stands.) When the same feature's model changes between two
// draws, the change is played: a stage closed, the route moved on, a skip, a decision, the merge.
//
// The page's CSP allows no inline styles: SVG is built through the DOM, styling is classes and the
// CSSOM, motion is requestAnimationFrame and the Web Animations API, all gated on the shop's Motion
// switch (wallet.js), never on prefers-reduced-motion. A journey ticks only while it is on screen and
// the window is visible.
//
// window.TattyLooks: register(look), kit, worn(), wear(id), follow(id), tryOn(id), tryOff(), load(id),
// journey(model, {key, mini, look, still}), voc(), continueLabel(model), sample(state).
"use strict";

(() => {
  const root = document.documentElement;
  const NS = "http://www.w3.org/2000/svg";
  const REG = new Map();
  const FILES = { chart: "look-chart.js", map: "look-map.js", kin: "look-kin.js", chrono: "look-chrono.js", aur: "look-aur.js", drive: "look-drive.js" };
  const KEY = "tattyLook";
  const motion = () => !window.TattyWallet || TattyWallet.motion();

  // ---------------------------------------------------------------- the kit the looks draw with
  function S(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function T(txt, attrs, parent) { const e = S("text", attrs, parent); e.textContent = txt; return e; }
  function H(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const seeded = s => () => (s = (s * 16807) % 2147483647) / 2147483647;
  const lerp = (a, b, p) => a + (b - a) * p;
  const ease = {
    io: p => p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2, out: p => 1 - (1 - p) ** 3,
    back: p => { const c = 1.7; return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; },
  };
  const backCss = "cubic-bezier(.34,1.56,.64,1)";
  function smooth(p) {
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
    }
    return d;
  }
  const poly = p => "M" + p.map(q => q.join(",")).join(" L");
  // The length along a path at each node, searched forwards so a winding path can't match a later pass.
  function lens(path, pts) {
    const L = path.getTotalLength(), K = 700, smp = [];
    for (let k = 0; k <= K; k++) { const q = path.getPointAtLength(L * k / K); smp.push([q.x, q.y, L * k / K]); }
    let s = 0;
    const at = pts.map(p => { let best = 1e18, bl = 0, bi = s; for (let k = s; k <= K; k++) { const d = (smp[k][0] - p[0]) ** 2 + (smp[k][1] - p[1]) ** 2; if (d < best - 1e-6) { best = d; bl = smp[k][2]; bi = k; } } s = bi; return bl; });
    return { L, at };
  }
  const dash = (el, len, L) => { el.style.strokeDasharray = `${Math.max(0, len)} ${L + 20}`; };
  // a dash that starts part-way along a path: a gap of `a`, then `len` drawn
  const dashAt = (el, a, len, L) => { el.style.strokeDasharray = `0 ${Math.max(0, a).toFixed(1)} ${Math.max(0, len).toFixed(1)} ${(L + 40).toFixed(0)}`; };
  function tween(ms, f, e, done) {
    e = e || ease.io;
    if (!motion()) { f(1); if (done) done(); return; }
    const t0 = performance.now();
    (function step(now) { const p = Math.min(1, Math.max(0, (now - t0) / ms)); f(e(p)); if (p < 1) requestAnimationFrame(step); else if (done) done(); })(t0);
  }
  function anim(el, kf, o) { if (!motion() || !el) return null; return el.animate(kf, Object.assign({ duration: 600, easing: "cubic-bezier(.2,.8,.2,1)" }, o || {})); }
  function drawIn(el, ms, delay) { return anim(el, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: ms || 700, delay: delay || 0, fill: "backwards", easing: "ease-out" }); }
  const sleep = ms => motion() ? ms : 0;
  function svgPt(card, x, y) {
    const svg = card.mock.querySelector("svg"), r = svg.getBoundingClientRect(), mr = card.mock.getBoundingClientRect(), s = r.width / 1000;
    return [r.left - mr.left + x * s, r.top - mr.top + y * s];
  }
  // A few flecks thrown from a point of the journey, in the look's --fx1..3 colours.
  function burst(card, x, y, n, spread) {
    if (!motion() || card.mini) return;
    const fx = card.mock.querySelector(".fx");
    if (!fx) return;
    const [px, py] = svgPt(card, x, y), cs = getComputedStyle(card.mock);
    const cols = ["--fx1", "--fx2", "--fx3"].map(v => cs.getPropertyValue(v).trim() || "#fff");
    for (let i = 0; i < (n || 18); i++) {
      const d = document.createElement("i"); d.style.left = px + "px"; d.style.top = py + "px";
      d.style.background = cols[i % 3]; d.style.color = cols[i % 3]; fx.appendChild(d);
      const a = Math.random() * Math.PI * 2, v = (spread || 60) * (.5 + Math.random()), rot = Math.random() * 540 - 270;
      d.animate([
        { transform: "translate(-50%,-50%) rotate(0deg) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * v}px), calc(-50% + ${Math.sin(a) * v + 18}px)) rotate(${rot}deg) scale(.4)`, opacity: 0 }],
        { duration: 700 + Math.random() * 600, easing: "cubic-bezier(.1,.7,.3,1)" }).onfinish = () => d.remove();
    }
  }
  // A short-lived element: made, animated, removed. Nothing with the motion off.
  function fxEl(g, tag, attrs, kf, o, txt) {
    if (!motion() || !g) return null;
    const e = S(tag, attrs, g); if (txt != null) e.textContent = txt;
    e.animate(kf, Object.assign({ duration: 800, easing: "ease-out" }, o || {})).onfinish = () => e.remove();
    return e;
  }
  // A ring that grows and fades from a point.
  const ring = (g, x, y, r0, k, cls, ms) => fxEl(g, "circle", { cx: x, cy: y, r: r0, class: cls }, [{ transform: "scale(1)", opacity: .8 }, { transform: `scale(${k})`, opacity: 0 }], { duration: ms || 900 });
  const flashKf = k => [{ transform: "scale(1)", filter: "brightness(1)" }, { transform: `scale(${k})`, filter: "brightness(1.7)" }, { transform: "scale(1)", filter: "brightness(1)" }];
  // A smooth skyline filled down to y = 900, so the ground carries on under the card's edge.
  function hills(rnd, base, amp, n) {
    const p = []; for (let k = 0; k <= n; k++) p.push([-60 + 1120 * k / n, base + amp * (Math.sin(k * 1.3 + rnd() * 3) * .6 + (rnd() - .5) * .8)]);
    return "M-60,900 L" + smooth(p).slice(1) + " L1060,900 Z";
  }
  const lastDone = (m, before) => { for (let i = before - 1; i >= 0; i--) if (m.st[i] === "done") return i; return -1; };
  // Where the traveller stands: on the stage being worked on, or at a gate on the last one closed.
  const markerAt = m => { if (m.mode === "gate") { const d = lastDone(m, m.cur); return d < 0 ? m.cur : d; } return m.cur; };
  // The first and last plan stage, or null on a route without a plan.
  const planSpan = m => { const a = m.nodes.findIndex(n => n.plan); if (a < 0) return null; let b = a; m.nodes.forEach((n, i) => { if (n.plan) b = i; }); return [a, b]; };
  // Where the stage numbers come from: each stage's place in the route.
  const unitsOf = m => { const i = m.nodes.findIndex(n => n.units); return i < 0 ? null : { i, total: m.nodes[i].units }; };

  const kit = { S, T, H, seeded, lerp, ease, backCss, smooth, poly, lens, dash, dashAt, tween, anim, drawIn, sleep, burst, fxEl, ring, flashKf, hills, lastDone, markerAt, planSpan, unitsOf, motion };

  // ---------------------------------------------------------------- what the journey's head says
  function heroText(m) {
    const cur = m.nodes[m.cur] || { l: "" }, ld = lastDone(m, m.cur);
    const unit = cur.units && m.st[m.cur] !== "todo" ? ` · unit ${Math.min(m.units + 1, cur.units)} of ${cur.units}` : "";
    switch (m.mode) {
      case "running": return { kick: "Now", big: cur.l + unit, sub: "A session is working on it" };
      case "decide": return m.dec
        ? { kick: cur.l, big: `${m.dec} ${m.dec === 1 ? "decision needs" : "decisions need"} you`, sub: "Answer them and the work goes on" }
        : { kick: cur.l, big: "Waiting on you", sub: m.what === "validate" ? "Checks wait for your result" : "Something needs your call" };
      case "complete": return { kick: "Merged", big: "Journey complete", sub: m.base ? `Merged into ${m.base}` : "The work is merged" };
      case "waiting": return { kick: cur.l + unit, big: "Waiting for you", sub: "Its session is idle: open it to carry on" };
      default: return { kick: ld >= 0 ? `${m.nodes[ld].l} complete` : "Ready to start", big: `Next: ${cur.l}`, sub: "Nothing starts until you continue" };
    }
  }
  function heroNode(card) {
    const h = heroText(card.m);
    if (card.dir.hero) return card.dir.hero(card, h);
    const w = H("div", "jy-hero-in");
    w.append(H("div", "h-kick", h.kick), H("div", "h-big", h.big), H("div", "h-sub", h.sub));
    if (card.ev) anim(w.children[1], [{ opacity: 0, transform: "translateY(10px)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 550, delay: 120, fill: "backwards" });
    return w;
  }

  // ---------------------------------------------------------------- the journeys on screen
  let UID = 0;
  const live = new Set();
  const lastModels = new Map(); // key (the feature's name) -> the model drawn last: what changed is played

  function render(card) {
    if (!card.mini) { const hero = card.mock.querySelector(".jy-hero"); if (hero) hero.replaceChildren(heroNode(card)); }
    const svg = card.mock.querySelector("svg");
    svg.replaceChildren();
    card.moving = false;
    try { card.refs = card.dir.draw(svg, card.m, card); } catch (e) {
      // a look that can't draw this model: Minimal can
      if (card.dir.id === "minimal") throw e;
      console.warn("Tatty look", card.dir.id, "couldn't draw:", e);
      card.set(REG.get("minimal"));
      return render(card);
    }
    const ev = card.ev; card.ev = null;
    if (ev && card.dir.play) card.dir.play(card, ev);
    if (card.dir.tick) card.dir.tick(performance.now(), card);
  }

  (function frame(t) {
    for (const c of live) {
      const on = c.mock.isConnected;
      if (on) c.seen = true;
      if (!on) { if (c.seen || t - c.born > 8000) { live.delete(c); if (c.io) c.io.disconnect(); } continue; }
      if (c.pending) { c.pending = false; render(c); continue; } // (lengths along a path need it in the page)
      if (c.still || document.hidden || !motion() || !c.visible || !c.refs || !c.dir.tick) continue;
      try { c.dir.tick(t, c); } catch (e) { live.delete(c); }
    }
    requestAnimationFrame(frame);
  })(performance.now());

  // What changed between two models of the same feature, as the one move to play (or null).
  function change(prev, m) {
    if (!prev || prev.nodes.length !== m.nodes.length || prev.nodes.some((n, i) => n.l !== m.nodes[i].l)) return null;
    if (m.mode === "complete" && prev.mode !== "complete") {
      const sk = m.st.findIndex((s, i) => s === "skip" && prev.st[i] !== "skip");
      return { kind: "complete", at: prev.cur, skipped: sk < 0 ? null : sk };
    }
    const closed = m.st.findIndex((s, i) => s === "done" && prev.st[i] !== "done");
    const skipped = m.st.findIndex((s, i) => s === "skip" && prev.st[i] !== "skip");
    if (skipped >= 0) return { kind: "skip", at: skipped, to: m.cur };
    if (closed >= 0 && m.mode === "running" && m.cur > closed) return { kind: "advance", from: closed, to: m.cur };
    if (closed >= 0) return { kind: "finish", at: closed, to: m.cur };
    if (prev.cur === m.cur && prev.mode === "gate" && m.mode === "running") return { kind: "advance", from: markerAt(prev), to: m.cur };
    if (prev.cur === m.cur && prev.mode === "decide" && m.mode === "running") return { kind: "decided", at: m.cur };
    if (prev.cur === m.cur && m.units > prev.units && m.nodes[m.cur].units) return { kind: "unit", at: m.cur };
    return null;
  }

  // A journey: a card (full: the hero line and the scene; mini: the scene only, for the shop) in the
  // look worn, or the one asked for (o.look). o.key names whose journey it is, so a change is played.
  function journey(model, o) {
    o = o || {};
    const mock = H("div", "");
    const card = { dir: null, mock, m: model, uid: ++UID, mini: !!o.mini, ev: null, refs: null, visible: true, pending: true, born: performance.now(), seen: false, follows: !o.look, still: !!o.still };
    if (o.key) { card.ev = change(lastModels.get(o.key), model); lastModels.set(o.key, JSON.parse(JSON.stringify(model))); }
    mock.append(...(card.mini ? [] : [H("div", "jy-hero")]));
    const scene = H("div", "jy-scene");
    const svg = document.createElementNS(NS, "svg");
    card.view = () => { // a look may draw in less height than the scene's 260 (Minimal does)
      const v = card.mini ? card.dir.mini || "0 10 1000 240" : card.dir.view || "0 0 1000 260", h = +v.split(" ")[3];
      svg.setAttribute("viewBox", v); svg.style.aspectRatio = `1000 / ${h}`;
    };
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("aria-hidden", "true");
    scene.append(svg);
    mock.append(scene, H("div", "fx"));
    const set = card.set = dir => { card.dir = dir; mock.className = "jy" + (card.mini ? " mini" : " card") + " " + dir.cls; card.view(); };
    const want = o.look || worn;
    set(REG.get(want) || REG.get("minimal"));
    if (card.dir.id !== want) load(want).then(dir => { if (dir && dir.id === want) { set(dir); card.pending = true; } });
    if ("IntersectionObserver" in window) { card.io = new IntersectionObserver(es => es.forEach(x => { card.visible = x.isIntersecting; })); card.io.observe(mock); }
    live.add(card);
    card.setLook = id => load(id).then(dir => { set(dir); card.ev = null; card.pending = true; });
    mock.journey = card;
    return mock;
  }

  // ---------------------------------------------------------------- which look is worn
  let worn = root.dataset.look || "minimal";
  let trying = null;

  function load(id) {
    if (REG.has(id)) return Promise.resolve(REG.get(id));
    if (!FILES[id]) return Promise.resolve(REG.get("minimal"));
    if (!load.busy) load.busy = new Map();
    if (!load.busy.has(id)) load.busy.set(id, new Promise(res => {
      const s = document.createElement("script");
      s.src = "/static/" + FILES[id];
      s.onload = () => res(REG.get(id) || REG.get("minimal"));
      s.onerror = () => res(REG.get("minimal"));
      document.head.append(s);
    }));
    return load.busy.get(id);
  }

  function show(id) {
    if (id && id !== "minimal") root.dataset.look = id; else root.removeAttribute("data-look");
  }
  // The journeys on screen in the worn look put on the new one; then whoever else cares is told.
  function announce() {
    for (const c of live) if (c.follows && c.dir.id !== worn) c.setLook(worn);
    document.dispatchEvent(new CustomEvent("tt-look", { detail: worn }));
  }
  // A theme put on in another window, or bought: the wallet event says which.
  document.addEventListener("tt-event", e => { const ev = e.detail; if (ev && ev.type === "wallet" && typeof ev.theme === "string") follow(ev.theme); });

  // The wallet says which look is worn (the status poll, a "wallet" event, the shop's answer).
  function follow(id) {
    id = typeof id === "string" && id ? id : "minimal";
    if (id === worn) return;
    worn = id;
    try { if (id === "minimal") localStorage.removeItem(KEY); else localStorage.setItem(KEY, id); } catch (e) { /* only the copy is lost */ }
    if (!trying) show(id);
    load(id).then(announce);
  }

  // The shop's try-on: the whole app wears it while a hand is over its card.
  function tryOn(id) { trying = id; show(id); load(id); }
  function tryOff() { trying = null; show(worn); }

  // The words on Continue: Minimal's is the app's own "Continue".
  const voc = () => (REG.get(worn) || REG.get("minimal")).voc;
  function continueLabel(m) {
    const v = voc();
    if (!v || !v.cont || worn === "minimal" || !m || !m.nodes[m.cur]) return "Continue";
    return `${v.cont} ${m.nodes[m.cur].l}`;
  }

  // A feature to show a look with: a full route, scoped, at the gate before Approach.
  function sample(state) {
    const nodes = [
      { k: "explore", l: "Explore" }, { k: "req", l: "Requirements", plan: true }, { k: "scope", l: "Scope", plan: true },
      { k: "approach", l: "Approach", plan: true }, { k: "tech", l: "Tech design", plan: true }, { k: "whole", l: "Whole plan", plan: true },
      { k: "signoff", l: "Sign-off", plan: true }, { k: "breakdown", l: "Breakdown" }, { k: "build", l: "Build", units: 6 },
      { k: "review", l: "Review" }, { k: "done", l: "Done" }];
    const st = nodes.map((n, i) => i < 3 ? "done" : i === 3 ? "next" : "todo");
    const m = { nodes, st, cur: 3, mode: "gate", units: 0, dec: 0, base: "develop" };
    if (state === "running") { st[3] = "now"; m.mode = "running"; }
    return m;
  }

  const register = look => { REG.set(look.id, look); };

  window.TattyLooks = { register, kit, worn: () => worn, wear: follow, follow, tryOn, tryOff, load, journey, voc, continueLabel, sample, heroText };

  // ---------------------------------------------------------------- Minimal: Hairline, built in
  register({
    id: "minimal", name: "Minimal", cls: "t-min",
    view: "0 52 1000 132",
    voc: { cont: "Continue to", skip: "Skip", stop: "Stop here" },
    pts(m) { const N = m.nodes.length; return m.nodes.map((n, i) => [60 + 880 * i / Math.max(1, N - 1), 120]); },
    draw(svg, m) {
      const pts = this.pts(m), g = S("g", {}, svg), mk = markerAt(m), y = 120, N = m.nodes.length, span = planSpan(m);
      if (span) {
        const bx0 = pts[span[0]][0] - 12, bx1 = pts[span[1]][0] + 12;
        S("path", { d: `M${bx0},84 L${bx0},78 L${bx1},78 L${bx1},84`, class: "hl-bracket" }, g);
        T("PLAN", { x: (bx0 + bx1) / 2, y: 68, class: "grp" }, g);
      }
      S("line", { x1: pts[0][0], y1: y, x2: pts[N - 1][0], y2: y, class: "hl-line" }, g);
      S("line", { x1: pts[0][0], y1: y, x2: pts[m.mode === "complete" ? N - 1 : mk][0], y2: y, class: "hl-done" }, g);
      const nodes = pts.map((p, i) => {
        const n = m.nodes[i], s = m.st[i], r = n.plan ? 4.5 : 7, outer = S("g", { transform: `translate(${p[0]},${y})` }, g), ng = S("g", { class: "pop " + s }, outer);
        if (s === "now") S("circle", { r: r + 9, class: "halo" }, ng);
        if (s === "next") S("circle", { r: r + 6, class: "nring" }, ng);
        S("circle", { r: s === "out" ? 3 : r, class: "dotf" }, ng);
        const lb = T(n.l, { y: 30, class: "lbl" }, outer);
        if (s === "todo") lb.classList.add("todo"); if (s === "skip") lb.classList.add("struck");
        if (s === "out") { lb.classList.add("faint"); T("left out", { y: 43, class: "lbl2" }, outer); }
        if (s === "skip") T("skipped", { y: 43, class: "lbl2" }, outer);
        if (n.units && s !== "todo" && s !== "out") T(`${m.units}/${n.units} units`, { y: 43, class: "lbl2" }, outer);
        return ng;
      });
      return { nodes, done: g.querySelector(".hl-done"), pts, y, fxg: S("g", {}, g) };
    },
    tick(t, c) {
      const r = c.refs, m = c.m;
      r.nodes.forEach((g, i) => {
        if (m.st[i] === "now") { const h = g.querySelector(".halo"); h.setAttribute("r", (16 + Math.sin(t / 380) * 3).toFixed(1)); h.setAttribute("opacity", (.2 + .08 * Math.sin(t / 380)).toFixed(3)); }
        if (m.st[i] === "next") { const q = g.querySelector(".nring"); q.setAttribute("r", (10.5 + Math.sin(t / 520) * 2.2).toFixed(1)); q.setAttribute("opacity", (.55 + .4 * Math.sin(t / 520)).toFixed(2)); }
      });
    },
    ripple(c, i, big) { const r = c.refs, p = r.pts[i]; fxEl(r.fxg, "circle", { cx: p[0], cy: r.y, r: 7, class: "ripple" }, [{ transform: "scale(1)", opacity: .75 }, { transform: `scale(${big ? 7 : 4})`, opacity: 0 }], { duration: big ? 1100 : 800 }); },
    play(c, ev) {
      const r = c.refs, me = this, N = c.m.nodes.length;
      if (ev.kind === "advance") {
        const a = r.pts[ev.from][0], b = r.pts[ev.to][0]; r.done.setAttribute("x2", a);
        tween(900, p => r.done.setAttribute("x2", lerp(a, b, p).toFixed(1)), ease.io, () => me.ripple(c, ev.to));
        anim(r.nodes[ev.to], [{ transform: "scale(.3)", opacity: .2 }, { transform: "scale(1)", opacity: 1 }], { duration: 600, delay: 700, fill: "backwards", easing: backCss });
      }
      if (ev.kind === "finish" || ev.kind === "complete" || ev.kind === "unit") {
        me.ripple(c, Math.min(ev.at, N - 1), ev.kind !== "unit");
        anim(r.nodes[Math.min(ev.at, N - 1)], [{ transform: "scale(1)" }, { transform: "scale(1.6)" }, { transform: "scale(1)" }], { duration: 600 });
      }
      if (ev.kind === "finish" && r.nodes[ev.to]) anim(r.nodes[ev.to], [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: "scale(1)" }], { duration: 600, delay: 300, fill: "backwards" });
      if (ev.kind === "skip") anim(r.nodes[ev.at], [{ transform: "scale(1.4)", opacity: 1 }, { transform: "scale(1)", opacity: .8 }], { duration: 500 });
      if (ev.kind === "complete") r.pts.forEach((p, i) => setTimeout(() => { if (c.refs === r) me.ripple(c, i, false); }, sleep(i * 80)));
      if (ev.kind === "decided") me.ripple(c, ev.at, false);
    },
  });

  // Start on the look the copy says, and load it, so the first Overview drawn is in it.
  if (worn !== "minimal") load(worn).then(announce);
})();
