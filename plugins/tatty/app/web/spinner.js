// The one loading spinner. makeSpinner({size, label, avatar}) gives a node to put anywhere something is
// being read: a ring that orbits the user's own avatar, a soft breathing pulse, and now and then a glance
// and a spark. Sizes: "sm" (inline, a ring only), "md" and "lg" (the avatar inside the ring).
//
//   const s = makeSpinner({ size: "lg", label: "Opening merge request…" });
//   box.replaceChildren(s.node);      // it appears after a short delay, so a quick read doesn't flash
//   s.destroy();                      // when the content is there (replaceChildren also drops it)
//
// The avatar and the wallet are looked up when the spinner is made, not when this file loads (avatar.js
// comes after some callers), and a spinner without them is the ring alone. Motion follows the shop's Motion
// switch (TattyWallet.motion): off gives a still ring with a slow fade, so it still says "working".
(function () {
  const SHOW_AFTER = 150;    // ms before it is shown at all (options.delay overrides it)
  const LABEL_AFTER = 400;   // ms before the words come in
  const BEAT = 3600;         // ms between glances

  let wallet = null;         // {avatar, outfit}, read once
  let walletAsk = null;
  function readWallet() {
    if (wallet) return Promise.resolve(wallet);
    if (!walletAsk) {
      walletAsk = (typeof api === "function" ? api("/api/wallet") : Promise.resolve(null))
        .then(w => { if (w && w.avatar) wallet = { avatar: w.avatar, outfit: w.outfit }; return wallet; })
        .catch(() => null);
      walletAsk.then(w => { if (!w) walletAsk = null; });   // a failed read is tried again by the next spinner
    }
    return walletAsk;
  }
  document.addEventListener("tt-event", e => {
    const ev = e.detail;
    if (ev && ev.type === "wallet" && ev.avatar) wallet = { avatar: ev.avatar, outfit: ev.outfit };
  });

  const motionOn = () => !window.TattyWallet || TattyWallet.motion();

  function makeSpinner(o) {
    o = o || {};
    const size = ["sm", "md", "lg"].includes(o.size) ? o.size : "md";
    const wantAvatar = o.avatar !== false && size !== "sm";
    const still = !motionOn();
    const face = document.createElement("span");
    face.className = "sp-face";
    const ring = document.createElement("span");
    ring.className = "sp-ring";
    const spark = document.createElement("span");
    spark.className = "sp-spark";
    const disc = document.createElement("span");
    disc.className = "sp-disc";
    disc.append(ring, spark, face);
    const node = document.createElement("div");
    node.className = "sp sp-" + size + (still ? " still" : "");
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.hidden = true;
    node.append(disc);
    let words = null;
    if (o.label) {
      words = document.createElement("span");
      words.className = "sp-label";
      words.append(document.createTextNode(o.label));
      for (let i = 0; i < 3; i++) { const d = document.createElement("i"); d.className = "sp-dot"; words.append(d); }
      node.append(words);
    } else {
      node.setAttribute("aria-label", "Loading");
    }

    let card = null, beat = 0, shown = 0, wordsAt = 0, dead = false;
    const timers = () => { clearTimeout(shown); clearTimeout(wordsAt); clearInterval(beat); beat = 0; };

    function dress(w) {
      if (dead || !w || !wantAvatar || typeof TattyAvatar === "undefined" || card) return;
      face.innerHTML = TattyAvatar.svg(w.avatar, { scale: 1, box: "icon", outfit: w.outfit });
      const svg = face.querySelector("svg");
      if (!svg) return;
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
      node.classList.add("has-face");
      if (!still) {
        card = TattyAvatar.animate([svg], w.avatar, "thinking");
        beat = setInterval(() => {
          if (!node.isConnected) return;
          spark.classList.remove("on");
          void spark.offsetWidth;   // restart the spark
          spark.classList.add("on");
          try { card && card.play("glance", 1.2, "thinking"); } catch { /* an avatar without it just keeps thinking */ }
        }, BEAT);
      }
    }

    function show() {
      if (dead) return;
      clearTimeout(shown);
      shown = setTimeout(() => {
        node.hidden = false;
        readWallet().then(dress);
        if (words) wordsAt = setTimeout(() => words.classList.add("on"), LABEL_AFTER);
      }, o.delay == null ? SHOW_AFTER : o.delay);
    }
    function hide() { timers(); node.hidden = true; }
    function destroy() { dead = true; timers(); card = null; node.remove(); }

    show();
    return { node, show, hide, destroy, setLabel(t) { if (words && words.firstChild) words.firstChild.nodeValue = t; } };
  }

  // A centred, roomy spinner for an empty page frame.
  function spinnerWait(label, size) {
    const s = makeSpinner({ size: size || "lg", label: label || "Loading" });
    const w = document.createElement("div");
    w.className = "sp-wait" + (size ? " compact" : "");
    w.append(s.node);
    w.spinner = s;
    return w;
  }

  // A small ring in a span of the caller's class (a button's "working", a switch's "asking"): at once, no delay.
  function spinnerMark(cls) {
    const w = document.createElement("span");
    w.className = cls;
    w.setAttribute("aria-hidden", "true");
    w.append(makeSpinner({ size: "sm", delay: 0 }).node);
    return w;
  }

  window.makeSpinner = makeSpinner;
  window.spinnerMark = spinnerMark;
  window.spinnerWait = spinnerWait;
  window.TattySpinner = { make: makeSpinner, wait: spinnerWait };
})();
