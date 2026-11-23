"use strict";
// The Merge requests page (#mrs, #mrs/<key>[/<tab>]): every open request of the project that involves the person,
// who needs what from them, and an assisted review of a colleague's request: its files with lines to pick, its
// discussion, the review Tatty writes, and a chat that can read the code. Tatty sends nothing on its own: a comment,
// a reply or a resolve goes only from the confirm sheet, which shows the exact text and where it lands (the server
// checks that sheet's hash again before it sends). Uses mr.js's parts (mrSignals, mrOverviewTab, mrThreadHead, ...),
// diff.js's diffTable and chat.js's chatView. Everything from the host is set as text, never as markup.

const mrsHref = (key, tab) => "#mrs" + (key ? "/" + encodeURIComponent(key) + (tab && tab !== "overview" ? "/" + tab : "") : "");
const MRS_REASON = { "review-requested": "review requested", "new-commits": "new commits", "new-comments": "new comments", new: "new" };
const MRS_ROLE = { author: "yours", reviewer: "you review", assignee: "assigned", mentioned: "mentioned" };
const MRS_GROUP = {
  needs: ["Needs me", "A review asked of you, or comments on your own request."],
  mine: ["My merge requests", "Requests you opened."],
  watching: ["Watching", "Ones you have looked at, are assigned or mentioned in, that don't need you now."],
};
const MRS_SEV = { blocker: "bad", major: "bad", minor: "todo", nit: "todo" };
const MRS_AGAIN_VERDICT = { addressed: ["addressed", "done"], partly: ["partly addressed", "todo"], "not-addressed": ["not addressed", "bad"], unclear: ["your call", "route"], nochange: ["nothing changed", "route"] };
const MRS_AGAIN_WHY = { replied: "the author replied", changed: "the file changed", resolved: "marked resolved" };
let mrsView = null; // the page on screen
let mrsSoon = 0;

// ---- the count on the nav link and the Engineering home's tile
function mrsPaintBadge(n) {
  for (const a of document.querySelectorAll('.pnav a[data-page="mrs"], .mode-tile[href="#mrs"]')) {
    if (n > 0) a.dataset.badge = String(n); else delete a.dataset.badge;
  }
}
document.addEventListener("tt-event", e => {
  const ev = e.detail;
  if (!ev || ev.type !== "mrs") return;
  if (ev.list) mrsPaintBadge(ev.needsMe || 0);
  if (mrsView && mrsView.box.isConnected) mrsView.onEvent(ev);
});
// (one quiet read at the start for the count: it never asks the host)
setTimeout(() => api("/api/mrs?quiet=1").then(d => mrsPaintBadge(d.counts.needsMe)).catch(() => {}), 3000);

const mrsErr = e => String((e && e.message) || e);
const mrsLater = (fn, ms = 300) => { clearTimeout(mrsSoon); mrsSoon = setTimeout(fn, ms); };
const mrsTyping = box => document.activeElement && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName) && box.contains(document.activeElement);

async function renderMrs(box, key, tab) {
  if (mrsView && mrsView.stop) mrsView.stop();
  if (key) return mrsDetail(box, key, ["overview", "files", "discussion", "review"].includes(tab) ? tab : "overview");
  return mrsInbox(box);
}

