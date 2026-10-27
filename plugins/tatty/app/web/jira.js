// Tatty's Jira board (#jira, the production mode's page): the person's
// open-sprint tickets in a column per status, as the sprint board has them. A
// ticket opens in a panel to read; Start workflow makes it a feature (a folder
// with the ticket as a document), opens a Claude session on it and moves the
// ticket to In Progress. The server reads Jira through a headless claude run
// (server.py's "Jira"), which spends tokens, so the board is the one it kept
// and is fetched again only on Refresh or Load.
// Uses app.js's $, el, api and mdNode, and features.js's ago, chip, featureHref and pickFolder.
"use strict";

let jiraBox = null;   // the page's element while it is on screen
let jiraNow = null;   // the last /api/jira answer
let jiraOpen = "";    // the key of the ticket in the panel, "" for none
let jiraNote = null;  // {text, bad}: how the last job went, said once under the header
const jiraDetail = new Map(); // key -> the last /api/jira/issue answer
const JIRA_CATS = ["todo", "inprogress", "done"];

const jiraBusy = job => !!jiraNow && (jiraNow.busy || []).includes(job);
const jiraIssue = key => (jiraNow && jiraNow.issues || []).find(i => i.key === key);
// The folder name the server gives a ticket's feature when none is typed.
const jiraName = i => {
  const s = (i.summary || "").replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, "");
  return s ? `${i.key} - ${s}`.slice(0, 70).replace(/[ .-]+$/, "") : i.key;
};
const typeClass = t => /bug/i.test(t) ? "bad" : /story/i.test(t) ? "done" : "now";
// How long a job has been running, counted up each second (the server says when it began).
const jiraSince = job => el("span", { class: "jsince", "data-since": String((jiraNow.since || {})[job] || Date.now() / 1000) });
function tickSince() {
  for (const s of document.querySelectorAll(".jsince")) s.textContent = `${Math.max(0, Math.round(Date.now() / 1000 - Number(s.dataset.since)))} s`;
}
setInterval(tickSince, 1000);

async function renderJira(box) {
  jiraBox = box;
  try { jiraNow = await api("/api/jira"); } catch (e) {
    box.replaceChildren(el("div", { class: "jira-page pad" }, el("p", {}, "Can't read the board: " + e.message)));
    return;
  }
  drawJira();
}

// Columns by status, in the order of their category (to do, under way, done),
// and within one, in the order the tickets first use them (Jira's rank).
function jiraColumns(issues) {
  const cols = new Map();
  for (const i of issues) {
    const name = i.status || "No status";
    if (!cols.has(name)) cols.set(name, { name, cat: i.statusCategory, issues: [] });
    cols.get(name).issues.push(i);
  }
  return [...cols.values()].sort((a, b) => JIRA_CATS.indexOf(a.cat) - JIRA_CATS.indexOf(b.cat));
}

function drawJira() {
  if (!jiraBox || !jiraNow) return;
  const b = jiraNow, busy = jiraBusy("board");
  const refresh = el("button", { type: "button", id: "jira-refresh", class: "primary", onclick: refreshJira },
    busy ? "Refreshing…" : "Refresh");
  refresh.disabled = busy;
  const cost = b.usage ? ` · ${Math.round(b.usage.tokens / 1000)}k tokens, ${Math.round(b.usage.seconds)} s` : "";
  const head = el("div", { class: "home-head" },
    el("div", {},
      el("h2", {}, "Jira"),
      el("div", { class: "dim small" }, "Your tickets in the open sprints",
        b.site ? ` on ${b.site}` : "", b.fetchedAt ? `, fetched ${ago(b.fetchedAt)}${cost}` : ""),
      el("div", { class: "dim small jql", title: "Change it in Settings" }, b.jql)),
    el("div", { class: "actions" }, refresh));
  const said = [];
  // What is running now: each is a headless claude run, which takes a while.
  if (busy) said.push(el("p", { class: "home-note small jprogress", id: "jira-progress" },
    "Asking Claude to read your tickets from Jira… ", jiraSince("board"), ". It usually takes about 20 s."));
  for (const job of (b.busy || []).filter(j => j.startsWith("move:"))) {
    said.push(el("p", { class: "home-note small jprogress" }, `Moving ${job.slice(5)} to In Progress in Jira… `, jiraSince(job)));
  }
  if (b.error) said.push(el("p", { class: "home-note small st missing", id: "jira-error" }, "The last refresh failed: " + b.error));
  if (jiraNote) said.push(el("p", { class: "home-note small " + (jiraNote.bad ? "st missing" : "ok") }, jiraNote.text));
  let body;
  if (!b.fetchedAt) {
    body = el("div", { class: "empty-state" },
      el("p", {}, busy ? "Fetching your tickets from Jira…" : "No tickets fetched yet."),
      el("p", { class: "dim small" }, "Refresh asks Claude to read them through your Atlassian connection (the MCP server you signed in to with /mcp). " +
        "That spends tokens, so Tatty keeps what it got and fetches again only when you press Refresh."));
  } else if (!b.issues.length) {
    body = el("div", { class: "empty-state" }, el("p", {}, "No tickets of yours in an open sprint."));
  } else {
    body = el("div", { class: "jboard", id: "jira-board" }, jiraColumns(b.issues).map(c =>
      el("section", { class: "jcol", "data-cat": c.cat },
        el("h3", {}, c.name, " ", el("span", { class: "dim" }, String(c.issues.length))),
        c.issues.map(jiraCard))));
  }
  jiraBox.replaceChildren(el("div", { class: "jira-page" }, head, ...said, body));
  if (jiraOpen) showTicket(jiraOpen);
  tickSince();
}

