// Tatty's page: shows what the agent sends, answers its questions, reads the
// toolbox's status/connections/docs through the server's read-only views, and
// sends typed messages to the session. No libraries, no network beyond the server.
"use strict";

const token = (() => {
  const m = location.hash.match(/token=([^&]+)/);
  if (m) {
    sessionStorage.setItem("tt-token", m[1]);
    history.replaceState(null, "", location.pathname + location.search); // keeps ?mode=companion
  }
  return sessionStorage.getItem("tt-token") || "";
})();

// A fresh id on every load, counted in sessionStorage (which survives a reload
// in the same window), so a test can prove the host changed the window's shape
// without reloading the page underneath it.
window.ttLoad = (() => {
  const n = Number(sessionStorage.getItem("tt-loads") || 0) + 1;
  sessionStorage.setItem("tt-loads", String(n));
  return n + ":" + Date.now();
})();

const $ = sel => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : String(k));
  return n;
};

async function api(path, body) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-TT-Token": token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const e = new Error((await r.json().catch(() => ({}))).error || r.statusText);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

// ------------------------------------------------------------- markdown

const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function inline(s) {
  const codes = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  // Links to another document, or a part of one: a .doclink, which a feature
  // page opens in place, at the heading or block (features.js).
  //   [[Doc]] [[Doc|label]] [[Doc#Heading]] [[Doc#H1#H2]] [[Doc#^block]] [[#Heading]] ![[Doc]] (Obsidian)
  //   [label](Doc.md) [label](Doc.md#heading) [label](#heading) (Markdown)
  const doclink = (doc, at, label) => {
    // a `code` span inside the target (a heading such as "Does `X` split?") is just its text there
    const plain = v => v.replace(/\u0000(\d+)\u0000/g, (_, n) => codes[n]);
    doc = plain(doc); at = plain(at);
    const where = at ? (at.startsWith("^") ? at : at.split("#").pop()) : "";
    const shown = label || [doc, where].filter(Boolean).join(" › ");
    return `<a href="#" class="doclink" data-doc="${doc}" data-at="${at}" title="${[doc || "this document", where].filter(Boolean).join(" › ")}">${shown}</a>`;
  };
  // (In a table Obsidian writes [[Doc\|label]]; the cell splitter has already
  // made that a plain |, and any \ left before the | is dropped here too.)
  s = s.replace(/!?\[\[([^\]|#]*)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, t, a, label) =>
    doclink(t.trim().replace(/\\$/, "").trim().replace(/\.md$/i, "").split("/").pop(), (a || "").slice(1).replace(/\\$/, "").trim(), label));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    if (/^https?:\/\//.test(u)) return `<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
    if (/^#|\.md(#.*)?$/i.test(u)) {
      const hash = u.indexOf("#");
      let doc = (hash < 0 ? u : u.slice(0, hash)).replace(/\.md$/i, "").split("/").pop();
      let at = hash < 0 ? "" : u.slice(hash + 1);
      try { doc = decodeURIComponent(doc); at = decodeURIComponent(at).replace(/-/g, " "); } catch { /* keep it as written */ }
      return doclink(doc, at, t);
    }
    return `<span title="${u}">${t}</span>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

// An Obsidian block id: " ^r12" at the end of an item, paragraph or table row
// (what [[Doc#^r12]] links to). block(text) -> [text without it, the id or ""].
const BLOCK = /\s\^([A-Za-z0-9-]+)\s*$/;
const block = text => { const m = text.match(BLOCK); return m ? [text.slice(0, m.index), m[1]] : [text, ""]; };
const blockAttr = id => (id ? ` data-block="${esc(id)}"` : "");

const isTable = l => /^\s*\|.*\|\s*$/.test(l);
// a cell may hold an escaped pipe (`a \| b`), which stays in the cell
const cells = l => l.trim().replace(/^\||(?<!\\)\|$/g, "").split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, "|"));

function markdown(src) {
  const lines = src.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
    } else if (/^\s*\^[A-Za-z0-9-]+\s*$/.test(l)) {
      // a block id on its own line names the block just before it
      const id = l.trim().slice(1);
      if (out.length) out[out.length - 1] = out[out.length - 1].replace(/^<(\w+)/, `<$1${blockAttr(id)}`);
      i++;
    } else if (/^#{1,6}\s/.test(l)) {
      const n = l.match(/^#+/)[0].length, text = l.replace(/^#+\s*/, "");
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      out.push(`<h${n} id="h-${id}">${inline(text)}</h${n}>`);
      i++;
    } else if (isTable(l) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && isTable(lines[i])) rows.push(cells(lines[i++]));
      const row = r => {
        const [last, id] = block(r[r.length - 1] || "");
        const cs = [...r.slice(0, -1), last];
        return `<tr${blockAttr(id)}>` + cs.map(c => `<td>${inline(c)}</td>`).join("") + "</tr>";
      };
      out.push("<table><thead><tr>" + head.map(c => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
        rows.map(row).join("") + "</tbody></table>");
    } else if (/^\s*([-*]|\d+\.)\s/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*]|\d+\.)\s/, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i])) item += " " + lines[i++].trim();
        const [text, id] = block(item);
        items.push(`<li${blockAttr(id)}>${inline(text)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
    } else if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      const [text, id] = block(buf.join(" "));
      out.push(`<blockquote${blockAttr(id)}>${inline(text)}</blockquote>`);
    } else if (!l.trim()) {
      i++;
    } else {
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*]|\d+\.)\s|\s*\^[A-Za-z0-9-]+\s*$)/.test(lines[i]) && !isTable(lines[i])) buf.push(lines[i++]);
      const [text, id] = block(buf.join(" "));
      out.push(`<p${blockAttr(id)}>${inline(text)}</p>`);
    }
  }
  return out.join("\n");
}

