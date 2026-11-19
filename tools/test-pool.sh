#!/usr/bin/env bash
# test-pool.sh: the worktree pool (plugins/tatty/scripts/pool.sh) on a throwaway repository.
# Run: bash tools/test-pool.sh   (exits non-zero when a check fails)
set -u
here=$(cd -P "$(dirname "$0")" && pwd -P)
POOL="$here/../plugins/tatty/scripts/pool.sh"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok() { pass=$((pass + 1)); echo "ok    $1"; }
bad() { fail=$((fail + 1)); echo "FAIL  $1  ${2:-}"; }
check() { # check <name> <expected exit> <command...>
	local name=$1 want=$2; shift 2
	local out; out=$("$@" 2>&1); local got=$?
	[ "$got" = "$want" ] && ok "$name" || bad "$name" "exit $got, wanted $want: $out"
	LAST=$out
}
has() { case $LAST in *"$2"*) ok "$1" ;; *) bad "$1" "no '$2' in: $LAST" ;; esac; }

g() { git -c user.name=t -c user.email=t@t "$@"; }
mkrepo() { # mkrepo <name> <unity yes|no>
	g init -q -b main "$T/$1-origin" && (cd "$T/$1-origin" && echo x >a.txt && echo Library/ >.gitignore &&
		{ [ "$2" = yes ] && mkdir ProjectSettings && echo v >ProjectSettings/ProjectVersion.txt; true; } &&
		git add -A && g commit -qm init) >/dev/null 2>&1
	git clone -q "$T/$1-origin" "$T/$1" 2>/dev/null
	[ "$2" = yes ] && { mkdir -p "$T/$1/Library"; echo cache >"$T/$1/Library/c.bin"; }
}

mkrepo u yes
cd "$T/u" || exit 1
check "no pool yet" 5 bash "$POOL" status
check "init two slots" 0 bash "$POOL" init --size 2
has "a Unity project copies Library" "copied Library"
[ -f "$T/u.pool/slot-1/Library/c.bin" ] && ok "and the cache is there" || bad "and the cache is there"
check "claim takes a slot" 0 bash "$POOL" claim feat/one
check "claim takes the last" 0 bash "$POOL" claim feat/two
has "and says to add one" "last free slot"
check "none free is exit 4" 4 bash "$POOL" claim feat/three
check "a taken branch name is refused" 1 bash "$POOL" claim feat/one
check "add one slot" 0 bash "$POOL" add
check "the new slot is claimable" 0 bash "$POOL" claim feat/three
echo dirty >"$T/u.pool/slot-1/new.txt"
check "a dirty slot isn't released" 1 bash "$POOL" release feat/one
rm "$T/u.pool/slot-1/new.txt"
check "a clean slot is released" 0 bash "$POOL" release feat/one
has "and its branch is kept" "feat/one is kept"
check "max stops add" 0 bash "$POOL" config max=3
check "add past max is refused" 1 bash "$POOL" add
check "a claimed slot isn't removed" 1 bash "$POOL" remove slot-2
check "a free slot is removed" 0 bash "$POOL" remove slot-1
check "size above max is refused" 2 bash "$POOL" config size=9

# a push to origin shows up as behind, and refresh brings free slots up to date
mkrepo p no
cd "$T/p" || exit 1
check "init in a project that isn't Unity" 0 bash "$POOL" init --size 1
[ ! -d "$T/p.pool/slot-1/Library" ] && ok "copies nothing" || bad "copies nothing"
(cd "$T/p-origin" && echo y >b.txt && git add -A && g commit -qm second) >/dev/null 2>&1
git fetch -q origin
check "refresh follows the base" 0 bash "$POOL" refresh
[ -f "$T/p.pool/slot-1/b.txt" ] && ok "and the slot has the new file" || bad "and the slot has the new file"

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
