// Tatty's shop (#shop: the purse beside the gear, wallet.js). The coins earned for
// finishing things buy avatars for him to be and accessories for him to wear; what is
// for sale and its price are shop.json's (through /api/wallet), the drawings
// avatar.js's, and every purchase and change goes through /api/shop, which holds the
// one wallet (server.py's "coins and the shop").
//
// It is meant to be fun to be in. Tatty stands on a little stage wearing what he
// owns; a hand passing over a shelf puts that thing on him to try (and the stage says
// so); buying pours the coins out of the balance into the card with a till's
// ka-ching, the card pops and sparkles, and he puts it on and celebrates. A thing too
// dear shakes its head with a bonk and says how many more coins it needs. The rarer a
// thing, the more its card shines. Sound and motion each have a switch in the shop's
// corner (sfx.js, wallet.js keep them).
// Uses app.js's el and api, avatar.js's TattyAvatar, sfx.js's TattySfx and wallet.js's TattyWallet.
"use strict";

let shopBox = null;      // the page's element while it is on screen
let shopNow = null;      // the last /api/wallet answer, kept up to date by /api/shop's and the "wallet" events
let shopTab = "avatars";
let shopStage = null;    // { box, svg, anim, avatar } of the stage
let shopBalance = null;  // the big number, which wallet.js rolls
const shopNew = new Set(); // bought while the shop has been open: their cards say NEW

// What the rewards in shop.json are for, in words.
const EARN_WORDS = [
  ["big", "A plan signed off, or every work unit done"],
  ["merged", "A request merged"],
  ["mid", "A work unit validated, a breakdown or brief written, the whole plan challenged"],
  ["opened", "A merge request opened"],
  ["tasks", "A batch of tasks done on a task board"],
  ["small", "Any other step of the workflow closed"],
  ["task", "A task done on a task board"],
  ["decision", "A challenge, proposal or question decided"],
  ["suggestion", "A review suggestion decided"],
  ["answer", "A question answered"],
  ["story", "A user story accepted or rejected"],
];

const shopRarity = (price, kind) => kind === "avatar"
  ? (price >= 600 ? "legendary" : price ? "epic" : "yours")
  : price <= 60 ? "common" : price <= 120 ? "rare" : price <= 180 ? "epic" : "legendary";
const coinNode = () => { const s = el("span", { class: "coin" }); s.innerHTML = TattyWallet.COIN; return s; };

TattyWallet.onChange(n => { if (shopBalance && shopBalance.isConnected) shopBalance.textContent = n.toLocaleString(); });

async function renderShop(box) {
  shopBox = box;
  if (typeof TattyAvatar === "undefined") {
    box.replaceChildren(el("p", { class: "pad st missing" }, "The shop didn't load: restart Tatty (tray menu → Close Tatty's window, then open it again)."));
    return;
  }
  try { shopNow = await api("/api/wallet"); } catch (e) {
    box.replaceChildren(el("div", { class: "shop-page" }, el("p", { class: "pad" }, "Can't open the shop: " + e.message)));
    return;
  }
  TattyWallet.sync(shopNow.coins);
  drawShop();
  TattySfx.play("open");
}

// A switch in the shop's corner: Sound, Motion.
function shopSwitch(label, on, set) {
  const b = el("button", { type: "button", class: "shop-switch" + (on ? " on" : ""), role: "switch", "aria-checked": String(on) },
    el("span", { class: "knob" }), label);
  b.addEventListener("click", () => {
    on = !on;
    set(on);
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
    TattySfx.play("tab");
  });
  return b;
}

