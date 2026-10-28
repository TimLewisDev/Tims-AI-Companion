// Tatty's Jira board (#jira, the production mode's page): the person's
// open-sprint tickets in a column per status, as the sprint board has them. The
// board itself (cards you drag to another status, the ⋯ menu that moves or hides
// a column, the panel, Start workflow and Start lite) is taskboard.js's, which the
// Tasks page uses too; here is what is Jira's: where the tickets come from, what a
// card shows, what a drop does (a move in Jira) and the ticket's own panel. The
// server reads Jira through a headless claude run (server.py's "Jira"), which
// spends tokens, so the board is the one it kept and is fetched again only on
// Refresh or Load (or a drop, which moves the ticket).
// Uses app.js's $, el, api and mdNode, features.js's ago, chip and featureHref, and
// taskboard.js's makeTaskBoard.
"use strict";

let jiraBox = null;   // the page's element while it is on screen
let jiraNow = null;   // the last /api/jira answer
let jiraOpen = "";    // the key of the ticket in the panel, "" for none
let jiraNote = null;  // {text, bad}: how the last job went, said once under the header
let jiraTb = null;    // the taskboard.js board
let jiraInfo = null, jiraAct = null, jiraNotes = null; // the header's parts, filled again as the board changes
const jiraDetail = new Map(); // key -> the last /api/jira/issue answer
const jiraMoving = new Map(); // key -> {to, before}: a drop whose move Jira is still making, shown where it was dropped

const jiraBusy = job => !!jiraNow && (jiraNow.busy || []).includes(job);
const jiraIssue = key => (jiraNow && jiraNow.issues || []).find(i => i.key === key);
// A status's column id, as the server makes it (jira_status_key).
const jiraStatusKey = s => String(s || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
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
  try { jiraNow = await jiraLoad(); } catch (e) {
    box.replaceChildren(el("div", { class: "jira-page pad" }, el("p", {}, "Can't read the board: " + e.message)));
    return;
  }
  if (!jiraTb || jiraTb.isGone()) jiraTb = makeTaskBoard(jiraOptions(box));
  drawJira();
}

// /api/jira, and the open ticket's kept detail if it has none yet (that costs nothing).
async function jiraLoad() {
  const b = await api("/api/jira");
  if (jiraOpen && !jiraDetail.has(jiraOpen) && (b.cached || []).includes(jiraOpen)) {
    try { jiraDetail.set(jiraOpen, await api("/api/jira/issue?key=" + encodeURIComponent(jiraOpen))); } catch { /* drawn as not loaded */ }
  }
  return b;
}

// What taskboard.js asks of this page (see its header).
function jiraOptions(box) {
  return {
    box, id: "jira", item: "jira", noun: "ticket", client: "",
    load: async () => { jiraNow = await jiraLoad(); return jiraData(); },
    cardBody: x => [
      el("div", { class: "tcard-top" }, chip(x.type || "Issue", typeClass(x.type)), el("span", { class: "jkey" }, x.id)),
      el("div", { class: "tsum" }, x.title),
      el("div", { class: "jmeta dim small" }, [x.priority, x.parent && x.parent.summary].filter(Boolean).join(" · "))],
    cardClass: x => jiraBusy("move:" + x.id) ? "tmoving" : "",
    open: key => openTicket(key),
    // A drop in the same status only places the card; in another, Jira moves the ticket (a transition, which
    // takes a few seconds): it stays where it was dropped meanwhile and goes back if Jira won't.
    move: jiraDrop,
    canDrop: id => !jiraBusy("move:" + id),
    ops: { move: true, hide: true },
    colOp: async body => {
      const from = jiraNow.columns.findIndex(c => c.id === body.id);
      const edit = body.op === "move" ? { op: "move", status: body.id, dir: Math.sign(body.index - from) } : { op: body.op, status: body.id };
      jiraNow = await api("/api/jira/layout", edit);
      return jiraData();
    },
    empty: jiraEmpty,
    head: drawJiraHead,
    // (the open ticket is drawn again from what was read, unless a field in its panel is being typed in)
    afterRefresh: () => {
      const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest(".tpanel input, .tpanel textarea, .tpanel select");
      if (jiraOpen && !typing) showTicket(jiraOpen);
      tickSince();
    },
    escape: closeTicket,
  };
}

