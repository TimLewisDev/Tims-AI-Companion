#!/usr/bin/env bash
# test-tatty.sh: smoke tests for Tatty (plugins/tatty/scripts/tatty.sh and
# plugins/tatty/app/server.py), with throwaway state and no window shown.
# Needs bash, curl and Python 3.8+; skips (exit 0) without Python or curl.
# The workflow pages need the TT toolbox: TATTY_TOOLBOX names a Tims-AI-Toolbox
# checkout, else the installed one is used (~/.claude/tt-plugins/core); without
# either, those checks are skipped. Prints one line per check and a count; exit 1
# on failure.
set -u

root=$(cd "$(dirname "$0")/.." && pwd)
W="$root/plugins/tatty/scripts/tatty.sh"
TR="$root/plugins/tatty/scripts/tatty-root.sh"
SRV="$root/plugins/tatty/app/server.py"
T=$(mktemp -d)

# The toolbox, found before CLAUDE_CONFIG_DIR is pointed at the throwaway folder.
if [ -z "${TATTY_TOOLBOX:-}" ] && [ -f "${TT_PLUGINS_HOME:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tt-plugins}/core/skills/tt-common/scripts/workflow-state.sh" ]; then
	export TATTY_TOOLBOX="${TT_PLUGINS_HOME:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tt-plugins}/core"
fi
# Everything else is the tests' own: Tatty's state, the Claude config folder
# (open sessions' names), the events ledger and the workflow's links.
export CLAUDE_CONFIG_DIR="$T/claude" TATTY_HOME="$T/home" TT_EVENTS_HOME="$T/events" TT_WORKFLOW_HOME="$T/workflow"
mkdir -p "$CLAUDE_CONFIG_DIR/sessions"
# A stand-in for Windows' folder dialog: "chooses" what $T/pick-answer says.
printf '#!/usr/bin/env bash\nout=""; while [ $# -gt 0 ]; do [ "$1" = --out ] && out=$2; shift; done\ncat "%s/pick-answer" >"$out" 2>/dev/null\n' "$T" >"$T/picker.sh"
export TATTY_PICKER="$T/picker.sh"
# Start reports the session it would open instead of opening it.
export TATTY_DRYRUN=1
# The updates run the claude command: a stand-in logs what it is asked and, for
# `plugin update`, raises the version in the install record. The server's own
# look at start-up is put off, so only the checks the tests ask for happen.
export TATTY_CLAUDE="$T/claude.sh" TATTY_UPDATE_FIRST=100000
cat >"$T/claude.sh" <<'EOS'
#!/usr/bin/env bash
echo "$*" >>"$(dirname "$0")/claude.log"
[ -f "$(dirname "$0")/claude-fail" ] && { echo "network is down" >&2; exit 1; }
if [ "$1 $2" = "plugin update" ]; then
	sed -i 's/"version":"[^"]*"/"version":"99.0.0"/' "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
fi
exit 0
EOS
# The modes (the toolbox's discipline plugins) the server reports, instead of
# whichever are installed on this machine. installed_modes() itself is checked
# against real pointer folders further down.
export TATTY_MODES=engineering,design
trap 'bash "$W" close >/dev/null 2>&1; rm -rf "$T"' EXIT
pass=0; fail=0

ok() { pass=$((pass + 1)); echo "ok    $1"; }
bad() { fail=$((fail + 1)); echo "FAIL  $1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
# expect <name> <exit code> <command...>: the command exits with the code
expect() { local n=$1 want=$2; shift 2; "$@" >"$T/out" 2>&1; local rc=$?; [ "$rc" = "$want" ] && ok "$n" || bad "$n" "exit $rc, wanted $want: $(head -c 300 "$T/out")"; }
has() { grep -qF -- "$3" "$2" && ok "$1" || bad "$1" "missing: $3"; }
hasnt() { grep -qF -- "$3" "$2" && bad "$1" "unexpected: $3" || ok "$1"; }
finish() { bash "$W" close >/dev/null 2>&1; echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]; exit; }

echo "# tatty.sh"
expect "no Python: exit 3" 3 env TATTY_PYTHON=no-such-python bash "$W" status
if ! bash "$W" status >/dev/null 2>&1 && [ $? = 3 ] || ! command -v curl >/dev/null 2>&1; then
	echo "skip  no Python 3.8+ or no curl: Tatty's tests need both"
	finish
fi
PY=python; command -v python3 >/dev/null 2>&1 && python3 -c 1 2>/dev/null && PY=python3
json() { $PY -c "import json,sys; d=json.load(open(sys.argv[1])); print($2)" "$TATTY_HOME/server.json"; }
# pick <file> <python expression over d>: print what the JSON answer holds
pick() { $PY -c "import json, sys; d = json.load(open(sys.argv[1], encoding='utf-8')); print($2)" "$1"; }
TOOLBOX=0; [ -n "${TATTY_TOOLBOX:-}" ] && TOOLBOX=1

expect "usage" 2 bash "$W"
expect "status before open" 1 bash "$W" status
has "says not open" "$T/out" "not open"
expect "show before open" 1 bash -c "echo hi | bash '$W' show text Hi"
expect "open" 0 bash "$W" open --no-browser
has "prints the URL" "$T/out" "http://127.0.0.1:"
expect "open again reuses it" 0 bash "$W" open --no-browser
expect "status" 0 bash "$W" status
has "attached" "$T/out" "attached"
hasnt "no session yet" "$T/out" "claude mod"
[ -f "$TATTY_HOME/server.json" ] && ok "state in TATTY_HOME" || bad "state in TATTY_HOME"

