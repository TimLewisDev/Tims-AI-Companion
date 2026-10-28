// Committing what the workflow left (the server's "committing what the workflow left").
// Once a build is complete, a card in "Where it stands" says when the feature's branch has
// uncommitted files (a review only reads commits), and the Commit page (#feature/<name>/commit)
// lists them, marks the ones the workflow's own task results name, suggests a message and
// stages and commits what is chosen -- or everything -- on a click. It never pushes.

const featureCommitHref = name => "#feature/" + encodeURIComponent(name) + "/commit";

// A quiet look at the repo, in the background (git can be slow in a big repo): the card appears
// only when there is something to commit, and the review step says to commit first.
function commitCard(f) {
  if (f.phase !== "complete") return "";
  const slot = el("div", { id: "commit-slot" });
  api("/api/commit?name=" + encodeURIComponent(f.name)).then(info => {
    if (!slot.isConnected || !info.repo || !info.files.length) return;
    const n = info.files.length, mine = info.files.filter(x => x.workflow).length;
    slot.replaceChildren(el("div", { class: "stand primary commit-card", id: "commit-card" },
      el("p", {}, el("strong", {}, `${n} changed file${n === 1 ? "" : "s"} on `), el("code", {}, info.branch || info.current || "the repo"),
        " aren't committed. ", mine ? `${mine} of them ${mine === 1 ? "is" : "are"} the workflow's own.` : "",
        info.afterReview ? " They are the changes the review's suggestions led to: commit them to finish the review."
          : " Commit them before a review: it only reads commits."),
      el("a", { class: "go-btn", id: "commit-open", href: featureCommitHref(f.name) }, "Choose what to commit…")));
    for (const s of document.querySelectorAll(".stand.primary")) {
      if (!info.afterReview && /^Review the branch/i.test(s.innerText.trim()) && !s.querySelector(".review-needs-commit"))
        s.append(el("p", { class: "small st missing review-needs-commit" }, "Commit first: a review only reads what is committed."));
    }
  }).catch(() => {});
  return slot;
}

const STATE_CHIP = { new: ["new", "done"], modified: ["changed", "now"], deleted: ["deleted", "todo"] };