// ================================================================ the inbox
async function mrsInbox(box) {
  const root = el("div", { class: "mrs-page mrs-inbox" });
  box.replaceChildren(root);
  let data = null, reading = false, failed = "";
  const view = mrsView = { box, key: "", stop() { clearTimeout(mrsSoon); }, onEvent(ev) { if (ev.list) mrsLater(() => load(false)); } };

  const row = (r, i) => {
    const mark = data.kind === "github" ? "#" : "!";
    const a = el("a", { class: "mrs-row" + (r.unread ? " unread" : "") + (r.needsMe ? " needs" : ""), href: mrsHref(r.key), "data-key": r.key },
      el("span", { class: "mrs-dot", "aria-hidden": "true" }), mrAvatar(r.author),
      el("span", { class: "mrs-main" }, el("strong", { class: "mrs-title" }, r.title || "(no title)"),
        el("span", { class: "mrs-sub dim small" }, `${mark}${r.id} · `, el("code", {}, r.source), " → ", el("code", {}, r.target), ` · ${r.author || "someone"}`)),
      el("span", { class: "mrs-chips" },
        r.roles.map(x => el("span", { class: "chip route" }, MRS_ROLE[x] || x)),
        r.reasons.map(x => el("span", { class: "chip now" }, MRS_REASON[x] || x)),
        r.draft ? el("span", { class: "chip todo" }, "draft") : "", r.conflicts ? el("span", { class: "chip bad" }, "conflicts") : "",
        r.busy ? el("span", { class: "chip now" }, "Tatty is on it") : "",
        r.notes ? el("span", { class: "dim small", title: "comments" }, `✎ ${r.notes}`) : ""),
      el("span", { class: "dim small mrs-age" }, mrWhen(r.updated)));
    a.style.setProperty("--i", String(Math.min(i, 14)));
    return a;
  };

  const draw = () => {
    if (!data) { root.replaceChildren(el("p", { class: "dim pad" }, "Reading…")); return; }
    root.classList.toggle("still", !mrMotion());
    const refresh = el("button", { type: "button", id: "mrs-refresh", disabled: reading, onclick: () => load(true) }, reading ? [spinnerMark("sp-mark"), " Reading…"] : "Refresh");
    const head = el("div", { class: "mrs-head" }, el("h2", {}, "Merge requests"),
      el("span", { class: "dim small" }, data.path ? `${data.path} · ${data.kind}` + (data.me ? ` · you are ${data.me}` : "") : ""), refresh,
      el("a", { href: "#settings", class: "small" }, data.poll ? `checks every ${data.poll} min` : "checking is off"));
    const why = failed || data.why;
    const notice = data.unsupported
      ? el("div", { class: "card mrs-unsupported", id: "mrs-unsupported" }, el("h4", {}, "This host isn't supported yet"), el("p", {}, data.why),
        el("p", { class: "small dim" }, "Only GitLab and GitHub can be read here. If this is a self-hosted GitLab or GitHub, tell Tatty in Settings → Merge request page."))
      : why ? el("p", { class: "st missing", id: "mrs-why" }, why) : "";
    const repo = el("div", { class: "mrs-repo small dim" }, "Repository: ", el("code", {}, data.repo || "none chosen"), " ",
      el("button", { type: "button", class: "linkish", id: "mrs-repo", onclick: async () => {
        try { const got = await api("/api/pick-folder", { title: "The repository whose merge requests to show" }); if (got.path) { await api("/api/mrs/repo", { repo: got.path }); load(true); } }
        catch (e) { alert(mrsErr(e)); }
      } }, "change"));
    const groups = ["needs", "mine", "watching"].map(g => {
      const rows = data.groups[g];
      if (!rows.length) return "";
      let n = 0;
      return el("section", { class: "mrs-group " + g, "data-group": g }, el("h3", {}, MRS_GROUP[g][0], el("span", { class: "chip " + (g === "needs" ? "now" : "todo") }, String(rows.length)),
        el("span", { class: "dim small" }, MRS_GROUP[g][1])), el("div", { class: "mrs-rows" }, rows.map(r => row(r, n++))));
    });
    const empty = !data.unsupported && !why && !data.counts.total
      ? el("div", { class: "card mrs-empty", id: "mrs-empty" }, el("p", {}, data.read ? "Nothing open involves you in this repository." : "Nothing has been read yet."), el("p", { class: "small dim" }, "Open requests you wrote, review, are assigned or are mentioned in show up here.")) : "";
    root.replaceChildren(head, repo, notice, ...groups, empty);
  };

  const load = async force => {
    if (force) { reading = true; failed = ""; draw(); }
    try { data = await api("/api/mrs" + (force ? "?force=1" : "?quiet=1")); mrsPaintBadge(data.counts.needsMe); }
    catch (e) { failed = mrsErr(e); }
    reading = false;
    if (view === mrsView && box.isConnected) draw();
  };
  draw();
  await load(false);
  await load(true);
}

