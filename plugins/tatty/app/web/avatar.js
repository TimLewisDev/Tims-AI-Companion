// Tatty's avatars: the six he can be (Polished Tatty, his own, and five to unlock in the
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
// ------------------------------------------------------------------ tracks
// A track moves one number, "Part.prop", through (value, seconds) frames,
// sine-eased into each other, exactly like Avatar.cs's Add(). A state's tracks
// loop over its duration; a track may carry a duration of its own.
const T = (p, f, dur) => ({ p, f, dur });
const L = (p, a, b, ph = 0, dur) => ({ p, lin: [a, b], ph, dur });  // linear, wrapping
const W = (p, a, b, ph = 0, dur) => ({ p, tri: [a, b], ph, dur });  // a -> b -> a, sine

const ease = u => (1 - Math.cos(Math.PI * u)) / 2;
const frac = x => ((x % 1) + 1) % 1;
function frames(f, t) {
  if (f.length === 1 || t <= f[0][1]) return f[0][0];
  for (let i = 1; i < f.length; i++) {
    if (t <= f[i][1]) {
      const [v0, t0] = f[i - 1], [v1, t1] = f[i];
      return v0 + (v1 - v0) * ease(t1 > t0 ? (t - t0) / (t1 - t0) : 1);
    }
  }
  return f[f.length - 1][0];
}
function evalTrack(tr, t, dur) {
  const D = tr.dur || dur, lt = ((t % D) + D) % D;
  if (tr.lin) return tr.lin[0] + (tr.lin[1] - tr.lin[0]) * frac(lt / D + tr.ph);
  if (tr.tri) return tr.tri[0] + (tr.tri[1] - tr.tri[0]) * Math.sin(Math.PI * frac(lt / D + tr.ph));
  return frames(tr.f, lt);
}
const pingpong = (t, s) => { const u = (t % (2 * s)) / s; return u <= 1 ? u : 2 - u; };

// ------------------------------------------------------------------ states
const CONFETTI = 14;
const STATE_INFO = [
  ["idle", "Idle", "nothing running (today's default)", "Bobs, blinks, looks about now and then."],
  ["thinking", "Thinking", "session <code>turn</code> started, no tool yet", "Looks up, mouth an O, a thought bubble with dots, the antenna glows."],
  ["reading", "Reading", "<code>activity</code> tool Read / Grep / Glob / WebFetch", "Sweeps a magnifying glass across his eyes; his pupils follow it."],
  ["writing", "Writing", "<code>activity</code> tool Edit / Write", "Scribbles on a notepad by his hand, line by line, leaning into it."],
  ["running", "Running", "<code>activity</code> tool Bash", "Jogs on the spot beside a little terminal with a blinking cursor."],
  ["delegating", "Delegating", "session <code>agents</code> &gt; 0", "Two tiny helper bots hop beside him; he looks from one to the other."],
  ["needs", "Needs you", "<code>ask</code> open", "Today's ! badge and alert hop, plus wide eyes, a ? bubble and a raised hand."],
  ["oops", "Oops", "<code>activity</code> tool-done with <code>ok: false</code>", "A wobbly mouth, a sweat drop, a puff of smoke and a shake: trying his best."],
  ["celebrate", "Celebrate", "<code>milestone</code>", "Today's squash-and-jump, with confetti and a grin."],
  ["asleep", "Asleep", "ten quiet minutes (today's idle ladder)", "Sits down, eyes shut, Z's drifting off."],
];
const STATE_IDS = STATE_INFO.map(s => s[0]);
const armIdle = [T("ArmL.a", [[0, 0], [5, 1.6], [0, 3.2]], 3.2), T("ArmR.a", [[0, 0], [-5, 1.6], [0, 3.2]], 3.2)];

const STATES = {
  idle: d => ({ dur: 8, mouth: "neutral", tracks: [
    T("Pupils.x", [[0, 0], [0, 4], [-3, 4.45], [-3, 4.95], [3, 5.4], [3, 5.9], [0, 6.2]]),
    T("Body.a", [[0, 0], [0, 4], [2, 4.45], [-2, 5.4], [0, 6.2]]),
    ...armIdle] }),
  thinking: d => ({ dur: 3, mouth: "o", bob: [3, 2], tracks: [
    T("Pupils.x", [[2, 0], [2, 1.3], [-1.5, 1.7], [-1.5, 2.6], [2, 3]]),
    T("Pupils.y", [[-2.5, 0]]),
    T("Body.a", [[-3, 0], [-3, 1.3], [2, 1.7], [2, 2.6], [-3, 3]]),
    W("Tip.o", .15, .95, 0, 1.5),
    T("Bubble.y", [[0, 0], [-2, 1.5], [0, 3]]),
    ...[0, 1, 2].map(i => W(`Dot${i}.o`, .25, 1, -i * .18, 1.2)),
    T("ArmR.a", [[-100, 0], [-108, .4], [-100, .8]], .8), T("ArmL.a", [[0, 0]])] }),
  reading: d => { const dx = d.anchors.eyes.dx; return { dur: 2.4, mouth: "neutral", bob: [3, 1.8], tracks: [
    T("Mag.x", [[-dx, 0], [-dx, .25], [dx, 1.05], [dx, 1.45], [-dx, 2.25], [-dx, 2.4]]),
    T("Mag.y", [[0, 0], [-1.5, .65], [0, 1.05], [0, 1.45], [-1.5, 1.85], [0, 2.25]]),
    T("Pupils.x", [[-3, 0], [-3, .25], [3, 1.05], [3, 1.45], [-3, 2.25], [-3, 2.4]]),
    T("Body.a", [[-1.5, 0], [-1.5, .25], [1.5, 1.05], [1.5, 1.45], [-1.5, 2.25], [-1.5, 2.4]]),
    T("ArmR.a", [[-60, 0]]), T("ArmL.a", [[0, 0]])] }; },
  writing: d => ({ dur: 1.2, mouth: "neutral", bob: [2, 1.2], tracks: [
    T("Pupils.x", [[2.5, 0]]), T("Pupils.y", [[2, 0]]),
    T("Body.a", [[3, 0]]),
    T("Pencil.x", [[0, 0], [8, .35], [0, .4], [8, .75], [0, .8], [7, 1.15], [0, 1.2]]),
    T("Pencil.y", [[0, 0], [0, .35], [4, .4], [4, .75], [8, .8], [8, 1.15], [0, 1.2]]),
    T("Ln0.sx", [[0, 0], [1, .35], [1, 1.15], [0, 1.2]]),
    T("Ln1.sx", [[0, 0], [0, .4], [1, .75], [1, 1.15], [0, 1.2]]),
    T("Ln2.sx", [[0, 0], [0, .8], [1, 1.15], [0, 1.2]]),
    T("ArmR.a", [[-20, 0], [-32, .3], [-20, .6]], .6), T("ArmL.a", [[0, 0]])] }),
  running: d => ({ dur: .6, mouth: "neutral", bob: [2, .6], tracks: [
    T("LegL.y", [[0, 0], [-5, .15], [0, .3], [0, .6]]),
    T("LegR.y", [[0, 0], [0, .3], [-5, .45], [0, .6]]),
    T("Root.y", [[0, 0], [-2, .15], [0, .3], [-2, .45], [0, .6]]),
    T("Body.a", [[2, 0], [-2, .3], [2, .6]]),
    W("Tip.o", .2, 1, 0, .6),
    L("TL.sx", 0, 1, 0, 1.2),
    T("Caret.o", [[1, 0], [1, .28], [0, .3], [0, .58], [1, .6]]),
    T("ArmL.a", [[20, 0], [-20, .3], [20, .6]]), T("ArmR.a", [[20, 0], [-20, .3], [20, .6]])] }),
  delegating: d => ({ dur: 2.4, mouth: "happy", tracks: [
    T("Mini0.y", [[0, 0], [-7, .2], [0, .4], [0, 1.2], [-7, 1.4], [0, 1.6], [0, 2.4]]),
    T("Mini1.y", [[0, 0], [0, .6], [-7, .8], [0, 1], [0, 1.8], [-7, 2], [0, 2.2]]),
    T("Pupils.x", [[-3, 0], [-3, 1], [3, 1.2], [3, 2.2], [-3, 2.4]]),
    T("Body.a", [[-2, 0], [-2, 1], [2, 1.2], [2, 2.2], [-2, 2.4]]),
    W("Tip.o", .2, .8, 0, 1.2),
    T("ArmL.a", [[45, 0], [45, 1], [0, 1.2], [0, 2.2], [45, 2.4]]),
    T("ArmR.a", [[0, 0], [0, 1], [-45, 1.2], [-45, 2.2], [0, 2.4]])] }),
  needs: d => ({ dur: 2.4, mouth: "o", lids: 1.12, tracks: [
    T("Root.y", [[0, 0], [-16, .12], [0, .24], [-16, .36], [0, .5], [0, 2.4]]),
    T("Root.a", [[0, 0], [6, .12], [-6, .3], [4, .42], [0, .56], [0, 2.4]]),
    T("QB.s", [[1, 0], [1.18, .12], [1, .36], [1, 2.4]]),
    T("QB.y", [[0, 0], [-3, 1.2], [0, 2.4]]),
    W("Tip.o", .3, 1, 0, .6),
    T("ArmR.a", [[-124, 0], [-110, .25], [-136, .5], [-110, .75], [-136, 1], [-110, 1.25], [-124, 1.5], [-124, 2.4]]),
    T("ArmL.a", [[0, 0]])] }),
  oops: d => ({ dur: 2, mouth: "wobble", lids: .72, bob: [2, 1.4], tracks: [
    T("Root.x", [[0, 0], [-1.6, .05], [1.6, .1], [-1.6, .15], [1.6, .2], [0, .25], [0, 2]]),
    T("Root.a", [[-4, 0]]), T("Body.a", [[-3, 0]]),
    T("Pupils.x", [[-2.5, 0]]), T("Pupils.y", [[1, 0]]),
    T("Sweat.y", [[0, 0], [0, .2], [8, 1.6], [8, 2]]),
    T("Sweat.o", [[0, 0], [1, .25], [1, 1.3], [0, 1.6], [0, 2]]),
    T("Puff.s", [[.4, 0], [1.4, 1.1], [1.4, 2]]),
    T("Puff.o", [[0, 0], [.8, .15], [0, 1.1], [0, 2]]),
    T("Puff.y", [[0, 0], [-9, 1.1], [-9, 2]]),
    T("ArmR.a", [[-120, 0], [-132, .25], [-120, .5]], .5), T("ArmL.a", [[8, 0]])] }),
  celebrate: d => ({ dur: 2.4, mouth: "happy", tracks: [
    T("Root.sy", [[1, 0], [.84, .13], [1.08, .3], [1, .55], [1, 2.4]]),
    T("Root.sx", [[1, 0], [1.14, .13], [.94, .3], [1, .55], [1, 2.4]]),
    T("LegL.y", [[0, 0], [0, .13], [-5, .3], [0, .58]]),
    T("LegR.y", [[0, 0], [0, .13], [-5, .3], [0, .58]]),
    T("Root.y", [[0, 0], [0, .13], [-18, .36], [0, .58], [-8, .74], [0, .9], [0, 2.4]]),
    T("Root.a", [[0, 0], [0, .13], [-9, .32], [9, .56], [0, .8], [0, 2.4]]),
    W("Tip.o", .4, 1, 0, .4),
    T("ArmL.a", [[0, 0], [130, .25], [110, .5], [130, .75], [110, 1], [130, 1.25], [0, 1.8], [0, 2.4]]),
    T("ArmR.a", [[0, 0], [-130, .25], [-110, .5], [-130, .75], [-110, 1], [-130, 1.25], [0, 1.8], [0, 2.4]]),
    ...Array.from({ length: CONFETTI }, (_, i) => [
      L(`Cf${i}.y`, 0, 152, i / CONFETTI),
      W(`Cf${i}.x`, -5, 5, frac(i * .37), 1.2),
      L(`Cf${i}.a`, 0, i % 2 ? 540 : -540)]).flat()] }),
  asleep: d => ({ dur: 3, mouth: "flat", lids: .08, blink: false, bob: [2.5, 3.6], tracks: [
    T("Root.y", [[12, 0]]), T("LegL.a", [[72, 0]]), T("LegR.a", [[-72, 0]]),
    T("ArmL.a", [[10, 0]]), T("ArmR.a", [[-10, 0]]),
    ...[0, 1, 2].map(i => [
      L(`Z${i}.y`, 0, -28, i / 3), L(`Z${i}.x`, 0, 9, i / 3),
      W(`Z${i}.o`, 0, 1, i / 3), L(`Z${i}.s`, .6, 1.3, i / 3)]).flat()] }),
};
const WORKING = ["thinking", "reading", "writing", "running", "delegating"];

// ------------------------------------------------------------------ shared drawing helpers
const n = v => +(+v).toFixed(2);
const P = (c, r, w, h, cls, extra = "") => `<rect x="${c * 4}" y="${r * 4}" width="${w * 4}" height="${h * 4}" class="${cls}" ${extra}/>`;

