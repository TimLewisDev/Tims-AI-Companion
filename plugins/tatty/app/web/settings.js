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
            "Looks when Tatty starts and every few hours, and installs newer versions of Tatty and the toolbox. The installed Tatty restarts itself to update, once no session or job is running; otherwise Tatty's takes effect the next time you start it. The toolbox's, in Claude sessions you start after."))),
      (u.plugins || []).length ? el("table", { class: "plugins", id: "update-plugins" },
        el("tr", {}, el("th", {}, "Plugin"), el("th", {}, "Installed"), el("th", {}, "Latest"), el("th", {})),
        (u.plugins || []).map(r => el("tr", { class: r.status }, el("td", {}, r.name), el("td", {}, r.installed || "?"),
          el("td", {}, r.available || "?"), el("td", { class: "dim small" }, { ready: "installed, not in use yet", available: "update waiting", current: "up to date" }[r.status] || "")))) : null,
      el("p", { class: "upd-status " + u.status, id: "update-status" }, words !== undefined && words !== "" ? words : (u.message || "")),
      restartPanel(u),
      el("p", { class: "dim small" }, when),
      el("div", { class: "actions" }, look, u.status === "available" || (!s.autoUpdate && u.status !== "checkout") ? install : null)),
    llmSettings(),
    sessionSettings(),
    stepSettings(),
    chatSettings(s),
    branchSettings(s),
    jiraSettings(s),
    debugSettings()));
}

// Debug: Tatty coins out of nowhere, for trying the shop (wallet.js shows them arriving). Locked
// behind a password the server checks (server.py's debug_coins); once it is right, this window
// remembers it until it closes (sessionStorage), and forgets it again with Lock.
const DEBUG_PASS = "tt-debug";
function debugSettings() {
  const box = el("section", { id: "debug-settings" });
  const head = () => el("h3", {}, "Debug");
  const draw = () => {
    const pass = sessionStorage.getItem(DEBUG_PASS) || "";
    const msg = el("span", { class: "dim small", id: "debug-said" });
    if (!pass) {
      const pw = el("input", { type: "password", id: "debug-password", placeholder: "Password", autocomplete: "off", "aria-label": "Debug password" });
      const unlock = async () => {
        try {
          await api("/api/debug/coins", { password: pw.value, amount: 0 });
          sessionStorage.setItem(DEBUG_PASS, pw.value);
          draw();
        } catch (e) {
          msg.textContent = e.status === 403 ? "That isn't it." : e.message;
          pw.select();
        }
      };
      pw.addEventListener("keydown", e => { if (e.key === "Enter") unlock(); });
      box.replaceChildren(head(), el("p", { class: "dim small" }, "Tools for trying Tatty out. Locked."),
        el("div", { class: "actions" }, pw, el("button", { type: "button", id: "debug-unlock", onclick: unlock }, "Unlock"), msg));
      return;
    }
    const amount = el("input", { type: "number", id: "debug-amount", value: "100", step: "1", min: "0", "aria-label": "Coins to award or take" });
    const unlocks = el("div", { id: "debug-unlocks", class: "debug-unlocks" });
    // a refused password locks the section again; anything else is shown
    const failed = e => { if (e.status === 403) { sessionStorage.removeItem(DEBUG_PASS); draw(); return; } msg.textContent = e.message; };
    // n coins in (positive) or out (negative) of this project's wallet
    const give = async n => {
      if (!n) return;
      try {
        const r = await api("/api/debug/coins", { password: pass, amount: n });
        msg.textContent = `Balance: ${r.coins.toLocaleString()}`;
      } catch (e) { failed(e); }
    };
    const takeAll = async () => {
      try {
        const have = (await api("/api/debug/coins", { password: pass, amount: 0 })).coins;
        if (have) await give(-have); else msg.textContent = "Balance: 0";
      } catch (e) { failed(e); }
    };
    // the unlocks that can be taken away again: the free ones can't be (Tatty is always at least himself)
    const drawUnlocks = async () => {
      let w;
      try { w = await api("/api/wallet"); } catch (e) { unlocks.replaceChildren(el("span", { class: "dim small" }, e.message)); return; }
      const cat = w.catalogue, free = new Set(cat.avatars.filter(a => !a.price).map(a => a.id));
      const name = id => (([...cat.avatars, ...cat.items].find(x => x.id === id)) || {}).name || id;
      const mine = w.owned.filter(id => !free.has(id));
      const lock = async id => {
        try {
          await api("/api/debug/lock", { password: pass, id });
          msg.textContent = id === "all" ? "Every unlock is locked again." : `${name(id)} is locked again.`;
          drawUnlocks();
        } catch (e) { failed(e); }
      };
      unlocks.replaceChildren(
        el("p", { class: "dim small" }, "Unlocked" + (w.project ? ` in ${w.project.name}` : "") + ": " + (mine.length ? "lock one to buy it again." : "nothing to take away.")),
        mine.length ? el("div", { class: "actions" },
          ...mine.map(id => el("button", { type: "button", class: "debug-relock", "data-id": id, title: "Take this unlock away (no refund)", onclick: () => lock(id) }, `Lock ${name(id)}`)),
          el("button", { type: "button", id: "debug-relock-all", onclick: () => lock("all") }, "Lock all")) : "");
    };
    box.replaceChildren(head(),
      el("p", { class: "dim small" }, "Award or take Tatty coins in this project's wallet: they arrive in the purse like any others. Coins and unlocks belong to the project."),
      el("div", { class: "actions" },
        ...[10, 100, 1000].map(n => el("button", { type: "button", class: "debug-give", onclick: () => give(n) }, `+${n}`)),
        ...[10, 100, 1000].map(n => el("button", { type: "button", class: "debug-take", onclick: () => give(-n) }, `−${n}`)),
        amount,
        el("button", { type: "button", id: "debug-award", class: "primary", onclick: () => give(Math.abs(parseInt(amount.value, 10)) || 0) }, "Award"),
        el("button", { type: "button", id: "debug-take", onclick: () => give(-Math.abs(parseInt(amount.value, 10)) || 0) }, "Take"),
        el("button", { type: "button", id: "debug-take-all", onclick: takeAll }, "Take all"),
        el("button", { type: "button", id: "debug-lock", onclick: () => { sessionStorage.removeItem(DEBUG_PASS); draw(); } }, "Lock"),
        msg),
      unlocks);
    drawUnlocks();
  };
  draw();
  return box;
}