function drawShop() {
  const w = shopNow, cat = w.catalogue;
  shopBalance = el("span", { class: "num" }, TattyWallet.coins().toLocaleString());
  const page = el("div", { class: "shop-page" + (TattyWallet.motion() ? "" : " still") });
  const balance = el("div", { class: "shop-balance", title: "Your Tatty coins" }, coinNode(), shopBalance);
  page.append(
    el("div", { class: "shop-awning", "aria-hidden": "true" }),
    el("div", { class: "shop-head" },
      el("div", { class: "shop-title" },
        el("h2", {}, "Tatty's Shop"),
        el("p", {}, "Spend the coins you earn by finishing things. Whatever you buy is his to keep.")),
      balance,
      el("div", { class: "shop-switches" },
        shopSwitch("Sound", TattySfx.on(), v => TattySfx.set(v)),
        shopSwitch("Motion", TattyWallet.motion(), v => { TattyWallet.setMotion(v); page.classList.toggle("still", !v); }))),
    el("div", { class: "shop-body" },
      el("aside", { class: "shop-side" },
        el("div", { class: "shop-stage", id: "shop-stage" }),
        el("div", { class: "shop-wearing", id: "shop-wearing" }),
        el("details", { class: "shop-earn", open: true },
          el("summary", {}, "How to earn coins"),
          el("ul", {}, EARN_WORDS.filter(([k]) => cat.rewards[k]).map(([k, words]) =>
            el("li", {}, el("span", { class: "earn-amt" }, coinNode(), String(cat.rewards[k])), el("span", {}, words)))),
          el("div", { class: "shop-log", id: "shop-log" }))),
      el("section", { class: "shop-main" },
        el("div", { class: "shop-tabs", role: "tablist", id: "shop-tabs" }),
        el("div", { class: "shop-grid", id: "shop-grid" }))));
  shopBox.replaceChildren(page);
  setStage(w.avatar, w.outfit);
  drawShelves(true);
}

// ------------------------------------------------------------------ the stage

function setStage(avatar, outfit) {
  const box = shopBox.querySelector("#shop-stage");
  if (!box) return;
  if (shopStage && shopStage.box === box && shopStage.avatar === avatar) {
    TattyAvatar.dress(shopStage.svg, outfit);
    return;
  }
  box.innerHTML = '<div class="spot"></div>' + TattyAvatar.svg(avatar, { scale: 2.1, outfit }) +
    '<div class="shop-trying" hidden></div><div class="floor"></div>';
  const svg = box.querySelector("svg.tatty");
  shopStage = { box, svg, avatar, anim: TattyAvatar.animate([svg], avatar, "idle") };
}

let tryTimer = null;
function tryOn(thing, kind) {
  clearTimeout(tryTimer);
  const w = shopNow;
  TattySfx.play("hover");
  const owned = w.owned.includes(thing.id);
  if (kind === "avatar") setStage(thing.id, w.outfit);
  else { setStage(w.avatar, { ...w.outfit, [kind]: thing.id }); }
  const tag = shopStage.box.querySelector(".shop-trying");
  const wearing = kind === "avatar" ? w.avatar === thing.id : w.outfit[kind] === thing.id;
  tag.hidden = wearing;
  tag.textContent = owned ? "Trying on" : "Trying on · in the shop";
}
function tryOff() {
  clearTimeout(tryTimer);
  // a moment's grace, so sliding from one card to the next doesn't flash back in between
  tryTimer = setTimeout(() => {
    if (!shopStage || !shopStage.box.isConnected) return;
    setStage(shopNow.avatar, shopNow.outfit);
    shopStage.box.querySelector(".shop-trying").hidden = true;
  }, 120);
}

// ------------------------------------------------------------------ the shelves

function shopThings(tab) {
  const cat = shopNow.catalogue;
  return tab === "avatars" ? cat.avatars.map(a => ({ ...a, kind: "avatar" })) : cat.items.filter(i => i.slot === tab).map(i => ({ ...i, kind: i.slot }));
}

function drawShelves(entering) {
  if (!shopBox || !shopBox.isConnected) return;
  const w = shopNow, cat = w.catalogue;
  const tabs = shopBox.querySelector("#shop-tabs"), grid = shopBox.querySelector("#shop-grid");
  tabs.replaceChildren(...[["avatars", "Avatars"], ...cat.slots.map(s => [s.id, s.name])].map(([id, name]) => {
    const things = shopThings(id), have = things.filter(t => w.owned.includes(t.id)).length;
    return el("button", {
      type: "button", role: "tab", class: "shop-tab" + (id === shopTab ? " on" : ""), "aria-selected": String(id === shopTab),
      onclick: () => { if (shopTab === id) return; shopTab = id; TattySfx.play("tab"); drawShelves(true); },
    }, name, el("span", { class: "count" }, `${have}/${things.length}`));
  }));
  grid.replaceChildren(...shopThings(shopTab).map((t, i) => {
    const card = shopCard(t);
    if (entering && TattyWallet.motion()) { card.classList.add("enter"); card.style.animationDelay = `${Math.min(i, 24) * 22}ms`; }
    return card;
  }));
  drawWearing();
  drawLog();
}