P=$(json x 'd["port"]'); K=$(json x 'd["token"]'); U="http://127.0.0.1:$P"
get() { curl -s -H "X-TT-Token: $K" "$U$1"; }
post() { curl -s -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "$2" "$U$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

get /api/events >"$T/ev"
has "a fresh window greets" "$T/ev" '"title": "Tatty"'
[ "$(code "$U/api/status")" = 403 ] && ok "no token: 403" || bad "no token: 403"
[ "$(code -H "X-TT-Token: wrong" "$U/api/status")" = 403 ] && ok "wrong token: 403" || bad "wrong token: 403"
[ "$(code -H "Host: evil.example:$P" -H "X-TT-Token: $K" "$U/api/status")" = 403 ] && ok "foreign Host: 403" || bad "foreign Host: 403"
[ "$(code "$U/")" = 200 ] && ok "page served" || bad "page served"
[ "$(code "$U/static/../server.py")" = 404 ] && ok "only the page's files" || bad "only the page's files"
[ "$(code "$U/static/features.js")" = 200 ] && ok "features.js served" || bad "features.js served"
[ "$(code "$U/static/modes.js")" = 200 ] && ok "modes.js served" || bad "modes.js served"
[ "$(code "$U/static/theme.css")" = 200 ] && ok "theme.css served" || bad "theme.css served"
[ "$(code -H "X-TT-Token: $K" "$U/api/view/rm")" = 404 ] && ok "unknown view refused" || bad "unknown view refused"
get /api/status >"$T/st"
[ "$(pick "$T/st" "','.join(d['modes'])")" = "engineering,design" ] &&
	ok "status names the modes installed" || bad "status names the modes installed" "$(head -c 200 "$T/st")"

expect "show" 0 bash -c "printf 'line one\r\n┌─┐ ◉\n' | bash '$W' show markdown 'A title'"
get /api/events >"$T/ev"
has "card kept" "$T/ev" '"title": "A title"'
$PY -c "import json,sys; b=json.load(open(sys.argv[1]))[-1]['body']; sys.exit(b != 'line one\n┌─┐ ◉\n')" "$T/ev" &&
	ok "CRLF folded, UTF-8 kept" || bad "CRLF folded, UTF-8 kept" "$(head -c 200 "$T/ev")"
expect "bad kind refused" 2 bash -c "echo x | bash '$W' show nope T"

Q='{"questions":[{"question":"Go ahead?","header":"Update","multiSelect":false,"options":[{"label":"Go ahead","description":"pull"},{"label":"No","description":"stop"}]}]}'
expect "ask, no answer yet" 5 bash -c "echo '$Q' | bash '$W' ask --wait 1"
has "prints the id" "$T/out" "id="
id=$(sed -n 's/^id=//p' "$T/out")
post /api/reply "{\"id\":\"$id\",\"answers\":{\"Go ahead?\":\"No\"}}" >/dev/null
expect "answer after a reply" 0 bash "$W" answer "$id" --wait 2
has "header and answer" "$T/out" "$(printf 'Update\tNo')"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "{\"id\":\"$id\",\"answers\":{}}" "$U/api/reply")" = 409 ] &&
	ok "answered once only" || bad "answered once only"

( sleep 1; get /api/events | $PY -c "import json,sys; print([e for e in json.load(sys.stdin) if e['type']=='ask'][-1]['id'])" >"$T/qid"
	post /api/reply "{\"id\":\"$(cat "$T/qid")\",\"declined\":true}" >/dev/null ) &
expect "declined: exit 6" 6 bash -c "echo '$Q' | bash '$W' ask --wait 10"
wait
expect "not JSON" 2 bash -c "echo nope | bash '$W' ask"
expect "too few options" 2 bash -c "echo '{\"questions\":[{\"question\":\"Q?\",\"options\":[\"one\"]}]}' | bash '$W' ask"
expect "unknown id" 2 bash "$W" answer nope --wait 0

expect "listen, nothing yet" 5 bash "$W" listen --wait 1
post /api/say '{"text":"which skill for a bug?"}' >/dev/null
expect "listen" 0 bash "$W" listen --wait 2
has "the typed message" "$T/out" "which skill for a bug?"

post /api/hello '{"session":"s1"}' >/dev/null
expect "status with a session" 0 bash "$W" status
has "a session works with Tatty" "$T/out" "attached (claude mod)"

echo "# tatty-root.sh"
expect "no root set: exit 1" 1 env TATTY_HOME="$T/tr" bash "$TR"
has "prints the default" "$T/out" "/Tatty"
expect "relative path refused" 2 env TATTY_HOME="$T/tr" bash "$TR" set some/where
expect "the Claude folder refused" 2 env TATTY_HOME="$T/tr" CLAUDE_CONFIG_DIR="$HOME/.claude" bash "$TR" set "$HOME/.claude/features-here" --create
expect "a missing folder refused" 2 env TATTY_HOME="$T/tr" bash "$TR" set "$T/nope"
expect "set --create" 0 env TATTY_HOME="$T/tr" bash "$TR" set "$T/myroot" --create
[ -d "$T/myroot/features" ] && ok "made the features folder" || bad "made the features folder"
expect "features folder" 0 env TATTY_HOME="$T/tr" bash "$TR" features
has "is under the root" "$T/out" "myroot/features"

echo "# modes"
# Each toolbox plugin points <pointer home>/<plugin> at its install, so the
# pointers say which disciplines are installed; core is the base, not a mode.
mkdir -p "$T/pointers/core" "$T/pointers/engineering" "$T/pointers/production"
$PY - "$SRV" "$T/pointers" >"$T/m" 2>&1 <<'EOF'
import importlib.util, os, sys
for v in ("TATTY_MODES", "TATTY_TOOLBOX"): os.environ.pop(v, None)
os.environ["TT_PLUGINS_HOME"] = sys.argv[2]
spec = importlib.util.spec_from_file_location("srv", sys.argv[1]); m = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True; spec.loader.exec_module(m)
print("pointers:", m.installed_modes())
os.environ["TT_PLUGINS_HOME"] = sys.argv[2] + "-none"
print("none:", m.installed_modes())
os.environ["TATTY_MODES"] = "design, nope ,engineering"
print("forced:", m.installed_modes())
EOF
has "the pointers say which are installed" "$T/m" "pointers: ['engineering', 'production']"
has "none installed" "$T/m" "none: []"
has "TATTY_MODES names them instead" "$T/m" "forced: ['engineering', 'design']"