const mdNode = src => { const d = el("div", { class: "md" }); d.innerHTML = markdown(src); return d; };

// ------------------------------------------------------------- views

const COLS = ["prefix", "kind", "phase", "skill", "verb", "arg", "text", "hint", "stage"];

function command(r) {
  if (r.skill === "-" || !r.skill) return "";
  let c = "/" + r.skill;
  if (r.verb) c += " " + r.verb;
  if (r.arg) c += ` "${r.arg}"`;
  if (r.hint) c += " " + r.hint;
  return c;
}

function cmdCell(cmd, about) {
  if (!cmd) return el("span", { class: "dim" }, "nothing left to run");
  return el("div", { class: "cmd" },
    el("code", {}, cmd),
    el("button", { title: "Copy the command", onclick: () => navigator.clipboard.writeText(cmd) }, "Copy"),
    el("button", { title: "Ask Tatty about this step", onclick: () => say(`Tell me about this next step: ${cmd}${about ? ` (${about})` : ""}`) }, "Ask"));
}

function statusTable(tsv) {
  const rows = tsv.split("\n").filter(Boolean).map(l => Object.fromEntries(l.split("\t").map((v, i) => [COLS[i], v])));
  if (!rows.length) return el("p", { class: "dim" }, "No tt documents in this folder.");
  return el("table", {},
    el("thead", {}, el("tr", {}, el("th", {}, "Feature"), el("th", {}, "Where it stands"), el("th", {}, "Next"))),
    el("tbody", {}, rows.map(r => el("tr", { class: "kind-" + r.kind },
      el("td", {}, r.kind === "primary" ? el("strong", {}, r.prefix || "—") : ""),
      el("td", {}, r.kind === "warn" ? "⚠ " : r.kind === "alt" ? "or: " : "", r.text, r.stage ? el("div", { class: "dim small" }, "stage: " + r.stage) : ""),
      el("td", {}, cmdCell(command(r), r.prefix))))));
}

async function loadStatus() {
  const body = $("#status-body");
  body.replaceChildren(el("p", { class: "dim" }, "Looking…"));
  const dir = $("#dir").value.trim();
  const q = dir ? "?dir=" + encodeURIComponent(dir) : "";
  try {
    const [hello, where] = await Promise.all([api("/api/view/hello"), api("/api/view/where" + q)]);
    body.replaceChildren(
      el("pre", { class: "banner" }, hello.stdout),
      where.exit === 2 ? el("p", { class: "st missing" }, where.stderr || "Couldn't read that folder.") : statusTable(where.stdout),
      el("p", { class: "dim small" }, "Docs in a vault or another folder? Put its path above."));
  } catch (e) { body.replaceChildren(el("p", { class: "st missing" }, String(e))); }
}

const TAGS = [["NEEDS AUTH", "auth", "needs sign-in"], ["NOT CONNECTED", "down", "not connected"], ["MISSING", "missing", "missing"], ["ok", "ok", "ok"]];

