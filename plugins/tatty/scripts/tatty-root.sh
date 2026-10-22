#!/usr/bin/env bash
# tatty-root.sh: Tatty's root folder, where the features being worked on live
# (<root>/features/<feature>/). The root is in the person's own folders, never
# in the Claude config folder; only the setting that names it is kept there,
# one line in ${TATTY_HOME:-${CLAUDE_CONFIG_DIR:-~/.claude}/tatty}/root.
# app/server.py reads the same file. Needs bash only.
set -u

usage() {
	cat >&2 <<'EOF'
usage: tatty-root.sh                      the root folder (exit 1: none set; prints the default, ~/Tatty)
       tatty-root.sh features             <root>/features (exit 1: no root set, or no such folder)
       tatty-root.sh set <path> [--create]
                                          make <path> the root; --create makes <path>/features too

TATTY_ROOT overrides the setting; TATTY_HOME is where Tatty keeps it.
Exit: 0 ok, 1 not set or missing, 2 usage or a refused path.
EOF
}

config=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
home=${TATTY_HOME:-$config/tatty}
setting="$home/root"

# norm <path>: forward slashes, no trailing slash, Windows drive form where cygpath exists
norm() {
	local p=$1
	command -v cygpath >/dev/null 2>&1 && p=$(cygpath -m "$p" 2>/dev/null || printf '%s' "$p")
	p=${p//\\//}
	[ "${p%/}" != "" ] && p=${p%/}
	printf '%s' "$p"
}

default_root() { norm "$HOME/Tatty"; }

current() {
	if [ -n "${TATTY_ROOT:-}" ]; then norm "$TATTY_ROOT"; return 0; fi
	[ -s "$setting" ] || return 1
	local r
	r=$(head -n 1 "$setting" | tr -d '\r')
	[ -n "$r" ] || return 1
	printf '%s' "$r"
}

absolute() { case $1 in /* | [A-Za-z]:[/\\]*) return 0 ;; esac; return 1; }

# canon <path>: the path in one spelling, whichever way it was written. On
# Windows a folder has a long and a short (8.3) name (tim.lewis, TIM~1.LEW): the
# nearest folder that exists is resolved to its real long name, the rest kept.
canon() {
	local d rest=""
	d=$(norm "$1")
	while [ ! -d "$d" ] && [ "${d%/*}" != "$d" ]; do rest="/${d##*/}$rest"; d=${d%/*}; done
	[ -d "$d" ] && d=$(cd "$d" 2>/dev/null && { pwd -W 2>/dev/null || pwd -P; }) || d=$(norm "$1") rest=""
	printf '%s%s' "$d" "$rest"
}

# inside <path> <dir>: the path is the dir or under it (any spelling, any case, as on Windows)
inside() {
	local p d
	p=$(canon "$1" | tr '[:upper:]' '[:lower:]')
	d=$(canon "$2" | tr '[:upper:]' '[:lower:]')
	[ "$p" = "$d" ] || case $p in "$d"/*) return 0 ;; *) return 1 ;; esac
}

case ${1:-} in
-h | --help) usage; exit 0 ;;
'')
	if r=$(current); then echo "$r"; exit 0; fi
	default_root
	echo
	exit 1
	;;
features)
	r=$(current) || exit 1
	echo "$r/features"
	[ -d "$r/features" ]
	;;
set)
	[ $# -ge 2 ] || { usage; exit 2; }
	path=$2 create=0
	[ "${3:-}" = --create ] && create=1
	absolute "$path" || { echo "tatty-root.sh: give a full path, not a relative one: $path" >&2; exit 2; }
	if inside "$path" "$config" || inside "$path" "$HOME/.claude"; then
		echo "tatty-root.sh: the root can't be inside the Claude config folder ($(norm "$config")); pick one of your own folders" >&2
		exit 2
	fi
	if [ "$create" = 1 ]; then
		mkdir -p "$path/features" || { echo "tatty-root.sh: couldn't create $path/features" >&2; exit 2; }
	fi
	[ -d "$path" ] || { echo "tatty-root.sh: no such folder: $path (add --create to make it)" >&2; exit 2; }
	mkdir -p "$home" || exit 2
	r=$(norm "$path")
	printf '%s\n' "$r" >"$setting"
	echo "$r"
	;;
*) usage; exit 2 ;;
esac