// ------------------------------------------------------------------ the wardrobe
// Every item: [spot, id, label, rules]. The rules say what it does to an avatar's
// own bits: "hides" takes his own piece off (own-<part>), "shows" puts a "with"
// piece on (with-<part>), and a hat's "antenna" either hides the antenna or lifts
// it by that much so it pokes out of the top. Anything worn at the neck takes off
// whatever he wears there himself.
const SLOT_NAMES = { hat: "Hat", eyes: "Eyes", face: "Face", cheek: "Cheek", neck: "Neck", back: "Back" };
const TASH = { hides: ["face", "nose"], shows: ["face", "nose"] };
const ITEMS = [
  ["hat", "party", "Party hat", { antenna: "hide" }], ["hat", "beanie", "Beanie", { antenna: 14 }], ["hat", "top", "Top hat", { antenna: 26 }],
  ["hat", "phones", "Headphones", {}], ["hat", "crown", "Crown", { antenna: 12 }], ["hat", "cap", "Team cap", { antenna: "hide" }],
  ["hat", "wizard", "Wizard hat", { antenna: "hide" }], ["hat", "beret", "Beret", { antenna: "hide" }], ["hat", "cowboy", "Cowboy hat", { antenna: 24 }],
  ["hat", "chef", "Chef's hat", { antenna: "hide" }], ["hat", "flowers", "Flower crown", {}], ["hat", "bunny", "Bunny ears", {}],
  ["hat", "grad", "Mortarboard", { antenna: "hide" }], ["hat", "pirate", "Pirate hat", { antenna: "hide" }], ["hat", "hardhat", "Hard hat", { antenna: "hide" }],
  ["hat", "propeller", "Propeller cap", { antenna: "hide" }], ["hat", "halo", "Halo", {}], ["hat", "hairbow", "Hair bow", {}],
  ["hat", "viking", "Viking helmet", { antenna: "hide" }], ["hat", "santa", "Santa hat", { antenna: "hide" }],
  ["eyes", "round", "Round glasses"], ["eyes", "sun", "Sunglasses"], ["eyes", "stars", "Star glasses"], ["eyes", "hearts", "Heart glasses"],
  ["eyes", "monocle", "Monocle"], ["eyes", "aviators", "Aviators"], ["eyes", "nerd", "Taped specs"], ["eyes", "patch", "Eye patch"],
  ["eyes", "3d", "3D glasses"], ["eyes", "pixel", "Pixel shades"], ["eyes", "cateye", "Cat-eye glasses"],
  ["face", "stache", "Moustache", TASH], ["face", "pencil", "Pencil moustache", TASH], ["face", "walrus", "Walrus moustache", TASH],
  ["face", "beard", "Beard", {}], ["face", "clown", "Clown nose", { hides: ["nose"] }], ["face", "pipe", "Bubble pipe", {}],
  ["cheek", "plaster", "Plaster"], ["cheek", "star", "Star sticker"], ["cheek", "heart", "Heart sticker"], ["cheek", "freckles", "Freckles"],
  ["cheek", "paint", "Team face paint"],
  ["neck", "bow", "Bow tie"], ["neck", "scarf", "Scarf"], ["neck", "tie", "Necktie"], ["neck", "bandana", "Bandana"], ["neck", "medal", "Medal"],
  ["neck", "pearls", "Pearls"], ["neck", "lei", "Flower lei"], ["neck", "bell", "Bell collar"], ["neck", "lanyard", "Staff lanyard"],
  ["back", "cape", "Cape"], ["back", "angel", "Angel wings"], ["back", "butterfly", "Butterfly wings"], ["back", "bat", "Bat wings"],
  ["back", "dragon", "Dragon wings"], ["back", "jetpack", "Jetpack"], ["back", "balloon", "Balloon"],
].map(([slot, id, label, rules = {}]) => ({ slot, id, label, hides: rules.hides ?? (slot === "neck" ? ["neck"] : []), shows: rules.shows ?? [], antenna: rules.antenna }));

// The few accessories that move on their own, whatever he is doing.
const ACC_TRACKS = [
  T("Prop.sx", [[1, 0], [-1, .12], [1, .24]], .24),
  W("Halo.y", 0, -2.5, 0, 2.4),
  W("Tassel.a", -9, 9, 0, 2.2),
  T("Jet.sy", [[1, 0], [.7, .08], [1.15, .16], [.85, .24], [1, .32]], .32),
  W("Balloon.a", -5, 5, 0, 4),
  W("WingL.a", 0, 9, 0, 1.6), W("WingR.a", 0, -9, 0, 1.6),
  ...[0, 1, 2].map(i => [L(`Bub${i}.y`, 0, -24, i / 3, 2.4), L(`Bub${i}.x`, 0, 7, i / 3, 2.4),
                         W(`Bub${i}.o`, 0, .95, i / 3, 2.4), L(`Bub${i}.s`, .6, 1.3, i / 3, 2.4)]).flat(),
];

const star = (cx, cy, R, r = R * .45) => "M" + Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R;
  return `${n(cx + rr * Math.cos(a))},${n(cy + rr * Math.sin(a))}`;
}).join(" L") + " Z";
const heart = (cx, cy, w) => `M${n(cx)},${n(cy + w * .8)} C${n(cx - w * 1.25)},${n(cy - w * .05)} ${n(cx - w * .6)},${n(cy - w * 1.05)} ${n(cx)},${n(cy - w * .35)} C${n(cx + w * .6)},${n(cy - w * 1.05)} ${n(cx + w * 1.25)},${n(cy - w * .05)} ${n(cx)},${n(cy + w * .8)} Z`;
const flower = (cx, cy, r, col) => Array.from({ length: 5 }, (_, k) => {
  const a = k * 2 * Math.PI / 5 - Math.PI / 2;
  return `<circle cx="${n(cx + r * .8 * Math.cos(a))}" cy="${n(cy + r * .8 * Math.sin(a))}" r="${n(r * .6)}" fill="${col}"/>`;
}).join("") + `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * .45)}" fill="#F6D04D"/>`;
const acc = (id, body) => `<g class="acc a-${id}">${body}</g>`;
const mirrorX = inner => `<g transform="scale(-1 1)">${inner}</g>`;