async function loadConnections() {
  const body = $("#connections-body");
  body.replaceChildren(el("p", { class: "dim" }, "Checking…"));
  try {
    const r = await api("/api/view/connections");
    const lines = r.stdout.replace(/\r/g, "").split("\n");
    if (!/^Pack:/.test(lines[0] || "")) {
      body.replaceChildren(el("p", {}, r.stdout.trim() || "No connection pack for this project."),
        el("p", { class: "dim small" }, "Describe your connections with the TT toolbox: /tt-guide connections."));
      return;
    }
    const rows = [];
    let summary = "";
    for (const l of lines.slice(1)) {
      const t = TAGS.find(([tag]) => l.startsWith("  " + tag));
      if (t) {
        const rest = l.slice(2 + t[0].length).trim().split(/\s+/);
        rows.push(el("tr", {}, el("td", {}, el("span", { class: "st " + t[1] }, t[2])), el("td", { class: "mono" }, rest[0]), el("td", {}, rest.slice(1).join(" "))));
      } else if (l.trim()) summary = l.trim();
    }
    body.replaceChildren(el("p", { class: "dim small" }, lines[0]), el("table", {}, el("tbody", {}, rows)), el("p", {}, summary),
      r.exit === 1 ? el("div", { class: "cmd" }, "Set up the rest: ", cmdCell("/tt-connections setup")) : "");
  } catch (e) { body.replaceChildren(el("p", { class: "st missing" }, String(e))); }
}

async function loadDocs(view, name) {
  const body = $("#docs-body");
  body.replaceChildren(el("p", { class: "dim" }, "Reading…"));
  try {
    const r = await api(`/api/view/${view}` + (name ? "?name=" + encodeURIComponent(name) : ""));
    const text = r.stdout || r.stderr || "Nothing there.";
    if (view === "about" && !name) {
      const topics = text.split("\n").filter(l => /^\s{2}\S/.test(l)).map(l => l.trim());
      body.replaceChildren(el("p", {}, "Pick a topic, or type a skill name above:"),
        el("ul", {}, topics.map(t => el("li", {}, el("a", { href: "#", onclick: ev => { ev.preventDefault(); $("#about").value = t; loadDocs("about", t); } }, t)))));
    } else body.replaceChildren(mdNode(text));
  } catch (e) { body.replaceChildren(el("p", { class: "st missing" }, String(e))); }
}

// ------------------------------------------------------------- feed

const feed = $("#feed");
const asks = new Map();
let modAttached = false;

function scrollFeed() { feed.scrollTop = feed.scrollHeight; }

function card(ev) {
  const title = ev.title ? el("h4", {}, ev.title) : "";
  let body;
  if (ev.kind === "markdown" || ev.kind === "reply") body = mdNode(ev.body);
  else if (ev.kind === "table") body = statusTable(ev.body);
  else body = el("pre", {}, ev.body);
  if (ev.kind === "markdown" || ev.kind === "reply") linkIds(body, ev.feature); // ids.js
  return el("div", { class: "card " + ev.kind }, title, body);
}

