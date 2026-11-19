// Tatty's light/dark button, beside the gear (and the purse) in the header.
//
// theme.css has the palettes. Windows' setting picks one until the person
// chooses: a click on the button, or Settings' "Theme", sets data-theme="light"
// or "dark" on <html>, which beats the media query. The choice is kept by the
// server (settings.json, key `theme`), so the tray app's window and a browser tab
// agree; localStorage holds a copy that theme-init.js applies before first paint.
// "" (Match Windows) removes the attribute again.
//
// Uses app.js's el and api. Loaded after wallet.js, so the order is purse, this
// button, gear.
"use strict";

(() => {
  const root = document.documentElement;
  const windowsDark = window.matchMedia("(prefers-color-scheme: dark)");
  let choice = root.dataset.theme || ""; // "light" | "dark" | "" (follow Windows)
  let touched = false; // the person chose before the server's answer came

  const effective = () => choice || (windowsDark.matches ? "dark" : "light");

  const button = el("button", { type: "button", id: "theme-toggle", class: "themebtn" });
  function paint() {
    const now = effective(), next = now === "dark" ? "light" : "dark";
    root.dataset.shade = now; // which of a look's two palettes shows (looks.css)
    button.textContent = now === "dark" ? "☀" : "☾"; // the sun to go to light, the moon to go to dark
    button.title = `Switch to ${next} mode`;
    button.setAttribute("aria-label", `Switch to ${next} mode`);
  }

  function apply(value) {
    choice = value === "light" || value === "dark" ? value : "";
    if (choice) root.dataset.theme = choice; else root.removeAttribute("data-theme");
    try {
      if (choice) localStorage.setItem("tattyTheme", choice); else localStorage.removeItem("tattyTheme");
    } catch (e) { /* storage is blocked: only the copy is lost */ }
    paint();
    document.dispatchEvent(new CustomEvent("tt-theme", { detail: choice }));
  }

  // Apply, and keep it. Returns the settings the server answered with. A choice made here
  // is the person's own, so it also ends any mode a worn look moved them to (themeBase).
  let base = "none"; // the person's own choice while a look's mode is on: "none" (no look's), "", "light" or "dark"
  async function set(value, keepBase) {
    touched = true;
    apply(value);
    if (!keepBase) base = "none";
    try { return await api("/api/settings", { theme: choice, themeBase: base }); } catch (e) { return null; }
  }

  // A look was worn: move to its own mode (mode "dark" or "light"), remembering the person's
  // own choice the first time; a look with no mode gives that choice back.
  function forLook(mode) {
    if (mode === "dark" || mode === "light") {
      if (base === "none") base = choice;
      return set(mode, true);
    }
    if (base === "none") return Promise.resolve(null);
    const back = base;
    base = "none";
    return set(back, true);
  }

  button.addEventListener("click", () => set(effective() === "dark" ? "light" : "dark"));
  windowsDark.addEventListener("change", paint);

  const gear = document.getElementById("settings-link");
  if (gear) gear.parentElement.insertBefore(button, gear);
  paint();

  // The server's word is the truth (another window may have changed it).
  api("/api/settings").then(s => { if (typeof s.themeBase === "string") base = s.themeBase; if (!touched && typeof s.theme === "string") apply(s.theme); }).catch(() => {});

  window.TattyTheme = { set, effective, forLook };
})();
