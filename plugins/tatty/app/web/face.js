// Tatty's face: the avatar chosen in the shop (and what he wears), in the circle at the left
// of the top bars. The circle is index.html's #tatty-face and style.css sizes it to the
// bars; this draws the head in it and keeps it up to date. If there is no avatar to draw
// (the drawing code or the wallet did not load), the circle stays empty.
"use strict";

(() => {
  const face = document.getElementById("tatty-face");
  if (!face || !window.TattyAvatar) return;

  const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)");
  let shown = "";

  function draw(avatar, outfit) {
    if (!avatar) return;
    const key = avatar + "|" + JSON.stringify(outfit || {});
    if (key === shown) return;
    shown = key;
    face.innerHTML = TattyAvatar.svg(avatar, { scale: 1, box: "icon", outfit });
    const svg = face.querySelector("svg");
    if (!svg) return;
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    if (!(still && still.matches)) TattyAvatar.animate([svg], avatar, "idle");
  }

  async function load() {
    try {
      const w = await api("/api/wallet");
      if (w) draw(w.avatar, w.outfit);
    } catch { /* no face is no loss; the next wallet event tries again */ }
  }

  document.addEventListener("tt-event", e => {
    const ev = e.detail;
    if (ev && ev.type === "wallet") {
      if (ev.avatar) draw(ev.avatar, ev.outfit);
      else load();
    }
  });
  load();
})();
