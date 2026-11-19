// The break after a validated work unit (the server's "the break after a validated work unit").
// When the workflow has marked a unit Done and another unit follows, a card in "Where it stands" says so
// and offers two buttons: Commit work (one click: the files the workflow's task results name, nothing
// else, never a push) and Continue to the next unit (always a new session). The Continue button closes
// the card; Commit does not, so the unit can be committed before moving on or not at all.

function unitGateCard(f) {
  const g = f.unitGate;
  if (!g) return "";
  const note = el("p", { class: "small", id: "unit-gate-note", role: "status" },
    g.committed ? el("span", {}, "Committed as ", el("code", {}, g.committed), ". Nothing was pushed.") : "");
  const commit = el("button", { type: "button", id: "unit-commit" }, g.committed ? "Commit more work" : "Commit work");
  const next = el("button", { type: "button", class: "primary", id: "unit-continue" }, `Continue to ${g.next}`);
  const say = (cls, ...nodes) => note.replaceChildren(el("span", { class: cls }, ...nodes));
  commit.addEventListener("click", async () => {
    commit.disabled = next.disabled = true;
    say("dim small", "Committing…");
    try {
      const r = await api("/api/unit-commit", { name: f.name });
      featureCache.delete(f.name);
      commit.textContent = "Commit more work";
      say("", "Committed ", el("code", {}, r.commit), ` ${r.subject}. ${r.files} file${r.files === 1 ? "" : "s"}; nothing was pushed.` +
        (r.others ? ` ${r.others} other changed file${r.others === 1 ? " was" : "s were"} left uncommitted.` : ""));
    } catch (e) { say("st missing commit-error", String(e.message || e)); }
    commit.disabled = next.disabled = false;
  });
  next.addEventListener("click", async () => {
    commit.disabled = next.disabled = true;
    say("dim small", "Opening a new session…");
    tell("allow-foreground");
    try {
      const r = await api("/api/unit-continue", { name: f.name });
      featureCache.delete(f.name);
      if (r.ok) {
        sessionInfo.set(r.tag, { tag: r.tag, feature: f.name, name: r.name, command: r.command, project: r.project,
          started: Date.now() / 1000, status: "starting" });
        location.hash = "#workflows/" + encodeURIComponent(r.tag);
        return;
      }
      say("st missing", "Couldn't open a terminal here. Run this yourself: ", el("code", {}, r.said || ""));
    } catch (e) { say("st missing", String(e.message || e)); }
    commit.disabled = next.disabled = false;
  });
  return el("div", { class: "stand primary unit-gate", id: "unit-gate", "data-unit": g.unit },
    el("p", {}, el("strong", {}, `Work unit ${g.unit} is validated`), g.outcome ? ` (${g.outcome})` : "",
      `. Commit it now if you like, then carry on with ${g.next}.`),
    el("div", { class: "start-actions" }, commit, next), note);
}
