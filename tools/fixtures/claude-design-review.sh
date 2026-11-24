#!/usr/bin/env bash
# A stand-in for `claude -p` on a design document's review (features-check.py --documents, and by hand): it does what
# the tt-design-review skill does, writing two suggestions through design-review.sh, and reports it as stream-json.
# It finds the script through TATTY_TOOLBOX (a toolbox checkout) or DR_SCRIPT.
DR=${DR_SCRIPT:-}
[ -n "$DR" ] || DR="${TATTY_TOOLBOX:?set TATTY_TOOLBOX or DR_SCRIPT}/plugins/design/skills/tt-design-review/scripts/design-review.sh"
prompt=$(cat)
say() { printf '%s\n' "$1"; }
tool() { say "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"bash design-review.sh $1\"}}]}}"; }
say '{"type":"system","subtype":"init"}'
# a User Stories draft (Break into user stories): nothing to write here, only a run that finishes
case "$prompt" in *tt-user-stories*) say '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0,"result":"ok"}'; exit 0 ;; esac
sleep 1 >/dev/null
doc=$(printf '%s' "$prompt" | sed 's/^[^"]*"\([^"]*\)" "\([^"]*\)".*$/\1/')
rev=$(printf '%s' "$prompt" | sed 's/^[^"]*"\([^"]*\)" "\([^"]*\)".*$/\2/')
[ -f "$rev" ] || { tool init; bash "$DR" init "$doc" "$rev" >/dev/null; }
tool add
bash "$DR" add "$rev" - >/dev/null <<'SPEC'
area: Full bag behaviour
where: Pickup
why: The Pickup section never says what happens when the bag is full.
wording:
  When the bag is full the item stays on the ground and a message says "Bag full".

  - Never drops an item automatically.
---
area: Rollout
why: Nothing says how this ships.
wording:
  Ship behind a flag and turn it on for everyone once the numbers look right.
SPEC
say '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.0123,"result":"Added."}'
