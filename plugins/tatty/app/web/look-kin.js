// Kintsugi (looks.js): the feature is a cracked bowl being mended with gold. The route is one crack
// across a glazed surface; every stage closed fills its stretch of the seam with gold, and each
// stage's own hairline crack gilds while it is worked on. A skip is bridged with a gold staple, a stage
// left out is a chip in the glaze. Drawn from docs/overview/themes-round3.html (E).
"use strict";
(() => {
  const { S, T, seeded, lerp, ease, backCss, poly, lens, dash, dashAt, tween, anim, drawIn, sleep, burst, ring, flashKf, markerAt, planSpan, motion } = TattyLooks.kit;
  TattyLooks.register({
    id: "kin", name: "Kintsugi", cls: "t-kin",
    voc: { cont: "Gild through to", skip: "Bridge over", stop: "Let it set" },
    pts(m) { const N = m.nodes.length; return m.nodes.map((n, i) => { const t = i / Math.max(1, N - 1); return [70 + 860 * t, 140 + 32 * Math.sin(t * 6.2 + .4) + 8 * Math.sin(t * 17)]; }); },
    draw(svg, m, card) {
      const pts = this.pts(m), g = S("g", {}, svg), rnd = seeded(31), mk = markerAt(m), uid = card.uid, gu = `url(#kg-${uid})`, N = m.nodes.length, span = planSpan(m);
      const defs = S("defs", {}, g);
      const gold = S("linearGradient", { id: `kg-${uid}`, gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2: 1000, y2: 0 }, defs);
      [[0, "k-g1"], [.22, "k-g2"], [.5, "k-g1"], [.74, "k-g2"], [1, "k-g1"]].forEach(([o, c]) => S("stop", { offset: o, class: c }, gold));
      const glz = S("radialGradient", { id: `kz-${uid}` }, defs);
      S("stop", { offset: 0, class: "k-glaze0" }, glz); S("stop", { offset: 1, class: "k-glaze", "stop-opacity": 0 }, glz);
      S("ellipse", { cx: 300, cy: 34, rx: 430, ry: 84, fill: `url(#kz-${uid})` }, g);
      for (let i = 0; i < 80; i++) S("circle", { cx: (rnd() * 1000).toFixed(1), cy: (rnd() * 260).toFixed(1), r: (.4 + rnd() * .9).toFixed(2), class: "k-speck", opacity: (.04 + rnd() * .1).toFixed(2) }, g);
      // the crack: jagged, edge to edge, through every stage
      const q = [[-20, pts[0][1] + 6], [28, pts[0][1] - 5]];
      pts.forEach((p, i) => {
        if (i > 0) { const a = pts[i - 1]; for (let k = 1; k <= 3; k++) { const f = k / 4 + (rnd() - .5) * .08; q.push([lerp(a[0], p[0], f), lerp(a[1], p[1], f) + (rnd() - .5) * 15]); } }
        q.push(p);
      });
      q.push([985, pts[N - 1][1] + 7], [1020, pts[N - 1][1] - 3]);
      const d = poly(q);
      // each stage's own branch crack, always upward so it stays clear of the label
      const brs = pts.map(p => {
        const b = [[p[0], p[1]]]; let a = -Math.PI / 2 + (rnd() - .5) * 1.6, x = p[0], y = p[1];
        for (let k = 0; k < 3; k++) { const len = 6 + rnd() * 6; a += (rnd() - .5) * .9; x += Math.cos(a) * len; y += Math.sin(a) * len; b.push([x, y]); }
        return poly(b);
      });
      S("path", { d, class: "k-edge", transform: "translate(.8,.9)" }, g);
      const crack = S("path", { d, class: "k-crack" }, g), lg = lens(crack, pts), L = lg.L;
      const gbr = {};
      brs.forEach((bd, i) => {
        const s = m.st[i]; if (s === "out") return;
        S("path", { d: bd, class: "k-crack thin" }, g);
        if (s === "done" || s === "now") {
          const e = S("path", { d: bd, class: "k-gold k-br", stroke: gu, pathLength: 1 }, g); gbr[i] = e;
          if (s === "now") e.style.strokeDasharray = `${m.nodes[i].units ? (m.units / m.nodes[i].units).toFixed(3) : 0} 2`;
        }
      });
      const doneL = m.mode === "complete" ? L : lg.at[mk];
      const glow = S("path", { d, class: "k-glow", stroke: gu }, g), seam = S("path", { d, class: "k-gold", stroke: gu }, g);
      dash(glow, doneL, L); dash(seam, doneL, L);
      const sheen = S("path", { d, class: "k-sheen", opacity: 0 }, g);
      if (span) T("PLAN", { x: (pts[span[0]][0] + pts[span[1]][0]) / 2, y: Math.min(...pts.slice(span[0], span[1] + 1).map(p => p[1])) - 42, class: "grp" }, g);
      const staples = {}, pools = [];
      const nodes = pts.map((p, i) => {
        const n = m.nodes[i], s = m.st[i], last = i === N - 1, r = last ? 7 : n.plan ? 4 : 5.5;
        const outer = S("g", { transform: `translate(${p[0].toFixed(1)},${p[1].toFixed(1)})` }, g), ng = S("g", { class: "kn pop " + s }, outer);
        if (s === "out") S("path", { d: "M-6,-3 L-1,-7 L6,-4 L4,4 L-4,5 Z", class: "k-chip" }, ng);
        else {
          if (s === "now") { pools.push({ e: S("circle", { r: r + 8, class: "k-pool", opacity: .3 }, ng), r }); S("circle", { r: r + 4.5, class: "k-arc" }, ng); }
          if (s === "next") S("circle", { r: r + 5, class: "k-ring" }, ng);
          S("circle", { r, class: "k-node" }, ng);
          if (s === "done" || s === "now") S("circle", { cx: -r * .3, cy: -r * .32, r: r * .32, class: "k-hi" }, ng);
          if (last && s === "done") S("circle", { r: r + 4, class: "k-ring" }, ng);
          if (s === "skip") {
            const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)], ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 90;
            staples[i] = S("path", { d: "M0,-13 L0,13 M-4,-13 L4,-13 M-4,13 L4,13", class: "k-staple", pathLength: 1, transform: `rotate(${ang.toFixed(1)})` }, outer);
          }
        }
        const lb = T(n.l.toUpperCase(), { y: 24, class: "lbl" }, outer);
        if (s === "done") lb.classList.add("gilt"); if (s === "todo") lb.classList.add("todo");
        if (s === "skip") { lb.classList.add("struck"); T("bridged", { y: 36, class: "lbl2" }, outer); }
        if (s === "out") { lb.classList.add("faint"); T("left out", { y: 36, class: "lbl2" }, outer); }
        if (n.units && s !== "todo" && s !== "out") T(`${m.units}/${n.units} units`, { y: 36, class: "lbl2" }, outer);
        return ng;
      });
      return { nodes, pools, staples, gbr, seam, glow, sheen, crack, lg, L, doneL, pts, fxg: S("g", {}, g), nextSheen: performance.now() + 1800, sheenT0: -1 };
    },
    tick(t, c) {
      const r = c.refs, m = c.m;
      r.pools.forEach(o => { o.e.setAttribute("r", (o.r + 8 + Math.sin(t / 420) * 2.5).toFixed(1)); o.e.setAttribute("opacity", (.26 + .14 * Math.sin(t / 420)).toFixed(2)); });
      r.nodes.forEach((g, i) => {
        if (m.st[i] === "next") { const k = g.querySelector(".k-ring"); if (k) k.setAttribute("transform", `rotate(${((t / 40) % 360).toFixed(1)})`); }
        if (m.st[i] === "now") { const k = g.querySelector(".k-arc"); if (k) k.setAttribute("transform", `rotate(${((t / 9) % 360).toFixed(1)})`); }
      });
      // the stage being worked on gilds its own branch crack, over and over (Build fills by its units instead)
      const b = r.gbr[m.cur];
      if (b && m.st[m.cur] === "now" && !m.nodes[m.cur].units) { const p = (t / 5200) % 1; b.style.strokeDasharray = `${ease.out(p).toFixed(3)} 2`; b.setAttribute("opacity", (p > .85 ? (1 - p) / .15 : 1).toFixed(2)); }
      // a slow glint along the gold
      if (r.doneL > 30 && !c.moving) {
        if (r.sheenT0 < 0 && t > r.nextSheen) r.sheenT0 = t;
        if (r.sheenT0 >= 0) {
          const q = (t - r.sheenT0) / 2600;
          if (q >= 1) { r.sheenT0 = -1; r.nextSheen = t + 5000 + Math.random() * 3000; r.sheen.setAttribute("opacity", 0); }
          else { const len = 48, pos = q * (r.doneL + len) - len, a = Math.max(0, pos), e = Math.min(r.doneL, pos + len); dashAt(r.sheen, a, e - a, r.L); r.sheen.setAttribute("opacity", (Math.sin(q * Math.PI) * .9).toFixed(2)); }
        }
      }
    },
    play(c, ev) {
      const r = c.refs, N = c.m.nodes.length;
      if (ev.kind === "advance") {
        const a = r.lg.at[ev.from], b = r.lg.at[ev.to]; c.moving = true;
        dash(r.seam, a, r.L); dash(r.glow, a, r.L);
        const bead = motion() ? S("circle", { r: 3, class: "k-bead" }, r.fxg) : null;
        tween(1700, p => {
          const l = lerp(a, b, p); dash(r.seam, l, r.L); dash(r.glow, l, r.L);
          if (bead) { const q = r.crack.getPointAtLength(l); bead.setAttribute("cx", q.x.toFixed(1)); bead.setAttribute("cy", q.y.toFixed(1)); }
        }, ease.io, () => { if (bead) bead.remove(); if (c.refs !== r) return; c.moving = false; ring(r.fxg, ...r.pts[ev.to], 6, 4, "k-rip rip"); burst(c, ...r.pts[ev.to], 6, 24); });
        anim(r.nodes[ev.to], [{ opacity: .2, transform: "scale(.4)" }, { opacity: 1, transform: "scale(1)" }], { duration: 700, delay: 1300, fill: "backwards", easing: backCss });
      }
      if (ev.kind === "finish" || ev.kind === "complete" || ev.kind === "unit") {
        const big = ev.kind !== "unit", at = Math.min(ev.at, N - 1);
        anim(r.nodes[at], flashKf(big ? 1.7 : 1.3), { duration: 700 });
        ring(r.fxg, ...r.pts[at], 6, big ? 6 : 3.5, "k-rip rip", big ? 1100 : 800);
        burst(c, ...r.pts[at], big ? 12 : 4, big ? 40 : 20);
        const b = r.gbr[at];
        if (b && big) drawIn(b, 700, 100);
        if (b && !big) { const u = c.m.nodes[at].units, f1 = c.m.units / u, f0 = (c.m.units - 1) / u; tween(700, p => { b.style.strokeDasharray = `${lerp(f0, f1, p).toFixed(3)} 2`; }, ease.out); }
      }
      if (ev.kind === "finish" && r.nodes[ev.to]) anim(r.nodes[ev.to], [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: "scale(1)" }], { duration: 700, delay: 350, fill: "backwards" });
      if (ev.kind === "skip" || (ev.kind === "complete" && ev.skipped != null)) {
        const i = ev.kind === "skip" ? ev.at : ev.skipped; drawIn(r.staples[i], 800, 150);
        if (ev.kind === "skip" && r.nodes[ev.to]) anim(r.nodes[ev.to], [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 400, fill: "backwards" });
      }
      if (ev.kind === "complete") {
        r.sheenT0 = performance.now();
        anim(r.glow, [{ opacity: .16 }, { opacity: .55 }, { opacity: .16 }], { duration: 1800 });
        r.pts.forEach((p, i) => setTimeout(() => { if (c.refs === r) ring(r.fxg, p[0], p[1], 5, 3, "k-rip rip", 700); }, sleep(i * 90)));
      }
      if (ev.kind === "decided") anim(r.nodes[ev.at], [{ filter: "brightness(1.8)" }, { filter: "brightness(1)" }], { duration: 700 });
    },
  });
})();
