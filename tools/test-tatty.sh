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
printf '#!/usr/bin/env bash\necho "$*" >>"%s/picker.log"\nout=""; while [ $# -gt 0 ]; do [ "$1" = --out ] && out=$2; shift; done\ncat "%s/pick-answer" >"$out" 2>/dev/null\n' "$T" "$T" >"$T/picker.sh"
export TATTY_PICKER="$T/picker.sh"
# Start reports the session it would open instead of opening it.
export TATTY_DRYRUN=1
# The updates run the claude command: a stand-in logs what it is asked and, for
# `plugin update`, raises the version in the install record. The server's own
# look at start-up is put off, so only the checks the tests ask for happen.
export TATTY_CLAUDE="$T/claude.sh" TATTY_UPDATE_FIRST=100000
cat >"$T/claude.sh" <<'EOS'
#!/usr/bin/env bash
# a User Stories headless run (it may run stories.sh): the stand-in is claude-p.sh, made with its tests
[ "${1:-}" = -p ] && case "$*" in *stories.sh*) exec bash "$(dirname "$0")/claude-p.sh" "$@" ;; esac
# a chat's turn (it names its conversation): the stand-in is claude-chat.sh, made with its tests
[ "${1:-}" = -p ] && case "$*" in *--session-id*|*--resume*) exec bash "$(dirname "$0")/claude-chat.sh" "$@" ;; esac
# the summary a small model writes of a side chat's context
if [ "${1:-}" = -p ]; then case "$*" in *"You summarise"*)
	printf '%s\n' "$@" >"$(dirname "$0")/summary.args"
	echo '{"type":"result","is_error":false,"result":"A summary by the model.","total_cost_usd":0.001}'
	exit 0 ;; esac; fi
echo "$*" >>"$(dirname "$0")/claude.log"
[ -f "$(dirname "$0")/claude-fail" ] && { echo "network is down" >&2; exit 1; }
# A headless run for the Jira board: which job it is shows in the one MCP tool
# it may use; it keeps its arguments (one a line) and answers with the canned
# jira-<job>.out (jira-fail: Jira refuses; jira-slow: it takes a while).
if [ "$1" = -p ]; then
	d=$(dirname "$0")
	case "$*" in
	*mcp__atlassian__searchJiraIssuesUsingJql*) job=board ;;
	*mcp__atlassian__getJiraIssue*) job=issue ;;
	*mcp__atlassian__transitionJiraIssue*) job=move ;;
	*) job=other ;;
	esac
	printf '%s\n' "$@" >"$d/jira-$job.args"
	[ -f "$d/jira-slow" ] && sleep 2
	if [ -f "$d/jira-fail" ]; then echo '{"is_error":true,"result":"Failed to search issues: Forbidden"}'; else cat "$d/jira-$job.out"; fi
	exit 0
fi
if [ "$1 $2" = "plugin update" ]; then
	sed -i -E "s/(\"$3\":\[\{\"scope\":\"user\",\"version\":\")[^\"]*/\199.0.0/" "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
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
[ "$(code "$U/static/split.js")" = 200 ] && ok "split.js served" || bad "split.js served"
[ "$(code "$U/static/split.css")" = 200 ] && ok "split.css served" || bad "split.css served"
[ "$(code "$U/static/chat.js")" = 200 ] && ok "chat.js served" || bad "chat.js served"
[ "$(code "$U/static/chat.css")" = 200 ] && ok "chat.css served" || bad "chat.css served"
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
$PY - "$SRV" "$T/pointers" "$T/modecfg" >"$T/m" 2>&1 <<'EOF'
import importlib.util, json, os, pathlib, sys
for v in ("TATTY_MODES", "TATTY_TOOLBOX"): os.environ.pop(v, None)
os.environ["TT_PLUGINS_HOME"] = sys.argv[2]
spec = importlib.util.spec_from_file_location("srv", sys.argv[1]); m = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True; spec.loader.exec_module(m)
print("pointers:", m.installed_modes())
os.environ["TT_PLUGINS_HOME"] = sys.argv[2] + "-none"
print("none:", m.installed_modes())
# A plugin just added has no pointer yet (that waits for a session to load it),
# so Claude Code's own records are read too -- the toolbox's marketplace only.
cfg = pathlib.Path(sys.argv[3]); (cfg / "plugins").mkdir(parents=True, exist_ok=True)
(cfg / "plugins" / "installed_plugins.json").write_text(json.dumps({"version": 2, "plugins": {
    "core@tims-ai-toolbox": [{"scope": "user"}], "design@tims-ai-toolbox": [{"scope": "user"}],
    "production@someone-elses": [{"scope": "user"}]}}), encoding="utf-8")
os.environ["CLAUDE_CONFIG_DIR"] = str(cfg)
print("records:", m.installed_modes(), "from", m.toolbox_market())
os.environ["TATTY_MODES"] = "design, nope ,engineering"
print("forced:", m.installed_modes())
EOF
has "the pointers say which are installed" "$T/m" "pointers: ['engineering', 'production']"
has "none installed" "$T/m" "none: []"
has "a plugin with no pointer yet is in the records" "$T/m" "records: ['design'] from tims-ai-toolbox"
has "TATTY_MODES names them instead" "$T/m" "forced: ['engineering', 'design']"

# Add a discipline: the modes page has Claude Code install the plugin.
post /api/mode/install '{"mode":"nope"}' >"$T/mi"
has "a name that isn't a discipline is refused" "$T/mi" "not one of the toolbox's disciplines"
post /api/mode/install '{"mode":"engineering"}' >"$T/mi"
has "one already installed installs nothing" "$T/mi" '"already": true'
post /api/mode/install '{"mode":"production"}' >"$T/mi"
has "claude installs it for the user" "$T/claude.log" "plugin install production@tims-ai-toolbox --scope user"
touch "$T/claude-fail"
post /api/mode/install '{"mode":"production"}' >"$T/mi"
has "a failed add says what claude said" "$T/mi" "network is down"
has "and what to run by hand" "$T/mi" "/plugin install production@tims-ai-toolbox"
rm -f "$T/claude-fail"

echo "# task files"
# A task's file is a person's too (they may edit it in Obsidian): Tatty changes
# only the line or the section it means to, and keeps the rest byte for byte.
$PY - "$SRV" "$T/task.md" >"$T/tf" 2>&1 <<'EOF'
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("srv", sys.argv[1]); m = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True; spec.loader.exec_module(m)
src = ("---\r\ntags: [game]\r\n---\r\n# t-0007 - Hand made\r\n\r\n* **status**: in review\r\n- **Estimate:** 3\r\n"
       "\r\n## Notes\r\n\r\nkeep me\r\n").encode("utf-8")
text, bom, crlf = m.task_decode(src)
s = m.task_summary("t-0007 - Hand made.md", text)
print("summary:", s["id"], "|", s["title"], "|", s["status"], "|", s["problems"])
new = m.task_edit(text, {"Status": "Done"})
a, b = text.split("\n"), new.split("\n")
print("changed lines:", [i for i in range(max(len(a), len(b))) if a[i:i + 1] != b[i:i + 1]], repr(b[5]))
p = pathlib.Path(sys.argv[2]); p.write_bytes(src)
m.task_write(p, new, bom, crlf)
data = p.read_bytes()
print("crlf kept:", data.count(b"\r\n") == data.count(b"\n"), "rest kept:", data.replace(b"* **status**: Done", b"* **status**: in review") == src)
print("field added:", repr(m.task_edit(text, {"Done": "2026-10-23"}).split("\n")[7]))
d = m.task_parse(m.task_edit(text, description="Hello"))
print("description:", repr(d["description"]), [x["heading"] for x in d["sections"]])
print("labels:", m.task_labels("ui, UI , input,,"))
s = m.task_summary("T-0009 - x.md", "# Just a title\n")
print("H1 without an ID:", s["id"], "|", s["title"], "|", s["problems"])
print("disagree:", m.task_summary("T-0001 - a.md", "# T-0002: a\n")["problems"])
print("no ID:", m.task_summary("Untitled.md", "")["problems"])
print("file name:", m.task_file_name("T-0003", 'What? A "quick" one: #2 / [draft]'))
EOF
has "a hand-made file is read" "$T/tf" "summary: T-0007 | Hand made | in review | []"
has "a change touches one line" "$T/tf" "changed lines: [5] '* **status**: Done'"
has "keeping its key as written" "$T/tf" "'* **status**: Done'"
has "its line ends and everything else" "$T/tf" "crlf kept: True rest kept: True"
has "a field it hasn't got goes after the last" "$T/tf" "field added: '- **Done:** 2026-10-23'"
has "a missing Description is added, before the other sections" "$T/tf" "description: 'Hello' ['Notes']"
has "labels once each" "$T/tf" "labels: ['ui', 'input']"
has "the name gives the ID when the title has none" "$T/tf" "H1 without an ID: T-0009 | Just a title | []"
has "a name and title that disagree are a problem" "$T/tf" "its name says T-0001 but its title says T-0002"
has "so is a file with no ID" "$T/tf" "no ID: ['has no task ID in its name or its title']"
has "a title makes a file name" "$T/tf" "file name: T-0003 - What A quick one 2 draft.md"

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

echo "# workflow tabs: several sessions, one stopped"
# Real processes stand in for the claudes; claude lists each in <config>/sessions/<pid>.json.
winpid() { cat "/proc/$1/winpid" 2>/dev/null || echo "$1"; }
alive() { kill -0 "$1" 2>/dev/null; }
gone() { for _ in 1 2 3 4 5 6 7 8 9 10; do alive "$1" || return 0; sleep 0.3; done; return 1; }
register() { printf '{"pid":%s,"sessionId":"%s","name":"%s"}' "$(winpid "$1")" "$2" "$3" >"$CLAUDE_CONFIG_DIR/sessions/tab-$1.json"; }
sleep 300 & PA=$!
sleep 300 & PB=$!
sleep 300 & PC=$!
post /api/start '{"name":"Demo","row":0}' >"$T/j"
TA=$(pick "$T/j" "d['tag']")
post /api/start '{"name":"Draft","row":"workflow"}' >"$T/j"
TB=$(pick "$T/j" "d['tag']")
post /api/hello "{\"session\":\"sess-a\",\"tag\":\"$TA\"}" >/dev/null
post /api/hello "{\"session\":\"sess-b\",\"tag\":\"$TB\"}" >/dev/null
register "$PA" sess-a "a"
register "$PB" sess-b "b"
get /api/sessions >"$T/j"
has "every feature's sessions are listed without a name" "$T/j" "\"tag\": \"$TA\""
has "the other feature's too" "$T/j" "\"tag\": \"$TB\""
post /api/session/stop "{\"tag\":\"$TB\"}" >"$T/j"
has "stopping a session kills its claude" "$T/j" '"killed": true'
gone "$PB" && ok "its process is gone" || bad "its process is gone"
alive "$PA" && ok "the other session's is not touched" || bad "the other session's is not touched"
get /api/sessions >"$T/j"
hasnt "the stopped session leaves the tabs" "$T/j" "\"tag\": \"$TB\""
has "the other stays" "$T/j" "\"tag\": \"$TA\""
get "/api/sessions?name=Draft" >"$T/j"
pick "$T/j" "[s['status'] + ':' + str(s.get('stopped')) for s in d if s['tag'] == '$TB'][0]" >"$T/f"
has "it is kept on its feature, ended and stopped" "$T/f" "ended:True"
post /api/bye "{\"tag\":\"$TB\"}" >/dev/null
get /api/sessions >"$T/j"
hasnt "a late goodbye doesn't bring the tab back" "$T/j" "\"tag\": \"$TB\""
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"tag":"s-nope"}' "$U/api/session/stop")" = 404 ] &&
	ok "stopping an unknown session refused" || bad "stopping an unknown session refused"
