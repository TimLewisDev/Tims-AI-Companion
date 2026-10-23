# How Tatty is built

Tatty is a user interface over the TT toolbox's workflow, kept separate from the
toolbox. See [toolbox-contract.md](toolbox-contract.md) for what Tatty takes
from the toolbox, and [history.md](history.md) for how it was worked out.

```
 Claude Code session (joined)                        Tatty's window
   tatty mod ──── HTTP, token ────▶  app/server.py  ◀──── SSE / HTTP ────  app/web (the page)
     · AskUserQuestion → Tatty       127.0.0.1 only       shown in the tray app (app/companion,
     · typed text → the prompt       state in              Windows: WPF + WebView2) or a browser tab
     · replies, activity → Tatty     ~/.claude/tatty
                                          │
                                          ├── reads: feature folders, the toolbox's ledger and links
                                          ├── follows: the ledger as it is written → milestone events
                                          ├── runs (read-only): the toolbox's workflow-state.sh, …
                                          └── opens: new Claude sessions (Start), with TATTY_SESSION
```

## The pieces

- **`app/server.py`:** the hub, standard-library Python.
  - It listens only on 127.0.0.1, behind a random token and a Host check.
  - It keeps the conversation, questions, sessions and inboxes in memory.
  - It streams events to the page over SSE.
  - It serves the read-only views: features, documents, link resolution,
    toolbox status.
  - It owns Tatty's root folder and launches sessions.
- **`app/web`:** the page, with no libraries and no network beyond the server.
  - **Companion mode** is a compact speech bubble: the feed, questions and chat.
  - **The full panel** has the modes, mode home, Features, feature and Toolbox
    pages, with the chat as a right-hand column.
  - It has its own small markdown renderer, which handles Obsidian links and
    block ids.
