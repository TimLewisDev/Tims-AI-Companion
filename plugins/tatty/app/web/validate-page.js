// The Validation page (#feature/<name>/validate): a work unit's engineer checks, written by the workflow as a
// question list (validation-<WU>.md) and put here as one checklist: every check on the page, a result for each
// (the list's own options: passed, failed, waived), and a Validate button at the bottom that sends the results
// that have been given. Checks without a result stay open; the feature's session is told which, and carries on.
// Results are recorded by the toolbox's decide.sh (the server's decide_batch), as the Decide page does. Uses
// decide-page.js's decideText / decidePlain and app.js's el, api, bar and waitNode.

const VALIDATE_DOC = /^\.tt\/[^/]+ - Questions\/validation-[^/]+\.md$/;

async function validatePage(f, main) {
  const enc = encodeURIComponent;
  const put = (...nodes) => main.replaceChildren(el("div", { class: "rv-page vl-page" }, ...nodes));
  const head = el("h2", {}, "Validation");
  const back = el("a", { href: featureHref(f.name) }, "← Overview");
  let items, kept = {};
  put(head, waitNode());
  try { const got = await api("/api/decide?drafts=1&scope=validate&name=" + enc(f.name)); items = got.items; kept = got.drafts || {}; }
  catch (e) { put(head, el("p", { class: "st missing" }, String(e.message || e)), back); return; }
  if (!items.length) { put(head, el("p", { class: "dim" }, "No checks are waiting for you."), back); return; }
  const keyOf = x => x.doc + "#" + x.id;
  const shown = new Map(); // key -> {fields, options}
  const held = new Map(); // key -> {key (the option), note, at}: given a result on this page, not sent yet
  const sentNow = new Map(); // key -> {key, label}: sent from this page
  const errs = new Map();
  const isOpen = x => x.state === "open" && !sentNow.has(keyOf(x));

  // Results are kept at once in this browser and a moment later in Tatty's home (see decide-page.js).
  const draftKey = "tatty.validate." + f.name;
  const entries = () => {
    const d = {};
    held.forEach((v, k) => { d[k] = { key: v.key, note: v.note, label: "", decided: false, at: v.at }; });
    return d;
  };
  let draftTimer = null;
  const flushDraft = hiding => {
    clearTimeout(draftTimer); draftTimer = null;
    const body = { name: f.name, scope: "validate", entries: entries() };
    if (hiding) fetch("/api/decide/draft", { method: "POST", keepalive: true, headers: { "X-TT-Token": token, "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    else api("/api/decide/draft", body).catch(() => { /* the browser still has it */ });
  };
  const saveDraft = () => {
    try { const d = entries(); if (Object.keys(d).length) localStorage.setItem(draftKey, JSON.stringify(d)); else localStorage.removeItem(draftKey); }
    catch (e) { /* no storage: Tatty's home still has it */ }
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => flushDraft(false), 400);
  };
  const leaving = () => { if (draftTimer) flushDraft(true); };
  window.addEventListener("pagehide", leaving);
  document.addEventListener("visibilitychange", () => { if (document.hidden) leaving(); });
  let local = {};
  try { local = JSON.parse(localStorage.getItem(draftKey) || "{}") || {}; } catch (e) { /* an unreadable draft is no draft */ }
  const both = {};
  for (const [k, v] of Object.entries(kept)) if (VALIDATE_DOC.test(k.split("#")[0])) both[k] = v;
  for (const k of Object.keys(local)) if (!both[k] || (+local[k].at || 0) >= (+both[k].at || 0)) both[k] = local[k]; // the newer copy wins
  items.forEach(i => {
    const v = both[keyOf(i)];
    if (i.state === "open" && v && typeof v.key === "string") held.set(keyOf(i), { key: v.key, note: String(v.note || ""), at: +v.at || Date.now() });
  });

  // every check is on the page at once, so every one is read now (three at a time: each is a script run)
  const read = async () => {
    const todo = items.slice();
    const worker = async () => {
      for (let x = todo.shift(); x; x = todo.shift()) {
        try { shown.set(keyOf(x), await api(`/api/decide/item?name=${enc(f.name)}&doc=${enc(x.doc)}&id=${enc(x.id)}`)); }
        catch (e) { errs.set(keyOf(x), String(e.message || e)); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };
  await read();

  const draw = () => {
    const rows = [];
    const open = items.filter(isOpen);
    const given = open.filter(x => held.has(keyOf(x)));
    const optionOf = (x, key) => ((shown.get(keyOf(x)) || {}).options || []).find(o => o.key === key);
    const ready = given.filter(x => { const h = held.get(keyOf(x)), o = optionOf(x, h.key); return o && (!o.needsNote || h.note.trim()); });
    const waiting = given.length - ready.length; // a Failed / Waived still without its words
    const msg = el("div", { class: "small st missing", id: "vl-msg" }, "");
    const go = el("button", { type: "button", class: "primary", id: "vl-go" });
    const sync = () => {
      const now = items.filter(isOpen).filter(x => held.has(keyOf(x)));
      const good = now.filter(x => { const h = held.get(keyOf(x)), o = optionOf(x, h.key); return o && (!o.needsNote || h.note.trim()); });
      go.disabled = !good.length;
      go.textContent = good.length ? `Validate (${good.length})` : "Validate";
      const missing = now.length - good.length;
      msg.textContent = missing ? `${missing} ${missing === 1 ? "check needs" : "checks need"} your words before ${missing === 1 ? "it" : "they"} can be sent.` : "";
      const left = items.filter(isOpen).length - good.length;
      status.textContent = good.length ? `${good.length} will be sent${left ? `; ${left} ${left === 1 ? "stays" : "stay"} open` : ""}.` : "Give a result to each check you have done, then press Validate.";
    };
    const status = el("span", { class: "dim small", id: "vl-status" });

    const check = (x, n) => {
      const k = keyOf(x);
      const got = shown.get(k);
      const node = el("section", { class: "card vl-check", "data-id": x.id, "data-doc": x.doc });
      if (!got) { node.append(el("h3", {}, `${n}. ${x.title}`), el("p", { class: "st missing" }, errs.get(k) || "Could not read this check.")); return node; }
      const { fields, options } = got;
      const done = !isOpen(x);
      const sentKey = sentNow.has(k) ? sentNow.get(k).key : (fields.decision || "");
      const h = held.get(k);
      const picked = done ? sentKey : h ? h.key : "";
      const lines = (fields.context || "").split(" / ").filter(Boolean);
      const note = el("textarea", { rows: 2, "aria-label": "note", class: "vl-note", "data-id": x.id });
      note.value = done ? (sentNow.has(k) ? sentNow.get(k).note : fields.note || "") : h ? h.note : "";
      note.disabled = done;
      const seg = el("div", { class: "vl-seg", role: "radiogroup", "aria-label": `Result of check ${n}` });
      const chooser = [];
      const place = () => {
        const o = optionOf(x, held.has(k) ? held.get(k).key : picked);
        const show = !!o && (o.needsNote || note.value.trim() || !done);
        note.hidden = !show || (!o);
        note.placeholder = o && o.needsNote ? "Your words, needed for this one" + (o.detail ? ` (${o.detail.replace(/\.$/, "")})` : "") : "A note to go with it (optional)";
        chooser.forEach(c => c.node.classList.toggle("picked", c.key === (held.has(k) ? held.get(k).key : picked)));
        node.classList.toggle("vl-done", !!(held.has(k) || done));
        node.classList.toggle("vl-bad", (held.has(k) ? held.get(k).key : picked) === "failed");
      };
      options.forEach(o => {
        const radio = el("input", { type: "radio", name: "vl-" + x.id + "-" + x.doc, value: o.key, "aria-label": o.title });
        radio.checked = picked === o.key;
        radio.disabled = done;
        radio.addEventListener("change", () => {
          held.set(k, { key: o.key, note: note.value, at: Date.now() });
          saveDraft(); place(); sync();
          if (o.needsNote && !note.value.trim()) note.focus();
        });
        const lab = el("label", { class: "vl-opt vl-" + o.key.replace(/[^a-z0-9-]/gi, ""), "data-key": o.key, title: o.detail || "" }, radio, el("span", {}, o.title));
        chooser.push({ key: o.key, node: lab });
        seg.append(lab);
      });
      note.addEventListener("input", () => { if (held.has(k)) { held.get(k).note = note.value; held.get(k).at = Date.now(); saveDraft(); } sync(); });
      node.append(
        el("div", { class: "rv-chips" }, el("span", { class: "qchip id" }, `${n}`), fields.ref ? el("span", { class: "dim small" }, fields.ref) : "",
          done ? el("span", { class: "chip done" }, sentNow.has(k) ? "sent" : "decided: waiting to be applied") : ""),
        el("h3", { class: "dc-title" }, decideText(x.title)),
        lines.length ? el("ol", { class: "vl-steps" }, lines.map(l => el("li", {}, decideText(l)))) : "",
        fields.take ? el("div", { class: "dc-take" }, el("div", { class: "dc-take-label" }, "What you should see"), el("div", {}, decideText(fields.take))) : "",
        seg, note, errs.get(k) ? el("div", { class: "small st missing" }, errs.get(k)) : "");
      place();
      return node;
    };

    let n = 0, group = null;
    for (const x of items) {
      n++;
      if (x.group !== group) { group = x.group; rows.push(el("h3", { class: "vl-group" }, group || "Checks")); }
      rows.push(check(x, n));
    }
    const finishedAll = !open.length;
    go.addEventListener("click", () => send());
    const done = items.length - open.length;
    put(head,
      el("div", { class: "small dim" }, "The checks to try for a work unit, written by the workflow for you to do here instead of in the terminal. Your results are kept in this browser and sent with Validate; a check you leave without a result stays open. ", back),
      el("div", { class: "rv-progress" }, bar(done + ready.length, items.length, `${done + ready.length} of ${items.length} have a result`)),
      ...rows,
      finishedAll ? el("p", {}, "Every check has a result.") : "",
      el("div", { class: "vl-foot start-actions", id: "vl-foot" }, go, status, msg));
    if (typeof linkIds === "function") linkIds(main, f.name, { allowDefining: true, headings: true });
    sync();
    return waiting;
  };

  const send = async () => {
    const todo = items.filter(x => isOpen(x) && held.has(keyOf(x))).filter(x => {
      const h = held.get(keyOf(x)), o = ((shown.get(keyOf(x)) || {}).options || []).find(o => o.key === h.key);
      return o && (!o.needsNote || h.note.trim());
    });
    if (!todo.length) return;
    const go = document.querySelector("#vl-go");
    if (go) { go.disabled = true; go.textContent = `Sending ${todo.length}…`; }
    const batch = "b" + Math.random().toString(36).slice(2, 12);
    let r;
    try {
      r = await api("/api/decide", { name: f.name, batch, answers: todo.map(x => { const v = held.get(keyOf(x)); return { doc: x.doc, id: x.id, choice: v.key, note: v.note.trim() }; }) });
    } catch (e) {
      todo.forEach(x => errs.set(keyOf(x), "Your results are kept, but could not be sent: " + String(e.message || e) + ". Press Validate to try again."));
      draw(); return;
    }
    const bad = new Map((r.results || []).filter(x => !x.ok).map(x => [x.doc + "#" + x.id, x.error]));
    todo.forEach(x => {
      const k = keyOf(x);
      if (bad.has(k)) { errs.set(k, bad.get(k)); return; }
      errs.delete(k);
      const v = held.get(k);
      sentNow.set(k, { key: v.key, note: v.note.trim() });
      held.delete(k);
    });
    saveDraft();
    featureCache.delete(f.name);
    refreshFeature(f.name); // (features.js: the rail's count and the overview are read again behind this page)
    draw();
    const left = items.filter(isOpen).length;
    const said = r.nudged
      ? el("p", { class: "vl-sent", role: "status" }, `Sent ${todo.length - bad.size}. `, el("a", { href: "#workflows/" + enc(r.nudged.tag) }, r.nudged.name || "The session"),
        left ? ` has been told, and carries on with them; ${left} ${left === 1 ? "check stays" : "checks stay"} open.` : " has been told to carry on with them.")
      : el("p", { class: "vl-sent", role: "status" }, `Sent ${todo.length - bad.size}. No session is open for this feature: `, el("a", { href: featureHref(f.name) }, "start it again"), " and it picks them up.");
    const foot = document.querySelector("#vl-foot");
    if (foot) foot.before(said);
  };

  draw();
}