echo "# without the toolbox"
$PY - "$SRV" "$T/none" >"$T/f" 2>&1 <<'EOF'
import importlib.util, os, sys
os.environ.pop("TATTY_TOOLBOX", None); os.environ["TT_PLUGINS_HOME"] = sys.argv[2]
spec = importlib.util.spec_from_file_location("srv", sys.argv[1]); m = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True; spec.loader.exec_module(m)
print("core:", m.toolbox_core())
class S: cwd = "."; bash = "bash"
print("view:", m.run_view(S, "where", {})["stderr"])
EOF
has "no toolbox found" "$T/f" "core: None"
has "a view says so" "$T/f" "can't find the TT toolbox"

[ "$TOOLBOX" = 1 ] || { echo "skip  the workflow pages: no TT toolbox (set TATTY_TOOLBOX to a Tims-AI-Toolbox checkout)"; finish; }

echo "# toolbox views"
FX="$T/fxroot"; cp -r "$root/tools/fixtures/tatty-root" "$FX"
FX=$(cd "$FX" && { pwd -W 2>/dev/null || pwd; })
D=$(cd "$FX/features/Demo" && { pwd -W 2>/dev/null || pwd; })
get "/api/view/where?dir=$($PY -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$D")" >"$T/view"
has "where view runs workflow-state" "$T/view" 'Demo\tprimary\t'
get "/api/view/hello" >"$T/view"
has "hello view runs the toolbox's banner" "$T/view" '"exit": 0'

echo "# features pages"
DEMO=$($PY -c "import sys, pathlib; print(pathlib.Path(sys.argv[1]).resolve().as_posix())" "$FX/features/Demo")
mkdir -p "$TT_EVENTS_HOME"
printf '{"v":1,"ts":"2026-10-01T09:00:00Z","event":"plan.signed_off","prefix":"Demo","folder":"%s","route":"full","qualifier":"","approx":false}\n' "$DEMO" >"$TT_EVENTS_HOME/events.jsonl"
printf '{"v":1,"ts":"2026-10-02T15:00:00Z","event":"build.unit_validated","prefix":"Demo","folder":"%s","route":"full","qualifier":"WU1","approx":true}\n' "$DEMO" >>"$TT_EVENTS_HOME/events.jsonl"
printf '{"v":1,"ts":"2026-10-03T15:00:00Z","event":"build.complete","prefix":"Other","folder":"C:/somewhere/else","route":"full","qualifier":"","approx":false}\n' >>"$TT_EVENTS_HOME/events.jsonl"
get /api/root >"$T/j"
has "root not set yet" "$T/j" '"isSet": false'
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "{\"path\":\"$(cd "$CLAUDE_CONFIG_DIR" && { pwd -W 2>/dev/null || pwd; })/x\",\"create\":true}" "$U/api/root")" = 400 ] &&
	ok "root in the Claude folder refused" || bad "root in the Claude folder refused"
has "a folder dialog is available" "$T/j" '"picker": true'
: >"$T/pick-answer"
post /api/pick-folder '{"start":""}' >"$T/j"
has "dialog cancelled" "$T/j" '"cancelled": true'
printf '%s/features' "$FX" >"$T/pick-answer"
post /api/pick-folder '{"start":""}' >"$T/j"
has "dialog chose a folder" "$T/j" "fxroot/features"
CHOSEN=$(pick "$T/j" "d['path']")
post /api/root "{\"path\":\"$CHOSEN\"}" >"$T/j"
has "root set" "$T/j" '"isSet": true'
pick "$T/j" "d['root']" >"$T/f"
hasnt "picking a features folder means its parent" "$T/f" "fxroot/features"
has "the parent is the root" "$T/f" "fxroot"
[ -s "$TATTY_HOME/root" ] && ok "the root setting is Tatty's" || bad "the root setting is Tatty's"
get /api/features >"$T/j"
has "the toolbox is found" "$T/j" '"toolbox": true'
pick "$T/j" "'\n'.join(f['name'] + ' ' + f['route'] + ' ' + f['phase'] for f in d['features'])" >"$T/f"
has "Demo is building" "$T/f" "Demo full building"
has "Draft is planning" "$T/f" "Draft full planning"
has "Bugfix is a bug" "$T/f" "Bugfix bug debug-done"
has "Empty is new" "$T/f" "Empty new empty"
pick "$T/j" "[f for f in d['features'] if f['name'] == 'Demo'][0]['tasks']" >"$T/f"
has "Demo's task counts" "$T/f" "{'done': 3, 'total': 4}"
get "/api/feature?name=Demo" >"$T/j"
pick "$T/j" "' | '.join(x['doc'] for x in d['docList'])" >"$T/f"
has "documents in workflow order" "$T/f" "Comprehensive Tech Plan | Task Breakdown | Task Status"
pick "$T/j" "' '.join(u['id'] + ':' + u['status'] for u in d['unitList'])" >"$T/f"
has "work units" "$T/f" "WU1:Done WU2:In Progress"
pick "$T/j" "' '.join(n['file'] for n in d['notes'])" >"$T/f"
has "working notes" "$T/f" ".tt/Demo - Task Status/step-log.md"
pick "$T/j" "' '.join(e['event'] for e in d['events'])" >"$T/f"
has "this feature's events" "$T/f" "plan.signed_off build.unit_validated"
hasnt "not another folder's" "$T/f" "build.complete"
pick "$T/j" "[s['ts'] for s in d['stages'] if s['stage'] == 'Sign-off'][0]" >"$T/f"
has "signed-off stages dated from the ledger" "$T/f" "2026-10-01T09:00:00Z"
pick "$T/j" "d['workflowStep']['skill'] + ' ' + d['workflowStep']['arg']" >"$T/f"
has "every feature can be handed to tt-workflow" "$T/f" "tt-workflow $DEMO"
get "/api/feature?name=Draft" >"$T/j"
pick "$T/j" "' '.join(s['stage'] + '=' + s['status'] for s in d['stages'])" >"$T/f"
has "draft stages from the Stages table" "$T/f" "Scope & Constraints=In progress"
has "skipped stage" "$T/f" "Familiarisation=Skipped"
get "/api/doc?name=Demo&file=Demo%20-%20Task%20Status.md" >"$T/j"
has "a document" "$T/j" "# Status"
[ "$(code -H "X-TT-Token: $K" "$U/api/doc?name=Demo&file=.tt/Demo%20-%20Task%20Status/step-log.md")" = 200 ] && ok "a working note" || bad "a working note"
for f in "..%2FDraft%2FDraft%20-%20Challenges.md" ".tt%2F..%2F..%2FDraft%2FDraft%20-%20Challenges.md" "Demo%20-%20Task%20Status.txt" "%2Fetc%2Fpasswd.md"; do
	[ "$(code -H "X-TT-Token: $K" "$U/api/doc?name=Demo&file=$f")" = 403 ] && ok "refused: $f" || bad "refused: $f"
