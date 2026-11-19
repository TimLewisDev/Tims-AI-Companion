// The Merge request page (#feature/<name>/merge-request; the server's "the merge request page").
// The feature's merge / pull request as its host has it: the request, its comment threads and its diff.
// A comment can be looked into by an agent that reads the code (Recommend action): act, rebut or ask,
// with a reply drafted for the person to copy. Ticking "Make this change" on comments and pressing
// "Make N changes" starts a session that edits the code, and the Commit page commits it; the ticked
// comments' replies are then drafted with "Fixed in <sha>". Nothing here posts anything to the host.

const featureMrHref = name => "#feature/" + encodeURIComponent(name) + "/merge-request";
let mrView = null; // the page being shown: {name, main, ...}; one at a time
let mrSoon = 0;

document.addEventListener("tt-event", e => {
  const ev = e.detail;
  if (!mrView || !ev || ev.type !== "mr" || ev.name !== mrView.name || !mrView.main.isConnected) return;
  const view = mrView;
  clearTimeout(mrSoon);
  mrSoon = setTimeout(() => { if (view === mrView && view.main.isConnected) view.reload(ev.thread || ""); }, 250);
});

const MR_STATE_CHIP = { opened: "now", merged: "done", closed: "todo" };
const MR_PIPE_CHIP = { passed: "done", failed: "bad", running: "now" };
const MR_ACTION = { act: ["Act on it", "now"], rebut: ["Rebut", "done"], ask: ["Ask", "todo"] };
const mrWhen = s => (s && Date.parse(s) ? ago(Date.parse(s) / 1000) : "");

