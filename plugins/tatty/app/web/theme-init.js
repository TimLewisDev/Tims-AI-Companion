// Runs in <head>, before the first paint, so a person who chose light or dark
// doesn't see the other for a moment. localStorage is only a copy of the choice
// (the server's settings.json holds it; theme.js reads that and keeps this in
// step). No choice here means the page follows Windows, as theme.css says.
"use strict";
(function () {
  try {
    const t = localStorage.getItem("tattyTheme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  } catch (e) { /* storage is blocked: the server's answer applies it a moment later */ }
})();
