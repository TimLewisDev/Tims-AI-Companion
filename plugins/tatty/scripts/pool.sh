#!/usr/bin/env bash
# pool.sh: the worktree pool of a repository (ready worktrees to claim for a feature or a bug fix).
# The work is app/worktreepool.py; this finds Python and passes the command on.
# Run it with no arguments for the commands.
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
PY=$(python) || { echo "pool.sh: no Python 3.8+ found." >&2; exit 3; }

[ $# -eq 0 ] && set -- --help
exec $PY "$(winpath "$here/../app/worktreepool.py")" "$@"
