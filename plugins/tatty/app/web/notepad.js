"use strict";
/* The notepad: a markdown text area with a formatting bar that floats at the
 * caret or selection, and a preview with clickable checkboxes. It knows nothing
 * about features or URLs: the host page says where the text comes from and
 * where it goes, the way makeWhiteboard and makeTaskBoard are hosted.
 *
 *   const pad = makeNotepad({
 *     id: "fnote",                     // DOM id of the pad; its parts are <id>-edit, -view, -bar
 *     text, updated,                   // what the host loaded; updated is a version stamp (0: none yet)
 *     save(text, expected) -> {updated}   // rejects with an Error whose .status is 409 when the
 *                                         // stored text changed since `expected` (a conflict)
 *     reload() -> {text, updated}      // the stored text, read again
 *     onError(err),                    // optional: told of a save that failed
 *     mode: "edit" | "view",           // optional: else the last one used (localStorage tt-notepad-mode)
 *     placeholder, readOnly,           // optional
 *     actions: [...],                  // optional: a subset of NP_ACTIONS to show in the bar
 *   });
 *   pad.element    the node to mount          pad.focus()        put the caret in the pad
 *   pad.getText()  what is written now        pad.flush()        save now (a promise)
 *   pad.refresh()  read it again, if the pad has nothing unsaved
 *   pad.setMode("edit"|"view")                pad.destroy()      drop the page-level listeners
 * Page-level listeners (window focus, hashchange, tab hidden) remove themselves
 * once the pad's node has left the page, so a host that just replaces it is fine.
 *
 * The text is markdown, with two inline HTML forms for what markdown can't say
 * (both are written the way Obsidian also draws them):
 *   <span style="font-size:18px">text</span>     sizes 12, 14 (normal), 18, 24, 32
 *   <div align="center">  ...blank line, paragraphs, blank line...  </div>   left | center | right
 * and ~~strike~~ and "- [ ]" / "- [x]" checkboxes. Everything else is shown as
 * text: the preview turns back only those forms (notepadRender), into classes in
 * notepad.css (the page's CSP forbids style attributes). Not shown: nested lists,
 * horizontal rules. Saving is automatic, a moment after the last keystroke.
 *
 * Needs app.js: el, markdown, inline, codeActions (optional). */

const NP_SIZES = [["Small", 12], ["Normal", 14], ["Large", 18], ["Larger", 24], ["Huge", 32]];
const NP_SPAN_OPEN = /<span style="font-size:\d+px">/;
const NP_SPAN_ANY = /<span style="font-size:\d+px">|<\/span>/g;
const NP_ACTIONS = ["bold", "italic", "strike", "code", "heading", "size", "left", "center", "right", "bullet", "numbered", "checkbox", "quote"];

/* ---------------------------------------------------------------- edits
 * Each one takes the text and the selection (a, b) and returns the new text and
 * selection {t, a, b}: no DOM, so they can be tried on plain strings. */