done
for n in "Nope" "..%2Ftatty-root" ".tt"; do
	[ "$(code -H "X-TT-Token: $K" "$U/api/feature?name=$n")" = 404 ] && ok "no feature: $n" || bad "no feature: $n"
done
get "/api/resolve?name=Draft&target=Draft%20-%20Challenges" >"$T/j"
has "a link to this feature's document" "$T/j" '"name": "Draft", "file": "Draft - Challenges.md"'
get "/api/resolve?name=Draft&target=demo%20-%20task%20status" >"$T/j"
has "a link to another feature's, any case" "$T/j" '"name": "Demo", "file": "Demo - Task Status.md"'
get "/api/resolve?name=Draft&target=some%2Fpath%2FDemo%20-%20Task%20Breakdown.md" >"$T/j"
has "a link with a path and .md" "$T/j" '"file": "Demo - Task Breakdown.md"'
get "/api/resolve?name=Demo&target=step-log" >"$T/j"
has "a link to a working note" "$T/j" '"file": ".tt/Demo - Task Status/step-log.md"'
[ "$(code -H "X-TT-Token: $K" "$U/api/resolve?name=Draft&target=No%20Such%20Doc")" = 404 ] && ok "a link to nothing: 404" || bad "a link to nothing: 404"

echo "# editing a document"
CH="$FX/features/Draft/Draft - Challenges.md"
CHF="Draft%20-%20Challenges.md"
get "/api/doc?name=Draft&file=$CHF" >"$T/j"
STAMP=$(pick "$T/j" "d['updated']")
# save <file> <expected mtime> <text, as a JSON string>
save() { post /api/doc/save "{\"name\":\"Draft\",\"file\":\"$1\",\"expected\":$2,\"text\":$3}"; }
save "Draft - Challenges.md" "$STAMP" '"# Draft: Challenges\n\nedited\n"' >"$T/j"
has "a saved document answers with its new mtime" "$T/j" '"updated"'
has "and is written to the file" "$CH" "edited"
get "/api/doc?name=Draft&file=$CHF" >"$T/j"
has "and read back" "$T/j" "edited"
save "Draft - Challenges.md" "$STAMP" '"stale"' >"$T/j"
has "a save over a newer file is refused" "$T/j" "changed on disk"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "{\"name\":\"Draft\",\"file\":\"Draft - Challenges.md\",\"expected\":$STAMP,\"text\":\"stale\"}" "$U/api/doc/save")" = 409 ] &&
	ok "as a 409" || bad "as a 409"
hasnt "and the file is left alone" "$CH" "stale"
mkdir -p "$FX/features/Draft/.tt"
printf 'one\r\ntwo\r\n' >"$FX/features/Draft/.tt/crlf.md"
get "/api/doc?name=Draft&file=.tt%2Fcrlf.md" >"$T/j"
save ".tt/crlf.md" "$(pick "$T/j" "d['updated']")" '"x\ny\n"' >"$T/j"
has "a note with CRLF line ends is saved" "$T/j" '"updated"'
[ "$($PY -c "import sys; print(open(sys.argv[1], 'rb').read())" "$FX/features/Draft/.tt/crlf.md")" = "b'x\\r\\ny\\r\\n'" ] &&
	ok "and keeps its CRLF" || bad "and keeps its CRLF"
[ -z "$(ls -A "$FX/features/Draft" "$FX/features/Draft/.tt" | grep tatty-tmp)" ] && ok "no temp file left behind" || bad "no temp file left behind"
for f in "../Demo/Demo - Task Status.md" "Draft - Challenges.txt" "/etc/passwd.md" ".tt/../../Demo/Demo - Task Status.md" "No Such.md"; do
	[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "{\"name\":\"Draft\",\"file\":\"$f\",\"expected\":1,\"text\":\"x\"}" "$U/api/doc/save")" = 403 ] &&
		ok "save refused: $f" || bad "save refused: $f"
done
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"name":"Nope","file":"a.md","expected":1,"text":"x"}' "$U/api/doc/save")" = 404 ] &&
	ok "save: no such feature" || bad "save: no such feature"
for body in '{"name":"Draft","file":"Draft - Challenges.md","expected":1}' '{"name":"Draft","file":"Draft - Challenges.md","expected":1,"text":5}' \
	'{"name":"Draft","file":"Draft - Challenges.md","text":"x"}' '{"name":"Draft","file":"Draft - Challenges.md","expected":"1","text":"x"}'; do
	[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "$body" "$U/api/doc/save")" = 400 ] &&
		ok "save needs text and the mtime" || bad "save needs text and the mtime" "$body"
done
[ "$(code -H 'Content-Type: application/json' -d '{"name":"Draft","file":"Draft - Challenges.md","expected":1,"text":"x"}' "$U/api/doc/save")" = 403 ] &&
	ok "save needs the token" || bad "save needs the token"
BIG="$T/big.json"; $PY -c "import json, sys; print(json.dumps({'name': 'Draft', 'file': 'Draft - Challenges.md', 'expected': 1, 'text': 'x' * 1100000}))" >"$BIG"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' --data-binary "@$BIG" "$U/api/doc/save")" = 400 ] &&
	ok "a document over 1 MB is refused" || bad "a document over 1 MB is refused"
[ "$(code "$U/static/views.js")" = 200 ] && ok "views.js is served" || bad "views.js is served"
[ "$(code "$U/static/usage.js")" = 200 ] && ok "usage.js is served" || bad "usage.js is served"

