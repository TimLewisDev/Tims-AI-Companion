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
  const nextWord = () => (committed ? `Continue to ${g.next}` : `Continue to ${g.next} without committing`);
  let committed = !!g.committed;
  const next = el("button", { type: "button", class: "primary", id: "unit-continue" }, nextWord());
  const say = (cls, ...nodes) => note.replaceChildren(el("span", { class: cls }, ...nodes));
  commit.addEventListener("click", async () => {
    commit.disabled = next.disabled = true;
    say("dim small", "Committing…");
    try {
      const r = await api("/api/unit-commit", { name: f.name });
      featureCache.delete(f.name);
      commit.textContent = "Commit more work";
      committed = true;
      next.textContent = nextWord();
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

// ---- the break the workflow waits at (the server's "breaks the workflow waits at")
// Where a toolbox skill would stop and ask "continue, or stop here?" it records the wait and ends its turn;
// the Overview's gate shows Continue / Skip / Stop and this sends the answer. The running session is told to
// read it; with none open, Continue and Skip start one on the next step.
async function gateAnswer(f, choice, buttons) {
  for (const b of buttons) b.disabled = true;
  tell("allow-foreground");
  try {
    const r = await api("/api/gate", { name: f.name, choice });
    featureCache.delete(f.name);
    const s = r.started;
    if (s && s.ok) {
      sessionInfo.set(s.tag, { tag: s.tag, feature: f.name, name: s.name, command: s.command, project: s.project, started: Date.now() / 1000, status: "starting" });
      location.hash = "#workflows/" + encodeURIComponent(s.tag);
      return;
    }
    route();
  } catch (e) {
    alert(e.message || e);
    for (const b of buttons) b.disabled = b.id === "gate-skip" && b.title !== "" ? true : false;
  }
}

// A break was recorded (or answered) for a feature: draw its page again if it is the one open.
function gateSeen(ev) {
  if (!ev.feature) return;
  featureCache.delete(ev.feature);
  if (pageEls.feature.classList.contains("on") && featureView && featureView.name === ev.feature) refreshFeature(ev.feature);
}