function jiraCard(i) {
  const started = (jiraNow.started || {})[i.key];
  return el("a", { class: "jcard", href: "#jira", "data-key": i.key, onclick: e => { e.preventDefault(); openTicket(i.key); } },
    el("div", { class: "jcard-top" }, chip(i.type || "Issue", typeClass(i.type)), el("span", { class: "jkey" }, i.key)),
    el("div", { class: "jsum" }, i.summary),
    el("div", { class: "jmeta dim small" }, [i.priority, i.parent && i.parent.summary].filter(Boolean).join(" · ")),
    started ? el("div", { class: "small jstarted" }, "Feature: " + started) : "");
}

// ------------------------------------------------------------- the ticket panel

async function openTicket(key) {
  jiraOpen = key;
  if (!jiraDetail.has(key) && (jiraNow.cached || []).includes(key)) {
    try { jiraDetail.set(key, await api("/api/jira/issue?key=" + encodeURIComponent(key))); } catch { /* drawn as not loaded */ }
  }
  showTicket(key);
}

function closeTicket() {
  jiraOpen = "";
  for (const n of document.querySelectorAll(".jshade, .jticket")) n.remove();
}

function showTicket(key) {
  const i = jiraIssue(key);
  for (const n of document.querySelectorAll(".jshade, .jticket")) n.remove();
  if (!i || !jiraBox || !jiraBox.classList.contains("on")) { jiraOpen = ""; return; }
  const d = jiraDetail.get(key);
  const loaded = d && d.cached !== false;
  const loading = jiraBusy("issue:" + key);
  const load = el("button", { type: "button", id: "jira-load", onclick: () => loadTicket(key) },
    loading ? "Loading…" : loaded ? "Load again" : "Load ticket");
  load.disabled = loading;
  const facts = loaded ? [["Priority", d.priority || i.priority], ["Assignee", d.assignee], ["Reporter", d.reporter],
    ["Parent", i.parent ? `${i.parent.key} ${i.parent.summary}` : ""], ["Labels", (d.labels || []).join(", ")],
    ["Components", (d.components || []).join(", ")], ["Fix versions", (d.fixVersions || []).join(", ")]].filter(f => f[1]) : [];
  const panel = el("aside", { class: "jticket", role: "dialog", "aria-label": `${i.key}: ${i.summary}` },
    el("div", { class: "jticket-head" },
      chip(i.type || "Issue", typeClass(i.type)),
      i.url ? el("a", { href: i.url, target: "_blank", rel: "noopener", title: "Open in Jira" }, i.key + " ↗") : el("strong", {}, i.key),
      chip(i.status, i.statusCategory === "done" ? "done" : i.statusCategory === "inprogress" ? "now" : "todo"),
      el("button", { type: "button", class: "right", title: "Close (Esc)", "aria-label": "Close", onclick: closeTicket }, "×")),
    el("h3", {}, i.summary),
    loaded
      ? el("div", {},
        el("dl", { class: "jfacts small" }, facts.flatMap(([k, v]) => [el("dt", { class: "dim" }, k), el("dd", {}, v)])),
        el("div", { class: "jdesc" }, mdNode(d.description || "*No description.*")),
        (d.subtasks || []).length ? el("div", {}, el("h4", {}, "Sub-tasks"),
          el("ul", {}, d.subtasks.map(t => el("li", {}, `${t.key} ${t.summary}`, t.status ? el("span", { class: "dim" }, ` (${t.status})`) : "")))) : "",
        (d.links || []).length ? el("div", {}, el("h4", {}, "Linked issues"),
          el("ul", {}, d.links.map(l => el("li", {}, el("span", { class: "dim" }, (l.relation || "relates to") + ": "), `${l.key} ${l.summary || ""}`)))) : "",
        el("div", { class: "dim small jfetched" }, `Copied from Jira ${ago(d.fetchedAt)}. `, load))
      : el("div", { class: "jload" },
        el("p", { class: loading ? "jprogress" : "" }, loading ? ["Asking Claude to read the ticket from Jira… ", jiraSince("issue:" + key), ". It usually takes about 20 s."] : "Not loaded yet."),
        el("p", { class: "dim small" }, "Loading reads the whole ticket through Claude, which spends a few thousand tokens. Tatty keeps it afterwards."),
        load),
    loaded ? startForm(i) : "");
  const shade = el("div", { class: "jshade", onclick: closeTicket });
  document.body.append(shade, panel);
  tickSince();
}

