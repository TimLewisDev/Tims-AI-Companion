# Demo: Comprehensive Tech Plan

- Status: Signed off
- Revision: 2
- Base branch: `main`

## Requirements
- **R1:** Settings are kept between runs.
- **R2:** Settings load at start.
- **R3:** A greeting is shown.

## Scope / Non-Goals
- Not a settings editor.

## Implementation Plan

### §1. Settings store
**Files:**
- new `src/store.sh`
- new `src/loader.sh`

**Done when:**
- It compiles. (R1)
- After a restart:
  - the settings are still there. (R1)
  - the loader ran once. (R2)

### §2. Greeting
**Files:**
- new `src/greet.sh`

**Done when:**
- The greeting is printed. (R3)

## Affected Files
| File | Status | Area |
|---|---|---|
| `src/{store, loader}.sh` | new | settings |
| `src/greet.sh` | new | greeting |
| `build.sh` | **unchanged** | — |

## Change Log
| Rev | Date | Change |
|---|---|---|
| 1 | 2026-10-01 | Signed off |
| 2 | 2026-10-05 | §2 adds a greeting constant |
