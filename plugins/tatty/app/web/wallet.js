// Tatty's purse: the coins he has, beside the gear in the header, and a click away from
// the shop (#shop, shop.js). When the server pays a reward (a "coins" event: server.py's
// reward()) the coins fly into it from where it happened -- where the person just
// clicked, for a decision; the middle of the page, for a milestone -- each one clinking
// as it lands, the count rolling up, and a "+N" rising off the purse. Only news is
// celebrated: the events the stream replays when the page connects are old.
// The flying is Web Animations, which the page's CSP allows (it refuses style
// attributes, not the CSSOM). The person can turn the motion off (the shop's Motion
// switch, kept in localStorage as tt-juice): the count then just changes, and the
// sounds (sfx.js) still play unless they are off too.
// window.TattyWallet: sync(coins), earn(event), spend(amount, balance, toNode, fromNode),
// onChange(fn), coins(), motion(), setMotion(on), burst(point, n), say(text, point, cls), COIN.
// Uses app.js's el and pageOpened, and sfx.js's TattySfx.
"use strict";

(() => {
  const JUICE = "tt-juice";
  const motion = () => localStorage.getItem(JUICE) !== "off";

  const COIN = `<svg class="coin-ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#F2C94C" stroke="#C9A227" stroke-width="1.6"/>
    <circle cx="10" cy="10" r="6.2" fill="none" stroke="#E0A800" stroke-width="1"/>
    <text x="10" y="13.5" text-anchor="middle" font-size="9.5" font-weight="800" fill="#A87A12" font-family="Segoe UI, sans-serif">T</text>
    <path d="M5.4,6.6 a6,6 0 0 1 4,-2.6" stroke="#fff" stroke-opacity=".75" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;
  const PURSE = `<svg class="purse-ico" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="19.5" cy="8" r="4.4" fill="#F2C94C" stroke="#C9A227" stroke-width="1"/>
    <path d="M12,9.5 C13,7 19,7 21,9.5 L20.5,11.5 L11.5,11.5 Z" fill="#C98A2B"/>
    <path d="M10.5,11.5 C3,15 3.5,28.5 16,28.5 C28.5,28.5 29,15 21.5,11.5 Z" fill="#E6AE4C" stroke="#B7791F" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M9,17 C10,13.5 12,12.6 13,12.4" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>
    <path class="tie" d="M10.5,12 Q16,14.6 21.5,12" fill="none" stroke-width="2.2" stroke-linecap="round"/>
    <circle class="knot" cx="16" cy="13.4" r="1.9"/>
    <circle cx="16" cy="21.5" r="4.2" fill="#F2C94C" stroke="#B7791F" stroke-width="1"/>
    <text x="16" y="24" text-anchor="middle" font-size="6.5" font-weight="800" fill="#8A5A12" font-family="Segoe UI, sans-serif">T</text></svg>`;

  const gear = document.getElementById("settings-link");
  const link = el("a", { href: "#shop", id: "wallet-link", class: "purse", title: "Your Tatty coins: open the shop", "aria-label": "Tatty coins: open the shop" });
  link.innerHTML = PURSE + '<span class="purse-count">…</span>';
  if (gear) gear.parentElement.insertBefore(link, gear);
  const countEl = link.querySelector(".purse-count"), ico = link.querySelector(".purse-ico");

  // ---------------------------------------------------------------- the count
  let shown = null, target = null, rolling = 0, flights = 0;
  const listeners = new Set();
  function draw(n) {
    countEl.textContent = n.toLocaleString();
    for (const f of listeners) { try { f(n); } catch { /* a listener's page went away */ } }
  }
  // Roll the number to n (a quick count, not a jump), or set it outright with the motion off.
  function rollTo(n, ms = 600) {
    target = n;
    if (shown === null || !motion() || shown === n) { shown = n; draw(n); return; }
    const from = shown, t0 = performance.now(), id = ++rolling;
    const step = t => {
      if (id !== rolling) return;
      const u = Math.min(1, (t - t0) / ms);
      shown = Math.round(from + (n - from) * (1 - Math.pow(1 - u, 3)));
      draw(shown);
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- flying things
  const onScreen = n => !!n && n.isConnected && n.getClientRects().length > 0;
  const centre = n => { const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  let lastPointer = null;
  document.addEventListener("pointerdown", e => { lastPointer = { x: e.clientX, y: e.clientY, at: Date.now() }; }, true);

  function layer() {
    let l = document.getElementById("coin-layer");
    if (!l) { l = el("div", { id: "coin-layer", "aria-hidden": "true" }); document.body.append(l); }
    return l;
  }
  const place = (node, p) => { node.style.left = p.x + "px"; node.style.top = p.y + "px"; };

  // count coins from one point to another: out in a spray, then each curving home;
  // land(i, count) as each arrives
  function fly(count, from, to, land, { scatter = 90, lift = 60 } = {}) {
    const L = layer();
    flights++;
    let landed = 0;
    for (let i = 0; i < count; i++) {
      const c = el("div", { class: "fly-coin" });
      c.innerHTML = COIN;
      place(c, from);
      L.append(c);
      const sx = (Math.random() * 2 - 1) * scatter, sy = -20 - Math.random() * lift;
      const dx = to.x - from.x, dy = to.y - from.y;
      const a = c.animate([
        { transform: "translate(-50%, -50%) scale(.3)", opacity: 0 },
        { transform: `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px)) scale(1.2)`, opacity: 1, offset: 0.3 },
        { transform: `translate(calc(-50% + ${(sx + dx) * 0.6}px), calc(-50% + ${Math.min(sy, dy) - 30}px)) scale(1)`, opacity: 1, offset: 0.62 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.5)`, opacity: 0.9 },
      ], { duration: 700 + Math.random() * 260, delay: i * 55, easing: "cubic-bezier(.4, 0, .6, 1)", fill: "backwards" });
      c.firstElementChild.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(.1)" }, { transform: "scaleX(1)" }],
        { duration: 300 + Math.random() * 150, iterations: Infinity });
      a.onfinish = () => {
        c.remove();
        land(landed++, count);
        if (landed === count) flights--;
      };
    }
  }

  function bump(big) {
    if (!motion()) return;
    ico.animate([{ transform: "scale(1) rotate(0)" }, { transform: `scale(${big ? 1.4 : 1.2}) rotate(-10deg)` },
      { transform: "scale(.92) rotate(6deg)" }, { transform: "scale(1) rotate(0)" }], { duration: big ? 420 : 260, easing: "ease-out" });
  }

  // a word that rises and fades: "+20", "Need 40 more"
  function say(text, at, cls = "") {
    const t = el("div", { class: "coin-float " + cls }, text);
    place(t, at);
    layer().append(t);
    if (!motion()) { setTimeout(() => t.remove(), 1400); return; }
    t.animate([
      { opacity: 0, transform: "translate(-50%, 0) scale(.6)" },
      { opacity: 1, transform: "translate(-50%, -14px) scale(1.12)", offset: 0.2 },
      { opacity: 1, transform: "translate(-50%, -24px) scale(1)", offset: 0.6 },
      { opacity: 0, transform: "translate(-50%, -46px) scale(1)" },
    ], { duration: 1600, easing: "ease-out" }).onfinish = () => t.remove();
  }

  // sparks flung out from a point: stars, dots and the odd tiny coin
  const SPARKS = ["#F2C94C", "#FFE27A", "#EF6F8E", "#5CC8A8", "#7AA7DA", "#B49AE6", "#FFFFFF"];
  function burst(at, n = 12, { reach = 70, size = 1 } = {}) {
    if (!motion()) return;
    const L = layer();
    for (let i = 0; i < n; i++) {
      const s = el("i", { class: "spark" + (i % 4 === 0 ? " star" : "") });
      s.style.background = SPARKS[i % SPARKS.length];
      s.style.width = s.style.height = (4 + Math.random() * 5) * size + "px";
      place(s, at);
      L.append(s);
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5, r = reach * (0.55 + Math.random() * 0.6);
      s.animate([
        { transform: "translate(-50%, -50%) scale(.4) rotate(0)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * r}px), calc(-50% + ${Math.sin(ang) * r}px)) scale(1) rotate(180deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * r * 1.15}px), calc(-50% + ${Math.sin(ang) * r * 1.15 + 18}px)) scale(.2) rotate(300deg)`, opacity: 0 },
      ], { duration: 700 + Math.random() * 400, easing: "cubic-bezier(.2, .7, .4, 1)" }).onfinish = () => s.remove();
    }
  }

  // ---------------------------------------------------------------- earning and spending
  const BY_HAND = new Set(["answer", "decision", "suggestion", "story", "debug"]);
  function earn(ev) {
    const amount = ev.amount || 0, balance = ev.balance;
    if (amount <= 0 || typeof balance !== "number") return;
    const base = balance - amount;
    if (shown === null) shown = base;
    if (!onScreen(ico) || !motion()) {
      rollTo(balance);
      TattySfx.play("coin");
      return;
    }
    const to = centre(ico);
    const recent = lastPointer && Date.now() - lastPointer.at < 6000;
    const from = BY_HAND.has(ev.kind) && recent ? { x: lastPointer.x, y: lastPointer.y } : { x: innerWidth / 2, y: innerHeight * 0.38 };
    const count = Math.max(1, Math.min(14, amount));
    TattySfx.play("coin");
    if (ev.reason) say(ev.reason, { x: from.x, y: from.y - 18 }, "why");
    fly(count, from, to, (i, total) => {
      TattySfx.play("clink", i);
      bump(i === total - 1);
      if (i < total - 1) rollTo(Math.round(base + amount * (i + 1) / total), 140);
      else {
        rollTo(balance, 220);
        say(`+${amount}`, { x: to.x, y: to.y + 14 }, "earn");
        burst(to, 10, { reach: 34, size: 0.8 });
        if (amount >= 40) TattySfx.play("fanfare");
      }
    });
  }

  function spend(amount, balance, toNode, fromNode) {
    const src = onScreen(fromNode) ? fromNode : ico;
    rollTo(balance, 700);
    if (!motion() || !onScreen(src) || !onScreen(toNode)) return;
    const count = Math.max(3, Math.min(10, Math.round(amount / 25)));
    const dest = centre(toNode); // (where it was: the shelf may be drawn again before the coins land)
    fly(count, centre(src), dest, (i, n) => {
      TattySfx.play("clink", n - i);
      if (i === n - 1) burst(dest, 18, { reach: 80 });
    }, { scatter: 50, lift: 70 });
  }

  // ---------------------------------------------------------------- the tray app's Tatty
  // In the tray app's bubble, the page tells the window what Tatty looks like now: the
  // avatar chosen in what he wears, drawn in the mode's colour as the tray app draws it
  // (avatar.js's bake; the window's AvatarArt.cs draws it). Again whenever that changes:
  // here, in another window (the status poll's `look`) or by a change of mode.
  const TRAY_ACCENT = { engineering: "#3B6EA8", design: "#A9641F", production: "#7D5BBD" };
  let look = null, sent = "";
  async function sendLook() {
    if (typeof companion === "undefined" || !companion || typeof host === "undefined" || !host || !window.TattyAvatar) return;
    let w;
    try { w = await api("/api/wallet"); } catch { return; }
    const mode = document.body.dataset.mode || "engineering";
    const key = `${w.avatar}|${JSON.stringify(w.outfit)}|${mode}`;
    if (key === sent) return;
    sent = key;
    try { tell("avatar", TattyAvatar.bake(w.avatar, w.outfit, TRAY_ACCENT[mode] || TRAY_ACCENT.engineering)); } catch { sent = ""; }
  }
  new MutationObserver(() => { if (look !== null) sendLook(); }).observe(document.body, { attributes: true, attributeFilter: ["data-mode"] });

  // ---------------------------------------------------------------- news
  document.addEventListener("tt-event", e => {
    const ev = e.detail;
    if (ev.type === "coins") {
      if (ev.ts * 1000 >= pageOpened - 5000) earn(ev);
      else if (typeof ev.balance === "number" && target === null) rollTo(ev.balance);
    } else if (ev.type === "wallet") {
      if (typeof ev.coins === "number" && !flights) rollTo(ev.coins, 500);
      if (ev.ts * 1000 >= pageOpened - 5000) sendLook();
    }
  });

  window.TattyWallet = {
    // what the server last said (the status poll): the balance, and what Tatty looks like
    sync(n, lk) {
      if (typeof n === "number" && !flights && n !== target) rollTo(n);
      if (typeof lk === "string" && lk !== look) { look = lk; sendLook(); }
    },
    earn, spend, burst, say, COIN,
    coins: () => (target === null ? 0 : target),
    onChange(f) { listeners.add(f); if (shown !== null) f(shown); return () => listeners.delete(f); },
    motion,
    setMotion(on) { localStorage.setItem(JUICE, on ? "on" : "off"); },
  };
})();
