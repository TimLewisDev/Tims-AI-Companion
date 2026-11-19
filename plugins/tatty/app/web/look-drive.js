// Night Drive (looks.js): a road at night through a sleeping city. Every stage is a streetlamp; the
// ones closed are lit and pool amber light on the road, and a long-exposure light trail follows the car
// from the start of the feature to where it is now. The city's windows come on behind you; a skip takes
// the flyover past a dark lamp. Drawn from docs/overview/themes-round3.html (H).
"use strict";
(() => {
  const { S, T, seeded, lerp, ease, smooth, lens, dash, tween, anim, drawIn, markerAt, planSpan } = TattyLooks.kit;
  const H0 = n => n.plan ? 36 : 50;
  TattyLooks.register({
    id: "drive", name: "Night Drive", cls: "t-drv",
    voc: { cont: "Drive on to", skip: "Bypass", stop: "Pull over" },
    pts(m) { const N = m.nodes.length; return m.nodes.map((n, i) => { const t = i / Math.max(1, N - 1); return [70 + 860 * t, 184 + 7 * Math.sin(t * 6.5 + .8)]; }); },
    draw(svg, m, card) {
      const pts = this.pts(m), g = S("g", {}, svg), rnd = seeded(53), mk = markerAt(m), uid = card.uid, defs = S("defs", {}, g), full = m.mode === "complete", N = m.nodes.length, span = planSpan(m);
      const cone = S("linearGradient", { id: `dc-${uid}`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      S("stop", { offset: 0, class: "d-c0", "stop-opacity": .55 }, cone); S("stop", { offset: 1, class: "d-c0", "stop-opacity": 0 }, cone);
      const bm = S("linearGradient", { id: `db-${uid}`, x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
      S("stop", { offset: 0, class: "d-b0", "stop-opacity": .5 }, bm); S("stop", { offset: 1, class: "d-b0", "stop-opacity": 0 }, bm);
      // the skyline: two rows of blocks; windows are lit more often behind the car than ahead of it
      const mx = full ? 1100 : pts[mk][0], twk = [], winGs = [];
      [[150, 46, 120, 22, "d-far", .6], [170, 30, 84, 30, "d-near", 1]].forEach(([base, h0, h1, w0, cls, wk]) => {
        const bg = S("g", {}, g), wg = S("g", {}, g); winGs.push(wg);
        for (let x = -30; x < 1030;) {
          const w = w0 + rnd() * w0 * 1.4, h = h0 + rnd() * (h1 - h0), y = base - h;
          S("rect", { x: x.toFixed(1), y: y.toFixed(1), width: w.toFixed(1), height: (h + 60).toFixed(1), class: cls }, bg);
          const mast = rnd() < .25, mh = 8 + rnd() * 14;
          if (mast) S("line", { x1: (x + w * .5).toFixed(1), y1: y.toFixed(1), x2: (x + w * .5).toFixed(1), y2: (y - mh).toFixed(1), class: "d-mast " + cls }, bg);
          for (let wy = y + 6; wy < base - 4; wy += 9) for (let wx = x + 4; wx < x + w - 5; wx += 7) {
            const p = rnd(), q = rnd();
            if (p < (wx < mx ? .34 : .07) * wk) { const e = S("rect", { x: wx.toFixed(1), y: wy.toFixed(1), width: 3, height: 4, class: "d-win" }, wg); if (q < .06) twk.push(e); }
          }
          x += w + 2 + rnd() * 8;
        }
      });
      const ext = [[-40, pts[0][1] + 2]].concat(pts, [[1040, pts[N - 1][1] - 2]]), d = smooth(ext);
      S("path", { d: d + " L1040,900 L-40,900 Z", class: "d-ground" }, g);
      // lamp posts stand behind the road; their light falls in front of it
      const backs = pts.map((p, i) => {
        const n = m.nodes[i], s = m.st[i], bg = S("g", { transform: `translate(${p[0].toFixed(1)},${(p[1] - 10).toFixed(1)})`, class: "dl " + s }, g), h = H0(n);
        if (s === "out") { S("path", { d: "M0,0 L0,-12", class: "d-post" }, bg); return bg; }
        S("path", { d: `M0,0 L0,${-h} Q0,${-h - 6} 7,${-h - 6} L13,${-h - 6}`, class: "d-post" }, bg);
        S("rect", { x: 10, y: -h - 8, width: 9, height: 3.4, rx: 1.5, class: "d-head" }, bg);
        return bg;
      });
      S("path", { d, class: "d-kerb" }, g); const road = S("path", { d, class: "d-road" }, g); S("path", { d, class: "d-lane" }, g);
      const lg = lens(road, pts), L = lg.L, upto = full ? L : lg.at[mk];
      const lights = {}, flys = {};
      pts.forEach((p, i) => {
        const n = m.nodes[i], s = m.st[i], h = H0(n);
        if (s === "done" || s === "now" || s === "next") {
          const lt = S("g", { transform: `translate(${p[0].toFixed(1)},${(p[1] - 10).toFixed(1)})`, opacity: s === "next" ? .25 : s === "now" ? .9 : 1 }, g);
          S("path", { d: `M10,${-h - 5} L19,${-h - 5} L40,14 L-11,14 Z`, fill: `url(#dc-${uid})` }, lt);
          S("ellipse", { cx: 14.5, cy: 12, rx: 30, ry: 5, class: "d-pool" }, lt);
          lights[i] = lt;
        }
        if (s === "skip") flys[i] = S("path", { d: "M-58,0 C-34,-32 34,-32 58,0", class: "d-fly", pathLength: 1, transform: `translate(${p[0].toFixed(1)},${p[1].toFixed(1)})` }, g);
      });
      const trails = [S("path", { d, class: "d-trail-glow" }, g), S("path", { d, class: "d-trail r", transform: "translate(0,4)" }, g), S("path", { d, class: "d-trail w", transform: "translate(0,-3)" }, g)];
      trails.forEach(e => dash(e, upto, L));
      pts.forEach((p, i) => {
        const n = m.nodes[i], s = m.st[i], og = S("g", { transform: `translate(${p[0].toFixed(1)},${p[1].toFixed(1)})` }, g);
        const lb = T(n.l.toUpperCase(), { y: 30, class: "lbl" }, og);
        if (s === "done" || s === "now") lb.classList.add("on"); if (s === "todo") lb.classList.add("todo");
        if (s === "skip") { lb.classList.add("struck"); T("bypassed", { y: 42, class: "lbl2" }, og); }
        if (s === "out") { lb.classList.add("faint"); T("left out", { y: 42, class: "lbl2" }, og); }
        if (n.units && s !== "todo" && s !== "out") T(`${m.units}/${n.units} units`, { y: 42, class: "lbl2" }, og);
      });
      if (span) {
        const by = Math.max(...pts.slice(span[0], span[1] + 1).map(p => p[1])) + 50, bx0 = pts[span[0]][0] - 30, bx1 = pts[span[1]][0] + 30;
        S("path", { d: `M${bx0},${by - 4} L${bx0},${by} L${bx1},${by} L${bx1},${by - 4}`, class: "d-brk" }, g);
        T("PLAN", { x: (bx0 + bx1) / 2, y: by + 11, class: "grp" }, g);
      }
      // the car, in profile, headlights on
      const car = S("g", {}, g), body = S("g", {}, car);
      const beam = S("path", { d: "M21,-7 L130,-24 L130,12 Z", fill: `url(#db-${uid})` }, body);
      S("path", { d: "M-24,-3 L-24,-7 Q-22,-10 -15,-10.5 L-8,-15.5 Q0,-17.5 8,-15.5 L15,-10.5 Q22,-9.5 24,-6 L24,-3 Z", class: "d-car" }, body);
      S("path", { d: "M-7,-14.3 L7,-14.3 L12.5,-10.5 L-11,-10.5 Z", class: "d-glass" }, body);
      [-13, 13].forEach(x => S("circle", { cx: x, cy: -2.5, r: 3.8, class: "d-wheel" }, body));
      S("rect", { x: 21.5, y: -8.5, width: 2.5, height: 2.4, rx: .6, class: "d-hl" }, body);
      const tail = S("rect", { x: -24.5, y: -8.5, width: 2, height: 2.6, rx: .5, class: "d-tl" }, body);
      const r = { nodes: backs, lights, flys, trails, road, lg, L, pts, car, body, beam, tail, twk, winGs, nextTw: 0 };
      r.place = l => {
        const at = k => road.getPointAtLength(Math.max(0, Math.min(L, k))), a = at(l), b = at(l + 3), c0 = at(l - 3);
        car.setAttribute("transform", `translate(${a.x.toFixed(1)},${(a.y + 7).toFixed(1)}) rotate(${(Math.atan2(b.y - c0.y, b.x - c0.x) * 180 / Math.PI).toFixed(2)})`);
      };
      r.place(lg.at[full ? N - 1 : mk]);
      return r;
    },
    tick(t, c) {
      const r = c.refs, m = c.m;
      Object.keys(r.lights).forEach(i => {
        const s = m.st[i], e = r.lights[i];
        if (s === "next") e.setAttribute("opacity", (Math.random() < .03 ? .04 : .16 + .12 * (.5 + .5 * Math.sin(t / 600))).toFixed(2));
        if (s === "now") e.setAttribute("opacity", (.82 + .15 * Math.sin(t / 500)).toFixed(2));
      });
      const lv = c.moving ? 1 : m.mode === "running" ? .85 : m.mode === "decide" ? .6 + .2 * Math.sin(t / 300) : m.mode === "complete" ? .3 : .4;
      r.beam.setAttribute("opacity", lv.toFixed(2));
      r.body.setAttribute("transform", !c.moving && m.mode === "running" ? `translate(0,${(Math.sin(t / 40) * .3).toFixed(2)})` : "");
      if (r.twk.length && t > r.nextTw) { r.nextTw = t + 400 + Math.random() * 900; const e = r.twk[Math.floor(Math.random() * r.twk.length)]; e.setAttribute("opacity", e.getAttribute("opacity") === ".15" ? "1" : ".15"); }
    },
    play(c, ev) {
      const r = c.refs, N = c.m.nodes.length;
      const flick = (i, delay) => { const e = r.lights[i]; if (e) anim(e, [{ opacity: 0 }, { opacity: .8, offset: .15 }, { opacity: .1, offset: .3 }, { opacity: .9, offset: .5 }, { opacity: .3, offset: .62 }, { opacity: 1 }], { duration: 900, delay: delay || 0, fill: "backwards", easing: "linear" }); };
      const drive = (a, b, ms, end) => {
        c.moving = true; r.place(a); r.trails.forEach(e => dash(e, a, r.L));
        tween(ms, p => { const l = lerp(a, b, p); r.place(l); r.trails.forEach(e => dash(e, l, r.L)); }, ease.io, () => {
          if (c.refs !== r) return; c.moving = false; if (end) r.trails.forEach(e => dash(e, end, r.L));
          anim(r.tail, [{ filter: "brightness(1)" }, { filter: "brightness(2.6)" }, { filter: "brightness(1)" }], { duration: 600 });
        });
      };
      if (ev.kind === "advance") drive(r.lg.at[ev.from], r.lg.at[ev.to], 1900);
      if (ev.kind === "finish" || ev.kind === "complete") flick(Math.min(ev.at, N - 1));
      if (ev.kind === "unit" && r.lights[ev.at]) anim(r.lights[ev.at], [{ opacity: 1 }, { opacity: .35 }, { opacity: 1 }], { duration: 500 });
      if (ev.kind === "finish" && r.lights[ev.to]) anim(r.lights[ev.to], [{ opacity: 0 }, { opacity: .25 }], { duration: 600, delay: 500, fill: "backwards" });
      if (ev.kind === "skip" || (ev.kind === "complete" && ev.skipped != null)) drawIn(r.flys[ev.kind === "skip" ? ev.at : ev.skipped], 900);
      if (ev.kind === "complete") {
        if (ev.at < N - 1) drive(r.lg.at[ev.at], r.lg.at[N - 1], 1400, r.L);
        Object.keys(r.lights).forEach((i, k) => { if (+i !== ev.at) flick(+i, 300 + k * 110); });
        r.winGs.forEach(w => anim(w, [{ opacity: .45 }, { opacity: 1 }], { duration: 1600, delay: 500, fill: "backwards" }));
      }
      if (ev.kind === "decided" && r.lights[ev.at]) anim(r.lights[ev.at], [{ filter: "brightness(1.8)" }, { filter: "brightness(1)" }], { duration: 700 });
    },
  });
})();
