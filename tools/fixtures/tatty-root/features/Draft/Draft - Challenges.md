# Draft: Challenges

- **Comprehensive Tech Plan:** [[Draft - Comprehensive Tech Plan]]
- Each planning stage was challenged by an adversary that saw only the written
  documents and the code, not the conversation. Every challenge was put to the engineer.

## At a glance
| CH | Stage | Severity | Target | Outcome |
|---|---|---|---|---|
| CH1 | Requirements | blocking | R1 | Accepted |
| CH2 | Requirements | minor | R2 | Dismissed |
| CH3 | Scope & Constraints | significant | S1 | Open |

## Requirements — challenged 2026-10-12 @ `a1b2c3d`

**Target:** Requirements R1–R2 · **Lens:** challenge-lens.md · **Found:** 1 blocking, 0 significant, 1 minor

### CH1 — What happens when the disk is full?
- **Severity:** blocking · **Target:** [[Draft - Comprehensive Tech Plan#^r1|R1]]
- **Assumption attacked:** the save always succeeds
- **Why it may be wrong:** the writer never checks the free space, so a full disk
  loses the document without a word.
- **Evidence:** `src/save.sh:12` @ `a1b2c3d`
- **Question for the engineer:** Should a failed save be reported or retried?
- **Outcome:** Accepted
- **Resolution:** 2026-10-12: [[Draft - Comprehensive Tech Plan#^r1|R1]] says it reports the error.

### CH2 — Is the file name unique?
- **Severity:** minor · **Target:** R2
- **Assumption attacked:** two features never share a prefix
- **Why it may be wrong:** the prefix is typed by hand.
- **Evidence:** "Prefix is the feature name" (Requirements)
- **Question for the engineer:** Is a clash worth a check?
- **Outcome:** Dismissed
- **Resolution:** 2026-10-12: minor, not taken up.

**Lens points with nothing serious:** 3, 4

## Scope & Constraints — challenged 2026-10-13 @ `e4f5a6b`

**Target:** S1 · **Lens:** challenge-lens.md · **Found:** 0 blocking, 1 significant, 0 minor

### CH3 — Does "not in scope" cover the tray app?
- **Severity:** significant · **Target:** S1
- **Assumption attacked:** only the page is changed
- **Why it may be wrong:** the tray app hosts the same page.
- **Evidence:** `plugins/tatty/app/companion/` @ `e4f5a6b`
- **Question for the engineer:** Does the tray app need a build?
- **Outcome:** Open
- **Resolution:** —