# Not heard from yet: found by the name it was started with.
post /api/start '{"name":"Demo","row":0}' >"$T/j"
TC=$(pick "$T/j" "d['tag']")
NC=$(pick "$T/j" "d['name']")
register "$PC" "" "$NC"
post /api/session/stop "{\"tag\":\"$TC\"}" >"$T/j"
has "a session not heard from is found by name" "$T/j" '"killed": true'
gone "$PC" && ok "and stopped" || bad "and stopped"
# Ended on its own: closing the tab only dismisses it (its process id may belong to something else by now).
post /api/bye "{\"tag\":\"$TA\"}" >/dev/null
post /api/session/stop "{\"tag\":\"$TA\"}" >"$T/j"
has "an ended session is only dismissed" "$T/j" '"killed": false'
alive "$PA" && ok "and nothing is killed" || bad "and nothing is killed"
get /api/sessions >"$T/j"
hasnt "and its tab goes" "$T/j" "\"tag\": \"$TA\""
kill "$PA" 2>/dev/null; rm -f "$CLAUDE_CONFIG_DIR"/sessions/tab-*.json

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
# Each alert says which page it is about, for the avatar's click to go there
pick "$T/j" "' '.join([repr(e['link']) for e in d if e['type'] == 'ask'][-2:])" >"$T/f"
has "a question's link is its feature's page, or none" "$T/f" "'#feature/Demo' ''"
post /api/show '{"kind":"reply","title":"Done","body":"All set.","session":"sess-ids"}' >/dev/null
post /api/show '{"kind":"reply","body":"Nothing to link.","session":"sess-elsewhere"}' >/dev/null
get /api/events >"$T/j"
pick "$T/j" "' '.join([repr(e['link']) for e in d if e['type'] == 'card' and e['kind'] == 'reply'][-2:])" >"$T/f"
has "a reply's link is its feature's page, or none" "$T/f" "'#feature/Demo' ''"
rm -f "$CLAUDE_CONFIG_DIR/sessions/2.json"

echo "# the desktop app"
# boot is what the Desktop shortcut runs: it reuses the open window. Tatty keeps
# no Claude session of its own in a terminal any more (its chats are headless).
mkdir -p "$T/proj"
PROJ=$(cd "$T/proj" && { pwd -W 2>/dev/null || pwd; })
expect "boot" 0 bash "$W" boot --no-browser --project "$PROJ"
has "reuses the window" "$T/out" "$U"
hasnt "starts no Claude session" "$T/out" "claude="
hasnt "nor a terminal for one" "$T/out" "Would run"
[ ! -f "$TATTY_HOME/claude-link.json" ] && ok "keeps no link to a conversation of its own" || bad "keeps no link to a conversation of its own"
expect "boot refuses a folder that isn't there" 2 bash "$W" boot --no-browser --project "$PROJ/nope"
expect "boot still takes --no-claude" 0 bash "$W" boot --no-browser --no-claude
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{}' "$U/api/claude/show")" = 404 ] &&
	ok "there's no Claude terminal to show" || bad "there's no Claude terminal to show"

echo "# milestones"
# The toolbox records a feature's progress in its own ledger as it happens, and
# knows nothing of Tatty. Tatty follows the file and celebrates what it says.
ledger() {
	printf '{"v":1,"ts":"2026-10-04T10:00:00Z","event":"%s","key":"%s|%s","prefix":"%s","folder":"%s","route":"full","qualifier":"%s","skill":"tt-execute","approx":false}\n' \
		"$1" "$1" "${2:-}" "${3:-Demo}" "${4:-$DEMO}" "${2:-}" >>"$TT_EVENTS_HOME/events.jsonl"
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
milestone "and the skill, the feature and its page" Wunit \
	"events[0]['skill'] == 'tt-execute' and events[0]['feature'] == 'Demo' and events[0]['link'] == '#feature/Demo'"
ledger build.complete "" Nowhere "$T/not-a-feature"
waitfor '"prefix": "Nowhere"' && ok "a milestone of a folder that is no feature's is announced" || bad "a milestone of a folder that is no feature's is announced"
milestone "with no page to go to" Nowhere "events[0]['feature'] == '' and events[0]['link'] == ''"
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

# An install of this very version, from a marketplace that offers 99.0.0; and the
# toolbox's core and engineering, of which the marketplace offers a newer core only.
HAVE=$($PY -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$root/plugins/tatty/.claude-plugin/plugin.json")
mkdir -p "$CLAUDE_CONFIG_DIR/plugins" "$T/market/.claude-plugin" "$T/market/plugins/tatty/.claude-plugin" "$T/tbox/.claude-plugin"
write_installed() { printf '{"version":2,"plugins":{"tatty@fake-market":[{"scope":"user","version":"%s"}],"core@tims-ai-toolbox":[{"scope":"user","version":"0.1.0"}],"engineering@tims-ai-toolbox":[{"scope":"user","version":"0.1.0"}]}}' "$HAVE" >"$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"; }
write_installed
printf '{"fake-market":{"installLocation":"%s"},"tims-ai-toolbox":{"installLocation":"%s"}}' "$(cygpath -m "$T/market" 2>/dev/null || echo "$T/market")" "$(cygpath -m "$T/tbox" 2>/dev/null || echo "$T/tbox")" >"$CLAUDE_CONFIG_DIR/plugins/known_marketplaces.json"
printf '{"name":"tims-ai-toolbox","plugins":[{"name":"core","version":"99.0.0"},{"name":"engineering","version":"0.1.0"}]}' >"$T/tbox/.claude-plugin/marketplace.json"
printf '{"name":"fake-market","plugins":[{"name":"tatty","source":"./plugins/tatty"}]}' >"$T/market/.claude-plugin/marketplace.json"
printf '{"name":"tatty","version":"99.0.0"}' >"$T/market/plugins/tatty/.claude-plugin/plugin.json"
post /api/update '{"action":"check"}' >/dev/null; upd_wait
[ "$(pick "$T/set" "d['update']['status']")" = available ] && ok "a newer version is found" || bad "a newer version is found" "$(head -c 300 "$T/set")"
[ "$(pick "$T/set" "d['update']['available']")" = 99.0.0 ] && ok "and named" || bad "and named"
[ "$(pick "$T/set" "d['update']['plugins'][0]['name']")" = tatty ] && ok "Tatty is listed first" || bad "Tatty is listed first"
[ "$(pick "$T/set" "','.join(r['name'] + ':' + r['status'] for r in d['update']['plugins'])")" = "tatty:available,core:available,engineering:current" ] &&
	ok "the toolbox plugins are looked at too" || bad "the toolbox plugins are looked at too" "$(head -c 400 "$T/set")"
has "the marketplace was refreshed first" "$T/claude.log" "plugin marketplace update fake-market"
has "and the toolbox's" "$T/claude.log" "plugin marketplace update tims-ai-toolbox"
hasnt "checking installs nothing" "$T/claude.log" "plugin update"
post /api/update '{"action":"apply"}' >/dev/null; upd_wait
[ "$(pick "$T/set" "d['update']['status']")" = ready ] && ok "installed: ready for a restart" || bad "installed: ready for a restart" "$(head -c 300 "$T/set")"
has "claude installed it for the user" "$T/claude.log" "plugin update tatty@fake-market --scope user"
has "and the newer toolbox plugin" "$T/claude.log" "plugin update core@tims-ai-toolbox --scope user"
hasnt "but not the one that is current" "$T/claude.log" "plugin update engineering"
[ "$(pick "$T/set" "','.join(r['name'] + ':' + r['status'] for r in d['update']['plugins'])")" = "tatty:ready,core:ready,engineering:current" ] &&
	ok "each plugin has its own state" || bad "each plugin has its own state" "$(head -c 400 "$T/set")"
has "the toolbox is said to be for new sessions" "$T/set" "Claude sessions started from now on"
has "the page is told to restart" "$T/set" "Restart Tatty"
get /api/events >"$T/ev"
has "the page hears of it" "$T/ev" '"type": "update"'
post /api/update '{"action":"check"}' >/dev/null; upd_wait
[ "$(pick "$T/set" "d['update']['status']")" = ready ] && ok "still ready until restarted" || bad "still ready until restarted"
touch "$T/claude-fail"
write_installed
post /api/update '{"action":"check"}' >/dev/null; upd_wait
[ "$(pick "$T/set" "d['update']['status']")" = error ] && ok "a failed refresh is an error" || bad "a failed refresh is an error" "$(head -c 300 "$T/set")"
has "with claude's words" "$T/set" "network is down"
rm -f "$T/claude-fail"

echo "# the Jira board"
# The claude stand-in answers the headless runs (see claude.sh above): a board of
# three good tickets and one with no proper key, a ticket's detail, and a move.
cat >"$T/jira-board.out" <<'EOJ'
{"is_error":false,"total_cost_usd":0.02,"usage":{"input_tokens":10,"cache_read_input_tokens":15000,"output_tokens":500},
 "structured_output":{"site":"https://example.atlassian.net/","cloudId":"c-1","issues":[
  {"key":"ABC-1","summary":"Fix the thing","type":"Bug","status":"Open","statusCategory":"todo","priority":"P2","parentKey":"ABC-9","parentSummary":"The epic"},
  {"key":"ABC-2","summary":"Under way","type":"Story","status":"In Review","statusCategory":"inprogress"},
  {"key":"ABC-3","summary":"Done one","type":"Task","status":"Closed","statusCategory":"done"},
  {"key":"not a key","summary":"x","type":"Bug","status":"Open","statusCategory":"todo"}]}}
EOJ
cat >"$T/jira-issue.out" <<'EOJ'
{"is_error":false,"usage":{"input_tokens":5},"structured_output":{"key":"ABC-1","summary":"Fix the thing","type":"Bug","status":"Open",
 "description":"### Steps\n\n1. Open it\n\n![](blob:https://media.example/abc)","labels":["ui"],
 "transitions":[{"id":"7","name":"Start work","to":"In Progress"},{"id":"3","name":"Closed","to":"Closed"}]}}
EOJ
echo '{"is_error":false,"usage":{},"structured_output":{"ok":true}}' >"$T/jira-move.out"
printf '{"mcpServers":{"atlassian":{"type":"http","url":"https://mcp.example/v1/mcp"},"other":{"type":"http","url":"https://x"}}}' >"$CLAUDE_CONFIG_DIR/.claude.json"
jira_wait() { for _ in $(seq 1 50); do get /api/jira >"$T/jb"; [ "$(pick "$T/jb" "len(d['busy'])")" = 0 ] && return 0; sleep 0.2; done; return 1; }
get /api/jira >"$T/jb"
[ "$(pick "$T/jb" "(d['fetchedAt'], len(d['issues']))")" = "(0, 0)" ] && ok "no board until it is fetched" || bad "no board until it is fetched" "$(head -c 200 "$T/jb")"
hasnt "looking spends nothing" "$T/claude.log" "-p "
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{}' "$U/api/jira/refresh")" = 202 ] && ok "refresh starts" || bad "refresh starts"
jira_wait && ok "and finishes" || bad "and finishes"
[ "$(pick "$T/jb" "','.join(i['key'] for i in d['issues'])")" = "ABC-1,ABC-2,ABC-3" ] && ok "only well-formed tickets are kept, in Jira's order" || bad "only well-formed tickets are kept, in Jira's order" "$(head -c 400 "$T/jb")"
[ -f "$TATTY_HOME/jira/board.json" ] && ok "the board is kept in Tatty's home" || bad "the board is kept in Tatty's home"
[ "$(pick "$T/jb" "d['issues'][0]['url']")" = "https://example.atlassian.net/browse/ABC-1" ] && ok "each ticket links to Jira" || bad "each ticket links to Jira" "$(pick "$T/jb" "d['issues'][0]")"
[ "$(pick "$T/jb" "d['usage']['tokens']")" = 15510 ] && ok "the tokens it took are kept" || bad "the tokens it took are kept"
has "the board run may search" "$T/jira-board.args" "mcp__atlassian__searchJiraIssuesUsingJql"
hasnt "but not move tickets" "$T/jira-board.args" "mcp__atlassian__transitionJiraIssue"
has "with no built-in tools" "$T/jira-board.args" "--tools"
has "on the small model" "$T/jira-board.args" "haiku"
has "loading only the Jira server" "$T/jira-board.args" '{"mcpServers": {"atlassian": {"type": "http", "url": "https://mcp.example/v1/mcp"}}}'
has "and only that" "$T/jira-board.args" "--strict-mcp-config"
has "with the JQL from Settings" "$T/jira-board.args" "sprint in openSprints()"
touch "$T/jira-slow"
post /api/jira/refresh '{}' >/dev/null
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{}' "$U/api/jira/refresh")" = 409 ] && ok "one refresh at a time" || bad "one refresh at a time"
jira_wait; rm -f "$T/jira-slow"
has "the next run knows the site" "$T/jira-board.args" "cloudId c-1"
touch "$T/jira-fail"
post /api/jira/refresh '{}' >/dev/null; jira_wait
[ "$(pick "$T/jb" "len(d['issues'])")" = 3 ] && ok "a failed refresh keeps the board" || bad "a failed refresh keeps the board"
has "and says why" "$T/jb" "Forbidden"
rm -f "$T/jira-fail"
get "/api/jira/issue?key=ABC-1" >"$T/ji"
has "a ticket isn't loaded until asked" "$T/ji" '"cached": false'
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"key":"ZZZ-1"}' "$U/api/jira/issue")" = 400 ] && ok "only tickets on the board are loaded" || bad "only tickets on the board are loaded"
[ "$(code -H "X-TT-Token: $K" "$U/api/jira/issue?key=..%2Fboard")" = 400 ] && ok "a ticket key is only a key" || bad "a ticket key is only a key"
post /api/jira/issue '{"key":"ABC-1"}' >/dev/null; jira_wait
get "/api/jira/issue?key=ABC-1" >"$T/ji"
has "a ticket loaded" "$T/ji" "### Steps"
has "its pictures stay in Jira" "$T/ji" "(picture in Jira)"
hasnt "as links only" "$T/ji" "blob:"
hasnt "the ticket run may only read" "$T/jira-issue.args" "mcp__atlassian__transitionJiraIssue"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"key":"ABC-2"}' "$U/api/jira/start")" = 400 ] && ok "a workflow needs the ticket loaded" || bad "a workflow needs the ticket loaded"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"key":"ABC-1"}' "$U/api/jira/start")" = 400 ] && ok "and a project" || bad "and a project"
post /api/jira/start "{\"key\":\"ABC-1\",\"project\":\"$HERE\"}" >"$T/js"
has "a workflow starts from a ticket" "$T/js" '"ok": true'
has "as a feature named for it" "$T/js" '"feature": "ABC-1 - Fix the thing"'
TK="$FX/features/ABC-1 - Fix the thing/ABC-1 - Fix the thing - Ticket.md"
[ -f "$TK" ] && ok "the ticket is written into its folder" || bad "the ticket is written into its folder"
has "as a document" "$TK" "# ABC-1: Fix the thing"
has "with its description" "$TK" "1. Open it"
has "and its link" "$TK" "(https://example.atlassian.net/browse/ABC-1)"
has "the workflow's own first step, on the ticket" "$T/js" "Prompt: /tt-adversarial-plan the Jira ticket ABC-1 in"
has "naming the folder and prefix as tt-workflow does" "$T/js" "Prefix: ABC-1 - Fix the thing"
has "the ticket moves" "$T/js" '"moving": true'
jira_wait
has "by the transition to In Progress" "$T/jira-move.args" "transition id 7"
has "the move run may move" "$T/jira-move.args" "mcp__atlassian__transitionJiraIssue"
hasnt "and do nothing else" "$T/jira-move.args" "mcp__atlassian__getJiraIssue"
[ "$(pick "$T/jb" "d['issues'][0]['status'] + '/' + d['issues'][0]['statusCategory']")" = "In Progress/inprogress" ] && ok "the board shows it moved" || bad "the board shows it moved" "$(pick "$T/jb" "d['issues'][0]")"
[ "$(pick "$T/jb" "d['started'].get('ABC-1')")" = "ABC-1 - Fix the thing" ] && ok "the board knows its feature" || bad "the board knows its feature"
[ "$(pick "$T/jb" "d['project']")" = "$(cd "$root" && { pwd -W 2>/dev/null || pwd; })" ] && ok "the project is remembered for the next" || bad "the project is remembered for the next" "$(pick "$T/jb" "d['project']")"
get "/api/feature?name=$($PY -c 'import urllib.parse; print(urllib.parse.quote("ABC-1 - Fix the thing"))')" >"$T/j"
has "it is one of the features, its ticket first" "$T/j" '"doc": "Ticket"'
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "{\"key\":\"ABC-1\",\"project\":\"$HERE\"}" "$U/api/jira/start")" = 409 ] && ok "not started twice into the same folder" || bad "not started twice into the same folder"
rm -f "$T/jira-move.args"
post /api/jira/move '{"key":"ABC-2"}' >/dev/null; jira_wait
[ ! -f "$T/jira-move.args" ] && ok "a ticket under way isn't moved" || bad "a ticket under way isn't moved"
get /api/events >"$T/ev"
has "and the page is told so" "$T/ev" "ABC-2 is already In Review"
[ "$(code "$U/static/jira.js")" = 200 ] && ok "jira.js served" || bad "jira.js served"

