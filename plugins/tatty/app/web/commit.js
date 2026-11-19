// Committing what the workflow left (the server's "committing what the workflow left").
// Once a build is complete, a card in "Where it stands" says when the feature's branch has
// uncommitted files (a review only reads commits), and the Commit page (#feature/<name>/commit)
// lists them, marks the ones the workflow's own task results name, suggests a message and
// stages and commits what is chosen -- or everything -- on a click. A click on a file shows what
// changed in it and which work units changed it, so a file some other process touched stands out.
// The commit step can be skipped: the feature then goes on to the merge step. It never pushes.

const featureCommitHref = name => "#feature/" + encodeURIComponent(name) + "/commit";

// Leave the commit or the review step out (the server records it and the feature moves on to the merge step).
const SKIP_ASK = {
  commit: "Skip the commit step? Nothing is committed, and the feature goes on to the merge step.",
  review: "Skip the review? Nothing is reviewed or changed, and the feature goes on to the merge step." };
async function skipStep(f, step) {
  if (!confirm(SKIP_ASK[step])) return;
  try {
    await api("/api/skip", { name: f.name, step });
    featureCache.delete(f.name);
    if (location.hash === featureHref(f.name)) route(); else location.hash = featureHref(f.name);
  } catch (e) { alert(e.message || e); }
}
const skipCommit = f => skipStep(f, "commit");

// A quiet look at the repo, in the background (git can be slow in a big repo): the card appears
// only when there is something to commit (or git couldn't say), and the review step says to commit first.
function commitCard(f) {
  if (f.phase !== "complete") return "";
  const slot = el("div", { id: "commit-slot" });
  const load = () => api("/api/commit?name=" + encodeURIComponent(f.name)).then(info => {
    if (!slot.isConnected || !info.repo || info.skipped) return;
    if (info.error) {
      slot.replaceChildren(el("div", { class: "stand primary commit-card", id: "commit-error-card" },
        el("p", { class: "st missing" }, "Tatty couldn't read the repo's changes: " + info.error),
        el("button", { type: "button", id: "commit-retry", onclick: () => { slot.replaceChildren(); load(); } }, "Try again"),
        el("button", { type: "button", id: "commit-skip", onclick: () => skipCommit(f) }, "Skip commit")));
      return;
    }
    if (!info.files.length) return;
    const n = info.files.length, mine = info.files.filter(x => x.workflow).length;
    slot.replaceChildren(el("div", { class: "stand primary commit-card", id: "commit-card" },
      el("p", {}, el("strong", {}, `${n} changed file${n === 1 ? "" : "s"} on `), el("code", {}, info.branch || info.current || "the repo"),
        " aren't committed. ", mine ? `${mine} of them ${mine === 1 ? "is" : "are"} the workflow's own.` : "",
        info.afterReview ? " They are the changes the review's suggestions led to: commit them to finish the review."
          : " Commit them before a review: it only reads commits."),
      el("a", { class: "go-btn", id: "commit-open", href: featureCommitHref(f.name) }, "Choose what to commit…"),
      el("button", { type: "button", id: "commit-skip", onclick: () => skipCommit(f) }, "Skip commit")));
    for (const s of document.querySelectorAll(".stand.primary")) {
      if (!info.afterReview && /^Review the branch/i.test(s.innerText.trim()) && !s.querySelector(".review-needs-commit"))
        s.append(el("p", { class: "small st missing review-needs-commit" }, "Commit first: a review only reads what is committed."));
    }
  }).catch(e => {
    if (slot.isConnected) slot.replaceChildren(el("div", { class: "stand commit-card", id: "commit-error-card" },
      el("p", { class: "st missing" }, "Tatty couldn't look at the repo: " + String(e.message || e)),
      el("button", { type: "button", id: "commit-retry", onclick: () => { slot.replaceChildren(); load(); } }, "Try again")));
  });
  load();
  return slot;
}

const STATE_CHIP = { new: ["new", "done"], modified: ["changed", "now"], deleted: ["deleted", "todo"] };