async function mrPage(f, main) {
  const enc = encodeURIComponent;
  const view = mrView = { name: f.name, main, data: null, tab: "discussion", all: false, file: "", pending: false, said: "" };
  const root = el("div", { class: "mr-page" });
  main.replaceChildren(el("p", { class: "dim pad" }, "Reading the merge request…"));
  main.append(root);

  const busyNow = () => new Set(view.data ? view.data.busy : []);

  // ---- one comment thread
  const threadCard = t => {
    const st = (view.data.state || {})[t.id] || {};
    const rec = st.recommendation || {};
    const draft = st.draft || { text: "", edited: false, commit: "" };
    const working = busyNow().has(t.id);
    const where = t.path ? `${t.path}${t.line ? ":" + t.line : ""}` : "";
    const head = el("div", { class: "mr-thread-head" },
      where ? el("button", { type: "button", class: "mr-where", title: "Show this file's diff", onclick: () => { view.tab = "diff"; view.file = t.path; draw(); } }, where)
        : el("span", { class: "chip route" }, "general"),
      t.resolved ? el("span", { class: "chip done" }, "resolved") : "", t.outdated ? el("span", { class: "chip todo", title: "The code has changed since this comment" }, "outdated") : "",
      el("span", { class: "dim small" }, `${t.notes.length} comment${t.notes.length === 1 ? "" : "s"}`),
      t.url ? el("a", { class: "small", href: t.url, target: "_blank", rel: "noopener" }, "open on the host ↗") : "");
    const notes = t.notes.map(n => el("div", { class: "mr-note" },
      el("div", { class: "mr-note-head" }, el("strong", {}, n.author || "someone"), el("span", { class: "dim small" }, mrWhen(n.created))), mdNode(n.body || "")));
    const recommend = el("button", { type: "button", class: rec.action ? "" : "primary", id: "mr-recommend", disabled: working }, working ? "Working…" : rec.action ? "Look again" : "Recommend action");
    recommend.addEventListener("click", async () => {
      recommend.disabled = true;
      try { await api("/api/mr/recommend", { name: f.name, thread: t.id }); } catch (e) { alert(e.message || e); }
      view.reload(t.id);
    });
    const stop = working ? el("button", { type: "button", onclick: () => api("/api/mr/cancel", { name: f.name, thread: t.id }) }, "Stop") : "";
    const stale = rec.action && rec.seen != null && rec.seen < t.notes.length ? el("span", { class: "chip todo", title: "There are comments since the recommendation was made" }, "new replies since") : "";
    const recCard = rec.action ? el("div", { class: "mr-rec" },
      el("div", { class: "mr-rec-head" }, el("span", { class: "chip " + MR_ACTION[rec.action][1] }, MR_ACTION[rec.action][0]), el("strong", {}, rec.summary || ""), stale),
      rec.reasoning ? mdNode(rec.reasoning) : "",
      rec.change && rec.change.description ? el("div", { class: "mr-change" }, el("div", { class: "dim small" }, "The change"), mdNode(rec.change.description),
        rec.change.files && rec.change.files.length ? el("div", { class: "small" }, rec.change.files.map(p => el("code", {}, p)).flatMap((c, i) => i ? [" ", c] : [c])) : "") : "") : "";
    const failed = rec.error ? el("p", { class: "st missing mr-error" }, rec.error) : "";
    const tick = el("input", { type: "checkbox", id: "mr-tick", "aria-label": "Make this change" });
    tick.checked = !!st.selected;
    tick.addEventListener("change", async () => {
      tick.disabled = true;
      try { const r = await api("/api/mr/select", { name: f.name, thread: t.id, on: tick.checked }); if (r.waiting) view.said = "Looking into the comment first…"; }
      catch (e) { alert(e.message || e); tick.checked = !tick.checked; }
      view.reload(t.id);
    });
    const result = st.result && st.result.status ? el("span", { class: "chip " + (st.result.status === "applied" ? "done" : st.result.status === "blocked" ? "bad" : "todo"), title: st.result.text || "" }, st.result.status) : "";
    const reply = el("textarea", { class: "mr-draft", rows: 3, "aria-label": "Draft reply", spellcheck: "true", placeholder: "A reply to this comment, for you to post on the host" });
    reply.value = draft.text || "";
    let saving = 0;
    reply.addEventListener("input", () => { clearTimeout(saving); saving = setTimeout(() => api("/api/mr/draft", { name: f.name, thread: t.id, text: reply.value }).catch(() => {}), 500); });
    const copy = el("button", { type: "button", onclick: async () => { try { await navigator.clipboard.writeText(reply.value); copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy reply"; }, 1500); } catch { reply.select(); } } }, "Copy reply");
    const card = el("div", { class: "card mr-thread" + (t.resolved ? " resolved" : ""), "data-id": t.id },
      head, ...notes,
      el("div", { class: "mr-actions" }, recommend, stop, el("label", { class: "mr-tick" }, tick, " Make this change"), result,
        working && view.data.step && view.data.step[t.id] ? el("span", { class: "dim small" }, view.data.step[t.id]) : ""),
      failed, recCard,
      el("div", { class: "mr-reply" }, el("div", { class: "dim small" }, "Reply: a draft. Tatty never sends it", draft.commit ? el("span", { class: "chip done", title: "Committed" }, `committed as ${draft.commit}`) : ""), reply, el("div", { class: "start-actions" }, copy)));
    return card;
  };

  // ---- the three tabs
  const discussion = () => {
    const mr = view.data.mr;
    const real = mr.threads.filter(t => !t.resolved || view.all);
    const groups = new Map();
    for (const t of real) { const k = t.path || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    const keys = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    const open = mr.threads.filter(t => !t.resolved).length;
    const toggle = el("label", { class: "small" }, el("input", { type: "checkbox", id: "mr-all" }), ` Show the ${mr.threads.length - open} resolved`);
    toggle.querySelector("input").checked = view.all;
    toggle.querySelector("input").addEventListener("change", e => { view.all = e.target.checked; draw(); });
    return el("div", {}, el("div", { class: "mr-bar-top" }, el("strong", {}, `${open} open comment${open === 1 ? "" : "s"}`), mr.threads.length > open ? toggle : ""),
      keys.length ? keys.map(k => el("section", { class: "mr-group" }, el("h4", {}, k || "General comments"), groups.get(k).map(threadCard)))
        : el("p", { class: "dim pad" }, mr.threads.length ? "Every comment is resolved." : "No comments yet."));
  };

  const diffTab = () => {
    const mr = view.data.mr;
    const counts = {};
    for (const t of mr.threads) if (t.path) counts[t.path] = (counts[t.path] || 0) + 1;
    const pane = el("div", { class: "mr-diff-pane" }, el("p", { class: "dim small" }, mr.files.length ? "Choose a file." : "No changed files."));
    const list = el("div", { class: "mr-files" }, mr.files.map(file => {
      const b = el("button", { type: "button", class: "mr-file" + (view.file === file.path ? " open" : ""), "data-path": file.path, title: file.path },
        el("span", { class: "mr-fname" }, file.path.split("/").pop()), el("span", { class: "dim small mr-fdir" }, file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""),
        el("span", { class: "mr-fcount" }, el("span", { class: "add" }, "+" + file.add), el("span", { class: "del" }, "−" + file.del), counts[file.path] ? el("span", { class: "chip now" }, String(counts[file.path])) : ""));
      b.addEventListener("click", () => { view.file = file.path; for (const o of list.children) o.classList.toggle("open", o === b); showFile(file.path); });
      return b;
    }));
    const showFile = async path => {
      pane.replaceChildren(el("p", { class: "dim small" }, "Reading the diff…"));
      let d;
      try { d = await api("/api/mr/diff?name=" + enc(f.name) + "&path=" + enc(path)); } catch (e) { pane.replaceChildren(el("p", { class: "st missing" }, String(e.message || e))); return; }
      const here = mr.threads.filter(t => t.path === path);
      pane.replaceChildren(el("div", { class: "cd-head" }, el("code", { class: "mono" }, path)),
        d.binary ? el("p", { class: "dim" }, "A binary file: no text to show.") : d.hunks.length ? el("div", { class: "diff-scroll" }, diffTable(d.hunks)) : el("p", { class: "dim" }, "No lines changed."),
        d.cut ? el("p", { class: "diff-note" }, "Only the first part of this file's change is shown.") : "",
        here.length ? el("div", { class: "mr-onfile" }, el("h4", {}, `${here.length} comment${here.length === 1 ? "" : "s"} on this file`), here.map(t => el("div", { class: "mr-onfile-row" },
          el("span", { class: "chip route" }, t.line ? "line " + t.line : "file"), el("span", {}, (t.notes[0].body || "").split("\n")[0].slice(0, 140)),
          el("button", { type: "button", class: "linkish", onclick: () => { view.tab = "discussion"; draw(); const c = root.querySelector(`.mr-thread[data-id="${CSS.escape(t.id)}"]`); if (c) c.scrollIntoView({ block: "center" }); } }, "open")))) : "");
    };
    if (view.file && mr.files.some(x => x.path === view.file)) showFile(view.file);
    return el("div", { class: "mr-diff" }, list, pane);
  };

  const descriptionTab = () => {
    const mr = view.data.mr;
    return el("div", { class: "card" }, mr.description ? mdNode(mr.description) : el("p", { class: "dim" }, "No description."));
  };

  // ---- the page
  const changeBar = () => {
    const ticked = Object.entries(view.data.state || {}).filter(([, s]) => s.selected && !(s.result && s.result.status === "applied")).length;
    const go = el("button", { type: "button", class: "primary", id: "mr-change", disabled: !ticked || view.pending }, ticked ? `Make ${ticked} change${ticked === 1 ? "" : "s"}` : "Make changes");
    go.addEventListener("click", () => startChange());
    return el("div", { class: "mr-bar" }, go, el("span", { class: "dim small", id: "mr-said" }, view.said || (ticked ? "Starts a session that edits the code for the ticked comments. You commit it from the Commit page." : "Tick Make this change on the comments to act on.")));
  };

  const startChange = async () => {
    view.pending = true; view.said = ""; draw();
    try {
      tell("allow-foreground");
      const r = await api("/api/mr/change", { name: f.name });
      if (r.waiting) { view.said = `Looking into ${r.waiting.length} comment${r.waiting.length === 1 ? "" : "s"} first; the session starts when they are done.`; draw(); return; }
      view.pending = false;
      featureCache.delete(f.name);
      if (r.ok) {
        sessionInfo.set(r.tag, { tag: r.tag, feature: f.name, name: r.name, command: r.command, project: r.project, started: Date.now() / 1000, status: "starting" });
        location.hash = "#workflows/" + enc(r.tag);
        return;
      }
      view.said = "Couldn't open a terminal here. Run this yourself: " + (r.said || "");
    } catch (e) { view.pending = false; view.said = String(e.message || e); }
    draw();
  };

  function draw() {
    const d = view.data;
    if (!d) return;
    const mr = d.mr;
    if (!mr) {
      root.replaceChildren(el("h2", {}, "Merge request"), el("div", { class: "card" }, el("p", {}, d.why || "No merge request is recorded for this feature yet."),
        el("p", { class: "small" }, "Make one from the ", el("a", { href: featureHref(f.name) }, "Branch & merge"), " panel on the Overview, or press Refresh once you have.")),
        el("div", { class: "start-actions" }, el("button", { type: "button", id: "mr-refresh", onclick: () => view.reload("", true) }, "Refresh")));
      return;
    }
    const tabs = [["discussion", `Discussion · ${mr.threads.filter(t => !t.resolved).length}`], ["diff", `Diff · ${mr.files.length}`], ["description", "Description"]];
    const head = el("div", { class: "mr-head" },
      el("h2", {}, mr.title || "Merge request", el("span", { class: "dim mr-id" }, mr.id ? ` ${mr.provider === "github" ? "#" : "!"}${mr.id}` : "")),
      el("div", { class: "mr-meta" }, mr.state ? el("span", { class: "chip " + (MR_STATE_CHIP[mr.state] || "todo") }, mr.state) : "", mr.draft ? el("span", { class: "chip todo" }, "draft") : "",
        mr.pipeline && mr.pipeline.status ? el("span", { class: "chip " + (MR_PIPE_CHIP[mr.pipeline.status] || "todo") }, "checks " + mr.pipeline.status) : "",
        el("span", { class: "dim small" }, [mr.author, mr.source ? `${mr.source} → ${mr.target}` : ""].filter(Boolean).join(" · ")),
        el("span", { class: "mr-links" }, mr.url ? el("a", { class: "go-btn", id: "mr-go", href: mr.url, target: "_blank", rel: "noopener" }, "Go to MR") : "",
          el("button", { type: "button", id: "mr-refresh", onclick: () => view.reload("", true) }, "Refresh"))));
    const notes = [d.why ? el("p", { class: "st missing", id: "mr-why" }, d.why) : "",
      mr.local ? el("p", { class: "small dim" }, "Only the branch's own diff is shown: comments aren't read for this host here.") : "",
      d.onSource === false ? el("p", { class: "small st missing", id: "mr-branch" }, `The repository is on ${d.branch || "a detached HEAD"}, not the merge request's branch ${mr.source}: a recommendation reads the code as it is checked out.`) : ""];
    const body = view.tab === "diff" ? diffTab() : view.tab === "description" ? descriptionTab() : discussion();
    root.replaceChildren(head, ...notes, el("div", { class: "mr-tabs", role: "tablist" }, tabs.map(([k, label]) => el("button", { type: "button", role: "tab", "data-tab": k, class: view.tab === k ? "on" : "",
      onclick: () => { view.tab = k; draw(); } }, label))), body, view.tab === "discussion" && !mr.local ? changeBar() : "");
  }

  // The thread asked for is redrawn on its own when only it changed, and never while a reply is being typed.
  view.reload = async (thread, force) => {
    let d;
    try { d = await api("/api/mr?name=" + enc(f.name) + (force ? "&force=1" : "")); }
    catch (e) { if (!view.data) root.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e))); return; }
    if (view !== mrView || !main.isConnected) return;
    view.data = d;
    const typing = document.activeElement && document.activeElement.classList.contains("mr-draft") && root.contains(document.activeElement);
    if (view.pending && d.mr && !d.busy.length) { view.pending = false; startChange(); return; }
    if (typing) return;
    draw();
  };
  await view.reload("", false);
}
