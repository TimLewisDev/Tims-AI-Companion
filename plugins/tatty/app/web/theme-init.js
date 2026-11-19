// Runs in <head>, before the first paint, so a person who chose light or dark
// doesn't see the other for a moment. localStorage is only a copy of the choice
// (the server's settings.json holds it; theme.js reads that and keeps this in
// step). No choice here means the page follows Windows, as theme.css says.
//
// It also puts on the look (the theme bought in the shop, looks.js) from its copy, and says
// which shade shows as data-shade="light|dark", which looks.css's palettes are keyed on
// (theme.js keeps it up to date as the choice or Windows' setting changes).
"use strict";
(function () {
  const root = document.documentElement;
  let t = "";
  try {
    t = localStorage.getItem("tattyTheme") || "";
    if (t === "light" || t === "dark") root.dataset.theme = t;
    const look = localStorage.getItem("tattyLook");
    if (look && /^[a-z]{2,12}$/.test(look) && look !== "minimal") root.dataset.look = look;
  } catch (e) { /* storage is blocked: the server's answer applies it a moment later */ }
  const dark = t === "dark" || (t !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.shade = dark ? "dark" : "light";
})();