echo "# task boards"
[ "$(code "$U/static/tasks.js")" = 200 ] && ok "tasks.js served" || bad "tasks.js served"
[ "$(code "$U/static/tasks.css")" = 200 ] && ok "tasks.css served" || bad "tasks.css served"
# wbc <what> <body>: POST /api/<what> (a whiteboard's); the answer in $T/wb, the HTTP code printed
wbc() { curl -s -o "$T/wb" -w '%{http_code}' -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "$2" "$U/api/$1"; }
# tk <what> <body>: POST /api/tasks/<what>; the answer in $T/tk, the HTTP code printed
tk() { curl -s -o "$T/tk" -w '%{http_code}' -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "$2" "$U/api/tasks/$1"; }
# taskfile <ID>: the task's file on the Game board
taskfile() { ls "$GB/items/$1"*.md 2>/dev/null | head -1; }
get /api/tasks >"$T/j"
has "boards live in the root's tasks folder" "$T/j" "fxroot/tasks"
[ "$(pick "$T/j" "[(b['name'], b['board'], b['backlog'], b['completed']) for b in d['boards']]")" = "[('Sample', 4, 2, 1)]" ] &&
	ok "the fixture's board, counted" || bad "the fixture's board, counted" "$(head -c 300 "$T/j")"
[ "$(tk new-board '{"name":"a/b"}')" = 400 ] && ok "a board's name is a folder's" || bad "a board's name is a folder's"
[ "$(tk new-board '{"name":"Sample"}')" = 409 ] && ok "a board isn't made over another" || bad "a board isn't made over another"
[ "$(tk new-board '{"name":"Game","columns":["To Do","backlog"]}')" = 400 ] && ok "Backlog isn't a column's name" || bad "Backlog isn't a column's name"
[ "$(tk new-board '{"name":"Game","columns":["To Do","Doing","Done"]}')" = 200 ] && ok "a new board" || bad "a new board" "$(cat "$T/tk")"
GB="$FX/tasks/Game"
[ -f "$GB/board.json" ] && [ -d "$GB/items" ] && ok "a board.json and an items folder" || bad "a board.json and an items folder"
for i in 1 2 3 4 5; do post /api/tasks/create "{\"name\":\"Game\",\"title\":\"Task $i\",\"labels\":\"ui, UI , input\"}" >"$T/c$i" & done; wait
[ "$($PY -c "import json, sys; print(sorted(json.load(open(f))['task']['id'] for f in sys.argv[1:]))" "$T"/c[1-5])" = "['T-0001', 'T-0002', 'T-0003', 'T-0004', 'T-0005']" ] &&
	ok "five made at once have five IDs" || bad "five made at once have five IDs" "$(cat "$T"/c[1-5])"
[ "$(ls "$GB/items" | wc -l | tr -d ' ')" = 5 ] && ok "and five files" || bad "and five files" "$(ls "$GB/items")"
[ "$(tk create '{"name":"Game","title":"  "}')" = 400 ] && ok "a task needs a title" || bad "a task needs a title"
[ "$(tk create '{"name":"Game","title":"Pause: menu?","priority":"High","description":"Esc opens it."}')" = 200 ] && ok "a task with a description" || bad "a task with a description"
[ "$(pick "$T/tk" "d['task']['file']")" = "T-0006 - Pause menu.md" ] && ok "named for its ID and title" || bad "named for its ID and title" "$(cat "$T/tk")"
printf '# T-0006: Pause: menu?\n\n- **Status:** Backlog\n- **Priority:** High\n- **Labels:**\n- **Created:** %s\n- **Done:**\n\n## Description\n\nEsc opens it.\n' "$(date +%F)" >"$T/want"
cmp -s "$T/want" "$(taskfile T-0006)" && ok "the file is the task's template" || bad "the file is the task's template" "$(cat "$(taskfile T-0006)")"
has "labels once each" "$(taskfile T-0001)" "- **Labels:** ui, input"
get "/api/tasks/board?name=Game" >"$T/j"
C1=$(pick "$T/j" "d['columns'][0]['id']"); CD=$(pick "$T/j" "d['done']")
[ "$(pick "$T/j" "(d['backlog']['total'], [c['name'] for c in d['columns']], d['options']['startColumn'] == d['columns'][1]['id'])")" = "(6, ['To Do', 'Doing', 'Done'], True)" ] &&
	ok "new tasks wait in the backlog; the start column sounds under way" || bad "new tasks wait in the backlog; the start column sounds under way" "$(head -c 400 "$T/j")"
