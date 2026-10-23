#!/usr/bin/env bash
# test-companion.sh: the tray companion's windows, for real. Opens Tatty with a
# DevTools port, walks every view through the page's own buttons, and after each
# step asks window-check.py whether the shell sees what it should -- and whether
# the window and its WebView2 came through the switch alive.
#
# This is the only test that builds and runs TtCompanion.exe, so it is opt-in
# rather than part of test-tatty.sh. It shows real windows on the desktop and
# uses the real Tatty home, as there is only one companion per machine (a named
# mutex) and only one of it can be running.
#
# Needs Windows, bash, Python 3.8+ and the .NET 9 SDK; skips (exit 0) without
# them. Prints one line per check and a count; exit 1 on failure.
set -u

root=$(cd "$(dirname "$0")/.." && pwd)
W="$root/plugins/tatty/scripts/tatty.sh"
CHECK="$root/tools/window-check.py"
PORT=${TATTY_DEVTOOLS_PORT:-9333}
pass=0; fail=0

ok() { pass=$((pass + 1)); echo "ok    $1"; }
bad() { fail=$((fail + 1)); echo "FAIL  $1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
finish() { bash "$W" close >/dev/null 2>&1; echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]; exit; }

case "$(uname -s 2>/dev/null)" in
	MINGW* | MSYS* | CYGWIN* | Windows*) ;;
	*) echo "skip  the companion is Windows-only"; exit 0 ;;
esac
PY=python; command -v python3 >/dev/null 2>&1 && python3 -c 1 2>/dev/null && PY=python3
if ! command -v "$PY" >/dev/null 2>&1; then echo "skip  no Python 3.8+"; exit 0; fi
if ! command -v dotnet >/dev/null 2>&1; then echo "skip  no .NET SDK: the companion can't be built"; exit 0; fi

# One companion per machine, so start from nothing rather than fighting one that
# is already up. close asks it to go; it leaves a few seconds later.
bash "$W" close >/dev/null 2>&1
sleep 8
command -v taskkill >/dev/null 2>&1 && taskkill //F //IM TtCompanion.exe >/dev/null 2>&1
trap 'bash "$W" close >/dev/null 2>&1' EXIT

# WebView2 reads this itself; page-check.py and window-check.py attach to it.
export WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$PORT"
# Tatty keeps still on a machine whose animations are off (Settings ▸
# Accessibility ▸ Visual effects), and this test has to see him move. The
# companion inherits this from the server it is started by.
export TATTY_ANIMATE=1
if ! bash "$W" open >/dev/null 2>&1; then
	echo "skip  Tatty wouldn't open (no toolbox, or the build failed)"
	exit 0
fi
# The first run builds the exe, and WebView2 takes a moment more.
for _ in $(seq 60); do
	"$PY" "$CHECK" >/dev/null 2>&1 && break
	sleep 1
done
if ! "$PY" "$CHECK" >/dev/null 2>&1; then
	echo "skip  the companion never showed a window"
	finish
fi
sleep 3

# Tatty tucks himself away after ten quiet seconds, and only a question or a
# reply brings him back: that is the one event the poll pops up for.
wake() { echo "test-companion.sh" | bash "$W" show reply "$1" >/dev/null 2>&1; sleep 3; }

# step <name> <expected mode> [mode to switch to first]
step() {
	local name=$1 want=$2 to=${3:-}
	local args=(--page "$PORT" --expect "$want")
	[ -n "$to" ] && args+=(--switch "$to")
	if out=$("$PY" "$CHECK" "${args[@]}" 2>&1); then
		ok "$name"
	else
		bad "$name" "$(printf '%s' "$out" | "$PY" -c 'import json,sys
try:
	d = json.load(sys.stdin)
except ValueError:
	print(sys.stdin.read()[:300]); raise SystemExit
s = d.get("switch") or {}
print("; ".join(d.get("failures") or []) or d.get("error", ""),
      "| same_hwnd=%s same_runtime=%s same_page=%s" % (s.get("same_hwnd"), s.get("same_runtime"), s.get("same_page"))
      if s else "")' 2>/dev/null)"
	fi
}

echo "# the companion's views"
wake "compact"
step "compact: on top, no Alt-Tab, the proxy has the button" compact
step "full panel: in Alt-Tab, its own button, not on top" expanded expanded
step "maximised: fills the work area" maximised maximised
step "minimised: down in the taskbar, keeps its button" minimised minimised
wake "restore"
step "restored: back where it was" maximised
step "compact again" compact compact
step "tucked away: nothing on screen, the proxy has the button back" hidden hidden
wake "popped up"
step "popped up compact again" compact

echo
echo "# a section finished"
# The confetti has a window of its own, click-through so it can cover far more
# than Tatty does without taking a click off the desktop (every step above has
# already asserted that much). Here: it is seen while something is flying, and
# gone again once the last piece has landed.
stage() {
	"$PY" "$CHECK" 2>/dev/null | "$PY" -c 'import json, sys
found = [w for w in json.load(sys.stdin).get("windows", []) if w["role"] == "effects"]
print("missing" if len(found) != 1 else ("up" if found[0]["style"]["visible"] else "away"))'
}
bash "$W" cheer build.complete >/dev/null 2>&1
sleep 1
[ "$(stage)" = up ] && ok "the confetti is up" || bad "the confetti is up" "the stage is $(stage)"
sleep 5
[ "$(stage)" = away ] && ok "and away again once it has landed" || bad "and away again once it has landed" "the stage is $(stage)"

echo
echo "# nothing was rebuilt on the way"
step "the window and its WebView2 survived a round trip" expanded expanded
step "and back" compact compact

echo
echo "# leaving"
# Tatty's windows refuse to be closed, because closing one is how a person says
# "put it away". Refusing it during a shutdown cancels the shutdown too, which
# left the process running with its windows already gone.
if command -v tasklist >/dev/null 2>&1; then
	bash "$W" close >/dev/null 2>&1
	for _ in $(seq 20); do
		tasklist //FI "IMAGENAME eq TtCompanion.exe" 2>/dev/null | grep -q TtCompanion || break
		sleep 1
	done
	if tasklist //FI "IMAGENAME eq TtCompanion.exe" 2>/dev/null | grep -q TtCompanion; then
		bad "the companion leaves when its server does" "TtCompanion.exe is still running"
	else
		ok "the companion leaves when its server does"
	fi
else
	echo "skip  no tasklist: can't see whether the companion left"
fi

finish