function shopCard(t) {
  const w = shopNow, kind = t.kind;
  const owned = w.owned.includes(t.id);
  const worn = kind === "avatar" ? w.avatar === t.id : w.outfit[kind] === t.id;
  const price = t.price || 0, rarity = shopRarity(price, kind);
  const thumb = el("span", { class: "sc-thumb" });
  thumb.innerHTML = kind === "avatar"
    ? TattyAvatar.svg(t.id, { scale: 0.78, box: "shop", outfit: w.outfit })
    : TattyAvatar.svg(w.avatar, { scale: 0.78, box: "shop", outfit: { [kind]: t.id } });
  const note = kind === "avatar" ? t.tagline || "" : TattyAvatar.swap(w.avatar, t.id);
  const act = !owned ? (price ? el("span", { class: "sc-price" }, coinNode(), price.toLocaleString()) : "Free")
    : worn ? (kind === "avatar" ? "Chosen" : "Take off") : kind === "avatar" ? "Choose" : "Wear";
  const card = el("button", {
    type: "button", "data-id": t.id,
    class: `shop-card r-${rarity}${owned ? " owned" : " locked"}${worn ? " worn" : ""}${!owned && price > w.coins ? " dear" : ""}${shopNew.has(t.id) ? " new" : ""}`,
    title: owned ? (worn ? `${t.name}: ${kind === "avatar" ? "he is this one" : "he's wearing it"}` : `${t.name}: yours`) : `${t.name}: ${price} coins`,
  },
    el("span", { class: "sc-rarity" }, rarity),
    thumb,
    el("span", { class: "sc-name" }, t.name),
    el("span", { class: "sc-note" }, note || " "),
    el("span", { class: "sc-act" }, act),
    worn ? el("span", { class: "sc-worn", "aria-hidden": "true" }, "✓") : "",
    shopNew.has(t.id) ? el("span", { class: "sc-new", "aria-hidden": "true" }, "NEW!") : "");
  card.addEventListener("mouseenter", () => tryOn(t, kind));
  card.addEventListener("focus", () => tryOn(t, kind));
  card.addEventListener("mouseleave", tryOff);
  card.addEventListener("blur", tryOff);
  card.addEventListener("click", () => shopAct(t, card));
  return card;
}

function drawWearing() {
  const box = shopBox.querySelector("#shop-wearing");
  if (!box) return;
  const w = shopNow, cat = w.catalogue;
  const named = id => (cat.items.find(i => i.id === id) || {}).name || id;
  const me = cat.avatars.find(a => a.id === w.avatar) || {};
  const worn = cat.slots.filter(s => w.outfit[s.id]);
  box.replaceChildren(
    el("div", { class: "who" }, el("strong", {}, me.name || "Tatty"), el("span", { class: "dim" }, me.tagline || "")),
    worn.length ? el("div", { class: "chips" }, worn.map(s => el("button", {
      type: "button", class: "wear-chip", title: `Take off the ${named(w.outfit[s.id]).toLowerCase()}`,
      onclick: () => wear(s.id, "", null),
    }, named(w.outfit[s.id]), el("span", { class: "x", "aria-hidden": "true" }, "×"))))
      : el("p", { class: "dim small" }, "Wearing just his own bits. Hover over anything on the shelves to try it on."));
}

function drawLog() {
  const box = shopBox.querySelector("#shop-log");
  if (!box) return;
  const log = (shopNow.log || []).slice(-5).reverse();
  box.replaceChildren(...(log.length ? [el("div", { class: "dim small" }, "Lately")] : []),
    ...log.map(e => el("div", { class: "log-row" + (e.amount < 0 ? " spent" : "") },
      el("span", { class: "amt" }, (e.amount > 0 ? "+" : "") + e.amount), el("span", {}, e.reason))));
}

