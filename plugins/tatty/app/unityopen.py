#!/usr/bin/env python3
"""unityopen.py: open a worktree's Unity project in a new Editor.

Nothing here knows the worktree pool: it takes a folder, finds the Unity project inside it, finds the Editor that
project was saved with, says whether an Editor already has it open, and starts one. Unity allows one Editor per
project folder, and every pool slot is a folder of its own, so one Editor per slot can run side by side.
"""
import json
import os
import re
import subprocess
from pathlib import Path

SKIP = {".git", "Library", "Temp", "obj", "Logs", "node_modules", "Packages", "Assets"}
VERSION_LINE = re.compile(r"^m_EditorVersion:\s*(\S+)", re.M)
DEPTH = 2  # how many folders below the slot the project may sit


class UnityError(Exception):
    pass


def find_project(root, depth=DEPTH):
    """The Unity project folder in `root` (or a folder a level or two below it), else None."""
    root = Path(root)
    stack = [(root, 0)]
    while stack:
        here, d = stack.pop(0)
        if (here / "ProjectSettings" / "ProjectVersion.txt").is_file():
            return here
        if d >= depth:
            continue
        try:
            kids = sorted(e for e in here.iterdir() if e.is_dir() and e.name not in SKIP and not e.name.startswith("."))
        except OSError:
            continue
        stack.extend((k, d + 1) for k in kids)
    return None


def editor_version(project):
    """The Editor version a project was last saved with ("2022.3.10f1"), or ""."""
    try:
        text = (Path(project) / "ProjectSettings" / "ProjectVersion.txt").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    m = VERSION_LINE.search(text)
    return m.group(1) if m else ""


def editor_roots(configured=""):
    """The folders the Hub installs Editors into, most specific first: the setting, UNITY_EDITORS_ROOT, the Hub's own
    secondary install path, then the default."""
    roots = [configured, os.environ.get("UNITY_EDITORS_ROOT", "")]
    appdata = os.environ.get("APPDATA", "")
    if appdata:
        try:
            second = json.loads((Path(appdata) / "UnityHub" / "secondaryInstallPath.json").read_text(encoding="utf-8-sig"))
            roots.append(second if isinstance(second, str) else "")
        except (OSError, ValueError):
            pass
    roots += [r"C:\Program Files\Unity\Hub\Editor", "/Applications/Unity/Hub/Editor", str(Path.home() / "Unity" / "Hub" / "Editor")]
    seen, out = set(), []
    for r in roots:
        if r and r.lower() not in seen:
            seen.add(r.lower())
            out.append(r)
    return out


def find_editor(version, configured=""):
    """The Editor program for `version`: (path, "") or ("", why)."""
    if not version:
        return "", "this project doesn't say which Unity version it uses (ProjectSettings/ProjectVersion.txt)"
    tried = []
    for root in editor_roots(configured):
        for tail in (("Editor", "Unity.exe"), ("Unity.app", "Contents", "MacOS", "Unity"), ("Editor", "Unity")):
            exe = Path(root, version, *tail)
            if exe.is_file():
                return str(exe), ""
        tried.append(root)
    return "", f"Unity {version} isn't installed where Tatty looked ({'; '.join(tried)}). Install it from the Unity Hub, or set UNITY_EDITORS_ROOT to the folder that holds it."


def open_state(project):
    """"open" when an Editor has the project open, "stale" when a lock file is left but nothing holds it, else "closed".
    Unity keeps Temp/UnityLockfile open for as long as the Editor runs; on Windows that stops anything else opening it."""
    lock = Path(project) / "Temp" / "UnityLockfile"
    if not lock.exists():
        return "closed"
    try:
        with open(lock, "r+b"):
            pass
    except PermissionError:
        return "open"
    except OSError:
        return "open" if os.name == "nt" else "stale"
    return "stale"  # opened freely: the Editor that made it is gone (on other systems an unheld file reads the same)


def launch(exe, project):
    """Start an Editor on `project`, on its own: it outlives Tatty and has no console of its own."""
    argv = [exe, "-projectPath", str(project)]
    kw = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "close_fds": True}
    try:
        if os.name == "nt":
            flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            try:
                subprocess.Popen(argv, creationflags=flags | subprocess.CREATE_BREAKAWAY_FROM_JOB, **kw)
            except OSError:
                subprocess.Popen(argv, creationflags=flags, **kw)
        else:
            subprocess.Popen(argv, start_new_session=True, **kw)
    except OSError as e:
        raise UnityError(f"Unity couldn't be started: {e}")


def status(slot_path):
    """What the page shows for a slot: {"project": folder or "", "state": open|stale|closed|none}."""
    project = find_project(slot_path)
    if not project:
        return {"project": "", "state": "none"}
    return {"project": project.as_posix(), "state": open_state(project)}


def open_project(slot_path, configured="", force=False, start=launch):
    """Open the slot's Unity project in a new Editor. Returns {"opened": True, "project", "version"}; raises UnityError
    when it can't (no project, no Editor installed, already open; a stale lock needs force)."""
    project = find_project(slot_path)
    if not project:
        raise UnityError("There is no Unity project in this slot.")
    state = open_state(project)
    if state == "open":
        raise UnityError("An Editor already has this project open.")
    if state == "stale" and not force:
        raise UnityError("A lock file from an Editor that is no longer running is left in this project.")
    version = editor_version(project)
    exe, why = find_editor(version, configured)
    if not exe:
        raise UnityError(why)
    start(exe, project)
    return {"opened": True, "project": project.as_posix(), "version": version}