post /api/tasks/move "{\"name\":\"Game\",\"id\":\"T-0001\",\"to\":\"$C1\"}" >/dev/null
post /api/tasks/move "{\"name\":\"Game\",\"id\":\"T-0002\",\"to\":\"$C1\",\"before\":\"T-0001\"}" >/dev/null
get "/api/tasks/board?name=Game" >"$T/j"
[ "$(pick "$T/j" "[t['id'] for t in d['columns'][0]['tasks']]")" = "['T-0002', 'T-0001']" ] && ok "a move lands before the card it was dropped on" || bad "a move lands before the card it was dropped on" "$(head -c 400 "$T/j")"
has "the file says its column" "$(taskfile T-0001)" "- **Status:** To Do"
sum=$(sha1sum <"$(taskfile T-0001)")
post /api/tasks/move "{\"name\":\"Game\",\"id\":\"T-0001\",\"to\":\"$C1\",\"before\":\"T-0002\"}" >/dev/null
get "/api/tasks/board?name=Game" >"$T/j"
[ "$(pick "$T/j" "[t['id'] for t in d['columns'][0]['tasks']]")" = "['T-0001', 'T-0002']" ] && ok "a reorder" || bad "a reorder"
[ "$(sha1sum <"$(taskfile T-0001)")" = "$sum" ] && ok "writes board.json only" || bad "writes board.json only"
[ "$(tk move '{"name":"Game","id":"T-0001","to":"nowhere"}')" = 400 ] && ok "only to a list there is" || bad "only to a list there is"
[ "$(tk move '{"name":"Game","id":"T-0099","to":"backlog"}')" = 404 ] && ok "only a task there is" || bad "only a task there is"
post /api/tasks/move "{\"name\":\"Game\",\"id\":\"T-0001\",\"to\":\"$CD\"}" >/dev/null
has "into the done column stamps Done" "$(taskfile T-0001)" "- **Done:** $(date +%F)"
post /api/tasks/move "{\"name\":\"Game\",\"id\":\"T-0001\",\"to\":\"$C1\"}" >/dev/null
grep -qxF -- '- **Done:**' "$(taskfile T-0001)" && ok "out of it clears it" || bad "out of it clears it" "$(cat "$(taskfile T-0001)")"
# a save is made over the file the page read, or refused
get "/api/tasks/task?name=Game&id=T-0003" >"$T/j"
REV=$(pick "$T/j" "d['rev']")
printf 'by hand\n' >>"$(taskfile T-0003)"
[ "$(tk save "{\"name\":\"Game\",\"id\":\"T-0003\",\"rev\":\"$REV\",\"title\":\"Nope\"}")" = 409 ] && ok "a save over a changed file is refused" || bad "a save over a changed file is refused"
has "with the task as it is now" "$T/tk" "by hand"
hasnt "and the file left alone" "$(taskfile T-0003)" "Nope"
get "/api/tasks/task?name=Game&id=T-0005" >"$T/j"
[ "$(tk save "{\"name\":\"Game\",\"id\":\"T-0005\",\"rev\":\"$(pick "$T/j" "d['rev']")\",\"title\":\"Renamed five\",\"labels\":\"x\",\"description\":\"New words\"}")" = 200 ] &&
	ok "a save" || bad "a save" "$(cat "$T/tk")"
[ "$(basename "$(taskfile T-0005)")" = "T-0005 - Renamed five.md" ] && ok "a new title renames the file" || bad "a new title renames the file" "$(ls "$GB/items")"
has "its H1" "$(taskfile T-0005)" "# T-0005: Renamed five"
has "its description" "$(taskfile T-0005)" "New words"
$PY -c "import sys; p=sys.argv[1]; d=open(p,'rb').read(); open(p,'wb').write(d.replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'))" "$(taskfile T-0004)"
get "/api/tasks/task?name=Game&id=T-0004" >"$T/j"
REV=$(pick "$T/j" "d['rev']")
[ "$(tk save "{\"name\":\"Game\",\"id\":\"T-0004\",\"rev\":\"$REV\",\"text\":\"# T-0005: Not mine\\n\"}")" = 400 ] && ok "the whole file, but not its ID" || bad "the whole file, but not its ID"
[ "$(tk save "{\"name\":\"Game\",\"id\":\"T-0004\",\"rev\":\"$REV\",\"text\":\"# T-0004: Task 4\\n\\n- **Status:** Backlog\\n\\n## Description\\n\\nRaw.\\n\"}")" = 200 ] &&
	ok "the whole file saved" || bad "the whole file saved" "$(cat "$T/tk")"
$PY -c "import sys; d=open(sys.argv[1],'rb').read(); sys.exit(not (b'Raw.\r\n' in d and d.count(b'\r\n') == d.count(b'\n')))" "$(taskfile T-0004)" &&
	ok "with the file's own line ends" || bad "with the file's own line ends"
# columns: a rename rewrites its tasks' Status; a delete sends them somewhere
[ "$(tk columns "{\"name\":\"Game\",\"op\":\"rename\",\"id\":\"$C1\",\"value\":\"Doing\"}")" = 400 ] && ok "no two columns of a name" || bad "no two columns of a name"
[ "$(tk columns "{\"name\":\"Game\",\"op\":\"rename\",\"id\":\"$C1\",\"value\":\"Ready\"}")" = 200 ] && ok "a column renamed" || bad "a column renamed"
has "its tasks say so" "$(taskfile T-0002)" "- **Status:** Ready"
[ "$(tk columns "{\"name\":\"Game\",\"op\":\"add\",\"value\":\"QA\",\"index\":2}")" = 200 ] && ok "a column added" || bad "a column added"
[ "$(pick "$T/tk" "[c['name'] for c in d['columns']]")" = "['Ready', 'Doing', 'QA', 'Done']" ] && ok "where it was put" || bad "where it was put" "$(head -c 300 "$T/tk")"
[ "$(tk columns "{\"name\":\"Game\",\"op\":\"remove\",\"id\":\"$C1\",\"to\":\"completed\"}")" = 400 ] && ok "a column's tasks don't go to Completed by a delete" || bad "a column's tasks don't go to Completed by a delete"
[ "$(tk columns "{\"name\":\"Game\",\"op\":\"remove\",\"id\":\"$C1\"}")" = 200 ] && ok "a column deleted" || bad "a column deleted"
has "its tasks back in the backlog" "$(taskfile T-0002)" "- **Status:** Backlog"
# Clear done: the done column's tasks go to Completed, and Tatty celebrates
get /api/events >"$T/ev0"; n0=$(pick "$T/ev0" "len(d)")
post /api/tasks/move "{\"name\":\"Game\",\"id\":\"T-0003\",\"to\":\"$CD\"}" >/dev/null
[ "$(tk clear '{"name":"Game"}')" = 200 ] && [ "$(pick "$T/tk" "d['cleared']")" = 1 ] && ok "Clear done" || bad "Clear done" "$(head -c 300 "$T/tk")"
has "the task is Completed" "$(taskfile T-0003)" "- **Status:** Completed"
get "/api/tasks/list?name=Game&in=completed" >"$T/j"
[ "$(pick "$T/j" "([t['id'] for t in d['items']], d['stats']['total'], d['stats']['thisWeek'])")" = "(['T-0003'], 1, 1)" ] && ok "on the Completed list, counted" || bad "on the Completed list, counted" "$(head -c 300 "$T/j")"
get "/api/events?since=$n0" >"$T/ev"
has "a milestone for the move into Done" "$T/ev" '"label": "Task done"'
has "and one for the clear" "$T/ev" '"label": "1 task completed"'
has "which Tatty celebrates" "$T/ev" '"event": "tasks.done"'
has "and which opens the board" "$T/ev" '"link": "#tasks/Game"'
# a hand edit, and a file without an ID, reach the board
get /api/events >"$T/ev0"; n0=$(pick "$T/ev0" "len(d)")
sleep 1.6; printf 'more by hand\n' >>"$(taskfile T-0006)"
for _ in $(seq 1 40); do get "/api/events?since=$n0" >"$T/ev"; grep -q '"disk": true' "$T/ev" && break; sleep 0.25; done
has "a change on disk is an event" "$T/ev" '"disk": true'
has "naming the task" "$T/ev" '"T-0006"'
printf '# Some idea\n' >"$GB/items/Untitled.md"
get "/api/tasks/board?name=Game" >"$T/j"
has "a file without an ID is a problem" "$T/j" '"file": "Untitled.md"'
[ "$(tk adopt '{"name":"Game","file":"../board.json"}')" = 404 ] && ok "only a file of the board's items is adopted" || bad "only a file of the board's items is adopted"
[ "$(tk adopt '{"name":"Game","file":"Untitled.md"}')" = 200 ] && ok "adopted" || bad "adopted" "$(cat "$T/tk")"
[ -f "$GB/items/T-0007 - Some idea.md" ] && ok "named for its new ID" || bad "named for its new ID" "$(ls "$GB/items")"
has "which its title says too" "$GB/items/T-0007 - Some idea.md" "# T-0007: Some idea"
[ "$(code -H "X-TT-Token: $K" "$U/api/tasks/task?name=Game&id=..%2Fboard")" = 404 ] && ok "a task's ID is only an ID" || bad "a task's ID is only an ID"
[ "$(code -H "X-TT-Token: $K" "$U/api/tasks/board?name=..%2Ffeatures")" = 404 ] && ok "a board's name is only a name" || bad "a board's name is only a name"
# delete: out of the way, never gone
get "/api/tasks/task?name=Game&id=T-0004" >"$T/j"
[ "$(tk delete "{\"name\":\"Game\",\"id\":\"T-0004\",\"rev\":\"$(pick "$T/j" "d['rev']")\"}")" = 200 ] && ok "a task deleted" || bad "a task deleted"
[ -z "$(taskfile T-0004)" ] && ls "$GB/.deleted/T-0004 - Task "*.md >/dev/null 2>&1 && ok "into the board's .deleted folder" || bad "into the board's .deleted folder" "$(ls -a "$GB" "$GB/.deleted")"
# Start workflow, as from a Jira ticket
[ "$(tk start '{"name":"Game","id":"T-0006"}')" = 400 ] && ok "a workflow needs a project" || bad "a workflow needs a project"
[ "$(tk start "{\"name\":\"Game\",\"id\":\"T-0006\",\"project\":\"$HERE\"}")" = 200 ] && ok "a workflow starts from a task" || bad "a workflow starts from a task" "$(cat "$T/tk")"
has "as a feature named for it" "$T/tk" '"feature": "T-0006 - Pause menu"'
TK="$FX/features/T-0006 - Pause menu/T-0006 - Pause menu - Ticket.md"
[ -f "$TK" ] && ok "the task is written into its folder" || bad "the task is written into its folder"
has "as its ticket" "$TK" "# T-0006: Pause: menu?"
has "with where it came from" "$TK" '- **Task:** T-0006 on the Tasks board "Game"'
has "the workflow's own first step, on the task" "$T/tk" "Prompt: /tt-adversarial-plan the task T-0006 in"
has "the task moves on" "$T/tk" '"moved": "Doing"'
has "its file says so" "$(taskfile T-0006)" "- **Status:** Doing"
has "and names its feature" "$(taskfile T-0006)" "- **Feature:** T-0006 - Pause menu"
[ "$(tk start "{\"name\":\"Game\",\"id\":\"T-0006\",\"project\":\"$HERE\"}")" = 409 ] && ok "not started twice" || bad "not started twice"
get "/api/tasks/board?name=Game" >"$T/j"
[ "$(pick "$T/j" "(d['started'].get('T-0006'), d['options']['project'])")" = "('T-0006 - Pause menu', '$HERE')" ] && ok "the board remembers the feature and the project" || bad "the board remembers the feature and the project" "$(pick "$T/j" "(d['started'], d['options'])")"
hasnt "no work folder: the session isn't widened" "$T/tk" "--add-dir"
hasnt "and the ticket has no work-folder section" "$TK" "## Working folder"
# the linked project is where the session runs; the work folder is added to it
[ "$(tk start "{\"name\":\"Game\",\"id\":\"T-0005\",\"project\":\"$HERE\",\"workdir\":\"$FX/nope\"}")" = 400 ] && ok "a work folder must exist" || bad "a work folder must exist"
[ "$(tk start "{\"name\":\"Game\",\"id\":\"T-0005\",\"project\":\"$HERE\",\"workdir\":\"$FX\"}")" = 200 ] && ok "a workflow starts with a work folder" || bad "a workflow starts with a work folder" "$(cat "$T/tk")"
has "the session adds the work folder" "$T/tk" "--add-dir $FX"
has "and still runs in the project" "$T/tk" "cd $HERE &&"
has "the planning command is the full one" "$T/tk" "Prompt: /tt-adversarial-plan the task T-0005 in"
has "and says where the work is done" "$T/tk" "Never read, build or verify against $HERE"
TW=$(ls "$FX/features/T-0005"*/*Ticket.md | head -1)
has "the ticket says it too" "$TW" "## Working folder"
has "and which repo to write in its documents" "$TW" "Write **Repo:** $FX in every document"
get "/api/tasks/board?name=Game" >"$T/j"
[ "$(pick "$T/j" "d['options']['workdir']")" = "$FX" ] && ok "the board remembers the work folder" || bad "the board remembers the work folder" "$(pick "$T/j" "d['options']")"
# the lite button
[ "$(tk start "{\"name\":\"Game\",\"id\":\"T-0007\",\"project\":\"$HERE\",\"workdir\":\"$FX\",\"mode\":\"lite\"}")" = 200 ] && ok "a lite workflow starts from a task" || bad "a lite workflow starts from a task" "$(cat "$T/tk")"
has "with the lite route's own command" "$T/tk" "Prompt: /tt-workflow-lite \\\""
has "on the task" "$T/tk" "the task T-0007 in"
has "named as lite" "$T/tk" "Name: T-0007 - Some idea : Lite"
has "with the work folder added" "$T/tk" "--add-dir $FX"
has "and the task moves on" "$T/tk" '"moved": "Doing"'
[ "$(tk start "{\"name\":\"Game\",\"id\":\"T-0007\",\"project\":\"$HERE\",\"mode\":\"lite\"}")" = 409 ] && ok "lite isn't started twice either" || bad "lite isn't started twice either"
# a board.json that won't read is never written over
cp "$GB/board.json" "$T/board.json"; printf '{ nope' >"$GB/board.json"
[ "$(tk create '{"name":"Game","title":"x"}')" = 409 ] && ok "a broken board.json refuses changes" || bad "a broken board.json refuses changes"
get "/api/tasks/board?name=Game" >"$T/j"
has "and says so" "$T/j" '"broken": true'
[ "$(cat "$GB/board.json")" = "{ nope" ] && ok "leaving it as it is" || bad "leaving it as it is"
cp "$T/board.json" "$GB/board.json"
ls "$TATTY_HOME/tasks-index/"*.json >/dev/null 2>&1 && ok "the index is kept in Tatty's home" || bad "the index is kept in Tatty's home"
# a board that is a junction to a folder elsewhere (Windows)
if command -v cmd >/dev/null 2>&1 && mkdir -p "$T/elsewhere/Linked/items" && cp "$T/board.json" "$T/elsewhere/Linked/" &&
	MSYS_NO_PATHCONV=1 cmd /c mklink /J "$(cygpath -w "$FX/tasks/Linked")" "$(cygpath -w "$T/elsewhere/Linked")" >/dev/null 2>&1; then
	[ "$(tk create '{"name":"Linked","title":"Through a junction"}')" = 200 ] && ls "$T/elsewhere/Linked/items/"*"Through a junction.md" >/dev/null 2>&1 &&
		ok "a board through a junction" || bad "a board through a junction" "$(cat "$T/tk")"
else
	echo "skip  a board through a junction: no mklink here"
fi
echo "# user stories"
if [ ! -f "$TATTY_TOOLBOX/plugins/design/skills/tt-user-stories/scripts/stories.sh" ] && [ ! -f "$TATTY_TOOLBOX/../design/skills/tt-user-stories/scripts/stories.sh" ]; then
	echo "skip  the User Stories board: the toolbox has no design plugin with tt-user-stories"
else
[ "$(code "$U/static/stories.js")" = 200 ] && ok "stories.js served" || bad "stories.js served"
[ "$(code "$U/static/stories.css")" = 200 ] && ok "stories.css served" || bad "stories.css served"
get /api/designs >"$T/j"
has "no boards yet" "$T/j" '"designs": []'
has "the design plugin is found" "$T/j" '"plugin": true'
has "boards live in the root's design folder" "$T/j" "fxroot/design"
# the intake: picked in the file dialog (the stand-in), then copied into the board
mkdir -p "$T/designs"
printf '# Bag\n\n## Pickup\n\nWalking over an item puts it in the bag.\n' >"$T/designs/Bag - Design.md"
INTAKE=$(cd "$T/designs" && { pwd -W 2>/dev/null || pwd; })/"Bag - Design.md"
printf '%s' "$INTAKE" >"$T/pick-answer"
post /api/pick-file '{"start":""}' >"$T/j"
has "the file dialog chose the design document" "$T/j" "Bag - Design.md"
has "it was the file dialog" "$T/picker.log" "--pick-file"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "{\"name\":\"a/b\",\"intake\":\"$INTAKE\"}" "$U/api/new-design")" = 400 ] &&
	ok "new board: a bad name is refused" || bad "new board: a bad name is refused"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "{\"name\":\"X\",\"intake\":\"$T/none.txt\"}" "$U/api/new-design")" = 400 ] &&
	ok "new board: only a markdown document" || bad "new board: only a markdown document"
post /api/new-design "{\"name\":\"Inventory\",\"intake\":\"$INTAKE\"}" >"$T/j"
has "new board made" "$T/j" '"doc": "Inventory - User Stories.md"'
BD="$FX/design/Inventory"
[ -f "$BD/Bag - Design.md" ] && ok "the design document is copied in" || bad "the design document is copied in"
has "the stories document is started by stories.sh" "$BD/Inventory - User Stories.md" "- **Source:** [[Bag - Design]]"
[ "$(code -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "{\"name\":\"Inventory\",\"intake\":\"$INTAKE\"}" "$U/api/new-design")" = 409 ] &&
	ok "new board: one that exists is refused" || bad "new board: one that exists is refused"
# the headless run: a stand-in claude that writes stories through stories.sh,
# as the skill does, and says so in stream-json
US_SCRIPT=""
for c in "$TATTY_TOOLBOX/plugins/design" "$TATTY_TOOLBOX/../design"; do
	[ -f "$c/skills/tt-user-stories/scripts/stories.sh" ] && { US_SCRIPT="$c/skills/tt-user-stories/scripts/stories.sh"; break; }
done
printf '%s' "$US_SCRIPT" >"$T/stories-script"
cat >"$T/claude-p.sh" <<'EOS'
#!/usr/bin/env bash
here=$(dirname "$0"); US=$(cat "$here/stories-script")
prompt=$(cat)
printf '%s\n' "$prompt" >"$here/claude-prompt"; printf '%s\n' "$*" >"$here/claude-p-args"
printf '%s\n' "${TATTY_SESSION:-none}" >"$here/claude-p-session"
say() { printf '%s\n' "$1"; }
tool() { say "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"bash stories.sh $1\"}}]}}"; }
say '{"type":"system","subtype":"init"}'
[ -f "$here/claude-slow" ] && sleep 20
case "$prompt" in
*" draft "*)
	doc=$(printf '%s' "$prompt" | sed 's/^.*" "\([^"]*\)"[[:space:]]*$/\1/')
	tool "group add"; bash "$US" group add "$doc" Bag "Carrying things" >/dev/null
	printf 'title: Pick up an item\ngroup: Bag\nas: player\nwant: to pick up items\nso_that: I can use them\ncriteria:\n  - Given a free slot, when I walk over an item, then it goes in my bag\n' >"$here/s1"
	tool add; bash "$US" add "$doc" "$here/s1" >/dev/null
	printf 'title: Grab items\ngroup: Bag\norigin: Suggested\nas: player\nwant: to grab items\nso_that: I keep them\ncriteria:\n  - Given an item, when I grab it, then it is mine\n' >"$here/s2"
	tool add; bash "$US" add "$doc" "$here/s2" --proposed >/dev/null
	printf 'title: Sort the bag\norigin: Suggested\nas: player\nwant: to sort my bag\nso_that: I find things\ncriteria:\n  - Given a bag, when I sort it, then it is in order\n' >"$here/s3"
	tool add; bash "$US" add "$doc" "$here/s3" --proposed >/dev/null ;;
*" alter "*)
	doc=$(printf '%s' "$prompt" | sed 's/^[^"]*"\([^"]*\)".*$/\1/')
	id=$(printf '%s' "$prompt" | grep -o 'US-[0-9]*' | head -1)
	note=$(printf '%s' "$prompt" | sed 's/^.*US-[0-9]* "\([^"]*\)".*$/\1/')
	cp "$note" "$here/claude-note" 2>/dev/null
	printf 'title: Grab items from the floor\n' >"$here/s4"
	tool edit; bash "$US" edit "$doc" "$id" "$here/s4" --altered >/dev/null ;;
esac
say '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.0123,"result":"done"}'
EOS
# runs_done <n>: wait for the n-th finished run's event
runs_done() {
	for _ in $(seq 1 100); do
		get /api/events >"$T/ev"
		[ "$(pick "$T/ev" "sum(1 for e in d if e['type'] == 'stories' and e.get('done'))")" -ge "$1" ] && return 0
		sleep 0.2
	done
	return 1
}
post /api/stories/run '{"name":"Inventory","mode":"draft"}' >"$T/j"
has "a draft run starts" "$T/j" '"status": "running"'
runs_done 1 && ok "the run finishes" || bad "the run finishes"
has "the run is the skill's draft mode" "$T/claude-prompt" '/design:tt-user-stories draft "Bag - Design.md" "Inventory - User Stories.md"'
has "headless, streaming" "$T/claude-p-args" "-p --output-format stream-json --verbose"
has "only stories.sh may run" "$T/claude-p-args" "Bash(bash *stories.sh*)"
has "nothing prompts" "$T/claude-p-args" "--permission-mode dontAsk"
has "the run isn't one of Tatty's sessions" "$T/claude-p-session" "none"
pick "$T/ev" "'\n'.join(e.get('run', {}).get('step', '') for e in d if e['type'] == 'stories' and e.get('run'))" >"$T/f"
has "each tool call is a step on the page" "$T/f" "Writing a story"
pick "$T/ev" "[e for e in d if e['type'] == 'stories' and e.get('done')][-1]" >"$T/f"
has "the new stories are named" "$T/f" "'new': ['US-01', 'US-02', 'US-03']"
has "and what it cost" "$T/f" "'cost': 0.0123"
get "/api/design?name=Inventory" >"$T/j"
[ "$(pick "$T/j" "len(d['stories'])")" = 3 ] && ok "the board has the stories" || bad "the board has the stories" "$(head -c 300 "$T/j")"
[ "$(pick "$T/j" "d['groups'][0]['name'] + ':' + str(d['groups'][0]['count']) + ':' + str(d['groups'][0]['colour'])")" = "Bag:2:0" ] &&
	ok "groups with their counts and a colour" || bad "groups with their counts and a colour" "$(head -c 300 "$T/j")"
[ "$(pick "$T/j" "d['stories'][1]['status'] + ' ' + d['stories'][1]['soThat']")" = "Proposed I keep them" ] &&
	ok "stories read through stories.sh" || bad "stories read through stories.sh"
[ "$(pick "$T/j" "d['problems']")" = "[]" ] && ok "no problems" || bad "no problems"
[ "$(pick "$T/j" "d['intake']")" = "Bag - Design.md" ] && ok "the design document is known" || bad "the design document is known"
get /api/designs >"$T/j"
[ "$(pick "$T/j" "' '.join(str(d['designs'][0][k]) for k in ('name', 'stories', 'proposed', 'groups'))")" = "Inventory 3 2 1" ] &&
	ok "the boards list counts them" || bad "the boards list counts them" "$(head -c 300 "$T/j")"
# alter a proposed story: the note reaches the skill as a file
post /api/stories/run '{"name":"Inventory","mode":"alter","id":"US-01","note":"x"}' >"$T/j"
has "only a proposed story is altered" "$T/j" "Only a Proposed story"
post /api/stories/run '{"name":"Inventory","mode":"alter","id":"US-02","note":"Say it is from the floor"}' >"$T/j"
runs_done 2 && ok "the alter run finishes" || bad "the alter run finishes"
has "the note reached the skill" "$T/claude-note" "Say it is from the floor"
has "the story was rewritten" "$BD/Inventory - User Stories.md" "### US-02: Grab items from the floor"
has "and counted as altered" "$BD/Inventory - User Stories.md" "- **Altered:** 1"
pick "$T/ev" "[e for e in d if e['type'] == 'stories' and e.get('done')][-1]" >"$T/f"
has "the page hears which was rewritten" "$T/f" "'altered': ['US-02']"
ls "$TATTY_HOME/runs" 2>/dev/null | grep -q . && bad "the run's note is cleaned up" || ok "the run's note is cleaned up"
# changes a person makes on the board
get "/api/design?name=Inventory" >"$T/j"
H1=$(pick "$T/j" "d['stories'][0]['hash']")
st_post() { curl -s -o "$T/j" -w '%{http_code}' -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "$1" "$U/api/stories"; }
[ "$(st_post '{"name":"Inventory","action":"edit","id":"US-01","hash":"1","title":"Stale"}')" = 409 ] &&
	ok "an edit to a story that changed is refused" || bad "an edit to a story that changed is refused"
[ "$(st_post "{\"name\":\"Inventory\",\"action\":\"edit\",\"id\":\"US-01\",\"hash\":\"$H1\",\"title\":\"Pick up an item from the floor\",\"details\":\"Items glow.\\n\\nA full bag refuses.\",\"criteria\":[\"Given a free slot, when I walk over it, then it is mine\",\"Given a full bag, when I walk over it, then it stays\"]}")" = 200 ] &&
	ok "edit a story" || bad "edit a story" "$(head -c 300 "$T/j")"
has "the edit is in the document" "$BD/Inventory - User Stories.md" "### US-01: Pick up an item from the floor"
has "details as written" "$BD/Inventory - User Stories.md" "A full bag refuses."
has "criteria as written" "$BD/Inventory - User Stories.md" "- Given a full bag, when I walk over it, then it stays"
has "the answer is the board again" "$T/j" '"title": "Pick up an item from the floor"'
[ "$(st_post '{"name":"Inventory","action":"edit","id":"US-01","title":"a\nb"}')" = 400 ] &&
	ok "a title is one line" || bad "a title is one line"
[ "$(st_post '{"name":"Inventory","action":"edit","id":"US-01","criteria":[]}')" = 400 ] &&
	ok "a story keeps at least one criterion" || bad "a story keeps at least one criterion"
has "with stories.sh's reason" "$T/j" "criterion"
[ "$(st_post '{"name":"Inventory","action":"accept","id":"US-02"}')" = 200 ] && ok "accept" || bad "accept" "$(head -c 300 "$T/j")"
[ "$(pick "$T/j" "[s['status'] for s in d['stories'] if s['id'] == 'US-02'][0]")" = Accepted ] && ok "accepted" || bad "accepted"
[ "$(st_post '{"name":"Inventory","action":"reject","id":"US-03","reason":"Not for now"}')" = 200 ] && ok "reject" || bad "reject"
has "rejected stories are retired" "$BD/Inventory - User Stories.md" "| US-03 | Sort the bag | Rejected: Not for now |"
[ "$(st_post '{"name":"Inventory","action":"group","op":"add","group":"Combat"}')" = 200 ] && ok "add a group" || bad "add a group"
[ "$(pick "$T/j" "[g['colour'] for g in d['groups'] if g['name'] == 'Combat'][0]")" = 1 ] && ok "a new group gets the next colour" || bad "a new group gets the next colour"
[ "$(st_post '{"name":"Inventory","action":"group","op":"add","group":"bag"}')" = 400 ] && ok "group names are unique" || bad "group names are unique"
[ "$(st_post '{"name":"Inventory","action":"group","op":"rename","group":"Bag","value":"Inventory"}')" = 200 ] && ok "rename a group" || bad "rename a group"
has "its stories follow" "$BD/Inventory - User Stories.md" "- **Group:** Inventory"
[ "$(pick "$T/j" "[g['colour'] for g in d['groups'] if g['name'] == 'Inventory'][0]")" = 0 ] && ok "and so does its colour" || bad "and so does its colour"
[ "$(st_post '{"name":"Inventory","action":"group","op":"remove","group":"Inventory"}')" = 200 ] && ok "remove a group" || bad "remove a group"
has "its stories are ungrouped" "$BD/Inventory - User Stories.md" "- **Group:** Ungrouped"
[ "$(pick "$T/j" "[g['colour'] for g in d['groups'] if g['name'] == 'Combat'][0]")" = 1 ] && ok "the others keep their colours" || bad "the others keep their colours"
[ "$(st_post '{"name":"Nope","action":"accept","id":"US-01"}')" = 404 ] && ok "an unknown board" || bad "an unknown board"
# where the cards sit is Tatty's own
post /api/stories/layout '{"name":"Inventory","cards":{"US-01":[10,20],"x":[1,1]},"view":{"x":5,"y":6,"z":0.8}}' >/dev/null
get "/api/design?name=Inventory" >"$T/j"
[ "$(pick "$T/j" "d['layout']['cards']['US-01']")" = "[10.0, 20.0]" ] && ok "a card's place is kept" || bad "a card's place is kept" "$(head -c 300 "$T/j")"
[ "$(pick "$T/j" "d['layout']['view']['z']")" = 0.8 ] && ok "and the view" || bad "and the view"
[ "$(pick "$T/j" "'x' in d['layout']['cards']")" = False ] && ok "only story IDs are kept" || bad "only story IDs are kept"
ls "$TATTY_HOME/boards/"*.json >/dev/null 2>&1 && ok "in Tatty's home" || bad "in Tatty's home"
hasnt "never in the document" "$BD/Inventory - User Stories.md" "10.0"
# one run at a time; Stop ends it; edits wait for it
touch "$T/claude-slow"
post /api/stories/run '{"name":"Inventory","mode":"draft"}' >/dev/null
sleep 0.5
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d '{"name":"Inventory","mode":"draft"}' "$U/api/stories/run")" = 409 ] &&
	ok "one run at a time" || bad "one run at a time"
[ "$(st_post '{"name":"Inventory","action":"group","op":"add","group":"Later"}')" = 409 ] && ok "no edits while it writes" || bad "no edits while it writes"
post /api/stories/cancel '{}' >"$T/j"
has "stop" "$T/j" '"ok": true'
runs_done 3 && ok "a stopped run ends" || bad "a stopped run ends"
pick "$T/ev" "[e for e in d if e['type'] == 'stories' and e.get('done')][-1]" >"$T/f"
has "and says so" "$T/f" "'error': 'Stopped.'"
rm -f "$T/claude-slow"
# a hand edit (in Obsidian, say) reaches the page
n0=$(pick "$T/ev" "len(d)")
sleep 1.6; printf '\n' >>"$BD/Inventory - User Stories.md"
for _ in $(seq 1 30); do get "/api/events?since=$n0" >"$T/ev2"; grep -q '"changed": true' "$T/ev2" && break; sleep 0.2; done
has "a change on disk is an event" "$T/ev2" '"changed": true'
# export to Tasks: accepted stories into a Tasks board's backlog, by Tatty's own writes
ex_post() { curl -s -o "$T/j" -w '%{http_code}' -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "$1" "$U/api/stories/export"; }
hash_of() { get "/api/design?name=Inventory" >"$T/h"; pick "$T/h" "[s['hash'] for s in d['stories'] if s['id'] == '$1'][0]"; }
st_post '{"name":"Inventory","action":"group","op":"add","group":"Pickup"}' >/dev/null
st_post "{\"name\":\"Inventory\",\"action\":\"edit\",\"id\":\"US-02\",\"hash\":\"$(hash_of US-02)\",\"group\":\"Pickup\"}" >/dev/null
printf 'title: Drop an item\nas: player\nwant: to drop items\nso_that: I make room\ncriteria:\n  - Given an item, when I drop it, then it is on the floor\n' >"$T/s5"
bash "$US_SCRIPT" add "$BD/Inventory - User Stories.md" "$T/s5" --proposed >/dev/null
IB="$FX/tasks/Inventory"
[ "$(ex_post '{"name":"Inventory","ids":{"US-04":""},"board":"Inventory","newBoard":true}')" = 409 ] &&
	ok "a Proposed story isn't exported" || bad "a Proposed story isn't exported" "$(head -c 300 "$T/j")"
has "it says to accept it first" "$T/j" "accept it first"
[ ! -d "$IB" ] && ok "and no board is made for it" || bad "and no board is made for it"
[ "$(ex_post '{"name":"Inventory","ids":{"US-01":"1"},"board":"Inventory","newBoard":true}')" = 409 ] &&
	ok "a story changed since the page read it isn't exported" || bad "a story changed since the page read it isn't exported"
[ "$(ex_post "{\"name\":\"Inventory\",\"ids\":{\"US-01\":\"$(hash_of US-01)\"},\"board\":\"Nope\"}")" = 404 ] &&
	ok "an unknown Tasks board" || bad "an unknown Tasks board"
[ "$(ex_post '{"name":"Inventory","ids":{},"board":"Inventory"}')" = 400 ] && ok "stories to export are named" || bad "stories to export are named"
[ "$(ex_post "{\"name\":\"Inventory\",\"ids\":{\"US-02\":\"$(hash_of US-02)\",\"US-01\":\"$(hash_of US-01)\"},\"board\":\"Inventory\",\"newBoard\":true}")" = 200 ] &&
	ok "export to a new board" || bad "export to a new board" "$(head -c 300 "$T/j")"
[ "$(pick "$T/j" "[(c['story'], c['task']) for c in d['export']['created']]")" = "[('US-01', 'T-0001'), ('US-02', 'T-0002')]" ] &&
	ok "a task each, in the stories' order" || bad "a task each, in the stories' order" "$(pick "$T/j" "d.get('export')")"
[ -f "$IB/board.json" ] && ok "the board is made" || bad "the board is made"
[ "$(pick "$IB/board.json" "d['order']['backlog']")" = "['T-0001', 'T-0002']" ] && ok "at the end of the backlog" || bad "at the end of the backlog"
TF1="$IB/items/T-0001 - Pick up an item from the floor.md"
TF2="$IB/items/T-0002 - Grab items from the floor.md"
[ -f "$TF1" ] && [ -f "$TF2" ] && ok "named by ID and title" || bad "named by ID and title" "$(ls "$IB/items")"
has "in the backlog" "$TF1" "- **Status:** Backlog"
has "the story sentence is the description" "$TF1" "**As a** player, **I want** to pick up items, **so that** I can use them."
has "its details under it" "$TF1" "### Details"
has "the details as written" "$TF1" "A full bag refuses."
has "the acceptance criteria are a section" "$TF1" "## Acceptance criteria"
has "each criterion" "$TF1" "- Given a full bag, when I walk over it, then it stays"
has "which story it was" "$TF1" '- **Story:** US-01 on the design board "Inventory"'
hasnt "Ungrouped isn't a label" "$TF1" "Ungrouped"
has "the group is the label" "$TF2" "- **Labels:** Pickup"
[ "$(pick "$T/j" "(d['exported']['US-01']['task'], d['exported']['US-01']['changed'], 'US-04' in d['exported'])")" = "('T-0001', False, False)" ] &&
	ok "the board knows which task each became" || bad "the board knows which task each became" "$(pick "$T/j" "d.get('exported')")"
hasnt "never in the stories document" "$BD/Inventory - User Stories.md" "T-0001"
get "/api/tasks/task?name=Inventory&id=T-0001" >"$T/t1"
[ "$(pick "$T/t1" "[x for x in d['extra'] if x[0] == 'Story'][0][1]")" = 'US-01 on the design board "Inventory"' ] &&
	ok "the Tasks board reads the Story field" || bad "the Tasks board reads the Story field" "$(head -c 300 "$T/t1")"
[ "$(ex_post "{\"name\":\"Inventory\",\"ids\":{\"US-01\":\"$(hash_of US-01)\"},\"board\":\"Inventory\"}")" = 200 ] &&
	[ "$(pick "$T/j" "(d['export']['created'], d['export']['skipped'])")" = "([], ['US-01'])" ] &&
	ok "a story already exported is skipped" || bad "a story already exported is skipped" "$(pick "$T/j" "d.get('export')")"
[ "$(ls "$IB/items" | wc -l | tr -d ' ')" = 2 ] && ok "so no second task" || bad "so no second task"
post /api/stories/layout '{"name":"Inventory","cards":{"US-02":[30,40]}}' >/dev/null
get "/api/design?name=Inventory" >"$T/j"
[ "$(pick "$T/j" "sorted(d['exported'])")" = "['US-01', 'US-02']" ] && ok "moving a card keeps the record" || bad "moving a card keeps the record"
st_post "{\"name\":\"Inventory\",\"action\":\"edit\",\"id\":\"US-01\",\"hash\":\"$(hash_of US-01)\",\"title\":\"Pick up an item\"}" >/dev/null
get "/api/design?name=Inventory" >"$T/j"
[ "$(pick "$T/j" "d['exported']['US-01']['changed']")" = True ] && ok "a story edited after it went says so" || bad "a story edited after it went says so"
[ "$(tk delete "{\"name\":\"Inventory\",\"id\":\"T-0001\",\"rev\":\"$(pick "$T/t1" "d['rev']")\"}")" = 200 ] && ok "its task deleted" || bad "its task deleted" "$(cat "$T/tk")"
get "/api/design?name=Inventory" >"$T/j"
[ "$(pick "$T/j" "'US-01' in d['exported']")" = False ] && ok "frees the story to go again" || bad "frees the story to go again"
[ "$(ex_post "{\"name\":\"Inventory\",\"ids\":{\"US-01\":\"$(hash_of US-01)\"},\"board\":\"Inventory\"}")" = 200 ] &&
	[ "$(pick "$T/j" "d['export']['created']")" = "[{'story': 'US-01', 'task': 'T-0003'}]" ] &&
	ok "and it goes again, as a new task" || bad "and it goes again, as a new task" "$(pick "$T/j" "d.get('export')")"
[ "$(tk start "{\"name\":\"Inventory\",\"id\":\"T-0002\",\"project\":\"$HERE\"}")" = 200 ] && ok "a workflow starts from an exported story" || bad "a workflow starts from an exported story" "$(cat "$T/tk")"
ITK="$FX/features/T-0002 - Grab items from the floor/T-0002 - Grab items from the floor - Ticket.md"
has "its Ticket has the story" "$ITK" "- **Story:** US-02 on the design board"
has "and its acceptance criteria" "$ITK" "## Acceptance criteria"
# the whiteboard under the notes: what's added is kept with the cards, and so is the rest
[ "$(wbc whiteboard '{"kind":"design","ref":"Inventory","items":{"upsert":[{"id":"nt1","type":"text","x":1,"y":2,"text":"Note"}]}}')" = 200 ] &&
	ok "a text on a stories board" || bad "a text on a stories board" "$(cat "$T/wb")"
get "/api/design?name=Inventory" >"$T/j"
[ "$(pick "$T/j" "d['layout']['items']['nt1']['text']")" = Note ] && ok "the board's view has it" || bad "the board's view has it"
[ "$(pick "$T/j" "'US-02' in d['exported'] and len(d['groups']) > 0")" = True ] && ok "the exports are kept beside it" || bad "the exports are kept beside it"
post /api/stories/layout '{"name":"Inventory","cards":{"US-02":[31,41]}}' >/dev/null
get "/api/design?name=Inventory" >"$T/j"
[ "$(pick "$T/j" "('nt1' in d['layout']['items'], d['layout']['cards']['US-02'], 'US-02' in d['exported'])")" = "(True, [31.0, 41.0], True)" ] &&
	ok "the older layout call keeps the rest" || bad "the older layout call keeps the rest" "$(pick "$T/j" "d['layout']")"
# a story added where the Story tool was clicked (stories.sh add, no run)
[ "$(st_post '{"name":"Inventory","action":"add","title":"Throw an item","as":"player","want":"to throw items","soThat":"I can hit things","criteria":["Given an item, when I throw it, then it flies"],"at":[400,500]}')" = 200 ] &&
	ok "add a story" || bad "add a story" "$(head -c 300 "$T/j")"
NEW=$(pick "$T/j" "d['added']")
has "it is in the document" "$BD/Inventory - User Stories.md" "### $NEW: Throw an item"
[ "$(pick "$T/j" "([s['status'] for s in d['stories'] if s['id'] == '$NEW'][0], d['layout']['cards']['$NEW'])")" = "('Accepted', [400.0, 500.0])" ] &&
	ok "accepted, where it was clicked" || bad "accepted, where it was clicked" "$(head -c 300 "$T/j")"
[ "$(st_post '{"name":"Inventory","action":"add","title":"No criteria","as":"player","want":"x","soThat":"y","criteria":[]}')" = 400 ] &&
	ok "a new story needs its fields" || bad "a new story needs its fields"
# Write it for me: a Proposed story from the line, then the skill's alter run on it
[ "$(st_post '{"name":"Inventory","action":"add","note":"players can juggle items","at":[10,10]}')" = 200 ] &&
	ok "a story from a line" || bad "a story from a line" "$(head -c 300 "$T/j")"
JUG=$(pick "$T/j" "d['added']")
[ "$(pick "$T/j" "[s['status'] for s in d['stories'] if s['id'] == '$JUG'][0]")" = Proposed ] && ok "it waits as Proposed" || bad "it waits as Proposed"
runs_done 4 && ok "the alter run ends" || bad "the alter run ends"
has "the skill rewrites it" "$T/claude-prompt" "/design:tt-user-stories alter \"Inventory - User Stories.md\" $JUG"
has "from the person's line" "$T/claude-note" "Write this story properly from the designer's note: players can juggle items"
fi

echo "# whiteboards"
for f in whiteboard.js whiteboard.css whiteboards.js; do [ "$(code "$U/static/$f")" = 200 ] && ok "$f served" || bad "$f served"; done
get /api/whiteboards >"$T/j"
has "no whiteboards yet" "$T/j" '"boards": []'
[ "$(wbc whiteboards/new '{"name":"a/b"}')" = 400 ] && ok "a whiteboard's name is a file's" || bad "a whiteboard's name is a file's"
[ "$(wbc whiteboards/new '{"name":"Plan"}')" = 200 ] && ok "a new whiteboard" || bad "a new whiteboard" "$(cat "$T/wb")"
[ "$(wbc whiteboards/new '{"name":"Plan"}')" = 409 ] && ok "not made twice" || bad "not made twice"
[ -f "$TATTY_HOME/whiteboards/Plan.json" ] && ok "kept in Tatty's home" || bad "kept in Tatty's home"
[ "$(wbc whiteboard '{"kind":"blank","ref":"Plan","items":{"upsert":[{"id":"na1","type":"text","x":10,"y":20,"text":"Hello"},{"id":"nb2","type":"comment","x":0,"y":0,"text":"Why?","pin":"na1"},{"id":"nc3","type":"text","x":300,"y":20,"text":"Two","colour":3}]},"lines":{"upsert":[{"id":"nl1","from":"na1","to":"nc3","label":"then"}]}}')" = 200 ] &&
	ok "texts, a comment and a line" || bad "texts, a comment and a line" "$(cat "$T/wb")"
get "/api/whiteboard?kind=blank&ref=Plan" >"$T/j"
[ "$(pick "$T/j" "(len(d['items']), d['items']['nb2']['pin'], d['items']['nc3']['colour'], d['lines']['nl1']['arrow'], d['lines']['nl1']['label'])")" = "(3, 'na1', 3, True, 'then')" ] &&
	ok "read back" || bad "read back" "$(head -c 400 "$T/j")"
wbc whiteboard '{"kind":"blank","ref":"Plan","items":{"upsert":[{"id":"na1","x":50}]}}' >/dev/null
get "/api/whiteboard?kind=blank&ref=Plan" >"$T/j"
[ "$(pick "$T/j" "(d['items']['na1']['x'], d['items']['na1']['text'])")" = "(50.0, 'Hello')" ] && ok "a change keeps the rest of the item" || bad "a change keeps the rest of the item"
[ "$(wbc whiteboard '{"kind":"blank","ref":"Plan","items":{"upsert":[{"id":"x1","type":"text","x":0,"y":0}]}}')" = 400 ] && ok "item ids are the page's own form" || bad "item ids are the page's own form"
[ "$(wbc whiteboard '{"kind":"blank","ref":"Plan","items":{"upsert":[{"id":"nz9","type":"box","x":0,"y":0}]}}')" = 400 ] && ok "only texts and comments" || bad "only texts and comments"
[ "$(wbc whiteboard '{"kind":"blank","ref":"Plan","items":{"upsert":[{"id":"nz9","type":"text","x":"a","y":0}]}}')" = 400 ] && ok "a place is numbers" || bad "a place is numbers"
[ "$(wbc whiteboard '{"kind":"blank","ref":"Plan","lines":{"upsert":[{"id":"nl2","from":"na1","to":"na1"}]}}')" = 400 ] && ok "a line joins two things" || bad "a line joins two things"
[ "$(wbc whiteboard '{"kind":"nope","ref":"Plan"}')" = 400 ] && ok "a known kind of board" || bad "a known kind of board"
[ "$(wbc whiteboard '{"kind":"blank","ref":"Nope"}')" = 404 ] && ok "an unknown whiteboard" || bad "an unknown whiteboard"
get "/api/whiteboard?kind=blank&ref=Plan" >"$T/before"
[ "$(wbc whiteboard '{"kind":"blank","ref":"Plan","items":{"upsert":[{"id":"nq1","type":"text","x":0,"y":0,"text":"fine"},{"id":"bad","type":"text","x":0,"y":0}]}}')" = 400 ] &&
	get "/api/whiteboard?kind=blank&ref=Plan" >"$T/after" && cmp -s "$T/before" "$T/after" && ok "a refused batch changes nothing" || bad "a refused batch changes nothing"
$PY -c "import json; print(json.dumps({'kind': 'blank', 'ref': 'Plan', 'items': {'upsert': [{'id': 'nlong', 'type': 'text', 'x': 0, 'y': 0, 'text': 'x' * 5000}]}}))" >"$T/long.json"
curl -s -o /dev/null -H "X-TT-Token: $K" -H 'Content-Type: application/json' --data-binary @"$T/long.json" "$U/api/whiteboard"
get "/api/whiteboard?kind=blank&ref=Plan" >"$T/j"
[ "$(pick "$T/j" "len(d['items']['nlong']['text'])")" = 4000 ] && ok "a text is cut at 4000 characters" || bad "a text is cut at 4000 characters"
wbc whiteboard '{"kind":"blank","ref":"Plan","items":{"remove":["na1","nlong"]}}' >/dev/null
get "/api/whiteboard?kind=blank&ref=Plan" >"$T/j"
[ "$(pick "$T/j" "(sorted(d['items']), d['lines'], d['items']['nb2']['pin'])")" = "(['nb2', 'nc3'], {}, None)" ] &&
	ok "a removed item takes its lines and lets go of its comments" || bad "a removed item takes its lines and lets go of its comments" "$(head -c 300 "$T/j")"
get /api/events >"$T/ev"
has "a change is an event" "$T/ev" '"type": "whiteboard"'
get /api/whiteboards >"$T/j"
[ "$(pick "$T/j" "[(b['name'], b['items'], b['lines']) for b in d['boards']]")" = "[('Plan', 2, 0)]" ] && ok "listed, counted" || bad "listed, counted" "$(head -c 300 "$T/j")"
[ "$(wbc whiteboards/delete '{"name":"Plan"}')" = 200 ] && ok "a whiteboard deleted" || bad "a whiteboard deleted"
[ -f "$TATTY_HOME/whiteboards/.deleted/Plan.json" ] && [ ! -f "$TATTY_HOME/whiteboards/Plan.json" ] && ok "out of the way, not gone" || bad "out of the way, not gone"
[ "$(code -H "X-TT-Token: $K" "$U/api/whiteboard?kind=blank&ref=Plan")" = 404 ] && ok "and no longer there" || bad "and no longer there"
# a feature's whiteboard: its documents are the cards
[ "$(wbc whiteboard '{"kind":"feature","ref":"Demo","cards":{"Demo - Task Status.md":[5,6]}}')" = 200 ] && ok "a feature's whiteboard" || bad "a feature's whiteboard" "$(cat "$T/wb")"
get "/api/whiteboard?kind=feature&ref=Demo" >"$T/j"
[ "$(pick "$T/j" "('Demo - Task Status.md' in [x['file'] for x in d['docs']], d['cards']['Demo - Task Status.md'])")" = "(True, [5.0, 6.0])" ] &&
	ok "its documents, and where they sit" || bad "its documents, and where they sit" "$(head -c 300 "$T/j")"
ls "$TATTY_HOME/boards/"*.json >/dev/null 2>&1 && ok "in <home>/boards" || bad "in <home>/boards"
[ "$(code -H "X-TT-Token: $K" "$U/api/whiteboard?kind=feature&ref=Nope")" = 404 ] && ok "an unknown feature" || bad "an unknown feature"

echo "# chats"
# A chat is a headless claude of its own, one run a turn: the first names its
# conversation (--session-id), the rest go on with it (--resume). It only reads.
cat >"$T/claude-chat.sh" <<'EOS'
#!/usr/bin/env bash
d=$(dirname "$0")
printf '%s\n' "$@" >"$d/chat.args"
cat >"$d/chat.prompt"
echo "${TATTY_SESSION:-none}" >"$d/chat.session"
pwd >"$d/chat.cwd"
sid=""; prev=""
for a in "$@"; do [ "$prev" = --session-id ] && sid=$a; prev=$a; done
# Claude Code keeps a conversation once there is a message in it
[ -n "$sid" ] && mkdir -p "$CLAUDE_CONFIG_DIR/projects/chat" && : >"$CLAUDE_CONFIG_DIR/projects/chat/$sid.jsonl"
echo '{"type":"system","subtype":"init"}'
# (its output elsewhere: a stopped turn ends when the claude it stands in for does, not when the sleep would)
[ -f "$d/chat-slow" ] && sleep 20 >/dev/null 2>&1
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/x/README.md"}}]}}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"It reads the README."}]}}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"It reads the README.","total_cost_usd":0.02}'
EOS
mkdir -p "$T/chatproj"
CP=$(cd "$T/chatproj" && { pwd -W 2>/dev/null || pwd; })
cpost() { curl -s -o "$T/j" -w '%{http_code}' -H "X-TT-Token: $K" -H 'Content-Type: application/json' -d "$2" "$U$1"; }
# chat_done <id> <n>: the chat has finished n turns (or summaries) within ten seconds
chat_done() {
	for _ in $(seq 1 50); do
		get /api/events >"$T/ev"
		[ "$(pick "$T/ev" "len([e for e in d if e['type'] == 'chat' and e.get('id') == '$1' and e.get('done')])")" -ge "$2" ] && return 0
		sleep 0.2
	done
	return 1
}
# after <flag>: what the last turn was given after that flag
after() { $PY -c "import sys; a = open(sys.argv[1], encoding='utf-8').read().split('\n'); print(a[a.index(sys.argv[2]) + 1] if sys.argv[2] in a else '')" "$T/chat.args" "$1"; }
[ "$(cpost /api/chat/new '{"kind":"main"}')" = 400 ] && ok "a chat needs a folder to work in" || bad "a chat needs a folder to work in" "$(cat "$T/j")"
[ "$(cpost /api/chat/new "{\"kind\":\"side\",\"project\":\"$CP\"}")" = 400 ] && ok "a side chat needs what it is about" || bad "a side chat needs what it is about"
[ "$(cpost /api/chat/new '{"kind":"other"}')" = 400 ] && ok "main or side" || bad "main or side"
[ "$(cpost /api/chat/new "{\"kind\":\"main\",\"project\":\"$CP\",\"feature\":\"Demo\"}")" = 200 ] && ok "a main chat" || bad "a main chat" "$(cat "$T/j")"
C1=$(pick "$T/j" "d['id']")
[ -f "$TATTY_HOME/chats/$C1.json" ] && ok "kept in Tatty's home" || bad "kept in Tatty's home"
SID=$(pick "$T/j" "d['claudeSession']")
get /api/chats >"$T/c"
[ "$(pick "$T/c" "[(c['id'], c['kind'], 'messages' in c) for c in d]")" = "[('$C1', 'main', False)]" ] && ok "listed, without its messages" || bad "listed, without its messages" "$(head -c 300 "$T/c")"
get /api/chat/projects >"$T/c"
has "its folder is one a new chat can work in" "$T/c" "chatproj"
[ "$(code -H "X-TT-Token: $K" "$U/api/chat?id=c-00000000")" = 404 ] && ok "an unknown chat" || bad "an unknown chat"
[ "$(cpost /api/chat/say "{\"id\":\"$C1\",\"text\":\"\"}")" = 400 ] && ok "an empty message isn't sent" || bad "an empty message isn't sent"
# a workflow running beside it: nothing of the chat reaches it
post /api/hello '{"tag":"s-chatwf","session":"wf-1"}' >/dev/null
get /api/events >"$T/ev"
n_wf=$(pick "$T/ev" "len([e for e in d if e.get('tag') == 's-chatwf'])")
[ "$(cpost /api/chat/say "{\"id\":\"$C1\",\"text\":\"What is this?\"}")" = 202 ] && ok "a message starts a turn" || bad "a message starts a turn" "$(cat "$T/j")"
chat_done "$C1" 1 && ok "the turn ends" || bad "the turn ends"
get "/api/chat?id=$C1" >"$T/c"
[ "$(pick "$T/c" "[(m['role'], m['text']) for m in d['messages']]")" = "[('you', 'What is this?'), ('claude', 'It reads the README.')]" ] &&
	ok "the message and the answer are kept" || bad "the message and the answer are kept" "$(head -c 400 "$T/c")"
[ "$(pick "$T/c" "(d['messages'][1]['steps'], d['cost'], d['busy'])")" = "(['Reading README.md'], 0.02, False)" ] &&
	ok "with its steps and what it cost" || bad "with its steps and what it cost" "$(head -c 400 "$T/c")"
[ "$(after --session-id)" = "$SID" ] && ok "the first turn names its conversation" || bad "the first turn names its conversation" "$(cat "$T/chat.args")"
[ "$(after --tools)" = "Read,Glob,Grep,Skill" ] && ok "it may only read, and use skills" || bad "it may only read, and use skills" "$(after --tools)"
[ "$(after --permission-mode)" = dontAsk ] && ok "and asks nobody" || bad "and asks nobody"
hasnt "nothing that writes" "$T/chat.args" "Write"
hasnt "nothing that edits" "$T/chat.args" "Edit"
hasnt "no commands" "$T/chat.args" "Bash"
hasnt "its conversation is kept" "$T/chat.args" "--no-session-persistence"
has "it isn't one of Tatty's sessions" "$T/chat.session" "none"
has "it works in its folder" "$T/chat.cwd" "chatproj"
has "a main chat's message goes as it is" "$T/chat.prompt" "What is this?"
hasnt "with no side-chat skill" "$T/chat.prompt" "/tatty:side-chat"
[ "$(cpost /api/chat/say "{\"id\":\"$C1\",\"text\":\"And then?\"}")" = 202 ] && chat_done "$C1" 2 && ok "a second turn" || bad "a second turn"
[ "$(after --resume)" = "$SID" ] && ok "goes on with the same conversation" || bad "goes on with the same conversation" "$(cat "$T/chat.args")"
hasnt "rather than naming a new one" "$T/chat.args" "--session-id"
get /api/events >"$T/ev"
[ "$(pick "$T/ev" "len([e for e in d if e['type'] == 'chat' and 'tag' in e])")" = 0 ] && ok "a chat's events carry no tag" || bad "a chat's events carry no tag"
[ "$(pick "$T/ev" "len([e for e in d if e.get('tag') == 's-chatwf'])")" = "$n_wf" ] && ok "the workflow beside it hears nothing of it" || bad "the workflow beside it hears nothing of it"
get "/api/inbox?tag=s-chatwf" >"$T/c"
has "and nothing is put in front of it" "$T/c" '"status": "empty"'
# a side chat: what it is about goes in front of the first message
CTX='{"source":{"from":"selection","feature":"Demo","tag":"s-chatwf","session":"Demo : Workflow","ts":1700000000},"selected":"retry the upload","around":"First it saves. Then it can retry the upload."}'
[ "$(cpost /api/chat/new "{\"kind\":\"side\",\"project\":\"$CP\",\"context\":$CTX}")" = 200 ] && ok "a side chat" || bad "a side chat" "$(cat "$T/j")"
C2=$(pick "$T/j" "d['id']")
[ "$(pick "$T/j" "d['title']")" = "About: retry the upload" ] && ok "named by what it is about" || bad "named by what it is about" "$(pick "$T/j" "d['title']")"
pick "$T/j" "d['context']['summary']" >"$T/c"
has "Tatty's summary says where it came from" "$T/c" "Selected text from a reply in the workflow Demo : Workflow at"
has "and which feature" "$T/c" "in the feature Demo"
[ "$(cpost /api/chat/say "{\"id\":\"$C2\",\"text\":\"Why retry?\"}")" = 202 ] && chat_done "$C2" 1 && ok "its first message" || bad "its first message"
[ "$(head -n 1 "$T/chat.prompt")" = "/tatty:side-chat" ] && ok "goes to the side-chat skill" || bad "goes to the side-chat skill" "$(head -n 3 "$T/chat.prompt")"
has "after the context" "$T/chat.prompt" "<context>"
has "with the summary" "$T/chat.prompt" "Summary: Selected text from a reply"
has "what was picked out" "$T/chat.prompt" "retry the upload"
has "and what is around it" "$T/chat.prompt" "First it saves."
[ "$(tail -n 1 "$T/chat.prompt")" = "Why retry?" ] && ok "then the message" || bad "then the message" "$(tail -n 2 "$T/chat.prompt")"
[ "$(cpost /api/chat/say "{\"id\":\"$C2\",\"text\":\"More?\"}")" = 202 ] && chat_done "$C2" 2 && ok "a follow-up" || bad "a follow-up"
hasnt "goes alone" "$T/chat.prompt" "<context>"
get "/api/chat?id=$C2" >"$T/c"
[ "$(pick "$T/c" "[m.get('withContext') for m in d['messages'] if m['role'] == 'you']")" = "[True, False]" ] && ok "the chat says which message had it" || bad "the chat says which message had it"
CODE='{"source":{"from":"code","feature":"Demo","file":"Demo - Plan.md","doc":"Plan","heading":"Steps","lang":"python"},"selected":"print(1)","around":"## Steps\nprint(1)"}'
[ "$(cpost /api/chat/new "{\"kind\":\"side\",\"project\":\"$CP\",\"context\":$CODE}")" = 200 ] && ok "a side chat about a code block" || bad "a side chat about a code block" "$(cat "$T/j")"
pick "$T/j" "d['context']['summary']" >"$T/c"
has "says what and where" "$T/c" 'A python code block from the document Plan, section "Steps"'
# the summary a small model writes, when chosen in Settings
post /api/settings '{"chatSummary":"nonsense"}' >"$T/c"
[ "$(pick "$T/c" "d['chatSummary']")" = tatty ] && ok "the summary setting is tatty or model" || bad "the summary setting is tatty or model"
post /api/settings '{"chatSummary":"model"}' >/dev/null
[ "$(cpost /api/chat/new "{\"kind\":\"side\",\"project\":\"$CP\",\"context\":$CTX}")" = 200 ] && ok "a side chat summarised by a model" || bad "a side chat summarised by a model"
C3=$(pick "$T/j" "d['id']")
chat_done "$C3" 1 && ok "the summary is written" || bad "the summary is written"
get "/api/chat?id=$C3" >"$T/c"
[ "$(pick "$T/c" "(d['context']['summary'], d['context']['summaryBy'])")" = "('A summary by the model.', 'model')" ] && ok "by the model" || bad "by the model" "$(head -c 400 "$T/c")"
has "a small one" "$T/summary.args" "haiku"
has "with nothing to do but write" "$T/summary.args" "--no-session-persistence"
post /api/settings '{"chatSummary":"tatty"}' >/dev/null
# one turn at a time; Stop ends it
touch "$T/chat-slow"
cpost /api/chat/say "{\"id\":\"$C1\",\"text\":\"Slowly\"}" >/dev/null
sleep 0.5
[ "$(cpost /api/chat/say "{\"id\":\"$C1\",\"text\":\"Again\"}")" = 409 ] && ok "one turn at a time" || bad "one turn at a time"
[ "$(cpost /api/chat/say "{\"id\":\"$C2\",\"text\":\"Meanwhile\"}")" = 202 ] && ok "but another chat may answer meanwhile" || bad "but another chat may answer meanwhile"
post /api/chat/stop "{\"id\":\"$C1\"}" >"$T/c"
has "stop" "$T/c" '"ok": true'
chat_done "$C1" 3 && ok "a stopped turn ends" || bad "a stopped turn ends"
get "/api/chat?id=$C1" >"$T/c"
[ "$(pick "$T/c" "(d['messages'][-1]['role'], d['messages'][-1]['text'])")" = "('error', 'Stopped.')" ] && ok "and says so" || bad "and says so" "$(head -c 400 "$T/c")"
post /api/chat/stop "{\"id\":\"$C2\"}" >/dev/null
chat_done "$C2" 3
rm -f "$T/chat-slow"
# closing a chat's tab
[ "$(cpost /api/chat/close "{\"id\":\"$C1\"}")" = 200 ] && ok "close a chat" || bad "close a chat"
get /api/chats >"$T/c"
hasnt "it leaves the tabs" "$T/c" "$C1"
[ -f "$TATTY_HOME/chats/$C1.json" ] && ok "its file is kept" || bad "its file is kept"
[ "$(cpost /api/chat/say "{\"id\":\"$C1\",\"text\":\"Hello?\"}")" = 404 ] && ok "a closed chat takes no message" || bad "a closed chat takes no message"
post /api/bye '{"tag":"s-chatwf"}' >/dev/null

echo "# close"
expect "close" 0 bash "$W" close
sleep 1
expect "status after close" 1 bash "$W" status

finish
