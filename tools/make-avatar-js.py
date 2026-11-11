#!/usr/bin/env python3
"""make-avatar-js.py: make plugins/tatty/app/web/avatar.js from the concept board's drawings
(docs/avatar/concepts.html). Run it after changing a drawing, a state or the wardrobe on the board.

usage: python tools/make-avatar-js.py

The board is the design record; avatar.js is what the app runs. It takes the board's tracks, states,
wardrobe, avatars and engine as they are, drops the directions that weren't chosen, and makes them
safe for the page's Content-Security-Policy (no style attributes, no style elements)."""
import os
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(root + "/docs/avatar/concepts.html", encoding="utf-8").read()
a = src.index("// ------------------------------------------------------------------ tracks")
b = src.index("// ------------------------------------------------------------------ the page")
code = src[a:b]

d0 = code.index("const D = {")
d1 = code.index("// ------------------------------------------------------------------ the animals")
code = code[:d0] + code[d1:]


def rep(x, y):
    global code
    assert code.count(x) == 1, (code.count(x), x[:80])
    code = code.replace(x, y)


rep("const STARTERS = [A, C, B, G, H, I];\nconst EARLIER = [BASE, D, E, F];\nconst DIRS = [...STARTERS, ...EARLIER];",
    "const AVATARS = [A, C, B, G, H, I];")
rep('style="fill:${cols[i % cols.length]}"', '${i % cols.length ? `fill="${cols[i % cols.length]}"` : \'class="fa"\'}')
rep('function svgFor(d, scale, viewBox, extra = "") {', 'function svgFor(d, scale, viewBox, extra = "", dress = "") {')
rep('const pv = d.pivots, pr = props(d), hs = d.anchors.hat.w / 68;', 'const pv = d.pivots, pr = props(d);')
rep(' style="--hs:${n(hs)}"', ' data-av="${d.id}" data-extra="${extra}"')
rep('xmlns="http://www.w3.org/2000/svg">\n    <g data-p="Back">', 'xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g class="dress ${dress}">\n    <g data-p="Back">')
rep('    <g data-p="Front">${pr.front}</g>\n  </svg>`;', '    <g data-p="Front">${pr.front}</g>\n  </g></svg>`;')
rep('    for (const svg of this.svgs) svg.setAttribute("class", `tatty st-${id} mo-${st.mouth}`);',
    '    this.id = id;\n    for (const svg of this.svgs) svg.setAttribute("class", `tatty st-${id} mo-${st.mouth} ${svg.dataset.extra || ""}`.trim());')
# (the board's text about the earlier directions has no place in the app)
code = code.replace("// ------------------------------------------------------------------ the directions\n// Each names the same pivots and anchors in its own drawing, so the shared\n// states and accessories land in the right places on every body.",
                    "// ------------------------------------------------------------------ the avatars\n// Each names the same pivots and anchors in its own drawing, so the shared\n// states and accessories land in the right places on every body. (Today's Tatty,\n// BASE, is what Polished Tatty is drawn over.)")

HEAD = '''// Tatty's avatars: the six he can be (Polished Tatty, his own, and five to unlock in the
// shop), the wardrobe of accessories, and what makes them move. The drawings and the
// motion are the concept board's (docs/avatar/concepts.html), where the look was chosen:
// each avatar is an SVG whose groups are named after TattyWindow.xaml's moving parts, and
// a performance is keyframe tracks of (value, seconds), eased into each other, as in
// Avatar.cs. Used by shop.js and wallet.js through window.TattyAvatar:
//   svg(id, {scale, box, outfit, cls}) -> the markup of one drawing (outfit: {slot: item id})
//   animate([svg elements], id, state) -> a running drawing: .setState(state), .play(state, seconds)
//   dress(svg element, outfit)         -> put an outfit on a drawing already on the page
// Nothing here writes a style attribute or a <style>: the page's CSP refuses both, so the
// generated rules (which item shows, what it takes off) go in through the CSSOM.
"use strict";

(() => {
'''

