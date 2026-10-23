// Planning IDs (R12, CH5, P3, CD2, §4, T07, ...) as links to the item they name, in
// the feature's own documents, with a card for the item when a link is hovered.
// The toolbox says where each ID is defined (ids.sh index, through /api/items):
// an ID the feature doesn't define stays plain text. Uses app.js's el, api, rich
// and mdNode, features.js's chip, featureHref, parseRoute and goToTarget, and
// views.js's parseChallenges, challengeCard and splitCard, at call time.
"use strict";

const ID_TOKEN = /(?<![\p{L}\p{N}_§])(?:(?:CD|CH|NB|WU|[RASCPTHD])\d+[a-z]?|§\d+[a-z]?)(?![\p{L}\p{N}_])/gu;
const isId = s => /^(?:(?:CD|CH|NB|WU|[RASCPTHD])\d+[a-z]?|§\d+[a-z]?)$/.test(s || "");

// A minute's memory of each feature's IDs and items: the documents change as
// skills write them, and the server only reads them again when they have.
const remembered = (map, key, get) => {
  if (!map.has(key)) {
    const p = get();
    map.set(key, p);
    setTimeout(() => { if (map.get(key) === p) map.delete(key); }, 60000);
  }
  return map.get(key);
};
const indexes = new Map(), items = new Map();
const itemsOf = feature => !feature ? Promise.resolve({}) :
  remembered(indexes, feature, () => api("/api/items?name=" + encodeURIComponent(feature)).then(r => r.ids || {}, () => ({})));
const itemOf = (feature, id) => remembered(items, feature + "\n" + id,
  () => api(`/api/item?name=${encodeURIComponent(feature)}&id=${encodeURIComponent(id)}`).catch(() => null));

// Opens the item, from wherever the link is: in the bubble, the full panel first.
function openItem(feature, file, id) {
  location.hash = featureHref(feature, file, id);
  if (typeof companion !== "undefined" && companion && !document.body.classList.contains("expanded")) $("#expand").click();
}

function idLink(feature, id, it) {
  const a = el("a", { href: featureHref(feature, it.file, id), class: "doclink idlink", "data-feature": feature,
    "data-file": it.file, "data-at": id, "data-id": id }, id);
  // its own click, before any row or option it sits in takes it as a pick
  a.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); openItem(feature, it.file, id); });
  return a;
}

// Where an ID is defined rather than cited: a bold "**R1:**" opening a bullet or
// paragraph, or the first cell of a table row ("| CD2 |").
function defining(n) {
  const strong = n.parentElement.closest("strong");
  if (strong && !strong.previousSibling && strong.parentElement.matches("li, p")) return true;
  const td = n.parentElement.closest("td");
  return !!td && !td.previousElementSibling;
}
const NOT_HERE = "a, code, pre, h1, h2, h3, h4, h5, h6, summary, textarea, input, .ch-num, .peek-head";

// Makes the IDs the feature defines, in root's text, links to their items, once
// the feature's IDs are known (so it can be called on a node not yet on screen).
async function linkIds(root, feature) {
  if (!root || !feature) return root;
  const ids = await itemsOf(feature);
  if (!Object.keys(ids).length) return root;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const p = n.parentElement;
    if (!/\d/.test(n.nodeValue) || !p || p.closest(NOT_HERE) || defining(n)) continue;
    if ([...n.nodeValue.matchAll(ID_TOKEN)].some(m => ids[m[0]])) hits.push(n);
  }
  for (const n of hits) {
    const s = n.nodeValue, parts = [];
    let last = 0;
    for (const m of s.matchAll(ID_TOKEN)) {
      if (!ids[m[0]]) continue;
      parts.push(s.slice(last, m.index), idLink(feature, m[0], ids[m[0]]));
      last = m.index + m[0].length;
    }
    parts.push(s.slice(last));
    n.replaceWith(...parts.filter(x => x !== ""));
  }
  return root;
}

// ------------------------------------------------------------- finding an item

// The item an ID names, in a rendered document: its block id ("^r12"), a heading
// that starts with it, a bullet or paragraph opening with it in bold, or a table
// row whose first cell it is. A heading CH1 is never CH10.
function findId(main, id) {
  const block = main.querySelector(`[data-block="${CSS.escape(id.toLowerCase())}"]`);
  if (block) return block;
  const opens = n => { const t = n.textContent.trim(); return t.startsWith(id) && !/[\p{L}\p{N}_]/u.test(t.charAt(id.length)); };
  const heads = [...main.querySelectorAll(".md h1, .md h2, .md h3, .md h4, .md h5, .md h6")];
  return heads.find(opens) ||
    [...main.querySelectorAll(".md li, .md p")].find(n => n.firstChild && n.firstChild.nodeName === "STRONG" && opens(n.firstChild)) ||
    [...main.querySelectorAll(".md tr")].find(r => r.cells[0] && r.cells[0].tagName === "TD" && r.cells[0].textContent.trim() === id) ||
    null;
}

// ------------------------------------------------------------- the card on hover

// The ID a link names: its own (an ID link), the block id or heading it points
// at ([[Doc#^r12]], [[Doc#CH3 — title]]), or its text.
function linkedId(a) {
  if (a.dataset.id) return a.dataset.id;
  const at = (a.dataset.at || "").trim();
  const fromAt = at.startsWith("^") ? at.slice(1).toUpperCase() : ((at.split("#").pop().match(/^\S+/) || [""])[0]).replace(/[.:]$/, "");
  if (isId(fromAt)) return fromAt;
  const text = a.textContent.trim();
  return isId(text) ? text : "";
}

