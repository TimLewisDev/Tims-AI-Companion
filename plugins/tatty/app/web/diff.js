"use strict";
// A feature's Code Diff section (#feature/<name>/code-diff): how far the build is, then each
// task that has changed code with its own words and every changed file as a before/after.
// The server keeps what the agent's edits reported (GET /api/diffs); this page only draws
// it, and again now and then and on the server's "diff" event while it is on screen.
// The now-and-then redraw leaves the page alone when nothing changed, so a reader's text
// selection and sideways scroll survive it.
// File contents are untrusted: every line is set as text, never as markup.

let diffView = null; // the page on screen: { main, name, timer, last }
let diffSoon = 0;    // the pending redraw after a "diff" event
let diffDraws = 0;   // counts the draws, so a slow answer can't land on a newer one
const diffAskErrors = new Map(); // "feature/task" -> why asking for more info failed, kept across redraws

function renderCodeDiff(main, f) {
  if (diffView) clearInterval(diffView.timer);
  clearTimeout(diffSoon);
  const view = { main, name: f.name, timer: 0, last: "" };
  diffView = view;
  main.replaceChildren(el("p", { class: "dim pad" }, "Reading the changes…"));
  view.timer = setInterval(() => {
    if (!view.main.isConnected) { clearInterval(view.timer); return; }
    if (!document.hidden) drawCodeDiff(view, true);
  }, 5000);
  return drawCodeDiff(view);
}

document.addEventListener("tt-event", e => {
  const ev = e.detail;
  if (!diffView || !ev || ev.type !== "diff" || ev.name !== diffView.name || !diffView.main.isConnected) return;
  const view = diffView;
  clearTimeout(diffSoon);
  diffSoon = setTimeout(() => { if (view === diffView && view.main.isConnected) drawCodeDiff(view); }, 250);
});

// quiet: the answer is the same as the one on screen, so leave the page as it is. Only the
// timer asks this: a click (More info) must always redraw, whatever the server says, because
// the page itself holds state the answer doesn't (the button's wait, an ask error).
async function drawCodeDiff(view, quiet = false) {
  const mine = ++diffDraws;
  let d;
  try { d = await api("/api/diffs?name=" + encodeURIComponent(view.name)); } catch (e) {
    if (mine !== diffDraws || !view.main.isConnected) return;
    // a page already drawn is better than an error line in its place
    if (view.last) return;
    view.main.replaceChildren(el("p", { class: "pad st missing" }, String(e.message || e)));
    return;
  }
  if (mine !== diffDraws || !view.main.isConnected) return;
  const key = JSON.stringify(d);
  if (quiet && key === view.last) return;
  view.last = key;
  const top = view.main.scrollTop;
  view.main.replaceChildren(el("div", { class: "diff-page" }, diffProgress(d), diffGroups(d, view)));
  view.main.scrollTop = top;
}

function diffProgress(d) {
  const t = d.progress.tasks, u = d.progress.units;
  const line = d.running ? "Implementation is running: code under a task that is In Progress may still change."
    : t.total > 0 && t.done === t.total ? "Every task is implemented; what is left is validation."
    : t.total === 0 ? "Tatty can't read a Task Status for this feature, so it can't say how far through the build is."
    : "Implementation is not running.";
  return el("section", { class: "card" }, el("h4", {}, "Implementation"),
    bar(t.done, t.total, `${u.done} of ${u.total} work units done · ${t.done} of ${t.total} tasks implemented or done`),
    el("p", { class: "diff-line" }, line));
}

// One group per task that has changes, in the board's order, then the changes that
// belong to no task.
function diffGroups(d, view) {
  const newest = (a, b) => b.id - a.id;
  const known = new Set(d.tasks.map(t => t.id));
  const groups = [];
  for (const t of d.tasks) {
    const own = d.changes.filter(c => c.task === t.id).sort(newest);
    if (own.length) groups.push(diffGroup(d, view, t, own));
  }
  const loose = d.changes.filter(c => !c.task || !known.has(c.task)).sort(newest);
  if (loose.length) groups.push(diffGroup(d, view, null, loose));
  if (!groups.length) return el("p", { class: "dim pad" }, "No code changes have been seen for this feature yet.");
  return groups;
}

function diffGroup(d, view, t, changes) {
  const head = t ? el("div", { class: "diff-task-head" },
    el("code", { class: "mono" }, t.id), el("strong", {}, t.title), chip(t.status, statusClass(t.status)), diffTaskNote(t.status))
    : el("div", { class: "diff-task-head" }, el("strong", {}, "Changes with no task In Progress"));
  return el("section", { class: "card diff-task" }, head, t ? diffWords(t) : "", t ? diffMore(d, view, t) : "", changes.map(diffChange));
}