const NotepadOps = (() => {
  const isWord = c => /[\p{L}\p{N}_'-]/u.test(c);
  // a caret with no selection means the word it is in (or nothing, between words)
  const wordAt = (t, a, b) => {
    if (a !== b) return [a, b];
    let s = a, e = b;
    while (s > 0 && isWord(t[s - 1])) s--;
    while (e < t.length && isWord(t[e])) e++;
    return [s, e];
  };

  // Put open/close around the selection, or take them off when they are already there.
  // `solo`: a single * must not count the two of **bold**.
  function wrap(t, a, b, open, close = open, solo = false) {
    [a, b] = wordAt(t, a, b);
    const before = t.slice(0, a), inside = t.slice(a, b), after = t.slice(b);
    const outside = before.endsWith(open) && after.startsWith(close) &&
      !(solo && (before.slice(-open.length - 1, -open.length) === open[0] || after.charAt(close.length) === close[0]));
    if (outside) return { t: before.slice(0, before.length - open.length) + inside + after.slice(close.length), a: a - open.length, b: b - open.length };
    const within = inside.length >= open.length + close.length && inside.startsWith(open) && inside.endsWith(close) &&
      !(solo && (inside.charAt(open.length) === open[0] || inside.charAt(inside.length - close.length - 1) === close[0]));
    if (within) {
      const core = inside.slice(open.length, inside.length - close.length);
      return { t: before + core + after, a, b: a + core.length };
    }
    return { t: before + open + inside + close + after, a: a + open.length, b: b + open.length };
  }

  // [start of the first line, end of the last line] the selection touches
  function lineSpan(t, a, b) {
    const ls = a === 0 ? 0 : t.lastIndexOf("\n", a - 1) + 1;
    const end = b > a && t[b - 1] === "\n" ? b - 1 : b; // a selection that ends at a line's start leaves that line out
    let le = t.indexOf("\n", end);
    if (le < 0) le = t.length;
    return [ls, le];
  }

  function mapLines(t, a, b, fn) {
    const [ls, le] = lineSpan(t, a, b);
    const old = t.slice(ls, le).split("\n");
    const out = fn(old, old.length === 1);
    const body = out.join("\n");
    const res = t.slice(0, ls) + body + t.slice(le);
    if (a === b) {
      const c = Math.max(ls, a + out[0].length - old[0].length); // the caret stays on its text
      return { t: res, a: c, b: c };
    }
    return { t: res, a: ls, b: ls + body.length };
  }

  const LIST = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d+\. )/;
  // A list kind on every line it touches; when they all have it already, take it off.
  function toggleList(t, a, b, has, make) {
    return mapLines(t, a, b, (lines, single) => {
      const todo = lines.filter(l => single || l.trim());
      const on = todo.length > 0 && todo.every(l => has.test(l));
      let n = 0;
      return lines.map(l => {
        if (!single && !l.trim()) return l;
        const bare = l.replace(LIST, "$1");
        return on ? bare : make(bare, ++n);
      });
    });
  }
  const indented = (bare, mark) => bare.replace(/^(\s*)/, (_, sp) => sp + mark);

  function heading(t, a, b) {
    return mapLines(t, a, b, (lines, single) => {
      const first = lines.find(l => single || l.trim()) || "";
      const cur = (first.match(/^(#{1,6})\s/) || ["", ""])[1].length;
      const next = cur >= 3 ? 0 : cur + 1; // none, H1, H2, H3, none
      return lines.map(l => (!single && !l.trim()) ? l : (next ? "#".repeat(next) + " " : "") + l.replace(/^#{1,6}\s+/, ""));
    });
  }

  function quote(t, a, b) {
    return mapLines(t, a, b, (lines, single) => {
      const todo = lines.filter(l => single || l.trim());
      const on = todo.length > 0 && todo.every(l => /^>/.test(l));
      return lines.map(l => (!single && !l.trim()) ? l : on ? l.replace(/^> ?/, "") : "> " + l);
    });
  }

  function size(t, a, b, px) {
    [a, b] = wordAt(t, a, b);
    let before = t.slice(0, a), inside = t.slice(a, b), after = t.slice(b);
    const m = before.match(new RegExp(NP_SPAN_OPEN.source + "$"));
    if (m && after.startsWith("</span>")) { before = before.slice(0, -m[0].length); after = after.slice("</span>".length); }
    inside = inside.replace(NP_SPAN_ANY, "");
    if (px === 14) return { t: before + inside + after, a: before.length, b: before.length + inside.length };
    const open = `<span style="font-size:${px}px">`;
    return { t: before + open + inside + "</span>" + after, a: before.length + open.length, b: before.length + open.length + inside.length };
  }

  const ALIGN = /<div align="(left|center|right)">\n\n([\s\S]*?)\n\n<\/div>/g;
  // Align the paragraph(s) the selection is in: a wrapper around them, which "left" takes away.
  function align(t, a, b, to) {
    for (const m of t.matchAll(ALIGN)) {
      const s = m.index, e = s + m[0].length;
      if (a < s || a > e) continue;
      if (to === "left") return { t: t.slice(0, s) + m[2] + t.slice(e), a: s, b: s + m[2].length };
      const open = `<div align="${to}">\n\n`;
      return { t: t.slice(0, s) + open + m[2] + "\n\n</div>" + t.slice(e), a: s + open.length, b: s + open.length + m[2].length };
    }
    if (to === "left") return { t, a, b };
    const L = [];
    let pos = 0;
    for (const s of t.split("\n")) { L.push([pos, pos + s.length, s]); pos += s.length + 1; }
    const at = off => { let i = 0; while (i + 1 < L.length && L[i + 1][0] <= off) i++; return i; };
    const blank = k => !L[k][2].trim();
    let i = at(a), j = at(b > a && t[b - 1] === "\n" ? b - 1 : b);
    let ps, pe;
    if (i === j && blank(i)) {
      ps = pe = L[i][0]; // a caret on an empty line: an empty block to type into
    } else {
      while (i < j && blank(i)) i++;
      while (j > i && blank(j)) j--;
      while (i > 0 && !blank(i - 1)) i--;
      while (j + 1 < L.length && !blank(j + 1)) j++;
      ps = L[i][0]; pe = L[j][1];
    }
    const open = `<div align="${to}">\n\n`;
    const inner = t.slice(ps, pe);
    return { t: t.slice(0, ps) + open + inner + "\n\n</div>" + t.slice(pe), a: ps + open.length, b: ps + open.length + inner.length };
  }

  // Enter at the end of a list, checkbox or quote line starts the next one; on an empty one it ends the list.
  function enter(t, a, b) {
    if (a !== b) return null;
    const ls = a === 0 ? 0 : t.lastIndexOf("\n", a - 1) + 1;
    let le = t.indexOf("\n", a);
    if (le < 0) le = t.length;
    if (le !== a) return null;
    const m = t.slice(ls, le).match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)\. |> )(.*)$/);
    if (!m) return null;
    if (!m[4].trim()) return { t: t.slice(0, ls) + t.slice(le), a: ls, b: ls };
    const mark = m[3] ? `${+m[3] + 1}. ` : m[2].replace(/\[[ xX]\]/, "[ ]");
    const add = "\n" + m[1] + mark;
    return { t: t.slice(0, a) + add + t.slice(a), a: a + add.length, b: a + add.length };
  }

  // The text with the checkbox on line n (0-based) turned over, or null when that line has none.
  function toggleTask(t, n) {
    const L = t.split("\n");
    const m = n >= 0 && n < L.length && L[n].match(/^(\s*[-*+] \[)([ xX])(\].*)$/);
    if (!m) return null;
    L[n] = m[1] + (m[2] === " " ? "x" : " ") + m[3];
    return L.join("\n");
  }

  return {
    bold: (t, a, b) => wrap(t, a, b, "**"),
    italic: (t, a, b) => wrap(t, a, b, "*", "*", true),
    strike: (t, a, b) => wrap(t, a, b, "~~"),
    code: (t, a, b) => wrap(t, a, b, "`"),
    heading,
    quote,
    bullet: (t, a, b) => toggleList(t, a, b, /^\s*[-*+] (?!\[[ xX]\] )/, bare => indented(bare, "- ")),
    numbered: (t, a, b) => toggleList(t, a, b, /^\s*\d+\. /, (bare, n) => indented(bare, `${n}. `)),
    checkbox: (t, a, b) => toggleList(t, a, b, /^\s*[-*+] \[[ xX]\] /, bare => indented(bare, "- [ ] ")),
    size,
    align,
    enter,
    toggleTask,
  };
})();

/* ---------------------------------------------------------------- preview */

// The escaped forms the preview gives back as tags; nothing else is.
const NP_SPAN = /&lt;span style=&quot;font-size:(12|14|18|24|32)px&quot;&gt;|&lt;\/span&gt;/g;

// markdown()'s output with the allowed forms (sizes, ~~strike~~, line breaks) turned into tags. Code stays as written.
function npAllow(html) {
  let depth = 0;
  const out = html.split(/(<pre[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>)/).map((part, i) => {
    if (i % 2) return part.replace(/\u0001/g, " ");
    part = part.replace(NP_SPAN, (m, px) => px ? (depth++, `<span class="np-s${px}">`) : depth > 0 ? (depth--, "</span>") : "");
    return part.replace(/~~([^~\n]+)~~/g, "<s>$1</s>").replace(/\u0001 ?/g, "<br>");
  }).join("");
  return out + "</span>".repeat(depth);
}

const NP_BLOCKY = /^(\s*([-*+]|\d+\.)\s|>|#{1,6}\s|```|\s*\|)/;

// One stretch of source drawn: checkbox lines here (markdown() has no task lists), the rest through markdown().
// `off` is the stretch's first line number in the whole text, which a checkbox carries (data-line).
function npBlocks(text, off) {
  const lines = text.split("\n");
  let out = "", buf = [], tasks = [], fence = false;
  const rest = () => { if (buf.length) out += npAllow(markdown(buf.join("\n"))); buf = []; };
  const boxes = () => { if (tasks.length) out += `<ul class="np-tasks">${tasks.join("")}</ul>`; tasks = []; };
  lines.forEach((l, i) => {
    if (/^```/.test(l)) fence = !fence;
    const m = !fence && l.match(/^\s*[-*+] \[([ xX])\](?: (.*))?$/);
    if (m) {
      rest();
      const done = m[1] !== " ";
      tasks.push(`<li class="np-task${done ? " done" : ""}"><input type="checkbox" data-line="${off + i}"${done ? " checked" : ""}> <span>${npAllow(inline(m[2] || ""))}</span></li>`);
      return;
    }
    boxes();
    // a line break inside a paragraph is kept (markdown() would join the lines)
    const next = lines[i + 1];
    const soft = !fence && l.trim() && !NP_BLOCKY.test(l) && next !== undefined && next.trim() && !NP_BLOCKY.test(next) && !/^```/.test(next);
    buf.push(soft ? l + "\u0001" : l);
  });
  rest();
  boxes();
  return out;
}

// The notepad's text as HTML (to set as the innerHTML of a .md node).
function notepadRender(src) {
  src = String(src || "").replace(/\r/g, "").replace(/^\uFEFF/, "").replace(/\u0001/g, "");
  const lineOf = i => src.slice(0, i).split("\n").length - 1;
  let html = "", at = 0;
  const seg = (from, to) => { if (to > from) html += npBlocks(src.slice(from, to), lineOf(from)); };
  for (const m of src.matchAll(/^<div align="(left|center|right)">[ \t]*\n([\s\S]*?)\n<\/div>[ \t]*$/gm)) {
    seg(at, m.index);
    html += `<div class="np-align np-${m[1]}">${npBlocks(m[2], lineOf(m.index + m[0].indexOf("\n") + 1))}</div>`;
    at = m.index + m[0].length;
  }
  seg(at, src.length);
  return html;
}

/* ---------------------------------------------------------------- the pad */

function makeNotepad(o) {
  const id = o.id || "np";
  const ro = !!o.readOnly;
  const want = new Set(o.actions || NP_ACTIONS);
  let base = o.text || "", updated = o.updated || 0;
  let mode = ro ? "view" : (o.mode || npModeGet());
  let timer = 0, saving = null, again = false, conflict = false, failed = false, gone = false, queued = 0;

  const ta = el("textarea", { class: "np-edit", id: `${id}-edit`, spellcheck: "true", "aria-label": "Notepad",
    placeholder: o.placeholder || "Notes for this feature. Select text to format it." });
  ta.value = base;
  ta.readOnly = ro;
  const view = el("div", { class: "np-view md", id: `${id}-view`, hidden: true });
  const bar = el("div", { class: "np-bar", id: `${id}-bar`, role: "toolbar", "aria-label": "Formatting", hidden: true });
  const menu = el("div", { class: "np-menu", id: `${id}-menu`, hidden: true });
  const mirror = el("div", { class: "np-mirror", "aria-hidden": "true" });
  const status = el("span", { class: "np-status small dim", role: "status" });
  const fix = el("span", { class: "np-fix" });
  const tabs = {};

  /* ---- saving */
  const setStatus = (s, bad) => { status.textContent = s; status.className = "np-status small " + (bad ? "st missing" : "dim"); };
  const schedule = ms => { clearTimeout(timer); timer = setTimeout(flush, ms); };
  function changed() {
    if (ro) return;
    failed = false;
    if (conflict) return;
    setStatus(ta.value === base ? "Saved" : "Unsaved changes…");
    schedule(800);
  }
  function flush() {
    clearTimeout(timer);
    if (ro || conflict || gone) return Promise.resolve();
    if (saving) { again = true; return saving; }
    if (ta.value === base) return Promise.resolve();
    const sent = ta.value;
    setStatus("Saving…");
    saving = Promise.resolve().then(() => o.save(sent, updated)).then(r => {
      base = sent;
      updated = r.updated;
      failed = false;
      setStatus(ta.value === base ? "Saved" : "Unsaved changes…");
    }, e => {
      if (e && e.status === 409) return showConflict();
      failed = true;
      setStatus(`Couldn't save: ${(e && e.message) || e}. Trying again…`, true);
      if (o.onError) o.onError(e);
      schedule(5000);
    }).finally(() => {
      saving = null;
      if (again) { again = false; flush(); } else if (ta.value !== base && !conflict && !failed) schedule(800);
    });
    return saving;
  }
  function adopt(cur) {
    base = cur.text || "";
    updated = cur.updated || 0;
    ta.value = base;
    setStatus("");
    if (mode === "view") drawView();
  }
  function showConflict() {
    conflict = true;
    clearTimeout(timer);
    setStatus("This notepad changed on disk since you opened it.", true);
    const take = async f => { try { f(await o.reload()); } catch (e) { setStatus(`Couldn't read it: ${(e && e.message) || e}`, true); } };
    fix.replaceChildren(
      el("button", { type: "button", onclick: () => take(cur => { updated = cur.updated || 0; conflict = false; fix.replaceChildren(); flush(); }) }, "Overwrite with mine"),
      el("button", { type: "button", onclick: () => take(cur => { conflict = false; fix.replaceChildren(); adopt(cur); }) }, "Load the disk version"));
  }
  async function refresh() {
    if (gone || saving || conflict || ta.value !== base) return;
    try {
      const cur = await o.reload();
      if (!gone && !saving && ta.value === base && (cur.updated || 0) !== updated) adopt(cur);
    } catch { /* offline: keep what is shown */ }
  }

  /* ---- editing */
  // Make the edit as typing would, so Ctrl+Z undoes it: replace only the part that changed.
  function replace(r) {
    const old = ta.value;
    let s = 0, e1 = old.length, e2 = r.t.length;
    const max = Math.min(e1, e2);
    while (s < max && old[s] === r.t[s]) s++;
    while (e1 > s && e2 > s && old[e1 - 1] === r.t[e2 - 1]) { e1--; e2--; }
    ta.focus();
    if (e1 > s || e2 > s) {
      ta.setSelectionRange(s, e1);
      const put = r.t.slice(s, e2);
      const done = put ? document.execCommand("insertText", false, put) : document.execCommand("delete");
      if (!done) { ta.setRangeText(put, s, e1, "end"); ta.dispatchEvent(new Event("input", { bubbles: true })); }
    }
    ta.setSelectionRange(r.a, r.b);
    place();
  }
  const apply = fn => { if (!ro) replace(fn(ta.value, ta.selectionStart, ta.selectionEnd)); };

  /* ---- the floating bar */
  // Where the caret is, in the pad's coordinates: a hidden copy of the text up to it, laid out the same.
  function caret(pos) {
    const cs = getComputedStyle(ta);
    for (const k of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "tabSize", "wordSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) mirror.style[k] = cs[k];
    mirror.style.width = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + "px";
    mirror.textContent = ta.value.slice(0, pos);
    const mark = el("span", {}, "\u200b");
    mirror.append(mark);
    return { x: mark.offsetLeft - ta.scrollLeft + ta.offsetLeft, y: mark.offsetTop - ta.scrollTop + ta.offsetTop, h: parseFloat(cs.lineHeight) || mark.offsetHeight };
  }
  function place() {
    if (gone || mode !== "edit" || ro || document.activeElement !== ta) { bar.hidden = true; menu.hidden = true; return; }
    bar.hidden = false;
    const p = caret(ta.selectionStart);
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let top = p.y - bh - 6; // above the line, or below it when there is no room
    if (top < 2) top = p.y + p.h + 6;
    bar.style.left = Math.max(4, Math.min(p.x, pad.clientWidth - bw - 4)) + "px";
    bar.style.top = Math.round(top) + "px";
  }
  const queue = () => { if (!queued) queued = setTimeout(() => { queued = 0; place(); }, 16); };

  const button = (act, label, title, run) => el("button", { type: "button", class: "np-btn", "data-act": act, title, "aria-label": title,
    onmousedown: e => e.preventDefault(), // keep the selection in the text area
    onclick: () => { menu.hidden = true; apply(run); } }, label);
  const lines = (name, rows) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 16 16");
    s.setAttribute("class", "np-ic");
    for (const [x1, y, x2] of rows) {
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      for (const [k, v] of Object.entries({ x1, y1: y, x2, y2: y })) l.setAttribute(k, v);
      s.append(l);
    }
    return s;
  };
  const sep = () => el("span", { class: "np-sep" });
  const groups = [
    [["bold", el("b", {}, "B"), "Bold (Ctrl+B)", NotepadOps.bold], ["italic", el("i", {}, "I"), "Italic (Ctrl+I)", NotepadOps.italic],
      ["strike", el("s", {}, "S"), "Strikethrough", NotepadOps.strike], ["code", el("span", { class: "mono" }, "</>"), "Code", NotepadOps.code]],
    [["heading", "H", "Heading (press again for a smaller one)", NotepadOps.heading]],
    [["size"]],
    [["left", lines("l", [[2, 4, 13], [2, 8, 9], [2, 12, 13]]), "Align left", (t, a, b) => NotepadOps.align(t, a, b, "left")],
      ["center", lines("c", [[2, 4, 14], [4.5, 8, 11.5], [2, 12, 14]]), "Align centre", (t, a, b) => NotepadOps.align(t, a, b, "center")],
      ["right", lines("r", [[3, 4, 14], [7, 8, 14], [3, 12, 14]]), "Align right", (t, a, b) => NotepadOps.align(t, a, b, "right")]],
    [["bullet", "•", "Bullet list", NotepadOps.bullet], ["numbered", "1.", "Numbered list", NotepadOps.numbered],
      ["checkbox", "☑", "Checkbox", NotepadOps.checkbox], ["quote", "“", "Quote", NotepadOps.quote]],
  ];
  for (const g of groups) {
    const made = g.filter(([act]) => want.has(act)).map(([act, label, title, run]) => {
      if (act !== "size") return button(act, label, title, run);
      for (const [name, px] of NP_SIZES) {
        menu.append(el("button", { type: "button", class: `np-item np-s${px}`, "data-size": px,
          onmousedown: e => e.preventDefault(), onclick: () => { menu.hidden = true; apply((t, a, b) => NotepadOps.size(t, a, b, px)); } }, name));
      }
      return el("button", { type: "button", class: "np-btn", "data-act": "size", title: "Font size", "aria-label": "Font size",
        onmousedown: e => e.preventDefault(), onclick: () => { menu.hidden = !menu.hidden; } }, "Aa ▾");
    });
    if (made.length) bar.append(...(bar.childElementCount ? [sep()] : []), ...made);
  }
  bar.append(menu);

  /* ---- the preview */
  function drawView() {
    view.innerHTML = notepadRender(ta.value);
    if (typeof codeActions === "function") codeActions(view);
  }
  view.addEventListener("change", e => {
    const box = e.target;
    if (ro || !(box instanceof HTMLInputElement) || box.dataset.line === undefined) return;
    const next = NotepadOps.toggleTask(ta.value, +box.dataset.line);
    if (next === null) { box.checked = !box.checked; return; }
    ta.value = next;
    box.closest("li").classList.toggle("done", box.checked);
    changed();
  });

  function setMode(m, quiet) {
    if (ro) m = "view";
    if (m === "view") flush();
    mode = m;
    ta.hidden = m === "view";
    view.hidden = m !== "view";
    for (const [k, b] of Object.entries(tabs)) b.classList.toggle("on", k === m);
    if (m === "view") drawView();
    if (!ro && !quiet) npModeSet(m);
    if (m === "edit" && !quiet) ta.focus();
    place();
  }

  /* ---- events */
  for (const ev of ["keyup", "mouseup", "focus", "select", "scroll"]) ta.addEventListener(ev, queue);
  ta.addEventListener("input", () => { changed(); queue(); });
  ta.addEventListener("blur", () => { flush(); setTimeout(() => { if (document.activeElement !== ta) { bar.hidden = true; menu.hidden = true; } }, 0); });
  ta.addEventListener("keydown", e => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const run = { b: NotepadOps.bold, i: NotepadOps.italic }[k];
      if (run) { e.preventDefault(); apply(run); } else if (k === "s") { e.preventDefault(); flush(); }
    } else if (e.key === "Enter" && !e.shiftKey && !mod && !e.altKey) {
      const r = NotepadOps.enter(ta.value, ta.selectionStart, ta.selectionEnd);
      if (r) { e.preventDefault(); replace(r); }
    } else if (e.key === "Escape") {
      bar.hidden = true;
      menu.hidden = true;
    }
  });

  const away = () => !root.isConnected && (destroy(), true);
  const onFocus = () => { if (!away()) refresh(); };
  const onLeave = () => { if (!gone) flush(); };
  const onHidden = () => { if (document.hidden) onLeave(); };
  window.addEventListener("focus", onFocus);
  window.addEventListener("hashchange", onLeave);
  window.addEventListener("pagehide", onLeave);
  document.addEventListener("visibilitychange", onHidden);
  function destroy() {
    if (gone) return;
    flush();
    gone = true;
    clearTimeout(timer);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("hashchange", onLeave);
    window.removeEventListener("pagehide", onLeave);
    document.removeEventListener("visibilitychange", onHidden);
  }

  /* ---- assembly */
  const pad = el("div", { class: "np-pad" }, ta, view, bar, mirror);
  for (const [m, label] of [["edit", "Edit"], ["view", "Preview"]]) {
    tabs[m] = el("button", { type: "button", class: "mode-btn", "data-mode": m, title: m === "edit" ? "Write and format" : "Read it, tick checkboxes",
      onclick: () => setMode(m) }, label);
  }
  const root = el("div", { class: "np", id }, el("div", { class: "np-top" },
    ro ? "" : el("div", { class: "mode-toggle" }, tabs.edit, tabs.view), status, fix), pad);
  root.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e" && !ro) { e.preventDefault(); setMode(mode === "edit" ? "view" : "edit"); } });
  setMode(mode, true);

  return { element: root, focus: () => (mode === "edit" ? ta : view).focus(), getText: () => ta.value, flush, refresh, setMode, destroy };
}

function npModeGet() { try { return localStorage.getItem("tt-notepad-mode") === "view" ? "view" : "edit"; } catch { return "edit"; } }
function npModeSet(m) { try { localStorage.setItem("tt-notepad-mode", m); } catch { /* private mode: not remembered */ } }
