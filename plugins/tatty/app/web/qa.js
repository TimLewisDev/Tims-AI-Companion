// The QA mode's pages (server.py "QA"):
//   #qa                          the home: features under test, and the bugs
//   #qa/bug/new · #qa/bug/<ID>   one bug: described in plain English, drafted, reviewed, saved
//   #qa/test/<feature>           a feature's dashboard: what is tested, passed, failed
//   #qa/test/<feature>/<A1>      one area's checklist: how to test each item, and its result
// Every document is written by the toolbox's qa scripts; this page only sends what the tester typed
// or chose, and shows what the server read back. A model run only drafts (a bug's fields, or a
// plan's areas) for the tester to read and change.
// Uses app.js's el and api, and features.js's bar, route and parseRoute.
"use strict";

const qaClient = Math.random().toString(36).slice(2, 10);
const QA_SEVERITIES = ["Critical", "Major", "Minor", "Trivial"];
const QA_STATUSES = ["New", "Confirmed", "Fixed", "Verified", "Closed", "Wont fix"];
const QA_SEV_CLASS = { Critical: "bad", Major: "now", Minor: "todo", Trivial: "skip" };
const QA_RES_CLASS = { pass: "done", fail: "bad", blocked: "now", skip: "skip", untested: "todo" };
const QA_RES_LABEL = { pass: "Passed", fail: "Failed", blocked: "Blocked", skip: "Skipped", untested: "Not tested" };
const qaRunId = () => "qa" + Math.random().toString(36).slice(2, 12);

let qaPrefill = null;      // a bug form's starting values, set by "Raise a bug" on a failed item
const qaRuns = new Map();  // run id -> what to do with the model's answer

// The model's answers (and another window's changes) come as "qa" events.
document.addEventListener("tt-event", e => {
  const ev = e.detail;
  if (ev.type !== "qa") return;
  if (ev.done && qaRuns.has(ev.runId)) { const cb = qaRuns.get(ev.runId); qaRuns.delete(ev.runId); cb(ev); return; }
  if (ev.client === qaClient || ev.done) return;
  const r = parseRoute();
  if ((ev.kind === "bugs" && r.page === "qa") || (ev.kind === "plan" && r.page === "qaplan" && r.name === ev.feature)) {
    clearTimeout(qaRefreshTimer);
    qaRefreshTimer = setTimeout(route, 250);
  }
});
let qaRefreshTimer = 0;

// Jira's answer to "Create in Jira" is a "jira" event for the job named after the bug.
const qaJiraJobs = new Map(); // "qabug:<ID>" -> what to do when Jira has answered
document.addEventListener("tt-event", e => {
  const ev = e.detail;
  if (ev.type === "jira" && !ev.busy && qaJiraJobs.has(ev.job)) { const cb = qaJiraJobs.get(ev.job); qaJiraJobs.delete(ev.job); cb(ev); }
});

// A line of small text that says how something went: (text, bad) -> the node's text and colour.
const qaSayTo = node => (text, bad) => { node.textContent = text; node.className = "small " + (bad ? "st missing" : "dim"); };

// The same work in a Claude session, with the toolbox's qa skills (/tt-qa-bug, /tt-qa-test-plan, /tt-qa-test-run).
// body is the request, or a function giving it when the button is pressed.
function qaSessionButton(label, body, say) {
  const b = el("button", { type: "button", class: "qa-session" }, label);
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      const r = await api("/api/qa/session", typeof body === "function" ? body() : body);
      say(r.ok ? `Opened a Claude session: ${r.name}. Come back here when it has saved something, then reload.` : `Couldn't open it: ${r.said}`, !r.ok);
    } catch (e) { say(String(e.message || e), true); }
    b.disabled = false;
  });
  return b;
}

