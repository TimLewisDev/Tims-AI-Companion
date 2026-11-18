// Star Chart (looks.js, id chart): the feature is a voyage across a star chart. Each stage is a world on the
// course; Tatty's ship orbits the one being worked on, and at a gate it waits at the edge of the next
// world until you launch. Drawn from docs/overview/themes.html (A).
"use strict";
(() => {
  const { S, T, seeded, lerp, ease, backCss, smooth, lens, dash, tween, anim, burst, fxEl, markerAt, planSpan, motion } = TattyLooks.kit;
  TattyLooks.register({
    id: "chart", name: "Star Chart", cls: "t-star",
    voc: { cont: "Launch to", skip: "Slingshot past", stop: "Hold orbit" },
    pts(m) { const N = m.nodes.length; return m.nodes.map((n, i) => { const t = i / Math.max(1, N - 1); return [70 + 860 * t, 200 - 120 * Math.sin(Math.PI * (.06 + .88 * t))]; }); },
    draw(svg, m, card) {
      const pts = this.pts(m), g = S("g", {}, svg), rnd = seeded(7), stars = [], span = planSpan(m);
      const nd = S("defs", {}, g);
      [["a", "nb-a", 220, 70, 330, 90], ["b", "nb-b", 760, 200, 300, 80], ["c", "nb-c", 520, 120, 260, 70]].forEach(([k, cl, cx, cy, rx, ry]) => {
        const rg = S("radialGradient", { id: `neb-${k}-${card.uid}` }, nd); S("stop", { offset: 0, class: cl, "stop-opacity": .55 }, rg); S("stop", { offset: 1, class: cl, "stop-opacity": 0 }, rg);
        S("ellipse", { cx, cy, rx, ry, fill: `url(#neb-${k}-${card.uid})`, class: "nebula" }, g);
      });
      for (let i = 0; i < 110; i++) stars.push(S("circle", { cx: (rnd() * 1000).toFixed(1), cy: (rnd() * 260).toFixed(1), r: (.4 + rnd() * 1.3).toFixed(2), class: "star" }, g));
      S("ellipse", { cx: 500, cy: 330, rx: 540, ry: 250, class: "orbit" }, g);
      S("ellipse", { cx: 500, cy: 330, rx: 470, ry: 205, class: "orbit" }, g);
      const d = smooth(pts), course = S("path", { d, class: "course" }, g), lg = lens(course, pts), mk = markerAt(m);
      const glow = S("path", { d, class: "course-glow" }, g), done = S("path", { d, class: "course-done" }, g);
      dash(glow, lg.at[mk], lg.L); dash(done, lg.at[mk], lg.L);
      if (span) T("PLAN", { x: (pts[span[0]][0] + pts[span[1]][0]) / 2, y: Math.min(...pts.slice(span[0], span[1] + 1).map(p => p[1])) - 34, class: "grp" }, g);
      const rad = [], nodes = pts.map((p, i) => {
        const n = m.nodes[i], s = m.st[i], r = n.plan ? 8 : 13; rad.push(r);
        const outer = S("g", { transform: `translate(${p[0]},${p[1]})` }, g), ng = S("g", { class: "pl pop " + s }, outer);
        if (s === "out") { S("circle", { r: 5, class: "ghost" }, ng); T(n.l.toUpperCase(), { y: 22, class: "lbl" }, ng); T("left out", { y: 34, class: "lbl2" }, ng); return ng; }
        S("circle", { r: r + 9, class: "halo" }, ng); S("circle", { r: r + 6, class: "ring" }, ng); S("circle", { r, class: "body" }, ng);
        if (s === "done") S("ellipse", { rx: r + 7, ry: 3, class: "band", transform: "rotate(-18)" }, ng);
        if (s === "skip") S("line", { x1: -r - 5, y1: r + 5, x2: r + 5, y2: -r - 5, class: "slash" }, ng);
        T(n.l.toUpperCase(), { y: r + 22, class: "lbl" }, ng);
        if (n.units && s !== "todo") T(`${m.units}/${n.units} units`, { y: r + 34, class: "lbl2" }, ng);
        if (s === "skip") T("skipped", { y: r + 34, class: "lbl2" }, ng);
        return ng;
      });
      const ship = S("g", {}, g), bob = S("g", {}, ship);
      const flame = S("path", { d: "M-6,0 L-17,0", class: "flame" }, bob);
      S("path", { d: "M12,0 L-8,-7 L-4,0 L-8,7 Z", class: "hull" }, bob);
      const place = l => {
        const a = course.getPointAtLength(l), b = course.getPointAtLength(Math.min(lg.L, l + 2)), c = course.getPointAtLength(Math.max(0, l - 2));
        ship.setAttribute("transform", `translate(${a.x},${a.y}) rotate(${Math.atan2(b.y - c.y, b.x - c.x) * 180 / Math.PI})`);
      };
      place(lg.at[mk]);
      return { stars, nodes, rad, ship, bob, flame, place, lg, done, glow, pts, shoot: S("g", {}, g), nextShoot: performance.now() + 2500 };
    },
    tick(t, c) {
      const r = c.refs, m = c.m;
      if (motion() && !c.mini && t > r.nextShoot) {
        r.nextShoot = t + 5000 + Math.random() * 4000;
        const x = 80 + Math.random() * 600, y = 6 + Math.random() * 70;
        fxEl(r.shoot, "line", { x1: x, y1: y, x2: x - 64, y2: y - 26, class: "shoot" }, [{ transform: "translate(0,0)", opacity: 0 }, { opacity: 1, offset: .15 }, { transform: "translate(300px,122px)", opacity: 0 }], { duration: 950, easing: "ease-in" });
      }
      r.stars.forEach((s, i) => { if (i % 3 === 0) s.setAttribute("opacity", (.3 + .7 * Math.abs(Math.sin(t / 1300 + i * 1.7))).toFixed(2)); });
      r.nodes.forEach((g, i) => {
        if (m.st[i] === "now") g.querySelector(".halo").setAttribute("r", (r.rad[i] + 9 + Math.sin(t / 280) * 3).toFixed(1));
        if (m.st[i] === "next") g.querySelector(".ring").setAttribute("transform", `rotate(${((t / 22) % 360).toFixed(1)})`);
      });
      r.flame.setAttribute("opacity", (.45 + .55 * Math.random()).toFixed(2));
      if (c.moving) return;
      const orbit = m.mode === "running" || m.mode === "decide" || m.mode === "complete";
      r.bob.setAttribute("transform", orbit ? `rotate(${((t / (m.mode === "decide" ? 30 : 12)) % 360).toFixed(1)}) translate(0,-${r.rad[m.cur] + 15})` : `translate(0,${(Math.sin(t / 380) * 2.5).toFixed(2)})`);
    },
    play(c, ev) {
      const r = c.refs, N = c.m.nodes.length;
      if (ev.kind === "advance") {
        c.moving = true; r.bob.setAttribute("transform", "");
        const a = r.lg.at[ev.from], b = r.lg.at[ev.to];
        dash(r.done, a, r.lg.L); dash(r.glow, a, r.lg.L);
        anim(r.glow, [{ opacity: .18, strokeWidth: 9 }, { opacity: .7, strokeWidth: 16 }, { opacity: .18, strokeWidth: 9 }], { duration: 1500 });
        tween(1500, p => { const l = lerp(a, b, p); r.place(l); dash(r.done, l, r.lg.L); dash(r.glow, l, r.lg.L); }, ease.io, () => { if (c.refs !== r) return; c.moving = false; burst(c, ...r.pts[ev.to], 10, 40); });
        anim(r.nodes[ev.to], [{ transform: "scale(.4)", opacity: .2 }, { transform: "scale(1)", opacity: 1 }], { duration: 900, delay: 900, fill: "backwards", easing: backCss });
      }
      if (ev.kind === "finish" || ev.kind === "unit" || ev.kind === "complete") {
        const at = Math.min(ev.at, N - 1);
        anim(r.nodes[at], [{ transform: "scale(1)" }, { transform: "scale(1.6)" }, { transform: "scale(1)" }], { duration: 700 });
        burst(c, ...r.pts[at], ev.kind === "unit" ? 8 : 22, ev.kind === "unit" ? 30 : 70);
      }
      if (ev.kind === "finish" && r.nodes[ev.to]) anim(r.nodes[ev.to], [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: "scale(1)" }], { duration: 800, delay: 350, fill: "backwards" });
      if (ev.kind === "skip") {
        anim(r.nodes[ev.at], [{ transform: "scale(1) rotate(0deg)", opacity: 1 }, { transform: "scale(.6) rotate(-40deg)", opacity: .2 }, { transform: "scale(1) rotate(0deg)", opacity: .42 }], { duration: 900 });
        if (r.nodes[ev.to]) anim(r.nodes[ev.to], [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 400, fill: "backwards" });
      }
      if (ev.kind === "complete") r.pts.forEach((p, i) => setTimeout(() => { if (c.refs === r) burst(c, p[0], p[1], 8, 40); }, i * 90));
      if (ev.kind === "decided") anim(r.nodes[ev.at], [{ filter: "brightness(2)" }, { filter: "brightness(1)" }], { duration: 700 });
    },
  });
})();
