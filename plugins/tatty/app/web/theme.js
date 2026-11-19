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

  // Apply, and keep it. Returns the settings the server answered with.
  async function set(value) {
    touched = true;
    apply(value);
    try { return await api("/api/settings", { theme: choice }); } catch (e) { return null; }
  }

  button.addEventListener("click", () => set(effective() === "dark" ? "light" : "dark"));
  windowsDark.addEventListener("change", paint);

  const gear = document.getElementById("settings-link");
  if (gear) gear.parentElement.insertBefore(button, gear);
  paint();

  // The server's word is the truth (another window may have changed it).
  api("/api/settings").then(s => { if (!touched && typeof s.theme === "string") apply(s.theme); }).catch(() => {});

  window.TattyTheme = { set, effective };
})();
