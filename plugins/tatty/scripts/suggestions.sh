#!/usr/bin/env bash
# suggestions.sh: the Review Suggestions document of a feature, and the only thing that writes it
# (the skills never edit it by hand, so its layout never varies). The work is app/reviewdoc.py;
# this finds Python and passes the command on. Run it with no arguments for the commands.
set -u

command -v dirname >/dev/null 2>&1 || export PATH="/usr/bin:/bin:$PATH"
here=$(readlink -f "$(dirname "$0")" 2>/dev/null) || here=$(cd -P "$(dirname "$0")" && pwd -P)

# winpath <path>: a path Python on Windows can open; unchanged elsewhere
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# python: the first interpreter that really runs (as tatty.sh finds it; the Windows Store aliases are skipped)
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
PY=$(python) || { echo "suggestions.sh: no Python 3.8+ found." >&2; exit 3; }

# the document is the second word: make it a path Python can open
if [ $# -ge 2 ]; then
	cmd=$1; doc=$(winpath "$2"); shift 2
	exec $PY "$(winpath "$here/../app/reviewdoc.py")" "$cmd" "$doc" "$@"
fi
exec $PY "$(winpath "$here/../app/reviewdoc.py")" "$@"
