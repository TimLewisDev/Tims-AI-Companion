// Chronograph (looks.js): a watch dial. The route is the chapter ring of a chronograph: an applied index
// for every stage round a wide arc, the seconds hand on where you are, and the elapsed ring filling in
// the mode's colour behind it. A sub-dial counts Build's units, another runs while a session works, and
// a date window shows the stage number. Drawn from docs/overview/themes-round3.html (F).
"use strict";
(() => {
  const { S, T, H, lerp, ease, backCss, tween, anim, ring, flashKf, markerAt, planSpan, unitsOf } = TattyLooks.kit;
  // The dial: a wide arc of a circle whose centre sits far below the scene, so the stages read left to right.
  const CX = 500, CY = 900, R = 830, A = 30;
  const angOf = (i, N) => -A + 2 * A * i / Math.max(1, N - 1);
  const polar = (deg, rr) => { const a = deg * Math.PI / 180; return [CX + rr * Math.sin(a), CY - rr * Math.cos(a)]; };
  const arcD = (rr, d0, d1) => { const [x0, y0] = polar(d0, rr), [x1, y1] = polar(d1, rr); return `M${x0.toFixed(1)},${y0.toFixed(1)} A${rr},${rr} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
  const unitAng = (k, B) => -150 + 300 * k / Math.max(1, B);

  TattyLooks.register({
    id: "chrono", name: "Chronograph", cls: "t-chr",
    voc: { cont: "Wind on to", skip: "Jump past", stop: "Stop the clock" },
    pts(m) { const N = m.nodes.length; return m.nodes.map((n, i) => polar(angOf(i, N), R)); },
    hero(card, h) {
      const m = card.m, N = m.nodes.length, w = H("div", "chr-hero"), left = H("div", "jy-hero-in"), win = H("div", "chr-win");
      left.append(H("div", "h-kick", h.kick), H("div", "h-big", h.big), H("div", "h-sub", h.sub));
      const shown = m.mode === "complete" ? N : m.cur + 1, num = H("span", "cw-n"), b = H("b", "", String(shown).padStart(2, "0"));
      num.append(b); win.append(H("small", "", "STAGE"), num, H("i", "", `/ ${N}`));
      w.append(left, win);
      if (card.ev) {
        anim(b, [{ transform: "translateY(-100%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 450, delay: 200, fill: "backwards", easing: backCss });
        anim(left.children[1], [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 450, delay: 100, fill: "backwards" });
      }
      return w;
    },
    draw(svg, m, card) {
      const g = S("g", {}, svg), uid = card.uid, mk = markerAt(m), pts = this.pts(m), N = m.nodes.length, span = planSpan(m);
      const clip = S("clipPath", { id: `cc-${uid}` }, S("defs", {}, g)); S("rect", { x: -20, y: -40, width: 1040, height: 302 }, clip);
      g.setAttribute("clip-path", `url(#cc-${uid})`);
      S("path", { d: arcD(R + 58, -38, 38), class: "c-ring" }, g);
      S("path", { d: arcD(R - 46, -38, 38), class: "c-ring" }, g);
      for (let k = 0; k <= 60; k++) {
        const a = -36 + k * 1.2, maj = k % 5 === 0, [x0, y0] = polar(a, R + (maj ? 15 : 18)), [x1, y1] = polar(a, R + 25);
        S("line", { x1: x0.toFixed(1), y1: y0.toFixed(1), x2: x1.toFixed(1), y2: y1.toFixed(1), class: "c-tick" + (maj ? " maj" : "") }, g);
      }
      S("path", { d: arcD(R + 31, -A, A), class: "c-track" }, g);
      const prog = S("path", { class: "c-prog" }, g);
      if (span) {
        S("path", { d: arcD(R - 56, angOf(span[0], N) - 1.5, angOf(span[1], N) + 1.5), class: "c-plan" }, g);
        const pa = angOf((span[0] + span[1]) / 2, N), [px, py] = polar(pa, R - 68);
        T("PLAN", { x: px.toFixed(1), y: py.toFixed(1), class: "grp", transform: `rotate(${pa.toFixed(2)} ${px.toFixed(1)} ${py.toFixed(1)})` }, g);
      }
      const nodes = pts.map((p, i) => {
        const n = m.nodes[i], s = m.st[i], a = angOf(i, N);
        const outer = S("g", { transform: `translate(${p[0].toFixed(1)},${p[1].toFixed(1)}) rotate(${a.toFixed(2)})` }, g), ng = S("g", { class: "ci pop " + s }, outer);
        const h = n.plan ? 14 : 24, w = n.plan ? 3.6 : 6;
        if (s === "out") S("circle", { r: 1.8, class: "c-pip" }, ng);
        else if (i === N - 1) { S("path", { d: "M-8,-12 L8,-12 L0,11 Z", class: "c-ix" }, ng); S("path", { d: "M-4,-8.5 L4,-8.5 L0,3.5 Z", class: "c-lume" }, ng); }
        else { S("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: 1, class: "c-ix" }, ng); S("rect", { x: -w / 2 + 1.2, y: -h / 2 + 2, width: w - 2.4, height: h * .55, rx: .6, class: "c-lume" }, ng); }
        if (s === "skip") S("line", { x1: -7, y1: 0, x2: 7, y2: 0, class: "c-skip" }, ng);
        const lb = T(n.l.toUpperCase(), { y: -42, class: "lbl" }, outer);
        if (s === "done" || s === "now") lb.classList.add("on"); if (s === "todo") lb.classList.add("todo");
        if (s === "skip") lb.classList.add("struck"); if (s === "out") lb.classList.add("faint");
        T(s === "skip" ? "—" : s === "out" ? "" : String(i + 1).padStart(2, "0"), { y: 30, class: "num" }, outer);
        return ng;
      });
      // the sub-dials (Build's units, when the route has a Build with units; the session's) and the maker's name
      const sub = (cx, cy, title) => { const sg = S("g", { transform: `translate(${cx},${cy})` }, g); S("circle", { r: 26, class: "c-sub" }, sg); T(title, { y: 39, class: "lbl2" }, sg); return sg; };
      const u = unitsOf(m), B = u ? u.total : 0;
      let uhand = null;
      if (u) {
        const built = m.st[u.i] === "done" ? B : m.st[u.i] === "now" ? m.units : 0, sl = sub(232, 214, `BUILD ${built}/${B}`);
        for (let k = 0; k <= B; k++) S("line", { x1: 0, y1: -24, x2: 0, y2: -19, class: "c-tick", transform: `rotate(${unitAng(k, B)})` }, sl);
        uhand = S("g", { transform: `rotate(${unitAng(built, B)})` }, sl); S("path", { d: "M-1.2,3 L-.5,-21 L.5,-21 L1.2,3 Z", class: "c-shand" }, uhand); S("circle", { r: 2.2, class: "c-pin" }, sl);
      }
      const sr = sub(768, 214, "SESSION");
      for (let k = 0; k < 12; k++) S("line", { x1: 0, y1: -24, x2: 0, y2: k % 3 ? -21 : -18, class: "c-tick", transform: `rotate(${k * 30})` }, sr);
      const shand = S("g", {}, sr); S("path", { d: "M-1,4 L-.4,-22 L.4,-22 L1,4 Z", class: "c-shand acc" }, shand); S("circle", { r: 2.2, class: "c-pin" }, sr);
      T("TATTY", { x: 500, y: 206, class: "brand" }, g); T("AUTOMATIC · CHRONOGRAPH", { x: 500, y: 220, class: "brand2" }, g);
      // the seconds hand, pivoting far below the scene
      const hand = S("g", {}, g);
      S("path", { d: `M${CX - 2.2},${CY - 560} L${CX - .7},${CY - R - 20} L${CX + .7},${CY - R - 20} L${CX + 2.2},${CY - 560} Z`, class: "c-hand" }, hand);
      S("rect", { x: CX - 1.7, y: CY - R - 15, width: 3.4, height: 22, rx: 1.2, class: "c-hand-lume" }, hand);
      const r = { nodes, hand, uhand, shand, prog, pts, B, N, fxg: S("g", {}, g) };
      r.setHand = a => { hand.setAttribute("transform", `rotate(${a.toFixed(3)} ${CX} ${CY})`); prog.setAttribute("d", arcD(R + 31, -A - .01, Math.max(-A, a))); };
      r.setHand(angOf(m.mode === "complete" ? N - 1 : mk, N));
      return r;
    },
    tick(t, c) {
      const r = c.refs, m = c.m;
      r.nodes.forEach((g, i) => {
        if (m.st[i] === "next") g.setAttribute("opacity", (.55 + .45 * Math.sin(t / 380)).toFixed(2));
        if (m.st[i] === "now") { const l = g.querySelector(".c-lume"); if (l) l.setAttribute("opacity", (.6 + .4 * Math.sin(t / 300)).toFixed(2)); }
      });
      // the session sub-dial runs while a session is open, in eight beats a second
      if (m.mode === "running" || m.mode === "decide") r.shand.setAttribute("transform", `rotate(${((Math.floor(t / 125) * 1.5) % 360).toFixed(1)})`);
    },
    play(c, ev) {
      const r = c.refs, N = r.N, click = i => ring(r.fxg, ...r.pts[i], 9, 3, "c-rip rip", 800);
      if (ev.kind === "advance" || (ev.kind === "complete" && ev.at !== N - 1)) {
        const from = ev.kind === "advance" ? ev.from : ev.at, to = ev.kind === "advance" ? ev.to : N - 1, a = angOf(from, N), b = angOf(to, N);
        r.setHand(a); c.moving = true;
        tween(1100, p => r.setHand(lerp(a, b, p)), ease.back, () => { if (c.refs !== r) return; c.moving = false; click(to); });
        if (ev.kind === "advance") anim(r.nodes[ev.to], [{ opacity: .3, transform: "scale(.6)" }, { opacity: 1, transform: "scale(1)" }], { duration: 500, delay: 900, fill: "backwards", easing: backCss });
      }
      if (ev.kind === "finish" || ev.kind === "complete" || ev.kind === "unit") { const at = Math.min(ev.at, N - 1); anim(r.nodes[at], flashKf(1.35), { duration: 600 }); click(at); }
      if (ev.kind === "unit" && r.uhand) { const u = c.m.units, B = r.B; tween(500, p => r.uhand.setAttribute("transform", `rotate(${lerp(unitAng(u - 1, B), unitAng(u, B), p).toFixed(1)})`), ease.back); }
      if (ev.kind === "finish" && r.nodes[ev.to]) anim(r.nodes[ev.to], [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 300, fill: "backwards" });
      if (ev.kind === "skip") {
        anim(r.nodes[ev.at], [{ transform: "scale(1.3)", opacity: 1 }, { transform: "scale(1)", opacity: .6 }], { duration: 500 });
        if (r.nodes[ev.to]) anim(r.nodes[ev.to], [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 250, fill: "backwards" });
      }
      if (ev.kind === "complete") r.nodes.forEach((n, i) => anim(n, [{ filter: "brightness(1)" }, { filter: "brightness(2)" }, { filter: "brightness(1)" }], { duration: 500, delay: 600 + i * 70 }));
      if (ev.kind === "decided") anim(r.nodes[ev.at], [{ filter: "brightness(1.8)" }, { filter: "brightness(1)" }], { duration: 600 });
    },
  });
})();
