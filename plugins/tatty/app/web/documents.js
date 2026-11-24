// Design mode's Documents (#documents, #document/<name>).
// A document is a folder under <root>/documents holding the design document itself
// (<name>.md, written here on notepad.js) and, once reviewed, "<name> - Design
// Review.md", which the toolbox's tt-design-review skill and its design-review.sh
// write (server.py, "documents (design review)"). The page is the notepad on the
// left; on the right, two separate sections: Comments (on selected passages of the
// document, Tatty's own, in <folder>/.tt) and Review (the areas the document may be
// missing, to accept, reword or reject; a model only writes the list, every decision
// after that is a plain script call). Confirming an accepted suggestion adds its
// wording to the document, and the preview then marks what was added.
// Uses app.js's $, el and api, features.js's pageEls, ago, chip, copyable, pickRoot,
// openSidePanel and closeSidePanel, stories.js's pickFile and notepad.js's makeNotepad.
"use strict";

const documentHref = name => "#document/" + encodeURIComponent(name);

const { renderDocuments, renderDocument } = (() => {
  const CONTEXT = 24; // characters of the text either side of a commented passage, to tell repeats apart
  let listBox = null;

  // ----------------------------------------------------------- the list

  async function renderDocuments(box) {
    listBox = box;
    closeSidePanel();
    box.replaceChildren(el("p", { class: "dim pad" }, "Looking for documents…"));
    let d;
    try { d = await api("/api/documents"); } catch (e) { box.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e))); return; }
    if (listBox !== box) return;
    const open = () => openSidePanel("New document", msg => newDocumentForm(d, msg));
    const head = el("div", { class: "home-head" },
      el("div", {}, el("h2", {}, "Documents"),
        el("div", { class: "dim small root-line" }, "Design documents in ", copyable(d.folder))),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "primary", id: "new-document", disabled: !d.isSet, onclick: open }, "New document…"),
        el("button", { type: "button", onclick: () => renderDocuments(box) }, "Refresh")));
    const warn = !d.isSet
      ? el("div", { class: "card toolbox-missing" }, el("strong", {}, "Choose Tatty's root folder first. "),
        "Documents live in its documents folder. ", el("button", { type: "button", onclick: () => pickRoot(d) }, "Choose…"))
      : !d.plugin
        ? el("div", { class: "card toolbox-missing" }, el("strong", {}, "Reviews need the design plugin. "),
          "Writing and commenting work without it; to have a document reviewed, add the Design mode on ", el("a", { href: "#modes" }, "the modes page"), ".")
        : !d.claude ? el("div", { class: "card toolbox-missing" }, "There's no claude command on this machine's PATH, so Tatty can open documents but can't review them. Connect an LLM in the Hub.") : "";
    const cards = d.documents.map(x => el("a", { class: "fcard board-card", href: documentHref(x.name) },
      el("div", { class: "fcard-top" }, el("strong", {}, x.name), x.reviewing ? chip("● Reviewing", "live") : ""),
      el("div", {}, x.open ? chip(`${x.open} to decide`, "now") : "", x.accepted ? chip(`${x.accepted} accepted`, "todo") : "",
        x.added ? chip(`${x.added} added`, "done") : "", x.comments ? chip(`${x.comments} comment${x.comments === 1 ? "" : "s"}`, "todo") : ""),
      el("div", { class: "fcard-foot dim small" }, `updated ${ago(x.updated)}`)));
    box.replaceChildren(warn, head, cards.length ? el("div", { class: "fgrid" }, cards)
      : el("div", { class: "card empty-state" }, el("p", {}, "No documents yet. ", el("strong", {}, "New document…"),
        " starts a blank one, or copies a markdown file in. Write it here, comment on it, and have Tatty look for what it is missing."),
        d.isSet ? el("button", { type: "button", class: "primary", onclick: open }, "New document…") : ""));
  }

  function newDocumentForm(d, msg) {
    const name = el("input", { placeholder: "a name, e.g. Inventory design", "aria-label": "Document name", id: "document-name" });
    const file = el("span", { class: "dim small", id: "document-file" }, "Starting blank.");
    let chosen = "";
    const pick = el("button", { type: "button", onclick: async () => {
      try {
        const p = await pickFile("Choose a markdown document to copy in", chosen);
        if (p) {
          chosen = p;
          file.textContent = p;
          if (!name.value) name.value = p.replace(/^.*[\\/]/, "").replace(/\.md$/i, "");
        }
      } catch (e) { msg.textContent = String(e.message || e); }
    } }, "Copy in a markdown file…");
    const go = el("button", { type: "submit", class: "primary" }, "Create");
    return el("form", { class: "card new-feature", id: "new-document-form", onsubmit: async e => {
      e.preventDefault();
      go.disabled = true;
      try {
        const r = await api("/api/documents/new", { name: name.value, intake: chosen });
        location.hash = documentHref(r.name);
      } catch (err) { msg.textContent = String(err.message || err); go.disabled = false; }
    } },
      el("strong", {}, "New document"),
      el("div", { class: "row" }, name), el("div", { class: "row" }, pick), el("div", {}, file),
      el("div", { class: "row" }, go),
      el("p", { class: "dim small" }, "Made in ", el("code", {}, d.folder + "/<name>"), ". It is a plain markdown file, so Obsidian opens it too."));
  }

  // ----------------------------------------------------------- the text, as the page marks it

  // Where an Added suggestion's wording is in the text now: the whole of it, else (when it has been edited since)
  // its first line, else nowhere.
  function locate(item, text) {
    if (!item.text) return null;
    let i = text.indexOf(item.text);
    if (i >= 0) return { from: i, to: i + item.text.length, whole: true };
    const first = item.text.split("\n").find(l => l.trim());
    i = first ? text.indexOf(first) : -1;
    return i >= 0 ? { from: i, to: i + first.length, whole: false } : null;
  }

  // The preview's text without its white space, and where each character is (a node and an offset into it).
  function flatOf(view) {
    const at = [];
    let flat = "";
    const w = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const s = n.nodeValue;
      for (let i = 0; i < s.length; i++) if (!/\s/.test(s[i])) { flat += s[i]; at.push([n, i]); }
    }
    return { flat, at };
  }
  const squash = s => String(s || "").replace(/\s/g, "");

  // Where a comment's passage is: the flat index of its start, choosing among repeats by the text around it; -1 when gone.
  function whereIs(flat, c) {
    const q = squash(c.quote), before = squash(c.before), after = squash(c.after);
    if (!q) return -1;
    let best = -1, bestScore = -1;
    for (let i = flat.indexOf(q); i >= 0; i = flat.indexOf(q, i + 1)) {
      const score = (before && flat.slice(Math.max(0, i - before.length), i) === before ? 1 : 0)
        + (after && flat.slice(i + q.length, i + q.length + after.length) === after ? 1 : 0);
      if (score > bestScore) { best = i; bestScore = score; }
      if (score === 2) break;
    }
    return best;
  }

  // ----------------------------------------------------------- one document

  async function renderDocument(box, name) {
    listBox = null;
    closeSidePanel();
    box.replaceChildren(el("p", { class: "dim pad" }, "Opening the document…"));
    const url = `/api/document?name=${encodeURIComponent(name)}`;
    let D;
    try { D = await api(url); } catch (e) { box.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e))); return; }
    const me = Math.random().toString(36).slice(2, 10); // this window's id: its own changes aren't news to it
    const S = { D, hideMarks: false, pending: null, drafts: {}, note: "", noteBad: false, anchored: new Set(), drawn: false, queue: Promise.resolve(), fab: null };

    const comments = el("section", { class: "dr-box", id: "dr-comments" });
    const review = el("section", { class: "dr-box", id: "dr-review" });
    const note = el("div", { class: "dr-note small", id: "dr-note", role: "status" });
    document.querySelectorAll("#dr-fab").forEach(n => n.remove());

    const pad = makeNotepad({ id: "docpad", text: D.text, updated: D.updated,
      placeholder: "Write the design document here. Select text to format it; switch to Preview to comment on a passage.",
      save: (text, expected) => api("/api/document", { name, text, expected, client: me }),
      reload: () => api(url),
      marks: text => S.hideMarks ? [] : S.D.review.items.filter(i => i.status === "Added")
        .map(i => { const h = locate(i, text); return h && { from: h.from, to: h.to, id: i.id }; }).filter(Boolean),
      decorate: view => markComments(view) });

    const root = el("div", { class: "docpage" },
      el("div", { class: "dr-main" },
        el("div", { class: "dr-top" }, el("a", { href: "#documents" }, "Documents"), el("span", { class: "dim" }, " / "), el("h2", {}, D.name),
          el("span", { class: "dim small" }, "Select text in Preview to comment on it.")),
        pad.element),
      el("aside", { class: "dr-side" }, note, comments, review));
    box.replaceChildren(root);

    const say = (text, bad) => { S.note = text || ""; S.noteBad = !!bad; paintNote(); };
    function paintNote() {
      note.className = "dr-note small" + (S.noteBad ? " bad" : "");
      note.textContent = S.note;
      note.hidden = !S.note;
    }
    paintNote();

    // ---- comments: marked in the preview
    function markComments(view) {
      S.anchored = new Set();
      S.drawn = true;
      for (const c of S.D.comments) {
        const { flat, at } = flatOf(view);
        const s = whereIs(flat, c);
        if (s < 0) continue;
        const e = s + squash(c.quote).length;
        const segs = new Map(); // node -> [from, to)
        for (let i = s; i < e; i++) {
          const [n, off] = at[i];
          const g = segs.get(n);
          if (g) g[1] = off + 1; else segs.set(n, [off, off + 1]);
        }
        for (const [n, [from, to]] of [...segs].reverse()) {
          const r = document.createRange();
          r.setStart(n, from);
          r.setEnd(n, to);
          r.surroundContents(el("mark", { class: "dr-comment" + (c.resolved ? " done" : ""), "data-cid": c.id }));
        }
        S.anchored.add(c.id);
      }
      paintCommentList(); // the "detached" words depend on what could be found
    }
    pad.view.addEventListener("click", e => {
      const m = e.target.closest && e.target.closest("mark.dr-comment");
      if (m && !getSelection().toString()) focusComment(m.dataset.cid);
    });

    function focusComment(id) {
      const card = comments.querySelector(`.dr-comment-card[data-cid="${id}"]`);
      if (!card) return;
      card.scrollIntoView({ block: "nearest" });
      card.classList.add("flash");
      setTimeout(() => card.classList.remove("flash"), 1600);
    }
    function showComment(c) {
      pad.setMode("view", true);
      const m = pad.view.querySelector(`mark.dr-comment[data-cid="${c.id}"]`);
      if (m) { m.scrollIntoView({ block: "center" }); m.classList.add("flash"); setTimeout(() => m.classList.remove("flash"), 1600); }
    }

    // ---- comments: making one from a selection in the preview
    function selectionInfo() {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      if (!pad.view.contains(r.startContainer) || !pad.view.contains(r.endContainer)) return null;
      const quote = sel.toString().replace(/\s+/g, " ").trim();
      const mine = squash(r.toString());
      if (!quote || !mine) return null;
      const pre = document.createRange();
      pre.selectNodeContents(pad.view);
      pre.setEnd(r.startContainer, r.startOffset);
      const s = squash(pre.toString()).length;
      const { flat } = flatOf(pad.view);
      let heading = "";
      for (const h of pad.view.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
        if (h.compareDocumentPosition(r.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING || h.contains(r.startContainer)) heading = h.textContent.trim();
      }
      return { quote: quote.slice(0, 2000), before: flat.slice(Math.max(0, s - CONTEXT), s), after: flat.slice(s + mine.length, s + mine.length + CONTEXT),
        heading, rect: r.getBoundingClientRect() };
    }
    const fab = el("button", { type: "button", class: "dr-fab", id: "dr-fab", hidden: true,
      onmousedown: e => e.preventDefault(),
      onclick: () => { const i = selectionInfo(); fab.hidden = true; if (i) { S.pending = i; paintCommentList(); const t = comments.querySelector("textarea"); if (t) t.focus(); } } }, "Comment");
    document.body.append(fab);
    S.fab = fab;
    const offer = () => {
      const i = selectionInfo();
      if (!i) { fab.hidden = true; return; }
      fab.hidden = false;
      fab.style.left = Math.max(8, Math.min(window.innerWidth - 90, i.rect.right - 20)) + "px";
      fab.style.top = Math.min(window.innerHeight - 40, i.rect.bottom + 6) + "px";
    };
    pad.view.addEventListener("mouseup", () => setTimeout(offer, 0));
    pad.view.addEventListener("keyup", e => { if (e.key.startsWith("Arrow") || e.key === "Shift") offer(); });
    const onSelection = () => { if (!root.isConnected) return; const sel = getSelection(); if (!sel || sel.isCollapsed) fab.hidden = true; };
    document.addEventListener("selectionchange", onSelection);
    window.addEventListener("hashchange", () => { fab.hidden = true; });

    // ---- comments: the list
    async function commentCall(body) {
      try {
        const r = await api("/api/documents/comments", { name, client: me, ...body });
        S.D.comments = r.comments;
        pad.redraw();
        paintCommentList();
      } catch (e) { say(String(e.message || e), true); }
    }
    function commentCard(c) {
      const detached = S.drawn && !S.anchored.has(c.id);
      const text = el("p", { class: "dr-ctext" }, c.text);
      const card = el("div", { class: "dr-comment-card" + (c.resolved ? " done" : ""), "data-cid": c.id },
        el("blockquote", { class: "dr-quote", title: detached ? "This passage is no longer in the document" : "Show in the document", onclick: () => { if (!detached) showComment(c); } }, c.quote),
        c.heading || detached ? el("div", { class: "dim small" }, c.heading ? `under ${c.heading}` : "", detached ? (c.heading ? " · " : "") + "detached: the passage is gone from the text" : "") : "",
        text,
        el("div", { class: "dr-actions" },
          el("button", { type: "button", onclick: () => commentCall({ action: c.resolved ? "reopen" : "resolve", id: c.id }) }, c.resolved ? "Reopen" : "Resolve"),
          el("button", { type: "button", onclick: () => {
            const ta = el("textarea", { class: "dr-edit", "aria-label": "Comment" });
            ta.value = c.text;
            const save = el("button", { type: "button", class: "primary", onclick: () => commentCall({ action: "edit", id: c.id, text: ta.value }) }, "Save");
            text.replaceWith(el("div", {}, ta, el("div", { class: "dr-actions" }, save, el("button", { type: "button", onclick: paintCommentList }, "Cancel"))));
            ta.focus();
          } }, "Edit"),
          el("button", { type: "button", onclick: () => commentCall({ action: "remove", id: c.id }) }, "Delete")));
      return card;
    }
    function paintCommentList() {
      const open = S.D.comments.filter(c => !c.resolved), done = S.D.comments.filter(c => c.resolved);
      const kids = [el("h3", {}, "Comments", open.length ? el("span", { class: "dr-count" }, String(open.length)) : "")];
      if (S.pending) {
        const ta = el("textarea", { class: "dr-edit", id: "dr-new-comment", placeholder: "Your comment on this passage…", "aria-label": "New comment" });
        const save = el("button", { type: "button", class: "primary", id: "dr-save-comment", onclick: async () => {
          if (!ta.value.trim()) return;
          const p = S.pending;
          S.pending = null;
          await commentCall({ action: "add", quote: p.quote, before: p.before, after: p.after, heading: p.heading, text: ta.value });
        } }, "Add comment");
        kids.push(el("div", { class: "dr-comment-card new" }, el("blockquote", { class: "dr-quote" }, S.pending.quote),
          ta, el("div", { class: "dr-actions" }, save, el("button", { type: "button", onclick: () => { S.pending = null; paintCommentList(); } }, "Cancel"))));
      }
      if (!open.length && !S.pending) kids.push(el("p", { class: "dim small" }, "None yet. In Preview, select a passage and press Comment."));
      kids.push(...open.map(commentCard));
      if (done.length) kids.push(el("details", { class: "dr-resolved" }, el("summary", {}, `Resolved (${done.length})`), ...done.map(commentCard)));
      comments.replaceChildren(...kids);
    }

    // ---- the review
    const ORDER = ["Open", "Accepted", "Added", "Rejected"];
    const GROUPS = { Open: "To decide", Accepted: "Accepted: reword, then confirm", Added: "Added to the document", Rejected: "Rejected" };
    const headings = () => {
      const out = [];
      let fence = false;
      for (const l of pad.getText().split("\n")) {
        if (/^(```|~~~)/.test(l)) { fence = !fence; continue; }
        const m = !fence && l.match(/^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/);
        if (m && m[2]) out.push({ level: m[1].length, text: m[2] });
      }
      return out;
    };
    const itemById = id => S.D.review.items.find(i => i.id === id);

    // one call at a time, in order: a reword can be on its way when Confirm is pressed. `body` is a function
    // of the suggestion's hash as it is when the call's turn comes (the calls before it have changed it).
    function call(id, body) {
      const run = S.queue.then(async () => {
        const it = itemById(id);
        const r = await api("/api/documents/review", { name, client: me, id, hash: it && it.hash, ...body });
        if (r.document) { S.D = r.document; }
        return r;
      });
      S.queue = run.catch(() => {});
      return run;
    }
    async function decide(id, action, extra) {
      try {
        await call(id, { action, ...extra });
        delete S.drafts[id];
        say("");
      } catch (e) { stale(e); }
      paintReview();
    }
    function stale(e) {
      if (e.data && e.data.document) S.D = e.data.document;
      say(String(e.message || e), true);
    }
    const draftOf = it => S.drafts[it.id] || (S.drafts[it.id] = { text: it.wording, where: it.where, dirty: false, timer: 0 });
    async function saveDraft(it) {
      const dr = S.drafts[it.id];
      if (!dr || !dr.dirty) return;
      clearTimeout(dr.timer);
      dr.dirty = false;
      try {
        await call(it.id, { action: "wording", text: dr.text, where: dr.where });
        const now = itemById(it.id);
        if (now && !dr.dirty) { dr.text = now.wording; dr.where = now.where; }
        dr.status = "Saved";
      } catch (e) { dr.dirty = true; stale(e); paintReview(); return; }
      const stamp = review.querySelector(`.dr-card[data-id="${it.id}"] .dr-saved`);
      if (stamp) stamp.textContent = dr.dirty ? "Editing…" : "Saved";
    }
    async function confirmAdd(it) {
      const dr = S.drafts[it.id];
      if (dr && dr.dirty) await saveDraft(it);
      await pad.flush();
      let cur;
      try { cur = await api(url); } catch (e) { say(String(e.message || e), true); return; }
      if (pad.getText() !== cur.text) { say("The document has changes that aren't saved yet, or it changed elsewhere. Wait for it to say Saved, then confirm again.", true); return; }
      try {
        const r = await call(it.id, { action: "confirm", expected: cur.updated });
        delete S.drafts[it.id];
        await pad.refresh();
        pad.setMode("view", true);
        pad.redraw();
        say(`Added to the document ${r.said.replace(/^under: /, "under ").replace(/^new section: /, "as a new section: ")}.`);
        const m = pad.view.querySelector(`.np-mark[data-mark="${it.id}"]`);
        if (m) m.scrollIntoView({ block: "center" });
      } catch (e) { stale(e); }
      paintReview();
      paintCommentList();
    }
    async function startReview() {
      await pad.flush();
      try {
        const r = await api("/api/documents/review", { name, action: "run", client: me });
        S.D.run = r.run;
        say("");
      } catch (e) { say(String(e.message || e), true); }
      paintReview();
    }

    function card(it) {
      const dr = it.status === "Accepted" ? draftOf(it) : null;
      const goes = it.where === "end" ? "a new section at the end" : `under ${it.where}`;
      const kids = [el("div", { class: "dr-card-top" }, el("span", { class: "dim small" }, it.id), el("strong", {}, it.area),
        it.edited ? chip("edited", "todo") : ""),
      el("div", { class: "dim small" }, `Goes ${goes}`), el("p", { class: "dr-why" }, it.why)];
      if (it.status === "Open") {
        kids.push(el("details", { class: "dr-peek" }, el("summary", {}, "Suggested wording"), el("pre", { class: "dr-wording" }, it.wording)),
          el("div", { class: "dr-actions" },
            el("button", { type: "button", class: "primary", "data-act": "accept", onclick: () => decide(it.id, "accept") }, "Accept"),
            el("button", { type: "button", "data-act": "reject", onclick: () => decide(it.id, "reject") }, "Reject")));
      } else if (it.status === "Accepted") {
        const ta = el("textarea", { class: "dr-edit dr-wording-edit", "aria-label": `Wording for ${it.area}` });
        ta.value = dr.text;
        ta.addEventListener("input", () => {
          dr.text = ta.value; dr.dirty = true;
          const stamp = review.querySelector(`.dr-card[data-id="${it.id}"] .dr-saved`);
          if (stamp) stamp.textContent = "Editing…";
          clearTimeout(dr.timer);
          dr.timer = setTimeout(() => saveDraft(it), 800);
        });
        const where = el("select", { class: "dr-where", "aria-label": "Where it goes" },
          el("option", { value: "end" }, "A new section at the end"),
          ...headings().filter(h => h.level >= 2).map(h => el("option", { value: h.text }, "  ".repeat(h.level - 2) + h.text)));
        if (dr.where !== "end" && ![...where.options].some(o => o.value === dr.where)) where.append(el("option", { value: dr.where }, `${dr.where} (not in the document: a new section)`));
        where.value = dr.where;
        where.addEventListener("change", () => { dr.where = where.value; dr.dirty = true; saveDraft(it); });
        kids.push(el("label", { class: "dr-field" }, el("span", { class: "dim small" }, "Where it goes"), where),
          el("label", { class: "dr-field" }, el("span", { class: "dim small" }, "Wording: edit it before it goes in"), ta),
          el("div", { class: "dr-actions" },
            el("button", { type: "button", class: "primary", "data-act": "confirm", onclick: () => confirmAdd(it) }, "Confirm: add to the document"),
            el("button", { type: "button", "data-act": "reopen", onclick: () => decide(it.id, "reopen") }, "Not yet"),
            el("button", { type: "button", "data-act": "reject", onclick: () => decide(it.id, "reject") }, "Reject"),
            el("span", { class: "dim small dr-saved" }, dr.dirty ? "Editing…" : dr.status || "")));
      } else if (it.status === "Added") {
        const where = locate(it, pad.getText());
        kids.push(el("p", { class: "dim small" }, `Added ${it.under.startsWith("(new section)") ? "as a new section" : "under " + it.under}`,
          where && where.whole ? "" : " · the text has been changed since, so it is not marked in full"),
        el("div", { class: "dr-actions" }, where ? el("button", { type: "button", onclick: () => {
          pad.setMode("view", true);
          const m = pad.view.querySelector(`.np-mark[data-mark="${it.id}"]`);
          if (m) m.scrollIntoView({ block: "center" });
        } }, "Show in the document") : ""));
      } else {
        kids.push(it.reason ? el("p", { class: "dim small" }, `Reason: ${it.reason}`) : "",
          el("div", { class: "dr-actions" }, el("button", { type: "button", "data-act": "reopen", onclick: () => decide(it.id, "reopen") }, "Reopen")));
      }
      return el("div", { class: "dr-card " + it.status.toLowerCase(), "data-id": it.id }, kids);
    }

    function paintReview() {
      const R = S.D.review, run = S.D.run;
      const hadFocus = document.activeElement && review.contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA"
        ? { id: document.activeElement.closest(".dr-card").dataset.id, at: document.activeElement.selectionStart } : null;
      const items = R.items;
      const kids = [el("h3", {}, "Review", items.filter(i => i.status === "Open").length ? el("span", { class: "dr-count" }, String(items.filter(i => i.status === "Open").length)) : "")];
      if (!S.D.plugin) kids.push(el("p", { class: "dr-warn small" }, S.D.missing));
      else if (!S.D.claude) kids.push(el("p", { class: "dr-warn small" }, "There's no claude command on this machine's PATH, so Tatty can't review. Connect an LLM in the Hub."));
      if (R.problems.length) kids.push(el("div", { class: "dr-warn small" }, el("strong", {}, "The review was edited by hand out of its layout. "), R.problems.join("; "),
        " Fix it in a text editor (design-review.sh check lists the problems), or delete it to start again."));
      else if (R.error && S.D.plugin) kids.push(el("p", { class: "dr-warn small" }, R.error));
      if (run) {
        kids.push(el("div", { class: "dr-run", id: "dr-run-strip" }, el("span", { class: "dr-pulse" }, "●"), ` ${run.step}…`, el("span", { class: "spacer" }),
          el("button", { type: "button", id: "dr-stop", onclick: async () => { try { await api("/api/documents/review", { name, action: "cancel" }); } catch (e) { say(String(e.message || e), true); } } }, "Stop")));
      } else {
        kids.push(el("div", { class: "dr-actions" }, el("button", { type: "button", class: items.length ? "" : "primary", id: "dr-run", disabled: !S.D.plugin || !S.D.claude,
          title: "A model reads the document and lists areas it may be missing; it costs a little", onclick: startReview },
        items.length ? "Review again" : "Review this document")));
      }
      if (items.some(i => i.status === "Added")) {
        const box = el("input", { type: "checkbox", id: "dr-show-marks" });
        box.checked = !S.hideMarks;
        box.addEventListener("change", () => { S.hideMarks = !box.checked; pad.redraw(); });
        kids.push(el("label", { class: "dr-toggle small" }, box, " Mark what was added in the preview"));
      }
      if (!items.length && S.D.plugin && !run && !R.problems.length) {
        kids.push(el("p", { class: "dim small" }, "No review yet. It lists areas the document may be missing (who it is for, failure cases, data, platform limits, rollout, open questions…), each with wording you can edit before it goes in."));
      }
      for (const st of ORDER) {
        const some = items.filter(i => i.status === st);
        if (!some.length) continue;
        const cards = some.map(card);
        kids.push(st === "Rejected"
          ? el("details", { class: "dr-group" }, el("summary", {}, `${GROUPS[st]} (${some.length})`), ...cards)
          : el("div", { class: "dr-group" }, el("h4", {}, `${GROUPS[st]} (${some.length})`), ...cards));
      }
      review.replaceChildren(...kids);
      if (hadFocus) {
        const t = review.querySelector(`.dr-card[data-id="${hadFocus.id}"] textarea`);
        if (t) { t.focus(); t.setSelectionRange(hadFocus.at, hadFocus.at); }
      }
    }

    async function refetch() {
      try {
        const cur = await api(url);
        S.D.comments = cur.comments; S.D.review = cur.review; S.D.run = cur.run; S.D.plugin = cur.plugin; S.D.missing = cur.missing; S.D.claude = cur.claude;
      } catch { return; }
      pad.redraw();
      paintCommentList();
      paintReview();
    }

    // ---- events from the server: another window's changes, a review's progress, a hand edit
    const onEvent = e => {
      if (!root.isConnected) { document.removeEventListener("tt-event", onEvent); document.removeEventListener("selectionchange", onSelection); fab.remove(); return; }
      const ev = e.detail;
      if (ev.name !== name) return;
      if (ev.type === "docreview") {
        if (ev.done) {
          S.D.run = null;
          const cost = ev.cost ? ` ($${ev.cost.toFixed(2)})` : "";
          say(ev.ok ? (ev.added.length ? `Added ${ev.added.length} suggestion${ev.added.length === 1 ? "" : "s"}${cost}.` : `${ev.note}${cost}`) : ev.error, !ev.ok);
          refetch();
        } else { S.D.run = ev.run; paintReview(); }
      } else if (ev.type === "document" && ev.client !== me) {
        if (ev.what === "text" || ev.what === "disk") pad.refresh();
        if (ev.what !== "text") refetch(); else { pad.redraw(); refetch(); }
      }
    };
    document.addEventListener("tt-event", onEvent);

    paintCommentList();
    paintReview();
    pad.focus();
  }

  document.addEventListener("tt-event", e => {
    const ev = e.detail;
    if (ev && ev.type === "document" && ev.what === "list" && listBox && listBox.classList.contains("on")) renderDocuments(listBox);
  });

  return { renderDocuments, renderDocument };
})();
