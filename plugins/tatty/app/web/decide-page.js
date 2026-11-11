// The Decide page (#feature/<name>/decide): the questions a workflow session wrote down and left for the
// person (an adversary's challenges, the plan's proposals), put to them one at a time, each with the planner's
// take or the proposal's recommendation, and the options it can take. Every answer is recorded as it is given, by the toolbox's decide.sh (the server's
// decide_set), so the page can be left and come back to. With the last one, the feature's open session is
// told to carry on and apply them; with none open, the feature's Start picks them up.

const featureDecideHref = name => "#feature/" + encodeURIComponent(name) + "/decide";
const DECIDE_SEV = { blocking: "bad", significant: "now", minor: "todo", open: "now", "default applied": "todo" };
// a challenge's fields, and a proposal's, in the order they are shown
const DECIDE_FIELDS = [["target", "Targets"], ["assumption", "Assumption attacked"], ["why", "Why it may be wrong"], ["evidence", "Evidence"]];
const DECIDE_PROPOSAL_FIELDS = [["decides", "Decides"]];

// A field as the document wrote it: inline markdown, with its links to other documents as the feature
// page's .doclinks (app.js's inline); plain words if that isn't loaded.
const decidePlain = s => (s || "").replace(/\[([^\]]+)\]\((?:<[^>]*>|[^)]*)\)/g, "$1")
  .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, "$1").replace(/\[\[([^\]#|]+)(?:#[^\]]*)?\]\]/g, "$1");
const decideText = s => {
  if (typeof inline !== "function") return decidePlain(s);
  const span = el("span", {});
  // ids.sh links a cite as [R2](<Doc.md#heading>): inline reads the same link written Obsidian's way
  span.innerHTML = inline((s || "").replace(/\[([^\]]+)\]\(<([^>#]+?)(?:\.md)?(#[^>]*)?>\)/g, (_, t, d, at) => `[[${d}${at || ""}|${t}]]`));
  return span;
};

async function decidePage(f, main) {
  const enc = encodeURIComponent;
  const put = (...nodes) => main.replaceChildren(el("div", { class: "rv-page dc-page" }, ...nodes));
  const head = el("h2", {}, "Decisions");
  const back = el("a", { href: featureHref(f.name) }, "← Overview");
  let items;
  put(head, waitNode());
  try { items = (await api("/api/decide?name=" + enc(f.name))).items; }
  catch (e) { put(head, el("p", { class: "st missing" }, String(e.message || e)), back); return; }
  if (!items.length) { put(head, el("p", { class: "dim" }, "Nothing is waiting for a decision."), back); return; }
  const keyOf = x => x.doc + "#" + x.id; // two question lists can both have a Q1
  const shown = new Map(); // item -> {fields, options} once read
  const loading = new Map(); // item -> the read in flight (or done)
  // item -> {key, note, label, sent}: what was chosen on this page. A choice is kept here, and in this browser
  // (a draft, so the page can be left and come back to), until the last one is decided; then all are sent together.
  const decided = new Map();
  const errs = new Map(); // item -> why the toolbox refused it when they were sent
  const isDone = i => i.state !== "open" || decided.has(keyOf(i));
  const draftKey = "tatty.decide." + f.name;
  const saveDraft = () => {
    try {
      const d = {};
      decided.forEach((v, k) => { if (!v.sent) d[k] = { key: v.key, note: v.note, label: v.label }; });
      if (Object.keys(d).length) localStorage.setItem(draftKey, JSON.stringify(d)); else localStorage.removeItem(draftKey);
    } catch (e) { /* no storage: the choices are kept only while the page is open */ }
  };
  try { // a draft from an earlier visit, for the items still waiting
    const d = JSON.parse(localStorage.getItem(draftKey) || "{}");
    items.forEach(i => { const v = d[keyOf(i)]; if (i.state === "open" && v && typeof v.key === "string") decided.set(keyOf(i), { key: v.key, note: String(v.note || ""), label: String(v.label || v.key), sent: false }); });
  } catch (e) { /* an unreadable draft is no draft */ }
  let at = Math.max(0, items.findIndex(i => !isDone(i)));
  // Reading an item runs a script on the server, so the rest are read in the background, one at a time,
  // and the next question is on screen the moment Decide is pressed.
  const load = i => {
    const k = keyOf(i);
    if (!loading.has(k)) loading.set(k, api(`/api/decide/item?name=${enc(f.name)}&doc=${enc(i.doc)}&id=${enc(i.id)}`)
      .then(v => { shown.set(k, v); return v; }, e => { loading.delete(k); throw e; }));
    return loading.get(k);
  };
  const prefetch = async () => {
    for (const x of items.slice(at).concat(items.slice(0, at))) if (x.state === "open" && !shown.has(keyOf(x))) await load(x).catch(() => {});
  };

  // All the choices not yet sent go in one request. A refused one is put back to its person with the reason;
  // a request that fails altogether leaves every choice kept, and the last item's button tries again.
  const send = async () => {
    const todo = items.filter(x => decided.has(keyOf(x)) && !decided.get(keyOf(x)).sent);
    put(head, el("p", { class: "dim", id: "dc-sending", role: "status" }, el("span", { class: "throbber" }), ` Sending ${todo.length} decision${todo.length === 1 ? "" : "s"}…`));
    let r;
    try {
      r = await api("/api/decide", { name: f.name, answers: todo.map(x => { const v = decided.get(keyOf(x)); return { doc: x.doc, id: x.id, choice: v.key, note: v.note }; }) });
    } catch (e) {
      const last = todo[todo.length - 1] || items[items.length - 1];
      errs.set(keyOf(last), "Your decisions are kept, but they could not be sent: " + String(e.message || e) + ". Press the button to try again.");
      at = items.indexOf(last); draw(); return;
    }
    refreshFeature(f.name); // (features.js: the rail's count and the overview are read again behind this page)
    const bad = new Map((r.results || []).filter(x => !x.ok).map(x => [x.doc + "#" + x.id, x.error]));
    todo.forEach(x => { const k = keyOf(x); if (bad.has(k)) { decided.delete(k); errs.set(k, bad.get(k)); } else decided.get(k).sent = true; });
    saveDraft();
    if (bad.size) { at = items.findIndex(x => bad.has(keyOf(x))); draw(); return; }
    finished(r);
  };

  const finished = r => {
    const said = r && r.nudged
      ? el("p", {}, "Every one is decided. ", el("a", { href: "#workflows/" + enc(r.nudged.tag) }, r.nudged.name || "The session"),
        " has been told to carry on, and applies them now.")
      : el("p", {}, "Every one is decided. No session is open for this feature: ",
        el("a", { href: featureHref(f.name) }, "start it again"), " and it applies them first.");
    put(head, said, el("div", { class: "card rv-results" }, items.map(i => el("div", { class: "rv-row" },
      i.kind === "question" ? "" : el("span", { class: "chip " + (DECIDE_SEV[i.severity] || "todo") }, i.severity), " ", el("strong", {}, i.id), " ", i.title,
      el("div", { class: "small dim" }, decided.has(keyOf(i)) ? "You chose: " + decided.get(keyOf(i)).label : i.state === "apply" ? "Decided earlier: waiting to be applied" : "")))), back);
  };

  const draw = async () => {
    const i = items[at];
    if (!shown.has(keyOf(i))) {
      put(head, waitNode()); // (read by a script: a few seconds when it was not read ahead)
      try { await load(i); }
      catch (e) { put(head, el("p", { class: "st missing" }, String(e.message || e)), back); return; }
    }
    const { fields, options } = shown.get(keyOf(i));
    if (decided.has(keyOf(i)) && !options.some(o => o.key === decided.get(keyOf(i)).key)) decided.delete(keyOf(i)); // a stale draft
    // decided earlier and waiting to be applied: show what was chosen (a challenge's accept, a proposal's option)
    const before = fields.state !== "apply" ? "" : i.kind === "proposal"
      ? ((fields.chosen || "").match(/^Option ([A-Z]):/) || [])[1] || ((fields.chosen || "").startsWith("Other:") ? "other" : "")
      : i.kind === "question" ? fields.decision || "" : "accept";
    let choice = decided.has(keyOf(i)) ? decided.get(keyOf(i)).key : before;
    const note = el("textarea", { id: "dc-note", rows: 2, "aria-label": "note" });
    note.value = decided.has(keyOf(i)) ? decided.get(keyOf(i)).note : "";
    const go = el("button", { type: "button", class: "primary", id: "dc-go" });
    const msg = el("div", { class: "small st missing", id: "dc-msg" }, errs.get(keyOf(i)) || "");
    const opts = [];
    const needsNote = () => { const o = options.find(x => x.key === choice); return !!(o && o.needsNote); };
    const sync = () => {
      const o = options.find(x => x.key === choice);
      note.placeholder = needsNote() ? "Your words, needed for this one" + (o.detail ? ` (${o.detail.replace(/\.$/, "")})` : "") : "A note to go with it (optional)";
      go.disabled = !choice || (needsNote() && !note.value.trim());
      const left = items.filter(x => !isDone(x) && x !== i).length;
      go.textContent = left ? "Decide" : "Decide, and carry on";
    };
    const pick = k => { choice = k; opts.forEach(o => o.node.classList.toggle("picked", o.key === k)); sync(); if (needsNote()) note.focus(); };
    const option = o => {
      const radio = el("input", { type: "radio", name: "dc-choice", value: o.key, "aria-label": o.title });
      radio.checked = choice === o.key;
      radio.addEventListener("change", () => pick(o.key));
      const node = el("label", { class: "rv-opt" + (choice === o.key ? " picked" : ""), "data-key": o.key }, radio,
        el("span", {}, el("strong", {}, /^[A-Z]$/.test(o.key) ? `${o.key} — ${o.title}` : o.title), o.recommended ? el("span", { class: "chip done" }, "recommended") : "",
          o.detail ? el("div", { class: "small dim" }, o.detail) : ""));
      opts.push({ key: o.key, node });
      return node;
    };
    note.addEventListener("input", sync);
    const move = to => { at = Math.max(0, Math.min(items.length - 1, to)); draw(); };
    go.addEventListener("click", () => {
      const o = options.find(x => x.key === choice), words = note.value.trim();
      errs.delete(keyOf(i));
      decided.set(keyOf(i), { key: choice, note: words, label: (o ? o.title : choice) + (words ? ` (${words})` : ""), sent: false });
      saveDraft();
      if (!items.some(x => !isDone(x))) { send(); return; } // the last one: everything goes now
      const nextOne = items.findIndex((x, n) => n > at && !isDone(x));
      move(nextOne >= 0 ? nextOne : items.findIndex(x => !isDone(x)));
    });
    const done = items.filter(isDone).length;
    const list = el("div", { class: "rv-list", role: "list" }, items.map((x, n) => el("button", {
      type: "button", class: "rv-dot" + (isDone(x) ? " done" : "") + (n === at ? " now" : ""),
      title: `${x.id}: ${x.title}`, "aria-label": `${x.id}: ${x.title}`, onclick: () => move(n) }, isDone(x) ? "✓" : String(n + 1))));
    const proposal = i.kind === "proposal", question = i.kind === "question";
    const facts = question ? [] : (proposal ? DECIDE_PROPOSAL_FIELDS : DECIDE_FIELDS).filter(([k]) => fields[k])
      .map(([k, label]) => el("li", {}, el("strong", {}, label + ": "), decideText(fields[k])));
    const take = proposal ? fields.recommendation : fields.take;
    // a question list's context keeps its lines (show joins them with " / ")
    const context = question && fields.context ? el("div", { class: "dc-context" },
      fields.context.split(" / ").map(l => el("div", {}, decideText(l)))) : proposal && fields.context ? el("p", { class: "dc-context" }, decideText(fields.context)) : "";
    const card = el("section", { class: "card rv-item", id: "dc-item", "data-id": i.id },
      el("div", { class: "rv-chips" }, el("span", { class: "qchip id" }, i.id),
        question ? (i.severity ? el("code", {}, i.severity) : "") : el("span", { class: "chip " + (DECIDE_SEV[i.severity] || "todo") }, i.severity),
        i.group ? el("span", { class: "dim small" }, i.group) : "", fields.state === "apply" ? el("span", { class: "chip done" }, "decided: waiting to be applied") : ""),
      el("h3", {}, i.title),
      context,
      facts.length ? el("ul", { class: "qevidence dc-facts" }, facts) : "",
      take ? el("p", { class: "dc-take" }, el("em", {}, el("strong", {}, proposal ? "Recommendation: " : "The planner's take: "), decideText(take))) : "",
      !proposal && fields.question ? el("p", { class: "ask-line" }, el("strong", {}, decideText(fields.question))) : "",
      proposal ? el("p", { class: "small" }, el("a", { href: featureHref(f.name, i.doc), id: "dc-doc" }, "The full comparison, in " + i.doc)) : "",
      el("div", { class: "rv-opts" }, options.map(option)),
      note, msg,
      el("div", { class: "start-actions" }, go,
        el("button", { type: "button", id: "dc-prev", disabled: at === 0, onclick: () => move(at - 1) }, "Back"),
        el("button", { type: "button", id: "dc-skip", disabled: at === items.length - 1, onclick: () => move(at + 1) }, "Next")));
    put(head, el("div", { class: "small dim" }, "Written down by the workflow for you to decide here, instead of one at a time in the terminal. Your choices are kept in this browser and sent together with the last one. ", back),
      el("div", { class: "rv-progress" }, bar(done, items.length, `${done} of ${items.length} decided`)), list, card);
    if (typeof linkIds === "function") linkIds(card, f.name);
    pick(choice);
  };
  draw().then(prefetch);
}