function diffTaskNote(status) {
  if (status === "Todo" || status === "In Progress") return el("span", { class: "diff-note warn" }, "may still change");
  if (status === "Implemented") return el("span", { class: "diff-note" }, "finished, waiting for validation");
  if (status === "Done") return el("span", { class: "diff-note" }, "validated");
  return "";
}

// The task's own words: what it is for, its goal and, once written, its result.
function diffWords(t) {
  const parts = [];
  if (t.plain) parts.push(t.plain);
  if (t.goal) parts.push("Goal: " + t.goal);
  if (t.summary) parts.push("Result: " + t.summary);
  if (!parts.length) return el("p", { class: "diff-note" }, "No description for this task was found in the Lite Brief or Task Breakdown.");
  return el("div", { class: "diff-words" }, el("div", { class: "diff-label" }, "The task in its own words"),
    el("pre", {}, el("code", {}, parts.join("\n\n"))));
}

// Under the task's words: the More info button, and the explanation a small model wrote
// for this task's changes (or why it couldn't).
function diffMore(d, view, t) {
  const more = d.more[t.id];
  const busy = d.busy.includes(t.id);
  const key = view.name + "/" + t.id;
  const button = el("button", { type: "button", class: "diff-more-btn", disabled: busy },
    busy ? "Writing…" : more ? "Write again" : "More info");
  button.addEventListener("click", async () => {
    button.textContent = "Writing…";
    button.disabled = true;
    diffAskErrors.delete(key);
    try { await api("/api/diff-more", { name: view.name, task: t.id }); } catch (e) {
      if (e.status !== 409) diffAskErrors.set(key, String(e.message || e));
    }
    setTimeout(() => { if (view === diffView && view.main.isConnected) drawCodeDiff(view); }, 250);
  });
  const parts = [el("div", { class: "diff-more-row" }, button)];
  const askError = diffAskErrors.get(key);
  if (askError) parts.push(el("p", { class: "small st missing" }, askError));
  if (more && more.text) {
    parts.push(el("div", { class: "diff-label" }, "Written by a small model"),
      el("pre", { class: "diff-more" }, el("code", {}, more.text)));
  } else if (more && more.error) {
    parts.push(el("p", { class: "small st missing" }, more.error));
  }
  return el("div", { class: "diff-more-block" }, parts);
}

function diffChange(c) {
  return el("div", { class: "diff-change" },
    el("div", { class: "diff-change-head" },
      chip(c.type === "create" ? "new file" : "changed", "now"), el("code", { class: "mono" }, c.file), el("span", { class: "dim small" }, ago(c.ts))),
    el("div", { class: "diff-scroll" }, diffTable(c.hunks)),
    c.truncated ? el("p", { class: "diff-note" }, "Part of this change was cut because it is large.") : "");
}

// A change's hunks as rows of old line | new line. Removed lines are paired by position
// with the added lines after them; the side with fewer gets blank cells.
function diffTable(hunks) {
  const rows = [];
  let widest = 0;
  const cell = (n, text, kind) => {
    widest = Math.max(widest, (text || "").length);
    return [el("td", { class: "ln" }, n === null ? "" : String(n)), el("td", { class: "code " + kind }, text)];
  };
  for (const h of hunks) {
    rows.push(el("tr", {}, el("td", { class: "diff-hunk", colspan: "4" }, `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)));
    let o = h.oldStart, n = h.newStart, i = 0;
    const lines = h.lines;
    while (i < lines.length) {
      if (lines[i][0] === " ") {
        const text = lines[i].slice(1);
        rows.push(el("tr", {}, cell(o++, text, "ctx"), cell(n++, text, "ctx")));
        i++;
        continue;
      }
      const dels = [], adds = [];
      while (i < lines.length && lines[i][0] === "-") dels.push(lines[i++].slice(1));
      while (i < lines.length && lines[i][0] === "+") adds.push(lines[i++].slice(1));
      if (!dels.length && !adds.length) { i++; continue; } // a line of no known kind: skip it, never loop on it
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        rows.push(el("tr", {},
          k < dels.length ? cell(o++, dels[k], "del") : cell(null, "", "empty"),
          k < adds.length ? cell(n++, adds[k], "add") : cell(null, "", "empty")));
      }
    }
  }
  const table = el("table", { class: "diff" },
    el("colgroup", {}, el("col", { class: "ln-col" }), el("col"), el("col", { class: "ln-col" }), el("col")),
    el("tbody", {}, rows));
  // Fixed columns don't grow with a long line: the table is as wide as the longest one needs,
  // and the box round it scrolls sideways. (Set through the DOM: the page refuses inline styles.)
  table.style.minWidth = `${2 * (widest + 4) + 10}ch`;
  return table;
}
