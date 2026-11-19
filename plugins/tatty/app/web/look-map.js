// Expedition Map (looks.js): the trail inks itself in as you go, a flag is planted at every stage you
// close, the hiker hops along while a session works, and a skipped stage gets a detour drawn round it.
// Drawn from docs/overview/themes.html (B).
"use strict";
(() => {
  const { S, T, seeded, lerp, ease, smooth, lens, dash, tween, anim, drawIn, burst, markerAt, planSpan } = TattyLooks.kit;
  TattyLooks.register({
    id: "map", name: "Expedition Map", cls: "t-map",
    voc: { cont: "Set out for", skip: "Detour round", stop: "Make camp" },
    pts(m) { const N = m.nodes.length; return m.nodes.map((n, i) => { const t = i / Math.max(1, N - 1); return [60 + 880 * t, 128 + 50 * Math.sin(t * Math.PI * 2.4 + .4)]; }); },
    draw(svg, m) {
      const pts = this.pts(m), g = S("g", {}, svg), rnd = seeded(11), N = m.nodes.length, span = planSpan(m);
      [[230, 40, 7], [700, 235, 6], [900, 30, 4], [470, 150, 3]].forEach(([cx, cy, k]) => {
        for (let j = 1; j <= k; j++) {
          const R = j * 22, q = [];
          for (let a = 0; a < 24; a++) { const ang = a / 24 * Math.PI * 2, rr = R * (1 + .16 * Math.sin(ang * 3 + j) + .06 * rnd()); q.push([cx + Math.cos(ang) * rr * 1.5, cy + Math.sin(ang) * rr * .8]); }
          q.push(q[0], q[1]);
          S("path", { d: smooth(q), class: "contour" }, g);
        }
      });
      const trng = seeded(23);
      [[150, 232], [330, 238], [560, 240], [770, 228], [120, 24], [650, 24], [860, 18]].forEach(([cx, cy]) => {
        for (let k = 0; k < 5; k++) {
          const x = cx + (trng() - .5) * 56, y = cy + (trng() - .5) * 14, h = 14 + trng() * 12;
          S("path", { d: `M${(x - 6).toFixed(1)},${y.toFixed(1)} L${x.toFixed(1)},${(y - h).toFixed(1)} L${(x + 6).toFixed(1)},${y.toFixed(1)} Z`, class: "tree" + (k % 2 ? " t2" : "") }, g);
        }
      });
      const rose = S("g", { transform: "translate(965,40)" }, g);
      S("circle", { r: 16, class: "rose" }, rose); S("path", { d: "M0,-20 L4,0 L0,20 L-4,0 Z", class: "rose" }, rose); T("N", { y: -24, class: "rose-t" }, rose);
      const d = smooth(pts), trail = S("path", { d, class: "trail" }, g), lg = lens(trail, pts), mk = markerAt(m);
      const done = S("path", { d, class: "trail-done" }, g); dash(done, lg.at[mk], lg.L);
      if (span) T("the planning ridge", { x: (pts[span[0]][0] + pts[span[1]][0]) / 2, y: 46, class: "ridge" }, g);
      const detours = {}, nodes = pts.map((p, i) => {
        const n = m.nodes[i], s = m.st[i], ng = S("g", { transform: `translate(${p[0]},${p[1]})` }, g), inner = S("g", { class: "pop-b" }, ng);
        const lb = T(n.l, { y: 30, class: "lbl" }, ng);
        if (i === N - 1) {
          S("path", { d: "M-15,4 L0,-22 L15,4 Z", class: "tent " + (s === "done" ? "" : "todo") }, inner); S("path", { d: "M0,-22 L0,4", class: "pole" }, inner);
          return inner;
        }
        if (s === "done") { S("circle", { r: 3.5, class: "wp-dot" }, inner); S("path", { d: "M0,2 L0,-30", class: "pole" }, inner); S("path", { d: "M0,-30 L17,-24 L0,-18 Z", class: "flag" }, inner); }
        else if (s === "next") { S("circle", { r: 9, class: "nextring" }, inner); S("circle", { r: 3, class: "wp-dot" }, inner); }
        else if (s === "now") { S("circle", { r: 3, class: "wp-dot" }, inner); }
        else if (s === "todo") { S("circle", { r: 3.5, class: "wp-dot", opacity: .6 }, inner); lb.classList.add("todo"); }
        else if (s === "skip") {
          T("✕", { y: 6, class: "xm" }, inner); lb.classList.add("struck");
          const up = p[1] > 128 ? 1 : -1;
          detours[i] = S("path", { d: `M${p[0] - 34},${p[1]} C${p[0] - 30},${p[1] + up * 48} ${p[0] + 30},${p[1] + up * 48} ${p[0] + 34},${p[1]}`, class: "detour", pathLength: 1 }, g);
        } else if (s === "out") { lb.classList.add("faint"); lb.textContent = n.l + " (left out)"; }
        if (n.units && s !== "todo") T(`${m.units} of ${n.units} units`, { y: 44, class: "lbl faint" }, ng);
        return inner;
      });
      const hk = S("g", {}, g), bob = S("g", {}, hk);
      S("ellipse", { rx: 8, ry: 2.5, cy: 9, class: "shadow" }, hk);
      S("circle", { r: 8, class: "hiker" }, bob);
      const place = l => { const a = trail.getPointAtLength(l); hk.setAttribute("transform", `translate(${a.x},${a.y})`); };
      place(lg.at[mk]);
      return { nodes, detours, hk, bob, place, lg, done, pts };
    },
    tick(t, c) {
      const r = c.refs, m = c.m;
      r.nodes.forEach((g, i) => { if (m.st[i] === "next") { const ring = g.querySelector(".nextring"); if (ring) ring.setAttribute("transform", `rotate(${((t / 30) % 360).toFixed(1)}) scale(${(1 + .1 * Math.sin(t / 300)).toFixed(3)})`); } });
      if (c.moving) return;
      const y = m.mode === "running" ? -Math.abs(Math.sin(t / 240)) * 7 : m.mode === "complete" ? -Math.abs(Math.sin(t / 160)) * 10 : Math.sin(t / 700) * 1.2;
      r.bob.setAttribute("transform", `translate(0,${y.toFixed(2)})`);
    },
    play(c, ev) {
      const r = c.refs, N = c.m.nodes.length;
      if (ev.kind === "advance") {
        c.moving = true; const a = r.lg.at[ev.from], b = r.lg.at[ev.to]; dash(r.done, a, r.lg.L);
        tween(1700, p => { const l = lerp(a, b, p); r.place(l); dash(r.done, l, r.lg.L); r.bob.setAttribute("transform", `translate(0,${(-Math.abs(Math.sin(p * Math.PI * 7)) * 8).toFixed(1)})`); }, ease.io, () => { c.moving = false; });
      }
      if (ev.kind === "finish" || ev.kind === "complete") {
        const at = Math.min(ev.at, N - 1);
        anim(r.nodes[at], [{ transform: "scaleY(0)" }, { transform: "scaleY(1.2)", offset: .7 }, { transform: "scaleY(1)" }], { duration: 650, easing: "ease-out" });
        burst(c, r.pts[at][0], r.pts[at][1] - 20, 20, 60);
      }
      if (ev.kind === "finish" && r.nodes[ev.to]) anim(r.nodes[ev.to], [{ opacity: 0, transform: "scale(.2)" }, { opacity: 1, transform: "scale(1)" }], { duration: 700, delay: 500, fill: "backwards" });
      if (ev.kind === "unit") { anim(r.bob, [{ transform: "translate(0,0)" }, { transform: "translate(0,-16px)" }, { transform: "translate(0,0)" }], { duration: 450 }); burst(c, ...r.pts[ev.at], 8, 30); }
      if (ev.kind === "skip" || (ev.kind === "complete" && ev.skipped != null)) {
        const i = ev.kind === "skip" ? ev.at : ev.skipped;
        drawIn(r.detours[i], 900);
        anim(r.nodes[i], [{ opacity: 0, transform: "scale(2)" }, { opacity: 1, transform: "scale(1)" }], { duration: 500, delay: 200, fill: "backwards" });
      }
      if (ev.kind === "complete") {
        anim(r.nodes[N - 1], [{ transform: "scale(0)" }, { transform: "scale(1.3)", offset: .7 }, { transform: "scale(1)" }], { duration: 800, delay: 300, fill: "backwards" });
        setTimeout(() => { if (c.refs === r) burst(c, r.pts[N - 1][0], r.pts[N - 1][1] - 20, 40, 110); }, 500);
      }
    },
  });
})();
