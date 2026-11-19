// The blank whiteboards (#whiteboards, #whiteboard/<name>): a board with no
// document behind it, for whatever is being planned: text fields, comments and
// the lines between them, on whiteboard.js. Each is one file of Tatty's own,
// <home>/whiteboards/<name>.json (server.py, "whiteboards").
// Uses app.js's el and api, features.js's ago, chip and copyable, and
// whiteboard.js's makeWhiteboard.
"use strict";

const whiteboardHref = name => "#whiteboard/" + encodeURIComponent(name);

const { renderWhiteboards, renderWhiteboard } = (() => {
  let listBox = null; // the list, while it is on screen

  async function renderWhiteboards(box) {
    listBox = box;
    box.replaceChildren(el("p", { class: "dim pad" }, "Looking for whiteboards…"));
    let d;
    try { d = await api("/api/whiteboards"); } catch (e) { box.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e))); return; }
    const msg = el("p", { class: "home-note small", id: "wb-msg" });
    const name = el("input", { placeholder: "a name, e.g. Q3 roadmap", "aria-label": "Whiteboard name", id: "wb-name" });
    const form = el("form", { class: "card new-feature", id: "new-wb-form", onsubmit: async e => {
      e.preventDefault();
      try {
        const r = await api("/api/whiteboards/new", { name: name.value });
        location.hash = whiteboardHref(r.name);
      } catch (err) { msg.textContent = String(err.message || err); }
    } }, el("strong", {}, "New whiteboard"),
    el("div", { class: "row" }, name, el("button", { type: "submit", class: "primary", id: "wb-create" }, "Create")));
    form.hidden = true;
    const head = el("div", { class: "home-head" },
      el("div", {}, el("h2", {}, "Whiteboards"),
        el("div", { class: "dim small root-line" }, "Kept in ", copyable(d.folder))),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "primary", id: "new-wb", onclick: () => { form.hidden = !form.hidden; if (!form.hidden) name.focus(); } }, "New whiteboard"),
        el("button", { type: "button", onclick: () => renderWhiteboards(box) }, "Refresh")));
    const cards = d.boards.map(x => {
      const foot = el("div", { class: "fcard-foot dim small" });
      const plain = () => foot.replaceChildren(`updated ${ago(x.updated)} · `,
        el("button", { type: "button", class: "linkish", title: `Delete ${x.name}`, onclick: e => {
          e.preventDefault();
          e.stopPropagation();
          foot.replaceChildren(`Delete ${x.name}? `,
            el("button", { type: "button", class: "primary", onclick: async ev => {
              ev.preventDefault();
              ev.stopPropagation();
              try { await api("/api/whiteboards/delete", { name: x.name }); renderWhiteboards(box); } catch (err) { msg.textContent = String(err.message || err); }
            } }, "Delete"),
            el("button", { type: "button", onclick: ev => { ev.preventDefault(); ev.stopPropagation(); plain(); } }, "Keep"));
        } }, "Delete"));
      plain();
      return el("a", { class: "fcard board-card wb-card", href: whiteboardHref(x.name), "data-name": x.name },
        el("div", { class: "fcard-top" }, el("strong", {}, x.name)),
        el("div", {}, chip(`${x.items} thing${x.items === 1 ? "" : "s"}`, x.items ? "done" : "todo"),
          x.lines ? el("span", { class: "dim small" }, ` · ${x.lines} line${x.lines === 1 ? "" : "s"}`) : ""),
        foot);
    });
    box.replaceChildren(head, msg, form, cards.length ? el("div", { class: "fgrid" }, cards)
      : el("div", { class: "card empty-state" }, el("p", {}, "No whiteboards yet. ", el("strong", {}, "New whiteboard"),
        " gives you an empty board to plan on: text, comments, and lines between them.")));
  }

  async function renderWhiteboard(box, name) {
    listBox = null;
    box.replaceChildren(el("p", { class: "dim pad" }, "Opening the whiteboard…"));
    let d;
    try { d = await api(`/api/whiteboard?kind=blank&ref=${encodeURIComponent(name)}`); } catch (e) {
      box.replaceChildren(el("p", { class: "st missing pad" }, String(e.message || e), " ", el("a", { href: "#whiteboards" }, "All whiteboards")));
      return;
    }
    const note = el("p", { class: "small st missing wb-note" });
    const wb = makeWhiteboard({ id: "wboard", key: { kind: "blank", ref: name }, data: d, onError: t => { note.textContent = t; },
      empty: "An empty whiteboard. Pick T and click to write (or double-click anywhere), 💬 for a comment, ↗ to join two things. Drag with the middle button to move around." });
    box.replaceChildren(el("div", { class: "board-page" },
      el("div", { class: "board-bar" }, el("a", { href: "#whiteboards", class: "small" }, "← All whiteboards"), el("h2", {}, name)),
      note, wb.element));
  }

  // Boards made or deleted in another window.
  document.addEventListener("tt-event", e => {
    if (e.detail.type === "whiteboard" && e.detail.list && listBox && listBox.classList.contains("on")) renderWhiteboards(listBox);
  });

  return { renderWhiteboards, renderWhiteboard };
})();