function askCard(ev) {
  const picks = ev.questions.map(() => new Set());
  const others = [];
  const send = el("button", { class: "primary", type: "button", disabled: true }, "Send answer");
  const ready = () => { send.disabled = !ev.questions.every((q, i) => picks[i].size || others[i].value.trim()); };
  const qs = ev.questions.map((q, i) => {
    const opts = q.options.map(o => {
      const row = el("div", { class: "opt", role: q.multiSelect ? "checkbox" : "radio", tabindex: 0 },
        el("span", {}, q.multiSelect ? "☐" : "○"),
        el("div", {}, el("div", {}, o.label), o.description ? el("div", { class: "desc" }, o.description) : "", o.preview ? el("pre", {}, o.preview) : ""));
      const pick = () => {
        if (q.multiSelect) picks[i].has(o.label) ? picks[i].delete(o.label) : picks[i].add(o.label);
        else { picks[i].clear(); picks[i].add(o.label); others[i].value = ""; }
        for (const [n, r] of opts) { const on = picks[i].has(n); r.classList.toggle("picked", on); r.firstChild.textContent = q.multiSelect ? (on ? "☑" : "☐") : (on ? "●" : "○"); }
        ready();
      };
      row.addEventListener("click", pick);
      row.addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); pick(); } });
      return [o.label, row];
    });
    others[i] = el("input", { class: "other", placeholder: "Other: type your own answer" });
    others[i].addEventListener("input", () => {
      if (!q.multiSelect && others[i].value.trim()) { picks[i].clear(); for (const [, r] of opts) { r.classList.remove("picked"); r.firstChild.textContent = "○"; } }
      ready();
    });
    return el("div", { class: "q" }, q.header ? el("div", { class: "head" }, q.header) : "", el("div", { class: "text" }, q.question), opts.map(([, r]) => r), others[i]);
  });
  const terminal = el("button", { type: "button", title: "Have the question asked in the terminal instead" }, "Answer in terminal instead");
  const status = el("div", { class: "dim small" });
  const node = el("div", { class: "card ask" }, el("h4", {}, ev.source ? `Question from ${ev.source}` : "Question"), qs,
    el("div", { class: "actions" }, terminal, send), status);
  send.addEventListener("click", async () => {
    const answers = {};
    ev.questions.forEach((q, i) => {
      const chosen = [...picks[i]];
      const other = others[i].value.trim();
      if (other) chosen.push(other);
      answers[q.question] = chosen.join(", ");
    });
    try { await api("/api/reply", { id: ev.id, answers }); } catch (e) { status.textContent = String(e); }
  });
  terminal.addEventListener("click", async () => {
    try { await api("/api/reply", { id: ev.id, declined: true }); } catch (e) { status.textContent = String(e); }
  });
  // The IDs the question cites (R12, CH5, …) become links to their items (ids.js).
  // Only the text on screen changes: an answer is still keyed by q.question.
  linkIds(node, ev.feature);
  // The same question can be on screen twice (the feed and a feature's session
  // panel); answering either answers both.
  if (!asks.has(ev.id)) asks.set(ev.id, { nodes: [], ev });
  asks.get(ev.id).nodes.push(node);
  return node;
}

const answers = new Map(); // ask id -> its "answered" event, for cards drawn after it

function answeredCard(a, ev) {
  const node = el("div", { class: "card ask done" }, el("h4", {}, "Answered"),
    ev.declined ? el("p", { class: "dim" }, "Asked in the terminal instead.") :
      a.questions.map(q => el("div", { class: "q" }, el("div", { class: "text" }, q.question), el("div", { class: "answer" }, ev.answers[q.question] || "—"))));
  linkIds(node, a.feature); // ids.js
  return node;
}

function answered(ev) {
  answers.set(ev.id, ev);
  const a = asks.get(ev.id);
  if (!a) return;
  for (const n of a.nodes) if (n.isConnected) n.replaceWith(answeredCard(a.ev, ev));
  asks.delete(ev.id);
}

// A question's card, or its answer if it has been answered already.
function questionCard(ev) {
  return answers.has(ev.id) ? answeredCard(ev, answers.get(ev.id)) : askCard(ev);
}

function setMod(on) {
  modAttached = on;
  const b = $("#mod");
  b.textContent = on ? "Claude session attached" : "no session";
  b.className = "badge " + (on ? "ok" : "");
  $("#chat-mode").textContent = on ? "Messages go straight into the Claude session." :
    "No Claude session works with Tatty yet: run /tatty attach in one, or start one from a feature page.";
}

// The feed is the main session's conversation, plus every question (wherever
// it comes from, so the bubble shows it). A started session's activity, replies
// and messages are its feature page's (features.js, through "tt-event").
function onEvent(ev) {
  feedEvent(ev);
  // after the feed, so an answer is already recorded when a session panel hears of it
  document.dispatchEvent(new CustomEvent("tt-event", { detail: ev }));
}

function feedEvent(ev) {
  if (ev.type === "ask") feed.append(questionCard(ev));
  else if (ev.type === "answered") answered(ev);
  else if (ev.tag) return;
  else if (ev.type === "card") feed.append(card(ev));
  else if (ev.type === "say") feed.append(el("div", { class: "card you" }, el("pre", {}, ev.text)));
  else if (ev.type === "status") setMod(!!ev.mod);
  scrollFeed();
}

function connect() {
  const es = new EventSource("/events?token=" + encodeURIComponent(token));
  const badge = $("#conn");
  es.onopen = () => { badge.textContent = "connected"; badge.className = "badge ok"; };
  es.onerror = () => { badge.textContent = "server gone"; badge.className = "badge bad"; };
  es.onmessage = m => onEvent(JSON.parse(m.data));
}

// ------------------------------------------------------------- chat

const SECRETISH = /(token|password|passwd|secret|api[_-]?key)\s*[=:]|[A-Za-z0-9+/_-]{32,}/i;

