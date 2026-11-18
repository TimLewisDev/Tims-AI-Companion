# Overview themes in the shop: what the app needs

`themes.html` (beside this file) is the design: three free defaults to pick one from, four themes to
sell, and a "Shop ▸ Themes" mock. This note lists what Tatty itself would need to make that real. Nothing
here is built yet. The line numbers are where things are today and will move.

## What is being sold

| Id | Name | Price | Tier on the board |
|---|---|---|---|
| `minimal` | Minimal (the default the user picked from M1-M3) | 0 | common |
| `star` | Star Chart | 500 | rare |
| `map` | Expedition Map | 500 | rare |
| `sea` | Deep Dive | 600 | epic |
| `rail` | Steam Railway | 700 | legendary |

Everyone owns `minimal`. A theme that is not owned, or is unknown, falls back to `minimal`.

## Server

- **Catalogue.** Add a `themes` list to `app/shop.json`: `id`, `name`, `tagline`, `price`. Teach
  `shop_catalogue()` (`server.py:2775`) to keep it, the way it keeps `avatars` (`keep("themes", ("id",))`).
- **Wallet.** Add a `theme` field next to `avatar` in `wallet_load` (`:2789`). It is checked the same way:
  kept only if the id is owned, otherwise the free one (`minimal`). The free themes are always owned.
- **Actions.** `shop_act` (`:2944`) gains `action: "theme"` with `{id}`: 404 when there is no such theme,
  409 "buy it first" when it is not owned, otherwise it sets `w["theme"]`. Buying needs no new code:
  `things = {**items, **avatars}` becomes `{**items, **avatars, **themes}`, so `buy` already takes the
  coins, adds the id to `owned` and writes the `wallet_log` line ("Bought: Steam Railway").
- **Wearing on purchase.** The board mock wears a theme as soon as it is bought. In the app that is two
  calls (`buy`, then `theme`), or `buy` could set `theme` itself for a theme. Pick one.

## Shop page

- A **Themes** tab in `web/shop.js`. The tabs today are the avatars and the slots (`:160`).
- A card per theme: the mini live preview, name, tagline, rarity colour, then the price, "Owned" or
  "Wearing". The board's `#shelf` is the model, and it reuses the real `shop.css` classes (`.shop-card`,
  `.r-*`, `.shop-balance`, `.bought`, `.nope`, `.coin-float.need`). It needs `--on-accent`, `--ok` and
  `--bad`, which the board defines itself.
- **Try-on.** Hover (and keyboard focus) a card to preview it. On the board it renders in a large pane
  on the shop page. The cheaper, truer option is to preview it on the user's real Overview, but that
  page is in another tab, so a pane on the shop page is what the mock shows.
- A refusal shakes the card and floats "Need N more" (the server already returns `need`).

## Theme modules

One small registry, and one JS file (plus one CSS file) per theme under `web/themes/`:

```js
TattyThemes.register({
  id, name, cls,            // cls goes on the Overview root, e.g. "t-rail"
  voc: { cont, skip, stop }, // the words on the three gate buttons
  draw(svg, m, card),       // build the journey SVG for the state m
  tick(t, card),            // per frame, only while it is on screen
  play(card, ev),           // the one-off moves: advance, finish, skip, decided, complete
  hero(card, h),            // optional: replaces the title block (the railway ticket, the depth readout)
  panelIn,                  // optional: how the gate panel arrives
});
```

- The default is built in, in the page's own `--panel/--ink/--line/--accent`, so it looks native in light
  and dark. It never needs a download and is the fallback for everything else.
- Load a theme's files only when it is the worn one, so an owner of nothing downloads nothing.
- **CSP.** Same-origin script and CSS files, SVG built through the DOM (`createElementNS`), styling through
  classes and the CSSOM, animation through WAAPI (`element.animate`). No inline `style=""` attributes, no
  `<style>` blocks, no `eval`. The board's engine keeps to this, except where noted below.
- WAAPI on an element overrides its `transform` attribute. A theme that positions a group with an
  attribute animates an inner `.pop` group instead. The railway's semaphore arm turns with a frame tween
  on the `transform` attribute for the same reason (the SVG transform-origin).
- **Per-card ids.** SVG `defs` ids (gradients, clip paths) must carry a per-instance uid. The board's
  shelf shows the same theme in the large pane and as a thumbnail at once, and duplicate ids break fills.

### Things the board does that a CSP-strict page would need to adapt

The board is a single local file, so it sets some inline styles from script (`el.style.…`, `style.cssText`
on the flying coins and sparks, and the railway's dashed-line offset). Through the CSSOM
(`el.style.setProperty`) that is allowed under a CSP that blocks inline `style=""` attributes in markup,
but it should be checked against the policy the app actually sends before relying on it.

## Motion and performance

- The switch is Tatty's **Motion** setting (`tt-juice`, `web/wallet.js:18`), not `prefers-reduced-motion`.
  This machine has Windows animation effects off, so OS-gated motion looks dead here. With Motion off a
  theme draws a still scene and plays nothing.
- Pause `tick` when the page is hidden (`document.hidden`) and when the Overview is scrolled offscreen
  (an `IntersectionObserver`). The board does both.
- **Cost to check over RDP at 4K** (the user works over Remote Desktop, around 32 fps, TCP only):
  the railway's smoke puffs and drifting clouds, Deep Dive's bubbles, fish and the sweeping light rays
  (`::before` with a mask), Star Chart's starfield, nebulae and shooting stars. On a headless desktop
  Edge the whole board (13 live cards) ticks in about 0.1 ms per frame, so the cost is paint, not script.
  Test the real page, one theme at a time, at 4K / 200%.
- The shelf's thumbnails are live. Five animated thumbnails plus a large pane is the most expensive
  state. Consider animating only the one being hovered and leaving the others as a still frame.

## The real Overview must keep its selectors

`features-check.py` and the walks find the Overview by `#page-feature .overview`, `.overview .usage`
and `.overview .card h4` ("Where it stands"). Every theme wraps or replaces only the journey and the
hero, never those, so these survive whichever theme is worn. Add each theme to the walk, not only the
default.

## Decisions for you

1. **Per-project wallets or user-wide.** The wallet is per project (`project_home()/wallet.json`, via
   `wallet_path()`), so a theme bought in one project would have to be bought again in the next, and the
   theme worn is per project too. Is that right for a cosmetic you pay 500-700 coins for? User-wide
   would need a second file beside the project wallets (a theme is owned by the person, not the
   project) and a rule for which coins pay for it.
2. **Rarity bands.** `shop.json` says "rarity follows the price: up to 60 common, 120 rare, 180 epic,
   more legendary". Every theme at 500-700 is legendary under that rule, so the shelf would be
   five of one colour. The board uses tiers instead (0 common, 500 rare, 600 epic, 700 legendary).
   Either give themes an explicit `rarity` field in `shop.json` (the board's way), or reprice.
3. **Price against income.** The welcome gift is 100 coins and a big reward is 50, a merged request 40, a
   task 4. A 500-coin theme is a long way off at those rates. The board starts with 1,250 so the buying
   flow can be seen, which is not the real wallet. Are 500-700 right, or is the shop's current avatar
   price (400-600) the reference?
4. **Buying wears.** Should a purchase wear the theme at once, as the mock does, or only add it to the
   shelf?
5. **Which free default.** M1 Hairline, M2 Segments or M3 Focus carousel is "Minimal". Pick one with
   "Use as the default" on the board; the shop's first card follows it.
