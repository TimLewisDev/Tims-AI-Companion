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

# validate: a whole slot is ok; a checkout cut off half way is broken and the repair mends it
mkrepo v no
cd "$T/v" || exit 1
check "init two slots to validate" 0 bash "$POOL" init --size 2
check "whole slots are ok" 0 bash "$POOL" validate
has "and it says so" "slot-1: ok"
ADMIN=$(sed 's/^gitdir: //' "$T/v.pool/slot-1/.git")
rm -f "$ADMIN/index"
check "a missing index is broken" 3 bash "$POOL" validate
has "named as an unfinished checkout" "never finished"
has "and slot-2 is still ok" "slot-2: ok"
check "rebuild mends it" 0 bash "$POOL" repair slot-1 rebuild
check "and it validates again" 0 bash "$POOL" validate
echo x >"$ADMIN/index.lock"
check "a fresh lock is a command still running, not a fault" 0 bash "$POOL" validate
touch -d '1 hour ago' "$ADMIN/index.lock" 2>/dev/null || touch -t 200001010000 "$ADMIN/index.lock"
check "an old lock is a fault" 3 bash "$POOL" validate
has "that clear-lock offers" "[clear-lock]"
check "clear-lock removes it" 0 bash "$POOL" repair slot-1 clear-lock
[ ! -e "$ADMIN/index.lock" ] && ok "the lock is gone" || bad "the lock is gone"
check "a repair that isn't needed is refused" 1 bash "$POOL" repair slot-1 clear-lock
rm "$T/v.pool/slot-2/a.txt"
check "a deleted tracked file is broken" 3 bash "$POOL" validate
has "naming the file" "missing from the folder (first: a.txt)"
check "restore-files brings it back" 0 bash "$POOL" repair slot-2 restore-files
[ -f "$T/v.pool/slot-2/a.txt" ] && ok "the file is back" || bad "the file is back"
rm -rf "$T/v.pool/slot-2"
check "a deleted slot folder isn't a slot any more" 0 bash "$POOL" validate
bash "$POOL" claim feat/v >/dev/null
echo mine >"$T/v.pool/slot-1/work.txt"
rm "$T/v.pool/slot-1/a.txt"
check "a claimed slot with missing files is broken" 3 bash "$POOL" validate
check "restore-files is not offered on a claimed slot" 1 bash "$POOL" repair slot-1 restore-files
check "rebuild is" 0 bash "$POOL" repair slot-1 rebuild
[ "$(git -C "$T/v.pool/slot-1" branch --show-current)" = feat/v ] && ok "on its claimed branch" || bad "on its claimed branch"
[ ! -e "$T/v.pool/slot-1/work.txt" ] && ok "uncommitted files are lost" || bad "uncommitted files are lost"
check "the claim is kept" 0 bash "$POOL" release feat/v
# a warm copy that never happened is a look, and one repair copies it
mkrepo w yes
cd "$T/w" || exit 1
check "init a Unity pool to validate" 0 bash "$POOL" init --size 1
rm -rf "$T/w.pool/slot-1/Library"
check "a missing warm copy is a look, not ok" 3 bash "$POOL" validate
has "that offers the cache copy" "[warm]"
check "the copy mends it" 0 bash "$POOL" repair slot-1 warm
[ -f "$T/w.pool/slot-1/Library/c.bin" ] && ok "the cache is back" || bad "the cache is back"
check "and it validates again" 0 bash "$POOL" validate
# a copy that stopped part way: the folder is there but its copy was never marked finished
mkdir -p "$T/w/Library/deep" && echo more >"$T/w/Library/deep/d.bin"
rm -f "$T/w.pool/pool.warm.json"
rm -f "$T/w.pool/slot-1/Library/c.bin"
check "a folder with no finished copy on record is a look" 3 bash "$POOL" validate
has "it says the copy may have stopped" "may have stopped part way"
check "resume carries it on" 0 bash "$POOL" repair slot-1 warm
[ -f "$T/w.pool/slot-1/Library/c.bin" ] && [ -f "$T/w.pool/slot-1/Library/deep/d.bin" ] && ok "the missing files are copied" || bad "the missing files are copied"
check "and it validates ok" 0 bash "$POOL" validate
echo mine >"$T/w.pool/slot-1/Library/c.bin"
check "a repair that is not needed is refused" 1 bash "$POOL" repair slot-1 warm
rm -rf "$T/w.pool/slot-1/Library"
rm -f "$T/w.pool/pool.warm.json"
check "a missing folder is copied whole again" 0 bash "$POOL" repair slot-1 warm
check "and then is marked finished" 0 bash "$POOL" validate

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