function peekBody(d) {
  const lines = d.block.split("\n");
  if (/^CH\d/.test(d.id) && d.form === "heading") {
    const doc = parseChallenges(`# Card\n## Card\n${d.block}`);
    const it = doc && doc.stages[0] && doc.stages[0].items[0];
    if (it) return challengeCard(it);
  }
  if (/^(T|WU)\d/.test(d.id) && d.form === "heading") {
    const c = splitCard(lines.slice(1));
    const facts = Object.entries(c.meta).filter(([, v]) => v && !/^[—–-]*$/.test(v));
    return el("div", {},
      c.plain ? rich("p", "", c.plain) : "",
      facts.length ? el("dl", { class: "ch-facts" }, facts.flatMap(([k, v]) => [el("dt", {}, k[0].toUpperCase() + k.slice(1)), rich("dd", "", v)])) : "",
      !c.plain && !facts.length ? mdNode(c.body.join("\n")) : "");
  }
  if (d.form === "row" && d.fields) {
    const facts = d.fields.slice(1).filter(([k, v]) => k && v && !/^[—–-]*$/.test(v));
    return el("dl", { class: "ch-facts" }, facts.flatMap(([k, v]) => [el("dt", {}, k), rich("dd", "", v)]));
  }
  if (d.form === "item") {
    // the bullet's statement, without the bullet and the bold ID the card's head already shows
    const text = d.block.replace(/^\s*([-*+]|\d+\.)\s+\*\*[^*]+?\*\*\s*:?\s*/, "").replace(/\n {2,}(?![-*+]\s|\d+\.\s)/g, " ");
    return mdNode(text);
  }
  return mdNode(lines.slice(1).join("\n"));
}

function peekCard(feature, d) {
  const challenge = /^CH\d/.test(d.id) && d.form === "heading";
  const body = peekBody(d);
  const card = el("div", { class: "peek card" + (challenge ? " peek-ch" : ""), role: "tooltip" },
    el("div", { class: "peek-head" }, chip(d.id, "route"), el("span", { class: "dim small" }, d.doc)),
    d.form === "heading" && !challenge ? rich("div", "peek-title", d.title) : "",
    el("div", { class: "peek-body" }, body),
    el("div", { class: "peek-foot" }, el("a", { href: featureHref(feature, d.file, d.id), class: "peek-open",
      onclick: e => { e.preventDefault(); closePeek(); openItem(feature, d.file, d.id); } }, `Open in ${d.doc} ›`)));
  linkIds(card.querySelector(".peek-body"), feature);
  return card;
}

let peek = null, peekFor = null, opening = 0, closing = 0;

function closePeek() {
  clearTimeout(opening); clearTimeout(closing);
  if (peek) peek.remove();
  peek = peekFor = null;
}

// Beside the link, below it if it fits, else above; never off the page.
function place(card, a) {
  const r = a.getBoundingClientRect(), pad = 8;
  const w = card.offsetWidth, h = card.offsetHeight;
  card.style.left = Math.max(pad, Math.min(r.left, innerWidth - w - pad)) + "px";
  const below = r.bottom + 6, above = r.top - h - 6;
  card.style.top = (below + h <= innerHeight - pad || above < pad ? Math.max(pad, Math.min(below, innerHeight - h - pad)) : above) + "px";
}

async function showPeek(a) {
  const id = linkedId(a);
  const r = parseRoute();
  const feature = a.dataset.feature || (r.page === "feature" ? r.name : "");
  if (!id || !feature) return;
  const d = await itemOf(feature, id);
  if (peekFor !== a) return;
  if (!d || !a.isConnected) { closePeek(); return; }
  if (peek) peek.remove();
  peek = peekCard(feature, d);
  peek.addEventListener("pointerenter", () => clearTimeout(closing));
  peek.addEventListener("pointerleave", () => { closing = setTimeout(closePeek, 200); });
  document.body.append(peek);
  place(peek, a);
}

function wantPeek(a, delay) {
  if (peek && peek.contains(a)) return; // a link inside the card opens on click, not on hover
  clearTimeout(closing);
  if (peekFor === a) return;
  clearTimeout(opening);
  peekFor = a;
  opening = setTimeout(() => showPeek(a), delay);
}

function dropPeek(a, to) {
  if (peekFor !== a || (to && ((peek && peek.contains(to)) || a.contains(to)))) return;
  clearTimeout(opening);
  closing = setTimeout(closePeek, 200);
}

document.addEventListener("pointerover", e => {
  const a = e.target.closest && e.target.closest("a.doclink");
  if (a && linkedId(a)) wantPeek(a, 300);
});
document.addEventListener("pointerout", e => {
  const a = e.target.closest && e.target.closest("a.doclink");
  if (a) dropPeek(a, e.relatedTarget);
});
document.addEventListener("focusin", e => {
  const a = e.target.closest && e.target.closest("a.doclink");
  if (a && linkedId(a)) wantPeek(a, 0);
});
document.addEventListener("focusout", e => {
  const a = e.target.closest && e.target.closest("a.doclink");
  if (a) dropPeek(a, e.relatedTarget);
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && peek) closePeek(); });
document.addEventListener("scroll", e => { if (peek && !peek.contains(e.target)) closePeek(); }, true);
window.addEventListener("hashchange", closePeek);