echo "# a new feature"
post /api/new-feature '{"name":"Shiny Thing"}' >"$T/j"
has "made" "$T/j" '"name": "Shiny Thing"'
[ -d "$FX/features/Shiny Thing" ] && ok "in Tatty's features folder" || bad "in Tatty's features folder"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"name":"Demo"}' "$U/api/new-feature")" = 409 ] &&
	ok "a feature with documents isn't remade" || bad "a feature with documents isn't remade"
for n in "a/b" "" ".." "what?"; do
	[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "{\"name\":\"$n\"}" "$U/api/new-feature")" = 400 ] &&
		ok "refused name: '$n'" || bad "refused name: '$n'"
done

echo "# starting the next step"
HERE=$(cd "$root" && { pwd -W 2>/dev/null || pwd; })
get "/api/feature?name=Demo" >"$T/j"
has "no project known yet" "$T/j" '"project": null'
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"name":"Demo","row":0}' "$U/api/start")" = 400 ] &&
	ok "start refused without a project" || bad "start refused without a project"
mkdir -p "$TT_WORKFLOW_HOME"
printf '%s\t%s\t2026-10-20\n' "$HERE" "$FX/features/Demo" >"$TT_WORKFLOW_HOME/links.tsv"
get "/api/feature?name=Demo" >"$T/j"
has "project from the tt-workflow link" "$T/j" '"projectFrom": "link"'
post /api/start '{"name":"Demo","row":0}' >"$T/j"
has "starts" "$T/j" '"ok": true'
has "session named feature : stage" "$T/j" '"name": "Demo : Build"'
has "with the next command" "$T/j" '/tt-execute \"'
has "Tatty's own launcher" "$T/j" "Prompt: /tt-execute"
has "the session carries its tag" "$T/j" "TATTY_SESSION="
has "and, from a checkout, loads this plugin" "$T/j" "--plugin-dir"
mkdir -p "$CLAUDE_CONFIG_DIR/plugins"
printf '{"version":2,"plugins":{"tatty@tims-ai-companion":[{"scope":"user","installPath":"x"}]}}' >"$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
post /api/start '{"name":"Demo","row":0}' >"$T/j"
hasnt "once installed at user scope, no --plugin-dir" "$T/j" "--plugin-dir"
rm -f "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
printf '{"pid":1,"name":"Demo : Build"}' >"$CLAUDE_CONFIG_DIR/sessions/1.json"
post /api/start '{"name":"Demo","row":0}' >"$T/j"
has "a name an open session has gets a number" "$T/j" '"name": "Demo : Build (2)"'
rm -f "$CLAUDE_CONFIG_DIR/sessions/1.json"
post /api/start '{"name":"Demo","row":"workflow"}' >"$T/j"
has "handed to tt-workflow" "$T/j" '"name": "Demo : Workflow"'
has "with the workflow's own command" "$T/j" "/tt-workflow \\\""
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "{\"name\":\"Empty\",\"row\":0,\"project\":\"$HERE\"}" "$U/api/start")" = 400 ] &&
	ok "a placeholder must be filled" || bad "a placeholder must be filled"
post /api/start "{\"name\":\"Empty\",\"row\":0,\"project\":\"$HERE\",\"values\":{\"idea, spec or ticket\":\"a settings page\"}}" >"$T/j"
has "an empty feature starts" "$T/j" '"name": "Empty : Start"'
has "with the placeholder filled" "$T/j" "/tt-adversarial-plan a settings page"
get "/api/feature?name=Empty" >"$T/j"
has "the chosen project is remembered" "$T/j" '"projectFrom": "chosen"'
post /api/project "{\"name\":\"Draft\",\"path\":\"$HERE\"}" >"$T/j"
has "a project can be chosen" "$T/j" '"projectFrom": "chosen"'
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"name":"Draft","path":"C:/no/such/place"}' "$U/api/project")" = 400 ] &&
	ok "a missing project folder refused" || bad "a missing project folder refused"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"name":"Demo","row":7}' "$U/api/start")" = 400 ] &&
	ok "no such step" || bad "no such step"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"name":"Nope","row":0}' "$U/api/start")" = 404 ] &&
	ok "no such feature" || bad "start: no such feature"

echo "# a started session, live"
post /api/start '{"name":"Demo","row":0}' >"$T/j"
TAG=$(pick "$T/j" "d['tag']")
case $TAG in s-*) ok "the session has a tag" ;; *) bad "the session has a tag" "$(cat "$T/j")" ;; esac
get "/api/sessions?name=Demo" >"$T/j"
has "listed for the feature, starting" "$T/j" "\"tag\": \"$TAG\""
has "starting" "$T/j" '"status": "starting"'
get /api/features >"$T/j"
pick "$T/j" "[f for f in d['features'] if f['name'] == 'Demo'][0]['live']" >"$T/f"
has "the home card shows it live" "$T/f" "'name': 'Demo : Build'"
post /api/hello "{\"session\":\"abc\",\"tag\":\"$TAG\"}" >/dev/null
get "/api/feature?name=Demo" >"$T/j"
pick "$T/j" "[s['status'] for s in d['sessions'] if s['tag'] == '$TAG'][0]" >"$T/f"
has "running once its mod says hello" "$T/f" "running"
get /api/status >"$T/j"
hasnt "a started session isn't the main one" "$T/j" '"session": "abc"'
post /api/activity "{\"tag\":\"$TAG\",\"kind\":\"tool\",\"tool\":\"Read\",\"text\":\"Demo - Task Status.md\",\"id\":\"t1\"}" >/dev/null
post /api/activity "{\"tag\":\"$TAG\",\"kind\":\"tool-done\",\"tool\":\"Read\",\"id\":\"t1\",\"ok\":true}" >/dev/null
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "{\"tag\":\"$TAG\",\"kind\":\"nope\"}" "$U/api/activity")" = 400 ] &&
	ok "unknown activity refused" || bad "unknown activity refused"