async function say(text) {
  text = text.trim();
  if (!text) return;
  if (SECRETISH.test(text) && !confirm("That looks like it might hold a secret. Send it anyway?")) return;
  try { await api("/api/say", { text }); } catch (e) { alert(String(e)); }
}

$("#chat").addEventListener("submit", e => { e.preventDefault(); say($("#say").value); $("#say").value = ""; });
$("#say").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chat").requestSubmit(); } });

// ------------------------------------------------------------- tabs

const loaded = new Set();
const loaders = { status: loadStatus, connections: loadConnections, docs: () => loadDocs("start") };
for (const b of document.querySelectorAll(".tabs button")) {
  b.addEventListener("click", () => {
    for (const x of document.querySelectorAll(".tabs button")) x.classList.toggle("on", x === b);
    for (const p of document.querySelectorAll(".pane")) p.classList.toggle("on", p.id === "tab-" + b.dataset.tab);
    if (!loaded.has(b.dataset.tab)) { loaded.add(b.dataset.tab); loaders[b.dataset.tab](); }
  });
}
$("#dir-form").addEventListener("submit", e => { e.preventDefault(); loadStatus(); });
$("#conn-refresh").addEventListener("click", loadConnections);
$("#docs-start").addEventListener("click", () => loadDocs("start"));
$("#docs-topics").addEventListener("click", () => loadDocs("about"));
$("#about-form").addEventListener("submit", e => { e.preventDefault(); loadDocs("about", $("#about").value.trim()); });

// ------------------------------------------------------------- companion

// In Tatty's speech bubble (the tray companion's WebView2), the page asks the
// host to expand, collapse or hide; in a browser none of this is shown or sent.
const companion = new URLSearchParams(location.search).get("mode") === "companion";
const host = window.chrome && window.chrome.webview;
const tell = (type, arg) => { if (host) host.postMessage(arg === undefined ? { type } : { type, arg }); };

if (companion) {
  document.body.classList.add("companion");
  const expand = on => {
    document.body.classList.toggle("expanded", on);
    if (on) document.dispatchEvent(new Event("tt-expanded")); // features.js shows the page
    scrollFeed();
  };
  $("#expand").addEventListener("click", () => { expand(true); tell("expand"); });
  $("#collapse").addEventListener("click", () => { expand(false); tell("collapse"); });
  $("#hide").addEventListener("click", () => tell("hide"));
  $("#max").addEventListener("click", () => tell("maximise"));
  $("#min").addEventListener("click", () => tell("minimise"));
  // In the full panel the bar is the title bar: drag it to move, double-click
  // to maximise. The host runs Windows' own move loop, so snapping works too.
  const bar = $("#companion-bar");
  bar.addEventListener("mousedown", e => {
    if (e.button !== 0 || e.detail > 1 || e.target.closest("button") || !document.body.classList.contains("expanded")) return;
    e.preventDefault();
    tell("drag");
  });
  bar.addEventListener("dblclick", e => {
    if (!e.target.closest("button") && document.body.classList.contains("expanded")) tell("maximise");
  });
  const maximised = on => {
    document.body.classList.toggle("maximised", on);
    $("#max").textContent = on ? "Restore" : "Maximise";
    $("#max").title = on ? "Back to the size it was" : "Fill the screen";
  };
  if (host) host.addEventListener("message", m => {
    if (m.data === "expanded") expand(true);
    else if (m.data === "compact") { expand(false); maximised(false); }
    else if (m.data === "maximised") maximised(true);
    else if (m.data === "restored") maximised(false);
    else if (m.data === "shown") scrollFeed();
  });
}

// ------------------------------------------------------------- start

// The pages wait for this: which page a bare #mode (or no hash at all) means
// depends on the modes installed, which the server says here. features.js
// routes once it resolves, however it went.
const booted = (async () => {
  if (!token) {
    feed.append(el("div", { class: "card" }, "No token: open Tatty with /tatty open (or scripts/tatty.sh open)."));
    return;
  }
  try {
    const st = await api("/api/status");
    $("#cwd").textContent = st.cwd;
    setMod(st.mod);
    setInstalledModes(st.modes); // which discipline plugins there are (modes.js)
  } catch (e) { feed.append(el("div", { class: "card" }, "Can't reach the window server: " + e)); }
  connect();
  setInterval(async () => {
    try {
      const st = await api("/api/status");
      setMod(st.mod);
      setInstalledModes(st.modes); // a plugin installed meanwhile turns up here
    } catch { /* the SSE badge says so */ }
  }, 15000);
})();