const qaTested = c => (c.pass || 0) + (c.fail || 0) + (c.blocked || 0) + (c.skip || 0);
const qaChip = (text, cls) => el("span", { class: "chip " + (cls || "") }, text);
const qaNote = text => el("p", { class: "pad st missing" }, text);
const qaBugHref = id => "#qa/bug/" + encodeURIComponent(id);
const qaPlanHref = (feature, area) => "#qa/test/" + encodeURIComponent(feature) + (area ? "/" + encodeURIComponent(area) : "");

// The progress bar of a plan's counts: warns when anything failed.
function qaBar(c) {
  const total = c.items || 0, done = qaTested(c);
  const b = bar(done, total, total ? `${done} of ${total} tested` : "no items yet");
  if (!b) return el("span", { class: "dim small" }, "no items yet");
  if (c.fail) b.classList.add("bad"); else if (c.blocked) b.classList.add("warn");
  return b;
}

const qaTiles = c => el("div", { class: "tstats" }, [
  ["Items", c.items || 0], ["Tested", c.items ? Math.round(100 * qaTested(c) / c.items) + "%" : "0%"],
  ["Passed", c.pass || 0], ["Failed", c.fail || 0], ["Blocked", c.blocked || 0], ["Skipped", c.skip || 0],
  ["Not tested", c.untested || 0],
].map(([k, v]) => el("div", { class: "tstat qa-tile-" + k.toLowerCase().replace(" ", "-") }, el("strong", {}, v), el("span", { class: "small dim" }, k))));

// ------------------------------------------------------------- #qa: the home

async function renderQa(box) {
  box.replaceChildren(el("p", { class: "pad dim" }, "Reading…"));
  let d, feats;
  try { [d, feats] = await Promise.all([api("/api/qa"), api("/api/features").catch(() => ({ features: [] }))]); }
  catch (e) { box.replaceChildren(qaNote(String(e.message || e))); return; }
  const head = el("div", { class: "home-head" }, el("div", {}, el("h2", {}, "QA"),
    el("div", { class: "dim small" }, "Test a feature area by area, and write up the bugs you find.")),
    el("span", { class: "spacer" }),
    el("a", { class: "button primary", id: "qa-new-bug", href: "#qa/bug/new" }, "New bug"));
  const kids = [head];
  if (!d.available) kids.push(el("p", { class: "home-note small st missing" }, d.missing));

  // Features under test, and a way to start another.
  const withPlan = new Set(d.plans.map(p => p.feature));
  const free = (feats.features || []).filter(f => !withPlan.has(f.name));
  const pick = el("select", { id: "qa-feature", "aria-label": "Feature to test" },
    el("option", { value: "" }, "Choose a feature…"),
    free.map(f => el("option", { value: f.name }, f.title ? `${f.name} · ${f.title}` : f.name)));
  const msg = el("span", { class: "small st missing" });
  const start = el("button", { type: "button", id: "qa-start", class: "primary" }, "Start testing");
  start.addEventListener("click", async () => {
    if (!pick.value) { msg.textContent = "Choose a feature first."; return; }
    start.disabled = true;
    try {
      await api("/api/qa/plan", { feature: pick.value, op: "start", client: qaClient });
      location.hash = qaPlanHref(pick.value);
    } catch (e) { msg.textContent = String(e.message || e); start.disabled = false; }
  });
  kids.push(el("h3", { class: "qa-h" }, "Features under test"),
    d.plans.length ? el("div", { class: "fgrid" }, d.plans.map(p => el("a", { class: "fcard qa-plan", href: qaPlanHref(p.feature) },
      el("div", { class: "fcard-top" }, el("strong", {}, p.feature), qaChip(p.status || "Draft", p.status === "Ready" ? "now" : "todo")),
      p.title ? el("p", { class: "ftext" }, p.title) : "", qaBar(p.counts || {}),
      el("span", { class: "small dim" }, `${p.counts.pass || 0} passed · ${p.counts.fail || 0} failed · ${p.counts.untested || 0} to go`))))
      : el("p", { class: "dim small" }, "Nothing is being tested yet."),
    el("div", { class: "qa-row" }, pick, start, msg));

  // The bugs.
  const filter = el("select", { id: "qa-status", "aria-label": "Show bugs" },
    el("option", { value: "open" }, "Open"), el("option", { value: "all" }, "All"),
    QA_STATUSES.map(s => el("option", { value: s }, s)));
  const list = el("div", { class: "qa-bugs" });
  const draw = () => {
    const want = filter.value;
    const rows = d.bugs.filter(b => want === "all" || (want === "open" ? !["Closed", "Verified", "Wont fix"].includes(b.status) : b.status === want));
    list.replaceChildren(rows.length ? el("table", { class: "qa-table" },
      el("thead", {}, el("tr", {}, ["ID", "Bug", "Severity", "Status", "Feature", "Jira"].map(h => el("th", {}, h)))),
      el("tbody", {}, rows.map(b => el("tr", { "data-bug": b.id },
        el("td", {}, el("a", { href: qaBugHref(b.id) }, b.id)), el("td", {}, el("a", { href: qaBugHref(b.id) }, b.title)),
        el("td", {}, qaChip(b.severity, QA_SEV_CLASS[b.severity])), el("td", {}, b.status),
        el("td", { class: "dim" }, b.feature || ""), el("td", { class: "dim" }, b.jira || "")))))
      : el("p", { class: "dim small" }, d.bugs.length ? "No bugs match." : "No bugs yet."));
  };
  filter.addEventListener("change", draw);
  draw();
  kids.push(el("div", { class: "qa-row" }, el("h3", { class: "qa-h" }, "Bugs"), el("span", { class: "spacer" }), filter), list);
  box.replaceChildren(el("div", { class: "pad qa-home" }, kids));
}