// What one file looks like against the last commit, and who changed it (GET /api/commit/diff).
async function commitDiffPane(f, x, pane) {
  pane.replaceChildren(el("p", { class: "dim small" }, "Reading the change…"));
  let d;
  try { d = await api("/api/commit/diff?name=" + encodeURIComponent(f.name) + "&path=" + encodeURIComponent(x.path)); }
  catch (e) { pane.replaceChildren(el("p", { class: "st missing" }, String(e.message || e))); return; }
  const [word, kind] = STATE_CHIP[d.state] || ["changed", "now"];
  const who = [];
  if (d.units && d.units.length) who.push(el("span", {}, "Changed by ", ...d.units.map(u => el("span", { class: "chip done unit-chip" }, u))));
  if (d.edits && d.edits.length) {
    const tasks = [...new Set(d.edits.map(e => e.task).filter(Boolean))];
    const last = d.edits[d.edits.length - 1];
    who.push(el("span", { class: "dim small" }, `${d.edits.length} edit${d.edits.length === 1 ? "" : "s"} recorded by the build`,
      tasks.length ? ` (${tasks.join(", ")})` : "", typeof ago === "function" && last.ts ? `, the last ${ago(last.ts)}` : ""));
  }
  if (d.external) who.push(el("span", { class: "ext-note" }, el("span", { class: "chip todo" }, "external"),
    " No work unit's results name this file and the build recorded no edit to it: a formatter, a build, a shell command or someone else may have changed it."));
  let body;
  if (d.folder) body = el("p", { class: "dim" }, "A new folder: tick it to commit everything in it.");
  else if (d.large) body = el("p", { class: "dim" }, `${(d.bytes / 1048576).toFixed(0)} MB: too big to show.`);
  else if (d.binary) body = el("p", { class: "dim" }, "A binary file: git can't show what changed in it.");
  else if (!d.hunks.length) body = el("p", { class: "dim" }, d.state === "deleted" ? "The file is deleted." : "No lines changed (only its mode or line endings).");
  else body = el("div", {}, el("div", { class: "diff-scroll" }, diffTable(d.hunks)),
    d.cut ? el("p", { class: "diff-note" }, "Only the first part of this change is shown because it is large.") : "");
  pane.replaceChildren(el("div", { class: "cd-head" }, el("code", { class: "mono" }, d.path), el("span", { class: "chip " + kind }, word)),
    who.length ? el("div", { class: "cd-who" }, ...who) : "", body);
}