- **`app/companion`:** the Windows tray app (.NET 9 WPF and WebView2).
  - Tatty himself is a transparent, topmost, non-activating window drawn in
    XAML. He moves, celebrates and makes a noise: see
    [Tatty's own life](#tattys-own-life) below.
  - The bubble is an opaque WebView2 window with Windows 11's rounded corners,
    because WebView2 can't draw in a transparent window.
  - The full panel moves, resizes, maximises, minimises and remembers its place.
    Only Tatty and the compact bubble stay on top, and they say so again whenever
    another window comes to the front -- though never over the shell, over a
    window with a whole monitor to itself, or while the full panel is out. The
    full and maximised panel are ordinary windows that other windows can cover. A
    click on Tatty raises a covered full panel, and tucks it away when it is
    already in front.
  - **Tatty is an application on the taskbar**, and only the full and maximised
    panel is in Alt-Tab. Those are the same style bit, so they are kept apart by
    two windows: the panel asks for `WS_EX_APPWINDOW` while it is out, which puts
    it in both; and `TaskbarProxy` -- one pixel, off every screen, minimised for
    good, never able to come forward -- holds the button the rest of the time, so
    there is always exactly one and it works even while nothing is on screen.
    `BubbleWindow.Apply()` decides all of this in one place, and the window is
    never recreated, because the page and its WebView2 would go down with it.
  - There is a tray icon and menu.
  - It watches the server's events to pop up and tuck away, and follows a
    reopened server.
  - It is built from a copy of its sources into `%LOCALAPPDATA%\Tatty`, never
    inside the plugin's folder.
- **`app/launcher` and `assets/`:** Tatty as a desktop program (Windows).
  - `Tatty.exe` is a thin WinExe, built by `/tatty install` into
    `%LOCALAPPDATA%\Tatty\launcher`, that the Desktop and Start menu shortcuts run. It
    finds the plugin (`boot.json`, else Claude Code's `installed_plugins.json`) and
    runs `tatty.sh boot` hidden, so a plugin update never breaks the shortcut. The
    shortcuts carry the AppUserModelID the tray app names itself with
    (`TimsAICompanion.Tatty`), so a taskbar pin and the running window are one button.
  - `server.py boot` starts the server, shows the tray app (or rings the running
    one's `Local\tatty-companion-show` event, which brings it forward) and starts
    **Tatty's own Claude session**: a titled terminal window (`Tatty (Claude)`;
    `wt -w new --suppressApplicationTitle`, so Claude can't rename it) running
    `claude --resume <id>`, or `--session-id <id>` before the conversation has a
    message. The id and the folder are `claude-link.json` in Tatty's home. The window
    is found by its title (`find_window`) and minimised the moment it exists
    (`minimise_window`); if the session's mod hasn't joined within `MOD_WAIT` it is
    brought up instead, since it is most likely asking something (trust this
    folder). The tray's "Show Claude's terminal" and quitting go through the
    server's `/api/claude/show|close`.
  - The icon is `assets/tatty.ico`, drawn natively at each size by
    `tools/make-icon` (which also writes the plugin's `icon.png`) from the same
    geometry as `TattyWindow.xaml`'s head. It is built into both exes as their file
    icon and as the resource the tray and windows load.
- **`hooks/register.tsx`:** the mod. It acts only in **joined** sessions: one
  Tatty started (it carries `TATTY_SESSION`), Tatty's own (it carries
  `TATTY_JOIN=1`, and works on the main feed), or one where `/tatty open` or
  `/tatty attach` was run. In a joined session it:
  - routes AskUserQuestion to Tatty, falling back to the terminal dialog;
  - submits text typed in Tatty;
  - mirrors replies.

  A session Tatty started also reports each tool call, prompt and reply for its
  feature page. Every other session is untouched.
- **`scripts/tatty.sh`:** the command line (open, close, boot, install, uninstall,
  status, show, ask, answer, listen). Any agent that can run a shell command can use it.
  **`scripts/tatty-root.sh`:** the root setting. It never accepts a root
  inside the Claude folder, whichever way the path is spelled.

## Tatty's own life

Tatty is meant to be noticed when it matters and good company when it doesn't.
Three files do that, and the drawing stays out of all of them:
`TattyWindow.xaml` is a drawing with every moving part named, `Avatar.cs`
animates those parts, `Effects.cs` throws things about him and `Sounds.cs` makes
the noise.

- **The rig.** He is 104x120 of drawing in a 104x156 window: a window clips
  whatever leaves it, so there are strips above and below him to jump and to sit
  down into (`TattyWindow.TopInset` and `BottomInset`). Anything placed against
  him measures from those, not from the window's edges, or the bubble would float
  over an empty strip. The root transforms move all of him, `Body`'s move
  everything above the knees, and each leg has a lift and a fold of its own, so
  he can shift his weight from foot to foot and fold them under to sit. The mouth
  is three shapes with one shown at a time, which is steadier than animating a
  shape, and the eyes' one blink transform doubles as his eyelids: half closed
  dozing, nearly shut asleep.
- **The ladder** (`Avatar.cs`). Left alone 45 seconds he starts to fidget -- a
  look about, a dance from foot to foot, a stretch, a sit down for a minute --
  after five minutes he dozes and yawns, and after ten he is asleep, sat down
  with Z's drifting off him. `Poke()` is the only thing the rest of the app has
  to remember: every server event, and every hover, click and drag, is one, and
  it stands him up with a start. `TATTY_ANIM_FAST=1` divides every one of those
  waits by nine, because nobody wants to wait ten minutes to see whether he
  snores. Two properties are owned outright so the clocks can't fight over them:
  the bob owns `BodyShift.Y` and the blink owns `Blink.ScaleY`, which is why a
  performance uses the root transforms, the legs and the pupils instead. One
  performance runs at a time; a fidget that misses its turn is dropped, and the
  two that are the whole point -- a question, a milestone -- cut in.
- **The stage** (`Effects.cs`) is a window of its own, nearly three times his
  size, holding the confetti, the rings and sparks that pulse while a question
  waits, and the Z's. It is **click-through** (`Native.MakeClickThrough`), which
  is both why it can be that big -- Tatty's own window is clickable all over,
  since that is how he is dragged, so a stage that size would take the corner of
  the desktop out of use -- and how the shell tells the two apart, which
  `tools/window-check.py` relies on. It shows itself for the first particle and
  hides after the last, and everything on it is drawn in Tatty's own coordinates
  plus the offset to the middle of the stage, so its numbers line up with the
  XAML's.
- **The noise** (`Sounds.cs`) is worked out rather than shipped, for the same
  reason the icon is drawn in code: a cue is a handful of bell-ish notes mixed
  into a few kilobytes of PCM and played from memory. There is a chime for a
  question and a flourish for a milestone, one at a time and never two on top of
  each other.
- **Milestones.** The toolbox writes a feature's progress into its ledger as it
  happens; `watch_ledger` in `server.py` follows that file and emits a
  `milestone` event for each row in `MILESTONES`, with a tier: *big* for a plan
  signed off or a build complete, *mid* for a piece of work done, *small* for a
  step taken. It starts from the end of the ledger as it stands, so a window that
  has just opened doesn't celebrate last week's work, and it remembers the keys
  it has announced, so a re-read can't celebrate twice. The companion jumps,
  throws confetti and plays the flourish; the page adds a card and confetti of
  its own (`milestoneCard` and `confetti` in `app.js`). `tatty.sh cheer [<event>]`
  does the lot on demand, which is how it is tried out and tested.
- **His menu** (`MakeMenu`) is one `ContextMenuStrip` shown in both the places a
  person reaches for it: the tray icon, and a right-click on Tatty himself. Its
  **Preview** submenu (`PreviewMenu`) is the catalogue of his whole repertoire --
  every performance, every pose he holds, the stage's confetti and pulses, each
  sound on its own, and the two whole reactions exactly as they arrive -- so any
  of it can be watched on purpose rather than waited for. A preview cuts in and
  winds the fidget clock back, so what was picked is what is seen
  (`Avatar.Preview`); a pose stays until something really happens. Items whose
  toggle is off are shown disabled, which says more than doing nothing would.
  Bringing the menu up must not be mistaken for choosing something in it, so the
  `telling` flag is up while the items are brought up to date (setting `Checked`
  raises the same event a click does).
- **What the person chooses** (`Settings.cs`, `%LOCALAPPDATA%\Tatty\avatar.json`,
  beside the panel's bounds but in a file of its own, and nothing to do with the
  server's settings): **Animations**, **Sound**, **Effects** and **Keep Tatty on
  the desktop**. The last one is what makes the fidgeting worth having: without
  it Tatty tucks himself away ten seconds after nothing is pending, and his own
  day is never seen. The x, the tray's "hide" and the taskbar's close are a
  person saying "away with all of it", and outrank it.
- **Less motion.** Whether Tatty moves at all is `Motion.On`, in one place
  because the avatar and the stage have to agree. The OS's own answer
  (`SystemParameters.ClientAreaAnimation`, Settings ▸ Accessibility ▸ Visual
  effects) is the **default and not a veto**: with it off he bobs and blinks and
  nothing else, until the person ticks **Animations** in his menu, which is
  theirs for good either way. `TATTY_ANIMATE=1` overrides both, for the tests,
  which have to be able to see the confetti on a machine that has animation
  turned off. The page does the same thing for `prefers-reduced-motion`, where
  the card says it just as well.

## Modes and colour

A **mode** is one of the toolbox's discipline plugins: engineering, design or
production (`installed_modes()` in `server.py`, from the toolbox's pointer
folders and Claude Code's own install records; see
[toolbox-contract.md](toolbox-contract.md)).

- **The landing page** (`#modes`) has a card for every discipline the toolbox
  has, whether or not it is installed. The ones installed are the modes to work
  in; the rest are greyed, with **Add**, which has Claude Code install that
  plugin from the toolbox's marketplace (`POST /api/mode/install` →
  `install_mode`, the same `claude plugin install` a person would run). The card
  comes to life with the answer, and the page says the plugin's skills reach
  Claude Code in new sessions. A window opens on the mode's home page when there
  is one to open on (`parseRoute`), but the modes page stays reachable with a
  single discipline installed, because it is also where another is added.
- **The mode** is the page's own choice, remembered in `localStorage`; the
  server only says which plugins are installed (`/api/status`'s `modes`).
- **The radio** is one box of segments, the mode on screen pressed into it and
  in that mode's colour (one segment, pressed, when only one is installed). It
  lives in the panel's title bar, beside Tatty's name; the header holds the same
  radio for a browser tab, which has no title bar, and the compact bubble shows
  neither. `renderSwitcher` fills every `.mode-switch` slot, and style.css
  decides which is on screen.
- **Mode-scoped pages:** a nav item with a `data-mode` belongs to that mode and
  is shown only in it (today Features, engineering's). Going to such a page
  switches to its mode (`PAGE_MODE` and `switchMode` in `features.js`), so a
  link never shows one mode's pages in another's colours. With no discipline
  plugin installed, nothing is hidden.
- **The colour** is all a mode changes: `theme.css` has the palette (every
  mode's accent), the theme (the neutrals and states, with the dark override)
  and the mode layer, which is only ever
  `--accent: var(--accent-<mode>)` under `body[data-mode="…"]`. `style.css`
  names `--accent`, `--accent-soft` and `--on-accent` and no colour of its own,
  so a new mode is one block in the mode layer and a new theme (a light/dark
  toggle of our own, say) one block in the theme layer. The tray app follows:
  the page sends `mode`, and `App.xaml.cs` swaps the `TtAccent` brush Tatty is
  drawn with.

## Features and the workflow

- **The root folder:** Tatty's root (default `~/Tatty`, chosen in Windows' own
  folder dialog) holds `features/<feature>/`. A feature folder may be a junction
  to a folder elsewhere, a vault say.
- **The Features page** lists the features, using the toolbox's
  `workflow-state.sh` for where each stands.
- **A feature's page** reads its documents, the toolbox ledger's events for it,
  and the tables in its Task Status and draft plan.
- **A document** has a View | Edit toggle above it (`showDoc` in `features.js`),
  remembered for the session. View picks a viewer by the document's kind from
  the `VIEWS` registry in `views.js` (today `Challenges`, as cards, and
  `Task Breakdown`, as work-unit groups of foldable tickets with status read from
  the Task Status through `ctx.sibling`; other kinds, or a file the viewer can't
  read, show the plain markdown). A link to a ticket opens the folds around it
  (`goToTarget`). Edit is a
  textarea whose Save posts to `/api/doc/save`: the path guard `doc_path`, a
  modified-time check against the version the page read (409 if it moved on),
  and an atomic write. To add a viewer, add a parser and a function to `VIEWS`.
- **Planning IDs** (`ids.js`): `linkIds(node, feature)` turns the IDs the
  feature defines into links, in questions (`askCard`), replies and documents in
  View. It runs over the rendered text, so plain text, markdown and the custom
  viewers all get it; definitions, headings, code and existing links are left
  alone. The feature's IDs come from `/api/items` (the toolbox's `ids.sh index`,
  cached on the documents' modified times), an item's card from `/api/item`
  (`item_of` in `server.py`). A question's feature is `session_feature`'s: the
  started session's, else the one its project is linked to. Hovering any link
  that names an ID (an ID link, or a wikilink to `^r12` or `CH3 — …`) shows the
  card, positioned from JS because the CSP refuses inline styles; `findId`
  focuses the item when the link is followed.
- **New feature…** makes the folder. **Start** then runs the workflow's own
  `/tt-workflow "<folder>"`, so the toolbox links and starts the feature.
  Tatty never changes the workflow's records.
- **Start session:**
  - It opens a terminal with `claude -n "<Feature> : <Stage>" "<command>"` in
    the feature's project. The project comes from a choice on the page, a
    tt-workflow link, the ledger, or a `Repo` path in the documents.
  - It sets `TATTY_SESSION=<tag>` in the launcher script, because a new
    Windows Terminal tab doesn't inherit environment variables.
  - From a checkout it also passes `--plugin-dir`, so the new session loads the
    mod.
  - The feature page then swaps "Where it stands" for that session's live
    panel.
- **Tokens used:** `usageWidget(usage, { compact })` in `usage.js` draws what a
  session has used (input, output, cache read and write, the context window's
  fill, the cost) as a card, or as one line with `compact`; it returns
  `{ node, update }` so any page can hold one. The feature page puts one above
  the Timeline card, for the live session or else the last one's final total.
  The numbers come from the mod: after each turn of a started session it posts
  `kind: "usage"` to `/api/activity` with its running totals (the engine reports
  tokens per turn, so the mod sums them) and `$.session.usage()`'s context and
  cost. The server keeps them as `usage` on the session and sends a `session`
  event, so they reach the page with the session; they are not a row in the
  activity feed. Nothing is read from the transcript files, and a session
  Tatty didn't start reports nothing.

## Tests

- `tools/test-tatty.sh` covers the server, the scripts and the pages' data:
  249 checks against a real toolbox, with a toolbox-free part when there's no
  toolbox. The milestones are among them: a row appended to the ledger is
  announced with its label and tier, once per key, unknown events are ignored,
  and a window that opens on a full ledger says nothing about it.
- `claude plugin test plugins/tatty` covers the mod, including the joining
  rule.
- `tools/page-check.py` and `tools/features-check.py` drive the page in
  headless Edge or Chrome, or the tray app's WebView2 with `attach <port>`.
  `page-check.py` also covers the modes: the top bar, the landing page, what
  switching mode does to the colour and the nav, and the mode being remembered
  across a reload. Start the server with `TATTY_MODES` to drive more than the
  one discipline installed. It asks for a milestone through the page's own
  `api()` as well, and reports the card, the confetti, and that the pieces take
  themselves away again.
- `tools/window-check.py` reports what the shell makes of the companion's
  windows -- the styles that decide the taskbar and Alt-Tab, who holds the
  button, what is on top -- and asserts the lot for one view with
  `--expect <view>`. With `--switch <view>` it changes view through the page's
  own buttons and checks that the window, its WebView2 and the loaded page all
  came through unchanged, which is the promise that a view switch never rebuilds
  the runtime. `--right-click` right-clicks Tatty and asks whether his menu came
  up and whether Escape took it away. That one borrows the **real** pointer for a
  moment and puts it back: WPF takes its mouse input from the system cursor and
  ignores a posted click that didn't happen there, so a synthetic one reaches no
  handler at all and looks exactly like a menu that doesn't work.
- `tools/test-companion.sh` walks every view with it (compact, full, maximised,
  minimised, restored, tucked away and back), right-clicks Tatty for his menu,
  and finishes a section with `tatty.sh cheer` to see the confetti's window come
  up and go away again. It is the only test that builds and runs the exe, shows
  real windows and uses the pointer, so it is opt-in rather than part of
  `test-tatty.sh`.
