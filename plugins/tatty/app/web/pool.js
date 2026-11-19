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

async function renderWorktrees(box) {
  const view = poolView = { box, timer: 0, data: null, note: "", noteBad: false };
  const live = () => poolView === view && box.isConnected;
  const root = el("div", { class: "pool-page" });
  box.replaceChildren(root);

  // What a button did, said under the header; the page is read again either way.
  const say = (text, bad) => { view.note = text; view.noteBad = !!bad; };
  const act = async (path, body, done) => {
    say("");
    try { const r = await api(path, body); say(done ? done(r) : ""); }
    catch (e) { say(String(e.message || e), true); }
    await load();
  };

  const load = async () => {
    clearTimeout(view.timer);
    if (!live()) return;
    try { view.data = await api("/api/pool"); }
    catch (e) { root.replaceChildren(el("p", { class: "pad st missing" }, "The worktrees didn't load: " + String(e.message || e))); return; }
    if (!live()) return;
    draw();
    const d = view.data;
    if (d.busy || d.measuring) view.timer = setTimeout(load, 3000); // something slow is running: look again soon
  };

  const draw = () => {
    const d = view.data;
    const busy = !!d.busy;
    const head = el("div", { class: "pool-head" }, el("h2", {}, "Worktrees"),
      d.repo ? el("span", { class: "dim small pool-repo" }, d.repo) : "");
    const kids = [head];
    if (!d.repo) { kids.push(el("p", { class: "dim" }, d.note || "")); root.replaceChildren(...kids); return; }
    kids.push(el("p", { class: "dim" },
      "A worktree is a whole second checkout of this project, so features and bug fixes can run side by side. The pool keeps some made and " +
      "up to date: a feature takes a free one instead of waiting for a new checkout, and gives it back when it's done."));
    if (view.note) kids.push(el("p", { class: view.noteBad ? "st missing" : "st ok" }, view.note));
    if (busy) kids.push(el("p", { class: "pool-busy" }, el("span", { class: "pool-spin" }), d.busy));
    if (d.warning) kids.push(el("p", { class: "st missing" }, d.warning));
    kids.push(diskCard(d, busy));
    kids.push(d.exists ? poolCard(d, busy) : createCard(d, busy));
    root.replaceChildren(...kids);
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
    const add = el("button", { disabled: busy || slots.length >= cfg.max, title: slots.length >= cfg.max ? "The pool is at its most: raise the most below" : "" }, "Add a slot");
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
    const rows = slots.map(s => slotRow(d, s, busy));
    return el("section", { class: "pool-card" },
      el("h3", {}, "Slots ", el("span", { class: "dim" }, `${d.free} of ${slots.length} free`)),
      el("div", { class: "pool-row" }, add, refresh,
        el("span", { class: "pool-set" }, el("label", {}, "Start with ", size), el("label", {}, "most ", max), save)),
      slots.length >= cfg.max ? el("p", { class: "dim small" }, `The pool is at its most (${cfg.max}): raise the most to add another.`) : "",
      slots.length === 0 ? el("p", { class: "dim" }, "The pool has no slots: Add a slot.") :
        el("table", { class: "pool-table" },
          el("thead", {}, el("tr", {}, ["Slot", "Held by", "Branch", "Behind", "Size", ""].map(h => el("th", {}, h)))),
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
    return el("tr", { class: claimed ? "" : "pool-free" },
      el("td", {}, el("strong", {}, s.slot), el("div", { class: "dim small pool-path", title: s.path }, s.path)),
      el("td", {}, who, claimed && s.merge ? el("span", { class: "chip " + (s.merge === "merged" ? "done" : "now"), title: "the merge request" }, s.merge) : ""),
      el("td", {}, el("code", {}, branch || "-"), claimed && s.base ? el("div", { class: "dim small" }, "from " + s.base) : ""),
      el("td", {}, s.behind === null || s.behind === undefined ? "?" : String(s.behind)),
      el("td", {}, s.size ? poolBytes(s.size) : el("span", { class: "dim" }, "not measured")),
      el("td", {}, act1));
  };

  await load();
}
