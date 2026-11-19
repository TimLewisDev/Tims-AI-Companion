// Aurora (looks.js): a polar night on a mountain ridge. Every stage is a camp on the ridgeline, a
// lantern walks the crest, and the northern lights grow across the sky above the stages passed; when
// the feature is merged they span the whole sky. The lights take the mode's colour. Drawn from
// docs/overview/themes-round3.html (G).
"use strict";
(() => {
  const { S, T, seeded, lerp, ease, smooth, poly, lens, dash, tween, anim, fxEl, ring, markerAt, planSpan } = TattyLooks.kit;
  TattyLooks.register({
    id: "aur", name: "Aurora", cls: "t-aur",
    voc: { cont: "Trek on to", skip: "Pass by", stop: "Rest till dawn" },
    pts(m) { const N = m.nodes.length; return m.nodes.map((n, i) => { const t = i / Math.max(1, N - 1); return [70 + 860 * t, 178 - 16 * Math.sin(t * 9.2 + 1.1) - 8 * Math.sin(t * 3.1)]; }); },
    draw(svg, m, card) {
      const pts = this.pts(m), g = S("g", {}, svg), rnd = seeded(41), mk = markerAt(m), uid = card.uid, defs = S("defs", {}, g), N = m.nodes.length, span = planSpan(m);
      const stars = [];
      for (let i = 0; i < 46; i++) { const s = S("circle", { cx: (rnd() * 1000).toFixed(1), cy: (rnd() * 150).toFixed(1), r: (.35 + rnd() * .8).toFixed(2), class: "a-star", opacity: (.25 + rnd() * .5).toFixed(2) }, g); if (i % 5 === 0) stars.push(s); }
      // the aurora: curtains with a bright lower edge and faint rays, shown only as far as the route has come
      const cg = S("linearGradient", { id: `ag-${uid}`, x1: 0, y1: 1, x2: 0, y2: 0 }, defs);
      [[0, "au-a", 0], [.14, "au-a", .7], [.42, "au-b", .3], [1, "au-b", 0]].forEach(([o, c, a]) => S("stop", { offset: o, class: c, "stop-opacity": a }, cg));
      const rays = S("linearGradient", { id: `as-${uid}`, gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2: 60, y2: 0, spreadMethod: "repeat" }, defs);
      [[0, 0], [.1, .5], [.18, 0], [.35, .35], [.42, 0], [.6, .6], [.7, 0], [.85, .3], [1, 0]].forEach(([o, a]) => S("stop", { offset: o, "stop-color": "#fff", "stop-opacity": a }, rays));
      const warm = S("radialGradient", { id: `aw-${uid}` }, defs);
      S("stop", { offset: 0, class: "a-w0", "stop-opacity": .75 }, warm); S("stop", { offset: .45, class: "a-w0", "stop-opacity": .28 }, warm); S("stop", { offset: 1, class: "a-w0", "stop-opacity": 0 }, warm);
      const mg = S("linearGradient", { id: `amg-${uid}`, gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2: 100, y2: 0 }, defs);
      S("stop", { offset: 0, "stop-color": "#fff", "stop-opacity": 1 }, mg); S("stop", { offset: 1, "stop-color": "#fff", "stop-opacity": 0 }, mg);
      const mask = S("mask", { id: `am-${uid}`, maskUnits: "userSpaceOnUse", x: -100, y: -100, width: 1300, height: 500 }, defs);
      S("rect", { x: -100, y: -100, width: 1300, height: 500, fill: `url(#amg-${uid})` }, mask);
      const sky = S("g", { mask: `url(#am-${uid})` }, g), tone = S("g", { class: "a-tone" }, sky);
      const bands = [[92, 62, 0, 1], [74, 84, 2.1, .8], [108, 48, 4.2, 1.2]].map(([base, hgt, ph, sp]) => ({ base, hgt, ph, sp, fill: S("path", { fill: `url(#ag-${uid})` }, tone), rays: S("path", { fill: `url(#as-${uid})`, class: "a-rays" }, tone) }));
      // the far range, jagged, then the near ridge whose crest is the route
      const far = [[-60, 260]]; for (let x = -60, k = 0; x <= 1080; x += 38 + rnd() * 30, k++) far.push([x, (k % 2 ? 150 : 120) + rnd() * 24]);
      S("path", { d: poly(far) + " L1080,260 L1080,900 L-60,900 Z", class: "a-far" }, g);
      S("path", { d: poly(far.slice(1)), class: "a-far-edge" }, g);
      const ext = [[-60, pts[0][1] + 8]].concat(pts, [[1060, pts[N - 1][1] + 6]]), d = smooth(ext);
      S("path", { d: d + " L1060,900 L-60,900 Z", class: "a-near" }, g);
      const crest = S("path", { d, class: "a-crest" }, g), lg = lens(crest, pts), done = S("path", { d, class: "a-done" }, g);
      dash(done, m.mode === "complete" ? lg.L : lg.at[mk], lg.L);
      if (span) T("PLAN", { x: (pts[span[0]][0] + pts[span[1]][0]) / 2, y: Math.min(...pts.slice(span[0], span[1] + 1).map(p => p[1])) - 40, class: "grp" }, g);
      const glows = [], beacons = [];
      const nodes = pts.map((p, i) => {
        const n = m.nodes[i], s = m.st[i], outer = S("g", { transform: `translate(${p[0].toFixed(1)},${p[1].toFixed(1)})` }, g), ng = S("g", { class: "acamp pop-b " + s }, outer);
        if (s === "out") S("circle", { r: 1.6, cy: -2, class: "a-pip" }, ng);
        else {
          if (s === "done" || s === "now") glows.push({ e: S("circle", { cy: -6, r: n.plan ? 16 : 24, fill: `url(#aw-${uid})`, opacity: .4 }, ng), now: s === "now" });
          if (n.plan) { S("path", { d: "M0,0 L0,-17", class: "a-pole" }, ng); S("path", { d: "M0,-17 L9,-14 L0,-11 Z", class: "a-flag" }, ng); }
          else { const k = i === N - 1 ? 1.3 : 1; S("path", { d: `M${-10 * k},0 L0,${-14 * k} L${10 * k},0 Z`, class: "a-tent" }, ng); S("path", { d: `M0,${-14 * k} L${-2.5 * k},0 L${2.5 * k},0 Z`, class: "a-door" }, ng); }
          if (s === "next") beacons.push(S("path", { d: "M0,-6 L1.4,-1.4 L6,0 L1.4,1.4 L0,6 L-1.4,1.4 L-6,0 L-1.4,-1.4 Z", class: "a-beacon", transform: "translate(0,-32)" }, outer));
        }
        const lb = T(n.l.toUpperCase(), { y: 22, class: "lbl" }, outer);
        if (s === "done" || s === "now") lb.classList.add("on"); if (s === "todo") lb.classList.add("todo");
        if (s === "skip") { lb.classList.add("struck"); T("passed by", { y: 34, class: "lbl2" }, outer); }
        if (s === "out") { lb.classList.add("faint"); T("left out", { y: 34, class: "lbl2" }, outer); }
        if (n.units && s !== "todo" && s !== "out") T(`${m.units}/${n.units} units`, { y: 34, class: "lbl2" }, outer);
        return ng;
      });
      const lamp = S("g", {}, g), bob = S("g", {}, lamp);
      S("circle", { r: 13, fill: `url(#aw-${uid})` }, bob); S("circle", { r: 2.6, class: "a-lamp" }, bob);
      const r = { nodes, glows, beacons, stars, bands, sky, mg, rays, crest, done, lg, pts, lamp, bob, fxg: S("g", {}, g),
        base: m.mode === "complete" ? 1 : m.mode === "running" ? .9 : .72 };
      r.place = l => { const q = crest.getPointAtLength(Math.max(0, Math.min(lg.L, l))); lamp.setAttribute("transform", `translate(${q.x.toFixed(1)},${(q.y - 9).toFixed(1)})`); };
      r.setX = X => { mg.setAttribute("x1", (X - 150).toFixed(1)); mg.setAttribute("x2", (X + 30).toFixed(1)); };
      r.wave = t => bands.forEach(b => {
        const lo = [], hi = [];
        for (let x = -60; x <= 1060; x += 40) {
          const y = b.base + 13 * Math.sin(x / 130 + t * .00035 * b.sp + b.ph) + 6 * Math.sin(x / 47 - t * .0006 * b.sp + b.ph * 2);
          lo.push([x, y]); hi.push([x, y - b.hgt * (.65 + .35 * Math.sin(x / 90 + t * .0003 + b.ph))]);
        }
        const dd = smooth(lo) + " L" + smooth(hi.reverse()).slice(1) + " Z";
        b.fill.setAttribute("d", dd); b.rays.setAttribute("d", dd);
      });
      r.setX(m.mode === "complete" ? 1200 : pts[mk][0] + 30); r.wave(performance.now()); sky.setAttribute("opacity", r.base);
      r.place(lg.at[mk] - 16);
      return r;
    },
    tick(t, c) {
      const r = c.refs;
      r.wave(t); r.rays.setAttribute("gradientTransform", `translate(${((t / 160) % 60).toFixed(1)},0)`);
      r.sky.setAttribute("opacity", Math.min(1, r.base + .08 * Math.sin(t / 1800)).toFixed(2));
      r.stars.forEach((s, i) => s.setAttribute("opacity", (.2 + .5 * Math.abs(Math.sin(t / 1700 + i * 2.3))).toFixed(2)));
      r.glows.forEach((o, i) => o.e.setAttribute("opacity", (o.now ? .5 + .22 * Math.sin(t / 380) : .36 + .06 * Math.sin(t / 900 + i)).toFixed(2)));
      r.beacons.forEach(b => b.setAttribute("transform", `translate(0,-32) scale(${(.8 + .35 * Math.abs(Math.sin(t / 520))).toFixed(2)}) rotate(${((t / 50) % 90).toFixed(1)})`));
      if (!c.moving) r.bob.setAttribute("transform", `translate(0,${(Math.sin(t / 700) * 1.2).toFixed(2)})`);
    },
    play(c, ev) {
      const r = c.refs, N = c.m.nodes.length, xOf = i => r.pts[Math.min(i, N - 1)][0] + 30;
      if (ev.kind === "advance") {
        const a = r.lg.at[ev.from], b = r.lg.at[ev.to], xa = xOf(ev.from), xb = xOf(ev.to); c.moving = true;
        dash(r.done, a, r.lg.L); r.place(a - 16); r.setX(xa);
        tween(1900, p => { const l = lerp(a, b, p); r.place(l - 16); dash(r.done, l, r.lg.L); r.setX(lerp(xa, xb, p)); r.bob.setAttribute("transform", `translate(0,${(-Math.abs(Math.sin(p * Math.PI * 6)) * 2.5).toFixed(1)})`); },
          ease.io, () => { if (c.refs !== r) return; c.moving = false; });
        anim(r.nodes[ev.to], [{ filter: "brightness(1)" }, { filter: "brightness(1.8)" }, { filter: "brightness(1)" }], { duration: 900, delay: 1600 });
      }
      if (ev.kind === "finish" || ev.kind === "complete" || ev.kind === "unit") {
        const big = ev.kind !== "unit", at = Math.min(ev.at, N - 1);
        anim(r.nodes[at], [{ transform: "scale(1)" }, { transform: `scale(${big ? 1.35 : 1.15})` }, { transform: "scale(1)" }], { duration: 650 });
        anim(r.sky, [{ opacity: r.base }, { opacity: 1 }, { opacity: r.base }], { duration: big ? 2200 : 1200 });
        ring(r.fxg, r.pts[at][0], r.pts[at][1] - 6, 8, big ? 4 : 2.5, "a-rip rip", 1000);
      }
      if (ev.kind === "finish" && r.nodes[ev.to]) anim(r.nodes[ev.to], [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 400, fill: "backwards" });
      if (ev.kind === "skip") {
        anim(r.nodes[ev.at], [{ opacity: 1 }, { opacity: .3 }, { opacity: 1 }], { duration: 700 });
        if (r.nodes[ev.to]) anim(r.nodes[ev.to], [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 300, fill: "backwards" });
      }
      if (ev.kind === "complete") {
        const xa = xOf(ev.at); r.setX(xa); tween(2200, p => r.setX(lerp(xa, 1200, p)), ease.io);
        fxEl(r.fxg, "line", { x1: 300, y1: 30, x2: 236, y2: 4, class: "a-shoot" }, [{ transform: "translate(0,0)", opacity: 0 }, { opacity: 1, offset: .15 }, { transform: "translate(340px,140px)", opacity: 0 }], { duration: 1100, delay: 700, easing: "ease-in", fill: "backwards" });
        r.nodes.forEach((n, i) => anim(n, [{ filter: "brightness(1)" }, { filter: "brightness(1.9)" }, { filter: "brightness(1)" }], { duration: 600, delay: 300 + i * 90 }));
      }
      if (ev.kind === "decided") anim(r.nodes[ev.at], [{ filter: "brightness(1.9)" }, { filter: "brightness(1)" }], { duration: 700 });
    },
  });
})();