// The board's data as taskboard.js wants it: the server's columns, with a ticket whose move is going on in
// the column it was dropped on.
function jiraData() {
  const b = jiraNow;
  const cols = b.columns.map(c => ({ ...c, tasks: [...c.tasks] }));
  for (const [key, drop] of [...jiraMoving]) {
    if (!jiraBusy("move:" + key)) { jiraMoving.delete(key); continue; }
    const from = cols.find(c => c.tasks.some(x => x.id === key)), dest = cols.find(c => c.id === drop.to);
    if (!from || !dest || from === dest) continue;
    const card = from.tasks.splice(from.tasks.findIndex(x => x.id === key), 1)[0];
    const at = drop.before ? dest.tasks.findIndex(x => x.id === drop.before) : -1;
    dest.tasks.splice(at < 0 ? dest.tasks.length : at, 0, card);
  }
  return { columns: cols, hidden: b.hidden || [], workflows: b.workflows || {}, started: b.started || {},
    options: { project: b.project || "", workdir: b.workdir || "" } };
}

async function jiraDrop(key, to, before) {
  const from = jiraNow.columns.find(c => c.tasks.some(x => x.id === key));
  jiraNow = await api("/api/jira/reorder", { key, to, before });
  if (!from || from.id === to) return;
  const dest = jiraNow.columns.find(c => c.id === to);
  jiraMoving.set(key, { to, before });
  try { jiraNow = await api("/api/jira/move", { key, to: dest ? dest.name : to }); } catch (e) { jiraMoving.delete(key); throw e; }
}

function jiraEmpty() {
  const b = jiraNow, busy = jiraBusy("board");
  if (!b.fetchedAt) {
    return el("div", { class: "empty-state" },
      el("p", {}, busy ? "Fetching your tickets from Jira…" : "No tickets fetched yet."),
      el("p", { class: "dim small" }, "Refresh asks Claude to read them through your Atlassian connection (the MCP server you signed in to with /mcp). " +
        "That spends tokens, so Tatty keeps what it got and fetches again only when you press Refresh."));
  }
  return b.issues.length ? null : el("div", { class: "empty-state" }, el("p", {}, "No tickets of yours in an open sprint."));
}

function drawJira() {
  if (!jiraBox || !jiraNow) return;
  jiraInfo = el("div", {});
  jiraAct = el("span", {});
  jiraNotes = el("div", { class: "jira-notes" });
  jiraTb.frame(el("div", { class: "home-head" }, jiraInfo, el("div", { class: "actions" }, jiraTb.filterField(), jiraAct)), jiraNotes);
  jiraTb.s.data = jiraData();
  drawJiraHead();
  jiraTb.drawBody();
  if (jiraOpen) showTicket(jiraOpen);
  tickSince();
}

// The header and the notes under it, from jiraNow (the board below is drawn by taskboard.js).
function drawJiraHead() {
  if (!jiraInfo || !jiraNow) return;
  const b = jiraNow, busy = jiraBusy("board");
  const refresh = el("button", { type: "button", id: "jira-refresh", class: "primary", onclick: refreshJira }, busy ? "Refreshing…" : "Refresh");
  refresh.disabled = busy;
  const cost = b.usage ? ` · ${Math.round(b.usage.tokens / 1000)}k tokens, ${Math.round(b.usage.seconds)} s` : "";
  jiraInfo.replaceChildren(
    el("h2", {}, "Jira"),
    el("div", { class: "dim small" }, "Your tickets in the open sprints",
      b.site ? ` on ${b.site}` : "", b.fetchedAt ? `, fetched ${ago(b.fetchedAt)}${cost}` : ""),
    el("div", { class: "dim small jql", title: "Change it in Settings" }, b.jql));
  jiraAct.replaceChildren(refresh);
  const said = [];
  // What is running now: each is a headless claude run, which takes a while.
  if (busy) said.push(el("p", { class: "home-note small jprogress", id: "jira-progress" },
    "Asking Claude to read your tickets from Jira… ", jiraSince("board"), ". It usually takes about 20 s."));
  for (const job of (b.busy || []).filter(j => j.startsWith("move:"))) {
    said.push(el("p", { class: "home-note small jprogress" }, `Moving ${job.slice(5)} in Jira… `, jiraSince(job)));
  }
  if (b.error) said.push(el("p", { class: "home-note small st missing", id: "jira-error" }, "The last refresh failed: " + b.error));
  if (jiraNote) said.push(el("p", { class: "home-note small " + (jiraNote.bad ? "st missing" : "ok") }, jiraNote.text));
  jiraNotes.replaceChildren(...said);
  tickSince();
}

// The board, header and open panel drawn again from jiraNow (after a job's answer, with no new read).
function redrawJira() {
  if (!jiraTb || !jiraNow) return;
  jiraTb.s.data = jiraData();
  drawJiraHead();
  jiraTb.drawBody();
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
  if (jiraTb) jiraTb.removePanel();
}