async function commitPage(f, main) {
  const enc = encodeURIComponent;
  main.replaceChildren(el("p", { class: "dim pad" }, "Looking at the repo…"));
  const put = (...nodes) => main.replaceChildren(el("div", { class: "commit-page" }, ...nodes));
  const back = el("a", { href: featureHref(f.name) }, "← Overview");
  let info;
  try { info = await api("/api/commit?name=" + enc(f.name)); }
  catch (e) { put(el("h2", {}, "Commit your changes"), el("p", { class: "st missing" }, String(e.message || e)), back); return; }
  const head = el("h2", {}, "Commit your changes");
  if (!info.repo) { put(head, el("p", { class: "st missing" }, info.note), back); return; }
  const where = el("div", { class: "small" }, "Repo ", el("code", {}, info.repo), " · branch ", el("code", {}, info.current || "(detached HEAD)"));
  const wrong = info.branch && info.current !== info.branch;
  const warn = [
    wrong ? el("p", { class: "st missing", id: "commit-wrong-branch" }, `The repo is on ${info.current || "a detached HEAD"}, not this feature's branch ${info.branch}. Switch it first, so the commit lands on the right branch.`) : "",
    info.conflicts.length ? el("p", { class: "st missing" }, `Files in conflict: ${info.conflicts.slice(0, 3).join(", ")}. Resolve them first.`) : "",
    info.truncated ? el("p", { class: "st missing" }, "More files changed than are listed here.") : ""];
  if (!info.files.length) {
    featureCache.delete(f.name);
    put(head, where, ...warn, el("div", { class: "card", id: "commit-clean" }, el("strong", {}, "Nothing to commit: "), "the branch is clean.",
      el("p", { class: "small" }, "Next: ", el("a", { href: featureHref(f.name) }, "the feature's page"), " offers the next step.")));
    return;
  }
  const hasWf = info.files.some(x => x.workflow);
  const chosen = new Set(info.files.filter(x => !x.secret && (hasWf ? x.workflow : true)).map(x => x.path));
  const everything = info.files.filter(x => !x.secret);
  const message = el("textarea", { id: "commit-message", rows: 7, "aria-label": "commit message", spellcheck: "true" });
  message.value = info.message;
  const result = el("div", { class: "start-result", id: "commit-result" });
  const selectedBtn = el("button", { type: "button", class: "primary", id: "commit-selected" });
  const allBtn = el("button", { type: "button", id: "commit-all" }, `Commit everything (${everything.length})`);
  const sync = () => {
    selectedBtn.textContent = `Commit selected (${chosen.size})`;
    selectedBtn.disabled = wrong || !chosen.size || info.conflicts.length > 0;
    allBtn.disabled = wrong || info.conflicts.length > 0;
  };
  const row = x => {
    const [word, kind] = STATE_CHIP[x.state];
    const box = el("input", { type: "checkbox", "aria-label": x.path });
    box.checked = chosen.has(x.path);
    box.addEventListener("change", () => { if (box.checked) chosen.add(x.path); else chosen.delete(x.path); sync(); });
    const i = x.path.lastIndexOf("/");
    return el("label", { class: "crow" + (x.state === "deleted" ? " gone" : ""), "data-path": x.path }, box, el("span", { class: "chip " + kind }, word),
      el("span", { class: "cpath" }, i >= 0 ? el("span", { class: "dim" }, x.path.slice(0, i + 1)) : "", x.path.slice(i + 1)),
      x.secret ? el("span", { class: "chip todo", title: "Looks like a secret: left out of Commit everything" }, "looks like a secret") : "",
      x.large ? el("span", { class: "chip todo" }, `${(x.bytes / 1048576).toFixed(0)} MB`) : "",
      x.staged ? el("span", { class: "dim small" }, "already staged") : "");
  };
  const section = (title, files, note) => {
    if (!files.length) return "";
    const rows = files.map(row);
    const tick = on => { for (const x of files) on && !x.secret ? chosen.add(x.path) : chosen.delete(x.path); rows.forEach((r, i) => { r.querySelector("input").checked = chosen.has(files[i].path); }); sync(); };
    return el("section", { class: "card commit-section" }, el("div", { class: "commit-head" }, el("h4", {}, `${title} (${files.length})`),
      el("button", { type: "button", class: "linkish", onclick: () => tick(true) }, "tick all"), el("button", { type: "button", class: "linkish", onclick: () => tick(false) }, "none")),
      note ? el("p", { class: "dim small" }, note) : "", el("div", { class: "crows" }, rows));
  };
  const go = async (body, count, outside) => {
    if (outside && !confirm(`Commit ${count} files, ${outside} of which the workflow's task results don't mention?`)) return;
    selectedBtn.disabled = allBtn.disabled = true;
    result.replaceChildren(el("span", { class: "dim small" }, "Committing…"));
    try {
      const r = await api("/api/commit", { name: f.name, message: message.value, ...body });
      featureCache.delete(f.name);
      put(el("h2", {}, "Committed"), el("div", { class: "card", id: "commit-done" },
        el("p", {}, el("code", {}, r.commit), " ", r.subject), el("p", { class: "small dim" }, `${r.files} file${r.files === 1 ? "" : "s"} on ${info.current}. Nothing was pushed.` + (r.reviewDone ? " The review is done." : "")),
        el("div", { class: "start-actions" },
          el("a", { class: "go-btn", id: "commit-next", href: featureHref(f.name) }, r.reviewDone ? "Back to the feature: on to the request" : "Back to the feature: review it"),
          el("button", { type: "button", id: "commit-more", onclick: () => commitPage(f, main) }, "Commit more files"))));
    } catch (e) {
      result.replaceChildren(el("pre", { class: "st missing commit-error" }, String(e.message || e)));
      sync();
    }
  };
  selectedBtn.addEventListener("click", () => go({ files: [...chosen] }, chosen.size, [...chosen].filter(p => hasWf && !info.files.find(x => x.path === p).workflow).length));
  allBtn.addEventListener("click", () => go({ all: true }, everything.length, hasWf ? everything.filter(x => !x.workflow).length : 0));
  put(head, where, ...warn,
    info.afterReview ? el("p", { class: "small" }, "These are the changes the review's suggestions led to. Committing them finishes the review.") : "",
    el("p", { class: "small dim" }, hasWf ? "The workflow's own files are ticked: they are the ones its task results list as modified. The rest are changes in the repo it doesn't mention, so check them before including them."
      : "The workflow's results name no file that changed here, so everything is ticked."),
    hasWf ? section("Changed by this workflow", info.files.filter(x => x.workflow)) : "",
    section(hasWf ? "Other changes in the repo" : "Changed files", info.files.filter(x => !hasWf || !x.workflow), hasWf ? "Not named in the workflow's task results." : ""),
    el("div", { class: "card" }, el("h4", {}, "Message"),
      el("p", { class: "dim small" }, "Suggested from the feature and the style of this repo's recent commits. Edit it freely; nothing is added to it."), message),
    el("div", { class: "start-actions" }, selectedBtn, allBtn,
      el("span", { class: "dim small" }, "Stages and commits only these files. It doesn't push; the merge step does.")),
    result);
  sync();
}
