// The Merge request page (#feature/<name>/merge-request; the server's "the merge request page").
// The feature's merge / pull request as its host has it: an overview (status, who is assigned and what the
// reviewers said, labels, the description), its comment threads and its diff. A comment can be looked into by
// an agent that reads the code (Recommend action): act, rebut or ask, with a reply drafted for the person to
// copy. Ticking "Make this change" on comments and pressing "Make N changes" starts a session that edits the
// code, and the Commit page commits it; the ticked comments' replies are then drafted with "Fixed in <sha>".
// Nothing here posts anything to the host.
//
// Things that need attention pulse and glow; what explains them is a hover card (mrPop). The motion follows the
// shop's Motion switch (TattyWallet.motion(), the `still` class), not the system's reduced-motion setting.

const featureMrHref = name => "#feature/" + encodeURIComponent(name) + "/merge-request";
let mrView = null; // the page being shown: {name, main, ...}; one at a time
let mrSoon = 0;
const MR_OVER_KEY = "tt-mr-overview";

document.addEventListener("tt-event", e => {
  const ev = e.detail;
  if (!mrView || !ev || ev.type !== "mr" || ev.name !== mrView.name || !mrView.main.isConnected) return;
  const view = mrView;
  clearTimeout(mrSoon);
  mrSoon = setTimeout(() => { if (view === mrView && view.main.isConnected) view.reload(ev.thread || ""); }, 250);
});

const MR_STATE_CHIP = { opened: "now", merged: "done", closed: "todo" };
const MR_ACTION = {
  act: { word: "Act on it", icon: "✎", tip: "The comment is right: a change is needed." },
  rebut: { word: "Rebut", icon: "↩", tip: "The code is right or the comment is mistaken: reply with the evidence." },
  ask: { word: "Ask", icon: "?", tip: "It can't be told without the reviewer or you: ask." } };
const MR_REVIEW = { approved: ["Approved", "ok", "✓"], changes: ["Changes requested", "bad", "!"], commented: ["Commented", "idle", "…"], pending: ["Waiting", "idle", "○"] };
const MR_STATUS_MARK = { added: ["A", "add"], deleted: ["D", "del"], renamed: ["R", "ren"], modified: ["M", "mod"] };
const mrWhen = s => (s && Date.parse(s) ? ago(Date.parse(s) / 1000) : "");
const mrMotion = () => !window.TattyWallet || TattyWallet.motion();
const mrOpen = t => !t.resolved && t.resolvable !== false;

