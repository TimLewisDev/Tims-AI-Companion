# Demo: Task Breakdown

- **Comprehensive tech plan:** [[Demo - Comprehensive Tech Plan]] (plan read: revision 1, 2026-10-01)
- **Task Status (resume here):** [[Demo - Task Status]]
- **Repo:** `REPO` · base `main` · working branch `feature/demo`
- **Build check:** `bash build.sh`

## Overview
A demo.

## Work Units
| ID | After this unit you can… | Tasks | Validated by | Depends on |
|---|---|---|---|---|
| WU1 | Save settings | T01, T02 | Agent | — |
| WU2 | See a greeting | T03, T04 | Agent + Engineer | WU1 |

## Task Map
| ID | Task | Executor | Depends on | Work unit | Plan step | Traces to |
|---|---|---|---|---|---|---|
| T01 | Add the settings store | Agent | — | WU1 | §1 | R1 |
| T02 | Add the settings loader | Agent | T01 | WU1 | §1 | R2 |
| T03 | Add the greeting | Agent | T02 | WU2 | §2 | R3 |
| T04 | Check the greeting in the tool | Engineer | T03 | WU2 | §2 | R3 |

## Units and Tasks

## WU1 — Save settings

**In plain English:** Settings are kept.

**Validation**
- [ ] It compiles. (plan §1) (Agent)
- [ ] No debug prints remain (Agent)
- [ ] `src/store.sh` exists (Agent)

**How to validate**

```checks
1 | ok | bash build.sh
2 | empty | git grep -n "DEBUG" -- src
3 | ok | test -f src/store.sh
```

- Agent: run the checks block.

### T01 — Add the settings store

**Files** (nothing outside this list)
- new `src/store.sh`: the store

**Steps**
1. Write it.

### T02 — Add the settings loader

**Files** (nothing outside this list)
- new `src/loader.sh`: the loader
- change `src/store.sh`: call the loader

## WU2 — See a greeting

**In plain English:** A greeting appears.

**Validation**
- [ ] It compiles (Agent)
- [ ] The greeting is printed. (plan §2) (Agent + Engineer)
- [ ] The greeting looks right in the tool (Engineer)

**How to validate**

```checks
1 | ok | bash build.sh
2 | nonempty | bash src/greet.sh
```

- Engineer (read out inline at validation time):
  1. Open the tool and run Greet → expect "hello".
  2. Check the colour → expect green.

### T03 — Add the greeting

**Files** (nothing outside this list)
- new `src/greet.sh`: prints the greeting

### T04 — Check the greeting in the tool

**Steps**
1. Open the tool.
