// The Review page (#feature/<name>/review): the suggestions a branch review left, put to the person one at a
// time, each with its options. Every answer is saved into the Review Suggestions document as it is given
// (the server's review_decide), so the page can be left and come back to. With the last answer the server
// starts the session that makes the changes, and the page goes to its tab.

const featureReviewHref = name => "#feature/" + encodeURIComponent(name) + "/review";
const SEV_CHIP = { critical: "bad", major: "now", minor: "todo", nit: "todo" };

async function reviewPage(f, main) {
  const enc = encodeURIComponent;
  const put = (...nodes) => main.replaceChildren(el("div", { class: "rv-page" }, ...nodes));
  const head = el("h2", {}, "Review suggestions");
  const back = el("a", { href: featureHref(f.name) }, "← Overview");
  let d;
  try { d = await api("/api/review/suggestions?name=" + enc(f.name)); }
  catch (e) { put(head, el("p", { class: e.status === 404 ? "dim" : "st missing" }, String(e.message || e)), back); return; }
  const items = d.items;
  const undecided = () => items.filter(i => i.decision === "—");
  let at = Math.max(0, items.findIndex(i => i.decision === "—"));

  const facts = el("div", { class: "small dim" }, "Branch ", el("code", {}, d.head.Branch || "?"), d.head.Base ? [" against ", el("code", {}, d.head.Base)] : "",
    d.head.Reviewed ? [" · reviewed at ", el("code", {}, d.head.Reviewed.slice(0, 10))] : "", " · ", el("a", { href: featureHref(f.name, d.doc) }, "the document"));

  const counts = () => `${items.length - undecided().length} of ${items.length} decided`;

  // After the changes were made: what became of each suggestion, and the way on.
  const afterwards = () => {
    const rows = items.map(i => el("div", { class: "rv-row" }, el("span", { class: "chip " + SEV_CHIP[i.severity] }, i.severity), el("strong", {}, i.id), " ", i.summary,
      el("div", { class: "small dim" }, "You chose: ", i.decision.startsWith("Other: ") ? i.decision : `${i.decision} — ${i.chosen}`, " · ", el("strong", {}, i.result === "—" ? "no result recorded" : i.result))));
    const next = d.status === "Done" ? el("p", { class: "small" }, "The review is done. ", el("a", { href: featureHref(f.name) }, "On to the request →"))
      : el("div", { class: "start-actions" },
        el("a", { class: "go-btn", id: "rv-commit", href: featureCommitHref(f.name) }, "Choose what to commit…"),
        el("button", { type: "button", id: "rv-done", title: "If the changes were committed another way", onclick: async () => {
          try { await api("/api/review/done", { name: f.name }); featureCache.delete(f.name); route(); } catch (e) { alert(e.message || e); }
        } }, "Mark the review done"));
    put(head, facts, el("p", {}, d.status === "Done" ? "The changes are committed." : "The changes are made. Commit them to finish the review."), next, el("div", { class: "card rv-results" }, rows));
  };
  if (d.status === "Applied" || d.status === "Done") { afterwards(); return; }

  const draw = () => {
    const done = items.length - undecided().length;
    if (!items.length) { put(head, facts, el("p", { class: "dim" }, "The review found nothing to decide on.")); return; }
    const i = items[at];
    let choice = i.decision === "—" ? "" : (i.decision.startsWith("Other: ") ? "other" : i.decision);
    const other = el("textarea", { id: "rv-other", rows: 3, placeholder: "What should be done instead?", "aria-label": "your own answer" });
    other.value = i.decision.startsWith("Other: ") ? i.decision.slice(7) : "";
    const note = el("input", { id: "rv-note", placeholder: "A note for whoever makes the change (optional)", "aria-label": "note" });
    note.value = i.note === "—" ? "" : i.note;
    const go = el("button", { type: "button", class: "primary", id: "rv-go" });
    const msg = el("div", { class: "small st missing", id: "rv-msg" });
    const opts = [];
    const pick = k => { choice = k; opts.forEach(o => o.node.classList.toggle("picked", o.key === k)); other.hidden = k !== "other"; sync(); if (k === "other") other.focus(); };
    const option = (key, title, detail, recommended) => {
      const radio = el("input", { type: "radio", name: "rv-choice", value: key, "aria-label": `${key}: ${title}` });
      radio.checked = choice === key;
      radio.addEventListener("change", () => pick(key));
      const node = el("label", { class: "rv-opt" + (choice === key ? " picked" : ""), "data-key": key }, radio,
        el("span", {}, el("strong", {}, key === "other" ? title : `${key} — ${title}`), recommended ? el("span", { class: "chip done" }, "recommended") : "",
          detail ? el("div", { class: "small dim" }, detail) : ""));
      opts.push({ key, node });
      return node;
    };
    const last = i.decision === "—" && undecided().length === 1;
    const sync = () => {
      go.disabled = !choice || (choice === "other" && !other.value.trim());
      go.textContent = last ? "Decide, and make the changes" : "Decide";
    };
    other.addEventListener("input", sync);
    const move = to => { at = Math.max(0, Math.min(items.length - 1, to)); draw(); };
    go.addEventListener("click", async () => {
      go.disabled = true; msg.textContent = "";
      if (last) tell("allow-foreground"); // the session the last answer opens may take the window forward
      try {
        const r = await api("/api/review/decide", { name: f.name, id: i.id, choice, note: choice === "other" ? other.value : note.value });
        featureCache.delete(f.name);
        i.decision = r.decision; i.note = choice === "other" ? "—" : (note.value.trim() || "—"); i.result = "—";
        const o = i.options.find(x => x.key === choice); i.chosen = o ? o.title : "";
        if (r.started && r.started.tag) {
          sessionInfo.set(r.started.tag, { tag: r.started.tag, feature: f.name, name: r.started.name, command: r.started.command, project: r.started.project, started: Date.now() / 1000, status: "starting" });
          location.hash = "#workflows/" + enc(r.started.tag);
          return;
        }
        if (r.status === "Decided") {
          put(head, facts, el("p", {}, "Every suggestion is decided."), el("p", { class: "st missing" }, r.startError || "The session that makes the changes didn't start."),
            el("div", { class: "start-actions" }, el("button", { type: "button", class: "primary", id: "rv-apply", onclick: async () => {
              try { const s = await api("/api/review/apply", { name: f.name }); if (s.tag) location.hash = "#workflows/" + enc(s.tag); } catch (e) { alert(e.message || e); }
            } }, "Make the changes")));
          return;
        }
        const nextOne = items.findIndex((x, n) => n > at && x.decision === "—");
        move(nextOne >= 0 ? nextOne : items.findIndex(x => x.decision === "—"));
      } catch (e) { msg.textContent = String(e.message || e); sync(); }
    });
    const list = el("div", { class: "rv-list", role: "list" }, items.map((x, n) => el("button", { type: "button", class: "rv-dot" + (x.decision !== "—" ? " done" : "") + (n === at ? " now" : ""),
      title: `${x.id}: ${x.summary}`, "aria-label": `${x.id}: ${x.summary}`, onclick: () => move(n) }, x.decision !== "—" ? "✓" : String(n + 1))));
    put(head, facts, el("div", { class: "rv-progress" }, bar(done, items.length, counts())), list,
      el("section", { class: "card rv-item", id: "rv-item", "data-id": i.id },
        el("div", { class: "rv-chips" }, el("span", { class: "qchip id" }, i.id), el("span", { class: "chip " + SEV_CHIP[i.severity] }, i.severity),
          i.dimension ? el("span", { class: "dim small" }, i.dimension) : "", i.where ? el("code", {}, i.where) : ""),
        el("h3", {}, i.summary),
        i.finding ? el("div", { class: "rv-finding" }, questionNode(i.finding)) : "",
        el("div", { class: "rv-opts" }, i.options.map(o => option(o.key, o.title, o.detail, o.recommended)), option("other", "Something else", "", false)),
        other, note, msg,
        el("div", { class: "start-actions" }, go,
          el("button", { type: "button", id: "rv-prev", disabled: at === 0, onclick: () => move(at - 1) }, "Back"),
          el("button", { type: "button", id: "rv-skip", disabled: at === items.length - 1, onclick: () => move(at + 1) }, "Next"))));
    pick(choice);
  };
  draw();
}
