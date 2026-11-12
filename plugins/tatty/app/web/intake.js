// The box on the Engineering home: type a task, and Tatty works out what it needs
// (server.py's "intake"). It is a chat of kind "intake" -- the same headless, read-only
// runs as every chat -- shown in place on the home page, not in a tab. When Tatty
// understands the task it plays it back, and the page draws a card from what it
// understood: a title, a summary and a "done when" list to correct; an effort level
// on a slider (low = the quick route, medium = a small change, high = the full
// workflow); the branch, worktree and project; the model. Nothing is made until the
// person presses Create and start, which makes the feature, writes its Ticket,
// makes the branch and opens the session (/api/intake/start).
// Uses app.js's el, api and tell; chat.js's chatView and pickChatProject; models.js's
// modelPicker; features.js's featureCache, sessionInfo and featureHref; modes.js's
// renderModeHome, which puts the box on the page.
"use strict";

const INTAKE_KEY = "tt-intake-chat"; // the chat in progress, so a refresh or another page doesn't lose it
const INTAKE_LEVELS = [
  { id: "low", word: "Low", route: "Quick", skill: "/tt-workflow-quick",
    blurb: "Tatty reads the code itself and tells you what it found. You say go; it writes a short brief and builds it. " +
      "It stops only for a decision that really is yours. Review is offered at the end, not run." },
  { id: "medium", word: "Medium", route: "Small change", skill: "/tt-workflow-lite",
    blurb: "You and Tatty explore the code together, a question at a time, agree a short brief and decide its design " +
      "choices, then it builds. For one request that needs a little thought." },
  { id: "high", word: "High", route: "Full workflow", skill: "/tt-workflow",
    blurb: "Requirements, scope, approach and technical design, each challenged by a second opinion, then a signed-off " +
      "plan, a task breakdown and the build. For a large or risky piece of work." },
];

const intakeStored = () => { try { return sessionStorage.getItem(INTAKE_KEY) || ""; } catch { return ""; } };
const intakeStore = id => { try { if (id) sessionStorage.setItem(INTAKE_KEY, id); else sessionStorage.removeItem(INTAKE_KEY); } catch { /* not remembered */ } };

// The one box (the page redraws #mode, so the same instance is shown again): { node, attach() }.
let intakeBox = null;
function intakeNode() {
  if (!intakeBox) intakeBox = makeIntake();
  intakeBox.attach();
  return intakeBox.node;
}