// Everything worn on the front, in the order it layers: neck, face, cheek, eyes, hat.
function accessories(d) {
  const a = d.anchors, h = a.hat, e = a.eyes, m = a.mouth, k = a.neck;
  const s = h.w / 68, ear = h.ear ?? h.w / 2 + 3, ey = e.y;
  const lr = Math.min(e.r + 2.5, e.dx - 1.5), L2 = Math.min(e.r + 3, e.dx - 1);
  const lx = e.x - e.dx, rx = e.x + e.dx;
  const nose = a.nose ?? { x: m.x, y: m.y - 6 };
  const ck = a.cheek ?? { x: 76, y: 62 }, ckL = { x: 2 * e.x - ck.x, y: ck.y };
  const ht = `translate(${h.x} ${h.y}) scale(${n(s)})`;
  const nt = `translate(${k.x} ${k.y}) scale(${k.w || 1})`;
  const ft = `translate(${m.x} ${m.y - 1.5}) scale(${m.w || 1})`;
  const hat = (id, inner, extra = "") => acc(id, `<g transform="${ht}${extra}">${inner}</g>`);
  const neck = (id, inner) => acc(id, `<g transform="${nt}">${inner}</g>`);
  const face = (id, inner) => acc(id, `<g transform="${ft}">${inner}</g>`);
  const pair = f => f(lx) + f(rx);
  const bridge = (col, w = 2) => `<path d="M${n(lx + lr)},${ey - 1} Q${e.x},${ey - 4} ${n(rx - lr)},${ey - 1}" fill="none" stroke="${col}" stroke-width="${w}"/>`;
  const cup = x => `<rect x="${n(x - 5)}" y="${h.earY - 9}" width="10" height="18" rx="4" fill="#2B2B30"/><rect x="${n(x - 2.5)}" y="${h.earY - 6}" width="5" height="12" rx="2" class="fa"/>`;
  const horn = `<path d="M-23,-6 C-36,-10 -41,-24 -35,-33 C-33,-24 -28,-17 -18,-13 Z" fill="#F1E6C8" stroke="#CDBF99" stroke-width="1"/>`;
  const bunnyEar = (x, rot) => `<g transform="rotate(${rot} ${x} -6)"><ellipse cx="${x}" cy="-22" rx="6.5" ry="16" fill="#fff" stroke="#DCD6E2" stroke-width="1.2"/><ellipse cx="${x}" cy="-21" rx="3.2" ry="11" fill="#F7B6C8"/></g>`;
  const cateye = x => `<path d="M${n(x + L2)},${n(ey - L2 * .4)} Q${x},${n(ey - L2 * .9)} ${n(x - L2 - 3)},${n(ey - L2 * .95)} Q${n(x - L2 * .8)},${n(ey + L2 * .8)} ${x},${n(ey + L2 * .75)} Q${n(x + L2)},${n(ey + L2 * .6)} ${n(x + L2)},${n(ey - L2 * .4)} Z" fill="#fff" fill-opacity=".12" stroke="#8E3B6A" stroke-width="2.2" stroke-linejoin="round"/>`;
  const u = L2 / 3;
  const pixelLens = x => `<rect x="${n(x - L2)}" y="${n(ey - L2 * .5 + u)}" width="${n(2 * L2)}" height="${n(u)}" fill="#111"/>
      <rect x="${n(x - L2 + u)}" y="${n(ey - L2 * .5 + 2 * u)}" width="${n(2 * L2 - 2 * u)}" height="${n(u)}" fill="#111"/>
      <rect x="${n(x - L2 + u)}" y="${n(ey - L2 * .5 + u)}" width="${n(u)}" height="${n(u * .9)}" fill="#fff"/>`;
  const sticker = c => `<g transform="translate(${c.x} ${c.y}) rotate(-28)"><rect x="-6.5" y="-2.6" width="13" height="5.2" rx="2.6" fill="#F2D0A4" stroke="#D9B07E" stroke-width=".7"/>
      <rect x="-2" y="-2.6" width="4" height="5.2" fill="#E8BD8A"/><circle cx="-4.4" cy="-.9" r=".4" fill="#C99C6A"/><circle cx="4.4" cy=".9" r=".4" fill="#C99C6A"/></g>`;
  const freckles = c => [[-3, -1], [0, 1.2], [3, -1.2], [1.5, -2.6]].map(([dx, dy]) => `<circle cx="${n(c.x + dx)}" cy="${n(c.y + dy)}" r=".95" fill="#A8674A" fill-opacity=".8"/>`).join("");
  const paint = c => `<path d="M${c.x - 4},${c.y - 2} h8 M${c.x - 4},${c.y + 1.6} h8" stroke="#fff" class="rc" stroke-width="3.4"/><path d="M${c.x - 4},${c.y - 2} h8 M${c.x - 4},${c.y + 1.6} h8" class="sa rc" stroke-width="1.9"/>`;
  const arc = (count, half, dip, f) => Array.from({ length: count }, (_, i) => {
    const x = -half + i * (2 * half / (count - 1));
    return f(n(x), n(-2 + dip * (1 - (x / half) ** 2)), i);
  }).join("");
  return [
    // ---- neck
    neck("bow", `<path d="M0,0 L-11,-7 Q-13.5,0 -11,7 Z M0,0 L11,-7 Q13.5,0 11,7 Z" fill="#D6455D"/><rect x="-3.2" y="-3.6" width="6.4" height="7.2" rx="2" fill="#B23148"/>`),
    neck("scarf", `<path d="M-22,-4 Q0,4 22,-4 L22,3 Q0,11 -22,3 Z" fill="#D6455D"/>
      <path d="M-15,-1.5 v6 M-5,.5 v6.5 M5,.5 v6.5 M15,-1.5 v6" stroke="#fff" stroke-width="1.6" stroke-opacity=".85"/>
      <path d="M9,5 L15,22 L7,23.5 L3,6 Z" fill="#C23A51"/><path d="M8,23.4 v2.5 M10.5,23 v2.5 M13,22.6 v2.5" stroke="#C23A51" stroke-width="1"/>`),
    neck("tie", `<path d="M-3.2,-3 L3.2,-3 L2.2,2 L-2.2,2 Z" fill="#245C91"/><path d="M-2.2,2 L2.2,2 L5,18 L0,23 L-5,18 Z" fill="#2E86AB"/>
      <path d="M-3.5,8 L3.6,5 M-4.4,13 L4.4,9.5 M-4.6,18 L4.8,14.2" stroke="#F2C94C" stroke-width="1.2"/>`),
    neck("bandana", `<path d="M-17,-3 L17,-3 L0,14 Z" fill="#2E86AB"/>
      ${[[-9, 0], [-1, 1], [7, 0], [-4, 5], [4, 5], [0, 9]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#fff"/>`).join("")}`),
    neck("medal", `<path d="M-9,-4 L-2,9 L2,9 L-5,-4 Z" fill="#2E86AB"/><path d="M9,-4 L2,9 L-2,9 L5,-4 Z" fill="#D6455D"/>
      <circle cx="0" cy="14" r="6.2" fill="#F2C94C" stroke="#C9A227" stroke-width="1.2"/><path d="${star(0, 14, 3.6, 1.6)}" fill="#E0A800"/>`),
    neck("pearls", arc(9, 16, 7, (x, y) => `<circle cx="${x}" cy="${y}" r="2" fill="#FBF7EF" stroke="#CFC6B4" stroke-width=".7"/>`)),
    neck("lei", arc(7, 18, 8, (x, y, i) => flower(+x, +y, 3.4, ["#EF6F8E", "#F6E27A", "#B49AE6"][i % 3]))),
    neck("bell", `<path d="M-20,-3 Q0,4 20,-3 L20,1 Q0,8 -20,1 Z" fill="#D6455D"/><circle cx="0" cy="8.5" r="4.2" fill="#F2C94C" stroke="#C9A227" stroke-width="1"/>
      <path d="M-2.6,9.5 h5.2 M0,9.5 v2.6" stroke="#9A7A1F" stroke-width=".9"/>`),
    neck("lanyard", `<path d="M-11,-4 L-3,11 M11,-4 L3,11" class="sa" stroke-width="1.6"/><rect x="-7" y="10" width="14" height="11" rx="1.5" fill="#fff" stroke="#C9C3B6" stroke-width=".8"/>
      <rect x="-5" y="12" width="4.5" height="5" class="fl"/><path d="M1,13 h4 M1,15.5 h3.5 M-5,19 h10" class="sa" stroke-width=".9"/>`),
    // ---- face
    face("stache", `<path d="M0,-1 C-3,-5 -9,-5 -12,-1.5 C-14,1 -17,1.5 -19.5,-1 C-17.5,5 -8,6.5 0,2.5 C8,6.5 17.5,5 19.5,-1 C17,1.5 14,1 12,-1.5 C9,-5 3,-5 0,-1 Z" fill="#5A3E2B"/>`),
    face("pencil", `<path d="M-12,0 Q-6,-3.6 0,-1.8 Q6,-3.6 12,0 Q6,1.6 0,.4 Q-6,1.6 -12,0 Z" fill="#3A2A20"/>`),
    face("walrus", `<path d="M0,-3 C-8,-6 -16,-4 -17,4 C-14,1 -10,8 -6,4 C-4,8 -1,6 0,3 C1,6 4,8 6,4 C10,8 14,1 17,4 C16,-4 8,-6 0,-3 Z" fill="#8A6A4A"/>`),
    face("beard", `<path d="M-13,7 C-13,17 -6,22 0,22 C6,22 13,17 13,7 C9,10.5 4,11.5 0,11.5 C-4,11.5 -9,10.5 -13,7 Z" fill="#8A6A4A"/>
      <path d="M-5,15.5 q2,2.6 4,0 M1.5,18 q2,2.6 4,0" stroke="#6E523A" stroke-width="1" fill="none"/>`),
    acc("clown", `<circle cx="${nose.x}" cy="${nose.y}" r="4.6" fill="#E04848"/><circle cx="${nose.x - 1.5}" cy="${nose.y - 1.6}" r="1.4" fill="#fff" fill-opacity=".7"/>`),
    acc("pipe", `<path d="M${m.x + 3},${m.y + 3} Q${m.x + 9},${m.y + 7} ${m.x + 14},${m.y + 6}" fill="none" stroke="#8A5A3A" stroke-width="2.2" class="rc"/>
      <rect x="${m.x + 13}" y="${m.y - 1}" width="7" height="8" rx="2.5" fill="#8A5A3A"/><rect x="${m.x + 12.5}" y="${m.y - 1.5}" width="8" height="2" rx="1" fill="#6E4428"/>
      ${[0, 1, 2].map(i => `<circle data-p="Bub${i}" data-c="${m.x + 16.5},${m.y - 4}" cx="${m.x + 16.5}" cy="${m.y - 4}" r="${2.6 - i * .4}" fill="#fff" fill-opacity=".35" stroke="#7CC6EA" stroke-width=".9" opacity="0"/>`).join("")}`),
    // ---- cheek (the viewer's right cheek; freckles and paint go on both)
    acc("plaster", sticker(ck)),
    acc("star", `<path d="${star(ck.x, ck.y, 5, 2.4)}" fill="#F2C94C" stroke="#E0A800" stroke-width=".8" stroke-linejoin="round"/>`),
    acc("heart", `<path d="${heart(ck.x, ck.y, 4)}" fill="#EF6F8E" stroke="#D6455D" stroke-width=".6"/>`),
    acc("freckles", freckles(ck) + freckles(ckL)),
    acc("paint", paint(ck) + paint(ckL)),
    // ---- eyes
    acc("round", `<g fill="none" stroke="#6B4F2A">${pair(x => `<circle cx="${x}" cy="${ey}" r="${n(lr)}" fill="#fff" fill-opacity=".15" stroke-width="2.2"/>`)}
      <path d="M${n(lx + lr)},${ey - 1} Q${e.x},${ey - 4} ${n(rx - lr)},${ey - 1}" stroke-width="2"/>
      <path d="M${n(lx - lr)},${ey - 1} l-5,-2 M${n(rx + lr)},${ey - 1} l5,-2" stroke-width="2" class="rc"/></g>`),
    acc("sun", `<path d="M${n(lx - L2 - 2)},${n(ey - L2 * .75)} H${n(rx + L2 + 2)}" stroke="#1F2328" stroke-width="2.4" class="rc"/>
      ${pair(x => `<rect x="${n(x - L2)}" y="${n(ey - L2 * .75)}" width="${n(2 * L2)}" height="${n(L2 * 1.5)}" rx="${n(L2 * .5)}" fill="#1F2328"/>
      <path d="M${n(x - L2 * .55)},${n(ey - L2 * .3)} l${n(L2 * .45)},0" stroke="#fff" stroke-opacity=".55" stroke-width="1.5" class="rc"/>`)}`),
    acc("stars", pair(x => `<path d="${star(x, ey, lr + 1.5, (lr + 1.5) * .58)}" fill="#F2C94C" fill-opacity=".35" stroke="#E0A800" stroke-width="2" stroke-linejoin="round"/>`) + bridge("#E0A800")),
    acc("hearts", pair(x => `<path d="${heart(x, ey + 1, lr * .95)}" fill="#EF6F8E" fill-opacity=".4" stroke="#D6455D" stroke-width="2" stroke-linejoin="round"/>`) + bridge("#D6455D")),
    acc("monocle", `<circle cx="${rx}" cy="${ey}" r="${n(lr)}" fill="#fff" fill-opacity=".15" stroke="#C9A227" stroke-width="2"/>
      <path d="M${rx},${n(ey + lr)} q-2,8 3,14 q4,4 10,2" fill="none" stroke="#C9A227" stroke-width="1.1"/>`),
    acc("aviators", `<path d="M${n(lx - L2)},${n(ey - L2 * .6)} H${n(rx + L2)}" stroke="#C9A227" stroke-width="1.4"/>
      ${pair(x => `<path d="M${n(x - L2)},${n(ey - L2 * .55)} Q${x},${n(ey - L2 * .8)} ${n(x + L2)},${n(ey - L2 * .55)} Q${n(x + L2 * 1.1)},${n(ey + L2 * .8)} ${x},${n(ey + L2 * .85)} Q${n(x - L2 * 1.1)},${n(ey + L2 * .8)} ${n(x - L2)},${n(ey - L2 * .55)} Z" fill="#3A5A6E" fill-opacity=".85" stroke="#C9A227" stroke-width="1.4"/>
      <path d="M${n(x - L2 * .5)},${n(ey - L2 * .2)} q${n(L2 * .3)},${n(-L2 * .2)} ${n(L2 * .6)},0" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.3" class="rc"/>`)}`),
    acc("nerd", `${pair(x => `<rect x="${n(x - L2)}" y="${n(ey - L2 * .8)}" width="${n(2 * L2)}" height="${n(L2 * 1.6)}" rx="${n(L2 * .3)}" fill="#fff" fill-opacity=".1" stroke="#1F2328" stroke-width="3"/>`)}
      <path d="M${n(lx + L2)},${ey - 1} H${n(rx - L2)}" stroke="#1F2328" stroke-width="3"/>
      <rect x="${e.x - 3}" y="${ey - 3.5}" width="6" height="5" rx="1" fill="#fff" stroke="#D8D2C6" stroke-width=".6"/>`),
    acc("patch", `<path d="M${n(lx - L2)},${n(ey - L2 * .4)} L${n(lx - L2 - 7)},${n(ey - L2 * .9)} M${n(lx + L2 * .6)},${n(ey - L2 * .6)} L${n(rx + L2 + 6)},${n(ey - L2 - 7)}" stroke="#1F2328" stroke-width="1.6"/>
      <ellipse cx="${lx}" cy="${ey}" rx="${n(L2 * .95)}" ry="${n(L2 * .8)}" fill="#1F2328"/>`),
    acc("3d", `<rect x="${n(lx - L2)}" y="${n(ey - L2 * .7)}" width="${n(2 * L2)}" height="${n(L2 * 1.4)}" rx="2" fill="#E04848" fill-opacity=".75"/>
      <rect x="${n(rx - L2)}" y="${n(ey - L2 * .7)}" width="${n(2 * L2)}" height="${n(L2 * 1.4)}" rx="2" fill="#3FA7E0" fill-opacity=".75"/>
      <rect x="${n(lx - L2 - 2)}" y="${n(ey - L2 * .7 - 2)}" width="${n(rx - lx + 2 * L2 + 4)}" height="${n(L2 * 1.4 + 4)}" rx="3" fill="none" stroke="#fff" stroke-width="2.6"/>
      <rect x="${n(lx - L2 - 3.3)}" y="${n(ey - L2 * .7 - 3.3)}" width="${n(rx - lx + 2 * L2 + 6.6)}" height="${n(L2 * 1.4 + 6.6)}" rx="4" fill="none" stroke="#C9C3B6" stroke-width=".8"/>`),
    acc("pixel", `<g shape-rendering="crispEdges"><rect x="${n(lx - L2 - u)}" y="${n(ey - L2 * .5)}" width="${n(rx - lx + 2 * L2 + 2 * u)}" height="${n(u)}" fill="#111"/>${pair(pixelLens)}</g>`),
    acc("cateye", `${cateye(lx)}<g transform="translate(${2 * rx} 0) scale(-1 1)">${cateye(rx)}</g>${bridge("#8E3B6A")}`),
    // ---- hat
    hat("party", `<path d="M-15,1 L0,-30 L15,1 Z" fill="#F2C94C" stroke="#D9A82E" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M-10,-7 L9,-3 M-5.5,-18 L4.5,-16" class="sa rc" stroke-width="3"/><circle cx="0" cy="-31" r="4.5" fill="#EF6F8E"/>`, " rotate(-12)"),
    hat("beanie", `<path d="M-29,0 C-29,-26 29,-26 29,0 Z" fill="#E4572E"/><rect x="-31" y="-5" width="62" height="10" rx="4" fill="#C2410C"/>
      <path d="M-24,-4 v8 M-16,-4 v8 M-8,-4 v8 M0,-4 v8 M8,-4 v8 M16,-4 v8 M24,-4 v8" stroke="#A3360A" stroke-width="1.4"/>`),
    hat("top", `<rect x="-16" y="-27" width="32" height="27" rx="2.5" fill="#2B2B30"/><rect x="-16" y="-9" width="32" height="5" class="fa"/>
      <ellipse cx="0" cy="0" rx="27" ry="4.5" fill="#2B2B30"/><path d="M-11,-24 v12" stroke="#fff" stroke-opacity=".18" stroke-width="3" class="rc"/>`),
    acc("phones", `<path d="M${n(h.x - ear)},${h.earY} C${n(h.x - ear)},${h.y - 16} ${n(h.x + ear)},${h.y - 16} ${n(h.x + ear)},${h.earY}" fill="none" stroke="#2B2B30" stroke-width="4"/>${cup(h.x - ear)}${cup(h.x + ear)}`),
    hat("crown", `<path d="M-18,0 L-18,-13 L-9,-6 L0,-17 L9,-6 L18,-13 L18,0 Z" fill="#F2C94C" stroke="#C9A227" stroke-width="1.5" stroke-linejoin="round"/>
      ${[[-18, -14, 2], [0, -18, 2.2], [18, -14, 2]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#F2C94C" stroke="#C9A227"/>`).join("")}
      <rect x="-18" y="-4" width="36" height="4" fill="#E0B13A"/>
      <circle cx="0" cy="-7" r="2.4" fill="#D6455D"/><circle cx="-10" cy="-2" r="1.5" fill="#5CC8A8"/><circle cx="10" cy="-2" r="1.5" fill="#7AA7DA"/>`),
    hat("cap", `<path d="M-28,1 C-28,-23 28,-23 28,1 Z" class="fa" stroke="#fff" stroke-width="1.4" stroke-opacity=".8"/>
      <path d="M0,-17 C-5,-11 -7,-5 -7,1 M0,-17 C5,-11 7,-5 7,1" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="1.2"/>
      <circle cx="0" cy="-17.5" r="2" class="fdk"/><path d="M2,-1 C14,-5 32,-4 42,2 C30,5 12,5 2,2 Z" class="fdk"/>`),
    hat("wizard", `<path d="M-16,0 Q-8,-18 4,-38 Q8,-40 7,-35 Q4,-22 16,0 Z" fill="#6E4BC2"/><path d="M-27,1 Q0,-7 27,1 Q0,8 -27,1 Z" fill="#5B3FA0"/>
      <path d="${star(-3, -12, 3.5)}" fill="#F2C94C"/><path d="${star(6, -23, 2.6)}" fill="#F2C94C"/><circle cx="-8" cy="-4" r="1.2" fill="#F2C94C"/>`, " rotate(-6)"),
    hat("beret", `<path d="M-27,-1 C-31,-13 -8,-21 13,-17 C30,-14 33,-5 25,0 C10,4 -16,4 -27,-1 Z" fill="#B83A3A"/>
      <path d="M-24,-1 C-10,2 12,2 24,-1" fill="none" stroke="#8E2A2A" stroke-width="2"/><path d="M3,-18 l1.5,-4" stroke="#8E2A2A" stroke-width="2" class="rc"/>`, " rotate(-8)"),
    hat("cowboy", `<path d="M-16,-1 C-18,-14 -14,-26 -8,-24 Q0,-20 8,-24 C14,-26 18,-14 16,-1 Z" fill="#B47A45"/>
      <rect x="-16.5" y="-7" width="33" height="3.5" fill="#6B3F1E"/><path d="M-38,-7 Q-30,4 0,4 Q30,4 38,-7 Q30,-1 0,-1 Q-30,-1 -38,-7 Z" fill="#A0693A"/>`),
    hat("chef", `${[[-10, -15, 9], [10, -15, 9], [0, -21, 10.5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#D8D2C6" stroke-width="1.2"/>`).join("")}
      <rect x="-16" y="-9" width="32" height="10" rx="2" fill="#fff" stroke="#D8D2C6" stroke-width="1.2"/><path d="M-8,-8 v8 M0,-8 v8 M8,-8 v8" stroke="#E6E1D6" stroke-width="1"/>`),
    hat("flowers", `<path d="M-31,1 Q0,-9 31,1" fill="none" stroke="#5C9E52" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M-19,-3 q2,-5 6,-4 q-1,4 -6,4 Z M7,-5 q2,-5 6,-4 q-1,4 -6,4 Z" fill="#6DB35F"/>
      ${[[-26, -1, "#EF6F8E"], [-13, -4.5, "#F6E27A"], [0, -5.8, "#B49AE6"], [13, -4.5, "#F6E27A"], [26, -1, "#EF6F8E"]].map(([x, y, c]) => flower(x, y, 4.6, c)).join("")}`),
    hat("bunny", `${bunnyEar(-11, -14)}${bunnyEar(11, 16)}<path d="M-30,4 Q0,-12 30,4" fill="none" stroke="#F2A7B8" stroke-width="3" stroke-linecap="round"/>`),
    hat("grad", `<path d="M-15,-8 L-15,0 Q0,5 15,0 L15,-8 Z" fill="#1F1F24"/><path d="M-30,-12 L0,-21 L30,-12 L0,-3 Z" fill="#2B2B30"/>
      <g data-p="Tassel" data-c="21,-10"><path d="M0,-12 L21,-10 L21,3" fill="none" stroke="#F2C94C" stroke-width="1.5"/><rect x="19.3" y="2" width="3.4" height="7" rx="1" fill="#F2C94C"/></g>
      <circle cx="0" cy="-12" r="1.8" fill="#F2C94C"/>`),
    hat("pirate", `<path d="M-34,-3 Q-24,-30 0,-22 Q24,-30 34,-3 Q0,7 -34,-3 Z" fill="#2B2B30"/><path d="M-34,-3 Q0,7 34,-3" fill="none" stroke="#F2C94C" stroke-width="1.6"/>
      <circle cx="0" cy="-12" r="4.2" fill="#fff"/><circle cx="-1.5" cy="-12.5" r="1" fill="#2B2B30"/><circle cx="1.5" cy="-12.5" r="1" fill="#2B2B30"/>
      <path d="M-6,-5 L6,-1 M6,-5 L-6,-1" stroke="#fff" stroke-width="1.6" class="rc"/>`),
    hat("hardhat", `<path d="M-26,0 C-26,-26 26,-26 26,0 Z" fill="#F2C94C"/><path d="M-3.5,-19.5 C-3.5,-20.5 3.5,-20.5 3.5,-19.5 L3.5,0 L-3.5,0 Z" fill="#E0B13A"/>
      <rect x="-32" y="-1" width="64" height="5" rx="2.5" fill="#E0B13A"/><path d="M-18,-12 q4,-6 10,-8" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2" class="rc"/>`),
    hat("propeller", `<path d="M-28,1 C-28,-23 28,-23 28,1 Z" fill="#E4572E"/>
      <path d="M0,-17.5 C-8,-12 -12,-6 -13,1 L-5,1 C-4,-6 -2,-12 0,-17.5 Z M0,-17.5 C8,-12 12,-6 13,1 L5,1 C4,-6 2,-12 0,-17.5 Z" fill="#F2C94C"/>
      <rect x="-30" y="-3" width="60" height="5" rx="2.5" fill="#2E86AB"/><line x1="0" y1="-17" x2="0" y2="-24" stroke="#555" stroke-width="1.6"/>
      <g data-p="Prop" data-c="0,-24"><path d="M0,-24 C-6,-27 -16,-27 -18,-24 C-16,-22 -6,-22 0,-24 Z M0,-24 C6,-21 16,-21 18,-24 C16,-27 6,-27 0,-24 Z" fill="#2E86AB"/></g>
      <circle cx="0" cy="-24" r="1.6" fill="#D6455D"/>`),
    hat("halo", `<g data-p="Halo"><ellipse cx="0" cy="-26" rx="17" ry="4.2" fill="none" stroke="#F6D04D" stroke-width="3"/><ellipse cx="0" cy="-26" rx="17" ry="4.2" fill="none" stroke="#FFF6C8" stroke-width="1"/></g>`),
    hat("hairbow", `<g transform="translate(17 -1) rotate(18)"><path d="M-2,2 L-6,10 L-2,9 Z M2,2 L6,10 L2,9 Z" fill="#D6455D"/>
      <path d="M0,0 C-6,-9 -15,-9 -15,-1 C-15,6 -6,6 0,0 Z M0,0 C6,-9 15,-9 15,-1 C15,6 6,6 0,0 Z" fill="#EF6F8E" stroke="#D6455D" stroke-width="1"/><circle cx="0" cy="0" r="3" fill="#D6455D"/></g>`),
    hat("viking", `${horn}${mirrorX(horn)}<path d="M-27,1 C-27,-24 27,-24 27,1 Z" fill="#9AA3AD"/><rect x="-28" y="-5" width="56" height="6" rx="2" fill="#7D858F"/>
      <path d="M-3,-20 L3,-20 L3,-5 L-3,-5 Z" fill="#7D858F"/>${[-18, -6, 6, 18].map(x => `<circle cx="${x}" cy="-2" r="1.2" fill="#CDD3D9"/>`).join("")}`),
    hat("santa", `<path d="M-26,0 Q-20,-28 6,-29 Q24,-29 32,-12 Q22,-19 15,-17 Q21,-8 26,0 Z" fill="#D6455D"/>
      <rect x="-30" y="-6" width="60" height="9" rx="4.5" fill="#fff"/><circle cx="32.5" cy="-11" r="4.5" fill="#fff"/>`),
  ].join("\n");
}

// What is worn on the back sits behind everything, legs included, but rides with
// the body: it is drawn in a second group that takes Body's own transform.
function backAccessories(d) {
  const b = d.anchors.back ?? { x: 52, y: 60, s: 1 }, gy = d.anchors.ground - 3;
  const bt = `translate(${b.x} ${b.y}) scale(${b.s})`;
  const back = (id, inner) => acc(id, `<g transform="${bt}">${inner}</g>`);
  const wings = (id, left) => back(id, `<g data-p="WingL" data-c="-22,2">${left}</g><g data-p="WingR" data-c="22,2">${mirrorX(left)}</g>`);
  const capeBottom = gy - b.y;
  const tank = x => `<rect x="${x - 6}" y="-12" width="12" height="28" rx="5" fill="#B8C0C8" stroke="#7D858F" stroke-width="1.2"/>
    <rect x="${x - 6}" y="-4" width="12" height="3" fill="#D6455D"/><path d="M${x - 3},16 h6 l-1,4 h-4 Z" fill="#6B737D"/>
    <g data-p="Jet" data-c="${x},20"><path d="M${x - 3},20 C${x - 3},26 ${x - 1},30 ${x},34 C${x + 1},30 ${x + 3},26 ${x + 3},20 Z" fill="url(#gFlame)"/></g>`;
  const batWing = cls => `<path d="M-20,-2 L-50,-12 C-49,-4 -47,2 -43,5 C-41,1 -37,1 -35,7 C-33,3 -29,3 -27,9 C-25,5 -21,5 -19,7 Z" ${cls}/>`;
  return [
    acc("cape", `<path d="M${b.x - 22 * b.s},${b.y} Q${b.x},${b.y + 7} ${b.x + 22 * b.s},${b.y} L${b.x + 34 * b.s},${gy} Q${b.x},${gy + 6} ${b.x - 34 * b.s},${gy} Z" fill="#C23A51"/>
      <path d="M${b.x - 22 * b.s},${b.y} L${b.x - 34 * b.s},${gy} Q${b.x - 31 * b.s},${gy + 1} ${b.x - 28 * b.s},${gy + 2} L${b.x - 17 * b.s},${b.y + 2} Z" fill="#A82F45"/>`),
    wings("angel", `<path d="M-22,4 C-34,-12 -50,-10 -56,2 C-51,3 -49,7 -51,11 C-45,11 -43,15 -45,20 C-37,20 -31,15 -24,12 Z" fill="#fff" stroke="#D8D2C6" stroke-width="1.2"/>
      <path d="M-30,2 C-38,-2 -44,0 -48,4 M-32,8 C-38,6 -42,8 -44,12" fill="none" stroke="#E2DDD3" stroke-width="1"/>`),
    wings("butterfly", `<path d="M-18,0 C-36,-28 -56,-18 -50,2 C-46,9 -30,8 -18,4 Z" fill="#B49AE6" stroke="#8E73C9" stroke-width="1"/>
      <path d="M-18,4 C-36,10 -44,26 -31,28 C-23,28 -19,17 -18,8 Z" fill="#F2A7B8" stroke="#D98AA0" stroke-width="1"/>
      <circle cx="-40" cy="-6" r="3" fill="#fff" fill-opacity=".6"/><circle cx="-30" cy="18" r="2.2" fill="#fff" fill-opacity=".6"/>`),
    wings("bat", batWing('fill="#3A3A44"')),
    wings("dragon", `<g transform="scale(1.12)">${batWing('class="fdk"')}<path d="M-20,-2 L-43,5 M-20,-2 L-35,7 M-20,-2 L-27,9" fill="none" class="sd" stroke-width=".9" stroke-opacity=".0"/>
      <path d="M-22,0 L-42,4 M-22,0 L-34,6" fill="none" stroke="var(--accent-light)" stroke-width="1"/></g>`),
    back("jetpack", tank(-40) + tank(40)),
    back("balloon", `<g data-p="Balloon" data-c="24,4"><path d="M24,4 C30,-14 26,-30 34,-40" fill="none" stroke="#8A8F96" stroke-width=".9"/>
      <ellipse cx="34" cy="-50" rx="9" ry="11" fill="#EF6F8E"/><path d="M32.5,-39.2 l1.5,-1.3 l1.5,1.3 Z" fill="#D6455D"/>
      <ellipse cx="30.5" cy="-54" rx="2.2" ry="3.4" fill="#fff" fill-opacity=".5"/></g>`),
  ].join("\n");
}

function mini(x, y, name) {
  return `<g data-p="${name}" data-c="${x},${y}"><g transform="translate(${x} ${y})">
    <line x1="-3" y1="4" x2="-3" y2="8" class="sa rc" stroke-width="1.6"/><line x1="3" y1="4" x2="3" y2="8" class="sa rc" stroke-width="1.6"/>
    <line x1="0" y1="-6" x2="0" y2="-9.5" class="sa" stroke-width="1.4"/><circle cx="0" cy="-10.5" r="1.7" class="fa"/>
    <rect x="-7" y="-6" width="14" height="11" rx="3" class="ff sa" stroke-width="1.6"/>
    <circle cx="-2.6" cy="-1" r="1.4" class="fk"/><circle cx="2.6" cy="-1" r="1.4" class="fk"/></g></g>`;
}

// The props each state brings, placed by the direction's anchors.
function props(d) {
  const a = d.anchors, b = a.bubble, e = a.eyes, h = a.hand, sd = a.side, tp = a.top;
  const R = e.r + 3, qx = b.x - 1, qy = b.y - 16, gy = a.ground;
  const back = `<g class="prop p-delegating">${mini(10, gy - 8, "Mini0")}${mini(94, gy - 8, "Mini1")}</g>`;
  const body = `
  <g class="prop p-thinking"><g data-p="Bubble" data-c="${b.x},${b.y}">
    <circle cx="${b.x - 13}" cy="${b.y + 15}" r="1.8" class="tb"/><circle cx="${b.x - 9}" cy="${b.y + 10}" r="2.8" class="tb"/>
    <ellipse cx="${b.x}" cy="${b.y}" rx="13" ry="9" class="tb"/>
    ${[0, 1, 2].map(i => `<circle data-p="Dot${i}" cx="${b.x - 5.5 + i * 5.5}" cy="${b.y}" r="1.7" class="fk"/>`).join("")}</g></g>
  <g class="prop p-reading"><g data-p="Mag" data-c="${e.x},${e.y}">
    <line x1="${n(e.x + R * .7)}" y1="${n(e.y + R * .7)}" x2="${n(e.x + R * .7 + 9)}" y2="${n(e.y + R * .7 + 9)}" stroke="#6B5B45" stroke-width="3.5" class="rc"/>
    <circle cx="${e.x}" cy="${e.y}" r="${R}" fill="#fff" fill-opacity=".28" stroke="#6B5B45" stroke-width="2.5"/>
    <path d="M${n(e.x - R * .6)},${n(e.y - R * .15)} A${n(R * .62)},${n(R * .62)} 0 0 1 ${n(e.x - R * .1)},${n(e.y - R * .62)}" stroke="#fff" stroke-width="1.6" fill="none" class="rc"/></g></g>
  <g class="prop p-running"><g data-p="Term" data-c="${b.x},${b.y}">
    <rect x="${b.x - 15}" y="${b.y - 10}" width="30" height="19" rx="3.5" fill="#1B2230" stroke="#0E131B" stroke-width="1"/>
    <circle cx="${b.x - 11.5}" cy="${b.y - 7}" r=".9" fill="#EF6F6F"/><circle cx="${b.x - 9}" cy="${b.y - 7}" r=".9" fill="#F2C94C"/><circle cx="${b.x - 6.5}" cy="${b.y - 7}" r=".9" fill="#6CC070"/>
    <path d="M${b.x - 11},${b.y - 3} l3,2.2 l-3,2.2" class="fn sg rc" stroke-width="1.4"/>
    <rect data-p="TL" data-c="${b.x - 6},${b.y}" x="${b.x - 6}" y="${b.y - 1.5}" width="16" height="1.6" rx=".8" class="fg" opacity=".7"/>
    <rect data-p="Caret" x="${b.x - 11}" y="${b.y + 4.5}" width="4" height="1.6" class="fg"/></g></g>
  <g class="prop p-needs"><g data-p="QB" data-c="${qx},${qy}">
    <path d="M${qx - 10},${qy - 10} h20 a3,3 0 0 1 3,3 v14 a3,3 0 0 1 -3,3 h-12 l-5,5 v-5 h-3 a3,3 0 0 1 -3,-3 v-14 a3,3 0 0 1 3,-3 z" fill="#fff" class="sa" stroke-width="2"/>
    <text x="${qx}" y="${qy + 5.5}" text-anchor="middle" font-size="15" font-weight="800" class="fa" font-family="Segoe UI, sans-serif">?</text></g></g>
  <g class="prop p-oops">
    <g data-p="Sweat" data-c="${sd.x},${sd.y}"><path d="M${sd.x},${sd.y - 5} C${sd.x + 3.5},${sd.y} ${sd.x + 3.5},${sd.y + 3.5} ${sd.x},${sd.y + 4.5} C${sd.x - 3.5},${sd.y + 3.5} ${sd.x - 3.5},${sd.y} ${sd.x},${sd.y - 5} Z" fill="#9AD8F5" stroke="#4BA3D0" stroke-width="1"/></g>
    <g data-p="Puff" data-c="${tp.x},${tp.y}"><circle cx="${tp.x - 3}" cy="${tp.y}" r="3" fill="#BDB8AE"/><circle cx="${tp.x + 2}" cy="${tp.y - 2}" r="3.8" fill="#CFCAC0"/><circle cx="${tp.x + 4}" cy="${tp.y + 2}" r="2.6" fill="#BDB8AE"/></g></g>`;
  const root = `
  <g class="prop p-writing"><g transform="rotate(-8 ${h.x} ${h.y})">
    <rect x="${h.x - 8}" y="${h.y - 10}" width="16" height="20" rx="2" fill="#fff" stroke="#C9C3B6" stroke-width="1.2"/>
    ${[0, 1, 2].map(i => `<rect data-p="Ln${i}" data-c="${h.x - 5},${h.y - 5 + i * 4}" x="${h.x - 5}" y="${h.y - 5.7 + i * 4}" width="${i === 2 ? 7 : 10}" height="1.4" rx=".7" class="fa"/>`).join("")}</g>
    <g data-p="Pencil"><g transform="translate(${h.x - 5} ${h.y - 6}) rotate(-50)">
      <polygon points="0,0 4,-1.8 4,1.8" fill="#E8C79A"/><polygon points="0,0 1.5,-.7 1.5,.7" fill="#333"/>
      <rect x="4" y="-1.8" width="12" height="3.6" fill="#F2C94C"/><rect x="16" y="-1.8" width="3" height="3.6" fill="#EF8A9B"/></g></g></g>`;
  const cols = ["var(--accent)", "#F2C94C", "#EF6F8E", "#5CC8A8", "#7AA7DA", "#F29B4C"];
  const front = `
  <g class="prop p-celebrate">${Array.from({ length: CONFETTI }, (_, i) => {
      const x = 6 + (i * 37) % 92, y = -44 + (i % 3) * 2;
      return `<rect data-p="Cf${i}" data-c="${x + 1.5},${y + 2.5}" x="${x}" y="${y}" width="3" height="5" rx=".6" ${i % cols.length ? `fill="${cols[i % cols.length]}"` : 'class="fa"'}/>`;
    }).join("")}</g>
  <g class="prop p-asleep">${[13, 10.5, 8].map((fs, i) =>
      `<text data-p="Z${i}" data-c="${b.x - 6},${b.y + 8}" x="${b.x - 6}" y="${b.y + 8}" font-size="${fs}" font-weight="800" class="fa" font-family="Segoe UI, sans-serif">z</text>`).join("")}</g>`;
  return { back, body, root, front };
}

// ------------------------------------------------------------------ the avatars
// Each names the same pivots and anchors in its own drawing, so the shared
// states and accessories land in the right places on every body. (Today's Tatty,
// BASE, is what Polished Tatty is drawn over.)
const pupilPair = (l, r, f) => f(l) + f(r);

const BASE = {
  id: "today", letter: "–", name: "Today's Tatty", base: true,
  pitch: "Today's drawing, redrawn from TattyWindow.xaml, as the yardstick. The props are new on every card, this one included.",
  wins: "He's the Tatty people know already: clean, friendly and on brand.",
  risks: "He reads more as a diagram than a character: thin lines, no cheeks and no hands, so every state has to lean on props.",
  rig: "Today's rig: Robot (lift, lean, squash), Body (bob, sway), LegL/LegR (lift, fold), Eyes (blink), Pupils, three mouths, ArmFlag, Badge.",
  pivots: { ground: [52, 100], sway: [52, 90], legL: [38, 80], legR: [66, 80], eyes: [52, 48], shoulder: [18, 58] },
  anchors: { hat: { x: 52, y: 24, w: 68, earY: 50 }, cheek: { x: 75, y: 62 }, nose: { x: 52, y: 57 }, back: { x: 52, y: 60, s: 1.1 }, eyes: { x: 52, y: 48, dx: 13, r: 9 }, mouth: { x: 52, y: 62 }, neck: { x: 52, y: 83, w: .9 },
             hand: { x: 91, y: 70 }, side: { x: 84, y: 34 }, bubble: { x: 84, y: 2 }, badge: { x: 85, y: 23 }, top: { x: 52, y: 1 }, ground: 100 },
  tips: [[52, 9]], iconBox: [16, 2, 72, 80],
  legs: {
    L: `<line x1="38" y1="80" x2="38" y2="96" class="sa rc" stroke-width="4"/><line x1="30" y1="98" x2="46" y2="98" class="sa rc" stroke-width="4"/>`,
    R: `<line x1="66" y1="80" x2="66" y2="96" class="sa rc" stroke-width="4"/><line x1="58" y1="98" x2="74" y2="98" class="sa rc" stroke-width="4"/>` },
  antenna: `<line x1="52" y1="10" x2="52" y2="24" class="sa rc" stroke-width="3"/><circle cx="52" cy="9" r="5" class="fa"/>`,
  head: `<rect x="18" y="24" width="68" height="56" rx="12" class="ff sa" stroke-width="3"/>`,
  eyes: `<circle cx="39" cy="48" r="9" class="fn sa" stroke-width="2.5"/><circle cx="65" cy="48" r="9" class="fn sa" stroke-width="2.5"/>`,
  pupils: `<circle cx="39" cy="48" r="4" class="fk"/><circle cx="65" cy="48" r="4" class="fk"/>`,
  mouths: {
    neutral: `<polygon points="47,63 57,63 52,71" class="fa"/>`,
    happy: `<path d="M42,61 Q52,77 62,61 Z" class="fa"/>`,
    flat: `<line x1="45" y1="67" x2="59" y2="67" class="sa rc" stroke-width="3"/>` },
};

const A = {
  id: "polished", letter: "A", name: "Polished Tatty",
  pitch: "Today's shape, with more warmth: soft shading, blushing cheeks, sparkly eyes, a grin with a tongue and an antenna that glows like an LED.",
  wins: "The cheapest change that still makes him cuter. It keeps the same rig and the same tray icon shape, so people still know him.",
  risks: "It brings the least new character of the six: his warmth is all in the face and the little arms.",
  rig: "The same named parts as today. New: little arms (ArmL, ArmR), a serial plate for his project number, two more mouths (O, wobble), a pupil highlight, a glow behind the antenna tip, and a gradient fill (LinearGradientBrush).",
  pivots: BASE.pivots,
  anchors: { ...BASE.anchors, eyes: { x: 52, y: 47, dx: 14, r: 10 }, side: { x: 84, y: 33 }, top: { x: 52, y: -1 } },
  tips: [[52, 8]], iconBox: [10, 0, 84, 84],
  legs: {
    L: `<line x1="38" y1="80" x2="38" y2="94" class="sa rc" stroke-width="4.5"/><ellipse cx="37" cy="97.5" rx="8" ry="3.5" class="fa"/>`,
    R: `<line x1="66" y1="80" x2="66" y2="94" class="sa rc" stroke-width="4.5"/><ellipse cx="67" cy="97.5" rx="8" ry="3.5" class="fa"/>` },
  // his project number: a little serial plate, low on his face on the left
  numtag: `<rect x="25.5" y="66.5" width="13" height="9" rx="2.5" class="fa"/><circle cx="27.4" cy="68.4" r=".6" fill="#fff" fill-opacity=".7"/>
           <circle cx="36.6" cy="68.4" r=".6" fill="#fff" fill-opacity=".7"/><text class="num" x="32" y="73.6" text-anchor="middle" font-size="7" font-weight="800" font-family="Segoe UI, sans-serif" fill="#fff">1</text>`,
  // little arms from the sides of his head, behind it, hands as round as his feet
  back: `<circle cx="16" cy="52" r="4.5" class="fa"/><circle cx="88" cy="52" r="4.5" class="fa"/>
         <g data-p="ArmL" data-c="20,61" class="arm-l"><path d="M20,61 Q12.5,65.5 11,73" class="fn sa rc" stroke-width="4"/><circle cx="10.5" cy="75" r="3.8" class="fa"/></g>
         <g data-p="ArmR" data-c="84,61"><path d="M84,61 Q91.5,65.5 93,73" class="fn sa rc" stroke-width="4"/><circle cx="93.5" cy="75" r="3.8" class="fa"/></g>`,
  antenna: `<path d="M52,24 Q49,17 52,11" class="fn sa rc" stroke-width="3"/><circle cx="52" cy="8" r="5.5" class="fa"/><circle cx="50.3" cy="6.3" r="1.7" fill="#fff" fill-opacity=".85"/>`,
  head: `<rect x="18" y="24" width="68" height="56" rx="16" fill="url(#gA)" class="sa" stroke-width="3"/>
         <rect x="26" y="28.5" width="30" height="4" rx="2" fill="#fff" fill-opacity=".9"/>`,
  eyes: `<circle cx="38" cy="47" r="10" fill="#fff" class="sa" stroke-width="2.5"/><circle cx="66" cy="47" r="10" fill="#fff" class="sa" stroke-width="2.5"/>`,
  pupils: pupilPair(38, 66, x => `<circle cx="${x}" cy="48" r="5.2" class="fk"/><circle cx="${x - 1.8}" cy="46" r="1.8" fill="#fff"/>`),
  front: `<ellipse cx="29" cy="62" rx="5" ry="3" class="fb"/><ellipse cx="75" cy="62" rx="5" ry="3" class="fb"/>`,
  mouths: {
    neutral: `<path d="M46,63 Q52,68.5 58,63" class="fn sa rc" stroke-width="3"/>`,
    happy: `<path d="M42,61 Q52,77 62,61 Z" class="fa"/><ellipse cx="52" cy="66.5" rx="4.6" ry="2.4" fill="#EF8A9B"/>`,
    flat: `<line x1="46" y1="66" x2="58" y2="66" class="sa rc" stroke-width="3"/>`,
    o: `<ellipse cx="52" cy="65" rx="3.6" ry="4.2" class="fa"/>`,
    wobble: `<path d="M43,66 q2.25,-3 4.5,0 t4.5,0 t4.5,0 t4.5,0" class="fn sa rc" stroke-width="2.5"/>` },
  extra: (id, st) => st.tracks.some(t => t.p === "Tip.o") ? [] : [W("Tip.o", .08, .45, 0, 3)],
};

const B = {
  id: "pebble", letter: "B", name: "Pebble",
  pitch: "One soft bean of a body with big low eyes, stubby feet, nub arms and a sprout for an antenna. Kawaii proportions.",
  wins: "The cutest at a glance. One simple shape reads well small and on any wallpaper, and the nub arms give 'needs you' a raised hand.",
  risks: "Furthest from 'robot': the sprout and the bean shape read more creature than machine. Legs become feet, so sitting down is a squat.",
  rig: "Robot, Body, Eyes, Pupils and mouths are reused. Legs become two feet (a fold barely shows). New: ArmL and ArmR, the sprout, and a Path body instead of a Rectangle.",
  pivots: { ground: [52, 100], sway: [52, 94], legL: [40, 94], legR: [64, 94], eyes: [52, 54], shoulder: [14, 64] },
  anchors: { hat: { x: 52, y: 21, w: 56, earY: 50, ear: 41 }, cheek: { x: 77, y: 64 }, nose: { x: 52, y: 59 }, back: { x: 52, y: 60, s: 1.05 }, eyes: { x: 52, y: 54, dx: 14, r: 8 }, mouth: { x: 52, y: 61, w: .85 }, neck: { x: 52, y: 77, w: .9 },
             hand: { x: 95, y: 74 }, side: { x: 84, y: 36 }, bubble: { x: 84, y: 4 }, badge: { x: 84, y: 24 }, top: { x: 59, y: 0 }, ground: 101 },
  tips: [[59, 8]], iconBox: [8, 0, 88, 100],
  legs: { L: `<ellipse cx="40" cy="96.5" rx="8.5" ry="5" class="fa"/>`, R: `<ellipse cx="64" cy="96.5" rx="8.5" ry="5" class="fa"/>` },
  antenna: `<path d="M52,21 C52,15 54,12 58,9" class="fn sa rc" stroke-width="2.6"/><path d="M53,15 C49,11.5 46,12.5 44.5,15 C48,17.5 51,17 53,15 Z" class="fa" fill-opacity=".8"/><circle cx="59" cy="8" r="4.5" class="fa"/>`,
  head: `<path d="M52,20 C80,20 92,40 92,62 C92,84 76,94 52,94 C28,94 12,84 12,62 C12,40 24,20 52,20 Z" class="ff sa" stroke-width="3"/>
         <ellipse cx="52" cy="84" rx="15" ry="5.5" class="fa" fill-opacity=".12"/>
         <path d="M26,34 Q32,26 42,24" class="fn rc" stroke="#fff" stroke-width="3"/>`,
  numtag: `<text class="num fa" x="42.5" y="89.5" text-anchor="middle" font-size="10" font-weight="800" font-family="Segoe UI, sans-serif">1</text>`,
  over: `<g data-p="ArmL" data-c="17,62" class="arm-l"><ellipse cx="9" cy="72" rx="4.5" ry="7" class="fa" transform="rotate(25 9 72)"/></g>
         <g data-p="ArmR" data-c="87,62"><ellipse cx="95" cy="72" rx="4.5" ry="7" class="fa" transform="rotate(-25 95 72)"/></g>`,
  eyes: ``,
  pupils: pupilPair(38, 66, x => `<ellipse cx="${x}" cy="54" rx="6" ry="7.5" class="fk"/><circle cx="${x - 2}" cy="51" r="2.3" fill="#fff"/><circle cx="${x + 2}" cy="57" r="1.1" fill="#fff"/>`),
  front: `<ellipse cx="27" cy="64" rx="6" ry="3.5" class="fb"/><ellipse cx="77" cy="64" rx="6" ry="3.5" class="fb"/>`,
  mouths: {
    neutral: `<path d="M47,63 q2.5,3 5,0 q2.5,3 5,0" class="fn sa rc" stroke-width="2.2"/>`,
    happy: `<path d="M46,62 Q52,71 58,62 Z" class="fa"/>`,
    flat: `<line x1="48" y1="64" x2="56" y2="64" class="sa rc" stroke-width="2.2"/>`,
    o: `<ellipse cx="52" cy="64.5" rx="2.6" ry="3.2" class="fa"/>`,
    wobble: `<path d="M45,64 q1.75,-2.5 3.5,0 t3.5,0 t3.5,0 t3.5,0" class="fn sa rc" stroke-width="2.2"/>` },
};

const scanlines = Array.from({ length: 10 }, (_, i) => `<rect x="21" y="${32 + i * 4}" width="62" height="1" fill="#fff"/>`).join("");
const C = {
  id: "screen", letter: "C", name: "Screen face",
  pitch: "A little TV head with rabbit-ear antennas. His face glows on a dark screen in the mode's light shade, and the screen shows a progress bar while he works.",
  wins: "The screen is the expression: any face or icon can go on it, so states are the easiest to read. The progress bar shows he's busy for free.",
  risks: "The dark screen is heavy on a dark desktop and at small sizes. It can feel more gadget than friend.",
  rig: "Today's rig plus a small body box and little arms (ArmL, ArmR); his project number is a channel number on the screen. The eyes become lit pills (still Eyes and Pupils). New Scan and Prog parts. Every face is a swap of shapes, which is how the XAML already prefers to do it.",
  pivots: { ground: [52, 100], sway: [52, 90], legL: [43, 91], legR: [61, 91], eyes: [52, 48], shoulder: [16, 58] },
  anchors: { hat: { x: 52, y: 22, w: 76, earY: 50 }, cheek: { x: 86, y: 52 }, nose: { x: 52, y: 55 }, back: { x: 52, y: 60, s: 1.1 }, eyes: { x: 52, y: 48, dx: 14, r: 9 }, mouth: { x: 52, y: 60 }, neck: { x: 52, y: 83, w: .85 },
             hand: { x: 92, y: 72 }, side: { x: 88, y: 30 }, bubble: { x: 86, y: 0 }, badge: { x: 88, y: 21 }, top: { x: 68, y: 0 }, ground: 100 },
  tips: [[36, 8], [68, 8]], iconBox: [10, 2, 84, 82],
  legs: {
    L: `<line x1="43" y1="91" x2="43" y2="96" class="sa rc" stroke-width="4"/><line x1="37" y1="98" x2="49" y2="98" class="sa rc" stroke-width="4"/>`,
    R: `<line x1="61" y1="91" x2="61" y2="96" class="sa rc" stroke-width="4"/><line x1="55" y1="98" x2="67" y2="98" class="sa rc" stroke-width="4"/>` },
  // his project number: a channel number, glowing in the top corner of his screen
  numtag: `<text class="num fg" x="77" y="40" text-anchor="middle" font-size="9.5" font-weight="800" font-family="Segoe UI, sans-serif">1</text>`,
  // little arms from the sides of the set, behind it
  back: `<g data-p="ArmL" data-c="17,63" class="arm-l"><path d="M17,63 Q9.5,67.5 8,75" class="fn sa rc" stroke-width="3.6"/><circle cx="7.5" cy="77" r="3.4" class="fa"/></g>
         <g data-p="ArmR" data-c="87,63"><path d="M87,63 Q94.5,67.5 96,75" class="fn sa rc" stroke-width="3.6"/><circle cx="96.5" cy="77" r="3.4" class="fa"/></g>
         <rect x="36" y="78" width="32" height="13" rx="4" class="ff sa" stroke-width="2.5"/>
         <g class="own own-neck"><circle cx="46" cy="85" r="1.6" class="fa"/><circle cx="52" cy="85" r="1.6" class="fa"/><circle cx="58" cy="85" r="1.6" class="fa" fill-opacity=".4"/></g>`,
  antenna: `<line x1="45" y1="23" x2="37" y2="9" class="sa rc" stroke-width="2.5"/><line x1="59" y1="23" x2="67" y2="9" class="sa rc" stroke-width="2.5"/>
            <circle cx="36" cy="8" r="3.5" class="fa"/><circle cx="68" cy="8" r="3.5" class="fa"/>`,
  head: `<rect x="14" y="22" width="76" height="58" rx="12" class="ff sa" stroke-width="3"/>
         <rect x="21" y="29" width="62" height="42" rx="9" fill="#18202C"/>
         <g opacity=".07">${scanlines}</g>
         <rect data-p="Scan" x="21" y="29" width="62" height="3" class="fg" opacity=".12"/>
         <path d="M26,34 Q27,31.5 32,31.5 L42,31.5" stroke="#fff" stroke-opacity=".22" stroke-width="2" fill="none" class="rc"/>
         <circle cx="82" cy="75.5" r="1.7" class="fa"/>`,
  eyes: ``,
  pupils: `<rect x="32" y="40" width="12" height="16" rx="6" class="fg"/><rect x="60" y="40" width="12" height="16" rx="6" class="fg"/>`,
  front: `<g class="prog"><rect x="30" y="67.4" width="44" height="2.2" rx="1.1" fill="#fff" fill-opacity=".12"/>
          <rect data-p="Prog" data-c="30,68" x="30" y="67.4" width="44" height="2.2" rx="1.1" class="fg"/></g>`,
  mouths: {
    neutral: `<path d="M45,60 Q52,65 59,60" class="fn sg rc" stroke-width="2.8"/>`,
    happy: `<path d="M41,58 Q52,70 63,58" class="fn sg rc" stroke-width="3.2"/>`,
    flat: `<line x1="45" y1="62" x2="59" y2="62" class="sg rc" stroke-width="2.8"/>`,
    o: `<ellipse cx="52" cy="62" rx="3.5" ry="3.5" class="fn sg" stroke-width="2.6"/>`,
    wobble: `<path d="M42,62 q2.5,-3 5,0 t5,0 t5,0 t5,0" class="fn sg rc" stroke-width="2.6"/>` },
  extra: id => [L("Scan.y", 0, 39, 0, 2.6), ...(WORKING.includes(id) ? [L("Prog.sx", .03, 1, 0, 2)] : [])],
};

// ------------------------------------------------------------------ the animals
// Same box, same pivots and anchors, same states. They have no antenna, so a hat
// just sits between their ears; their extra life is a tail, ears or brows.

const spikes = [[36, 24, 12], [52, 19, 13], [68, 24, 12]]
  .map(([x, y, h]) => `<path d="M${x - 6},${y + 4} Q${x},${y - 2 * h} ${x + 6},${y + 4} Z" class="fl sd" stroke-width="1.8" stroke-linejoin="round"/>`).join("");
const G = {
  id: "dino", letter: "G", name: "Little Dino", tagline: "Tiny arms, big heart",
  pitch: "A chubby baby dinosaur in the mode's colour, with a big round head, soft back spikes, a wagging tail and tiny, tiny arms.",
  wins: "Instantly lovable, and the tiny arms are 'trying his best' built in: waving them for 'needs you' is the joke. The tail wag gives every state a second way to show his mood.",
  risks: "The tail makes him wider on one side, so his notepad moves to his other hand. A coloured face needs dark line work, which is a second accent shade.",
  rig: "Robot, Body, Eyes, Pupils, LegL/LegR (feet) and mouths are reused, and the tiny arms are ArmL/ArmR. New: Tail, and a darker shade of the accent for his line work.",
  pivots: { ground: [52, 100], sway: [52, 92], legL: [40, 92], legR: [64, 92], eyes: [52, 42], shoulder: [30, 70] },
  anchors: { hat: { x: 52, y: 17, w: 50, earY: 44, ear: 35 }, cheek: { x: 74, y: 54 }, nose: { x: 52, y: 51 }, back: { x: 52, y: 66, s: .95 }, eyes: { x: 52, y: 42, dx: 12, r: 8.5 }, mouth: { x: 52, y: 56, w: .9 }, neck: { x: 52, y: 67, w: .9 },
             hand: { x: 12, y: 76 }, side: { x: 80, y: 30 }, bubble: { x: 86, y: 0 }, badge: { x: 82, y: 20 }, top: { x: 52, y: 4 }, ground: 101 },
  tips: [], iconBox: [14, 2, 76, 70],
  legs: {
    L: `<ellipse cx="40" cy="96" rx="9" ry="5.5" class="fa sd" stroke-width="2"/><path d="M35.5,99 v-2 M40,99.5 v-2 M44.5,99 v-2" stroke="#fff" stroke-opacity=".8" stroke-width="1.4" class="rc"/>`,
    R: `<ellipse cx="64" cy="96" rx="9" ry="5.5" class="fa sd" stroke-width="2"/><path d="M59.5,99 v-2 M64,99.5 v-2 M68.5,99 v-2" stroke="#fff" stroke-opacity=".8" stroke-width="1.4" class="rc"/>` },
  back: `<g data-p="Tail" data-c="68,86"><path d="M64,80 C78,86 90,88 99,74 C97,86 86,96 64,92 Z" class="fa sd" stroke-width="2.2" stroke-linejoin="round"/>
           <path d="M82,87 L86,80.5 L89,86 Z M91,83 L95.5,77 L96.5,82 Z" class="fl"/></g>
         ${spikes}
         <ellipse cx="52" cy="80" rx="23" ry="17" class="fa sd" stroke-width="2.5"/>
         <ellipse cx="52" cy="83" rx="14" ry="11" class="ff"/>
         <path d="M44,78 h16 M44.5,84 h15 M47,90 h10" stroke="#000" stroke-opacity=".08" stroke-width="1.4" class="rc"/>`,
  antenna: ``,
  head: `<path d="M52,16 C72,16 84,28 84,44 C84,60 70,68 52,68 C34,68 20,60 20,44 C20,28 32,16 52,16 Z" class="fa sd" stroke-width="2.5"/>
         <ellipse cx="38" cy="25" rx="7" ry="3" fill="#fff" fill-opacity=".35" transform="rotate(-20 38 25)"/>
         <circle cx="48.5" cy="52" r="1.2" class="fdk"/><circle cx="55.5" cy="52" r="1.2" class="fdk"/>`,
  numtag: `<text class="num fa" x="44.5" y="91.5" text-anchor="middle" font-size="10.5" font-weight="800" font-family="Segoe UI, sans-serif">1</text>`,
  over: `<g data-p="ArmL" data-c="32,70" class="arm-l"><ellipse cx="29" cy="76" rx="3.6" ry="5.6" class="fa sd" stroke-width="1.8" transform="rotate(28 29 76)"/></g>
         <g data-p="ArmR" data-c="72,70"><ellipse cx="75" cy="76" rx="3.6" ry="5.6" class="fa sd" stroke-width="1.8" transform="rotate(-28 75 76)"/></g>`,
  eyes: `<circle cx="40" cy="42" r="8.5" fill="#fff" class="sd" stroke-width="1.6"/><circle cx="64" cy="42" r="8.5" fill="#fff" class="sd" stroke-width="1.6"/>`,
  pupils: pupilPair(40, 64, x => `<circle cx="${x}" cy="43" r="5" class="fk"/><circle cx="${x - 1.7}" cy="41" r="1.8" fill="#fff"/>`),
  front: `<ellipse cx="30" cy="54" rx="5" ry="3" class="fb"/><ellipse cx="74" cy="54" rx="5" ry="3" class="fb"/>`,
  mouths: {
    neutral: `<path d="M44,57 Q52,62.5 60,57" class="fn sd rc" stroke-width="2.4"/>`,
    happy: `<path d="M42,56 Q52,69 62,56 Z" class="fdk"/><ellipse cx="52" cy="61.5" rx="4" ry="2" fill="#EF8A9B"/><path d="M45,56.4 l2,3 l2,-3 Z M55,56.4 l2,3 l2,-3 Z" fill="#fff"/>`,
    flat: `<line x1="46" y1="58" x2="58" y2="58" class="sd rc" stroke-width="2.4"/>`,
    o: `<ellipse cx="52" cy="58.5" rx="3" ry="3.5" class="fdk"/>`,
    wobble: `<path d="M43,58 q2.25,-3 4.5,0 t4.5,0 t4.5,0 t4.5,0" class="fn sd rc" stroke-width="2.2"/>` },
  // His tail is how he feels: a lazy wag, a happy thrash, tucked in when it all goes wrong.
  extra: id => [({
    idle: T("Tail.a", [[0, 0], [7, 1], [0, 2]], 2),
    asleep: T("Tail.a", [[-6, 0]]),
    celebrate: T("Tail.a", [[0, 0], [16, .15], [-6, .3], [16, .45], [0, .6]], .6),
    needs: T("Tail.a", [[0, 0], [12, .2], [0, .4]], .4),
    oops: T("Tail.a", [[-10, 0]]),
  })[id] || T("Tail.a", [[0, 0], [9, .5], [0, 1]], 1)],
};

const whiskers = `<path d="M38,58 l-15,-3 M38,61 l-15,1 M66,58 l15,-3 M66,61 l15,1" stroke="#fff" stroke-opacity=".85" stroke-width="1.1" class="rc"/>`;
const catNose = `<path d="M52,57.5 v1.6" class="sk" stroke-width="1.5"/>`;
const H = {
  id: "cat", letter: "H", name: "Dapper Cat", tagline: "Effortlessly cool",
  pitch: "A sleek tuxedo cat: dark coat, white shirt-front and socks, and a collar in the mode's colour with a gold tag. Cool half-lidded eyes and a tail that never quite keeps still.",
  wins: "The most stylish of the five. The tail and ears give him small, constant life without big motion, and his raised paw for 'needs you' is a beckoning lucky cat.",
  risks: "A dark coat can get lost on a dark desktop, so he leans on the accent outline. His cool eyes have to stay warm enough to read as friendly.",
  rig: "Robot, Body, Eyes (with a lid that blinks with them), Pupils (slits) and mouths are reused. The front paws are ArmL/ArmR and the back feet LegL/LegR. New: Tail and two ears that twitch (EarL, EarR).",
  pivots: { ground: [52, 100], sway: [52, 94], legL: [34, 96], legR: [70, 96], eyes: [52, 44], shoulder: [32, 74] },
  anchors: { hat: { x: 52, y: 23, w: 46, earY: 46, ear: 37 }, cheek: { x: 75, y: 53 }, nose: { x: 52, y: 55.5 }, back: { x: 52, y: 70, s: .9 }, eyes: { x: 52, y: 44, dx: 12, r: 7.5 }, mouth: { x: 52, y: 58, w: .7 }, neck: { x: 52, y: 77, w: .85 },
             hand: { x: 12, y: 80 }, side: { x: 82, y: 32 }, bubble: { x: 86, y: 0 }, badge: { x: 84, y: 18 }, top: { x: 52, y: 8 }, ground: 101 },
  tips: [], iconBox: [14, 8, 76, 68],
  legs: { L: `<ellipse cx="34" cy="96.5" rx="7.5" ry="4.2" class="ff sa" stroke-width="1.6"/>`, R: `<ellipse cx="70" cy="96.5" rx="7.5" ry="4.2" class="ff sa" stroke-width="1.6"/>` },
  back: `<g data-p="Tail" data-c="68,90"><path d="M66,92 C84,95 94,82 89,66 C88,61.5 83.5,62 84.5,66.5 C88,79 82,88 66,87 Z" class="fur sa" stroke-width="1.8" stroke-linejoin="round"/>
           <path d="M84.6,66.8 C84,63 88.4,61.6 89.2,66 C89.6,68 88.8,69.5 87,70 C86,70 85,68.5 84.6,66.8 Z" class="ff"/></g>
         <g data-p="EarL" data-c="32,30"><path d="M21,38 L24,11 L43,24 Z" class="fur sa" stroke-width="2" stroke-linejoin="round"/><path d="M26,31 L27,18 L37,25 Z" fill="#F2A7B8"/></g>
         <g data-p="EarR" data-c="72,30"><path d="M83,38 L80,11 L61,24 Z" class="fur sa" stroke-width="2" stroke-linejoin="round"/><path d="M78,31 L77,18 L67,25 Z" fill="#F2A7B8"/></g>
         <path d="M34,66 C29,78 29,92 36,97 L68,97 C75,92 75,78 70,66 Z" class="fur sa" stroke-width="2"/>
         <path d="M43,68 Q52,95 61,68 Z" class="ff"/>
         <g class="own own-neck"><path d="M35,71 Q52,80 69,71 L69,75 Q52,84 35,75 Z" class="fa"/>
         <circle cx="52" cy="83" r="3.2" fill="#F2C94C" stroke="#C9A227" stroke-width="1"/></g>`,
  antenna: ``,
  head: `<path d="M52,22 C74,22 86,32 86,48 C86,64 72,72 52,72 C32,72 18,64 18,48 C18,32 30,22 52,22 Z" class="fur sa" stroke-width="2.2"/>
         <path d="M48.5,52 Q50,38 52,31 Q54,38 55.5,52 Z" class="ff"/>
         <path d="M52,50 C60,50 66,54.5 66,59.5 C66,65.5 59,69 52,69 C45,69 38,65.5 38,59.5 C38,54.5 44,50 52,50 Z" class="ff"/>
         <path class="own own-nose" d="M49,54 L55,54 L52,57.5 Z" fill="#E88AA0"/>`,
  with: `<path class="with with-nose" d="M49,50 L55,50 L52,53.5 Z" fill="#E88AA0" stroke="#C96F86" stroke-width=".6"/>`,
  numtag: `<circle cx="52" cy="84.5" r="4.6" fill="#F2C94C" stroke="#C9A227" stroke-width="1"/><text class="num" x="52" y="86.8" text-anchor="middle" font-size="6" font-weight="800" font-family="Segoe UI, sans-serif" fill="#6B4A00">1</text>`,
  over: `<g data-p="ArmL" data-c="40,80" class="arm-l"><ellipse cx="41" cy="93" rx="6" ry="4.6" class="ff sa" stroke-width="1.6"/><path d="M39,95.5 v-2 M43,95.5 v-2" stroke="#C9C3B6" stroke-width="1" class="rc"/></g>
         <g data-p="ArmR" data-c="64,80"><ellipse cx="63" cy="93" rx="6" ry="4.6" class="ff sa" stroke-width="1.6"/><path d="M61,95.5 v-2 M65,95.5 v-2" stroke="#C9C3B6" stroke-width="1" class="rc"/></g>`,
  eyes: `<ellipse cx="40" cy="44" rx="7.5" ry="7.5" fill="#E6D35A" stroke="#15171C" stroke-width="1"/><ellipse cx="64" cy="44" rx="7.5" ry="7.5" fill="#E6D35A" stroke="#15171C" stroke-width="1"/>`,
  pupils: pupilPair(40, 64, x => `<ellipse cx="${x}" cy="44.5" rx="2.2" ry="6" class="fk"/><circle cx="${x - 2.4}" cy="41.6" r="1.5" fill="#fff"/>`),
  lids: pupilPair(40, 64, x => `<path d="M${x - 9},40.6 Q${x},38.6 ${x + 9},40.6 L${x + 9},35 L${x - 9},35 Z" class="fur"/>
                                 <path d="M${x - 7.5},40.6 Q${x},38.8 ${x + 7.5},40.6" stroke="#15171C" stroke-width="1.2" fill="none" class="rc"/>`),
  front: `<ellipse cx="42.5" cy="63" rx="3" ry="1.8" class="fb"/><ellipse cx="61.5" cy="63" rx="3" ry="1.8" class="fb"/>${whiskers}`,
  mouths: {
    neutral: `${catNose}<path d="M47,59 Q49.5,62 52,59 Q54.5,62 57,59" class="fn sk rc" stroke-width="1.6"/>`,
    happy: `${catNose}<path d="M46.5,59 Q52,68 57.5,59 Z" fill="#5B2333"/><ellipse cx="52" cy="63.6" rx="3" ry="1.6" fill="#EF8A9B"/>`,
    flat: `${catNose}<path d="M48,60 h8" class="sk rc" stroke-width="1.6"/>`,
    o: `${catNose}<ellipse cx="52" cy="61.6" rx="2.2" ry="2.6" fill="#5B2333"/>`,
    wobble: `${catNose}<path d="M46,60.5 q1.5,-2 3,0 t3,0 t3,0 t3,0" class="fn sk rc" stroke-width="1.5"/>` },
  // Tail and ears: a slow swish, a twitch now and then, flat back when it goes wrong, pricked up for a question.
  extra: id => {
    const tail = ({
      idle: T("Tail.a", [[0, 0], [-10, 1.5], [6, 3], [0, 4]], 4),
      asleep: T("Tail.a", [[18, 0]]),
      needs: T("Tail.a", [[0, 0], [-14, .25], [0, .5]], .5),
      celebrate: T("Tail.a", [[0, 0], [-18, .2], [10, .4], [0, .6]], .6),
      oops: T("Tail.a", [[-4, 0], [4, .08], [-4, .16]], .16),
    })[id] || T("Tail.a", [[0, 0], [-7, .8], [0, 1.6]], 1.6);
    const ears = {
      asleep: [-6, 6], oops: [-18, 18], needs: [6, -6],
    }[id];
    return [tail, ...(ears
      ? [T("EarL.a", [[ears[0], 0]]), T("EarR.a", [[ears[1], 0]])]
      : [T("EarL.a", [[0, 0], [0, 6.5], [-14, 6.6], [0, 6.8], [0, 8]], 8), T("EarR.a", [[0, 0], [0, 3], [14, 3.1], [0, 3.3], [0, 8]], 8)])];
  },
};

const beak = `<path d="M52,52 L56.5,57.5 L52,64 L47.5,57.5 Z" fill="#E8A93A" stroke="#B9802A" stroke-width="1" stroke-linejoin="round"/>`;
const chevronsTop = [[44, 72], [52, 72], [60, 72]].map(([x, y]) => `M${x - 3},${y} l3,2.5 l3,-2.5`).join(" ");
const chevrons = [[48, 79], [56, 79], [44, 86], [52, 86], [60, 86]].map(([x, y]) => `M${x - 3},${y} l3,2.5 l3,-2.5`).join(" ");
const I = {
  id: "owl", letter: "I", name: "Wise Owl", tagline: "Thinks it through",
  pitch: "A round little owl in the mode's colour, with ear tufts, a pale face, big amber eyes under thoughtful brows, a chevron-feathered tummy, and wings that do the waving.",
  wins: "A natural for 'thinking' and 'reading': he tilts his head the way owls do, and with round glasses on he is the wise owl. The wings make big, readable gestures without arms.",
  risks: "A beak can't smile, so his moods come from the eyes, brows, wings and head tilt, and his mouth set is the weakest of the five. The tufts and hats compete for the top of the head.",
  rig: "Robot, Body, Eyes, Pupils and LegL/LegR (talons) are reused, and the wings are ArmL/ArmR. The mouths are beak shapes. New: brows that lift (Brows), and a bigger head tilt in his idle.",
  pivots: { ground: [52, 100], sway: [52, 94], legL: [42, 96], legR: [62, 96], eyes: [52, 45], shoulder: [22, 56] },
  anchors: { hat: { x: 52, y: 20, w: 48, earY: 46, ear: 37 }, cheek: { x: 73, y: 56 }, nose: { x: 52, y: 57 }, back: { x: 52, y: 58, s: 1 }, eyes: { x: 52, y: 45, dx: 12, r: 8.5 }, mouth: { x: 52, y: 63, w: .7 }, neck: { x: 52, y: 74, w: .85 },
             hand: { x: 92, y: 86 }, side: { x: 82, y: 30 }, bubble: { x: 86, y: 2 }, badge: { x: 84, y: 20 }, top: { x: 52, y: 6 }, ground: 101 },
  tips: [], iconBox: [12, 6, 80, 92],
  legs: {
    L: `<circle cx="38" cy="97" r="2.4" fill="#E8A93A"/><circle cx="42" cy="98" r="2.4" fill="#E8A93A"/><circle cx="46" cy="97" r="2.4" fill="#E8A93A"/>`,
    R: `<circle cx="58" cy="97" r="2.4" fill="#E8A93A"/><circle cx="62" cy="98" r="2.4" fill="#E8A93A"/><circle cx="66" cy="97" r="2.4" fill="#E8A93A"/>` },
  back: `<path d="M27,32 L21,10 L40,23 Z" class="fa sd" stroke-width="2" stroke-linejoin="round"/>
         <path d="M77,32 L83,10 L64,23 Z" class="fa sd" stroke-width="2" stroke-linejoin="round"/>`,
  antenna: ``,
  head: `<path d="M52,18 C76,18 86,38 86,60 C86,84 72,96 52,96 C32,96 18,84 18,60 C18,38 28,18 52,18 Z" class="fa sd" stroke-width="2.5"/>
         <ellipse cx="52" cy="79" rx="19" ry="15" class="fl"/>
         <path d="${chevrons}" class="fn sd rc" stroke-width="1.4"/><path d="${chevronsTop}" class="own own-neck fn sd rc" stroke-width="1.4"/>
         <circle cx="40" cy="45" r="14.5" fill="#F6EEDF"/><circle cx="64" cy="45" r="14.5" fill="#F6EEDF"/>`,
  // his project number: a pin on his chest, low on the left (clear of a medal at the neck)
  numtag: `<circle cx="39.5" cy="86" r="5.4" fill="#F6EEDF" class="sd" stroke-width="1.3"/><text class="num fdk" x="39.5" y="88.6" text-anchor="middle" font-size="7.5" font-weight="800" font-family="Segoe UI, sans-serif">1</text>`,
  over: `<g data-p="ArmL" data-c="22,56" class="arm-l"><path d="M23,54 C11,62 11,82 22,90 C26,78 27,64 23,54 Z" class="fdk"/></g>
         <g data-p="ArmR" data-c="82,56"><path d="M81,54 C93,62 93,82 82,90 C78,78 77,64 81,54 Z" class="fdk"/></g>`,
  eyes: `<circle cx="40" cy="45" r="8.5" fill="#F2B33D" class="sd" stroke-width="1.6"/><circle cx="64" cy="45" r="8.5" fill="#F2B33D" class="sd" stroke-width="1.6"/>`,
  pupils: pupilPair(40, 64, x => `<circle cx="${x}" cy="45.5" r="4.8" class="fk"/><circle cx="${x - 1.8}" cy="43.2" r="1.7" fill="#fff"/>`),
  front: `<ellipse cx="31" cy="56" rx="4" ry="2.4" class="fb"/><ellipse cx="73" cy="56" rx="4" ry="2.4" class="fb"/>
          <g data-p="Brows" data-c="52,31"><path d="M29,33 Q39,27 49,33 M75,33 Q65,27 55,33" class="fn sd rc" stroke-width="2.6"/></g>`,
  mouths: {
    neutral: beak,
    happy: `<path d="M47.5,56.5 L56.5,56.5 L55.5,59 L48.5,59 Z" fill="#5B2333"/>
            <path d="M47.5,56.5 L52,51.5 L56.5,56.5 Z" fill="#E8A93A" stroke="#B9802A" stroke-width="1" stroke-linejoin="round"/>
            <path d="M48.5,59 L55.5,59 L52,64.5 Z" fill="#E8A93A" stroke="#B9802A" stroke-width="1" stroke-linejoin="round"/>`,
    flat: beak,
    o: `<ellipse cx="52" cy="57.6" rx="3" ry="1.8" fill="#5B2333"/>
        <path d="M48,56 L52,51.5 L56,56 Z" fill="#E8A93A" stroke="#B9802A" stroke-width="1" stroke-linejoin="round"/>
        <path d="M49,59 L55,59 L52,63 Z" fill="#E8A93A" stroke="#B9802A" stroke-width="1" stroke-linejoin="round"/>`,
    wobble: `<g transform="rotate(10 52 58)">${beak}</g>` },
  // The owl's tell is his head: a slow, curious tilt when idle, cocked while he thinks; the brows do the rest.
  extra: id => ({
    idle: [T("Body.a", [[0, 0], [0, 2.5], [9, 2.9], [9, 4], [0, 4.4], [0, 5.4], [-6, 5.8], [-6, 6.6], [0, 7]])],
    thinking: [T("Body.a", [[-8, 0]]), T("Brows.y", [[-2.5, 0], [-1, 1.5], [-2.5, 3]], 3)],
    reading: [T("Brows.y", [[1, 0]])],
    needs: [T("Brows.y", [[-4, 0]])],
    oops: [T("Brows.y", [[-2, 0]]), T("Brows.a", [[-4, 0]])],
    asleep: [T("Brows.y", [[2, 0]])],
  })[id] || [],
};

B.tagline = "Small, soft, always pleased to see you";
A.tagline = "The Tatty you know, warmer";
A.free = true;
// What each one has in an accessory's spot, and what happens to it when something is worn there.
A.own = { hat: "antenna" }; A.ownNote = "Hat: his antenna, which pokes out of a beanie, top hat, crown or cowboy hat, stays out for the light ones (headphones, halo, flowers, bunny ears, a bow) and hides under the rest.";
B.own = { hat: "sprout" }; B.ownNote = "Hat: his sprout, which behaves like the antenna: out of the tall hats, under the snug ones.";
C.own = { hat: "rabbit ears", neck: "buttons" }; C.ownNote = "Hat: his rabbit ears, which poke out of some hats and hide under others. Neck: his three buttons, which come off for anything worn at the neck.";
G.own = {}; G.ownNote = "Nothing to swap: hats sit between his spikes, and a moustache sits over his nostrils.";
H.own = { neck: "collar", nose: "nose" }; H.ownNote = "Neck: his collar and tag, which come off for anything worn at the neck. Face: his nose, which moves up above a moustache and is replaced by a clown nose.";
I.own = { face: "beak", neck: "top feathers" }; I.ownNote = "Face: his beak, which shrinks to a little tip above any moustache. Neck: he has none, so neck things sit on his chest in place of his top row of feathers.";
I.mouthSlot = "face";
I.with = `<path class="with with-face" d="M48.5,57 L52,51.5 L55.5,57 Z" fill="#E8A93A" stroke="#B9802A" stroke-width="1" stroke-linejoin="round"/>`;
C.tagline = "Wears his heart on his screen";
const AVATARS = [A, C, B, G, H, I];

// ------------------------------------------------------------------ building a drawing
function svgFor(d, scale, viewBox, extra = "", dress = "") {
  const pv = d.pivots, pr = props(d);
  const mouths = ["neutral", "happy", "flat", "o", "wobble"]
    .map(m => `<g class="mouth m-${m}">${d.mouths[m] ?? d.mouths.neutral}</g>`).join("");
  const tips = d.tips.map(([x, y]) => `<circle data-p="Tip" data-o0="0" cx="${x}" cy="${y}" r="10" fill="url(#gGlow)" opacity="0"/>`).join("");
  const b = d.anchors.badge;
  const vb = viewBox || [0, -44, 104, 176];
  return `<svg class="tatty st-idle mo-neutral ${extra}" viewBox="${vb.join(" ")}" width="${vb[2] * scale}" height="${vb[3] * scale}" data-av="${d.id}" data-extra="${extra}"
      ${d.crisp ? 'shape-rendering="crispEdges"' : ""} xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g class="dress ${dress}">
    <g data-p="Back">${d.ground || ""}${pr.back}</g>
    <g data-p="Root" data-c="${pv.ground}" filter="url(#ds)">
      <g data-p="Body" data-c="${pv.sway}">${backAccessories(d)}</g>
      <g data-p="LegL" data-c="${pv.legL}">${d.legs.L}</g>
      <g data-p="LegR" data-c="${pv.legR}">${d.legs.R}</g>
      <g data-p="Body" data-c="${pv.sway}">
        ${d.back || ""}
        ${d.head}
        ${d.over || ""}
        <g data-p="Eyes" data-c="${pv.eyes}">${d.eyes}<g data-p="Pupils">${d.pupils}</g>${d.lids || ""}</g>
        <g class="${d.mouthSlot ? `own own-${d.mouthSlot}` : ""}">${mouths}</g>
        ${d.front || ""}
        <g class="antenna-wrap">${tips}${d.antenna}</g>
        ${accessories(d)}
        ${d.with || ""}
        ${d.numtag ? `<g class="numtag">${d.numtag}</g>` : ""}
        ${pr.body}
        <g class="badge"><circle cx="${b.x}" cy="${b.y}" r="11" fill="#C62828" stroke="#fff" stroke-width="2"/>
          <text x="${b.x}" y="${b.y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff" font-family="Segoe UI, sans-serif">!</text></g>
      </g>
      ${pr.root}
    </g>
    <g data-p="Front">${pr.front}</g>
  </g></svg>`;
}

// ------------------------------------------------------------------ the engine
const rest = k => k === "Tip.o" ? 0 : /\.(sx|sy|s|o)$/.test(k) ? 1 : 0;

class Card {
  constructor(d, svgs) {
    this.d = d; this.parts = new Map(); this.svgs = svgs; this.disp = {};
    this.nextBlink = 0; this.blinkAt = -1e9;
    for (const svg of svgs) svg.querySelectorAll("[data-p]").forEach(el => {
      const name = el.dataset.p;
      if (!this.parts.has(name)) this.parts.set(name, []);
      this.parts.get(name).push({
        el, c: (el.dataset.c || "0,0").split(",").map(Number),
        o0: el.dataset.o0 !== undefined ? +el.dataset.o0 : undefined, last: null, lastO: null,
      });
    });
  }
  setState(id, now) {
    const st = STATES[id](this.d);
    st.tracks = st.tracks.concat(this.d.extra ? this.d.extra(id, st) : [], ACC_TRACKS);
    this.snap = { ...this.disp }; this.t0 = now; this.st = st;
    this.id = id;
    for (const svg of this.svgs) svg.setAttribute("class", `tatty st-${id} mo-${st.mouth} ${svg.dataset.extra || ""}`.trim());
  }
  frame(now) {
    const st = this.st, d = this.d, t = (now - this.t0) / 1000, v = {};
    for (const tr of st.tracks) v[tr.p] = evalTrack(tr, t, st.dur);
    const [rise, bs] = st.bob || [4, 1.6];
    v["Body.y"] = -rise * (d.bobMul || 1) * ease(pingpong(t, bs));   // the bob owns Body.y
    let f = 1;                                                         // the blink owns Eyes.sy
    if (st.blink !== false) {
      if (now >= this.nextBlink) { this.blinkAt = now; this.nextBlink = now + 3000 + Math.random() * 4000; }
      const u = (now - this.blinkAt) / 180;
      if (u >= 0 && u < 1) f = 1 - .9 * Math.sin(Math.PI * u);
    }
    v["Eyes.sy"] = (v["Eyes.sy"] ?? st.lids ?? 1) * f;
    if (d.post) d.post(v, t);
    const bt = (now - this.t0) / 350;                                   // ease from the last state into this one
    if (bt < 1 && this.snap) {
      const e = ease(bt);
      for (const k of new Set([...Object.keys(v), ...Object.keys(this.snap)])) {
        const a = this.snap[k] ?? rest(k), b = v[k] ?? rest(k);
        v[k] = a + (b - a) * e;
      }
    }
    this.disp = v;
    const q = d.quant;
    for (const [name, list] of this.parts) {
      const g = k => v[name + "." + k];
      let x = g("x") || 0, y = g("y") || 0;
      const a = g("a") || 0, s = g("s"), sx = g("sx") ?? s ?? 1, sy = g("sy") ?? s ?? 1, o = g("o");
      if (q) { x = Math.round(x / q) * q; y = Math.round(y / q) * q; }
      for (const p of list) {
        const [cx, cy] = p.c;
        let tf = "";
        if (x || y) tf += `translate(${n(x)} ${n(y)}) `;
        if (a) tf += `rotate(${n(a)} ${cx} ${cy}) `;
        if (sx !== 1 || sy !== 1) tf += `translate(${cx} ${cy}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(${-cx} ${-cy})`;
        if (tf !== p.last) { tf ? p.el.setAttribute("transform", tf) : p.el.removeAttribute("transform"); p.last = tf; }
        const oo = o ?? p.o0;
        if (oo !== undefined) {
          const os = Math.max(0, Math.min(1, oo)).toFixed(3);
          if (os !== p.lastO) { p.el.setAttribute("opacity", os); p.lastO = os; }
        }
      }
    }
  }
}

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
// It also carries what he does while a session works -- each state's props (the thought
// bubble, the magnifier, the helpers...) and its tracks, as JSON -- for the window's own
// player (Activity.cs). Celebrating and sleeping are the window's already (Avatar.cs, Effects.cs).
const TRAY_STATES = ["thinking", "reading", "writing", "running", "delegating", "needs", "oops"];
const BAKE_SKIP = /^(Bub\d|Front)$/;
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
  for (const n of svg.querySelectorAll([".mouth", ".numtag", ".badge", ".prog", ...TRAY_STATES.map(st => ".p-" + st)].join(", "))) n.style.display = "inline";
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
  const shape = (node, cs, tf, op) => {
    const geo = GEOMETRY.filter(k => node.hasAttribute(k)).map(k => `${k}="${xmlAttr(node.getAttribute(k))}"`);
    return `<${node.tagName} ${[...geo, ...paint(node, cs), ...(tf ? [`transform="${xmlAttr(tf)}"`] : []), ...(op !== 1 ? [`opacity="${n(op)}"`] : [])].join(" ")}/>`;
  };
  // a line of text (the "?" in the question bubble): where its middle and baseline are, how big, what colour
  const text = (node, cs, op) => `<text at="${node.getAttribute("x")},${node.getAttribute("y")}" size="${parseFloat(cs.fontSize) || 12}" fill="${rgba(cs.fill)}"${op !== 1 ? ` opacity="${n(op)}"` : ""}>${xmlAttr(node.textContent)}</text>`;
  // One element and what is under it, as the tray app's description has it.
  function walk(node, depth, inNumber) {
    if (!(node instanceof SVGElement) || !shown(node)) return;
    const tag = node.tagName, cs = getComputedStyle(node), p = node.dataset.p || "";
    if (BAKE_SKIP.test(p)) return;
    const prop = [...node.classList].find(c => /^p-/.test(c));
    if (node.classList.contains("prop") && !(prop && TRAY_STATES.includes(prop.slice(2)))) return;
    const op = +cs.opacity, tf = transformOf(node, cs);
    if (SHAPES.has(tag) || tag === "text") {
      if (tag === "text" && inNumber) return; // (the project number: the window writes it)
      const one = tag === "text" ? text(node, cs, p ? 1 : op) : shape(node, cs, tf, p ? 1 : op);
      // a moving part that is one shape (a dot, a caret, the antenna's glow) gets a group to move it by, with its opacity
      out.push(p ? `<g p="${p}" c="${node.dataset.c || "0,0"}"${op !== 1 ? ` opacity="${n(op)}"` : ""}>${one}</g>` : one);
      return;
    }
    if (tag !== "g") return;
    const common = [];
    if (tf) common.push(`transform="${xmlAttr(tf)}"`);
    if (op !== 1) common.push(`opacity="${n(op)}"`);
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
    else if (node.classList.contains("prop")) { open = `<prop states="${prop.slice(2)}"`; close = "</prop>"; }
    else if (node.classList.contains("prog")) { open = `<prop states="${WORKING.join(" ")}"`; close = "</prop>"; }
    else if (["Root", "LegL", "LegR", "Body", "Back"].includes(p) && depth <= 2) { open = `<part name="${p}" c="${node.dataset.c || "0,0"}"`; close = "</part>"; }
    else if (p) open = `<g p="${p}" c="${node.dataset.c || "0,0"}"`;
    else open = "<g";
    out.push(`${open}${common.length ? " " + common.join(" ") : ""}>`);
    for (const k of node.children) walk(k, depth + 1, inNumber || node.classList.contains("numtag"));
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
  const motion = JSON.stringify(motionFor(d));
  return `<tatty av="${d.id}" outfit="${xmlAttr(dressClass(outfit))}">${out.join("")}<defs>${defs}</defs><motion><![CDATA[${motion}]]></motion></tatty>`;
}

// Each state the tray app plays, as data: its loop, mouth and lids, and its tracks (a part's
// "x", "y", "a", "s", "sx", "sy" or "o"; frames of [value, seconds], or lin/tri with a phase).
// A question's state keeps still (the window hops once when one arrives), and the
// accessories' own motion is the window's (AvatarArt.Idle).
function motionFor(d) {
  const out = {};
  for (const id of TRAY_STATES) {
    const st = STATES[id](d);
    const tracks = st.tracks.concat(d.extra ? d.extra(id, st) : [])
      .filter(t => !(id === "needs" && t.p.startsWith("Root.")) && !/^(Cf|Z)\d/.test(t.p));
    out[id] = { dur: st.dur, mouth: st.mouth, lids: st.lids ?? null,
      tracks: tracks.map(t => ({ p: t.p, f: t.f || null, lin: t.lin || null, tri: t.tri || null, ph: t.ph || 0, dur: t.dur || 0 })) };
  }
  return out;
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