// What an installed update leaves to restart (server.py's "restarting"): this server,
// when Tatty itself was updated, and the sessions going. A restart keeps the sessions:
// they are written down and the new server takes them back, each one saying hello
// again by itself. Sessions started before the update still have the old mod and
// skills until they are started again.
function restartPanel(u) {
  const r = u.restart;
  if (!r || (!r.server && !r.stale)) return null;
  const going = r.sessions.length, plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const say = el("p", { class: "dim small", id: "restart-say" });
  const go = el("button", { type: "button", id: "update-restart", class: "primary" }, "Restart Tatty");
  go.addEventListener("click", async () => {
    const risks = [r.openQuestions && `${plural(r.openQuestions, "unanswered question")} will be lost`,
      r.busy && `${plural(r.busy, "background job")} will be stopped`].filter(Boolean);
    if (risks.length && !confirm(risks.join(" and ") + ". Restart anyway?")) return;
    go.disabled = true;
    say.textContent = "Restarting…";
    try {
      const a = await api("/api/restart", {});
      restarting = true;
      say.textContent = `Restarting${a.kept ? `, keeping ${plural(a.kept, "session")}` : ""}. The tray window reconnects by itself; a browser tab needs reopening.`;
    } catch (e) { say.textContent = ""; go.disabled = false; alert(e.message || e); }
  });
  return el("div", { class: "restart-panel", id: "restart-panel" },
    r.server ? el("p", { id: "restart-server" }, `Tatty ${u.installed} is installed, but this server is still ${u.running}. Restarting loads it.`) : null,
    going ? el("p", { class: "dim small", id: "restart-sessions" },
      `${plural(going, "session")} going: ${r.sessions.map(s => s.name || s.tag).join(", ")}.`,
      r.server ? " They are kept, and reattach by themselves after the restart." : "") : null,
    r.stale ? el("p", { class: "dim small", id: "restart-stale" },
      `${plural(r.stale, "session")} started before the update, so still on the old mod and skills until started again.`) : null,
    r.server ? [go, say] : null);
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

// Branches (see "branches and merging" in the server): every workflow Tatty starts works on a branch of its
// own, named from this prefix and the feature's name. Saved when the box is left.
function branchSettings(s) {
  const input = el("input", { id: "set-branchPrefix", value: s.branchPrefix, "aria-label": "Branch prefix" });
  input.addEventListener("change", async () => {
    try { settingsNow = await api("/api/settings", { branchPrefix: input.value.trim() }); input.value = settingsNow.branchPrefix; }
    catch (e) { alert(String(e)); }
  });
  return el("section", { id: "branch-settings" },
    el("h3", {}, "Branches"),
    el("p", { class: "dim small" }, "A workflow started from Tatty works on a new branch of its own, made when it first starts, so two workflows don't trample each other. Tatty switches branches, and commits only when you press Commit on a feature's page: pushing and opening the request are yours (the Review step's merge phase helps)."),
    el("label", { class: "field-row" }, el("strong", {}, "Branch prefix"), input,
      el("span", { class: "dim small" }, "Letters, digits, - and _, each part ending in /: feature/ gives feature/ABC-12-fix-the-thing.")));
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
    el("p", { class: "dim small" }, "The model and effort Start launches the main Claude session with, for /tt-workflow and /tt-workflow-lite. A running session can't be switched, so this is set when it starts; each Start can still choose its own. A family name (sonnet) follows its latest model; the versions listed under it pin one."));
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
    el("p", { class: "dim small" }, "Which model and effort each step of the workflow uses for its subagents, in the active mode. Steps marked advisory run in your own session, which the toolbox can only recommend a model for. A step takes a model family (sonnet, opus, haiku, fable); the version a family means is chosen just below, and a specific version can also be chosen for the session above."));
  const body = el("div", {});
  const note = el("p", { class: "dim small", id: "step-note" });
  box.append(body, note);
  let now = null;
  const act = async change => {
    note.textContent = "Working…";
    try { now = await api("/api/model-config", change); note.textContent = now.said || ""; draw(); }
    catch (e) { note.textContent = ""; alert(e.message || e); }
  };
  // Which version each family means: a subagent is started with the family name (sonnet), and the session
  // Start launches is given the version, so the name means it. Not part of a mode. Nothing when the toolbox can't say.
  const familyTable = () => {
    if (!now.families || !now.families.length) return null;
    const rows = now.families.map(f => {
      const newest = f.versions[0];
      const sel = el("select", { id: "family-" + f.family, "aria-label": `${f.family} version` },
        el("option", { value: "" }, f.source === "own" ? `Your own setting (${f.label || f.effective})` : `Newest${newest ? ` (${newest.label})` : ""}`),
        f.versions.map(v => el("option", { value: v.id }, v.label)));
      sel.value = f.chosen;
      sel.addEventListener("change", () => act({ action: "family", family: f.family, model: sel.value || "-" }));
      return el("tr", { id: "family-row-" + f.family, class: f.chosen ? "current" : "" },
        el("td", {}, f.family), el("td", {}, sel), el("td", { class: "dim small" }, f.label || f.effective || "-"));
    });
    return el("div", { id: "family-versions" },
      el("h4", {}, "Model versions"),
      el("p", { class: "dim small" }, "The version each family name means for the steps below. Newest follows the newest the toolbox lists. Applies to workflow sessions started from now on; one already running keeps its version."),
      el("table", { class: "plugins", id: "family-table" },
        el("tr", {}, el("th", {}, "Family"), el("th", {}, "Version"), el("th", {}, "Runs as")), rows));
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
    body.replaceChildren(tools, familyTable(), el("table", { class: "plugins", id: "step-table" },
      el("tr", {}, el("th", {}, "Step"), el("th", {}, "What it does"), el("th", {}, "Model"), el("th", {}, "Effort")),
      now.roles.filter(r => r.role !== "session").map(row)));
  };
  api("/api/model-config").then(d => { now = d; draw(); }).catch(() => body.replaceChildren(el("p", { class: "dim small" }, "Can't read the step models.")));
  return box;
}

// What the server says about an update, as it happens.
let restartAsked = 0;
let restarting = false; // a restart was asked for: leave its panel as it is
document.addEventListener("tt-event", async e => {
  // The sessions going change as they start and end: ask again (at most every two seconds)
  // while the page says something is waiting to restart.
  const r = settingsNow && settingsNow.update && settingsNow.update.restart;
  if (e.detail.type === "session" && r && (r.server || r.stale) && settingsBox && settingsBox.classList.contains("on")
      && !restarting && Date.now() - restartAsked > 2000) {
    restartAsked = Date.now();
    try {
      settingsNow.update = (await api("/api/settings")).update;
      const old = $("#restart-panel"), fresh = restartPanel(settingsNow.update);
      if (old && fresh) old.replaceWith(fresh); else if (old) old.remove();  // only the panel: the rest may be mid-edit
    } catch { /* the connection badge says so */ }
  }
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
