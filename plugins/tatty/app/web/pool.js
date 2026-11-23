// The Worktrees page (#worktrees, engineering mode; the server's "the worktrees page").
// The current project's worktree pool: how much disk it takes and what one more would, each slot with the
// feature and branch that hold it, and the buttons to create the pool, add a slot, free a slot a feature no
// longer needs, and delete a free one. Only the current project's repository is shown.

let poolView = null; // the page on show: {box, timer}; one at a time

const poolBytes = n => {
  if (n === null || n === undefined) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
};

// The Worktrees nav item says how many jobs are going on the pool (or waiting), on any page: the server tells it when one starts or ends.
function poolBadge(ev) {
  const a = document.querySelector(".pnav a[data-page=worktrees]");
  if (!a) return;
  let b = a.querySelector(".pool-badge");
  const n = (ev.running || 0) + (ev.queued || 0);
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = el("span", { class: "pool-badge" }); a.append(" ", b); }
  b.textContent = String(n);
  b.title = `${ev.running || 0} running, ${ev.queued || 0} waiting on the worktree pool`;
}

async function renderWorktrees(box) {
  const view = poolView = { box, timer: 0, data: null, note: "", noteBad: false, pending: [] };
  const live = () => poolView === view && box.isConnected;
  const root = el("div", { class: "pool-page" });
  box.replaceChildren(root);

  // What a button did, said under the header; the page is read again either way.
  const say = (text, bad) => { view.note = text; view.noteBad = !!bad; };
  // What the page says the moment a button is pressed, before the server has answered (it may be slow to start, and the
  // server's own "busy" only shows once the page reads it again): the banner, and every button off.
  const PENDING = {
    "/api/pool/add": "Adding a slot: it copies the project's cache, so this takes a while.",
    "/api/pool/create": "Making the pool: each slot is a checkout and a copy of the project's cache, so this takes a while.",
    "/api/pool/release": "Freeing the slot.", "/api/pool/remove": "Deleting the slot: it is a whole checkout, so this takes a while.",
    "/api/pool/refresh": "Bringing the free slots up to date.", "/api/pool/config": "Saving the pool's settings.",
    "/api/pool/measure": "Measuring: this reads every file, so a big project takes minutes.",
    "/api/pool/validate": "Checking the slots: this reads every slot's files, so a big project takes a minute or two.",
    "/api/pool/repair": "Mending the slot: a rebuild or a cache copy takes a while.",
    "/api/pool/unity": "Starting Unity: the Editor window takes a moment to appear.",
  };
  // A press asks the server for a job and is done: the job runs there, whatever page is open, and the list below shows it
  // (again) whenever the page is. A press that needs a slot a job is using is told who has it and may queue.
  const queueText = (names, by) => `${names.join(", ")} ${names.length === 1 ? "is" : "are"} busy (${[...new Set(by)].join(", ")}). Queue this to run when ${names.length === 1 ? "it is" : "they are"} free?`;
  const act = async (path, body, done) => {
    const mark = { text: PENDING[path] || "Working…" };
    view.pending.push(mark);
    if (view.data) draw(); // at once: not after the request
    try {
      const r = await api(path, body);
      if (r.blocked && r.blocked.length && confirm(queueText(r.blocked.map(b => b.slot), r.blocked.map(b => b.by)))) {
        await api(path, { ...body, slots: r.blocked.map(b => b.slot), queue: true });
      } else if (done && !r.job && !r.started) say(done(r));
    } catch (e) {
      if (e.status === 409 && e.data && e.data.conflict && e.data.canQueue) {
        const who = e.data.blockedBy || [];
        if (confirm(queueText([...new Set(who.flatMap(j => j.slots))], who.map(j => j.label)))) {
          try { await api(path, { ...body, queue: true }); } catch (e2) { say(String(e2.message || e2), true); }
        }
      } else say(String(e.message || e), true);
    }
    view.pending.splice(view.pending.indexOf(mark), 1);
    await load();
  };
  const jobAct = async (path, body) => { try { await api(path, body); } catch (e) { say(String(e.message || e), true); } await load(); };

  const load = async () => {
    clearTimeout(view.timer);
    if (!live()) return;
    try { view.data = await api("/api/pool"); }
    catch (e) { root.replaceChildren(el("p", { class: "pad st missing" }, "The worktrees didn't load: " + String(e.message || e))); return; }
    if (!live()) return;
    draw();
    const d = view.data;
    poolBadge({ running: (d.jobs || []).filter(j => j.state === "running").length, queued: (d.jobs || []).filter(j => j.state === "queued").length });
    if ((d.jobs || []).some(j => j.state !== "done") || d.measuring) view.timer = setTimeout(load, 2000); // something slow is running: look again soon
  };

  const draw = () => {
    const d = view.data;
    const jobs = d.jobs || [];
    const busy = jobs.some(j => j.state !== "done" && j.slots.includes("*")); // making the pool: nothing else until it is made
    const head = el("div", { class: "pool-head" }, el("h2", {}, "Worktrees"),
      d.repo ? el("span", { class: "dim small pool-repo" }, d.repo) : "");
    const kids = [head];
    if (!d.repo) { kids.push(el("p", { class: "dim" }, d.note || "")); root.replaceChildren(...kids); return; }
    kids.push(el("p", { class: "dim" },
      "A worktree is a whole second checkout of this project, so features and bug fixes can run side by side. The pool keeps some made and " +
      "up to date: a feature takes a free one instead of waiting for a new checkout, and gives it back when it's done."));
    if (view.note) kids.push(el("p", { class: view.noteBad ? "st missing" : "st ok" }, view.note));

    if (view.pending.length || jobs.length) kids.push(jobsCard(jobs));
    if (d.warning) kids.push(el("p", { class: "st missing" }, d.warning));
    kids.push(diskCard(d, busy));
    kids.push(d.exists ? poolCard(d, busy) : createCard(d, busy));
    root.replaceChildren(...kids);
  };

  // ---- what is running, waiting and done: kept by the server, so it is all still here after leaving the page and coming back
  const jobsCard = jobs => {
    const byId = Object.fromEntries(jobs.map(j => [j.id, j]));
    const what = j => `${j.label} ${j.slots.includes("*") ? "the pool" : j.slots.join(", ")}`;
    const rows = [];
    for (const p of view.pending) rows.push(el("div", { class: "pool-busy" }, spinnerMark("sp-mark"), p.text));
    for (const j of jobs.filter(x => x.state === "running")) {
      rows.push(el("div", { class: "pool-busy" }, spinnerMark("sp-mark"), what(j), el("span", { class: "dim small" }, j.started ? " started " + ago(j.started) : "")));
    }
    for (const j of jobs.filter(x => x.state === "queued")) {
      const behind = (j.waitingFor || []).map(id => byId[id]).filter(Boolean).map(what).join(", ");
      const cancel = el("button", { class: "small" }, "Take off");
      cancel.addEventListener("click", () => jobAct("/api/pool/cancel", { job: j.id }));
      rows.push(el("div", { class: "pool-queued" }, el("span", { class: "chip todo" }, "waiting"), what(j), behind ? el("span", { class: "dim small" }, " until " + behind + " is done") : "", " ", cancel));
    }
    const done = jobs.filter(x => x.state === "done");
    for (const j of done.slice().reverse()) {
      const x = el("button", { class: "small", "aria-label": "dismiss", title: "Dismiss" }, "×");
      x.addEventListener("click", () => jobAct("/api/pool/dismiss", { job: j.id }));
      rows.push(el("div", { class: "pool-done " + (j.bad ? "st missing" : "st ok") }, j.note || what(j), el("span", { class: "dim small" }, j.finished ? "  " + ago(j.finished) : ""), " ", x));
    }
    if (done.length > 1) {
      const clear = el("button", { class: "small" }, "Clear finished");
      clear.addEventListener("click", () => jobAct("/api/pool/dismiss", {}));
      rows.push(el("div", {}, clear));
    }
    return el("section", { class: "pool-card pool-jobs" }, el("h3", {}, "Running ", el("span", { class: "dim" }, "carries on if you leave this page")), ...rows);
  };

  // ---- the disk: used and free, and what one more slot would take
  const diskCard = (d, busy) => {
    const dk = d.disk || {};
    const est = d.estimate;
    const sizes = d.sizes || {};
    const fits = est && dk.free ? Math.floor(dk.free / est.bytes) : null;
    const pct = dk.total ? Math.round((dk.used / dk.total) * 100) : 0;
    const used = el("div", { class: "pool-meter-used" });
    used.style.width = pct + "%"; // not a style attribute: the page's content security policy has none
    const meter = el("div", { class: "pool-meter", role: "img", "aria-label": `${pct}% of the disk used` }, used);
    const measure = el("button", { class: "small", disabled: d.measuring || busy }, d.measuring ? "Measuring…" : sizes.at ? "Measure again" : "Measure sizes");
    measure.addEventListener("click", () => act("/api/pool/measure", {}));
    return el("section", { class: "pool-card" }, el("h3", {}, "Disk"),
      dk.total ? [meter, el("div", { class: "pool-nums" },
        el("span", {}, el("strong", {}, poolBytes(dk.used)), " used"), el("span", {}, el("strong", {}, poolBytes(dk.free)), " free"),
        el("span", { class: "dim" }, `of ${poolBytes(dk.total)} on ${dk.path}`))] : el("p", { class: "dim" }, "The disk's size couldn't be read."),
      est
        ? el("p", {}, "A new slot takes about ", el("strong", {}, poolBytes(est.bytes)), ` (the size of ${est.from})`,
          fits !== null ? [", so there is room for about ", el("strong", {}, String(fits)), " more."] : ".")
        : el("p", { class: "dim" }, "How much a new slot takes isn't known yet: measuring reads every file of the checkout, which takes minutes on a big project."),
      el("div", { class: "pool-row" }, measure,
        sizes.at ? el("span", { class: "dim small" }, "measured " + ago(sizes.at)) : ""));
  };

  // ---- no pool yet: make one
  const createCard = (d, busy) => {
    const size = el("input", { type: "number", min: "1", max: "50", value: String(d.seed.size), "aria-label": "slots to make", class: "pool-num" });
    const warm = (d.seed.warm || []);
    const go = el("button", { class: "primary", disabled: busy }, "Create the pool");
    go.addEventListener("click", () => {
      const n = parseInt(size.value, 10);
      if (!(n >= 1)) return;
      const est = d.estimate ? ` That is about ${poolBytes(n * d.estimate.bytes)} of ${poolBytes((d.disk || {}).free || 0)} free.` : "";
      if (!confirm(`Make ${n} worktree${n === 1 ? "" : "s"} for this project? Each is a full checkout${warm.length ? " and a copy of " + warm.join(", ") : ""}, which takes a while.${est}`)) return;
      act("/api/pool/create", { size: n }, r => `Made ${r.made.length} slot${r.made.length === 1 ? "" : "s"}.`);
    });
    return el("section", { class: "pool-card" }, el("h3", {}, "No pool yet"),
      el("p", {}, "This project has no worktree pool. Create one and each feature that asks for its own worktree takes a ready one."),
      el("div", { class: "pool-row" }, el("label", {}, "Slots ", size), go),
      el("p", { class: "dim small" }, warm.length ? `Each new slot also gets a copy of ${warm.join(", ")} from the main checkout, so the project opens without starting from nothing.`
        : "Each new slot is a plain checkout."));
  };

  // ---- the pool: its slots
  const poolCard = (d, busy) => {
    const cfg = d.config, slots = d.slots || [];
    const coming = (d.jobs || []).filter(j => j.kind === "add" && j.state !== "done").length; // a slot being made counts toward the most
    const full = slots.length + coming - (slots.filter(s => s.job && s.job.kind === "add").length) >= cfg.max;
    const add = el("button", { disabled: busy || full, title: full ? "The pool is at its most: raise the most below" : "" }, "Add a slot");
    add.addEventListener("click", () => {
      const est = d.estimate ? ` It takes about ${poolBytes(d.estimate.bytes)} of the ${poolBytes((d.disk || {}).free || 0)} free.` : " How much it takes isn't measured yet.";
      if (confirm(`Add a slot to the pool?${est} It is a full checkout, so it takes a while.`)) act("/api/pool/add", {}, () => "Added a slot.");
    });
    const refresh = el("button", { disabled: busy || !d.free, title: "Bring the free slots up to date with " + (d.base || "the base branch") }, "Refresh free slots");
    refresh.addEventListener("click", () => act("/api/pool/refresh", {}, r => (r.slots || []).map(s => `${s.slot}: ${s.result}`).join("; ")));
    const size = el("input", { type: "number", min: "1", value: String(cfg.size), class: "pool-num", "aria-label": "slots the pool starts with" });
    const max = el("input", { type: "number", min: "1", value: String(cfg.max), class: "pool-num", "aria-label": "most slots the pool may have" });
    const save = el("button", { class: "small", disabled: busy }, "Save");
    save.addEventListener("click", () => act("/api/pool/config", { size: parseInt(size.value, 10), max: parseInt(max.value, 10) }, () => "Settings saved."));
    const validate = el("button", { disabled: busy || !slots.length, title: "Look at every slot for a checkout that stopped half way, a lock left behind or missing files (changes nothing)" }, "Validate");
    validate.addEventListener("click", () => act("/api/pool/validate", {}, r => `${r.checked} slot${r.checked === 1 ? "" : "s"} checked: ${r.ok} ok, ${r.warn} to look at, ${r.broken} broken.`));
    const rows = slots.map(s => slotRow(d, s, busy || !!s.job));
    return el("section", { class: "pool-card" },
      el("h3", {}, "Slots ", el("span", { class: "dim" }, `${d.free} of ${slots.length} free`)),
      el("div", { class: "pool-row" }, add, refresh, validate, d.checkedAt ? el("span", { class: "dim small" }, "checked " + ago(d.checkedAt)) : "",
        el("span", { class: "pool-set" }, el("label", {}, "Start with ", size), el("label", {}, "most ", max), save)),
      slots.length >= cfg.max ? el("p", { class: "dim small" }, `The pool is at its most (${cfg.max}): raise the most to add another.`) : "",
      slots.length === 0 ? el("p", { class: "dim" }, "The pool has no slots: Add a slot.") :
        el("table", { class: "pool-table" },
          el("thead", {}, el("tr", {}, ["Slot", "Held by", "Branch", "Behind", "Size", "Check", ""].map(h => el("th", {}, h)))),
          el("tbody", {}, rows)));
  };

  const slotRow = (d, s, busy) => {
    const claimed = s.state === "claimed";
    const who = !claimed ? el("span", { class: "chip todo" }, "free")
      : s.featureExists ? el("a", { href: "#feature/" + encodeURIComponent(s.feature) }, s.feature)
        : el("span", {}, s.feature || "(unknown)", " ", el("span", { class: "chip bad", title: "No feature of this project by that name is on the Features page now" }, "feature not found"));
    const branch = claimed ? s.featureBranch || s.branch : s.branch;
    const act1 = el("button", { class: "small", disabled: busy }, claimed ? "Free up" : "Delete");
    act1.addEventListener("click", () => {
      if (claimed) {
        if (!confirm(`Free ${s.slot}?\n\n${s.feature || "The feature"}'s branch ${branch} is kept with its commits, and ${s.slot} goes back to the pool. ` +
          `Nothing is lost, but the feature no longer has a folder here. If ${s.slot} has uncommitted files it is left as it is.`)) return;
        act("/api/pool/release", { slot: s.slot }, r => `${s.slot} is free again${r.branchKept ? ` (the branch ${r.branchKept} is kept)` : ""}.`);
      } else if (confirm(`Delete ${s.slot}? Its folder and everything in it that isn't committed are removed${s.size ? ` (${poolBytes(s.size)})` : ""}. This takes a while.`)) {
        act("/api/pool/remove", { slot: s.slot }, () => `${s.slot} deleted.`);
      }
    });
    // Open in Unity: a new Editor on this slot's project, only when pressed (one Editor per slot; several slots may be open together)
    const un = s.unity || {}, unityBtn = un.project ? el("button", { class: "small", disabled: busy || un.state === "open",
      title: un.state === "open" ? "An Editor already has this project open" : `Open ${s.slot}'s Unity project in a new Editor` }, "Open in Unity") : "";
    if (unityBtn) unityBtn.addEventListener("click", () => {
      const force = un.state === "stale";
      if (force && !confirm(`${s.slot} has a lock file left by an Editor that is no longer running. Open it in Unity anyway?`)) return;
      act("/api/pool/unity", { slot: s.slot, force }, r => r.note || `Opening ${s.slot} in Unity.`);
    });
    return el("tr", { class: claimed ? "" : "pool-free" },
      el("td", {}, el("strong", {}, s.slot), el("div", { class: "dim small pool-path", title: s.path }, s.path)),
      el("td", {}, who, claimed && s.merge ? el("span", { class: "chip " + (s.merge === "merged" ? "done" : "now"), title: "the merge request" }, s.merge) : ""),
      el("td", {}, el("code", {}, branch || "-"), claimed && s.base ? el("div", { class: "dim small" }, "from " + s.base) : ""),
      el("td", {}, s.behind === null || s.behind === undefined ? "?" : String(s.behind)),
      el("td", {}, s.size ? poolBytes(s.size) : el("span", { class: "dim" }, "not measured")),
      el("td", {}, checkCell(s, busy)),
      el("td", {}, unityBtn, " ", un.state === "open" ? el("span", { class: "chip now", title: "An Editor has this project open" }, "Unity open") : "", " ", act1));
  };

  // ---- what Validate found for a slot, and the repairs it offers (each asks first)
  const FIXES = {
    "clear-lock": ["Remove stale lock", () => "Remove the lock git left behind? Nothing else changes."],
    "prune": ["Prune", () => "Remove git's record of this missing worktree?"],
    "warm": ["Copy cache", s => `Copy the project's cache (the folders the pool keeps warm, such as Library) into ${s.slot}? A copy that stopped carries on from where it was: only files that are missing or a different size are copied, and nothing in the slot is removed. A whole one is only read. It can take minutes.`],
    "restore-files": ["Restore files", s => `Restore the missing tracked files in ${s.slot}? It is free, so nothing of a feature's is touched.`],
    "rebuild": ["Rebuild slot", s => s.state === "claimed"
      ? `Rebuild ${s.slot}?

${s.feature || "The feature"}'s branch ${s.featureBranch || s.branch} keeps its commits and the slot is made again on it, but EVERYTHING UNCOMMITTED OR UNTRACKED in ${s.slot} IS LOST. It takes a while.`
      : `Rebuild ${s.slot}? Its folder is deleted and made again from the base branch, with a copy of the project's cache. It takes a while.`],
  };
  const checkCell = (s, busy) => {
    if (s.job) return el("span", { class: "pool-busy small" }, spinnerMark("sp-mark"), s.job.state === "queued" ? "waiting: " + s.job.label : s.job.label + "…");
    const c = s.check;
    if (!c) return el("span", { class: "dim" }, "not checked");
    const chip = el("span", { class: "chip " + (c.level === "ok" ? "done" : c.level === "warn" ? "now" : "bad") }, c.level === "ok" ? "ok" : c.level === "warn" ? "look" : "broken");
    const items = c.problems.map(p => {
      const fix = FIXES[p.fix];
      const btn = fix ? el("button", { class: "small", disabled: busy }, fix[0]) : "";
      if (fix) btn.addEventListener("click", () => {
        const text = fix[1](s);
        if (p.fix === "rebuild" && s.state === "claimed") {
          const typed = prompt(text + `

Type ${s.slot} to go on.`);
          if (typed !== s.slot) return;
        } else if (!confirm(text)) return;
        act("/api/pool/repair", { slot: s.slot, action: p.fix }, r => `${s.slot}: ${r.did}.`);
      });
      return el("div", { class: "pool-problem small" }, p.text, " ", btn);
    });
    return el("div", {}, chip, ...items);
  };

  await load();
}
