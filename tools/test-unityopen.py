#!/usr/bin/env python3
"""test-unityopen.py: unityopen.py on throwaway folders (no Unity needed). Run: python -I tools/test-unityopen.py"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "plugins" / "tatty" / "app"))
import unityopen as u  # noqa: E402

fails = 0


def check(name, cond):
    global fails
    print(("ok    " if cond else "FAIL  ") + name)
    fails += not cond


def project(root, version="2022.3.10f1"):
    (root / "ProjectSettings").mkdir(parents=True)
    (root / "ProjectSettings" / "ProjectVersion.txt").write_text(f"m_EditorVersion: {version}\nm_EditorVersionWithRevision: {version} (abc)\n")
    return root


with tempfile.TemporaryDirectory() as t:
    t = Path(t)
    slot = t / "slot-1"
    check("no project in an empty slot", u.find_project(slot) is None and u.status(slot)["state"] == "none")
    (slot / "Game").mkdir(parents=True)
    p = project(slot / "Game")
    check("finds a project a level down", u.find_project(slot) == p)
    check("reads the Editor version", u.editor_version(p) == "2022.3.10f1")
    check("closed with no lock file", u.open_state(p) == "closed")
    (p / "Temp").mkdir()
    lock = p / "Temp" / "UnityLockfile"
    lock.write_bytes(b"")
    check("a lock nothing holds is stale", u.open_state(p) == "stale")
    if os.name == "nt":  # hold it the way Unity does: opened with no sharing, so nothing else can open it
        import ctypes
        k = ctypes.windll.kernel32
        k.CreateFileW.restype = ctypes.c_void_p
        h = k.CreateFileW(str(lock), 0xC0000000, 0, None, 3, 0x80, None)  # read+write, share none, OPEN_EXISTING
        check("a lock an Editor holds exclusively is open", u.open_state(p) == "open")
        k.CloseHandle(ctypes.c_void_p(h))
        check("and stale again once released", u.open_state(p) == "stale")
    editors = t / "Editors"
    exe = editors / "2022.3.10f1" / "Editor" / "Unity.exe"
    check("no Editor installed says where it looked", "isn't installed" in u.find_editor("2022.3.10f1", str(editors))[1] and str(editors) in u.find_editor("2022.3.10f1", str(editors))[1])
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"")
    check("finds the Editor by version", u.find_editor("2022.3.10f1", str(editors)) == (str(exe), ""))
    check("an empty version is refused", u.find_editor("", str(editors))[0] == "")

    started = []
    try:
        u.open_project(slot, str(editors), start=lambda e, pr: started.append((e, pr)))
        check("a stale lock is refused without force", False)
    except u.UnityError as e:
        check("a stale lock is refused without force", "lock file" in str(e) and not started)
    got = u.open_project(slot, str(editors), force=True, start=lambda e, pr: started.append((e, pr)))
    check("force starts the Editor on the project", started == [(str(exe), p)] and got["opened"] and got["version"] == "2022.3.10f1")
    lock.unlink()
    started.clear()
    u.open_project(slot, str(editors), start=lambda e, pr: started.append((e, pr)))
    check("a closed project starts", len(started) == 1)
    try:
        u.open_project(t / "nothing", str(editors))
        check("no project is refused", False)
    except u.UnityError as e:
        check("no project is refused", "no Unity project" in str(e))

print(f"\n{fails} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