async function commitPage(f, main) {
  const enc = encodeURIComponent;
  main.replaceChildren(el("p", { class: "dim pad" }, "Looking at the repo…"));
  const put = (...nodes) => main.replaceChildren(el("div", { class: "commit-page" }, ...nodes));
  const back = el("a", { href: featureHref(f.name) }, "← Overview");
  let info;
  try { info = await api("/api/commit?name=" + enc(f.name) + "&detail=1"); }
  catch (e) { put(el("h2", {}, "Commit your changes"), el("p", { class: "st missing" }, String(e.message || e)), back); return; }
  const head = el("h2", {}, "Commit your changes");
  if (!info.repo) { put(head, el("p", { class: "st missing" }, info.note), back); return; }
  const where = el("div", { class: "small" }, "Repo ", el("code", {}, info.repo), " · branch ", el("code", {}, info.current || "(detached HEAD)"));
  const skipBtn = el("button", { type: "button", id: "commit-skip", onclick: () => skipCommit(f) }, "Skip commit");
  if (info.error) {
    put(head, where, el("p", { class: "st missing", id: "commit-git-error" }, "git couldn't list the changes: " + info.error),
      el("div", { class: "start-actions" }, el("button", { type: "button", id: "commit-retry", onclick: () => commitPage(f, main) }, "Try again"), skipBtn), back);
    return;
  }
  const wrong = info.branch && info.current !== info.branch;
  const warn = [
    wrong ? el("p", { class: "st missing", id: "commit-wrong-branch" }, `The repo is on ${info.current || "a detached HEAD"}, not this feature's branch ${info.branch}. Switch it first, so the commit lands on the right branch.`) : "",
    !wrong && !info.current ? el("p", { class: "st missing", id: "commit-detached" }, "The repo is on a detached HEAD. Switch it to a branch first, so the commit isn't lost.") : "",
    info.conflicts.length ? el("p", { class: "st missing" }, `Files in conflict: ${info.conflicts.slice(0, 3).join(", ")}. Resolve them first.`) : "",
    info.truncated ? el("p", { class: "st missing", id: "commit-truncated" }, "More files changed than are listed here (folders of new files are shown as one line). Choose files to commit; Commit everything is off.") : ""];
  if (!info.files.length) {
    featureCache.delete(f.name);
    put(head, where, ...warn, el("div", { class: "card", id: "commit-clean" }, el("strong", {}, "Nothing to commit: "), "the branch is clean.",
      el("p", { class: "small" }, "Next: ", el("a", { href: featureHref(f.name) }, "the feature's page"), " offers the next step.")));
    return;
  }
  const hasWf = info.files.some(x => x.workflow);
  const chosen = new Set(info.files.filter(x => !x.secret && (hasWf ? x.workflow : true)).map(x => x.path));
  const everything = info.files.filter(x => !x.secret);
  const prints = Object.fromEntries(info.files.filter(x => x.print).map(x => [x.path, x.print]));
  const message = el("textarea", { id: "commit-message", rows: 7, "aria-label": "commit message", spellcheck: "true" });
  message.value = info.message;
  const result = el("div", { class: "start-result", id: "commit-result" });
  const selectedBtn = el("button", { type: "button", class: "primary", id: "commit-selected" });
  const allBtn = el("button", { type: "button", id: "commit-all" }, `Commit everything (${everything.length})`);
  const bad = wrong || !info.current || info.conflicts.length > 0;
  const sync = () => {
    selectedBtn.textContent = `Commit selected (${chosen.size})`;
    selectedBtn.disabled = bad || !chosen.size;
    allBtn.disabled = bad || info.truncated;
  };
  const pane = el("aside", { class: "commit-diff card", id: "commit-diff" },
    el("p", { class: "dim small" }, "Click a file's name to see what changed in it and which work units changed it."));
  const rowEls = [];
  const row = x => {
    const [word, kind] = STATE_CHIP[x.state];
    const box = el("input", { type: "checkbox", "aria-label": x.path });
    box.checked = chosen.has(x.path);
    box.addEventListener("change", () => { if (box.checked) chosen.add(x.path); else chosen.delete(x.path); sync(); });
    const i = x.path.lastIndexOf("/");
    const name = el("button", { type: "button", class: "cpath", title: "Show what changed in this file" },
      i >= 0 ? el("span", { class: "dim" }, x.path.slice(0, i + 1)) : "", x.path.slice(i + 1));
    const r = el("div", { class: "crow" + (x.state === "deleted" ? " gone" : "") + (x.external ? " ext" : ""), "data-path": x.path },
      el("label", { class: "cbox" }, box, el("span", { class: "chip " + kind }, word)), name,
      ...(x.units || []).map(u => el("span", { class: "chip done unit-chip", title: `${u}'s task results (or commits) name this file` }, u)),
      x.external ? el("span", { class: "chip todo", title: "No work unit's results name this file and the build recorded no edit to it: something else may have changed it." }, "external") : "",
      x.secret ? el("span", { class: "chip todo", title: "Looks like a secret: left out of Commit everything" }, "looks like a secret") : "",
      x.large ? el("span", { class: "chip todo" }, `${(x.bytes / 1048576).toFixed(0)} MB`) : "",
      x.staged ? el("span", { class: "dim small" }, "already staged") : "");
    name.addEventListener("click", () => {
      for (const o of rowEls) o.classList.toggle("open", o === r);
      commitDiffPane(f, x, pane);
    });
    r._file = x;
    rowEls.push(r);
    return r;
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
      const r = await api("/api/commit", { name: f.name, message: message.value, ...body, ...(Object.keys(prints).length ? { prints } : {}) });
      featureCache.delete(f.name);
      put(el("h2", {}, "Committed"), el("div", { class: "card", id: "commit-done" },
        el("p", {}, el("code", {}, r.commit), " ", r.subject), el("p", { class: "small dim" }, `${r.files} file${r.files === 1 ? "" : "s"} on ${info.current}. Nothing was pushed.` + (r.reviewDone ? " The review is done." : "")),
        el("div", { class: "start-actions" },
          el("a", { class: "go-btn", id: "commit-next", href: featureHref(f.name) }, r.reviewDone ? "Back to the feature: on to the request" : "Back to the feature: review it"),
          el("button", { type: "button", id: "commit-more", onclick: () => commitPage(f, main) }, "Commit more files"))));
    } catch (e) {
      result.replaceChildren(el("pre", { class: "st missing commit-error" }, String(e.message || e)),
        el("button", { type: "button", id: "commit-reload", onclick: () => commitPage(f, main) }, "Reload the list"));
      sync();
    }
  };
  selectedBtn.addEventListener("click", () => go({ files: [...chosen] }, chosen.size, [...chosen].filter(p => hasWf && !info.files.find(x => x.path === p).workflow).length));
  allBtn.addEventListener("click", () => go({ all: true }, everything.length, hasWf ? everything.filter(x => !x.workflow).length : 0));

  // Show all files, one work unit's, or the ones no unit explains.
  const units = [...new Set(info.files.flatMap(x => x.units || []))];
  const external = info.files.filter(x => x.external).length;
  const filter = el("select", { id: "commit-filter", "aria-label": "which files to show" },
    el("option", { value: "" }, "Show all files"),
    ...units.map(u => el("option", { value: "u:" + u }, `Changed by ${u}`)),
    ...(external ? [el("option", { value: "ext" }, `Not explained by a work unit (${external})`)] : []));
  filter.addEventListener("change", () => {
    const v = filter.value;
    for (const r of rowEls) r.hidden = !(!v || (v === "ext" ? r._file.external : (r._file.units || []).includes(v.slice(2))));
  });
  put(head, where, ...warn,
    info.afterReview ? el("p", { class: "small" }, "These are the changes the review's suggestions led to. Committing them finishes the review.") : "",
    el("p", { class: "small dim" }, hasWf ? "The workflow's own files are ticked: they are the ones its task results list as modified. The rest are changes in the repo it doesn't mention, so check them before including them."
      : "The workflow's results name no file that changed here, so everything is ticked."),
    external ? el("p", { class: "small" }, el("span", { class: "chip todo" }, "external"), ` ${external} file${external === 1 ? " is" : "s are"} changed but no work unit or recorded edit explains ${external === 1 ? "it" : "them"}: click one to see what changed.`) : "",
    units.length || external ? el("div", { class: "commit-filter" }, filter) : "",
    el("div", { class: "commit-layout" },
      el("div", { class: "commit-files" },
        hasWf ? section("Changed by this workflow", info.files.filter(x => x.workflow)) : "",
        section(hasWf ? "Other changes in the repo" : "Changed files", info.files.filter(x => !hasWf || !x.workflow), hasWf ? "Not named in the workflow's task results." : "")),
      pane),
    el("div", { class: "card" }, el("h4", {}, "Message"),
      el("p", { class: "dim small" }, "Suggested from the feature and the style of this repo's recent commits. Edit it freely; nothing is added to it."), message),
    el("div", { class: "start-actions" }, selectedBtn, allBtn, skipBtn,
      el("span", { class: "dim small" }, "Stages and commits only these files. It doesn't push; the merge step does. Skip commit leaves them as they are and goes on to the merge step.")),
    result);
  sync();
}