get /api/events >"$T/j"
pick "$T/j" "' '.join(e['kind'] + ':' + e['tool'] for e in d if e['type'] == 'activity' and e['tag'] == '$TAG')" >"$T/f"
has "its activity, tagged" "$T/f" "tool:Read tool-done:Read"
get "/api/sessions?name=Demo" >"$T/j"
has "what it is doing" "$T/j" '"doing": "Read Demo - Task Status.md"'
pick "$T/j" "[s['usage'] for s in d if s['tag'] == '$TAG'][0]" >"$T/f"
has "no usage before the first report" "$T/f" "None"
post /api/activity "{\"tag\":\"$TAG\",\"kind\":\"usage\",\"usage\":{\"input\":1200,\"output\":340,\"cacheRead\":50000,\"cacheWrite\":800,\"model\":\"m\",\"context\":{\"tokens\":52000,\"window\":200000},\"costUsd\":0.42}}" >/dev/null
get "/api/sessions?name=Demo" >"$T/j"
pick "$T/j" "[s['usage'] for s in d if s['tag'] == '$TAG'][0]" >"$T/f"
has "its usage totals are kept" "$T/f" "'input': 1200, 'output': 340, 'cacheRead': 50000, 'cacheWrite': 800"
has "the context window" "$T/f" "'context': {'window': 200000, 'tokens': 52000}"
has "the cost" "$T/f" "'costUsd': 0.42"
get /api/events >"$T/j"
pick "$T/j" "[e['usage']['input'] for e in d if e['type'] == 'session' and e['tag'] == '$TAG' and e.get('usage')][-1]" >"$T/f"
has "a session event carries it to the page" "$T/f" "1200"
pick "$T/j" "len([e for e in d if e['type'] == 'activity' and e['kind'] == 'usage'])" >"$T/f"
has "usage is not a row in the feed" "$T/f" "0"
post /api/activity "{\"tag\":\"$TAG\",\"kind\":\"usage\",\"usage\":{\"input\":-5,\"output\":\"x\",\"cacheRead\":2.9,\"costUsd\":-1}}" >/dev/null
get "/api/sessions?name=Demo" >"$T/j"
pick "$T/j" "[s['usage'] for s in d if s['tag'] == '$TAG'][0]" >"$T/f"
has "bad counts are made safe" "$T/f" "'input': 0, 'output': 0, 'cacheRead': 2, 'cacheWrite': 0"
hasnt "and a negative cost dropped" "$T/f" "costUsd"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"tag":"s-nope","kind":"usage","usage":{}}' "$U/api/activity")" = 404 ] &&
	ok "usage for an unknown session refused" || bad "usage for an unknown session refused"
post /api/activity "{\"tag\":\"$TAG\",\"kind\":\"usage\",\"usage\":{\"input\":1200,\"output\":340,\"cacheRead\":50000,\"cacheWrite\":800,\"context\":{\"tokens\":52000,\"window\":200000},\"costUsd\":0.42}}" >/dev/null
post /api/ask "{\"tag\":\"$TAG\",\"questions\":[{\"question\":\"Carry on?\",\"header\":\"Go\",\"options\":[\"Yes\",\"No\"]}]}" >/dev/null
get /api/events >"$T/j"
pick "$T/j" "[e['source'] + '|' + e['tag'] for e in d if e['type'] == 'ask'][-1]" >"$T/f"
has "its question, named for the session" "$T/f" "Demo : Build|$TAG"
post /api/say "{\"tag\":\"$TAG\",\"text\":\"use the new folder\"}" >/dev/null
expect "the main inbox doesn't get it" 5 bash "$W" listen --wait 1
get "/api/inbox?wait=1&tag=$TAG&client=claude-mod" >"$T/j"
has "the session's inbox does" "$T/j" "use the new folder"
post /api/bye "{\"tag\":\"$TAG\"}" >/dev/null
get "/api/sessions?name=Demo" >"$T/j"
pick "$T/j" "[s['status'] for s in d if s['tag'] == '$TAG'][0]" >"$T/f"
has "ended" "$T/f" "ended"
get /api/features >"$T/j"
pick "$T/j" "[f for f in d['features'] if f['name'] == 'Demo'][0]['live']" >"$T/f"
hasnt "no longer live" "$T/f" "$TAG"
get /api/events >"$T/j"
pick "$T/j" "[e['feature'] for e in d if e['type'] == 'ask'][-1]" >"$T/f"
has "a started session's question is about its feature" "$T/f" "Demo"

echo "# planning IDs"
# (the Challenges as the fixture has them, not as the editing checks left them: a changed file is read again)
cp "$root/tools/fixtures/tatty-root/features/Draft/Draft - Challenges.md" "$FX/features/Draft/"
get "/api/items?name=Draft" >"$T/j"
if grep -q '"ids": {}' "$T/j"; then
	echo "skip  planning IDs: this toolbox's ids.sh has no index command"
else
	pick "$T/j" "' '.join(k + ':' + v['form'] + ':' + v['file'] for k, v in sorted(d['ids'].items()))" >"$T/f"
	has "a challenge is its heading in the Challenges" "$T/f" "CH1:heading:Draft - Challenges.md"
	has "a requirement is a plan item" "$T/f" "R1:item:Draft - Comprehensive Tech Plan.md"
	has "a decision is a plan row" "$T/f" "CD1:row:Draft - Comprehensive Tech Plan.md"
	has "a proposal is its heading in the Tech Proposals" "$T/f" "P1:heading:Draft - Tech Proposals.md"
	hasnt "an ID only cited isn't an item" "$T/f" "S1:"
	get "/api/item?name=Draft&id=CH1" >"$T/j"
	pick "$T/j" "d['doc'] + '|' + d['title'] + '|' + str('**Severity:** blocking' in d['block'])" >"$T/f"
	has "a challenge's card is its section" "$T/f" "Challenges|What happens when the disk is full?|True"
	hasnt "and stops at the next challenge" "$T/j" "CH2"
	get "/api/item?name=Draft&id=CD1" >"$T/j"
	pick "$T/j" "dict(d['fields'])['Outcome']" >"$T/f"
	has "a row's card has its cells by column" "$T/f" "It is shown, never retried"
	get "/api/item?name=Demo&id=R1" >"$T/j"
	pick "$T/j" "d['form'] + '|' + d['block']" >"$T/f"
	has "a requirement without a block id is still found" "$T/f" "item|- **R1:** Settings are kept between runs."
	get "/api/item?name=Demo&id=T01" >"$T/j"
	pick "$T/j" "d['doc'] + '|' + d['title']" >"$T/f"
	has "a task is its card in the breakdown" "$T/f" "Task Breakdown|Add the settings store"
	[ "$(code -H "X-TT-Token: $K" "$U/api/item?name=Draft&id=R9")" = 404 ] && ok "an ID the feature doesn't define: 404" || bad "an ID the feature doesn't define: 404"
	[ "$(code -H "X-TT-Token: $K" "$U/api/items?name=Nope")" = 404 ] && ok "items of no feature: 404" || bad "items of no feature: 404"