// ------------------------------------------------------------------ buying and wearing

async function shopPost(body) {
  const r = await api("/api/shop", body);
  Object.assign(shopNow, r);
  return r;
}

function deny(card, need) {
  TattySfx.play("denied");
  card.classList.remove("nope");
  void card.offsetWidth; // so a second click shakes it again
  card.classList.add("nope");
  const r = card.getBoundingClientRect();
  TattyWallet.say(`Need ${need} more`, { x: r.left + r.width / 2, y: r.top + 18 }, "need");
  if (shopStage) shopStage.anim.play("oops", 1.4);
}

async function shopAct(t, card) {
  const w = shopNow;
  if (!w.owned.includes(t.id)) return buy(t, card);
  if (t.kind === "avatar") {
    if (w.avatar === t.id) { TattySfx.play("tryon"); if (shopStage) shopStage.anim.play("celebrate", 1.2); return; }
    return choose(t.id, card);
  }
  return wear(t.kind, w.outfit[t.kind] === t.id ? "" : t.id, card);
}

async function buy(t, card) {
  const price = t.price || 0;
  if (shopNow.coins < price) return deny(card, price - shopNow.coins);
  let r;
  try { r = await shopPost({ action: "buy", id: t.id }); } catch (e) {
    if (e.status === 409 && /coins/.test(e.message)) return deny(card, Math.max(1, price - shopNow.coins));
    TattySfx.play("denied");
    TattyWallet.say(e.message, centreOf(card), "need");
    return;
  }
  shopNew.add(t.id);
  TattySfx.play("kaching");
  TattyWallet.spend(price, r.coins, card, shopBalance);
  card.classList.add("bought");
  setTimeout(() => {
    TattySfx.play("unlock");
    TattyWallet.burst(centreOf(card), 26, { reach: 110, size: 1.2 });
  }, 380);
  // and on he goes, straight away
  setTimeout(() => (t.kind === "avatar" ? choose(t.id, null, true) : wear(t.kind, t.id, null, true)), 720);
}

async function choose(id, card, quiet) {
  try { await shopPost({ action: "choose", id }); } catch (e) { TattySfx.play("denied"); return; }
  if (!quiet) TattySfx.play("equip");
  setStage(shopNow.avatar, shopNow.outfit);
  shopStage.anim.play("celebrate", 2.4);
  drawShelves(false);
}

async function wear(slot, id, card, quiet) {
  try { await shopPost({ action: "wear", slot, id }); } catch (e) { TattySfx.play("denied"); return; }
  TattySfx.play(id ? "equip" : "unequip");
  setStage(shopNow.avatar, shopNow.outfit);
  if (id) {
    shopStage.anim.play("celebrate", quiet ? 2.4 : 1.2);
    if (shopStage) TattyWallet.burst(centreOf(shopStage.svg), quiet ? 22 : 10, { reach: quiet ? 120 : 70 });
  }
  drawShelves(false);
}

const centreOf = n => { const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

// Coins earned while the shop is open, or another window bought or changed something: the
// shelves catch up (what is now affordable, what is owned), and so does the stage, unless
// something is being tried on.
document.addEventListener("tt-event", e => {
  const ev = e.detail;
  if (!shopNow || !shopBox || !shopBox.isConnected || !shopBox.classList.contains("on")) return;
  if (ev.type === "coins" && typeof ev.balance === "number" && ev.balance !== shopNow.coins) {
    shopNow.coins = ev.balance;
    if (ev.paid) shopNow.log = [...(shopNow.log || []), { ts: ev.ts, amount: ev.amount, reason: ev.reason }];
    drawShelves(false);
    return;
  }
  if (ev.type !== "wallet") return;
  Object.assign(shopNow, { coins: ev.coins, owned: ev.owned, avatar: ev.avatar, outfit: ev.outfit, log: ev.log || shopNow.log });
  drawShelves(false);
  if (shopStage && shopStage.box.querySelector(".shop-trying").hidden) setStage(shopNow.avatar, shopNow.outfit);
});
