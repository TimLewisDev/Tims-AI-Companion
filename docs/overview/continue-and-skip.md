# Manual Continue and Skip on the feature Overview

What Tatty and the toolbox need so that a feature's next workflow step starts only when the
person presses **Continue**, and so that they can **Skip** a step. This goes with the concept board
`concepts.html` beside this file: every direction there draws the same *gate* (Continue / Skip / Stop).

Line numbers are as of 2026-11-18 (Tatty `main`, toolbox `main`).

## What the person sees

- When a stage closes, the feature **stops at a gate**: "Scope complete · Next: Approach".
- **Continue** starts the next stage. If the session is still open it continues there; if not, a new
  session starts on the next step.
- **Skip** leaves the next stage out and moves the gate to the stage after it. It is only offered for
  stages the workflow can leave out: Explore, Scope, Approach, Whole plan and Review. For the others
  (Requirements, Technical design, Sign-off, Breakdown, Build) the button is greyed out and gives the reason.
- **Stop** parks the feature at the gate. The session may end; Continue later picks it up.
- Nothing starts on its own at any point.

## How it works today

There is already no automatic chaining: every skill asks a question before it moves on.

| Where | What happens at the end of a step |
|---|---|
| `tt-workflow` SKILL.md steps 3 and 5 (~90-121) | asks once: Continue / Continue in a new session / alternatives / Stop, then runs the next skill in the same conversation |
| `tt-adversarial-plan` SKILL.md "Break point" (163) | after each stage closes: Continue now / Continue in a new session / Stop here |
| `tt-execute` | stops after each work unit and offers to continue in a new session |

**In Tatty:**
- Those questions already reach Tatty as plain question cards. The mod's AskUserQuestion hook
  (`hooks/register.tsx:366`) posts them to `/api/ask`, and they are answered through `/api/reply`.
  They are not recognised as "a gate", so the Overview only shows "Go to the question".
- The Overview's own **Continue** (`#step-continue`) is just "start a session on the next primary
  row" (`primary_action`, `app/server.py:4091`).
- Tatty learns that a stage closed from the events ledger (`MILESTONES` / `announce`,
  `server.py:2113-2134`). No event says "waiting at a gate".
- Skipping exists only as the **stage picker**: `stages.sh show|set|check` (toolbox
  `tt-common/scripts/stages.sh`), used through `stages_view` / `stages_set` (`server.py:2251`, `2278`) and
  `POST /api/stages`. A stage can be turned off only until it has begun (`lock_of`, `stages.sh:199`).
  `tt-adversarial-plan` re-reads its Stages table every loop and passes over `Skipped` rows, so turning a
  stage off while a session waits at a Break point already works when the session goes on.

## Option 1: Tatty only, no toolbox change (quick, a little fragile)

1. **Gate action.** Add a `gate` kind to `primary_action`. It is chosen when a joined session has an open
   `ask` whose options look like a break point ("Continue now", "Continue in a new session", "Stop here").
   The Overview draws the gate card:
   - Continue answers "Continue now" through `/api/reply`.
   - Stop answers "Stop here".
2. **Skip.** At a gate, Skip calls `POST /api/stages {stage, on:false}` for the next stage, then answers
   Continue. Whether the button is enabled comes from the stage profile's `locked` / `why`.
3. **Between sessions.** With no live session, the next primary row is the gate. Continue starts it (as the
   Start panel does today) and Skip turns the stage off first.

**Weakness:** a break point is recognised by matching the wording of the question's options. If a skill
rewords them, the gate quietly turns back into a plain question card.

## Option 2: generic toolbox support (recommended)

Each change is generic: it helps a terminal user as much as Tatty, and does nothing when unset. This
follows the same pattern as `TT_DECIDE`.

1. **`TT_BREAK=elsewhere`.**
   - Read it beside `TT_DECIDE` (`decide.sh:70`), or in a small `breaks.sh mode`.
   - At every break point (tt-workflow steps 3/5, tt-adversarial-plan's Break point, tt-workflow-lite,
     tt-execute after a unit), the skill closes the stage, emits the event below and **ends its turn
     without asking**.
   - The next message decides what happens: `continue`, `skip <stage>` (which runs `stages.sh set <stage>
     off`, then continues) or `stop`.
   - When unset, the skill asks the question as it does today.