function makeIntake() {
  const node = el("section", { class: "intake", "aria-label": "Start a task" });
  let info = null;       // /api/intake/info: the repo, the quick route, the next ID
  let chatId = intakeStored();
  let draft = "";        // what was typed in the first box and not yet sent
  let gen = 0;           // a newer attach() makes an older one's late answers stale
  let cardKey = "";      // the task the card on screen was made from: it isn't redrawn over the person's edits
  let cardSlot = null;

  const loadInfo = async () => { try { info = await api("/api/intake/info"); } catch { info = info || { project: "", projects: [], quick: false, toolbox: true, nextId: "" }; } };

  // ---------------------------------------------------------------- the first box
  const first = () => {
    cardSlot = null;
    const text = el("textarea", { class: "intake-text", rows: "3", "aria-label": "What do you want to get done?",
      placeholder: "Describe the task in your own words: a change you want, a bug, an idea…  (Enter sends, Shift+Enter for a new line)" });
    text.value = draft;
    const go = el("button", { type: "submit", class: "primary" }, "Tell Tatty");
    const said = el("span", { class: "dim small intake-said", role: "status" });
    const where = el("div", { class: "small dim intake-where" });
    const paintWhere = () => {
      where.replaceChildren(el("span", {}, info.project ? ["Tatty reads ", el("code", {}, info.project), " to check it understands. "] : "Tatty needs a project folder to read. "),
        el("button", { type: "button", class: "linklike", onclick: async () => { const p = await pickChatProject(); if (p) { info.project = p; paintWhere(); } } },
          info.project ? "Change…" : "Choose a folder…"));
    };
    const form = el("form", { class: "intake-form" }, text, el("div", { class: "intake-actions" }, said, go), where);
    text.addEventListener("input", () => { draft = text.value; });
    text.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const said_ = text.value.trim();
      if (!said_ || go.disabled) return;
      if (!info.project) { said.textContent = "Choose the folder Tatty should read first."; return; }
      go.disabled = true;
      said.textContent = "";
      try {
        const c = await api("/api/chat/new", { kind: "intake", project: info.project });
        await api("/api/chat/say", { id: c.id, text: said_ });
        chatId = c.id; intakeStore(chatId); draft = "";
        conversation(chatId);
      } catch (err) { said.textContent = String(err.message || err); go.disabled = false; }
    });
    paintWhere();
    node.replaceChildren(
      el("h3", {}, "What do you want to get done?"),
      el("p", { class: "dim small intake-lede" }, "Say it in your own words. Tatty asks only what it needs, tells you what it understood, " +
        "and sets up a feature for it once you say it is right."),
      info.toolbox ? "" : el("p", { class: "st missing" }, "Tatty can't find the TT toolbox, so it can't start anything yet."),
      form);
  };

  // ---------------------------------------------------------------- the conversation and the card
  const conversation = id => {
    const mine = gen;
    cardKey = "";
    const slot = el("div", { class: "intake-card-slot" });
    cardSlot = slot;
    const view = chatView(id, {
      bare: true, placeholder: "Answer, or tell Tatty what it got wrong…  (Enter sends)",
      empty: "Tatty is reading your message…",
      onDraw: chat => { if (mine === gen) drawTask(chat, slot, view); },
    });
    const over = el("button", { type: "button", class: "linklike", onclick: () => startOver() }, "Start over");
    node.replaceChildren(el("div", { class: "intake-top" }, el("h3", {}, "New task"), over), view.node, slot);
  };

  const startOver = async () => {
    const id = chatId;
    chatId = ""; intakeStore("");
    gen++;
    if (id) { try { await api("/api/chat/close", { id }); } catch { /* it is gone either way */ } }
    first();
  };

  // What the chat knows after each turn: a task to confirm, or nothing yet.
  const drawTask = (chat, slot, view) => {
    if (chat.started && chat.started !== "starting") { slot.replaceChildren(el("p", { class: "dim" }, `Started ${chat.started}.`)); return; }
    if (chat.busy || !chat.task) {
      cardKey = "";
      // After an answer with nothing to confirm, a way to stop being asked: summarise what it has now.
      const answered = chat.messages.some(m => m.role === "claude");
      slot.replaceChildren(!chat.busy && answered ? el("p", { class: "small dim" }, "Nothing to confirm yet. ",
        el("button", { type: "button", class: "linklike", onclick: async () => {
          try { await api("/api/chat/say", { id: chat.id, text: "That is all I know. Please summarise the task now." }); } catch (e) { alert(e.message || e); }
        } }, "Skip the questions: summarise what you have")) : "");
      return;
    }
    const key = JSON.stringify(chat.task);
    if (key === cardKey) return; // (already drawn: keep the person's edits)
    cardKey = key;
    slot.replaceChildren(taskCard(chat, slot, view));
  };

  const taskCard = (chat, slot, view) => {
    const t = chat.task;
    const title = el("input", { type: "text", class: "intake-title", maxlength: "80", "aria-label": "Title", value: t.title });
    const summary = el("textarea", { class: "intake-summary", rows: "4", "aria-label": "Summary" });
    summary.value = t.summary;
    const done = el("textarea", { class: "intake-done", rows: String(Math.max(2, Math.min(6, t.acceptance.length + 1))), "aria-label": "Done when",
      placeholder: "One line each: what you will see when it works" });
    done.value = t.acceptance.join("\n");
    const radio = (value, label) => {
      const r = el("input", { type: "radio", name: "intake-kind", value });
      r.checked = t.kind === value;
      return { r, node: el("label", { class: "intake-radio" }, r, " ", label) };
    };
    const feature = radio("feature", "Something to build or change"), bug = radio("bug", "A bug to find and fix");
    const kind = () => (bug.r.checked ? "bug" : "feature");

    // The effort slider: three stops that it snaps to, a label under each, and what each does below.
    let start = Math.max(0, INTAKE_LEVELS.findIndex(l => l.id === t.level));
    if (start === 0 && !info.quick) start = 1; // (the toolbox here has no quick route)
    const slider = el("input", { type: "range", min: "0", max: "2", step: "1", value: String(start), class: "intake-slider", id: "intake-level", "aria-label": "Effort level" });
    slider.value = String(start);
    const ticks = el("div", { class: "intake-ticks" }, INTAKE_LEVELS.map((l, i) =>
      el("button", { type: "button", class: "intake-tick", tabindex: "-1", onclick: () => { slider.value = String(i); paint(); } }, l.word)));
    const levels = el("div", { class: "intake-levels" }, INTAKE_LEVELS.map(l =>
      el("div", { class: "intake-level", "data-level": l.id }, el("strong", {}, `${l.word}: ${l.route}. `), l.blurb)));
    const why = el("div", { class: "small dim intake-why" });
    const warn = el("div", { class: "st missing small intake-warn" });
    const effort = el("div", { class: "intake-effort" },
      el("label", { for: "intake-level", class: "intake-label" }, "How much process does this deserve?"),
      slider, ticks, levels, why, warn);
    const bugNote = el("div", { class: "small dim intake-bugnote" },
      "A bug starts by finding out why it happens (the debug route), whatever the level: you decide the fix with Tatty once the cause is known.");

    // Where it goes: the ID, the branch, a worktree, the project.
    let project = chat.project;
    const branch = el("input", { type: "text", class: "intake-branch", "aria-label": "Branch name", spellcheck: "false" });
    let branchEdited = false, branchInfo = { repo: "", branch: "", base: "" };
    const wt = el("input", { type: "checkbox", id: "intake-worktree", "aria-label": "own worktree" });
    const branchLine = el("div", { class: "small intake-branchline" });
    const projectLine = el("div", { class: "small dim" });
    const paintProject = () => {
      projectLine.replaceChildren("Sessions run in ", el("code", {}, project), " ",
        el("button", { type: "button", class: "linklike", onclick: async () => { const p = await pickChatProject(); if (p) { project = p; paintProject(); proposeBranch(); } } }, "Change…"));
    };
    let proposing = 0;
    const proposeBranch = async () => {
      const mineP = ++proposing;
      try {
        const b = await api("/api/intake/branch?project=" + encodeURIComponent(project) + "&title=" + encodeURIComponent(title.value));
        if (mineP !== proposing) return;
        branchInfo = b;
        if (!branchEdited) branch.value = b.branch;
      } catch { /* the server says so at Create */ }
      paintBranch();
    };
    const paintBranch = () => {
      if (!branchInfo.repo) { branchLine.replaceChildren(el("span", { class: "dim" }, "Not in a git repository: no branch will be made.")); return; }
      branchLine.replaceChildren(el("label", {}, "Branch ", branch), " ",
        el("label", { class: "own-worktree" }, wt, " Own worktree"),
        el("div", { class: "dim" }, wt.checked
          ? ["A new branch in a folder of its own, from ", el("code", {}, branchInfo.base || "the repo's HEAD"), ". A worktree is a full second checkout: a Unity project re-imports its Library there."]
          : ["Made in the repo's own checkout from ", el("code", {}, branchInfo.base || "the detached HEAD"), "."]));
    };
    branch.addEventListener("input", () => { branchEdited = true; });
    wt.addEventListener("change", paintBranch);
    let titleTimer = 0;
    title.addEventListener("input", () => { clearTimeout(titleTimer); titleTimer = setTimeout(proposeBranch, 400); paint(); });

    const picker = modelPicker("intake");
    const happens = el("div", { class: "small intake-happens" });
    const go = el("button", { type: "button", class: "primary" }, "Create and start");
    const result = el("div", { class: "intake-result", role: "status" });

    const level = () => INTAKE_LEVELS[Number(slider.value)];
    const paint = () => {
      const l = level(), isBug = kind() === "bug";
      effort.hidden = isBug; bugNote.hidden = !isBug;
      ticks.querySelectorAll(".intake-tick").forEach((b, i) => b.classList.toggle("on", i === Number(slider.value)));
      levels.querySelectorAll(".intake-level").forEach(d => d.classList.toggle("on", d.dataset.level === l.id));
      slider.setAttribute("aria-valuetext", `${l.word}: ${l.route}`);
      why.textContent = t.why && l.id === t.level ? `Tatty suggested this: ${t.why}` : t.why ? `Tatty suggested ${INTAKE_LEVELS.find(x => x.id === t.level).word}: ${t.why}` : "";
      const noQuick = !isBug && l.id === "low" && !info.quick;
      warn.textContent = noQuick ? "The toolbox installed here has no quick route yet: update its engineering plugin, or choose Medium." : "";
      const skill = isBug ? "/tt-debug" : l.skill;
      happens.replaceChildren("Makes ", el("strong", {}, info.nextId || "the next feature"), ` (${title.value.trim() || "…"}), writes its Ticket, makes the branch, and opens a session running `, el("code", {}, skill), ".");
      go.disabled = noQuick || !title.value.trim() || !summary.value.trim() || !project;
    };
    for (const n of [slider, summary, feature.r, bug.r]) { n.addEventListener("input", paint); n.addEventListener("change", paint); }

    go.addEventListener("click", async () => {
      go.disabled = true;
      result.replaceChildren(el("span", { class: "dim small" }, "Setting it up and opening a session…"));
      tell("allow-foreground");
      try {
        const r = await api("/api/intake/start", {
          chat: chat.id, title: title.value.trim(), summary: summary.value.trim(),
          acceptance: done.value.split("\n").map(s => s.trim()).filter(Boolean), kind: kind(), level: level().id, project,
          ...(branchInfo.repo && branch.value.trim() ? { branchName: branch.value.trim() } : {}), // (what is on the card is what is made)
          ...(wt.checked ? { isolate: true } : {}), ...picker.fields() });
        chatId = ""; intakeStore(""); gen++; draft = "";
        if (r.feature && typeof featureCache !== "undefined") featureCache.delete(r.feature);
        if (r.ok && r.tag) {
          sessionInfo.set(r.tag, { tag: r.tag, feature: r.feature, name: r.name, command: r.command, project: r.project,
            started: Date.now() / 1000, status: "starting" });
          location.hash = "#workflows/" + encodeURIComponent(r.tag);
        } else {
          node.replaceChildren(el("h3", {}, `${r.feature} is set up`),
            el("p", { class: "st missing" }, "Couldn't open a terminal here. Run this yourself:"), el("pre", {}, r.said || r.command || ""),
            el("a", { href: featureHref(r.feature) }, "Open the feature"));
        }
      } catch (e) { result.replaceChildren(el("p", { class: "st missing" }, String(e.message || e))); paint(); }
    });

    const card = el("div", { class: "intake-card card" },
      el("div", { class: "intake-card-head" }, el("strong", {}, "Is this right?"),
        el("span", { class: "dim small" }, " Change anything that is off; nothing is made until you press Create and start.")),
      el("label", { class: "intake-field" }, el("span", { class: "dim small" }, "Title"), title),
      el("label", { class: "intake-field" }, el("span", { class: "dim small" }, "Summary"), summary),
      el("label", { class: "intake-field" }, el("span", { class: "dim small" }, "Done when"), done),
      t.unknowns.length ? el("div", { class: "small dim intake-unknowns" }, "Tatty is still unsure of: ", t.unknowns.join("; ")) : "",
      el("div", { class: "intake-kind" }, feature.node, bug.node),
      effort, bugNote,
      el("div", { class: "intake-where-card" }, projectLine, branchLine),
      picker.node, happens,
      el("div", { class: "intake-buttons" }, go,
        el("button", { type: "button", onclick: () => view.focus() }, "Not quite: keep talking"),
        el("button", { type: "button", onclick: () => startOver() }, "Discard")),
      result);
    paintProject(); paint(); proposeBranch();
    loadInfo().then(paint); // (the ID it would get, as of now)
    return card;
  };

  // ---------------------------------------------------------------- showing the right thing
  const attach = async () => {
    const mine = ++gen;
    node.replaceChildren(el("p", { class: "dim small" }, "…"));
    await loadInfo();
    if (mine !== gen) return;
    if (chatId) {
      try {
        const c = await api("/api/chat?id=" + encodeURIComponent(chatId));
        if (mine !== gen) return;
        if (c.kind === "intake" && !c.closed && !(c.started && c.started !== "starting")) { conversation(chatId); return; }
      } catch { /* it is gone */ }
      chatId = ""; intakeStore("");
    }
    first();
  };

  return { node, attach };
}