// ================================================================ one request
async function mrsDetail(box, key, tab0) {
  const root = el("div", { class: "mrs-page mrs-detail" });
  root.classList.toggle("still", !mrMotion());
  root.append(el("div", { class: "sp-wait" }, makeSpinner({ size: "lg", label: "Opening merge request" }).node));   // until the first read draws over it
  box.replaceChildren(root);
  const enc = encodeURIComponent;
  const view = mrsView = { box, key, tab: tab0, data: null, file: "", pickedFor: "", all: false, ask: null, steps: {}, said: "", ticked: null, stop() { clearTimeout(mrsSoon); } };
  const api1 = (route, body) => api("/api/mrs/" + route, { key, ...body });
  const pending = () => (view.data.state.pending || []).filter(p => p.status !== "posted");
  const busy = id => view.data.busy.includes(id);

  view.onEvent = ev => {
    if (ev.key !== key && !ev.list) return;
    if (ev.busy && ev.step && !ev.done) { view.steps[ev.tid] = ev.step; const s = root.querySelector(`[data-step="${CSS.escape(ev.tid)}"]`); if (s) s.textContent = ev.step; return; }
    if (ev.key === key) mrsLater(() => reload(false));
  };

  // ---- the confirm sheet: what will be sent, exactly, and where; the server sends only what this hash covers
  const sheet = async (items, heading) => {
    let p;
    try { p = await api1("preview", { items }); } catch (e) { alert(mrsErr(e)); return false; }
    return new Promise(resolve => {
      const close = ok => { document.removeEventListener("keydown", onKey); back.remove(); resolve(ok); };
      const onKey = e => { if (e.key === "Escape") close(false); };
      const said = el("p", { class: "st missing", id: "mrs-sheet-said" });
      const go = el("button", { type: "button", class: "primary", id: "mrs-send" }, `Send ${p.actions.length === 1 ? "this" : p.actions.length}`);
      go.addEventListener("click", async () => {
        go.disabled = true; said.textContent = "";
        try {
          const r = await api1("post", { items, confirm: p.digest });
          const bad = r.results.filter(x => !x.ok);
          if (bad.length) { said.textContent = `${bad.length} of ${r.results.length} didn't go: ${bad[0].note}`; go.disabled = false; reload(true); return; }
          close(true);
        } catch (e) { said.textContent = mrsErr(e); go.disabled = e.status !== 409 ? false : true; }
      });
      const cancel = el("button", { type: "button", id: "mrs-cancel", onclick: () => close(false) }, "Cancel");
      const back = el("div", { class: "mrs-sheet-back", role: "dialog", "aria-modal": "true", "aria-label": heading },
        el("div", { class: "mrs-sheet card" }, el("h3", {}, heading),
          el("p", { class: "dim small" }, `This goes to ${p.host === "github" ? "GitHub" : "GitLab"} under your name, exactly as shown. Nothing else is sent.`),
          el("div", { class: "mrs-sheet-list" }, p.actions.map(a => el("div", { class: "mrs-send-item " + a.type },
            el("div", { class: "mrs-send-head" }, el("strong", {}, a.label), el("span", { class: "dim small" }, " on "), el("code", {}, a.where)),
            a.type === "resolve" ? el("p", { class: "small" }, a.on ? "Mark the thread resolved." : "Reopen the thread.") : el("pre", { class: "mrs-send-text" }, a.body)))),
          said, el("div", { class: "start-actions" }, go, cancel)));
      document.addEventListener("keydown", onKey);
      document.body.append(back);
      go.focus();
    });
  };

  // ---- the files
  const selectable = (table, path, onPick) => {
    let sel = null;
    const rows = () => [...table.tBodies[0].rows];
    const paint = () => {
      const all = rows();
      const [lo, hi] = sel ? [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)] : [-1, -2];
      all.forEach((tr, i) => tr.classList.toggle("mrs-sel", i >= lo && i <= hi && !!tr.querySelector("td.ln")));
    };
    const describe = () => {
      const all = rows();
      const [lo, hi] = [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)];
      const hunk = [], nums = [];
      let last = null;
      for (const tr of all.slice(lo, hi + 1)) {
        const c = tr.cells;
        if (c.length < 4 || !tr.querySelector("td.ln")) continue;
        const ok = k => c[k].className.includes("del") ? "-" : c[k].className.includes("add") ? "+" : c[k].className.includes("ctx") ? " " : "";
        if (ok(1) === "-") hunk.push("-" + c[1].textContent);
        if (ok(3) === "+") hunk.push("+" + c[3].textContent);
        if (ok(1) === " ") hunk.push(" " + c[1].textContent);
        if (c[2].textContent || c[0].textContent) nums.push(c[2].textContent || c[0].textContent);
        last = c;
      }
      if (!last) return null;
      const oldN = Number(last[0].textContent) || 0, newN = Number(last[2].textContent) || 0;
      const side = newN && oldN ? "both" : newN ? "new" : "old";
      return { path, line: newN, oldLine: oldN, side, lines: nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : nums[0] || "", hunk: hunk.join("\n") };
    };
    table.addEventListener("click", e => {
      const td = e.target.closest("td.ln");
      if (!td || !td.textContent) return;
      const idx = rows().indexOf(td.parentElement);
      if (e.shiftKey && sel) sel.b = idx; else if (sel && sel.a === idx && sel.b === idx) sel = null; else sel = { a: idx, b: idx };
      paint();
      onPick(sel ? describe() : null);
    });
    return { clear() { sel = null; paint(); onPick(null); } };
  };

  const lineRow = (table, n, side) => [...table.tBodies[0].rows].find(tr => tr.cells.length >= 4 && tr.querySelector("td.ln") && (side === "old" ? tr.cells[0].textContent : tr.cells[2].textContent) === String(n));
  const inlineCard = (table, n, side, node) => {
    const at = lineRow(table, n, side);
    if (!at) return false;
    let after = at;
    while (after.nextElementSibling && after.nextElementSibling.classList.contains("mrs-inline")) after = after.nextElementSibling;
    after.after(el("tr", { class: "mrs-inline" }, el("td", { colspan: "4" }, node)));
    return true;
  };

  const composer = (start, onSave, onCancel) => {
    const ta = el("textarea", { rows: 3, class: "mr-draft mrs-compose", "aria-label": "Your comment", spellcheck: "true", placeholder: "Your comment on these lines" });
    ta.value = start || "";
    const save = el("button", { type: "button", class: "primary", id: "mrs-compose-save" }, "Keep as a draft");
    save.addEventListener("click", () => { if (ta.value.trim()) onSave(ta.value.trim()); });
    const node = el("div", { class: "card mrs-compose-card" }, ta, el("div", { class: "start-actions" }, save, el("button", { type: "button", onclick: onCancel }, "Cancel"),
      el("span", { class: "dim small" }, "Not sent yet: you send it with the others from the Review tab.")));
    requestAnimationFrame(() => ta.focus());
    return node;
  };

  const pendingCard = p => {
    const ta = el("textarea", { rows: 3, class: "mr-draft", "aria-label": "Draft comment", spellcheck: "true" });
    ta.value = p.body;
    let t = 0;
    ta.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => api1("comment", { op: "edit", cid: p.cid, body: ta.value }).catch(() => {}), 600); });
    return el("div", { class: "card mrs-pending", "data-cid": p.cid }, el("div", { class: "mrs-pending-head" }, el("span", { class: "chip now" }, "draft"),
      el("span", { class: "dim small" }, p.from === "review" ? "Tatty's review" : p.from === "chat" ? "from the chat" : "yours"),
      p.severity ? el("span", { class: "chip " + (MRS_SEV[p.severity] || "todo") }, p.severity) : "",
      el("button", { type: "button", class: "linkish", onclick: async () => { await api1("comment", { op: "drop", cid: p.cid }); reload(false); } }, "drop")), ta);
  };

  const filesTab = () => {
    const mr = view.data.mr;
    const counts = {};
    for (const t of mr.threads) if (t.path) counts[t.path] = (counts[t.path] || 0) + 1;
    for (const p of pending()) if (p.path) counts[p.path] = (counts[p.path] || 0) + 1;
    const pane = el("div", { class: "mr-diff-pane mrs-pane" }, el("p", { class: "dim small" }, mr.files.length ? "Choose a file." : "No changed files."));
    const list = el("div", { class: "mr-files" }, mr.files.map(file => {
      const [mark, kind] = MR_STATUS_MARK[file.status] || MR_STATUS_MARK.modified;
      const fill = el("i", { class: "mr-split" }); fill.style.setProperty("--add", String(file.add + file.del ? Math.round(100 * file.add / (file.add + file.del)) : 0));
      const b = el("button", { type: "button", class: "mr-file" + (view.file === file.path ? " open" : ""), "data-path": file.path },
        el("span", { class: "mr-mark " + kind }, mark), el("span", { class: "mr-fname" }, file.path.split("/").pop()), el("span", { class: "dim small mr-fdir" }, file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""),
        el("span", { class: "mr-fcount" }, el("span", { class: "add" }, "+" + file.add), el("span", { class: "del" }, "−" + file.del), el("span", { class: "mr-minibar" }, fill),
          counts[file.path] ? el("span", { class: "chip now" }, String(counts[file.path])) : ""));
      b.addEventListener("click", () => { view.file = file.path; for (const o of list.children) o.classList.toggle("open", o === b); showFile(file.path); });
      return b;
    }));
    const showFile = async path => {
      pane.replaceChildren(el("p", { class: "dim small" }, "Reading the diff…"));
      let d;
      try { d = await api("/api/mrs/diff?key=" + enc(key) + "&path=" + enc(path)); } catch (e) { pane.replaceChildren(el("p", { class: "st missing" }, mrsErr(e))); return; }
      const bar = el("div", { class: "mrs-pickbar", id: "mrs-pickbar", hidden: true });
      const slot = el("div", { class: "mrs-compose-slot" });
      const table = d.hunks.length && !d.binary ? diffTable(d.hunks) : null;
      let picked = null;
      const sel = table ? selectable(table, path, p => {
        picked = p;
        bar.hidden = !p;
        bar.replaceChildren(...(p ? [el("span", { class: "dim small" }, `${path.split("/").pop()}:${p.lines}`),
          el("button", { type: "button", class: "primary", id: "mrs-pick-ask", onclick: () => ask(p) }, "Ask Tatty"),
          el("button", { type: "button", id: "mrs-pick-comment", onclick: () => slot.replaceChildren(composer("", async body => {
            await api1("comment", { op: "add", path, line: p.line, oldLine: p.oldLine, side: p.side, body });
            slot.replaceChildren(); sel.clear(); reload(false);
          }, () => slot.replaceChildren())) }, "Comment"),
          el("button", { type: "button", id: "mrs-pick-explain", onclick: () => ask(null, `Explain what changed in ${path} and anything in it I should look at closely.`) }, "Explain file")] : []));
      }) : null;
      if (table) {
        for (const t of mr.threads.filter(x => x.path === path && x.line)) {
          inlineCard(table, t.line, "new", el("div", { class: "card mrs-thread-inline" + (t.resolved ? " resolved" : "") }, mrNotes(t).slice(0, 3),
            el("button", { type: "button", class: "linkish", onclick: () => { view.tab = "discussion"; draw(); } }, "open in Discussion")));
        }
        for (const p of pending().filter(x => x.path === path)) inlineCard(table, p.side === "old" ? p.oldLine : p.line, p.side === "old" ? "old" : "new", pendingCard(p));
      }
      const loose = pending().filter(x => x.path === path && table && !lineRow(table, x.side === "old" ? x.oldLine : x.line, x.side === "old" ? "old" : "new"));
      pane.replaceChildren(el("div", { class: "cd-head" }, el("code", { class: "mono" }, path), el("span", { class: "dim small" }, " click a line number to pick it; shift-click to pick a range")),
        d.binary ? el("p", { class: "dim" }, "A binary file: no text to show.") : table ? el("div", { class: "diff-scroll" }, table) : el("p", { class: "dim" }, "No lines changed."),
        d.cut ? el("p", { class: "diff-note" }, "Only the first part of this file's change is shown.") : "", slot, bar, loose.map(pendingCard));
      pane.dataset.picked = picked ? "1" : "";
    };
    if (view.file && mr.files.some(x => x.path === view.file)) showFile(view.file);
    return el("div", { class: "mr-diff" }, list, pane);
  };

  // ---- the chat
  const ask = async (p, prefill) => {
    view.ask = view.ask || { open: true };
    view.ask.open = true;
    try {
      const r = await api1("chat", { context: p ? { path: p.path, lines: p.lines, hunk: p.hunk } : {} });
      const cv = chatView(r.chat.id, { bare: true, placeholder: "Ask about this change…  (Enter sends)", empty: "Ask about the change. Tatty reads the changed files as the request has them, and can't change anything." });
      view.ask.chat = cv; view.ask.id = r.chat.id;
      const quote = p ? (r.reused ? `About ${p.path} lines ${p.lines}:\n\`\`\`diff\n${p.hunk}\n\`\`\`\n` : "") : "";
      drawAsk();
      if (cv.setText) cv.setText(prefill || quote);
      cv.focus();
    } catch (e) { alert(mrsErr(e)); }
  };

  const drawAsk = () => {
    const slot = root.querySelector(".mrs-ask");
    if (!slot) return;
    slot.hidden = !(view.ask && view.ask.open);
    root.classList.toggle("asking", !slot.hidden);
    if (slot.hidden || !view.ask.chat) return;
    if (!slot.contains(view.ask.chat.node)) slot.replaceChildren(el("div", { class: "mrs-ask-head" }, el("strong", {}, "Ask Tatty"),
      el("button", { type: "button", class: "linkish", id: "mrs-ask-close", onclick: () => { view.ask.open = false; drawAsk(); } }, "hide")), view.ask.chat.node);
  };

  // ---- the discussion
  const discussion = () => {
    const mr = view.data.mr;
    const threads = mr.threads.filter(t => !t.resolved || view.all);
    const resolved = mr.threads.filter(t => t.resolved).length;
    const toggle = el("label", { class: "small" }, el("input", { type: "checkbox", id: "mrs-all" }), ` Show the ${resolved} resolved`);
    toggle.querySelector("input").checked = view.all;
    toggle.querySelector("input").addEventListener("change", e => { view.all = e.target.checked; draw(); });
    const card = (t, i) => {
      const st = view.data.state.replies[t.id] || {};
      const rec = st.recommendation || {};
      const working = busy(t.id);
      const meta = rec.action ? MR_ACTION[rec.action] : null;
      const reply = el("textarea", { class: "mr-draft", rows: 3, "aria-label": "Your reply", spellcheck: "true", placeholder: "Your reply to this thread" });
      reply.value = st.text || "";
      let saving = 0;
      reply.addEventListener("input", () => { clearTimeout(saving); saving = setTimeout(() => api1("draft", { tid: t.id, text: reply.value }).catch(() => {}), 500); });
      const help = el("button", { type: "button", class: "mrs-help", disabled: working, onclick: async () => { try { await api1("recommend", { tid: t.id }); } catch (e) { alert(mrsErr(e)); } reload(false); } },
        working ? "Working…" : rec.action ? "Look again" : "Help me reply");
      const post = el("button", { type: "button", class: "primary mrs-post-reply", onclick: async () => {
        await api1("draft", { tid: t.id, text: reply.value });
        if (await sheet([{ kind: "reply", tid: t.id }], "Send this reply")) reload(true);
      } }, "Post reply…");
      const resolve = el("button", { type: "button", class: "mrs-resolve", onclick: async () => { if (await sheet([{ kind: "resolve", tid: t.id, on: !t.resolved }], t.resolved ? "Reopen this thread" : "Resolve this thread")) reload(true); } },
        t.resolved ? "Reopen…" : "Resolve…");
      const out = el("div", { class: "card mr-thread mrs-thread" + (t.resolved ? " resolved" : ""), "data-id": t.id },
        mrThreadHead(t, x => { view.tab = "files"; view.file = x.path; draw(); }), ...mrNotes(t),
        el("div", { class: "mr-actions" }, help, working ? el("span", { class: "dim small mr-step", "data-step": t.id }, view.steps[t.id] || "Starting") : "",
          working ? el("button", { type: "button", onclick: () => api1("cancel", { tid: t.id }) }, "Stop") : ""),
        rec.error ? el("p", { class: "st missing mr-error" }, rec.error) : "",
        meta ? el("div", { class: "mr-rec " + rec.action }, el("div", { class: "mr-rec-head" }, mrTip(el("span", { class: "mr-action " + rec.action }, el("i", {}, meta.icon), " " + meta.word), meta.tip), el("strong", {}, rec.summary || "")),
          rec.reasoning ? mdNode(rec.reasoning) : "") : "",
        el("div", { class: "mr-reply" }, el("div", { class: "dim small" }, st.sent ? "Your last reply went out. Write another if you like." : "Your reply: a draft until you press Post reply"), reply,
          el("div", { class: "start-actions" }, post, resolve)));
      out.style.setProperty("--i", String(Math.min(i, 12)));
      return out;
    };
    let n = 0;
    return el("div", {}, el("div", { class: "mr-bar-top" }, el("strong", {}, `${mr.threads.filter(mrOpen).length} open`), resolved ? toggle : ""),
      threads.length ? threads.map(t => card(t, n++)) : el("p", { class: "dim pad" }, mr.threads.length ? "Every thread is resolved." : "No comments yet."));
  };

  // ---- looking again at the comments you made: only the threads you began that the author answered or changed code for
  const againCard = () => {
    const d = view.data, threads = d.mr.threads, cands = d.again || [], running = busy("rereview");
    const results = ((d.state.rereview || {}).results || []).filter(x => threads.some(t => t.id === x.tid));
    if (!cands.length && !results.length && !running) return "";
    const thread = tid => threads.find(t => t.id === tid) || {};
    const whereBtn = tid => { const t = thread(tid); return t.path ? el("button", { type: "button", class: "mr-where", onclick: () => { view.tab = "files"; view.file = t.path; draw(); } }, `${t.path}:${t.line || ""}`) : el("span", { class: "chip route" }, "general"); };
    const picks = new Map();
    const label = n => running ? "Looking again…" : n ? `Re-review ${n} addressed comment${n === 1 ? "" : "s"}` : "Nothing ticked";
    const go = el("button", { type: "button", class: "primary", id: "mrs-again", disabled: running || !cands.length, onclick: async () => {
      const tids = [...picks].filter(([, b]) => b.checked).map(([t]) => t);
      try { await api1("again", { tids }); } catch (e) { alert(mrsErr(e)); }
      reload(false);
    } }, label(cands.length));
    const rows = cands.map(c => {
      const box = el("input", { type: "checkbox", class: "mrs-again-pick", "aria-label": "Re-review this comment" });
      box.checked = true;
      box.addEventListener("change", () => { const n = [...picks.values()].filter(b => b.checked).length; go.disabled = running || !n; go.textContent = label(n); });
      picks.set(c.tid, box);
      return el("div", { class: "mrs-again-row" }, box, whereBtn(c.tid), c.why.map(w => el("span", { class: "chip route" }, MRS_AGAIN_WHY[w] || w)),
        el("span", { class: "dim small" }, ((thread(c.tid).notes || [])[0] || {}).body ? ((thread(c.tid).notes[0].body).split("\n")[0].slice(0, 90)) : ""));
    });
    const card = x => {
      const st = d.state.replies[x.tid] || {};
      const [word, chip] = MRS_AGAIN_VERDICT[x.verdict] || MRS_AGAIN_VERDICT.unclear;
      const reply = el("textarea", { class: "mr-draft", rows: 3, "aria-label": "Your reply", spellcheck: "true", placeholder: "Your reply to this thread" });
      reply.value = st.text || "";
      let saving = 0;
      reply.addEventListener("input", () => { clearTimeout(saving); saving = setTimeout(() => api1("draft", { tid: x.tid, text: reply.value }).catch(() => {}), 500); });
      const send = el("button", { type: "button", class: "mrs-again-reply", onclick: async () => {
        await api1("draft", { tid: x.tid, text: reply.value });
        if (await sheet([{ kind: "reply", tid: x.tid }], "Send this reply")) reload(true);
      } }, "Post reply…");
      const t = thread(x.tid);
      const resolve = el("button", { type: "button", class: x.resolve && !t.resolved ? "primary mrs-again-resolve" : "mrs-again-resolve", onclick: async () => {
        if (await sheet([{ kind: "resolve", tid: x.tid, on: !t.resolved }], t.resolved ? "Reopen this thread" : "Resolve this thread")) reload(true);
      } }, t.resolved ? "Reopen…" : "Resolve…");
      return el("div", { class: "card mrs-again-card", "data-tid": x.tid }, el("div", { class: "mrs-pending-head" }, whereBtn(x.tid), el("span", { class: "chip " + chip }, word),
        t.resolved ? el("span", { class: "chip route" }, "resolved") : ""), x.summary ? el("p", {}, x.summary) : "",
        x.verdict === "nochange" ? "" : el("div", { class: "mr-reply" }, reply, el("div", { class: "start-actions" }, send, resolve)));
    };
    const res = d.state.rereview || {};
    return el("div", { class: "card mrs-again", id: "mrs-again-card" }, el("div", { class: "mr-rec-head" }, el("strong", {}, "Your comments, again")),
      el("p", { class: "dim small" }, "The comments you made that the author has answered, or whose file has changed since. Tatty looks only at those threads and only at whether each one is dealt with: it doesn't review anything else. Nothing is sent until you confirm."),
      rows.length ? el("div", { class: "mrs-again-list" }, rows) : "",
      el("div", { class: "start-actions" }, go, running ? el("button", { type: "button", onclick: () => api1("cancel", { tid: "rereview" }) }, "Stop") : "",
        running ? el("span", { class: "dim small mr-step", "data-step": "rereview" }, view.steps.rereview || "Starting") : "",
        res.model && !running ? el("span", { class: "dim small" }, `${res.model}${res.cost ? " · $" + res.cost.toFixed(2) : ""}`) : ""),
      res.error ? el("p", { class: "st missing" }, res.error) : "", results.map(card));
  };

  // ---- the review
  const reviewTab = () => {
    const d = view.data, rev = d.state.review, running = busy("review");
    const go = depth => el("button", { type: "button", class: depth === "quick" ? "primary" : "", id: "mrs-review-" + depth, disabled: running || !d.mr,
      onclick: async () => { try { await api1("review", { depth }); } catch (e) { alert(mrsErr(e)); } reload(false); } },
      depth === "quick" ? (rev ? "Review again (quick)" : "Review this (quick)") : "Deep review");
    const run = el("div", { class: "mrs-run card" }, el("div", { class: "start-actions" }, go("quick"), go("deep"),
      running ? el("button", { type: "button", onclick: () => api1("cancel", { tid: "review" }) }, "Stop") : "",
      running ? el("span", { class: "dim small mr-step", "data-step": "review" }, view.steps.review || "Starting") : ""),
      el("p", { class: "dim small" }, "Quick: one reader, a small budget. Deep: a bigger budget and helpers, so it costs more. Either reads the changed files and writes comments for you to keep or drop. Nothing is sent until you confirm."),
      rev && rev.error ? el("p", { class: "st missing" }, rev.error) : "");
    const summary = rev && rev.summary ? el("div", { class: "card mrs-summary" }, el("div", { class: "mr-rec-head" }, el("strong", {}, "Tatty's reading"),
      el("span", { class: "chip " + (rev.risk === "high" ? "bad" : rev.risk === "low" ? "done" : "todo") }, `${rev.risk} risk`),
      el("span", { class: "dim small" }, `${rev.depth} · ${rev.model}${rev.cost ? " · $" + rev.cost.toFixed(2) : ""}`)), mdNode(rev.summary),
      (rev.questions || []).length ? el("div", {}, el("h4", {}, "Questions for the author"), el("ul", {}, rev.questions.map(q => el("li", {}, q)))) : "") : "";
    const drafts = pending();
    const checks = new Map();
    const list = drafts.map(p => {
      const box = el("input", { type: "checkbox", "aria-label": "Send this comment", class: "mrs-keep" });
      box.checked = !view.ticked || view.ticked.has(p.cid);
      box.addEventListener("change", () => { view.ticked = new Set([...checks].filter(([, b]) => b.checked).map(([c]) => c)); sendBtn.disabled = !view.ticked.size; sendBtn.textContent = label(view.ticked.size); });
      checks.set(p.cid, box);
      const where = p.path ? el("button", { type: "button", class: "mr-where", onclick: () => { view.tab = "files"; view.file = p.path; draw(); } }, `${p.path}:${p.side === "old" ? p.oldLine : p.line || ""}`) : el("span", { class: "chip route" }, "general");
      const c = pendingCard(p);
      c.querySelector(".mrs-pending-head").prepend(box, where);
      return c;
    });
    const label = n => n ? `Send ${n} comment${n === 1 ? "" : "s"} as a review…` : "Nothing ticked";
    const initial = drafts.filter(p => !view.ticked || view.ticked.has(p.cid)).length;
    const sendBtn = el("button", { type: "button", class: "primary", id: "mrs-send-review", disabled: !initial, onclick: async () => {
      const items = [...checks].filter(([, b]) => b.checked).map(([cid]) => ({ kind: "comment", cid }));
      if (items.length && await sheet(items, `Send ${items.length} comment${items.length === 1 ? "" : "s"} as one review`)) { view.ticked = null; reload(true); }
    } }, label(initial));
    const failedOnes = drafts.filter(p => p.status === "failed");
    return el("div", {}, run, againCard(), summary,
      el("div", { class: "mr-bar-top" }, el("strong", {}, `${drafts.length} comment${drafts.length === 1 ? "" : "s"} waiting`), drafts.length ? sendBtn : ""),
      failedOnes.length ? el("p", { class: "st missing" }, `${failedOnes.length} didn't go: ${failedOnes[0].error || "the host refused it"}. They are still here.`) : "",
      drafts.length ? list : el("p", { class: "dim pad" }, "No comments waiting. Pick lines on the Files tab and press Comment, or run a review."));
  };

  // ---- the page
  const MARK = () => (view.data.kind === "github" ? "#" : "!");
  function draw() {
    const d = view.data;
    if (!d) return;
    mrPopHide();
    root.classList.toggle("still", !mrMotion());
    const mr = d.mr;
    if (!mr) {
      root.replaceChildren(el("a", { href: "#mrs", class: "small" }, "← Merge requests"), el("div", { class: "card" }, el("p", {}, d.why || "This merge request couldn't be read.")),
        el("div", { class: "start-actions" }, el("button", { type: "button", id: "mrs-refresh", onclick: () => reload(true) }, "Refresh")));
      return;
    }
    const st = mr.stats || { add: 0, del: 0, files: mr.files.length };
    const hero = el("div", { class: "mr-hero " + (mr.state || "") },
      el("div", { class: "mr-hero-top" }, el("h2", {}, mr.title || "Merge request", el("span", { class: "dim mr-id" }, ` ${MARK()}${mr.id}`)),
        el("span", { class: "mr-links" }, mr.url ? el("a", { class: "go-btn", id: "mrs-go", href: mr.url, target: "_blank", rel: "noopener" }, "Go to MR") : "",
          el("button", { type: "button", id: "mrs-refresh", onclick: () => reload(true) }, "Refresh"),
          el("button", { type: "button", id: "mrs-ask-open", onclick: () => ask(null) }, "Ask Tatty"))),
      el("div", { class: "mr-meta" }, mr.state ? el("span", { class: "chip " + (MR_STATE_CHIP[mr.state] || "todo") }, mr.state) : "", mr.draft ? el("span", { class: "chip todo" }, "draft") : "",
        mr.author ? mrWho(mr.author) : "", mr.source ? el("span", { class: "mr-branches" }, el("code", {}, mr.source), " → ", el("code", {}, mr.target)) : "",
        d.roles.map(x => el("span", { class: "chip route" }, MRS_ROLE[x] || x)),
        el("span", { class: "dim small mr-stats" }, `${st.files} file${st.files === 1 ? "" : "s"} `, el("span", { class: "add" }, "+" + st.add), " ", el("span", { class: "del" }, "−" + st.del),
          mr.updated ? ` · updated ${mrWhen(mr.updated)}` : "")),
      el("div", { class: "mr-signals", id: "mrs-signals" }, mrSignals(mr, true)));
    const nPend = pending().length;
    const tabs = [["overview", "Overview"], ["files", `Files · ${mr.files.length}`], ["discussion", `Discussion · ${mr.threads.filter(mrOpen).length}`], ["review", `Review${nPend ? " · " + nPend + " draft" + (nPend === 1 ? "" : "s") : ""}${(d.again || []).length ? " · " + d.again.length + " to re-check" : ""}`]];
    const body = view.tab === "files" ? filesTab() : view.tab === "discussion" ? discussion() : view.tab === "review" ? reviewTab()
      : el("div", {}, el("div", { class: "card" }, mrPeopleBlock(mr)), mrOverviewTab(mr));
    const main = el("div", { class: "mrs-main-col" }, el("a", { href: "#mrs", class: "small" }, "← Merge requests"), hero,
      d.why ? el("p", { class: "st missing", id: "mrs-why" }, d.why) : "",
      el("div", { class: "mr-tabs", role: "tablist" }, tabs.map(([k, label]) => el("button", { type: "button", role: "tab", "data-tab": k, class: view.tab === k ? "on" : "", "aria-selected": String(view.tab === k),
        onclick: () => { view.tab = k; history.replaceState(null, "", mrsHref(key, k)); draw(); } }, label))),
      el("div", { class: "mr-body" }, body));
    const askCol = el("aside", { class: "mrs-ask card", hidden: true });
    root.replaceChildren(main, askCol);
    drawAsk();
  }

  async function reload(force) {
    let d;
    try { d = await api("/api/mrs/one?key=" + enc(key) + (force ? "&force=1" : "")); }
    catch (e) { if (!view.data) root.replaceChildren(el("p", { class: "st missing pad" }, mrsErr(e))); return; }
    if (view !== mrsView || !box.isConnected) return;
    view.data = d;
    if (mrsTyping(root)) return;
    draw();
  }

  // a chat's "Add as comment" button (chat.js): the block becomes comments waiting to be sent
  const onAdd = async e => {
    const { key: k, comments, button } = e.detail;
    if (k !== key) return;
    try {
      for (const c of comments) if (c && c.body) await api1("comment", { op: "add", path: String(c.path || ""), line: Number(c.line) || 0, side: "new", body: String(c.body), from: "chat" });
      if (button) { button.textContent = "Added: see Review"; button.disabled = true; }
      reload(false);
    } catch (err) { alert(mrsErr(err)); }
  };
  document.addEventListener("mrs-add-comment", onAdd);
  const stop = view.stop;
  view.stop = () => { stop(); document.removeEventListener("mrs-add-comment", onAdd); };

  // looking at it clears what was news
  api1("seen", {}).catch(() => {});
  await reload(false);
  reload(true);
}

// In a request's chat (chat.js): a fenced tatty-comment block (one {path, line, body}, or a list) gets an "Add as comment" button.
function mrCommentButtons(body, chat) {
  for (const pre of body.querySelectorAll('pre[data-lang="tatty-comment"]')) {
    let got;
    try { got = JSON.parse(pre.textContent); } catch { continue; }
    const comments = (Array.isArray(got) ? got : [got]).filter(c => c && typeof c === "object" && c.body);
    if (!comments.length) continue;
    pre.after(el("button", { type: "button", class: "mrs-add-comment", onclick: e => document.dispatchEvent(new CustomEvent("mrs-add-comment", { detail: { key: chat.mr, comments, button: e.currentTarget } })) },
      `Add as comment${comments.length === 1 ? "" : "s"}`));
  }
}