// ---- small parts
function mrHue(name) { let h = 7; for (const c of String(name || "?")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

// A round badge with someone's initials, in a colour of their own.
function mrAvatar(name, size) {
  const parts = String(name || "?").split(/[\s._-]+/).filter(Boolean);
  const a = el("span", { class: "mr-av" + (size ? " " + size : ""), "aria-hidden": "true" }, ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase());
  a.style.setProperty("--h", String(mrHue(name)));
  return a;
}
const mrWho = (name, extra) => el("span", { class: "mr-who" }, mrAvatar(name), el("span", {}, name || "someone"), extra || "");

// Count a number up from zero (once, when it first shows), or just set it when the motion is off.
function mrCount(node, n) {
  node.textContent = String(n);
  if (!mrMotion() || n < 2) return;
  const t0 = performance.now(), ms = 650;
  const step = now => {
    if (!node.isConnected) return;
    const k = Math.min(1, (now - t0) / ms);
    node.textContent = String(Math.round(n * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---- hover cards: what explains a pill or a chip, beside it, closing when the pointer leaves
let mrPopEl = null, mrPopFor = null, mrPopOpen = 0, mrPopClose = 0;
function mrPopHide() {
  clearTimeout(mrPopOpen); clearTimeout(mrPopClose);
  if (mrPopEl) mrPopEl.remove();
  mrPopEl = mrPopFor = null;
}
document.addEventListener("keydown", e => { if (e.key === "Escape") mrPopHide(); });
window.addEventListener("scroll", () => mrPopHide(), true);

// build() returns the card's content (nodes), or nothing to show no card.
function mrPop(node, build) {
  const show = () => {
    const body = build();
    if (!body || !node.isConnected) return;
    mrPopHide();
    mrPopFor = node;
    const card = el("div", { class: "peek card mr-pop", role: "tooltip" }, body);
    card.addEventListener("pointerenter", () => clearTimeout(mrPopClose));
    card.addEventListener("pointerleave", () => { mrPopClose = setTimeout(mrPopHide, 150); });
    document.body.append(card);
    mrPopEl = card;
    if (typeof place === "function") place(card, node); // ids.js: beside it, never off the page
  };
  node.classList.add("mr-hasPop");
  node.addEventListener("pointerenter", () => { clearTimeout(mrPopClose); if (mrPopFor === node) return; clearTimeout(mrPopOpen); mrPopOpen = setTimeout(show, 200); });
  node.addEventListener("pointerleave", () => { clearTimeout(mrPopOpen); mrPopClose = setTimeout(mrPopHide, 150); });
  node.addEventListener("focus", () => { clearTimeout(mrPopOpen); mrPopOpen = setTimeout(show, 0); });
  node.addEventListener("blur", () => mrPopHide());
  return node;
}
const mrTip = (node, text) => mrPop(node, () => el("div", { class: "mr-tip" }, text));

async function mrPage(f, main) {
  const enc = encodeURIComponent;
  const view = mrView = { name: f.name, main, data: null, tab: "overview", all: false, file: "", pending: false, said: "", prevOpen: null, ticked: 0,
    counted: false, over: localStorage.getItem(MR_OVER_KEY) !== "closed", more: false, cheer: false };
  const root = el("div", { class: "mr-page" });
  const skeleton = () => el("div", { class: "mr-skel-wrap" }, [0, 1, 2].map(i => el("div", { class: "card mr-skel" }, el("span", {}), el("span", {}), el("span", {}))));
  main.replaceChildren(root);
  root.replaceChildren(skeleton());

  const busyNow = () => new Set(view.data ? view.data.busy : []);

  // ---- the status pills: what needs attention is bright and pulses; what is fine is calm
  const signal = (cls, icon, label, state, build) => {
    const b = el("button", { type: "button", class: "mr-sig " + cls + " " + state }, el("span", { class: "mr-sig-ic", "aria-hidden": "true" }, icon), el("span", { class: "mr-sig-label" }, label));
    return build ? mrPop(b, build) : b;
  };
  const signals = mr => {
    const out = [];
    const open = mr.threads.filter(mrOpen);
    const num = el("b", {}, "");
    const comments = signal("comments", "✎", "", open.length ? "warn" : "ok", () => open.length ? el("div", {}, el("strong", {}, `${open.length} comment${open.length === 1 ? "" : "s"} waiting`),
      el("ul", { class: "mr-poplist" }, open.slice(0, 6).map(t => el("li", {}, el("code", {}, t.path ? `${t.path.split("/").pop()}${t.line ? ":" + t.line : ""}` : "general"), " ", (t.notes[0].body || "").split("\n")[0].slice(0, 80))),
        open.length > 6 ? el("li", { class: "dim" }, `and ${open.length - 6} more`) : "")) : el("div", {}, "Every comment is resolved."));
    comments.querySelector(".mr-sig-label").replaceChildren(num, ` open comment${open.length === 1 ? "" : "s"}`);
    if (!view.counted) mrCount(num, open.length); else num.textContent = String(open.length);
    out.push(comments);
    const checks = mr.checks || [];
    const pipe = (mr.pipeline || {}).status;
    if (checks.length || pipe) {
      const failed = checks.filter(c => c.status === "failed"), running = checks.filter(c => c.status === "running");
      const state = pipe === "failed" || failed.length ? "bad" : pipe === "running" || running.length ? "run" : "ok";
      const label = failed.length ? `${failed.length} of ${checks.length} checks failed` : state === "bad" ? "Checks failed" : state === "run" ? (running.length ? `${running.length} check${running.length === 1 ? "" : "s"} running` : "Checks running") : "Checks passed";
      out.push(signal("checks", state === "ok" ? "✓" : state === "bad" ? "✕" : "◔", label, state, () => checks.length ? el("div", {}, el("strong", {}, label),
        el("ul", { class: "mr-poplist mr-jobs" }, checks.slice(0, 14).map(c => el("li", { class: "job " + c.status }, el("span", { class: "dot" }), c.url ? el("a", { href: c.url, target: "_blank", rel: "noopener" }, c.name) : el("span", {}, c.name),
          el("span", { class: "dim small" }, c.note ? ` ${c.note}` : ""))), checks.length > 14 ? el("li", { class: "dim" }, `and ${checks.length - 14} more`) : "")) :
        el("div", {}, label, mr.pipeline && mr.pipeline.url ? [" ", el("a", { href: mr.pipeline.url, target: "_blank", rel: "noopener" }, "open the pipeline")] : "")));
    }
    const mg = mr.mergeable || {};
    if (mg.status) {
      const word = { ok: "Ready to merge", conflicts: "Merge conflicts", blocked: "Can't merge yet", checking: "Checking" }[mg.status] || "Unknown";
      out.push(signal("merge", mg.status === "ok" ? "⇢" : mg.status === "conflicts" ? "⚠" : "⏸", word, mg.status === "ok" ? "ok" : mg.status === "conflicts" ? "bad" : mg.status === "blocked" ? "warn" : "idle",
        () => el("div", {}, el("strong", {}, word), (mg.reasons || []).length ? el("ul", { class: "mr-poplist" }, mg.reasons.map(r => el("li", {}, r))) : el("p", { class: "dim small" }, mg.status === "ok" ? "Nothing stands in its way." : "The host hasn't said why."))));
    }
    const ap = mr.approvals || { have: 0, need: 0 };
    const approvers = (mr.reviewers || []).filter(r => r.state === "approved");
    if (ap.need || approvers.length) {
      const done = ap.need ? ap.have >= ap.need : approvers.length > 0;
      out.push(signal("approvals", done ? "✓" : "◐", ap.need ? `${ap.have} of ${ap.need} approvals` : `${approvers.length} approved`, done ? "ok" : "warn",
        () => el("div", {}, el("strong", {}, ap.need ? `${ap.have} of ${ap.need} approvals` : "Approved by"), approvers.length ? el("ul", { class: "mr-poplist" }, approvers.map(r => el("li", {}, mrWho(r.name)))) : el("p", { class: "dim small" }, "Nobody has approved yet."))));
    }
    const rv = mr.reviewers || [];
    if (rv.length) {
      const changes = rv.filter(r => r.state === "changes"), waiting = rv.filter(r => r.state === "pending");
      const state = changes.length ? "bad" : waiting.length ? "idle" : "ok";
      const label = changes.length ? `${changes.length} asked for changes` : waiting.length ? `${waiting.length} reviewer${waiting.length === 1 ? "" : "s"} waiting` : "Reviewed";
      out.push(signal("reviewers", changes.length ? "!" : waiting.length ? "○" : "✓", label, state, () => reviewerList(rv)));
    }
    return out;
  };

  const reviewerList = rv => el("div", {}, el("strong", {}, "Reviewers"), el("ul", { class: "mr-poplist" }, rv.map(r => {
    const [word, cls, icon] = MR_REVIEW[r.state] || MR_REVIEW.pending;
    return el("li", {}, mrWho(r.name), el("span", { class: "mr-rv " + cls }, el("i", {}, icon), " " + word + (r.at ? " · " + mrWhen(r.at) : "")));
  })));

  const reviewerChips = rv => rv.length ? rv.map(r => {
    const [word, cls, icon] = MR_REVIEW[r.state] || MR_REVIEW.pending;
    const chip = el("span", { class: "mr-person " + cls }, mrAvatar(r.name), el("span", { class: "mr-pn" }, r.name), el("span", { class: "mr-badge", "aria-label": word }, icon));
    return mrPop(chip, () => el("div", {}, mrWho(r.name), el("div", { class: "mr-rv " + cls }, el("i", {}, icon), " " + word + (r.at ? " · " + mrWhen(r.at) : ""))));
  }) : [el("span", { class: "dim small" }, "none asked")];

  // ---- the overview: a panel above every tab (folds away), and the tab with the rest
  const peopleBlock = mr => el("div", { class: "mr-people" },
    el("div", { class: "mr-prow" }, el("span", { class: "mr-plabel" }, "Author"), mrWho(mr.author)),
    el("div", { class: "mr-prow" }, el("span", { class: "mr-plabel" }, "Assigned"), (mr.assignees || []).length ? el("span", { class: "mr-chips" }, mr.assignees.map(n => mrWho(n))) : el("span", { class: "dim small" }, "nobody")),
    el("div", { class: "mr-prow" }, el("span", { class: "mr-plabel" }, "Reviewers"), el("span", { class: "mr-chips" }, reviewerChips(mr.reviewers || []))),
    (mr.labels || []).length ? el("div", { class: "mr-prow" }, el("span", { class: "mr-plabel" }, "Labels"), el("span", { class: "mr-chips" }, mr.labels.map(l => {
      const c = el("span", { class: "mr-label" }, l); c.style.setProperty("--h", String(mrHue(l))); return c; }))) : "",
    mr.milestone ? el("div", { class: "mr-prow" }, el("span", { class: "mr-plabel" }, "Milestone"), el("span", {}, "◎ " + mr.milestone)) : "");

  const overviewPanel = mr => {
    const rv = mr.reviewers || [];
    const brief = [`${rv.length} reviewer${rv.length === 1 ? "" : "s"}`, (mr.assignees || []).length ? `${mr.assignees.length} assigned` : "", (mr.labels || []).length ? `${mr.labels.length} label${mr.labels.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
    const head = el("button", { type: "button", class: "mr-over-head", id: "mr-over-toggle", "aria-expanded": String(view.over) },
      el("span", { class: "mr-chev", "aria-hidden": "true" }, "▸"), el("strong", {}, "Overview"), el("span", { class: "dim small" }, view.over ? "" : brief));
    head.addEventListener("click", () => { view.over = !view.over; localStorage.setItem(MR_OVER_KEY, view.over ? "open" : "closed"); draw(); });
    const desc = el("div", { class: "mr-desc" + (view.more ? " more" : "") }, mr.description ? mdNode(mr.description) : el("p", { class: "dim" }, "No description."));
    const body = view.over ? el("div", { class: "mr-over-body" }, el("div", { class: "mr-over-desc" }, desc,
      mr.description && mr.description.length > 280 ? el("button", { type: "button", class: "linkish", id: "mr-more", onclick: () => { view.more = !view.more; draw(); } }, view.more ? "Show less" : "Read more") : ""),
      peopleBlock(mr)) : "";
    return el("section", { class: "mr-over card" + (view.over ? " open" : ""), id: "mr-over" }, head, body);
  };

  const folders = mr => {
    const by = new Map();
    for (const file of mr.files) { const k = file.path.includes("/") ? file.path.slice(0, file.path.indexOf("/")) : "(top)"; const v = by.get(k) || { add: 0, del: 0, n: 0 }; v.add += file.add; v.del += file.del; v.n++; by.set(k, v); }
    const rows = [...by.entries()].sort((a, b) => (b[1].add + b[1].del) - (a[1].add + a[1].del)).slice(0, 12);
    const top = Math.max(1, ...rows.map(r => r[1].add + r[1].del));
    return el("div", { class: "mr-folders" }, rows.map(([k, v]) => {
      const bar = el("span", { class: "mr-bar-fill" }); bar.style.setProperty("--w", String(Math.max(3, Math.round(100 * (v.add + v.del) / top))));
      const split = el("i", { class: "mr-split" }); split.style.setProperty("--add", String(v.add + v.del ? Math.round(100 * v.add / (v.add + v.del)) : 0));
      bar.append(split);
      return el("div", { class: "mr-folder" }, el("code", {}, k), bar, el("span", { class: "dim small" }, `${v.n} file${v.n === 1 ? "" : "s"} · +${v.add} −${v.del}`));
    }));
  };

  const overviewTab = mr => {
    const talk = new Map();
    for (const t of mr.threads) for (const n of t.notes) talk.set(n.author || "someone", (talk.get(n.author || "someone") || 0) + 1);
    return el("div", { class: "mr-grid" },
      el("div", { class: "card mr-fulldesc" }, el("h4", {}, "Description"), mr.description ? mdNode(mr.description) : el("p", { class: "dim" }, "No description.")),
      el("div", { class: "mr-side" },
        el("div", { class: "card" }, el("h4", {}, "Details"), el("dl", { class: "mr-dl" },
          el("dt", {}, "Branch"), el("dd", {}, el("code", {}, mr.source || "?"), " → ", el("code", {}, mr.target || "?")),
          el("dt", {}, "Created"), el("dd", {}, mrWhen(mr.created) || "—"), el("dt", {}, "Updated"), el("dd", {}, mrWhen(mr.updated) || "—"),
          el("dt", {}, "Changes"), el("dd", {}, `${mr.stats ? mr.stats.files : mr.files.length} files · +${mr.stats ? mr.stats.add : 0} −${mr.stats ? mr.stats.del : 0}` + (mr.commits ? ` · ${mr.commits} commit${mr.commits === 1 ? "" : "s"}` : "")),
          mr.sha ? [el("dt", {}, "Head"), el("dd", {}, el("code", {}, mr.sha.slice(0, 10)))] : "")),
        talk.size ? el("div", { class: "card" }, el("h4", {}, "In the conversation"), el("div", { class: "mr-chips" }, [...talk.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => mrWho(n, el("span", { class: "chip route" }, String(c)))))) : "",
        mr.files.length ? el("div", { class: "card" }, el("h4", {}, "Where the change is"), folders(mr)) : ""));
  };

  // ---- one comment thread
  const threadCard = (t, i) => {
    const st = (view.data.state || {})[t.id] || {};
    const rec = st.recommendation || {};
    const draft = st.draft || { text: "", edited: false, commit: "" };
    const working = busyNow().has(t.id);
    const stale = rec.action && rec.seen != null && rec.seen < t.notes.length;
    const where = t.path ? `${t.path}${t.line ? ":" + t.line : ""}` : "";
    const head = el("div", { class: "mr-thread-head" },
      t.notes[0] ? mrAvatar(t.notes[0].author) : "",
      where ? mrPop(el("button", { type: "button", class: "mr-where", onclick: () => { view.tab = "diff"; view.file = t.path; draw(); } }, where),
        () => el("div", {}, el("code", {}, t.path), el("p", { class: "small dim" }, `Line ${t.line || "?"}. Click to see the file's diff.` + (t.outdated ? " The code has changed since this comment was made." : "")))) : el("span", { class: "chip route" }, "general"),
      t.resolved ? el("span", { class: "chip done" }, "resolved") : "",
      t.outdated ? mrTip(el("span", { class: "chip todo" }, "outdated"), "The code under this comment has changed since it was made, so the line may have moved.") : "",
      el("span", { class: "dim small" }, `${t.notes.length} comment${t.notes.length === 1 ? "" : "s"}`),
      t.url ? el("a", { class: "small mr-host", href: t.url, target: "_blank", rel: "noopener" }, "on the host ↗") : "");
    const notes = t.notes.map(n => el("div", { class: "mr-note" },
      el("div", { class: "mr-note-head" }, mrAvatar(n.author, "sm"), el("strong", { class: "mr-author" }, n.author || "someone"), el("span", { class: "dim small" }, mrWhen(n.created))), mdNode(n.body || "")));
    const recommend = el("button", { type: "button", class: rec.action ? "" : "primary", id: "mr-recommend", disabled: working }, working ? "Working…" : rec.action ? "Look again" : "Recommend action");
    recommend.addEventListener("click", async () => {
      recommend.disabled = true;
      try { await api("/api/mr/recommend", { name: f.name, thread: t.id }); } catch (e) { alert(e.message || e); }
      view.reload(t.id);
    });
    const stop = working ? el("button", { type: "button", onclick: () => api("/api/mr/cancel", { name: f.name, thread: t.id }) }, "Stop") : "";
    const staleChip = stale ? mrTip(el("span", { class: "chip todo" }, "new replies since"), "There are comments on this thread since the recommendation was made: look again.") : "";
    const meta = rec.action ? MR_ACTION[rec.action] : null;
    const recCard = meta ? el("div", { class: "mr-rec " + rec.action },
      el("div", { class: "mr-rec-head" }, mrTip(el("span", { class: "mr-action " + rec.action }, el("i", {}, meta.icon), " " + meta.word), meta.tip), el("strong", {}, rec.summary || ""), staleChip),
      rec.reasoning ? mdNode(rec.reasoning) : "",
      rec.change && rec.change.description ? el("div", { class: "mr-change" }, el("div", { class: "dim small" }, "The change"), mdNode(rec.change.description),
        rec.change.files && rec.change.files.length ? el("div", { class: "small" }, rec.change.files.map(p => el("code", {}, p)).flatMap((c, k) => k ? [" ", c] : [c])) : "") : "") : "";
    const failed = rec.error ? el("p", { class: "st missing mr-error" }, rec.error) : "";
    const tick = el("input", { type: "checkbox", id: "mr-tick", "aria-label": "Make this change" });
    tick.checked = !!st.selected;
    tick.addEventListener("change", async () => {
      tick.disabled = true;
      try { const r = await api("/api/mr/select", { name: f.name, thread: t.id, on: tick.checked }); if (r.waiting) view.said = "Looking into the comment first…"; }
      catch (e) { alert(e.message || e); tick.checked = !tick.checked; }
      view.reload(t.id);
    });
    const result = st.result && st.result.status ? mrTip(el("span", { class: "chip " + (st.result.status === "applied" ? "done" : st.result.status === "blocked" ? "bad" : "todo") }, st.result.status), st.result.text || st.result.status) : "";
    const reply = el("textarea", { class: "mr-draft", rows: 3, "aria-label": "Draft reply", spellcheck: "true", placeholder: "A reply to this comment, for you to post on the host" });
    reply.value = draft.text || "";
    let saving = 0;
    reply.addEventListener("input", () => { clearTimeout(saving); saving = setTimeout(() => api("/api/mr/draft", { name: f.name, thread: t.id, text: reply.value }).catch(() => {}), 500); });
    const copy = el("button", { type: "button", onclick: async () => { try { await navigator.clipboard.writeText(reply.value); copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy reply"; }, 1500); } catch { reply.select(); } } }, "Copy reply");
    const cls = ["card", "mr-thread", t.resolved ? "resolved" : "", t.outdated ? "outdated" : "", working ? "working" : "", st.selected ? "chosen" : "",
      !t.resolved && t.resolvable !== false && (!rec.action || stale) ? "needs" : "", rec.action === "act" && !st.selected && !t.resolved ? "ready" : ""].filter(Boolean).join(" ");
    const card = el("div", { class: cls, "data-id": t.id }, head, ...notes,
      el("div", { class: "mr-actions" }, recommend, stop, el("label", { class: "mr-switch" }, tick, el("span", { class: "mr-knob", "aria-hidden": "true" }), el("span", {}, "Make this change")), result,
        working && view.data.step && view.data.step[t.id] ? el("span", { class: "dim small mr-step" }, view.data.step[t.id]) : ""),
      failed, recCard,
      el("div", { class: "mr-reply" }, el("div", { class: "dim small" }, "Reply: a draft. Tatty never sends it", draft.commit ? mrTip(el("span", { class: "chip done" }, `committed as ${draft.commit}`), "The change was committed here: the draft says so.") : ""), reply, el("div", { class: "start-actions" }, copy)));
    card.style.setProperty("--i", String(Math.min(i, 12)));
    return card;
  };

  // ---- the tabs
  const discussion = () => {
    const mr = view.data.mr;
    const real = mr.threads.filter(t => !t.resolved || view.all);
    const groups = new Map();
    for (const t of real) { const k = t.path || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    const keys = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    const open = mr.threads.filter(mrOpen).length, resolved = mr.threads.filter(t => t.resolved).length;
    const toggle = el("label", { class: "small" }, el("input", { type: "checkbox", id: "mr-all" }), ` Show the ${resolved} resolved`);
    toggle.querySelector("input").checked = view.all;
    toggle.querySelector("input").addEventListener("change", e => { view.all = e.target.checked; draw(); });
    let n = 0;
    return el("div", {}, view.cheer ? el("div", { class: "mr-cheer", id: "mr-cheer" }, el("span", {}, "✓"), " Every comment is resolved. Nicely done.") : "",
      el("div", { class: "mr-bar-top" }, el("strong", {}, `${open} open comment${open === 1 ? "" : "s"}`), resolved ? toggle : ""),
      keys.length ? keys.map(k => el("section", { class: "mr-group" }, el("h4", {}, k || "General comments"), groups.get(k).map(t => threadCard(t, n++))))
        : el("p", { class: "dim pad" }, mr.threads.length ? "Every comment is resolved." : "No comments yet."));
  };

  const diffTab = () => {
    const mr = view.data.mr;
    const counts = {};
    for (const t of mr.threads) if (t.path) counts[t.path] = (counts[t.path] || 0) + 1;
    const pane = el("div", { class: "mr-diff-pane" }, el("p", { class: "dim small" }, mr.files.length ? "Choose a file." : "No changed files."));
    const list = el("div", { class: "mr-files" }, mr.files.map(file => {
      const [mark, kind] = MR_STATUS_MARK[file.status] || MR_STATUS_MARK.modified;
      const fill = el("i", { class: "mr-split" }); fill.style.setProperty("--add", String(file.add + file.del ? Math.round(100 * file.add / (file.add + file.del)) : 0));
      const b = el("button", { type: "button", class: "mr-file" + (view.file === file.path ? " open" : ""), "data-path": file.path },
        el("span", { class: "mr-mark " + kind }, mark), el("span", { class: "mr-fname" }, file.path.split("/").pop()), el("span", { class: "dim small mr-fdir" }, file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""),
        el("span", { class: "mr-fcount" }, el("span", { class: "add" }, "+" + file.add), el("span", { class: "del" }, "−" + file.del), el("span", { class: "mr-minibar" }, fill),
          counts[file.path] ? el("span", { class: "chip now" }, String(counts[file.path])) : ""));
      mrPop(b, () => el("div", {}, el("code", {}, file.path), el("p", { class: "small dim" }, `${file.status || "modified"} · +${file.add} −${file.del}` + (counts[file.path] ? ` · ${counts[file.path]} comment${counts[file.path] === 1 ? "" : "s"}` : ""))));
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

  // ---- the page
  const changeBar = () => {
    const ticked = Object.entries(view.data.state || {}).filter(([, s]) => s.selected && !(s.result && s.result.status === "applied")).length;
    const go = el("button", { type: "button", class: "primary", id: "mr-change", disabled: !ticked || view.pending }, ticked ? `Make ${ticked} change${ticked === 1 ? "" : "s"}` : "Make changes");
    go.addEventListener("click", () => startChange());
    const bar = el("div", { class: "mr-bar" + (ticked ? " lit" : "") }, go, el("span", { class: "dim small", id: "mr-said" }, view.said || (ticked ? "Starts a session that edits the code for the ticked comments. You commit it from the Commit page." : "Tick Make this change on the comments to act on.")));
    if (ticked !== view.ticked) { view.ticked = ticked; if (ticked) bar.classList.add("bump"); }
    return bar;
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
    mrPopHide();
    root.classList.toggle("still", !mrMotion());
    const mr = d.mr;
    if (!mr) {
      root.replaceChildren(el("h2", {}, "Merge request"), el("div", { class: "card" }, el("p", {}, d.why || "No merge request is recorded for this feature yet."),
        el("p", { class: "small" }, "Make one from the ", el("a", { href: featureHref(f.name) }, "Branch & merge"), " panel on the Overview, or press Refresh once you have.")),
        el("div", { class: "start-actions" }, el("button", { type: "button", id: "mr-refresh", onclick: () => view.reload("", true) }, "Refresh")));
      return;
    }
    const st = mr.stats || { add: 0, del: 0, files: mr.files.length };
    const hero = el("div", { class: "mr-hero " + (mr.state || "") },
      el("div", { class: "mr-hero-top" },
        el("h2", {}, mr.title || "Merge request", el("span", { class: "dim mr-id" }, mr.id ? ` ${mr.provider === "github" ? "#" : "!"}${mr.id}` : "")),
        el("span", { class: "mr-links" }, mr.url ? el("a", { class: "go-btn", id: "mr-go", href: mr.url, target: "_blank", rel: "noopener" }, "Go to MR") : "",
          el("button", { type: "button", id: "mr-refresh", onclick: () => view.reload("", true) }, "Refresh"))),
      el("div", { class: "mr-meta" }, mr.state ? el("span", { class: "chip " + (MR_STATE_CHIP[mr.state] || "todo") }, mr.state) : "", mr.draft ? el("span", { class: "chip todo" }, "draft") : "",
        mr.author ? mrWho(mr.author) : "", mr.source ? el("span", { class: "mr-branches" }, el("code", {}, mr.source), " → ", el("code", {}, mr.target)) : "",
        el("span", { class: "dim small mr-stats" }, `${st.files} file${st.files === 1 ? "" : "s"} `, el("span", { class: "add" }, "+" + st.add), " ", el("span", { class: "del" }, "−" + st.del), mr.commits ? ` · ${mr.commits} commit${mr.commits === 1 ? "" : "s"}` : "",
          mr.updated ? ` · updated ${mrWhen(mr.updated)}` : "")),
      el("div", { class: "mr-signals", id: "mr-signals" }, signals(mr)));
    const notes = [d.why ? el("p", { class: "st missing", id: "mr-why" }, d.why) : "",
      mr.local ? el("p", { class: "small dim" }, "Only the branch's own diff is shown: comments aren't read for this host here.") : "",
      d.onSource === false ? el("p", { class: "small st missing", id: "mr-branch" }, `The repository is on ${d.branch || "a detached HEAD"}, not the merge request's branch ${mr.source}: a recommendation reads the code as it is checked out.`) : ""];
    const openN = mr.threads.filter(mrOpen).length;
    const tabs = [["overview", "Overview"], ["discussion", `Discussion · ${openN}`], ["diff", `Diff · ${mr.files.length}`]];
    const body = view.tab === "diff" ? diffTab() : view.tab === "discussion" ? discussion() : overviewTab(mr);
    root.replaceChildren(hero, ...notes, overviewPanel(mr), el("div", { class: "mr-tabs", role: "tablist" }, tabs.map(([k, label]) => el("button", { type: "button", role: "tab", "data-tab": k,
      class: view.tab === k ? "on" : "", "aria-selected": String(view.tab === k), onclick: () => { view.tab = k; draw(); } }, label,
      k === "discussion" && openN ? el("span", { class: "mr-dot", "aria-hidden": "true" }) : ""))), el("div", { class: "mr-body" }, body), view.tab === "discussion" && !mr.local ? changeBar() : "");
    view.counted = true;
  }

  // The thread asked for is redrawn on its own when only it changed, and never while a reply is being typed.
  view.reload = async (thread, force) => {
    let d;
    try { d = await api("/api/mr?name=" + enc(f.name) + (force ? "&force=1" : "")); }
    catch (e) { if (!view.data) root.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e))); return; }
    if (view !== mrView || !main.isConnected) return;
    view.data = d;
    const openNow = d.mr ? d.mr.threads.filter(mrOpen).length : null;
    const celebrate = view.prevOpen != null && view.prevOpen > 0 && openNow === 0 && d.mr && d.mr.threads.length > 0;
    view.prevOpen = openNow;
    const typing = document.activeElement && document.activeElement.classList.contains("mr-draft") && root.contains(document.activeElement);
    if (view.pending && d.mr && !d.busy.length) { view.pending = false; startChange(); return; }
    if (typing) return;
    if (celebrate) view.cheer = true;
    draw();
    if (celebrate && mrMotion() && window.TattyWallet && TattyWallet.burst) {
      const pill = root.querySelector(".mr-sig.comments");
      if (pill) { const r = pill.getBoundingClientRect(); TattyWallet.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, 22, { reach: 100 }); }
    }
  };
  await view.reload("", false);
}