fi
# A session Tatty didn't start: its project (the folder it runs in, from its
# <pid>.json) is linked to a feature by tt-workflow, so its questions are about that one.
printf '{"pid":2,"sessionId":"sess-ids","cwd":"%s/plugins/tatty"}' "$HERE" >"$CLAUDE_CONFIG_DIR/sessions/2.json"
post /api/ask '{"session":"sess-ids","questions":[{"question":"Is R1 done?","options":["Yes","No"]}]}' >/dev/null
post /api/ask '{"session":"sess-elsewhere","questions":[{"question":"Is R2 done?","options":["Yes","No"]}]}' >/dev/null
get /api/events >"$T/j"
pick "$T/j" "' '.join([repr(e['feature']) for e in d if e['type'] == 'ask'][-2:])" >"$T/f"
has "a linked project's question is about its feature, one elsewhere about none" "$T/f" "'Demo' ''"
rm -f "$CLAUDE_CONFIG_DIR/sessions/2.json"

echo "# the desktop app"
# boot is what the Desktop shortcut runs: it reuses the open window and starts
# Tatty's own Claude session (reported, not opened, under TATTY_DRYRUN).
mkdir -p "$T/proj" "$T/proj2"
PROJ=$(cd "$T/proj" && { pwd -W 2>/dev/null || pwd; }); PROJ2=$(cd "$T/proj2" && { pwd -W 2>/dev/null || pwd; })
post /api/bye '{}' >/dev/null # no session is working with Tatty yet
expect "boot" 0 bash "$W" boot --no-browser --project "$PROJ"
has "starts Tatty's own session" "$T/out" "claude=started"
has "in a window of its own, with a fixed title" "$T/out" "Title: Tatty (Claude)"
has "joined to Tatty" "$T/out" "TATTY_JOIN=1"
hasnt "but not as a feature's session" "$T/out" "TATTY_SESSION"
has "a new conversation starts with an id of its own" "$T/out" "--session-id"
pick "$TATTY_HOME/claude-link.json" "d['project']" >"$T/f"
has "the link remembers the project" "$T/f" "proj"
SID=$(pick "$TATTY_HOME/claude-link.json" "d['sessionId']")
expect "boot again" 0 bash "$W" boot --no-browser
has "the same conversation" "$T/out" "$SID"
hasnt "not yet kept by Claude Code, so not resumed" "$T/out" "--resume"
mkdir -p "$CLAUDE_CONFIG_DIR/projects/x"; : >"$CLAUDE_CONFIG_DIR/projects/x/$SID.jsonl"
expect "boot after the conversation has begun" 0 bash "$W" boot --no-browser
has "resumes it" "$T/out" "--resume $SID"
expect "boot in another project" 0 bash "$W" boot --no-browser --project "$PROJ2"
hasnt "is another conversation" "$T/out" "$SID"
expect "boot refuses a folder that isn't there" 2 bash "$W" boot --no-browser --project "$PROJ/nope"
expect "boot without Claude" 0 bash "$W" boot --no-browser --no-claude
hasnt "starts no session" "$T/out" "claude="
post /api/hello '{"session":"s1"}' >/dev/null
expect "boot with a session already working with Tatty" 0 bash "$W" boot --no-browser
has "leaves it be" "$T/out" "claude=already attached"
post /api/bye '{}' >/dev/null

echo "# milestones"
# The toolbox records a feature's progress in its own ledger as it happens, and
# knows nothing of Tatty. Tatty follows the file and celebrates what it says.
ledger() {
	printf '{"v":1,"ts":"2026-10-04T10:00:00Z","event":"%s","key":"%s|%s","prefix":"%s","folder":"%s","route":"full","qualifier":"%s","approx":false}\n' \
		"$1" "$1" "${2:-}" "${3:-Demo}" "$DEMO" "${2:-}" >>"$TT_EVENTS_HOME/events.jsonl"
}
# waitfor <text>: the events have it within ten seconds (the watcher looks every
# LEDGER_POLL seconds, so nothing here can be immediate)
waitfor() {
	local i=0
	while [ $i -lt 20 ]; do
		get /api/events >"$T/ev"
		grep -qF -- "$1" "$T/ev" && return 0
		sleep 0.5
		i=$((i + 1))
	done
	return 1
}
# milestone <name> <python test over the one milestone event with that prefix>
milestone() {
	$PY -c "import json, sys
events = [e for e in json.load(open(sys.argv[1], encoding='utf-8')) if e['type'] == 'milestone' and e.get('prefix') == sys.argv[2]]
sys.exit(0 if len(events) == 1 and ($3) else 1)" "$T/ev" "$2" && ok "$1" || bad "$1" "$(grep -c milestone "$T/ev") milestone events"
}

ledger build.unit_validated WU7 Wunit
waitfor '"qualifier": "WU7"' && ok "a work unit validated is announced" || bad "a work unit validated is announced"
milestone "with what it was and how big a thing" Wunit \
	"events[0]['label'] == 'Work unit validated' and events[0]['tier'] == 'mid' and events[0]['qualifier'] == 'WU7'"
ledger build.unit_validated WU7 Wunit  # the same key again: the toolbox re-reconciled
sleep "$((2 * 2))"
get /api/events >"$T/ev"
milestone "announced once per key" Wunit "events[0]['qualifier'] == 'WU7'"
ledger nonsense.event "" Nonsense
sleep "$((2 * 2))"
get /api/events >"$T/ev"
hasnt "an event it doesn't know is ignored" "$T/ev" "nonsense.event"

