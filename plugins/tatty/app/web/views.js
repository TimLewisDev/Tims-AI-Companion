// Tatty's document viewers: View mode shows each kind of document (the "Challenges"
// in "<Prefix> - Challenges.md") in a layout made for it. A kind with no viewer, or a
// file its viewer can't read, falls back to the plain markdown page (mdNode).
// Uses app.js's el, esc, inline, markdown, isTable, cells and features.js's chip,
// statusClass and bar, at call time.
"use strict";

// kind (the part of the file name after " - ") -> (text, ctx) => Node, or null to fall
// back. ctx.sibling(kind) -> Promise of the text of the same feature's document of
// another kind (null if there isn't one), for a view that shows something from it.
const VIEWS = { "Challenges": challengesView, "Task Breakdown": breakdownView };

function viewOf(kind, text, ctx) {
  const view = VIEWS[kind];
  if (!view) return null;
  try { return view(text, ctx); } catch (e) { console.warn(`${kind} view failed; showing the markdown`, e); return null; }
}

const rich = (tag, cls, text) => { const n = el(tag, { class: cls }); n.innerHTML = inline(text); return n; };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The document's lines, without a BOM, CRs or a header block copied from the sibling
// documents (front matter, or "# Tags … ---").
function docLines(src) {
  const lines = src.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n");
  if (/^---\s*$/.test(lines[0]) || /^#\s+Tags\b/i.test(lines[0])) {
    const end = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
    if (end > 0) return lines.slice(end + 1);
  }
  return lines;
}

// ------------------------------------------------------------- challenges

// The shape tt-adversarial-plan writes:
//   # <Feature>: Challenges          ## At a glance (a table; the cards replace it)
//   ## <Stage> — challenged <date> @ `sha`      **Target:** … · **Lens:** … · **Found:** …
//   ### CH<n> — <title>              - **Severity:** blocking · **Target:** R2
//                                    - **Outcome:** Open      - **Resolution:** —
// and, tolerated, a hand-written list:  ## <Stage>   - **CH1** <text>. Resolved: <how>
const CH_FIELD = /\*\*([^*:]+?)(?::\*\*|\*\*:)\s*(.*?)(?=\s+·\s+\*\*[^*:]+?(?::\*\*|\*\*:)|$)/g;
const CH_NONE = /^[—–-]*$/;

