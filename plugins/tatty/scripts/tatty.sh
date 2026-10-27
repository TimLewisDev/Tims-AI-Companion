#!/usr/bin/env bash
# tatty.sh: Tatty from the command line. Opens and closes Tatty (the tray
# companion on Windows, a browser tab elsewhere), and lets any agent that can run
# a shell command show things in, and ask questions through, Tatty's window. The
# server is app/server.py (Python standard library); this finds Python and passes
# the command on. Tatty is optional: nothing in the TT toolbox calls this.
set -u

usage() {
	cat >&2 <<'EOF'
usage: tatty.sh open [--no-browser]     start Tatty (if needed) and show it; prints the URL
       tatty.sh boot [--project DIR]    what the Desktop shortcut runs: the server and the tray app
                                        (looks for a newer Tatty first, and installs it with auto-update on)
       tatty.sh install [--pin]         Desktop and Start menu shortcuts for Tatty (Windows); they run the
                                        installed Tatty, or with --pin this checkout (no update look)
       tatty.sh uninstall               take them away
       tatty.sh status                  attached | attached (claude mod) | not open
       tatty.sh url                     the window's URL
       tatty.sh show <kind> <title>     show the text on stdin; kind: text markdown table status reply
       tatty.sh ask [--wait S]          ask the questions on stdin (JSON, AskUserQuestion shape);
                                        prints "<header><TAB><answer>" per question
       tatty.sh answer <id> [--wait S]  keep waiting on an earlier ask
       tatty.sh listen [--wait S]       the next message typed in the window
       tatty.sh cheer [<event>]         celebrate a milestone now, as the toolbox's ledger would
                                        (default build.complete); --prefix names the feature
       tatty.sh close                   stop Tatty's window

--wait is in seconds (default 100, under a 120 s shell-tool limit).
On Windows, open shows Tatty's tray companion (built with dotnet the first time,
into %LOCALAPPDATA%\Tatty\companion); elsewhere, or with TATTY_UI=browser, a
browser tab. --no-browser shows neither.
TATTY_PYTHON names the Python to use; TATTY_HOME where Tatty keeps its state.
Exit: 0 ok, 1 not open, 2 usage or server error, 3 no Python,
      5 no answer yet (prints id=<id>), 6 declined: ask in the terminal instead.
EOF
}

case ${1:-} in '' | -h | --help) usage; [ -n "${1:-}" ] && exit 0; exit 2 ;; esac

# Git Bash's own bash.exe (usr\bin), run straight from Windows as the Desktop
# shortcut does, has only Windows' PATH, which needn't hold its tools: put them
# first, for this script and everything the server runs after it.
command -v dirname >/dev/null 2>&1 || export PATH="/usr/bin:/bin:$PATH"

here=$(readlink -f "$(dirname "$0")" 2>/dev/null) || here=$(cd -P "$(dirname "$0")" && pwd -P)
SERVER="$here/../app/server.py"

# python: the first interpreter that really runs. The Windows Store aliases
# (…/WindowsApps/python3) can hang waiting to install, so they are skipped, and
# each check is time-boxed where `timeout` exists.
python() {
	local p path cap=""
	command -v timeout >/dev/null 2>&1 && cap="timeout 10"
	for p in ${TATTY_PYTHON:-python3 python py}; do
		path=$(command -v "$p" 2>/dev/null) || continue
		case $path in */WindowsApps/*) continue ;; esac
		[ "$p" = py ] && p="py -3"
		$cap $p -c 'import sys; sys.exit(sys.version_info < (3, 8))' </dev/null >/dev/null 2>&1 && { echo "$p"; return 0; }
	done
	return 1
}

# winpath <path>: a path Python on Windows can open; unchanged elsewhere
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

PY=$(python) || { echo "tatty.sh: no Python 3.8+ found, so Tatty isn't available; carry on in the terminal." >&2; exit 3; }

cmd=$1; shift
case $cmd in
open)
	exec $PY "$(winpath "$SERVER")" open --cwd "$(winpath "$PWD")" --bash "$(winpath "${BASH:-$(command -v bash)}")" "$@" ;;
boot | install)
	exec $PY "$(winpath "$SERVER")" "$cmd" --bash "$(winpath "${BASH:-$(command -v bash)}")" "$@" ;;
close) exec $PY "$(winpath "$SERVER")" stop ;;
uninstall) exec $PY "$(winpath "$SERVER")" uninstall ;;
status | url | show | ask | answer | listen | cheer) exec $PY "$(winpath "$SERVER")" "$cmd" "$@" ;;
*) usage; exit 2 ;;
esac