// Start workflow: the feature's name and project, then the server makes the
// folder, writes the ticket into it, starts the session and moves the ticket.
function startForm(i) {
  const started = (jiraNow.started || {})[i.key];
  if (started) {
    return el("div", { class: "start-panel" },
      el("div", { class: "start-title" }, "A workflow was started from this ticket"),
      el("a", { href: featureHref(started), onclick: closeTicket }, started + " →"));
  }
  const name = el("input", { id: "jira-name", value: jiraName(i), "aria-label": "Feature name" });
  let project = jiraNow.project || "";
  const where = el("span", {});
  const go = el("button", { type: "button", class: "primary", id: "jira-start" }, "Start workflow");
  const result = el("div", { class: "start-result" });
  const picker = modelPicker("jira-start-" + i.key);
  const drawWhere = () => {
    where.replaceChildren(project ? copyable(project) : el("strong", { class: "st missing" }, "no project chosen yet"));
    go.disabled = !project || !name.value.trim();
  };
  const choose = el("button", { type: "button", onclick: async () => {
    try { const p = await pickFolder(`Choose the project (repo) for ${i.key}`, project); if (p) { project = p; drawWhere(); } }
    catch (e) { alert(e.message || e); }
  } }, "Choose…");
  name.addEventListener("input", drawWhere);
  go.addEventListener("click", async () => {
    go.disabled = true;
    result.replaceChildren(el("span", { class: "dim small" }, "Making the feature and opening a session…"));
    tell("allow-foreground");
    try {
      const r = await api("/api/jira/start", { key: i.key, name: name.value.trim(), project, ...picker.fields() });
      jiraNow.started = { ...(jiraNow.started || {}), [i.key]: r.feature };
      if (r.ok) {
        closeTicket();
        location.hash = featureHref(r.feature); // its page shows the session as it runs
        return;
      }
      // No terminal could be opened: the command to run, and the move by hand.
      result.replaceChildren(el("p", { class: "st missing" }, "Couldn't open a terminal here. Run this yourself:"), el("pre", {}, r.said),
        el("button", { type: "button", onclick: () => moveTicket(i.key) }, `Move ${i.key} to In Progress`));
    } catch (e) {
      result.replaceChildren(el("p", { class: "st missing" }, String(e.message || e)));
      go.disabled = false;
    }
  });
  const moving = i.statusCategory === "todo" ? `and moves ${i.key} to In Progress in Jira` : `(${i.key} is ${i.status} already, so it stays as it is)`;
  drawWhere();
  return el("div", { class: "start-panel" },
    el("div", { class: "start-title" }, "Start a workflow from this ticket"),
    el("label", { class: "jname" }, el("span", { class: "dim small" }, "Feature folder"), name),
    el("div", { class: "project-line small" }, "Runs in ", where, " ", choose),
    picker.node,
    el("div", { class: "small dim" }, `Writes the ticket into the feature's folder, opens a new Claude session that starts planning from it, ${moving}.`),
    el("div", { class: "start-actions" }, go),
    result);
}

// ------------------------------------------------------------- the jobs

async function refreshJira() {
  jiraNote = null;
  try { jiraNow = await api("/api/jira/refresh", {}); } catch (e) { if (e.status !== 409) alert(String(e.message || e)); }
  drawJira();
}

async function loadTicket(key) {
  try { jiraNow = await api("/api/jira/issue", { key }); } catch (e) { if (e.status !== 409) alert(String(e.message || e)); }
  showTicket(key);
}

async function moveTicket(key) {
  try { jiraNow = await api("/api/jira/move", { key }); } catch (e) { if (e.status !== 409) alert(String(e.message || e)); }
  drawJira();
}

// How a job went: the board and the ticket are read again (that costs nothing).
document.addEventListener("tt-event", async e => {
  const ev = e.detail;
  if (ev.type !== "jira") return;
  if (!ev.busy && ev.job.startsWith("move:")) jiraNote = { text: ev.ok ? ev.message : ev.error, bad: !ev.ok };
  if (!ev.busy && ev.job.startsWith("issue:")) {
    if (ev.ok) jiraDetail.delete(ev.key);
    else jiraNote = { text: `Couldn't load ${ev.key}: ${ev.error}`, bad: true };
  }
  if (!jiraBox || !jiraBox.classList.contains("on")) { jiraNow = null; return; }
  try { jiraNow = await api("/api/jira"); } catch { return; }
  if (jiraOpen && !jiraDetail.has(jiraOpen) && (jiraNow.cached || []).includes(jiraOpen)) {
    try { jiraDetail.set(jiraOpen, await api("/api/jira/issue?key=" + encodeURIComponent(jiraOpen))); } catch { /* not loaded */ }
  }
  drawJira();
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && jiraOpen) closeTicket(); });
window.addEventListener("hashchange", closeTicket);