function parseChallenges(src) {
  const lines = docLines(src);
  const doc = { title: "", intro: [], stages: [], count: 0 };
  let stage = null, item = null, last = null; // the stage, challenge and field being read
  const newStage = (name, date, sha) => doc.stages.push(stage = { name, date, sha, notes: [], items: [] });
  for (const l of lines) {
    let m;
    if ((m = l.match(/^#\s+(.+)$/))) { if (!doc.title) doc.title = m[1]; continue; }
    if ((m = l.match(/^##\s+(.+)$/))) {
      item = last = null;
      if (/^at a glance\b/i.test(m[1])) { stage = null; continue; }
      const s = m[1].match(/^(.+?)\s+[—–-]+\s+challenged\s+(\S+)(?:\s+@\s+`?([0-9a-f]+)`?)?/i);
      if (s) newStage(s[1], s[2], s[3] || ""); else newStage(m[1], "", "");
      continue;
    }
    if (!stage) { if (doc.title && !doc.stages.length && !/^\|/.test(l)) doc.intro.push(l); continue; }
    if ((m = l.match(/^###\s+CH(\d+)\s*[—–:-]*\s*(.*)$/i))) {
      stage.items.push(item = { n: +m[1], title: m[2].trim(), fields: {}, extra: [] });
      doc.count++; last = null;
      continue;
    }
    if ((m = l.match(/^\s*[-*]\s+\*\*CH(\d+)\*\*[:.]?\s*(.*)$/i))) { // hand-written list item
      const [, text, how] = m[2].match(/^(.*?)(?:\s*Resolved:\s*(.*))?$/) || [];
      stage.items.push(item = { n: +m[1], title: "", body: text, fields: how ? { outcome: "Resolved", resolution: how } : { outcome: "Open" }, extra: [] });
      doc.count++; last = null;
      continue;
    }
    if (item && /^\s*[-*]\s+\*\*/.test(l)) {
      last = null;
      for (const f of l.matchAll(CH_FIELD)) {
        const key = f[1].trim().toLowerCase();
        item.fields[key] = f[2].trim();
        last = key;
      }
      continue;
    }
    if (item && last && /^\s{2,}\S/.test(l)) { item.fields[last] += " " + l.trim(); continue; } // a wrapped field
    if (!l.trim()) continue;
    if (!item) stage.notes.push(l.trim()); // under the stage heading: Target · Lens · Found
    else if (/^\*\*/.test(l)) { item = last = null; stage.notes.push(l.trim()); } // after the last card: lens points
  }
  return doc.count ? doc : null;
}

const CH_KNOWN = ["severity", "target", "assumption attacked", "why it may be wrong", "evidence",
  "question for the engineer", "outcome", "resolution"];
const word = v => (v || "").trim().split(/[\s.,;:(]/)[0];
const sevOf = f => word(f.severity).toLowerCase();
const outcomeOf = f => { const w = word(f.outcome); return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""; };
const SEV_CLASS = { blocking: "bad", significant: "warn", minor: "todo" };
const OUTCOME_CLASS = { Open: "warn", Accepted: "done", Resolved: "done", Deferred: "now", Rebutted: "todo", Dismissed: "todo" };

function challengesView(src) {
  const doc = parseChallenges(src);
  if (!doc) return null;
  const filter = { sev: "", out: "" };
  const cards = [], sections = [];

  const card = it => {
    const f = it.fields, sev = sevOf(f), out = outcomeOf(f);
    const heading = `CH${it.n}` + (it.title ? ` — ${it.title}` : "");
    const facts = [["Target", f.target], ["Assumption attacked", f["assumption attacked"]], ["Evidence", f.evidence],
      ["Question for the engineer", f["question for the engineer"]],
      ...Object.keys(f).filter(k => !CH_KNOWN.includes(k)).map(k => [k[0].toUpperCase() + k.slice(1), f[k]])]
      .filter(([, v]) => v && !CH_NONE.test(v));
    const why = it.body || f["why it may be wrong"];
    // The heading text is what the document's own "### CH3 — title" would render, so a
    // link such as [[Challenges#CH3]] finds it (findTarget matches headings by text).
    const h = el("h3", { class: "ch-title", id: `h-${slug(heading)}` }, el("span", { class: "ch-num" }, `CH${it.n}`), " ");
    h.append(rich("span", "", it.title));
    const n = el("article", { class: "card chcard" + (sev ? " sev-" + sev : "") },
      el("div", { class: "ch-top" }, h,
        sev ? chip(sev, SEV_CLASS[sev] || "todo") : "", out ? chip(out, OUTCOME_CLASS[out] || "todo") : ""),
      why ? rich("p", "ch-why", why) : "",
      facts.length ? el("dl", { class: "ch-facts" }, facts.flatMap(([k, v]) => [el("dt", {}, k), rich("dd", "", v)])) : "",
      f.resolution && !CH_NONE.test(f.resolution) ? el("div", { class: "ch-resolution" }, el("strong", {}, "Resolution "), rich("span", "", f.resolution)) : "");
    cards.push({ n, sev, out });
    return n;
  };

  const body = el("div", { class: "cards" });
  for (const s of doc.stages) {
    if (!s.items.length) continue;
    const mine = s.items.map(card);
    const head = el("h2", { class: "ch-stage" }, s.name, s.date ? el("span", { class: "dim small" }, ` challenged ${s.date}` + (s.sha ? ` @ ${s.sha}` : "")) : "");
    head.id = `h-${slug(s.name)}`;
    const section = el("section", { class: "ch-section" }, head,
      s.notes.length ? el("p", { class: "dim small" }, ...s.notes.map(t => rich("span", "", t + " "))) : "", mine);
    sections.push({ section, s });
    body.append(section);
  }

  // Filters: the counts double as buttons; click one again to clear it.
  const all = cards.slice();
  const counts = (pick, order) => {
    const by = new Map();
    for (const c of all) if (pick(c)) by.set(pick(c), (by.get(pick(c)) || 0) + 1);
    const rank = v => (order.includes(v) ? order.indexOf(v) : order.length);
    return [...by].sort((a, b) => rank(a[0]) - rank(b[0]));
  };
  const apply = () => {
    for (const c of all) c.n.classList.toggle("hidden", !!((filter.sev && c.sev !== filter.sev) || (filter.out && c.out !== filter.out)));
    for (const { section } of sections) section.classList.toggle("hidden", !section.querySelector(".chcard:not(.hidden)"));
    for (const b of bar.querySelectorAll("button.ch-filter")) b.classList.toggle("on", filter[b.dataset.by] === b.dataset.value);
  };
  const filterChip = (by, value, count, cls) => el("button", {
    type: "button", class: "chip ch-filter " + cls, "data-by": by, "data-value": value, title: `Show only ${value}`,
    onclick: () => { filter[by] = filter[by] === value ? "" : value; apply(); },
  }, `${count} ${value}`);
  const bar = el("div", { class: "ch-summary" },
    el("strong", {}, `${doc.count} challenge${doc.count === 1 ? "" : "s"}`),
    counts(c => c.sev, ["blocking", "significant", "minor"]).map(([v, n]) => filterChip("sev", v, n, SEV_CLASS[v] || "todo")),
    el("span", { class: "dim" }, "·"),
    counts(c => c.out, ["Open", "Accepted", "Deferred", "Rebutted", "Dismissed", "Resolved"]).map(([v, n]) => filterChip("out", v, n, OUTCOME_CLASS[v] || "todo")));

  const intro = el("div", { class: "ch-intro" });
  intro.innerHTML = markdown(doc.intro.join("\n"));
  const root = el("div", { class: "md chview" });
  if (doc.title) root.append(rich("h1", "", doc.title));
  root.append(intro, bar, body);
  return root;
}

// ------------------------------------------------------------- task breakdown

// The shape tt-task-breakdown writes:
//   # <Feature>: Task Breakdown   (header bullets)   ## Overview
//   ## Work Units (table)         ## Task Map (table)      ## Units and Tasks
//   ## WU<n> — <outcome>          its plain English, a 2-column table, Validation checklist
//   ### T<nn> — <title>           its plain English, a 2-column table, Goal, Files, Steps …
//   ## Coverage                   ## Plan Verification Notes
// Which tasks are done is in the Task Status document (its Task Board and Work Unit Board).
const SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;
const col = (row, re) => { const k = Object.keys(row).find(k => re.test(k)); return k ? row[k] : ""; };

// The first table in lines, as rows keyed by lower-cased column name.
function firstTable(lines) {
  const at = lines.findIndex((l, i) => isTable(l) && i + 1 < lines.length && SEPARATOR.test(lines[i + 1]));
  if (at < 0) return [];
  const head = cells(lines[at]).map(h => h.toLowerCase());
  const rows = [];
  for (let i = at + 2; i < lines.length && isTable(lines[i]); i++) {
    const r = cells(lines[i]);
    rows.push(Object.fromEntries(head.map((h, j) => [h, r[j] || ""])));
  }
  return rows;
}

// A unit's or card's lines -> { plain: its "In plain English" text, meta: the rows of its
// "| **Key** | value |" table, body: the rest }.
function splitCard(lines) {
  const out = { plain: "", meta: {}, body: [] };
  let skipSeparator = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if (!out.plain && (m = l.match(/^\*\*In plain English:\*\*\s*(.*)$/))) {
      const buf = [m[1]];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(\||\*\*|#|-|\d+\.|`{3})/.test(lines[i + 1].trim())) buf.push(lines[++i].trim());
      out.plain = buf.join(" ").trim();
    } else if (/^\s*\|\s*\|\s*\|\s*$/.test(l)) skipSeparator = true; // the empty header of a key/value table
    else if (skipSeparator && SEPARATOR.test(l)) skipSeparator = false;
    else if ((m = l.match(/^\s*\|\s*\*\*([^*|]+)\*\*\s*\|(.*)\|\s*$/))) out.meta[m[1].trim().toLowerCase()] = m[2].trim();
    else out.body.push(l);
  }
  return out;
}

function parseBreakdown(src) {
  const lines = docLines(src);
  const doc = { title: "", head: [], overview: [], units: [], tail: [], mapNote: "" };
  const unitLines = [], mapLines = [];
  let where = "head", fence = "", unit = null, task = null;
  for (const l of lines) {
    const f = l.match(/^(`{3,})/);
    if (fence) { if (l.startsWith(fence) && /^`+\s*$/.test(l)) fence = ""; } else if (f) fence = f[1];
    let m;
    if (!fence && !f && (m = l.match(/^#\s+(.+)$/))) { if (!doc.title) doc.title = m[1]; continue; }
    if (!fence && !f && (m = l.match(/^##\s+(.+)$/))) {
      task = null;
      const heading = m[1], wu = heading.match(/^(WU\d\w*)\s*[—–:-]+\s*(.*)$/);
      if (/^overview\b/i.test(heading)) where = "overview";
      else if (/^work units\b/i.test(heading)) where = "units";
      else if (/^task map\b/i.test(heading)) where = "map";
      else if (/^units and tasks\b/i.test(heading)) where = "between";
      else if (wu) { doc.units.push(unit = { id: wu[1], name: wu[2].trim(), lines: [], tasks: [] }); where = "unit"; }
      else { doc.tail.push({ title: heading, lines: [] }); where = "tail"; }
      continue;
    }
    if (!fence && !f && where === "unit" && (m = l.match(/^###\s+(T\d\w*)\s*[—–:-]+\s*(.*)$/))) {
      unit.tasks.push(task = { id: m[1], title: m[2].trim(), lines: [] });
      continue;
    }
    if (where === "head") doc.head.push(l);
    else if (where === "overview") doc.overview.push(l);
    else if (where === "units") unitLines.push(l);
    else if (where === "map") mapLines.push(l);
    else if (where === "unit") (task || unit).lines.push(l);
    else if (where === "tail") doc.tail[doc.tail.length - 1].lines.push(l);
  }
  if (!doc.units.length) return null;
  const unitRows = firstTable(unitLines), taskRows = firstTable(mapLines);
  doc.mapNote = mapLines.filter(l => l.trim() && !isTable(l)).join(" ").trim();
  const card = x => Object.assign(x, splitCard(x.lines));
  const taskFacts = r => ({ executor: r.executor, "depends on": r["depends on"], "plan step": r["plan step"], "traces to": r["traces to"] });
  for (const u of doc.units) {
    card(u);
    const row = unitRows.find(r => r.id === u.id) || {};
    u.outcome = col(row, /^after|^outcome/);
    u.facts = { "validated by": col(row, /^validated/), "depends on": col(row, /^depends/), ...u.meta };
    for (const t of u.tasks) {
      card(t);
      t.facts = { ...taskFacts(taskRows.find(r => r.id === t.id) || {}), ...t.meta };
    }
    // a task in the Task Map that has no card of its own
    for (const r of taskRows) {
      if (r["work unit"] === u.id && !u.tasks.some(t => t.id === r.id)) {
        u.tasks.push({ id: r.id, title: r.task || "", plain: "", body: [], lines: [], meta: {}, facts: taskFacts(r) });
      }
    }
    u.tasks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }
  return doc;
}

// The Task Board and the Work Unit Board of a Task Status document ->
// { tasks: { T01: { status, notes } }, units: { WU1: { status } } }.
function parseStatus(src) {
  const sections = {};
  let cur = "", fence = false;
  for (const l of docLines(src)) {
    if (/^`{3,}/.test(l)) fence = !fence;
    const m = !fence && l.match(/^#{1,3}\s+(.+)$/);
    if (m) sections[cur = m[1].trim().toLowerCase()] = sections[cur] || [];
    else if (cur) sections[cur].push(l);
  }
  const board = name => Object.fromEntries(firstTable(sections[name] || []).filter(r => r.id).map(r => [r.id, { status: r.status || "", notes: r.notes || "" }]));
  return { tasks: board("task board"), units: board("work unit board") };
}

const STATUSES = ["Todo", "In Progress", "Ready to Validate", "Implemented", "Done", "Blocked", "Failed", "Dropped"];
const NOTHING = /^[—–-]*$/;
// "T01, T02" -> the same text with each ID a link to its ticket on this page
const linked = text => (text || "").replace(/\b(WU\d\w*|T\d\w*)\b/g, "[[#$1]]");

function breakdownView(src, ctx) {
  const doc = parseBreakdown(src);
  if (!doc) return null;
  const fragment = (cls, lines) => {
    const n = el("div", { class: cls });
    n.innerHTML = markdown(lines.join("\n").replace(/^(\s*)- \[ \]/gm, "$1- ☐").replace(/^(\s*)- \[[xX]\]/gm, "$1- ☑"));
    return n;
  };
  const factList = facts => {
    // (a ticket's work unit is the group it sits in)
    const rows = Object.entries(facts).filter(([k, v]) => k !== "work unit" && v && !NOTHING.test(v));
    if (!rows.length) return "";
    return el("dl", { class: "ch-facts" }, rows.flatMap(([k, v]) => [el("dt", {}, k[0].toUpperCase() + k.slice(1)),
      rich("dd", "", /^(depends on)$/.test(k) ? linked(v) : v)]));
  };
  const tasks = []; // { t, unit, row, slot, status }
  const units = []; // { u, row, slot, progress }

  const ticket = (u, t) => {
    const slot = el("span", { class: "tk-status" });
    const exec = (t.facts.executor || "").trim();
    const h = el("h3", { class: "tk-title", id: `h-${slug(`${t.id} ${t.title}`)}` }, el("span", { class: "ch-num" }, t.id), " ");
    h.append(rich("span", "", t.title));
    const row = el("details", { class: "tk" },
      el("summary", {}, h, exec ? chip(exec, /engineer/i.test(exec) ? "warn" : "todo") : "", slot,
        t.plain ? rich("span", "tk-plain dim small", t.plain) : ""),
      el("div", { class: "tk-body" },
        factList(t.facts),
        t.plain ? rich("p", "tk-plain-full", t.plain) : "",
        fragment("tk-card", t.body)));
    tasks.push({ t, unit: u, row, slot, status: "" });
    return row;
  };

  const group = u => {
    const slot = el("span", { class: "wu-status" }), progress = el("span", { class: "wu-progress" });
    const h = el("h2", { class: "wu-title", id: `h-${slug(`${u.id} ${u.name}`)}` }, el("span", { class: "ch-num" }, u.id), " ");
    h.append(rich("span", "", u.name || u.outcome));
    const row = el("details", { class: "wu", open: true },
      el("summary", {}, h, slot, progress, u.facts["validated by"] ? chip(u.facts["validated by"], "route") : ""),
      el("div", { class: "wu-body" },
        factList({ "depends on": u.facts["depends on"] }),
        u.plain ? rich("p", "", u.plain) : "",
        el("div", { class: "tickets" }, u.tasks.map(t => ticket(u, t))),
        // the unit's own text (its validation checklist and how to run it) sits below its tickets
        u.body.some(l => l.trim()) ? el("details", { class: "wu-validation" },
          el("summary", {}, el("strong", {}, "Validation of this unit")), fragment("wu-card", u.body)) : ""));
    units.push({ u, row, slot, progress });
    return row;
  };

  const root = el("div", { class: "md bdview" });
  if (doc.title) root.append(rich("h1", "", doc.title));
  if (doc.head.some(l => l.trim())) root.append(fragment("bd-head", doc.head));
  if (doc.overview.some(l => l.trim())) root.append(el("h2", { id: "h-overview" }, "Overview"), fragment("bd-overview", doc.overview));
  if (doc.mapNote) root.append(rich("p", "dim small", doc.mapNote));

  const summary = el("div", { class: "ch-summary" });
  const toggle = open => () => { for (const d of root.querySelectorAll("details")) d.open = open; };
  root.append(
    el("div", { class: "bd-toolbar" },
      el("button", { type: "button", onclick: toggle(true) }, "Expand all"),
      el("button", { type: "button", onclick: toggle(false) }, "Collapse all"), summary),
    el("div", { class: "bd-units" }, doc.units.map(group)));
  for (const s of doc.tail) {
    root.append(el("details", { class: "bd-tail" }, el("summary", {}, el("h2", { id: `h-${slug(s.title)}` }, s.title)), fragment("tk-body", s.lines)));
  }

  // Who is done: the Task Status document's boards. Without it there are no status chips.
  let filter = "";
  const apply = () => {
    for (const x of tasks) x.row.classList.toggle("hidden", !!filter && x.status !== filter);
    for (const x of units) x.row.classList.toggle("hidden", !!filter && !x.row.querySelector(".tk:not(.hidden)"));
    for (const b of summary.querySelectorAll("button.ch-filter")) b.classList.toggle("on", b.dataset.value === filter);
  };
  const showStatus = st => {
    for (const x of tasks) {
      const s = st.tasks[x.t.id];
      if (!s || !s.status) continue;
      x.status = s.status;
      x.slot.replaceChildren(chip(s.status, statusClass(s.status)));
      if (s.notes && !NOTHING.test(s.notes)) x.row.querySelector(".tk-body").prepend(rich("p", "dim small", `Status note: ${s.notes}`));
    }
    const isDone = t => /^done$/i.test(t.status);
    for (const x of units) {
      const mine = tasks.filter(t => t.unit === x.u), board = st.units[x.u.id];
      const done = mine.filter(isDone).length;
      if (board && board.status) x.slot.replaceChildren(chip(board.status, statusClass(board.status)));
      x.progress.replaceChildren(bar(done, mine.length, `${done} of ${mine.length} done`));
    }
    const counts = new Map();
    for (const x of tasks) if (x.status) counts.set(x.status, (counts.get(x.status) || 0) + 1);
    const rank = v => (STATUSES.includes(v) ? STATUSES.indexOf(v) : STATUSES.length);
    const done = tasks.filter(isDone).length;
    summary.replaceChildren(
      bar(done, tasks.length, `${done} of ${tasks.length} tasks done`),
      ...[...counts].sort((a, b) => rank(a[0]) - rank(b[0])).map(([v, n]) => el("button", {
        type: "button", class: `chip ch-filter ${statusClass(v)}`, "data-value": v, title: `Show only ${v}`,
        onclick: () => { filter = filter === v ? "" : v; apply(); },
      }, `${n} ${v}`)));
  };
  if (ctx && ctx.sibling) {
    ctx.sibling("Task Status").then(text => { if (text) showStatus(parseStatus(text)); }, () => {});
  }
  return root;
}