TAIL = r'''
// ------------------------------------------------------------------ for the page
const BY_ID = Object.fromEntries(AVATARS.map(d => [d.id, d]));
const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));
const avatarOf = id => BY_ID[id] || A;

const dressClass = outfit => Object.entries(outfit || {}).filter(([slot, id]) => id && ITEM[id] && ITEM[id].slot === slot)
  .map(([slot, id]) => `w-${slot}-${id}`).join(" ");

// The rules: what each state shows, which mouth, and for each item worn (a class on the
// drawing's .dress group) the item itself, the own bits it takes off and the pieces it puts
// on instead, and what it does to an antenna (hidden, or lifted out of the top by an amount
// that is the hat's, scaled to the avatar's head).
function rules() {
  const out = [
    STATE_IDS.map(s => `.tatty.st-${s} .p-${s}`).join(",") + "{display:inline}",
    ["neutral", "happy", "flat", "o", "wobble"].map(m => `.tatty.mo-${m} .m-${m}`).join(",") + "{display:inline}",
    WORKING.map(s => `.tatty.st-${s} .prog`).join(",") + "{display:inline}",
  ];
  for (const it of ITEMS) {
    const on = `.dress.w-${it.slot}-${it.id}`;
    out.push(`${on} .a-${it.id}{display:inline}`);
    for (const p of it.hides) out.push(`${on} .own-${p}{display:none}`);
    for (const p of it.shows) out.push(`${on} .with-${p}{display:inline}`);
    if (it.antenna === "hide") out.push(`${on} .antenna-wrap{display:none}`);
    else if (typeof it.antenna === "number") {
      for (const d of AVATARS) out.push(`.tatty[data-av="${d.id}"] ${on} .antenna-wrap{transform:translateY(-${n(it.antenna * d.anchors.hat.w / 68)}px)}`);
    }
  }
  return out;
}

function install() {
  const all = rules();
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(all.join("\n"));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    // no constructable sheets: into avatar.css's own sheet instead
    const own = [...document.styleSheets].find(s => (s.href || "").endsWith("/avatar.css"));
    if (own) for (const r of all) { try { own.insertRule(r, own.cssRules.length); } catch { /* one bad rule loses only itself */ } }
  }
  // The filters and gradients the drawings name (url(#ds) and the like), once, for every drawing.
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  defs.setAttribute("class", "tatty-defs");
  defs.setAttribute("aria-hidden", "true");
  defs.innerHTML = `<defs>
    <filter id="ds" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity=".35"/></filter>
    <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#ECE7DC"/></linearGradient>
    <linearGradient id="gFlame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE27A"/><stop offset=".55" stop-color="#FF9A3C"/><stop offset="1" stop-color="#FF5A2F" stop-opacity="0"/></linearGradient>
    <radialGradient id="gGlow"><stop offset="0" class="glow-stop" stop-opacity=".95"/><stop offset="1" class="glow-stop" stop-opacity="0"/></radialGradient>
  </defs>`;
  document.body.prepend(defs);
}

// Every drawing that moves, on one clock: a drawing not on show (another page, a hidden
// window) is skipped, one taken off the page is forgotten. About 30 frames a second is
// plenty, and kinder over Remote Desktop.
const running = new Set();
let looping = false, lastFrame = 0;
function loop(t) {
  if (!running.size) { looping = false; return; }
  requestAnimationFrame(loop);
  if (t - lastFrame < 30) return;
  lastFrame = t;
  if (document.hidden) return;
  const now = performance.now();
  for (const a of running) {
    if (!a.svgs[0].isConnected) { running.delete(a); clearTimeout(a.timer); continue; }
    if (a.svgs[0].getClientRects().length) a.frame(now);
  }
}

function animate(svgs, id, state = "idle") {
  const a = new Card(avatarOf(id), svgs.filter(Boolean));
  a.setState(state, performance.now());
  // one performance, then back to what he was doing (or `then`)
  a.play = (s, seconds, then) => {
    clearTimeout(a.timer);
    const back = then || (a.id === s ? "idle" : a.id);
    a.setState(s, performance.now());
    if (seconds) a.timer = setTimeout(() => a.setState(back, performance.now()), seconds * 1000);
  };
  running.add(a);
  if (!looping) { looping = true; requestAnimationFrame(loop); }
  return a;
}

// ------------------------------------------------------------------ for the tray app
// The tray app draws Tatty natively (TattyWindow.xaml, AvatarArt.cs), so the page hands
// it the chosen avatar in what he wears as a plain description: the drawing laid out in
// the window's own moving parts (the legs, the body, the eyes and pupils, the mouths,
// the project number's badge, the "!" badge, and any part of his own that moves, such as a tail), every
// colour, stroke and visibility already worked out here by the browser, which has the
// cascade. accent: the mode's colour as the tray app draws it (its TtAccent).
const BAKE_SKIP = /^(Tip|Bub\d|Back|Front)$/;
const SHAPES = new Set(["path", "circle", "ellipse", "rect", "line", "polygon"]);
const GEOMETRY = ["d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points"];
let paintBox = null;
const paintCache = new Map();
function rgba(c) {
  if (!c || c === "none") return "none";
  const url = c.match(/url\(["']?#([^"')]+)/);
  if (url) return `url(#${url[1]})`;
  if (paintCache.has(c)) return paintCache.get(c);
  if (!paintBox) { const cv = document.createElement("canvas"); cv.width = cv.height = 1; paintBox = cv.getContext("2d", { willReadFrequently: true }); }
  paintBox.clearRect(0, 0, 1, 1);
  paintBox.fillStyle = "rgba(0, 0, 0, 0)";
  paintBox.fillStyle = c;
  paintBox.fillRect(0, 0, 1, 1);
  const px = paintBox.getImageData(0, 0, 1, 1).data;
  const out = "#" + [...px].map(v => v.toString(16).padStart(2, "0")).join("");
  paintCache.set(c, out);
  return out;
}
const xmlAttr = v => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function bake(id, outfit, accent) {
  const d = avatarOf(id);
  const holder = document.createElement("div");
  holder.className = "tatty-bake";
  if (accent) holder.style.setProperty("--accent", accent);
  holder.innerHTML = svgFor(d, 1, null, "", dressClass(outfit));
  document.body.append(holder);
  const svg = holder.querySelector("svg");
  for (const n of svg.querySelectorAll(".mouth, .numtag, .badge")) n.style.display = "inline";
  const gradients = new Set();
  const out = [];
  const shown = n => getComputedStyle(n).display !== "none";
  const transformOf = (n, cs) => n.getAttribute("transform") || (cs.transform && cs.transform !== "none" ? cs.transform : "");
  const paint = (el, cs) => {
    const a = [];
    const fill = rgba(cs.fill), stroke = rgba(cs.stroke);
    for (const p of [fill, stroke]) { const m = p.match(/^url\(#(.+)\)$/); if (m) gradients.add(m[1]); }
    a.push(`fill="${fill}"`);
    if (+cs.fillOpacity !== 1) a.push(`fill-opacity="${n(+cs.fillOpacity)}"`);
    if (stroke !== "none") {
      a.push(`stroke="${stroke}"`, `stroke-width="${n(parseFloat(cs.strokeWidth) || 1)}"`);
      if (+cs.strokeOpacity !== 1) a.push(`stroke-opacity="${n(+cs.strokeOpacity)}"`);
      if (cs.strokeLinecap !== "butt") a.push(`stroke-linecap="${cs.strokeLinecap}"`);
      if (cs.strokeLinejoin !== "miter") a.push(`stroke-linejoin="${cs.strokeLinejoin}"`);
    }
    return a;
  };
  // One element and what is under it, as the tray app's description has it.
  function walk(node, depth) {
    if (!(node instanceof SVGElement) || !shown(node)) return;
    const tag = node.tagName, cs = getComputedStyle(node), p = node.dataset.p || "";
    if (BAKE_SKIP.test(p) || node.classList.contains("prop")) return;
    const common = [];
    const tf = transformOf(node, cs);
    if (tf) common.push(`transform="${xmlAttr(tf)}"`);
    if (+cs.opacity !== 1) common.push(`opacity="${n(+cs.opacity)}"`);
    if (SHAPES.has(tag)) {
      const geo = GEOMETRY.filter(k => node.hasAttribute(k)).map(k => `${k}="${xmlAttr(node.getAttribute(k))}"`);
      out.push(`<${tag} ${[...geo, ...paint(node, cs), ...common].join(" ")}/>`);
      return;
    }
    if (tag !== "g") return; // (text is the project number and the badge's "!", which the window writes itself)
    let open, close = "</g>";
    const m = [...node.classList].find(c => /^m-/.test(c));
    if (p === "Eyes") { open = `<eyes c="${node.dataset.c}"`; close = "</eyes>"; }
    else if (p === "Pupils") { open = "<pupils"; close = "</pupils>"; }
    else if (node.classList.contains("numtag")) {
      // the project number's badge: its shapes, and where and how the window writes the number
      const t = node.querySelector("text"), tcs = t ? getComputedStyle(t) : null;
      open = t ? `<numtag text="${t.getAttribute("x")},${t.getAttribute("y")}" size="${t.getAttribute("font-size")}" fill="${rgba(tcs.fill)}"` : "<numtag";
      close = "</numtag>";
    } else if (node.classList.contains("badge")) {
      const c = node.querySelector("circle");
      out.push(`<badge at="${c.getAttribute("cx")},${c.getAttribute("cy")}"/>`);
      return;
    } else if (node.classList.contains("mouth") && m) { open = `<mouth name="${m.slice(2)}"`; close = "</mouth>"; }
    else if (["Root", "LegL", "LegR", "Body"].includes(p) && depth <= 2) { open = `<part name="${p}" c="${node.dataset.c}"`; close = "</part>"; }
    else if (p) open = `<g p="${p}" c="${node.dataset.c || "0,0"}"`;
    else open = "<g";
    out.push(`${open}${common.length ? " " + common.join(" ") : ""}>`);
    for (const k of node.children) walk(k, depth + 1);
    out.push(close);
  }
  const dress = svg.querySelector(".dress");
  for (const k of dress.children) walk(k, 0);
  // the gradients the paint names, from the page's own (avatar.css colours their stops)
  const defs = [...gradients].map(gid => {
    const g = document.getElementById(gid);
    if (!g) return "";
    const attrs = ["x1", "y1", "x2", "y2"].filter(k => g.hasAttribute(k)).map(k => `${k}="${g.getAttribute(k)}"`).join(" ");
    const stops = [...g.querySelectorAll("stop")].map(s => {
      const sc = getComputedStyle(s);
      return `<stop offset="${s.getAttribute("offset")}" color="${rgba(sc.stopColor)}" opacity="${n(+sc.stopOpacity)}"/>`;
    }).join("");
    return `<${g.tagName} id="${gid}" ${attrs}>${stops}</${g.tagName}>`;
  }).join("");
  holder.remove();
  return `<tatty av="${d.id}" outfit="${xmlAttr(dressClass(outfit))}">${out.join("")}<defs>${defs}</defs></tatty>`;
}

window.TattyAvatar = {
  ids: AVATARS.map(d => d.id),
  bake,
  states: STATE_IDS,
  // the whole drawing; box is a viewBox ([x, y, w, h]), "icon" for the head, "shop" for a shelf's square
  svg(id, { scale = 1, box, outfit, cls = "" } = {}) {
    const d = avatarOf(id);
    const vb = box === "icon" ? d.iconBox : box === "shop" ? [-10, -30, 124, 134] : box;
    return svgFor(d, scale, vb, cls, dressClass(outfit));
  },
  dress(svg, outfit) {
    const g = svg && svg.querySelector(".dress");
    if (g) g.setAttribute("class", ("dress " + dressClass(outfit)).trim());
  },
  animate,
  // what an accessory does to this avatar's own bits, in a few words (the shop's labels)
  swap(id, itemId) {
    const d = avatarOf(id), it = ITEM[itemId];
    if (!it) return "";
    if (it.slot === "hat" && d.own && d.own.hat)
      return it.antenna === "hide" ? `hides his ${d.own.hat}` : typeof it.antenna === "number" ? `his ${d.own.hat} pokes out` : "";
    const part = it.hides.find(p => d.own && d.own[p]);
    return part ? (it.shows.includes(part) ? `moves his ${d.own[part]}` : `instead of his ${d.own[part]}`) : "";
  },
  ownNote: id => avatarOf(id).ownNote || "",
};

if (document.body) install(); else document.addEventListener("DOMContentLoaded", install);
})();
'''

out = HEAD + code.rstrip() + "\n" + TAIL
open(root + "/plugins/tatty/app/web/avatar.js", "w", encoding="utf-8", newline="\n").write(out)
print(f"wrote avatar.js ({len(out.splitlines())} lines)")
