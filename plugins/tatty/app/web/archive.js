// Archiving and deleting a feature (the server's "archiving and deleting a feature").
// A feature's page has one split button: Archive (moves it to <root>/archive, and the
// Features page lists it under Archived, where Restore brings it back) with Delete… behind
// its caret. Delete removes the folder for good, the real one when the feature is a link
// into a vault, so it asks first and wants the feature's name typed.

// What leaves with a feature, wherever it was open.
function featureGone(name) {
  featureCache.delete(name);
  loadTabsSoon();
  for (const t of paneTabs.filter(t => t.feature === name)) dropPaneTab(t.key); // split.js
}

async function archiveFeature(f) {
  try {
    const r = await api("/api/feature/archive", { name: f.name });
    if (r.said) alert(r.said);
    featureGone(f.name);
    note(`Archived ${f.name}. Restore it from Archived, below the features.`);
    if (location.hash === "#home") renderHome(true); else location.hash = "#home";
  } catch (e) { alert(e.message || e); }
}

const bytesText = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// The side panel that asks before a feature is deleted. archived: it is one of the archived ones.
function deleteFeaturePanel(name, archived) {
  openSidePanel(`Delete ${name}`, msg => {
    const facts = el("div", { class: "del-facts small" }, el("p", { class: "dim" }, "Looking at what is in it…"));
    const typed = el("input", { id: "delete-confirm", placeholder: name, "aria-label": `Type ${name} to confirm`, autocomplete: "off" });
    const go = el("button", { type: "button", class: "danger", id: "delete-go" }, "Delete forever");
    go.disabled = true;
    let ready = false;
    const check = () => { go.disabled = !(ready && typed.value === name); };
    typed.addEventListener("input", check);
    api(`/api/feature/delete-preview?name=${encodeURIComponent(name)}&archived=${archived ? 1 : 0}`).then(p => {
      ready = !p.refused;
      facts.replaceChildren(
        el("p", {}, "This permanently deletes the feature's folder and everything in it: ",
          el("strong", {}, `${p.files} file${p.files === 1 ? "" : "s"} (${bytesText(p.bytes)})`), "."),
        el("p", {}, el("code", {}, p.path)),
        p.link ? el("p", { class: "st missing" }, "It is a link into another folder (your vault, say): the real folder above is deleted, not just the link.") : "",
        p.sessions ? el("p", {}, "Its running Claude session is ended first.") : "",
        p.task ? el("p", {}, "The task it was started from goes back to where it was.") : "",
        p.refused ? el("p", { class: "st missing" }, `Tatty won't delete it: ${p.refused}.`) : el("p", { class: "dim" }, "There is no undo."));
      check();
    }).catch(e => { facts.replaceChildren(el("p", { class: "st missing" }, String(e.message || e))); });
    go.addEventListener("click", async () => {
      go.disabled = true;
      try {
        const r = await api("/api/feature/delete", { name, archived: !!archived, confirm: typed.value });
        closeSidePanel();
        featureGone(name);
        if (r.said) alert(r.said);
        note(`Deleted ${name} (${r.removed} file${r.removed === 1 ? "" : "s"}).`);
        if (location.hash === "#home") renderHome(true); else location.hash = "#home";
      } catch (e) {
        msg.className = "home-note small st missing";
        msg.textContent = String(e.message || e);
        check();
      }
    });
    return el("div", { class: "del-panel" }, facts,
      el("label", { class: "small" }, `Type ${name} to confirm`, typed),
      el("div", { class: "del-acts" }, go, el("button", { type: "button", onclick: closeSidePanel }, "Keep it")));
  });
}

// The split button: Archive, and a caret for Delete…. The menu is split.js's (Esc, arrows,
// a click away and a scroll close it); a click on the caret that closed it doesn't reopen it.
function archiveCombo(f) {
  const caret = el("button", { type: "button", class: "primary splitbtn-caret", id: "feature-archive-more",
    "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "More ways to remove this feature", title: "More…" }, "▾");
  let closedAt = 0;
  const closed = () => { caret.setAttribute("aria-expanded", "false"); closedAt = Date.now(); };
  caret.addEventListener("click", () => {
    if (Date.now() - closedAt < 250) return;
    const r = caret.getBoundingClientRect();
    caret.setAttribute("aria-expanded", "true");
    showMenu(r.right - 190, r.bottom + 4, [
      { label: "Delete…", ok: true, danger: true, title: "Permanently delete the feature and its folder",
        run: () => { caret.setAttribute("aria-expanded", "false"); deleteFeaturePanel(f.name, false); } },
    ], "Remove this feature", "", closed); // split.js
  });
  return el("span", { class: "splitbtn" },
    el("button", { type: "button", class: "primary", id: "feature-archive", title: "Move it to Archived. Restore brings it back.",
      onclick: () => archiveFeature(f) }, "Archive"),
    caret);
}

// The Archived section under the features on the Features page.
let archivedOpen = false;
async function restoreFeature(name) {
  try {
    await api("/api/feature/restore", { name });
    note(`Restored ${name}.`);
  } catch (e) { note(String(e.message || e), true); return; }
  renderHome(true);
}

function archivedSection(list) {
  if (!list || !list.length) return "";
  const d = el("details", { class: "card archived", id: "archived-section" },
    el("summary", {}, el("strong", {}, `Archived (${list.length})`), el("span", { class: "dim small" }, "kept, not shown above")),
    el("div", { class: "arows" }, list.map(a => el("div", { class: "arow", "data-name": a.name },
      el("strong", {}, a.name),
      el("span", { class: "dim small" }, `archived ${ago(a.archivedAt)} · ${a.docs} document${a.docs === 1 ? "" : "s"}`),
      el("span", { class: "arow-acts" },
        el("button", { type: "button", class: "restore-btn", onclick: () => restoreFeature(a.name) }, "Restore"),
        el("button", { type: "button", class: "delete-btn", onclick: () => deleteFeaturePanel(a.name, true) }, "Delete…"))))));
  d.open = archivedOpen;
  d.addEventListener("toggle", () => { archivedOpen = d.open; });
  return d;
}