2. **Ledger event `workflow.waiting`**, emitted with `tt-event.sh` at the break.
   - Its fields are `{next, skippable, why}`: the next stage, and whether and why it can be skipped,
     taken from `stages.sh show --tsv`.
   - Tatty no longer has to read question text to know a feature is at a gate.
3. **(Optional) `stages.sh skip <stage>`** for a stage that is `In progress` but has nothing written yet.
   - Today `lock_of` refuses it.
   - Required stages stay unskippable.

**Tatty's side of option 2:**
- `launch` (`server.py:4184`) exports `TT_BREAK=elsewhere` with `TT_DECIDE`.
- Add `workflow.waiting` to `MILESTONES` / `announce`, keep the waiting stage on the feature
  (`feature_summary`), and send a new `gate` SSE event so the page redraws at once.
- Make `primary_action` return `{kind: "gate", next, skippable, why, tag}`.
- Continue / Skip / Stop go through the running session's inbox (`state.inbox`, the same path as
  `DECIDE_NUDGE`, `server.py:2301`) as `continue` / `skip <stage>` / `stop`. With no live session,
  Continue starts one on the next row.
- Add `POST /api/gate {name, choice: continue|skip|stop}` so the page has one call to make.

## The page, whichever look wins

- **Restyle.** Restyle `overview()` / `tracker()` in `web/features.js` but keep their signatures, because
  the walks call them directly. Keep the classes and ids the walks read:
  - classes: `.overview`, `.tracker > li.{done,now,todo} .label`, `.substeps .chip`, `.action-main`,
    `.more-options`, `.stand`, `.merge-card`, and `.usage` followed directly by the Timeline;
  - ids: `#start-full`, `#start-lite`, `#step-continue`, `#feature-stages`, `#feature-archive(-more)`,
    `#decide-waiting`, `#commit-card`, `#merge-*`.

  Or update the walks (`tools/features-check.py`) in the same change.
- **Busy check and live nodes.** Keep `refreshFeature`'s busy check (`features.js:759`), and the live
  nodes held by `statusViews`, `usageViews` and `livePanels`.
- **CSP.** No inline styles or `<style>`. Use CSSOM, `adoptedStyleSheets`, the Web Animations API, and SVG
  built in JS. The concept board ignores this because it is never served.
- **Motion.** Add a page Motion setting that defaults to the shop's `tt-juice` switch (`wallet.js:18`). It
  must **not** turn off just because prefers-reduced-motion is set: this machine reports `reduce` with the
  OS animations off. Sounds (`TattySfx.play`) are optional for a gate and for a completed stage.
- **Performance.** Check over RDP at 4K: the glow filters (Neon) and the starfield (Star Chart) are the
  costly parts.
- **Walk checks.** Add checks to `features-check.py --actions/--stages` for the gate card:
  - Continue, Skip and Stop are present;
  - Skip is disabled with a reason on a required stage;
  - Skip calls `/api/stages`.

## Order of work

1. Pick a look on the concept board.
2. Toolbox: `TT_BREAK` and `workflow.waiting`, released as a core/engineering minor version.
3. Tatty: the `gate` action, `/api/gate`, and Skip through `stages.sh`.
4. Tatty: the restyle in the chosen look, with the Motion setting.

## Open questions

- **Skipping a build work unit.** Not covered. Units are validated together, so this probably shouldn't be allowed.
- **"Continue in a new session".** It uses `session-handoff.sh`, which knows nothing about Tatty. Check
  whether the new session joins Tatty (`TATTY_SESSION`), or have Tatty start the new session itself.
- **Lite and quick routes.** On these routes Skip covers less: Explore can't be left out on the lite route.

## Built (Tatty 0.46.0, toolbox core 0.10.0 / engineering 0.8.0)

Option 2, with these differences from the sketch above:

- The wait is a record the toolbox keeps (`<feature>/.tt/break`, `breaks.sh wait|show|answer|take|clear`),
  not only a ledger event; `workflow.waiting` is just the signal that tells Tatty to read it again.
- The answer is recorded by `breaks.sh answer`, and a skip is carried out by the owning script, so the
  model never edits a table to skip: `stages.sh skip-challenge` for an adversary challenge, `stages.sh set
  <stage> off` for a stage. The session reads the answer with `breaks.sh take`.
- What can be skipped goes down to the adversary challenge of each planning stage (the "Continue or Skip the
  challenge?" after Requirements). Requirements, Technical Design, Sign-off and Build still can't be.
- `tt-execute` isn't changed: the unit gate (Commit work / Continue) already is its break.
