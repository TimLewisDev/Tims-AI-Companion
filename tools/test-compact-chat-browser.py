#!/usr/bin/env python3
"""Run the compact page or workflow-tab browser check against an isolated server."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "plugins" / "tatty" / "app" / "server.py"
PAGE_CHECK = ROOT / "tools" / "page-check.py"
FEATURES_CHECK = ROOT / "tools" / "features-check.py"


def browser_executable():
    override = os.environ.get("TATTY_BROWSER")
    if override:
        found = shutil.which(override)
        if found:
            return found
        if Path(override).expanduser().is_file():
            return str(Path(override).expanduser())
        raise RuntimeError(f"TATTY_BROWSER does not name an available browser executable: {override}")

    for name in ("msedge", "microsoft-edge", "google-chrome", "google-chrome-stable", "chrome",
                 "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found

    windows_paths = []
    for variable in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"):
        base = os.environ.get(variable)
        if base:
            root = Path(base)
            windows_paths.extend((
                root / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                root / "Google" / "Chrome" / "Application" / "chrome.exe",
            ))
    for path in windows_paths:
        if path.is_file():
            return str(path)

    mac_paths = (
        Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    )
    for path in mac_paths:
        if path.is_file():
            return str(path)

    raise RuntimeError(
        "No Edge or Chrome executable was found. Install Edge or Chrome, or set TATTY_BROWSER "
        "to its executable path."
    )


def isolated_environment(root, project):
    paths = {
        "TATTY_HOME": root / "tatty-home",
        "CLAUDE_CONFIG_DIR": root / "claude-config",
        "TT_EVENTS_HOME": root / "events",
        "TT_WORKFLOW_HOME": root / "workflow",
        "TT_CONFIG_DIR": root / "toolbox-config",
        "TT_PLUGINS_HOME": root / "toolbox-plugins",
        "LOCALAPPDATA": root / "localappdata",
    }
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env.update({key: str(path) for key, path in paths.items()})
    env.update({
        "TATTY_ROOT": str(project),
        "TATTY_CLAUDE": str(root / "no-claude-command"),
        "TATTY_MODES": "engineering,design",
        "TATTY_NO_LAUNCH_UPDATE": "1",
        "TATTY_UPDATE_FIRST": "100000",
        "PYTHONDONTWRITEBYTECODE": "1",
    })
    return env


def runtime_info(path, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            info = json.loads(path.read_text(encoding="utf-8"))
            if info.get("port") and info.get("token"):
                return info
        except (OSError, ValueError):
            pass
        time.sleep(0.1)
    raise RuntimeError(f"Tatty did not write runtime metadata at {path}")


def stop_server(env, process):
    command = [sys.executable, str(SERVER), "stop"]
    failed = False
    try:
        result = subprocess.run(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        if result.returncode:
            print(f"Could not request the test server to stop (exit {result.returncode})", file=sys.stderr)
            failed = True
    except (OSError, subprocess.TimeoutExpired) as error:
        print(f"Could not request the test server to stop: {error}", file=sys.stderr)
        failed = True

    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            process.terminate()
            process.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired) as error:
            print(f"Could not stop the test server process: {error}", file=sys.stderr)
        else:
            print("The test server did not stop after the shutdown request; terminated its process.",
                  file=sys.stderr)
        failed = True
    return not failed


def run(mode):
    if mode not in ("page", "features"):
        print("Usage: python tools/test-compact-chat-browser.py <page|features>", file=sys.stderr)
        return 2
    try:
        browser = browser_executable()
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 2

    temporary = tempfile.TemporaryDirectory(prefix="tatty-compact-browser-")
    server_process = None
    env = None
    result_code = 2
    cleanup_failed = False
    try:
        root = Path(temporary.name)
        project = root / "project"
        (project / "features").mkdir(parents=True)
        env = isolated_environment(root, project)
        server_process = subprocess.Popen(
            [sys.executable, str(SERVER), "serve", "--cwd", str(project)],
            cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        info_path = Path(env["TATTY_HOME"]) / "server.json"
        info = runtime_info(info_path)
        url = f"http://127.0.0.1:{info['port']}/?mode=companion#token={quote(info['token'], safe='')}"
        if mode == "page":
            check = [sys.executable, str(PAGE_CHECK), browser, url]
        else:
            check = [sys.executable, str(FEATURES_CHECK), browser, url, "--tabs"]
        result_code = subprocess.run(check, cwd=ROOT, env=env).returncode
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(error, file=sys.stderr)
    finally:
        if server_process is not None:
            try:
                cleanup_failed = not stop_server(env, server_process)
            except Exception as error:
                print(f"Could not stop the test server process: {error}", file=sys.stderr)
                cleanup_failed = True
        try:
            temporary.cleanup()
        except OSError as error:
            print(f"Could not remove temporary browser-test files: {error}", file=sys.stderr)
            cleanup_failed = True

    if result_code == 0 and cleanup_failed:
        return 2
    return result_code


if __name__ == "__main__":
    sys.exit(run(sys.argv[1] if len(sys.argv) == 2 else ""))
