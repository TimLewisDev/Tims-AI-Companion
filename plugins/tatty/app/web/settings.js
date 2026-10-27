// Tatty's Settings page (#settings, the gear beside the connection badge): the
// updates -- the version running, whether Tatty keeps itself up to date, and
// buttons to look and to install by hand -- the LLM tools that are connected (their
// models feed every picker), the model a workflow session starts on and the model of
// each workflow step (both kept by the toolbox's tt-config) -- what the Jira board
// reads, and how chats work (chat.js): who sums up a side chat's context, and their
// model. The
// server does the work (server.py's "updates") and says how it went as "update"
// events.
// Uses app.js's $, el and api, features.js's pageEls and ago, and models.js's pickers.
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
    llmSettings(),
    sessionSettings(),
    stepSettings(),
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

// The LLM tools: claude, copilot and codex. Connecting one lists the models it
// offers; the pickers and the step table below take their choices from that list.
// A tool other than claude is listed but can't run a step or a session yet.
const LLM_STATE = {
  connected: "Connected", available: "Installed, not connected", missing: "Connected, but the tool is gone",
  "not installed": "Not installed",
};

function llmSettings() {
  const box = el("section", { id: "llm-settings" }, el("h3", {}, "Connections"),
    el("p", { class: "dim small" }, "The LLM tools Tatty and the toolbox can use. Their models fill the pickers below; today only Claude's can run a workflow."));
  const body = el("div", {});
  const note = el("p", { class: "dim small", id: "llm-note" });
  box.append(body, note);
  const act = async (action, provider) => {
    note.textContent = "Working…";
    try {
      const d = await api("/api/llms", { action, provider });
      note.textContent = d.said || "";
      loadModels(true);
      draw(d);
    } catch (e) { note.textContent = ""; alert(e.message || e); }
  };
  const draw = d => {
    if (!d.available) {
      body.replaceChildren(el("p", { class: "dim small" }, "This toolbox is too old to connect LLMs, so Tatty offers Claude's models only. Update the core plugin."));
      return;
    }
    body.replaceChildren(el("table", { class: "plugins", id: "llm-table" },
      el("tr", {}, el("th", {}, "Tool"), el("th", {}, "State"), el("th", {}, "Version"), el("th", {}, "Models"), el("th", {})),
      d.providers.map(p => {
        const here = d.models.filter(m => m.provider === p.provider);
        const listed = here.length ? here.map(m => m.id).join(", ") : "none";
        const buttons = [];
        if (p.state === "available") buttons.push(el("button", { type: "button", id: `llm-connect-${p.provider}`, onclick: () => act("connect", p.provider) }, "Connect"));
        if (p.state === "connected" || p.state === "missing") {
          buttons.push(el("button", { type: "button", id: `llm-refresh-${p.provider}`, onclick: () => act("refresh", p.provider) }, "Refresh models"));
          if (p.provider !== "claude") buttons.push(" ", el("button", { type: "button", id: `llm-disconnect-${p.provider}`, onclick: () => act("disconnect", p.provider) }, "Disconnect"));
        }
        return el("tr", { class: p.state === "connected" ? "current" : "", id: "llm-" + p.provider },
          el("td", {}, p.provider), el("td", {}, LLM_STATE[p.state] || p.state), el("td", { class: "dim small" }, p.version || "-"),
          el("td", { class: "dim small" }, `${listed}${p.provider !== "claude" && here.length ? " (not yet runnable)" : ""}`),
          el("td", {}, buttons));
      })));
  };
  loadModels(true).then(d => { if (d) draw(d); else body.replaceChildren(el("p", { class: "dim small" }, "Can't read the connections.")); });
  return box;
}

// The model and effort a workflow session starts on when a Start doesn't choose
// (the toolbox's `session` setting in its tt-config), which the Start panels offer first.
function sessionSettings() {
  const box = el("section", { id: "session-settings" }, el("h3", {}, "Workflow session"),
    el("p", { class: "dim small" }, "The model and effort Start launches the main Claude session with, for /tt-workflow and /tt-workflow-lite. A running session can't be switched, so this is set when it starts; each Start can still choose its own."));
  loadModels(true).then(d => {
    if (!d || !d.models) { box.append(el("p", { class: "dim small" }, "Can't read the models.")); return; }
    const model = el("select", { id: "set-sessionModel", "aria-label": "Model" }, modelOptions(d.models));
    const effort = el("select", { id: "set-sessionEffort", "aria-label": "Effort" });
    const fillEfforts = () => {
      const list = effortsOf(d.models, model.value), was = effort.value;
      effort.replaceChildren(...effortOptions(list));
      effort.value = list.includes(was) ? was : "";
    };
    const save = async () => {
      try {
        const r = await api("/api/model-config", { action: "set", role: "session", model: model.value || "-", effort: effort.value || "-" });
        d.session = { model: model.value, effort: effort.value };
        modelsAsked = null;
        return r;
      } catch (e) { alert(e.message || e); }
    };
    model.addEventListener("change", () => { fillEfforts(); save(); });
    effort.addEventListener("change", save);
    model.value = d.models.some(m => m.id === d.session.model && m.runnable) ? d.session.model : "";
    fillEfforts();
    if (effortsOf(d.models, model.value).includes(d.session.effort)) effort.value = d.session.effort;
    box.append(el("label", { class: "field-row" }, el("strong", {}, "Model"), model, el("span", { class: "dim small" }, "Blank: Claude Code's own choice.")),
      el("label", { class: "field-row" }, el("strong", {}, "Effort"), effort, el("span", { class: "dim small" }, "How hard it thinks.")));
  });
  return box;
}

