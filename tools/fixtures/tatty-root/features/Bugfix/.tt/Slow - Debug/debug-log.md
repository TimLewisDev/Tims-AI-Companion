# Debug Log: the greeting is empty when the name is unset

- **Symptom:** "The greeting says nothing when no name is set."
- **Expected:** "hello" is printed · **Actual:** nothing is printed
- **Reproduction:** run `bash src/greet.sh` with the name unset; always
- **Since / last good:** unknown
- **Folder:** `tatty-root/features/Bugfix` · **Prefix:** Slow
- **Repo:** `REPO`
- **Target:** working tree @ `abc1234` (clean), 2026-10-12
- **Status:** Root cause confirmed 2026-10-12 · **Next:** -

## In short
The greeting script prints the name it was given, and when no name is given it prints an empty line instead of the default. The default only exists in a comment.

## Hypotheses
| ID | Hypothesis | Status | For | Against | Next test |
|---|---|---|---|---|---|
| H1 | The script never falls back to a default name | Root cause | `src/greet.sh:1` prints the variable unguarded | none | run it with the name set and unset |
| H2 | The caller passes an empty string (engineer's) | Ruled out | none | the script prints nothing even when called with no arguments at all (`src/greet.sh:1`) | call it with no arguments |

## Observations
- The only line of the script prints the variable directly (`src/greet.sh:1`).

## Experiments
| # | What was tried | Who | Result | Points to |
|---|---|---|---|---|
| 1 | `bash src/greet.sh` with the name unset | engineer | printed nothing | H1 supported |
| 2 | `bash src/greet.sh` with no arguments | agent | printed nothing | H2 ruled out |

## Temporary edits
Every line added for debugging carries the marker `TT-DEBUG-TEMP`.
| Path | What | Removed |
|---|---|---|
| `src/greet.sh` | printed the variable's value | yes |

## Root cause
`src/greet.sh:1` prints the name variable without a fallback, so an unset name prints an empty line. Setting the name makes the greeting appear again; unsetting it brings the problem back.

## Fix direction
Give the variable a default of "hello".

## Open questions
- None