// ------------------------------------------------------------- #qa/bug/<ID|new>

const QA_FIELD_LABELS = { title: "Title", summary: "Summary", steps: "Steps to reproduce", expected: "Expected result",
  actual: "Actual result", environment: "Environment", evidence: "Evidence", feature: "Feature", area: "Area", source: "Source test" };

// The bug as plain text, to paste into an issue tracker.
function qaBugText(b) {
  const steps = (b.steps || "").split("\n").filter(s => s.trim());
  return [`${b.id ? b.id + ": " : ""}${b.title}`, "", `Severity: ${b.severity}`,
    b.feature ? `Feature: ${b.feature}${b.area ? " / " + b.area : ""}` : "", b.environment ? `Environment: ${b.environment}` : "",
    "", "Summary", b.summary, "", "Steps to reproduce", ...steps.map((s, i) => /^\d+\./.test(s) ? s : `${i + 1}. ${s}`),
    "", "Expected result", b.expected, "", "Actual result", b.actual, b.evidence ? "\nEvidence\n" + b.evidence : ""]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

async function renderQaBug(box, id) {
  const fresh = id === "new";
  let bug = { severity: "Major", status: "New" }, hash = "", prefill = null;
  if (fresh) { prefill = qaPrefill; qaPrefill = null; if (prefill) bug = { ...bug, ...prefill.fields }; }
  else {
    box.replaceChildren(el("p", { class: "pad dim" }, "Reading…"));
    try { bug = await api("/api/qa/bug?id=" + encodeURIComponent(id)); hash = bug.hash; }
    catch (e) { box.replaceChildren(qaNote(String(e.message || e))); return; }
  }
  const f = {}; // field name -> input
  const field = (name, tag = "input", rows = 3) => {
    const n = tag === "textarea" ? el("textarea", { rows, id: "qa-f-" + name, spellcheck: "true" }) : el("input", { id: "qa-f-" + name, type: "text" });
    n.value = bug[name] || "";
    f[name] = n;
    return el("label", { class: "qa-field" }, el("span", { class: "small dim" }, QA_FIELD_LABELS[name]), n);
  };
  const sev = el("select", { id: "qa-f-severity" }, QA_SEVERITIES.map(s => el("option", { value: s }, s)));
  sev.value = QA_SEVERITIES.includes(bug.severity) ? bug.severity : "Major";
  const msg = el("p", { class: "small", id: "qa-msg" });
  const say = (text, bad) => { msg.textContent = text; msg.className = "small " + (bad ? "st missing" : "dim"); };

  // Step 1: the description, in the tester's words.
  const desc = el("textarea", { id: "qa-desc", rows: 5, placeholder: "What did you do, what did you expect, what happened? Plain words are fine." });
  const draftBtn = el("button", { type: "button", id: "qa-draft", class: "primary" }, "Draft it with Claude");
  const stopBtn = el("button", { type: "button", hidden: true }, "Stop");
  const stated = el("div", { class: "qa-notstated" });
  let runId = "";
  draftBtn.addEventListener("click", async () => {
    if (!desc.value.trim()) { say("Describe the bug first.", true); return; }
    runId = qaRunId();
    draftBtn.disabled = true; stopBtn.hidden = false;
    say("Claude is drafting the bug…");
    qaRuns.set(runId, ev => {
      runId = ""; draftBtn.disabled = false; stopBtn.hidden = true;
      if (!ev.ok) { say(ev.error === "Stopped." ? "Stopped." : `Couldn't draft it: ${ev.error}`, ev.error !== "Stopped."); return; }
      const r = ev.result.fields;
      for (const k of Object.keys(f)) if (r[k] !== undefined && (r[k] || !f[k].value)) f[k].value = r[k];
      sev.value = r.severity;
      stated.replaceChildren(ev.result.notStated.length ? el("div", {}, el("span", { class: "small dim" }, "Not in your description: "),
        ev.result.notStated.map(s => qaChip(s, "todo"))) : "");
      say(`Drafted${ev.cost ? ` for $${ev.cost.toFixed(2)}` : ""}. Read it, change what is wrong, then save.`);
    });
    try {
      await api("/api/qa/bug/draft", { runId, client: qaClient, description: desc.value, feature: f.feature.value.trim(),
        area: f.area.value.trim(), source: f.source.value.trim(), environment: f.environment.value.trim() });
    } catch (e) { qaRuns.delete(runId); draftBtn.disabled = false; stopBtn.hidden = true; say(String(e.message || e), true); }
  });
  stopBtn.addEventListener("click", () => { if (runId) api("/api/qa/run-cancel", { runId }).catch(() => {}); });

  const save = el("button", { type: "button", id: "qa-save", class: "primary" }, fresh ? "Save bug" : "Save changes");
  save.addEventListener("click", async () => {
    const body = { client: qaClient, severity: sev.value, id: fresh ? "" : id, hash };
    for (const k of Object.keys(f)) body[k] = f[k].value;
    save.disabled = true;
    try {
      const saved = await api("/api/qa/bug/save", body);
      if (prefill && prefill.item) { // the failed item points at its bug
        await api("/api/qa/plan", { feature: prefill.item.feature, op: "check", id: prefill.item.id, result: "fail",
          note: prefill.item.note, bug: saved.id, client: qaClient }).catch(() => {});
      }
      if (fresh) location.hash = qaBugHref(saved.id);
      else { bug = saved; hash = saved.hash; say("Saved."); save.disabled = false; }
    } catch (e) { say(String(e.message || e), true); save.disabled = false; }
  });

  const parts = [
    el("div", { class: "home-head" }, el("div", {}, el("a", { href: "#qa", class: "small" }, "← QA"),
      el("h2", {}, fresh ? "New bug" : `${bug.id}: ${bug.title}`))),
  ];
  if (prefill && prefill.item) parts.push(el("p", { class: "small dim" },
    `From ${prefill.item.feature}, item ${prefill.item.id}: the bug will be linked to the failed item when you save it.`));
  if (fresh) parts.push(el("div", { class: "qa-step" }, el("h3", { class: "qa-h" }, "1. Say what went wrong"), desc,
    el("div", { class: "qa-row" }, draftBtn, stopBtn,
      qaSessionButton("Talk it through in Claude", () => ({ kind: "bug", description: desc.value, feature: f.feature.value.trim() }), say),
      el("span", { class: "dim small" }, "or fill the form below yourself")), stated));
  parts.push(el("div", { class: "qa-step" }, el("h3", { class: "qa-h" }, fresh ? "2. Check the bug" : "The bug"),
    field("title"),
    el("div", { class: "qa-cols" }, el("label", { class: "qa-field" }, el("span", { class: "small dim" }, "Severity"), sev),
      field("feature"), field("area"), field("source")),
    field("summary", "textarea", 2), field("steps", "textarea", 5), field("expected", "textarea", 2), field("actual", "textarea", 2),
    field("environment", "textarea", 2), field("evidence", "textarea", 2),
    el("div", { class: "qa-row" }, save)));
  if (!fresh) {
    const status = el("select", { id: "qa-status-set" }, QA_STATUSES.map(s => el("option", { value: s }, s)));
    status.value = bug.status;
    status.addEventListener("change", async () => {
      try { bug = await api("/api/qa/bug/set", { id, field: "status", value: status.value, hash, client: qaClient }); hash = bug.hash; say("Status set."); }
      catch (e) { say(String(e.message || e), true); status.value = bug.status; }
    });
    const jira = el("input", { id: "qa-jira", type: "text", value: bug.jira || "", placeholder: "STAR-1234", size: 14 });
    jira.addEventListener("change", async () => {
      if (!jira.value.trim()) return;
      try { bug = await api("/api/qa/bug/set", { id, field: "jira", value: jira.value.trim(), hash, client: qaClient }); hash = bug.hash; say("Jira key kept."); }
      catch (e) { say(String(e.message || e), true); }
    });
    const copy = el("button", { type: "button", id: "qa-copy" }, "Copy as text");
    copy.addEventListener("click", () => { navigator.clipboard.writeText(qaBugText(bug)); say("Copied: paste it into Jira or GitLab."); });
    // Create it in Jira: the project is asked once and remembered here.
    const proj = el("input", { id: "qa-jira-project", type: "text", size: 8, placeholder: "STAR", "aria-label": "Jira project key" });
    try { proj.value = localStorage.getItem("tt-qa-jira-project") || ""; } catch { /* not remembered */ }
    const make = el("button", { type: "button", id: "qa-jira-create" }, "Create in Jira");
    const jiraOn = () => { proj.hidden = make.hidden = !!bug.jira; };
    jiraOn();
    make.addEventListener("click", async () => {
      const project = proj.value.trim().toUpperCase();
      if (!project) { say("Which Jira project? Type its key (like STAR) first.", true); return; }
      try { localStorage.setItem("tt-qa-jira-project", project); } catch { /* not remembered */ }
      make.disabled = true;
      say("Creating it in Jira… this can take a minute.");
      qaJiraJobs.set("qabug:" + id, ev => {
        make.disabled = false;
        if (!ev.ok) { say(`Jira didn't take it: ${ev.error}`, true); return; }
        bug.jira = ev.key; jira.value = ev.key; jiraOn();
        say(ev.message);
      });
      try { await api("/api/qa/bug/jira", { id, project, client: qaClient }); }
      catch (e) { qaJiraJobs.delete("qabug:" + id); make.disabled = false; say(String(e.message || e), true); }
    });
    parts.push(el("div", { class: "qa-step qa-row" }, el("label", { class: "small dim" }, "Status "), status,
      el("label", { class: "small dim" }, "Jira "), jira, proj, make, copy));
  }
  parts.push(msg);
  box.replaceChildren(el("div", { class: "pad qa-bug" }, parts));
  (fresh ? desc : f.title).focus();
}

// ------------------------------------------------------------- #qa/test/<feature>: the dashboard

async function qaPlanCall(body) { return api("/api/qa/plan", { client: qaClient, ...body }); }

async function renderQaPlan(box, feature, areaId) {
  box.replaceChildren(el("p", { class: "pad dim" }, "Reading…"));
  let plan;
  try { plan = await api("/api/qa/plan?feature=" + encodeURIComponent(feature)); }
  catch (e) {
    box.replaceChildren(el("div", { class: "pad" }, el("a", { href: "#qa", class: "small" }, "← QA"), qaNote(String(e.message || e))));
    return;
  }
  const again = () => route();
  const area = areaId && plan.areas.find(a => a.id === areaId);
  if (areaId && !area) { location.hash = qaPlanHref(feature); return; }
  const status = plan.meta.status || "Draft";
  const setStatus = el("button", { type: "button", id: "qa-ready" }, status === "Ready" ? "Back to draft" : "Mark ready to test");
  setStatus.addEventListener("click", async () => { try { await qaPlanCall({ feature, op: "status", status: status === "Ready" ? "Draft" : "Ready" }); again(); } catch (e) { alert(e.message); } });
  const head = el("div", { class: "home-head" }, el("div", {},
    el("a", { href: area ? qaPlanHref(feature) : "#qa", class: "small" }, area ? `← ${feature}` : "← QA"),
    el("h2", {}, area ? `${area.id} · ${area.title}` : feature), el("div", { class: "dim small" }, area ? (area.why || "") : (plan.title || ""))),
    el("span", { class: "spacer" }), area ? "" : [qaChip(status, status === "Ready" ? "now" : "todo"), setStatus]);
  const body = area ? qaAreaView(plan, area, again) : qaDashboardView(plan, again);
  box.replaceChildren(el("div", { class: "pad qa-plan-page" }, head, body));
}

function qaDashboardView(plan, again) {
  const feature = plan.feature, c = plan.counts || {};
  const kids = [];
  // No areas yet: have Claude propose them from the feature's documents, or add one by hand.
  const draftBox = el("div", { class: "qa-step", id: "qa-draft-box" });
  if (!plan.areas.length) {
    const note = el("textarea", { id: "qa-plan-note", rows: 2, placeholder: "Anything else Claude should know about the feature (optional)" });
    const btn = el("button", { type: "button", id: "qa-plan-draft", class: "primary" }, "Break it into areas with Claude");
    const stop = el("button", { type: "button", hidden: true }, "Stop");
    const say = el("p", { class: "small dim" });
    let runId = "";
    btn.addEventListener("click", async () => {
      runId = qaRunId(); btn.disabled = true; stop.hidden = false; say.className = "small dim";
      say.textContent = "Claude is reading the feature's documents and drafting areas… this can take a few minutes.";
      qaRuns.set(runId, ev => {
        runId = ""; btn.disabled = false; stop.hidden = true;
        if (!ev.ok) { say.className = "small st missing"; say.textContent = ev.error === "Stopped." ? "Stopped." : `Couldn't draft the plan: ${ev.error}`; return; }
        qaPlanNotes = ev.result.notSpecified || [];
        again();
      });
      try { await api("/api/qa/plan/draft", { runId, client: qaClient, feature, note: note.value }); }
      catch (e) { qaRuns.delete(runId); btn.disabled = false; stop.hidden = true; say.className = "small st missing"; say.textContent = String(e.message || e); }
    });
    stop.addEventListener("click", () => { if (runId) api("/api/qa/run-cancel", { runId }).catch(() => {}); });
    draftBox.append(el("h3", { class: "qa-h" }, "Areas to validate"),
      el("p", { class: "small dim" }, "Claude reads this feature's documents and proposes areas, each with test items. You can change all of it afterwards."),
      note, el("div", { class: "qa-row" }, btn, stop, qaSessionButton("Plan it in a Claude session", { kind: "plan", feature }, qaSayTo(say)),
        el("span", { class: "dim small" }, "or add the areas yourself below")), say);
    kids.push(draftBox);
  } else {
    if (qaPlanNotes.length) {
      kids.push(el("div", { class: "qa-step" }, el("strong", {}, "The documents don't say"),
        el("ul", {}, qaPlanNotes.map(n => el("li", {}, n)))));
      qaPlanNotes = [];
    }
    const sessionMsg = el("span", { class: "small dim" });
    kids.push(el("div", { class: "qa-row" }, qaSessionButton("Test it in a Claude session", { kind: "run", feature }, qaSayTo(sessionMsg)), sessionMsg),
      qaTiles(c), qaBar(c));
    const openFails = [];
    for (const a of plan.areas) for (const it of a.items) if (it.result === "fail" && !it.bug) openFails.push({ a, it });
    kids.push(el("h3", { class: "qa-h" }, "Areas"), el("div", { class: "qa-areas" }, plan.areas.map(a => el("a", { class: "qa-area", href: qaPlanHref(feature, a.id), "data-area": a.id },
      el("strong", {}, `${a.id} · ${a.title}`), qaBar({ items: (a.counts || {}).items, ...(a.counts || {}) }),
      el("span", { class: "small dim" }, `${(a.counts || {}).pass || 0} passed · ${(a.counts || {}).fail || 0} failed · ${(a.counts || {}).blocked || 0} blocked · ${(a.counts || {}).untested || 0} to go`)))));
    if (openFails.length) kids.push(el("h3", { class: "qa-h" }, "Failed, no bug yet"), el("ul", { class: "qa-fails" }, openFails.map(({ a, it }) =>
      el("li", {}, el("a", { href: qaPlanHref(feature, a.id) }, `${it.id} ${it.title}`), " ", qaRaiseButton(feature, a, it)))));
    const bugged = [];
    for (const a of plan.areas) for (const it of a.items) if (it.bug) bugged.push(it);
    if (bugged.length) kids.push(el("h3", { class: "qa-h" }, "Bugs from this test"), el("ul", { class: "qa-fails" },
      bugged.map(it => el("li", {}, el("a", { href: qaBugHref(it.bug) }, it.bug), ` · ${it.id} ${it.title}`))));
  }
  kids.push(qaAddArea(feature, again));
  return el("div", {}, kids);
}
let qaPlanNotes = []; // what the documents didn't say, shown once after a draft

function qaAddArea(feature, again) {
  const title = el("input", { type: "text", id: "qa-area-title", placeholder: "New area (a flow, a screen, a rule…)", size: 36 });
  const why = el("input", { type: "text", id: "qa-area-why", placeholder: "Why it needs testing (optional)", size: 36 });
  const msg = el("span", { class: "small st missing" });
  const add = el("button", { type: "button", id: "qa-area-add" }, "Add area");
  add.addEventListener("click", async () => {
    if (!title.value.trim()) { msg.textContent = "Give the area a title."; return; }
    try { await qaPlanCall({ feature, op: "area-add", title: title.value, why: why.value }); again(); }
    catch (e) { msg.textContent = String(e.message || e); }
  });
  return el("div", { class: "qa-row qa-addrow" }, title, why, add, msg);
}

// Pre-fill the bug form from a failed item and go to it.
function qaRaise(feature, area, it) {
  qaPrefill = { item: { feature, id: it.id, note: it.note || "" }, fields: {
    title: `${it.title} fails`, feature, area: `${area.id} ${area.title}`, source: it.id, severity: "Major",
    summary: `Failed while testing ${feature}, ${area.id} ${area.title}, item ${it.id}: ${it.title}.`,
    steps: it.how || "", expected: it.expect || "", actual: it.note || "" } };
  location.hash = "#qa/bug/new";
}
const qaRaiseButton = (feature, area, it) =>
  el("button", { type: "button", class: "qa-raise", "data-item": it.id, onclick: () => qaRaise(feature, area, it) }, "Raise a bug");

// ------------------------------------------------------------- #qa/test/<feature>/<A1>: one area

function qaAreaView(plan, area, again) {
  const feature = plan.feature;
  const items = area.items.map(it => qaItemCard(feature, area, it, again));
  const kids = [qaBar({ items: (area.counts || {}).items, ...(area.counts || {}) }),
    el("div", { class: "qa-items" }, items.length ? items : el("p", { class: "dim small" }, "No test items in this area yet."))];
  const title = el("input", { type: "text", id: "qa-item-title", placeholder: "New test item: what is checked", size: 40 });
  const how = el("textarea", { id: "qa-item-how", rows: 3, placeholder: "How to test: one step per line" });
  const expect = el("textarea", { id: "qa-item-expect", rows: 2, placeholder: "Expected: what a pass looks like" });
  const msg = el("span", { class: "small st missing" });
  const add = el("button", { type: "button", id: "qa-item-add" }, "Add item");
  add.addEventListener("click", async () => {
    try { await qaPlanCall({ feature, op: "item-add", id: area.id, title: title.value, how: how.value, expect: expect.value }); again(); }
    catch (e) { msg.textContent = String(e.message || e); }
  });
  kids.push(el("div", { class: "qa-step" }, title, how, expect, el("div", { class: "qa-row" }, add, msg)));
  const rm = el("button", { type: "button", class: "qa-quiet", id: "qa-area-remove" }, "Remove this area");
  rm.addEventListener("click", async () => {
    if (!confirm(`Remove ${area.id} ${area.title} and its items?`)) return;
    try { await qaPlanCall({ feature, op: "remove", id: area.id, force: area.items.some(i => i.result !== "untested") && confirm("Some items have results. Remove it anyway?") }); location.hash = qaPlanHref(feature); }
    catch (e) { msg.textContent = String(e.message || e); }
  });
  kids.push(el("div", { class: "qa-row" }, rm));
  return el("div", {}, kids);
}

function qaItemCard(feature, area, it, again) {
  const steps = (it.how || "").split("\n").filter(s => s.trim());
  const note = el("input", { type: "text", class: "qa-note", placeholder: "Note (what you saw)", value: it.note || "", size: 40 });
  const msg = el("span", { class: "small st missing" });
  const mark = async result => {
    try { await qaPlanCall({ feature, op: "check", id: it.id, result, note: note.value, bug: result === "fail" || result === "blocked" ? it.bug : "" }); again(); }
    catch (e) { msg.textContent = String(e.message || e); }
  };
  const buttons = [["pass", "Pass"], ["fail", "Fail"], ["blocked", "Blocked"], ["skip", "Skip"]].map(([r, label]) =>
    el("button", { type: "button", class: "qa-res qa-res-" + r + (it.result === r ? " on" : ""), "data-result": r, onclick: () => mark(r) }, label));
  if (it.result !== "untested") buttons.push(el("button", { type: "button", class: "qa-quiet", "data-result": "reset", onclick: () => mark("reset") }, "Reset"));
  const card = el("div", { class: "qa-item " + QA_RES_CLASS[it.result], "data-item": it.id },
    el("div", { class: "qa-item-head" }, el("strong", {}, `${it.id} · ${it.title}`), qaChip(QA_RES_LABEL[it.result], QA_RES_CLASS[it.result])),
    el("details", { open: it.result === "untested" }, el("summary", { class: "small dim" }, "How to test"),
      el("ol", {}, steps.map(s => el("li", {}, s.replace(/^\d+\.\s*/, "")))),
      el("p", { class: "small" }, el("strong", {}, "Expected: "), it.expect)),
    el("div", { class: "qa-row" }, buttons, note, msg),
    it.bug ? el("p", { class: "small" }, "Bug: ", el("a", { href: qaBugHref(it.bug) }, it.bug))
      : it.result === "fail" ? el("p", { class: "small" }, qaRaiseButton(feature, area, it)) : "");
  return card;
}
