// Tatty's page sounds: the coins landing in the purse and the shop's whole repertoire.
// Like the tray app's Sounds.cs they are worked out rather than shipped: each is a few
// tones and a little filtered noise, played through Web Audio. A browser plays nothing
// until the page has been clicked or typed in, so the first sounds of a fresh page
// (coins earned before anyone has touched it) are quietly skipped. The person can turn
// them all off (the shop's Sound switch, kept in localStorage as tt-sound).
// window.TattySfx: play(name, ...args), on(), set(on).
"use strict";

(() => {
  const KEY = "tt-sound";
  let ctx = null, out = null, noiseBuf = null;

  const enabled = () => localStorage.getItem(KEY) !== "off";

  // The audio graph, made on first use: everything goes through one gentle compressor,
  // so a shower of coins clinks rather than clips.
  function audio() {
    if (!enabled()) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 6;
      out = ctx.createGain();
      out.gain.value = 0.55;
      out.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") { ctx.resume().catch(() => {}); return null; }
    return ctx.state === "running" ? ctx : null;
  }
  // The first click anywhere wakes the audio, so it is ready when something is earned.
  for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, () => audio(), { capture: true, passive: true });

  // One note: a quick attack, an exponential fall. glide: the frequency it slides to.
  function tone(c, freq, at, dur, { type = "sine", gain = 0.2, glide = 0, attack = 0.004 } = {}) {
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur * 0.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  // A breath of noise through a band-pass filter that can sweep: swishes, shimmers, drawers.
  function hiss(c, at, dur, { gain = 0.1, from = 2000, to = 0, q = 1.2, type = "bandpass" } = {}) {
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + at;
    s.buffer = noiseBuf;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }
  const semis = (f, n) => f * Math.pow(2, n / 12);

  const SOUNDS = {
    // the classic coin: two bright notes, a fourth apart; i raises it a little each time,
    // so a stream of coins climbs
    coin(c, i = 0) {
      const base = semis(988, (i % 8) * 0.5);
      tone(c, base, 0, 0.07, { type: "square", gain: 0.05 });
      tone(c, semis(base, 5), 0.06, 0.28, { type: "square", gain: 0.045 });
      tone(c, semis(base, 17), 0.06, 0.2, { gain: 0.05 });
    },
    // a coin landing among the others in the purse
    clink(c, i = 0) {
      const f = semis(2093, (i % 6) * 1.5 + Math.random());
      tone(c, f, 0, 0.12, { gain: 0.09 });
      tone(c, f * 1.5, 0.004, 0.09, { gain: 0.05 });
      hiss(c, 0, 0.03, { gain: 0.05, from: 6000, type: "highpass" });
    },
    // the till: a drawer, a bell and a spill of coins
    kaching(c) {
      hiss(c, 0, 0.08, { gain: 0.14, from: 1800, to: 900, q: 2 });
      tone(c, 196, 0, 0.09, { type: "triangle", gain: 0.12 });
      for (const [f, at] of [[1568, 0.07], [2349, 0.07], [3136, 0.09]]) tone(c, f, at, 0.7, { gain: 0.07 });
      for (let i = 0; i < 7; i++) {
        const at = 0.12 + i * 0.045 + Math.random() * 0.02, f = semis(2093, (i * 3) % 10 + Math.random());
        tone(c, f, at, 0.1, { gain: 0.06 }); tone(c, f * 1.5, at + 0.004, 0.07, { gain: 0.03 });
      }
    },
    // something unlocked: a rising arpeggio and a sparkle over it
    unlock(c) {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, f, i * 0.07, 0.35, { type: "triangle", gain: 0.11 }));
      hiss(c, 0.3, 0.6, { gain: 0.05, from: 5000, to: 9000, type: "highpass" });
      for (let i = 0; i < 5; i++) tone(c, semis(2093, Math.random() * 12), 0.35 + i * 0.06, 0.15, { gain: 0.035 });
    },
    // put on: a swish up and a pop
    equip(c) {
      hiss(c, 0, 0.2, { gain: 0.12, from: 500, to: 3500, q: 3 });
      tone(c, 660, 0.12, 0.09, { glide: 990, gain: 0.12 });
    },
    // taken off: the swish down
    unequip(c) {
      hiss(c, 0, 0.2, { gain: 0.1, from: 3500, to: 500, q: 3 });
      tone(c, 880, 0.1, 0.09, { glide: 520, gain: 0.08 });
    },
    // can't: a soft double bonk
    denied(c) {
      tone(c, 233, 0, 0.12, { type: "square", gain: 0.06, glide: 207 });
      tone(c, 175, 0.14, 0.18, { type: "square", gain: 0.06, glide: 155 });
    },
    // the lightest tick, for a hand passing over a shelf
    hover(c) { tone(c, 2400 + Math.random() * 300, 0, 0.035, { gain: 0.02 }); },
    // a bubble pop: trying something on
    tryon(c) { tone(c, 520, 0, 0.07, { glide: 980, gain: 0.07 }); },
    // a pluck, for a tab
    tab(c) { tone(c, 880, 0, 0.12, { type: "triangle", gain: 0.1, glide: 660 }); },
    // the shop's door: ding-dong
    open(c) {
      tone(c, 1319, 0, 0.5, { gain: 0.09 }); tone(c, 2637, 0, 0.3, { gain: 0.03 });
      tone(c, 1047, 0.22, 0.7, { gain: 0.09 }); tone(c, 2093, 0.22, 0.4, { gain: 0.03 });
    },
    // a little fanfare for a big earning
    fanfare(c) {
      [[784, 0], [988, 0.1], [1175, 0.2], [1568, 0.32]].forEach(([f, at]) => tone(c, f, at, 0.4, { type: "triangle", gain: 0.1 }));
    },
  };

  window.TattySfx = {
    play(name, ...args) {
      const c = audio();
      if (!c || !SOUNDS[name]) return;
      try { SOUNDS[name](c, ...args); } catch { /* a sound is never worth an error */ }
    },
    on: enabled,
    set(on) { localStorage.setItem(KEY, on ? "on" : "off"); if (!on && ctx) ctx.suspend().catch(() => {}); },
  };
})();
