// Tatty's Settings page (#settings, the gear beside the connection badge): the
// updates -- the version running, whether Tatty keeps itself up to date, and
// buttons to look and to install by hand -- what the Jira board reads, and how
// chats work (chat.js): who sums up a side chat's context, and their model. The
// server does the work (server.py's "updates") and says how it went as "update"
// events.
// Uses app.js's $, el and api, and features.js's pageEls and ago.
"use strict";

let settingsBox = null; // the page's element while it is on screen
let settingsNow = null; // the last /api/settings answer

// The gear shows a dot when there is something to do about an update.
function markGear(update) {
  const todo = update && (update.status === "ready" || update.status === "available");
  $("#settings-link .dot").hidden = !todo;
}

async function renderSettings(box) {
  settingsBox = box;
  try { settingsNow = await api("/api/settings"); } catch (e) {
    box.replaceChildren(el("div", { class: "settings-page" }, el("p", {}, "Can't read the settings: " + e.message)));
    return;
  }
  drawSettings();
}

function drawSettings() {
  if (!settingsBox || !settingsNow) return;
  const s = settingsNow, u = s.update;
  const busy = u.status === "checking" || u.status === "updating";
  const auto = el("input", { type: "checkbox", id: "auto-update" });
  auto.checked = s.autoUpdate;
  auto.addEventListener("change", async () => {
    try { settingsNow = await api("/api/settings", { autoUpdate: auto.checked }); } catch (e) { alert(String(e)); }
    drawSettings();
  });
  const act = async action => {
    try { await api("/api/update", { action }); } catch (e) { if (e.status !== 409) alert(String(e)); }
  };
  const look = el("button", { type: "button", id: "update-check", onclick: () => act("check") }, "Check for updates");
  const install = el("button", { type: "button", id: "update-apply", class: "primary", onclick: () => act("apply") },
    "Update now");
  look.disabled = busy;
  install.disabled = busy;
  const when = u.checked ? `Last checked ${ago(u.checked)}.` : "Not checked yet.";
  const words = { checking: "Looking for a newer version…", updating: "Installing the update…", idle: "" }[u.status];
  settingsBox.replaceChildren(el("div", { class: "settings-page" },
    el("h2", {}, "Settings"),
    el("section", {},
      el("h3", {}, "Updates"),
      el("p", {}, "Tatty ", el("strong", {}, s.version)),
      el("label", { class: "opt-row" }, auto,
        el("span", {}, el("strong", {}, "Keep Tatty and the toolbox up to date automatically"),
          el("br"), el("span", { class: "dim small" },
            "Looks when Tatty starts and every few hours, and installs newer versions of Tatty and the toolbox plugins. Tatty's takes effect the next time you start it; the toolbox's in Claude sessions you start after."))),
      (u.plugins || []).length ? el("table", { class: "plugins", id: "update-plugins" },
        el("tr", {}, el("th", {}, "Plugin"), el("th", {}, "Installed"), el("th", {}, "Latest"), el("th", {})),
        (u.plugins || []).map(r => el("tr", { class: r.status }, el("td", {}, r.name), el("td", {}, r.installed || "?"),
          el("td", {}, r.available || "?"), el("td", { class: "dim small" }, { ready: "installed, not in use yet", available: "update waiting", current: "up to date" }[r.status] || "")))) : null,
      el("p", { class: "upd-status " + u.status, id: "update-status" }, words !== undefined && words !== "" ? words : (u.message || "")),
      el("p", { class: "dim small" }, when),
      el("div", { class: "actions" }, look, u.status === "available" || (!s.autoUpdate && u.status !== "checkout") ? install : null)),
    chatSettings(s),
    jiraSettings(s)));
}

// Chats (chat.js): who writes the summary of what a side chat is about, and the
// model chats answer with. Each is saved as it changes; the next chat uses it.
function chatSettings(s) {
  const radio = (value, label, hint) => {
    const input = el("input", { type: "radio", name: "chat-summary", id: "chat-summary-" + value, value });
    input.checked = s.chatSummary === value;
    input.addEventListener("change", async () => {
      try { settingsNow = await api("/api/settings", { chatSummary: value }); } catch (e) { alert(String(e)); }
    });
    return el("label", { class: "opt-row" }, input, el("span", {}, el("strong", {}, label), el("br"), el("span", { class: "dim small" }, hint)));
  };
  const model = el("input", { id: "set-chatModel", value: s.chatModel, "aria-label": "Model" });
  model.addEventListener("change", async () => {
    try { settingsNow = await api("/api/settings", { chatModel: model.value.trim() }); } catch (e) { alert(String(e)); }
  });
  return el("section", { id: "chat-settings" },
    el("h3", {}, "Chats"),
    el("p", { class: "dim small" }, "A side chat starts with what you picked out of a workflow and a summary of it, put in front of your first message."),
    radio("tatty", "Tatty writes the summary", "Where the piece came from, in a line. Free, and at once."),
    radio("model", "A small model writes the summary", "Two or three sentences on what the piece is about. Costs a little, and takes a few seconds."),
    el("label", { class: "field-row" }, el("strong", {}, "Model"), model,
      el("span", { class: "dim small" }, "The model chats answer with. Blank: Claude Code's own choice.")));
}

// The Jira board's reading (jira.js): which tickets, through which MCP server
// and model. Each is saved when the box is left; the next Refresh uses it.
function jiraSettings(s) {
  const field = (key, label, hint, wide) => {
    const input = el("input", { id: "set-" + key, value: s[key], class: wide ? "wide" : "", "aria-label": label });
    input.addEventListener("change", async () => {
      try { settingsNow = await api("/api/settings", { [key]: input.value.trim() }); } catch (e) { alert(String(e)); }
    });
    return el("label", { class: "field-row" }, el("strong", {}, label), input, el("span", { class: "dim small" }, hint));
  };
  return el("section", {},
    el("h3", {}, "Jira"),
    el("p", { class: "dim small" }, "The production mode's board reads your tickets through Claude, using the Atlassian MCP server you signed in to with /mcp."),
    field("jiraJql", "Tickets (JQL)", "Which tickets the board shows.", true),
    field("jiraServer", "MCP server", "Its name in claude mcp list."),
    field("jiraSite", "Site", "Only when your sign-in reaches several, e.g. example.atlassian.net. Blank: the first."),
    field("jiraModel", "Model", "The model that reads Jira; a small one keeps it cheap."));
}

// What the server says about an update, as it happens.
document.addEventListener("tt-event", e => {
  if (e.detail.type !== "update") return;
  const { type, seq, ts, ...update } = e.detail;
  if (settingsNow) settingsNow.update = { ...settingsNow.update, ...update };
  markGear(update);
  if (settingsBox && settingsBox.classList.contains("on")) drawSettings();
});

// The dot on the gear needs the state before the page is ever opened.
booted.then(async () => {
  try {
    const s = await api("/api/settings");
    settingsNow = s;
    markGear(s.update);
  } catch { /* the connection badge says so */ }
});