post /api/milestone '{"event":"plan.signed_off","prefix":"Zed"}' >"$T/j"
has "a milestone to order" "$T/j" '"seq"'
get /api/events >"$T/ev"
milestone "signing a plan off is the big one" Zed \
	"events[0]['label'] == 'Plan signed off' and events[0]['tier'] == 'big'"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"event":"nope"}' "$U/api/milestone")" = 400 ] &&
	ok "an unknown milestone refused" || bad "an unknown milestone refused"
expect "cheer" 0 bash "$W" cheer plan.approach_closed --prefix Cheered
get /api/events >"$T/ev"
milestone "cheer celebrates a step" Cheered \
	"events[0]['label'] == 'Approach closed' and events[0]['tier'] == 'small'"
expect "cheer needs an event it knows" 2 bash "$W" cheer not-an-event

# A window that has just opened says nothing of what was finished before it: the
# watcher starts from the end of the ledger as it stands, or Tatty would arrive
# in the middle of a party for last week's work.
bash "$W" close >/dev/null 2>&1
sleep 1
expect "open again, with a ledger already full" 0 bash "$W" open --no-browser
P=$(json x 'd["port"]'); K=$(json x 'd["token"]'); U="http://127.0.0.1:$P"
sleep "$((2 * 2))"
get /api/events >"$T/ev"
hasnt "the ledger's history isn't celebrated" "$T/ev" '"type": "milestone"'
ledger build.complete "" Fresh
waitfor '"prefix": "Fresh"' && ok "but the next milestone is" || bad "but the next milestone is"

echo "# settings and updates"
get /api/settings >"$T/set"
[ "$(pick "$T/set" "d['autoUpdate']")" = True ] && ok "auto-update is on by default" || bad "auto-update is on by default" "$(head -c 200 "$T/set")"
[ "$(pick "$T/set" "d['update']['status']")" = idle ] && ok "no update looked for yet" || bad "no update looked for yet"
post /api/settings '{"autoUpdate":false,"nonsense":1}' >"$T/set"
[ "$(pick "$T/set" "d['autoUpdate']")" = False ] && ok "auto-update turned off" || bad "auto-update turned off" "$(head -c 200 "$T/set")"
hasnt "unknown settings not kept" "$TATTY_HOME/settings.json" nonsense
post /api/settings '{"autoUpdate":"yes"}' >"$T/set"
[ "$(pick "$T/set" "d['autoUpdate']")" = False ] && ok "a wrong type is ignored" || bad "a wrong type is ignored"
post /api/settings '{"autoUpdate":true}' >/dev/null
has "the choice is kept in Tatty's home" "$TATTY_HOME/settings.json" '"autoUpdate": true'
[ "$(code "$U/static/settings.js")" = 200 ] && ok "settings.js served" || bad "settings.js served"

# Run from a checkout (no install record), there is nothing to update.
upd_wait() { for _ in $(seq 1 50); do get /api/settings >"$T/set"; case $(pick "$T/set" "d['update']['status']") in checking|updating) sleep 0.2 ;; *) return 0 ;; esac; done; return 1; }
post /api/update '{"action":"check"}' >/dev/null; upd_wait
[ "$(pick "$T/set" "d['update']['status']")" = checkout ] && ok "a checkout has nothing to update" || bad "a checkout has nothing to update" "$(head -c 300 "$T/set")"

# An install of this very version, from a marketplace that offers 99.0.0.
HAVE=$($PY -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$root/plugins/tatty/.claude-plugin/plugin.json")
mkdir -p "$CLAUDE_CONFIG_DIR/plugins" "$T/market/.claude-plugin" "$T/market/plugins/tatty/.claude-plugin"
printf '{"version":2,"plugins":{"tatty@fake-market":[{"scope":"user","version":"%s"}]}}' "$HAVE" >"$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
printf '{"fake-market":{"installLocation":"%s"}}' "$(cygpath -m "$T/market" 2>/dev/null || echo "$T/market")" >"$CLAUDE_CONFIG_DIR/plugins/known_marketplaces.json"
printf '{"name":"fake-market","plugins":[{"name":"tatty","source":"./plugins/tatty"}]}' >"$T/market/.claude-plugin/marketplace.json"
printf '{"name":"tatty","version":"99.0.0"}' >"$T/market/plugins/tatty/.claude-plugin/plugin.json"
post /api/update '{"action":"check"}' >/dev/null; upd_wait
[ "$(pick "$T/set" "d['update']['status']")" = available ] && ok "a newer version is found" || bad "a newer version is found" "$(head -c 300 "$T/set")"
[ "$(pick "$T/set" "d['update']['available']")" = 99.0.0 ] && ok "and named" || bad "and named"
has "the marketplace was refreshed first" "$T/claude.log" "plugin marketplace update fake-market"
hasnt "checking installs nothing" "$T/claude.log" "plugin update"
post /api/update '{"action":"apply"}' >/dev/null; upd_wait
[ "$(pick "$T/set" "d['update']['status']")" = ready ] && ok "installed: ready for a restart" || bad "installed: ready for a restart" "$(head -c 300 "$T/set")"
has "claude installed it for the user" "$T/claude.log" "plugin update tatty@fake-market --scope user"
has "the page is told to restart" "$T/set" "Restart Tatty"
get /api/events >"$T/ev"
has "the page hears of it" "$T/ev" '"type": "update"'
post /api/update '{"action":"check"}' >/dev/null; upd_wait
[ "$(pick "$T/set" "d['update']['status']")" = ready ] && ok "still ready until restarted" || bad "still ready until restarted"
touch "$T/claude-fail"
printf '{"version":2,"plugins":{"tatty@fake-market":[{"scope":"user","version":"%s"}]}}' "$HAVE" >"$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
post /api/update '{"action":"check"}' >/dev/null; upd_wait
[ "$(pick "$T/set" "d['update']['status']")" = error ] && ok "a failed refresh is an error" || bad "a failed refresh is an error" "$(head -c 300 "$T/set")"
has "with claude's words" "$T/set" "network is down"
rm -f "$T/claude-fail"

echo "# close"
expect "close" 0 bash "$W" close
sleep 1
expect "status after close" 1 bash "$W" status

finish