// Move to: the statuses Jira offers this ticket (as of when it was loaded), one click each. When a workflow's
// request is opened the ticket goes to In Review by itself; QA Ready and Done are for the person to choose.
function moveRow(i, d) {
  const here = (i.status || "").toLowerCase();
  const targets = [...new Set((d.transitions || []).map(t => t.to || t.name).filter(Boolean))].filter(t => t.toLowerCase() !== here);
  if (!targets.length) return "";
  const busy = jiraBusy("move:" + i.key);
  return el("div", { class: "jmove small" }, el("span", { class: "dim" }, "Move to: "),
    targets.map(t => el("button", { type: "button", class: "jmove-to", "data-to": t, disabled: busy,
      onclick: () => moveTicket(i.key, t) }, t)));
}

function showTicket(key) {
  const i = jiraIssue(key);
  if (jiraTb) jiraTb.removePanel();
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
  const panel = el("aside", { class: "tpanel", role: "dialog", "aria-label": `${i.key}: ${i.summary}`, tabindex: "-1" },
    el("div", { class: "jticket-head" },
      chip(i.type || "Issue", typeClass(i.type)),
      i.url ? el("a", { href: i.url, target: "_blank", rel: "noopener", title: "Open in Jira" }, i.key + " ↗") : el("strong", {}, i.key),
      chip(i.status, i.statusCategory === "done" ? "done" : i.statusCategory === "inprogress" ? "now" : "todo"),
      el("button", { type: "button", class: "right", title: "Close (Esc)", "aria-label": "Close", onclick: closeTicket }, "×")),
    el("h3", {}, i.summary),
    loaded
      ? el("div", {},
        el("dl", { class: "jfacts small" }, facts.flatMap(([k, v]) => [el("dt", { class: "dim" }, k), el("dd", {}, v)])),
        moveRow(i, d),
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
    loaded ? startSection(i) : "");
  jiraTb.showPanel(panel);
  tickSince();
}

// Start workflow and Start lite: the feature's name, the project and the folder the work is done in; then the
// server makes the folder, writes the ticket into it, starts the session and moves the ticket (taskboard.js draws it).
function startSection(i) {
  return jiraTb.startSection({
    id: i.key,
    started: (jiraNow.started || {})[i.key],
    name: jiraName(i),
    project: jiraNow.project || "",
    workdir: jiraNow.workdir || "",
    moves: i.statusCategory === "todo" ? `${i.key} moves to In Progress in Jira.` : `${i.key} is ${i.status} already, so it stays as it is.`,
    stays: true,
    send: async fields => {
      const r = await api("/api/jira/start", { key: i.key, ...fields });
      jiraNow.started = { ...(jiraNow.started || {}), [i.key]: r.feature };
      return r;
    },
    close: () => closeTicket(),
    // No terminal could be opened: the command to run, and the move by hand.
    more: () => el("button", { type: "button", onclick: () => moveTicket(i.key, "In Progress") }, `Move ${i.key} to In Progress`),
    cancelled: r => jiraTb.stripSay(`Workflow cancelled. ${i.key} stays where it is in Jira. ${r.folder === "removed"
      ? "The empty feature folder was moved to features/.deleted." : "The feature folder was kept."}`),
  });
}

// ------------------------------------------------------------- the jobs

async function refreshJira() {
  jiraNote = null;
  try { jiraNow = await api("/api/jira/refresh", {}); } catch (e) { if (e.status !== 409) alert(String(e.message || e)); }
  redrawJira();
}

async function loadTicket(key) {
  try { jiraNow = await api("/api/jira/issue", { key }); } catch (e) { if (e.status !== 409) alert(String(e.message || e)); }
  showTicket(key);
}

async function moveTicket(key, to) {
  try {
    jiraNow = await api("/api/jira/move", { key, to });
    jiraMoving.set(key, { to: jiraStatusKey(to), before: null });
  } catch (e) { if (e.status !== 409) alert(String(e.message || e)); }
  redrawJira();
  if (jiraOpen) showTicket(jiraOpen);
}

// How a job went: the board and the ticket are read again (that costs nothing).
document.addEventListener("tt-event", async e => {
  const ev = e.detail;
  if (ev.type !== "jira") return;
  if (!ev.busy && ev.job.startsWith("move:")) {
    jiraNote = { text: ev.ok ? ev.message : ev.error, bad: !ev.ok };
    jiraMoving.delete(ev.job.slice(5));
  }
  if (!ev.busy && ev.job.startsWith("issue:")) {
    if (ev.ok) jiraDetail.delete(ev.key);
    else jiraNote = { text: `Couldn't load ${ev.key}: ${ev.error}`, bad: true };
  }
  if (!jiraBox || !jiraBox.classList.contains("on") || !jiraTb) { jiraNow = null; return; }
  await jiraTb.refresh();
});
window.addEventListener("hashchange", closeTicket);