// The model and effort of each workflow step, through the toolbox's tt-config: the
// steps that start a subagent apply them when it starts; a step that runs in your
// own session is advisory (the session's model is the one above).
function stepSettings() {
  const box = el("section", { id: "step-settings" }, el("h3", {}, "Step models"),
    el("p", { class: "dim small" }, "Which model and effort each step of the workflow uses for its subagents, in the active mode. Steps marked advisory run in your own session, which the toolbox can only recommend a model for."));
  const body = el("div", {});
  const note = el("p", { class: "dim small", id: "step-note" });
  box.append(body, note);
  let now = null;
  const act = async change => {
    note.textContent = "Working…";
    try { now = await api("/api/model-config", change); note.textContent = now.said || ""; draw(); }
    catch (e) { note.textContent = ""; alert(e.message || e); }
  };
  const draw = () => {
    if (!now || !now.available) {
      body.replaceChildren(el("p", { class: "dim small" }, "This toolbox is too old to configure models. Update the core plugin."));
      return;
    }
    const active = now.modes.find(m => m.name === now.mode) || { kind: "" };
    const modeSel = el("select", { id: "step-mode", "aria-label": "Mode" }, now.modes.map(m => el("option", { value: m.name }, `${m.name} (${m.kind})`)));
    modeSel.value = now.mode;
    modeSel.addEventListener("change", () => act({ action: "use", mode: modeSel.value }));
    const saveName = el("input", { id: "step-save-name", placeholder: "name", "aria-label": "Name for a new mode" });
    const tools = el("div", { class: "actions" }, el("span", { class: "dim small" }, "Mode "), modeSel, " ",
      saveName, el("button", { type: "button", id: "step-save", onclick: () => saveName.value.trim() && act({ action: "save", name: saveName.value.trim() }) }, "Save as new mode"),
      active.kind === "shipped, edited" ? el("button", { type: "button", id: "step-reset", onclick: () => act({ action: "reset", mode: now.mode }) }, "Reset edits") : null,
      active.kind === "saved" ? el("button", { type: "button", id: "step-delete", onclick: () => act({ action: "delete", mode: now.mode }) }, "Delete mode") : null);
    const row = r => {
      const model = el("select", { id: `step-${r.role}-model`, "aria-label": `${r.role} model` }, modelOptions(now.models, "Session's own"));
      const effort = el("select", { id: `step-${r.role}-effort`, "aria-label": `${r.role} effort` });
      const fill = () => {
        const list = effortsOf(now.models, model.value), was = effort.value;
        effort.replaceChildren(...effortOptions(list, "Default"));
        effort.value = list.includes(was) ? was : "";
      };
      model.value = r.model === "-" ? "" : r.model;
      fill();
      effort.value = r.effort === "-" ? "" : r.effort;
      const save = () => act({ action: "set", role: r.role, model: model.value || "-", effort: effort.value || "-" });
      model.addEventListener("change", () => { fill(); save(); });
      effort.addEventListener("change", save);
      const changed = r.model !== r.defaultModel || r.effort !== r.defaultEffort;
      return el("tr", { id: "step-" + r.role, class: changed ? "current" : "" },
        el("td", {}, r.kind === "main" ? el("span", {}, r.role, " ", el("span", { class: "dim small" }, "advisory")) : r.role),
        el("td", { class: "dim small" }, r.label), el("td", {}, model), el("td", {}, effort));
    };
    body.replaceChildren(tools, el("table", { class: "plugins", id: "step-table" },
      el("tr", {}, el("th", {}, "Step"), el("th", {}, "What it does"), el("th", {}, "Model"), el("th", {}, "Effort")),
      now.roles.filter(r => r.role !== "session").map(row)));
  };
  api("/api/model-config").then(d => { now = d; draw(); }).catch(() => body.replaceChildren(el("p", { class: "dim small" }, "Can't read the step models.")));
  return box;
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
