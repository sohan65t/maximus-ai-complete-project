#!/usr/bin/env python3
"""
Maximus Desktop Agent
======================
A small local HTTP server that runs on YOUR computer and gives the Maximus
web app (app.js) permission to do real desktop things a browser page can
never do by itself: open applications, open File Explorer / Finder, open
Task Manager / Activity Monitor, open system settings, report battery
percentage, jump to the desktop, and create/name files on the Desktop.

WHY THIS EXISTS
---------------
Browsers deliberately sandbox web pages away from the operating system —
a website cannot launch programs, read your battery, or write files
outside its own tiny storage box. That's a security feature, not a bug.
The only way to let a web UI trigger real desktop actions is to pair it
with a small program that runs directly on your machine and does the
actual work. That's what this script is. It only ever listens on
127.0.0.1 (this computer only) — nothing outside your machine can reach it.

HOW TO RUN IT
-------------
1. Install Python 3.9+ if you don't have it: https://python.org
2. Install the two dependencies:
       pip install flask flask-cors psutil
3. Run this file:
       python maximus_agent.py
4. Leave the terminal window open. Open/refresh the Maximus web app in your
   browser — it will now be able to reach this agent on
   http://127.0.0.1:5055 and desktop commands will start working.

SUPPORTED VOICE COMMANDS (in the Maximus app)
----------------------------------------------
  "battery percentage"                         -> GET  /battery
  "go to desktop" / "show desktop"             -> POST /show-desktop
  "open file explorer"                         -> POST /open-explorer
  "open task manager"                          -> POST /open-task-manager
  "open computer settings"                     -> POST /open-settings
  "open vscode"                                -> POST /open-app {name: vscode}
  "open notepad" / "open chrome" / "open <x>"  -> POST /open-app {name: x}
  "create a file on desktop named notes.txt"   -> POST /create-file
  "restart the computer"                       -> POST /power {action: restart}
  "shut down the computer"                     -> POST /power {action: shutdown}
  "sleep mode" / "go to sleep"                 -> POST /power {action: sleep}

SECURITY NOTES
--------------
- Only binds to 127.0.0.1 — not reachable from other devices on your network.
- "open-app" only launches applications from the built-in whitelist below
  (or anything already on your system PATH whose name you speak/type) — it
  never runs an arbitrary shell string sent from the browser.
- "create-file" only ever writes inside your Desktop folder and only accepts
  a plain filename (no "..", no path separators), so it can't be used to
  overwrite arbitrary files elsewhere on disk.
"""

import os
import re
import time
import string
import threading
import platform
import subprocess
import shutil
import ctypes
from pathlib import Path

from flask import Flask, request, jsonify
from flask_cors import CORS

try:
    import psutil
except ImportError:
    psutil = None

try:
    import screen_brightness_control as sbc
except ImportError:
    sbc = None

try:
    from ctypes import POINTER, cast
    import comtypes
    from comtypes import CLSCTX_ALL
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
    PYCAW_AVAILABLE = True
except ImportError:
    PYCAW_AVAILABLE = False

app = Flask(__name__)
# Local-only tool — any page running in your own browser on this machine may
# call it. Nothing outside this computer can reach 127.0.0.1 anyway.
CORS(app)

SYSTEM = platform.system()  # 'Windows', 'Darwin' (macOS), or 'Linux'

# ---------------------------------------------------------------------------
# Application whitelist — maps a spoken/typed name to how to launch it on
# each OS. Add your own favorite apps here freely. Anything NOT in this list
# is still supported as a fallback via shutil.which() (i.e. only if it's
# already a recognized command on your system PATH) — never via a raw shell
# string built from user text.
# ---------------------------------------------------------------------------
APP_MAP = {
    "vscode": {
        "Windows": ["code"],
        "Darwin": ["open", "-a", "Visual Studio Code"],
        "Linux": ["code"],
    },
    "visual studio code": {"alias": "vscode"},
    "vs code": {"alias": "vscode"},
    "notepad": {
        "Windows": ["notepad.exe"],
        "Darwin": ["open", "-a", "TextEdit"],
        "Linux": ["gedit"],
    },
    "calculator": {
        "Windows": ["calc.exe"],
        "Darwin": ["open", "-a", "Calculator"],
        "Linux": ["gnome-calculator"],
    },
    "chrome": {
        "Windows": ["cmd", "/c", "start", "chrome"],
        "Darwin": ["open", "-a", "Google Chrome"],
        "Linux": ["google-chrome"],
    },
    "word": {
        "Windows": ["cmd", "/c", "start", "winword"],
        "Darwin": ["open", "-a", "Microsoft Word"],
        "Linux": ["libreoffice", "--writer"],
    },
    "excel": {
        "Windows": ["cmd", "/c", "start", "excel"],
        "Darwin": ["open", "-a", "Microsoft Excel"],
        "Linux": ["libreoffice", "--calc"],
    },
    "powerpoint": {
        "Windows": ["cmd", "/c", "start", "powerpnt"],
        "Darwin": ["open", "-a", "Microsoft PowerPoint"],
        "Linux": ["libreoffice", "--impress"],
    },
    "power point": {"alias": "powerpoint"},
    "spotify": {
        "Windows": ["cmd", "/c", "start", "spotify"],
        "Darwin": ["open", "-a", "Spotify"],
        "Linux": ["spotify"],
    },
    "discord": {
        "Windows": ["cmd", "/c", "start", "discord"],
        "Darwin": ["open", "-a", "Discord"],
        "Linux": ["discord"],
    },
    "terminal": {
        "Windows": ["cmd", "/c", "start", "cmd"],
        "Darwin": ["open", "-a", "Terminal"],
        "Linux": ["x-terminal-emulator"],
    },
    "paint": {
        "Windows": ["mspaint.exe"],
        "Darwin": ["open", "-a", "Preview"],
        "Linux": ["gimp"],
    },
    "steam": {
        # Steam registers an App Paths entry, so "start steam.exe" resolves
        # without needing its full install path.
        "Windows": ["cmd", "/c", "start", "", "steam.exe"],
        "Darwin": ["open", "-a", "Steam"],
        "Linux": ["steam"],
    },
    "epic games": {
        "Windows": ["cmd", "/c", "start", "", "com.epicgames.launcher://"],
        "Darwin": ["open", "-a", "Epic Games Launcher"],
        "Linux": ["legendary"],
    },
    "epic games launcher": {"alias": "epic games"},
    "epic": {"alias": "epic games"},
    "obs studio": {
        "Windows": ["cmd", "/c", "start", "", "obs64.exe"],
        "Darwin": ["open", "-a", "OBS"],
        "Linux": ["obs"],
    },
    "obs": {"alias": "obs studio"},
    "free download manager": {
        "Windows": ["cmd", "/c", "start", "", "fdm.exe"],
        "Darwin": ["open", "-a", "Free Download Manager"],
        "Linux": ["fdm"],
    },
    "fdm": {"alias": "free download manager"},
    "download manager": {"alias": "free download manager"},
    "recycle bin": {
        "Windows": ["explorer.exe", "shell:RecycleBinFolder"],
        "Darwin": ["open", os.path.expanduser("~/.Trash")],
        "Linux": ["xdg-open", os.path.expanduser("~/.local/share/Trash/files")],
    },
    "bin": {"alias": "recycle bin"},
    "trash": {"alias": "recycle bin"},
    "photos": {
        "Windows": ["cmd", "/c", "start", "", "ms-photos:"],
        "Darwin": ["open", "-a", "Photos"],
        "Linux": ["eog"],
    },
    "photo": {"alias": "photos"},
    "microsoft store": {
        "Windows": ["cmd", "/c", "start", "", "ms-windows-store:"],
    },
    "store": {"alias": "microsoft store"},
    "windows store": {"alias": "microsoft store"},

    # ---- Browsers ----
    "edge": {
        "Windows": ["cmd", "/c", "start", "msedge"],
        "Darwin": ["open", "-a", "Microsoft Edge"],
        "Linux": ["microsoft-edge"],
    },
    "microsoft edge": {"alias": "edge"},
    "firefox": {
        "Windows": ["cmd", "/c", "start", "firefox"],
        "Darwin": ["open", "-a", "Firefox"],
        "Linux": ["firefox"],
    },
    "brave": {
        "Windows": ["cmd", "/c", "start", "brave"],
        "Darwin": ["open", "-a", "Brave Browser"],
        "Linux": ["brave-browser"],
    },
    "opera": {
        "Windows": ["cmd", "/c", "start", "opera"],
        "Darwin": ["open", "-a", "Opera"],
        "Linux": ["opera"],
    },

    # ---- Dev / shell tools ----
    "visual studio": {
        "Windows": ["cmd", "/c", "start", "devenv"],
        "Darwin": ["open", "-a", "Visual Studio"],
    },
    "command prompt": {
        "Windows": ["cmd", "/c", "start", "cmd"],
    },
    "cmd": {"alias": "command prompt"},
    "powershell": {
        "Windows": ["cmd", "/c", "start", "powershell"],
        "Darwin": ["open", "-a", "Terminal"],
        "Linux": ["x-terminal-emulator", "-e", "pwsh"],
    },

    # ---- Communication apps ----
    "whatsapp desktop": {
        "Windows": ["cmd", "/c", "start", "", "whatsapp:"],
        "Darwin": ["open", "-a", "WhatsApp"],
    },
    "telegram desktop": {
        "Windows": ["cmd", "/c", "start", "", "tg://"],
        "Darwin": ["open", "-a", "Telegram"],
        "Linux": ["telegram-desktop"],
    },
    "zoom": {
        "Windows": ["cmd", "/c", "start", "", "zoommtg://"],
        "Darwin": ["open", "-a", "zoom.us"],
        "Linux": ["zoom"],
    },
    "microsoft teams": {
        "Windows": ["cmd", "/c", "start", "", "msteams:"],
        "Darwin": ["open", "-a", "Microsoft Teams"],
        "Linux": ["teams"],
    },
    "teams": {"alias": "microsoft teams"},

    # ---- Media / creative apps ----
    "vlc": {
        "Windows": ["cmd", "/c", "start", "vlc"],
        "Darwin": ["open", "-a", "VLC"],
        "Linux": ["vlc"],
    },
    "photoshop": {
        "Windows": ["cmd", "/c", "start", "photoshop"],
        "Darwin": ["open", "-a", "Adobe Photoshop 2024"],
    },
    "illustrator": {
        "Windows": ["cmd", "/c", "start", "illustrator"],
        "Darwin": ["open", "-a", "Adobe Illustrator 2024"],
    },
    "premiere pro": {
        "Windows": ["cmd", "/c", "start", "premiere"],
        "Darwin": ["open", "-a", "Adobe Premiere Pro 2024"],
    },
    "premiere": {"alias": "premiere pro"},
    "after effects": {
        "Windows": ["cmd", "/c", "start", "afterfx"],
        "Darwin": ["open", "-a", "Adobe After Effects 2024"],
    },
    "blender": {
        "Windows": ["cmd", "/c", "start", "blender"],
        "Darwin": ["open", "-a", "Blender"],
        "Linux": ["blender"],
    },
    "davinci resolve": {
        "Windows": ["cmd", "/c", "start", "", "Resolve"],
        "Darwin": ["open", "-a", "DaVinci Resolve"],
        "Linux": ["resolve"],
    },
    "resolve": {"alias": "davinci resolve"},
    "media player": {
        "Windows": ["wmplayer.exe"],
        "Darwin": ["open", "-a", "QuickTime Player"],
        "Linux": ["vlc"],
    },
    "windows media player": {"alias": "media player"},
    "camera": {
        "Windows": ["cmd", "/c", "start", "", "microsoft.windows.camera:"],
        "Darwin": ["open", "-a", "Photo Booth"],
    },

    # ---- Windows administrative tools ----
    "control panel": {
        "Windows": ["control.exe"],
    },
    "device manager": {
        "Windows": ["cmd", "/c", "start", "devmgmt.msc"],
    },
    "registry editor": {
        "Windows": ["regedit.exe"],
    },
    "regedit": {"alias": "registry editor"},
    "disk management": {
        "Windows": ["cmd", "/c", "start", "diskmgmt.msc"],
    },
    "event viewer": {
        "Windows": ["cmd", "/c", "start", "eventvwr.msc"],
    },
    "services": {
        "Windows": ["cmd", "/c", "start", "services.msc"],
    },
    "task scheduler": {
        "Windows": ["cmd", "/c", "start", "taskschd.msc"],
    },
    "resource monitor": {
        "Windows": ["resmon.exe"],
    },
    "performance monitor": {
        "Windows": ["cmd", "/c", "start", "perfmon.msc"],
    },
    "perfmon": {"alias": "performance monitor"},
    "snipping tool": {
        "Windows": ["cmd", "/c", "start", "", "ms-screenclip:"],
        "Darwin": ["open", "-a", "Screenshot"],
    },
    "character map": {
        "Windows": ["charmap.exe"],
    },
}

# Extra exe-name fragments to search for under Program Files / LOCALAPPDATA
# on Windows, for apps that don't reliably register a Start-menu "App Paths"
# shortcut (so `start steam.exe` alone can't find them). Used only as a
# last-resort fallback, after the whitelist command and PATH lookup both fail.
SEARCH_HINTS = {
    "steam": ["steam.exe"],
    "epic games": ["epicgameslauncher.exe"],
    "obs studio": ["obs64.exe", "obs32.exe"],
    "free download manager": ["fdm.exe"],
}

# Fixed, well-known install locations for apps that commonly DON'T register a
# Start-menu "App Paths" shortcut (so `cmd /c start steam.exe` alone can't
# find them), checked directly before falling back to the slower folder
# search below. If your install lives somewhere else, either add it here or
# edit APP_MAP to point straight at your .exe.
KNOWN_PATH_HINTS = {
    "steam": [
        r"C:\Program Files (x86)\Steam\steam.exe",
        r"C:\Program Files\Steam\steam.exe",
    ],
    "obs studio": [
        r"C:\Program Files\obs-studio\bin\64bit\obs64.exe",
        r"C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe",
        r"C:\Program Files\obs-studio\bin\32bit\obs32.exe",
    ],
    "epic games": [
        r"C:\Program Files (x86)\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe",
        r"C:\Program Files (x86)\Epic Games\Launcher\Portal\Binaries\Win32\EpicGamesLauncher.exe",
    ],
    "free download manager": [
        r"C:\Program Files (x86)\Softdeluxe\Free Download Manager\fdm.exe",
        r"C:\Program Files\Softdeluxe\Free Download Manager\fdm.exe",
    ],
}


def known_path_search(name: str):
    """Check the fixed KNOWN_PATH_HINTS locations directly — much faster and
    more reliable than a folder walk when the app is installed in its
    default location, which is by far the most common case."""
    for candidate in KNOWN_PATH_HINTS.get(name, []):
        if os.path.isfile(candidate):
            return candidate
    return None


def steam_path_from_registry():
    """Steam (when it has been run at least once) records its own install
    location in the registry — the most reliable way to find it if it isn't
    in the default folder. Returns None on any failure, including on
    non-Windows systems or if Steam has never been launched."""
    if SYSTEM != "Windows":
        return None
    try:
        import winreg
        lookups = [
            (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamExe"),
            (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath"),
        ]
        for hive, subkey, value_name in lookups:
            try:
                with winreg.OpenKey(hive, subkey) as key:
                    val, _ = winreg.QueryValueEx(key, value_name)
            except (FileNotFoundError, OSError):
                continue
            if value_name == "SteamExe":
                if os.path.isfile(val):
                    return val
                continue
            exe = os.path.join(val, "steam.exe")
            if os.path.isfile(exe):
                return exe
    except Exception:
        pass
    return None


def windows_common_dirs_search(exe_fragments, max_dirs_scanned=15000):
    """Best-effort search of the usual install locations for a matching .exe.
    Bounded so a huge disk can't make this hang forever. Checks every drive
    letter that exists (not just the system drive), since games and apps
    like Steam/Epic are very often installed to D:\\, E:\\, etc."""
    roots = []
    for env in ("ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"):
        p = os.environ.get(env)
        if p and p not in roots:
            roots.append(p)
    local = os.environ.get("LOCALAPPDATA")
    if local:
        roots.append(os.path.join(local, "Programs"))

    for letter in string.ascii_uppercase:
        drive = f"{letter}:\\"
        if not os.path.isdir(drive):
            continue
        for sub in ("Program Files", "Program Files (x86)", "Games", "SteamLibrary", "SteamLibrary\\steamapps\\common"):
            p = os.path.join(drive, sub)
            if os.path.isdir(p) and p not in roots:
                roots.append(p)

    fragments = [f.lower() for f in exe_fragments]
    scanned = 0
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            scanned += 1
            if scanned > max_dirs_scanned:
                return None
            for f in filenames:
                if f.lower() in fragments:
                    return os.path.join(dirpath, f)
    return None


def resolve_alias(name: str) -> str:
    entry = APP_MAP.get(name)
    if isinstance(entry, dict) and "alias" in entry:
        return entry["alias"]
    return name


def desktop_path() -> Path:
    home = Path.home()
    candidates = [home / "Desktop", home / "OneDrive" / "Desktop"]
    for c in candidates:
        if c.exists():
            return c
    # Fall back to creating the standard one
    d = home / "Desktop"
    d.mkdir(parents=True, exist_ok=True)
    return d


def screenshots_dir() -> Path:
    home = Path.home()
    candidates = [
        home / "Pictures" / "Screenshots",
        home / "OneDrive" / "Pictures" / "Screenshots",
        home / "Pictures",  # macOS default screenshot location
    ]
    for c in candidates:
        if c.exists():
            return c
    d = home / "Pictures" / "Screenshots"
    d.mkdir(parents=True, exist_ok=True)
    return d


def take_screenshot(save_path: Path) -> bool:
    """Capture the whole screen to save_path. Returns True on success."""
    if SYSTEM == "Windows":
        from PIL import ImageGrab
        img = ImageGrab.grab()
        img.save(str(save_path))
        return True
    elif SYSTEM == "Darwin":
        subprocess.run(["screencapture", "-x", str(save_path)], check=True)
        return True
    else:
        for tool, cmd in (
            ("gnome-screenshot", ["gnome-screenshot", "-f", str(save_path)]),
            ("scrot", ["scrot", str(save_path)]),
            ("import", ["import", "-window", "root", str(save_path)]),
        ):
            if shutil.which(tool):
                subprocess.run(cmd, check=True)
                return True
        return False


def safe_filename(name: str) -> str:
    """Strip anything that could escape the Desktop folder, and default to .txt
    if the person gave a bare name with no extension of their own."""
    name = name.strip().replace("/", "").replace("\\", "").replace("..", "")
    name = re.sub(r'[<>:"|?*]', "", name)
    if not name:
        name = "new_file.txt"
    if "." not in name:
        name += ".txt"
    return name


def safe_component(name: str) -> str:
    """Same escape-stripping as safe_filename, but for folder names — never
    forces a .txt extension onto a folder."""
    name = name.strip().replace("/", "").replace("\\", "").replace("..", "")
    name = re.sub(r'[<>:"|?*]', "", name)
    if not name:
        name = "New Folder"
    return name


DETACHED_PROCESS = 0x00000008  # Windows-only flag so the launched app isn't tied to this console


def allow_foreground():
    """
    Windows blocks background processes (like this agent, which has no
    recent keyboard/mouse input of its own) from stealing focus — newly
    launched apps can otherwise open silently behind everything else,
    only flashing in the taskbar. ASFW_ANY (-1) tells Windows "let the
    next app that asks bring itself to the front", which is what actually
    makes windows pop up on screen instead of requiring a manual click.
    No-op on macOS/Linux.
    """
    if SYSTEM == "Windows":
        try:
            ctypes.windll.user32.AllowSetForegroundWindow(-1)  # ASFW_ANY
        except Exception:
            pass


def run_detached(cmd):
    """Launch a program without blocking this server or its console."""
    allow_foreground()
    kwargs = {}
    if SYSTEM == "Windows":
        kwargs["creationflags"] = DETACHED_PROCESS
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs)


def start_file(path_or_protocol):
    """Windows os.startfile wrapper that also requests foreground permission first."""
    allow_foreground()
    os.startfile(path_or_protocol)  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Force-to-foreground support.
#
# AllowSetForegroundWindow(-1) alone isn't enough for things like File
# Explorer, Settings, the Recycle Bin, or the Microsoft Store: those either
# reuse an already-running host process (explorer.exe) or are UWP apps
# (ApplicationFrameHost.exe) that don't reliably call SetForegroundWindow
# themselves in time, so the new window opens *behind* everything else until
# you click the taskbar. The fix is a well-known Windows trick: briefly
# "attach" our input thread to the currently-foreground window's thread,
# which temporarily lifts the OS's foreground-stealing lock, then force our
# target window to the front and detach again.
# ---------------------------------------------------------------------------

def _enum_top_windows():
    """Return [(hwnd, pid, title), ...] for all currently visible top-level
    windows. Windows-only; returns [] elsewhere."""
    if SYSTEM != "Windows":
        return []
    user32 = ctypes.windll.user32
    results = []
    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def _cb(hwnd, _lparam):
        if user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            pid = ctypes.c_ulong()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            results.append((hwnd, pid.value, buff.value))
        return True

    user32.EnumWindows(WNDENUMPROC(_cb), 0)
    return results


def _snapshot_hwnds():
    """Windows handles that already exist right before we launch something,
    so we can tell which window is the newly-opened one afterwards."""
    return {hwnd for hwnd, _pid, _title in _enum_top_windows()}


def _pid_process_name(pid):
    if psutil is None:
        return ""
    try:
        return psutil.Process(pid).name().lower()
    except Exception:
        return ""


def _force_foreground(hwnd):
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    SW_RESTORE = 9
    user32.ShowWindow(hwnd, SW_RESTORE)
    fg_hwnd = user32.GetForegroundWindow()
    cur_thread = kernel32.GetCurrentThreadId()
    fg_thread = user32.GetWindowThreadProcessId(fg_hwnd, None)
    target_thread = user32.GetWindowThreadProcessId(hwnd, None)
    try:
        user32.AttachThreadInput(cur_thread, fg_thread, True)
        user32.AttachThreadInput(cur_thread, target_thread, True)
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
    finally:
        user32.AttachThreadInput(cur_thread, fg_thread, False)
        user32.AttachThreadInput(cur_thread, target_thread, False)


def _focus_new_window(before_hwnds, process_names=None, title_contains=None, timeout=5.0, poll=0.15):
    """Poll for a newly-appeared visible window matching process_names
    and/or title_contains (case-insensitive substring), then force it to the
    foreground. If no hints are given, grabs the first brand-new window that
    appears. Best-effort — silently gives up after `timeout` seconds."""
    if SYSTEM != "Windows":
        return
    process_names = [p.lower() for p in (process_names or [])]
    title_needle = (title_contains or "").lower()
    deadline = time.time() + timeout
    while time.time() < deadline:
        for hwnd, pid, title in _enum_top_windows():
            if hwnd in before_hwnds or not title:
                continue
            matched = False
            if title_needle and title_needle in title.lower():
                matched = True
            if not matched and process_names and _pid_process_name(pid) in process_names:
                matched = True
            if not matched and not process_names and not title_needle:
                matched = True  # no hints given — accept the first new window
            if matched:
                try:
                    _force_foreground(hwnd)
                except Exception:
                    pass
                return
        time.sleep(poll)


def focus_async(before_hwnds, process_names=None, title_contains=None, timeout=5.0):
    """Fire-and-forget: runs the polling/foreground-forcing on a background
    thread so the HTTP response to the browser doesn't have to wait on it."""
    if SYSTEM != "Windows":
        return
    threading.Thread(
        target=_focus_new_window,
        args=(before_hwnds, process_names, title_contains, timeout),
        daemon=True,
    ).start()


# ---------------------------------------------------------------------------
# Closing applications.
#
# We send WM_CLOSE to matching windows — exactly what happens when you click
# a window's own X button — rather than force-killing the process. That way
# apps like Word/Excel/PowerPoint still get to show their own "save changes?"
# prompt instead of silently losing your work. Force-killing via psutil is
# only used as a fallback for apps with no visible window (e.g. something
# sitting in the system tray).
# ---------------------------------------------------------------------------

WM_CLOSE = 0x0010


def _close_matching_windows(process_names=None, title_contains=None, exclude_titles=None):
    """Send WM_CLOSE to every visible window that matches. Returns how many
    windows it signalled. Windows-only; no-op elsewhere."""
    if SYSTEM != "Windows":
        return 0
    user32 = ctypes.windll.user32
    process_names = [p.lower() for p in (process_names or [])]
    title_needle = (title_contains or "").lower()
    exclude_titles = [t.lower() for t in (exclude_titles or ["program manager"])]
    count = 0
    for hwnd, pid, title in _enum_top_windows():
        if not title or title.lower() in exclude_titles:
            continue
        matched = False
        if title_needle and title_needle in title.lower():
            matched = True
        if not matched and process_names and _pid_process_name(pid) in process_names:
            matched = True
        if matched:
            user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
            count += 1
    return count


def _kill_processes(process_names):
    """Force-terminate any still-running processes with these names — used
    only as a fallback when there was no visible window to close politely."""
    if psutil is None or not process_names:
        return 0
    wanted = [p.lower() for p in process_names]
    killed = 0
    for proc in psutil.process_iter(["name"]):
        try:
            if (proc.info.get("name") or "").lower() in wanted:
                proc.terminate()
                killed += 1
        except Exception:
            continue
    return killed


def _any_running(process_names):
    if psutil is None or not process_names:
        return False
    wanted = [p.lower() for p in process_names]
    for proc in psutil.process_iter(["name"]):
        try:
            if (proc.info.get("name") or "").lower() in wanted:
                return True
        except Exception:
            continue
    return False


# Processes that must never be closed by "close all applications" — core
# shell/system components, and anything that would take the agent itself (or
# the terminal running it) down with it.
NEVER_CLOSE = {
    "explorer.exe", "dwm.exe", "csrss.exe", "wininit.exe", "winlogon.exe",
    "services.exe", "lsass.exe", "svchost.exe", "smss.exe", "python.exe",
    "pythonw.exe", "cmd.exe", "powershell.exe", "pwsh.exe",
    "windowsterminal.exe", "conhost.exe", "searchhost.exe",
    "shellexperiencehost.exe", "startmenuexperiencehost.exe",
    "textinputhost.exe", "applicationframehost.exe", "sihost.exe",
    "ctfmon.exe", "taskhostw.exe", "fontdrvhost.exe", "taskmgr.exe",
}

# Browsers are excluded automatically from "close all" so the tab running
# Maximus itself never gets closed, regardless of which browser it's in.
BROWSER_PROCESSES = {
    "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe",
    "opera_gx.exe", "vivaldi.exe", "iexplore.exe",
}

CODE_PROCESSES = {"code.exe"}


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "system": SYSTEM})


@app.route("/battery", methods=["GET"])
def battery():
    if psutil is None:
        return jsonify({"error": "psutil not installed on this computer"}), 500
    b = psutil.sensors_battery()
    if b is None:
        return jsonify({"percent": None, "charging": None})
    return jsonify({"percent": b.percent, "charging": bool(b.power_plugged)})


@app.route("/show-desktop", methods=["POST"])
def show_desktop():
    try:
        if SYSTEM == "Windows":
            # Toggle "show desktop" the same way the Win+D shortcut does.
            subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "(New-Object -ComObject Shell.Application).ToggleDesktop()"],
                check=True,
            )
        elif SYSTEM == "Darwin":
            subprocess.run(["osascript", "-e", 'tell application "System Events" to key code 103'], check=False)
        else:
            if shutil.which("wmctrl"):
                subprocess.run(["wmctrl", "-k", "on"], check=True)
            else:
                return jsonify({"error": "Install 'wmctrl' (sudo apt install wmctrl) to support this on Linux"}), 500
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/open-explorer", methods=["POST"])
def open_explorer():
    data = request.get_json(silent=True) or {}
    target = data.get("path", "desktop")
    if target == "desktop":
        path = desktop_path()
    elif target == "screenshots":
        path = screenshots_dir()
    else:
        path = Path(os.path.expanduser(target))
    try:
        before = _snapshot_hwnds()
        if SYSTEM == "Windows":
            start_file(str(path))
        elif SYSTEM == "Darwin":
            subprocess.run(["open", str(path)], check=True)
        else:
            subprocess.run(["xdg-open", str(path)], check=True)
        focus_async(before, process_names=["explorer.exe"], title_contains=path.name)
        return jsonify({"ok": True, "path": str(path)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/open-task-manager", methods=["POST"])
def open_task_manager():
    try:
        before = _snapshot_hwnds()
        if SYSTEM == "Windows":
            run_detached(["taskmgr.exe"])
            focus_async(before, process_names=["taskmgr.exe"], title_contains="Task Manager")
        elif SYSTEM == "Darwin":
            subprocess.run(["open", "-a", "Activity Monitor"], check=True)
        else:
            for candidate in ["gnome-system-monitor", "ksysguard", "xfce4-taskmanager", "htop"]:
                if shutil.which(candidate):
                    run_detached([candidate])
                    break
            else:
                return jsonify({"error": "No task manager found. Install gnome-system-monitor or similar."}), 500
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/open-settings", methods=["POST"])
def open_settings():
    try:
        before = _snapshot_hwnds()
        if SYSTEM == "Windows":
            start_file("ms-settings:")
            focus_async(before, process_names=["systemsettings.exe", "applicationframehost.exe"], title_contains="Settings")
        elif SYSTEM == "Darwin":
            result = subprocess.run(["open", "-a", "System Settings"], check=False)
            if result.returncode != 0:
                subprocess.run(["open", "-a", "System Preferences"], check=False)
        else:
            for candidate in ["gnome-control-center", "systemsettings5", "unity-control-center"]:
                if shutil.which(candidate):
                    run_detached([candidate])
                    break
            else:
                return jsonify({"error": "No settings app found for this Linux desktop."}), 500
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Hints used to spot each app's newly-opened window on Windows so it can be
# forced to the foreground. None-value / missing entry just means "grab the
# first brand-new window that appears" — a reasonable default for apps not
# listed here.
FOCUS_HINTS = {
    "recycle bin": (["explorer.exe"], "Recycle Bin"),
    "microsoft store": (["winstore.app.exe", "applicationframehost.exe"], "Store"),
    "photos": (["microsoft.photos.exe", "applicationframehost.exe"], "Photos"),
    "steam": (["steam.exe"], "Steam"),
    "obs studio": (["obs64.exe", "obs32.exe"], "OBS"),
    "epic games": (["epicgameslauncher.exe"], "Epic"),
    "free download manager": (["fdm.exe"], "Download Manager"),
    "vscode": (["code.exe"], None),
    "notepad": (["notepad.exe"], "Notepad"),
    "calculator": (["calculatorapp.exe", "calc.exe"], "Calculator"),
    "chrome": (["chrome.exe"], None),
    "spotify": (["spotify.exe"], None),
    "discord": (["discord.exe"], None),
    "word": (["winword.exe"], None),
    "excel": (["excel.exe"], None),
    "powerpoint": (["powerpnt.exe"], None),
    "terminal": (["cmd.exe", "windowsterminal.exe"], None),
    "paint": (["mspaint.exe"], None),
    "edge": (["msedge.exe"], None),
    "firefox": (["firefox.exe"], None),
    "brave": (["brave.exe"], None),
    "opera": (["opera.exe"], None),
    "visual studio": (["devenv.exe"], None),
    "command prompt": (["cmd.exe"], None),
    "powershell": (["powershell.exe", "pwsh.exe", "windowsterminal.exe"], None),
    "whatsapp desktop": (["whatsapp.exe"], "WhatsApp"),
    "telegram desktop": (["telegram.exe"], "Telegram"),
    "zoom": (["zoom.exe"], "Zoom"),
    "microsoft teams": (["teams.exe", "ms-teams.exe"], "Teams"),
    "vlc": (["vlc.exe"], "VLC"),
    "photoshop": (["photoshop.exe"], "Photoshop"),
    "illustrator": (["illustrator.exe"], "Illustrator"),
    "premiere pro": (["adobe premiere pro.exe"], "Premiere Pro"),
    "after effects": (["afterfx.exe"], "After Effects"),
    "blender": (["blender.exe"], "Blender"),
    "davinci resolve": (["resolve.exe"], "DaVinci Resolve"),
    "media player": (["wmplayer.exe"], "Media Player"),
    "camera": (["windowscamera.exe"], "Camera"),
    "control panel": (["explorer.exe"], "Control Panel"),
    "device manager": (["mmc.exe"], "Device Manager"),
    "registry editor": (["regedit.exe"], "Registry Editor"),
    "disk management": (["mmc.exe"], "Disk Management"),
    "event viewer": (["mmc.exe", "eventvwr.exe"], "Event Viewer"),
    "services": (["mmc.exe"], "Services"),
    "task scheduler": (["mmc.exe"], "Task Scheduler"),
    "resource monitor": (["resmon.exe"], "Resource Monitor"),
    "performance monitor": (["mmc.exe", "perfmon.exe"], "Performance Monitor"),
    "snipping tool": (["snippingtool.exe", "screenclipper.exe"], None),
    "character map": (["charmap.exe"], "Character Map"),
}

# Same idea, used for "close <app>" — which windows/processes count as that
# app. Starts from FOCUS_HINTS (same apps, same identifying info) plus a few
# entries only relevant when closing, not opening (there's no "open file
# explorer to a specific place" via /open-app, so it isn't in FOCUS_HINTS).
CLOSE_HINTS = dict(FOCUS_HINTS)
CLOSE_HINTS.update({
    "file explorer": (["explorer.exe"], None),
    "explorer": (["explorer.exe"], None),
    "files": (["explorer.exe"], None),
    "computer settings": (["systemsettings.exe", "applicationframehost.exe"], "Settings"),
    "settings": (["systemsettings.exe", "applicationframehost.exe"], "Settings"),
    "task manager": (["taskmgr.exe"], "Task Manager"),
})


@app.route("/open-app", methods=["POST"])
def open_app():
    data = request.get_json(silent=True) or {}
    raw_name = (data.get("name") or "").strip().lower()
    if not raw_name:
        return jsonify({"error": "Missing app name"}), 400

    name = resolve_alias(raw_name)
    entry = APP_MAP.get(name)
    before = _snapshot_hwnds()

    try:
        if entry and SYSTEM in entry:
            cmd = entry[SYSTEM]
            run_detached(cmd)
            opened_with = "whitelist"
        else:
            # Fallback 1: the spoken name is itself a real command already
            # available on this system's PATH — never a raw constructed
            # shell string.
            exe = shutil.which(raw_name.replace(" ", ""))
            # Fallback 2 (Windows only): fixed default-install-location
            # check — fast, and covers Steam/OBS/Epic/FDM out of the box.
            known = known_path_search(name) if SYSTEM == "Windows" else None
            # Fallback 3 (Windows, Steam only): the install path Steam
            # itself records in the registry, in case it's not the default.
            reg = steam_path_from_registry() if (SYSTEM == "Windows" and name == "steam" and not known) else None
            if exe:
                run_detached([exe])
                opened_with = "path-lookup"
            elif known:
                run_detached([known])
                opened_with = f"known-path ({known})"
            elif reg:
                run_detached([reg])
                opened_with = f"registry ({reg})"
            elif SYSTEM == "Windows" and name in SEARCH_HINTS:
                # Fallback 4 (Windows only): search common install folders
                # (across every drive letter) for apps that don't register a
                # Start-menu shortcut command or a fixed default path.
                found = windows_common_dirs_search(SEARCH_HINTS[name])
                if found:
                    run_detached([found])
                    opened_with = f"program-files-search ({found})"
                else:
                    print(f'[maximus_agent] Could not find "{raw_name}" (resolved: "{name}") '
                          f'in the whitelist, on PATH, at its default install path, or under '
                          f'Program Files on any drive. Is it installed?')
                    return jsonify({"error": f'"{raw_name}" is not installed, or is in a non-standard location. '
                                              f'Edit APP_MAP or KNOWN_PATH_HINTS in maximus_agent.py to point at its exe directly.'}), 404
            else:
                print(f'[maximus_agent] Could not find "{raw_name}" (resolved: "{name}") '
                      f'in the whitelist or on PATH.')
                return jsonify({"error": f'"{raw_name}" is not a known or installed application on this computer.'}), 404

        open_path = data.get("openPath")
        if open_path and name == "vscode":
            if open_path.startswith("desktop/"):
                target = desktop_path() / open_path.split("desktop/", 1)[1]
            else:
                target = Path(os.path.expanduser(open_path))
            code_cmd = APP_MAP["vscode"].get(SYSTEM, ["code"]) + [str(target)]
            run_detached(code_cmd)

        hint = FOCUS_HINTS.get(name)
        focus_async(before, process_names=(hint[0] if hint else None), title_contains=(hint[1] if hint else None))

        return jsonify({"ok": True, "opened": name, "via": opened_with})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/create-file", methods=["POST"])
def create_file():
    data = request.get_json(silent=True) or {}
    location = data.get("location", "desktop")
    name = safe_filename(data.get("name", "new_file.txt"))
    content = data.get("content", "")

    if location != "desktop":
        return jsonify({"error": "Only creating files on the Desktop is supported right now."}), 400

    try:
        target = desktop_path() / name
        target.write_text(content, encoding="utf-8")
        return jsonify({"ok": True, "path": str(target)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/create-folder", methods=["POST"])
def create_folder():
    data = request.get_json(silent=True) or {}
    location = data.get("location", "desktop")
    name = safe_component(data.get("name", "New Folder"))

    if location != "desktop":
        return jsonify({"error": "Only creating folders on the Desktop is supported right now."}), 400

    try:
        target = desktop_path() / name
        target.mkdir(parents=True, exist_ok=True)
        return jsonify({"ok": True, "path": str(target)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/empty-recycle-bin", methods=["POST"])
def empty_recycle_bin():
    try:
        # This is normally called right after /open-app opens the Recycle
        # Bin window, so pause briefly to let it actually render on screen
        # before wiping it — otherwise it can empty before you ever see it.
        time.sleep(1.2)
        if SYSTEM == "Windows":
            # SHEmptyRecycleBinW flags: no confirmation dialog, no progress
            # UI, no "recycling" sound — a clean, silent empty.
            SHERB_NOCONFIRMATION = 0x00000001
            SHERB_NOPROGRESSUI = 0x00000002
            SHERB_NOSOUND = 0x00000004
            flags = SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND
            ctypes.windll.shell32.SHEmptyRecycleBinW(None, None, flags)
        elif SYSTEM == "Darwin":
            subprocess.run(["osascript", "-e", 'tell application "Finder" to empty the trash'], check=False)
        else:
            trash_files = Path(os.path.expanduser("~/.local/share/Trash/files"))
            trash_info = Path(os.path.expanduser("~/.local/share/Trash/info"))
            for folder in (trash_files, trash_info):
                if folder.exists():
                    for item in folder.iterdir():
                        if item.is_dir():
                            shutil.rmtree(item, ignore_errors=True)
                        else:
                            item.unlink(missing_ok=True)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/close-app", methods=["POST"])
def close_app_route():
    data = request.get_json(silent=True) or {}
    raw_name = (data.get("name") or "").strip().lower()
    if not raw_name:
        return jsonify({"error": "Missing app name"}), 400

    name = resolve_alias(raw_name)
    hint = CLOSE_HINTS.get(name)
    process_names = hint[0] if hint else [raw_name.replace(" ", "") + ".exe"]
    title_contains = hint[1] if hint else None

    try:
        if SYSTEM == "Windows":
            closed = _close_matching_windows(process_names=process_names, title_contains=title_contains)
            # Give the app a moment to actually close (or pop a save-changes
            # prompt) before we check whether it's still running.
            time.sleep(0.8)
            if closed == 0:
                if _any_running(process_names):
                    # No visible window (e.g. minimized to the tray) — force it.
                    if _kill_processes(process_names) == 0:
                        return jsonify({"error": f'"{raw_name}" doesn\'t look like it\'s running.'}), 404
                else:
                    return jsonify({"error": f'"{raw_name}" doesn\'t look like it\'s running.'}), 404
            return jsonify({"ok": True, "closed": name})
        else:
            if _kill_processes(process_names) == 0:
                return jsonify({"error": f'"{raw_name}" doesn\'t look like it\'s running, or closing named '
                                          f'apps isn\'t fully supported on this OS yet.'}), 404
            return jsonify({"ok": True, "closed": name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/close-all-apps", methods=["POST"])
def close_all_apps():
    """Closes every visible application window except the browser (any of
    them — we don't know which one is running Maximus, so all are protected),
    VS Code, and core OS/shell processes. Always applies the same safe
    exclusion list, so "close everything" and "close everything except the
    browser and VS Code" behave identically."""
    if SYSTEM != "Windows":
        return jsonify({"error": "Closing all apps at once is only supported on Windows right now."}), 400
    try:
        user32 = ctypes.windll.user32
        seen_pids = set()
        closed_titles = []
        for hwnd, pid, title in _enum_top_windows():
            if not title or title.lower() == "program manager":
                continue
            pname = _pid_process_name(pid)
            if not pname or pname in NEVER_CLOSE or pname in BROWSER_PROCESSES or pname in CODE_PROCESSES:
                continue
            user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
            if pid not in seen_pids:
                seen_pids.add(pid)
                closed_titles.append(title)
        return jsonify({"ok": True, "closed_count": len(seen_pids), "closed": closed_titles})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/brightness", methods=["GET"])
def get_brightness():
    if sbc is None:
        return jsonify({"error": "Brightness control needs the 'screen_brightness_control' package. "
                                  "Run: pip install screen_brightness_control"}), 500
    try:
        level = sbc.get_brightness(display=0)
        level = level[0] if isinstance(level, list) else level
        return jsonify({"percent": level})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/brightness", methods=["POST"])
def set_brightness():
    if sbc is None:
        return jsonify({"error": "Brightness control needs the 'screen_brightness_control' package. "
                                  "Run: pip install screen_brightness_control"}), 500
    data = request.get_json(silent=True) or {}
    action = data.get("action", "set")
    try:
        amount = int(data.get("amount", 10))
    except (TypeError, ValueError):
        amount = 10
    try:
        current = sbc.get_brightness(display=0)
        current = current[0] if isinstance(current, list) else current
        if action == "up":
            new_val = min(100, current + amount)
        elif action == "down":
            new_val = max(0, current - amount)
        elif action == "set":
            new_val = max(0, min(100, amount))
        else:
            return jsonify({"error": f"Unknown brightness action '{action}'"}), 400
        sbc.set_brightness(new_val)
        return jsonify({"ok": True, "percent": new_val})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


VK_VOLUME_MUTE = 0xAD
VK_VOLUME_DOWN = 0xAE
VK_VOLUME_UP = 0xAF


def _send_media_key(vk, times=1):
    user32 = ctypes.windll.user32
    for _ in range(times):
        user32.keybd_event(vk, 0, 0, 0)
        user32.keybd_event(vk, 0, 2, 0)  # KEYEVENTF_KEYUP
        time.sleep(0.03)


def _pycaw_volume_interface():
    # COM (which pycaw sits on top of) must be initialized on whatever OS
    # thread is making the call, or every pycaw call silently raises and the
    # code falls back to reporting "volume control isn't available" even
    # though pycaw/comtypes ARE installed. Flask's dev server can service a
    # request on a fresh thread, so initialize COM defensively here every
    # time rather than assuming it was already done on this thread.
    try:
        comtypes.CoInitialize()
    except OSError:
        pass  # already initialized on this thread — fine, keep going
    devices = AudioUtilities.GetSpeakers()
    interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
    return cast(interface, POINTER(IAudioEndpointVolume))


@app.route("/volume", methods=["GET"])
def get_volume():
    if SYSTEM == "Windows" and PYCAW_AVAILABLE:
        try:
            vol = _pycaw_volume_interface()
            percent = round(vol.GetMasterVolumeLevelScalar() * 100)
            return jsonify({"percent": percent, "muted": bool(vol.GetMute())})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    return jsonify({"error": "Reading the exact volume level needs 'pycaw' and 'comtypes' (Windows only). "
                              "Run: pip install pycaw comtypes"}), 500


@app.route("/volume", methods=["POST"])
def set_volume():
    data = request.get_json(silent=True) or {}
    action = data.get("action", "up")
    try:
        amount = int(data.get("amount", 10))
    except (TypeError, ValueError):
        amount = 10
    try:
        if SYSTEM == "Windows" and PYCAW_AVAILABLE:
            vol = _pycaw_volume_interface()
            if action == "mute":
                vol.SetMute(1, None)
                return jsonify({"ok": True, "muted": True})
            if action == "unmute":
                vol.SetMute(0, None)
                return jsonify({"ok": True, "muted": False})
            current = vol.GetMasterVolumeLevelScalar() * 100
            if action == "up":
                new_val = min(100, current + amount)
            elif action == "down":
                new_val = max(0, current - amount)
            elif action == "set":
                new_val = max(0, min(100, amount))
            else:
                return jsonify({"error": f"Unknown volume action '{action}'"}), 400
            vol.SetMasterVolumeLevelScalar(new_val / 100.0, None)
            return jsonify({"ok": True, "percent": round(new_val)})

        elif SYSTEM == "Windows":
            # No pycaw installed — fall back to simulating the physical
            # volume keys. Stock Windows moves ~2% per keypress, so
            # approximate the requested amount by pressing that many times.
            # No exact percentage is returned in this mode.
            if action == "up":
                _send_media_key(VK_VOLUME_UP, max(1, round(amount / 2)))
            elif action == "down":
                _send_media_key(VK_VOLUME_DOWN, max(1, round(amount / 2)))
            elif action in ("mute", "unmute"):
                _send_media_key(VK_VOLUME_MUTE, 1)
            else:
                return jsonify({"error": f"Unknown volume action '{action}'"}), 400
            return jsonify({"ok": True, "approximate": True})

        elif SYSTEM == "Darwin":
            if action == "up":
                subprocess.run(["osascript", "-e",
                                 f"set volume output volume ((output volume of (get volume settings)) + {amount})"], check=False)
            elif action == "down":
                subprocess.run(["osascript", "-e",
                                 f"set volume output volume ((output volume of (get volume settings)) - {amount})"], check=False)
            elif action == "set":
                subprocess.run(["osascript", "-e", f"set volume output volume {amount}"], check=False)
            elif action == "mute":
                subprocess.run(["osascript", "-e", "set volume with output muted"], check=False)
            elif action == "unmute":
                subprocess.run(["osascript", "-e", "set volume without output muted"], check=False)
            else:
                return jsonify({"error": f"Unknown volume action '{action}'"}), 400
            return jsonify({"ok": True})

        else:
            if not shutil.which("pactl"):
                return jsonify({"error": "Install 'pactl' (pulseaudio-utils / pipewire-pulse) for volume control on Linux."}), 500
            if action == "up":
                subprocess.run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"+{amount}%"], check=False)
            elif action == "down":
                subprocess.run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"-{amount}%"], check=False)
            elif action == "set":
                subprocess.run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{amount}%"], check=False)
            elif action == "mute":
                subprocess.run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "1"], check=False)
            elif action == "unmute":
                subprocess.run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "0"], check=False)
            else:
                return jsonify({"error": f"Unknown volume action '{action}'"}), 400
            return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/power", methods=["POST"])
def power_control():
    """Restart, shut down, or sleep THIS computer. Runs immediately on
    request — the app-side voice command already speaks a confirmation
    ("Restarting the computer now.") right before calling this, so by the
    time this fires the user has already heard what's about to happen."""
    data = request.get_json(silent=True) or {}
    action = data.get("action")
    if action not in ("restart", "shutdown", "sleep"):
        return jsonify({"error": f"Unknown power action '{action}'"}), 400
    try:
        if SYSTEM == "Windows":
            if action == "restart":
                subprocess.run(["shutdown", "/r", "/t", "0"], check=False)
            elif action == "shutdown":
                subprocess.run(["shutdown", "/s", "/t", "0"], check=False)
            elif action == "sleep":
                # SetSuspendState(Hibernate=0, Force=1, DisableWake=0) -> real sleep, not hibernate
                subprocess.run(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"], check=False)
        elif SYSTEM == "Darwin":
            if action == "restart":
                subprocess.run(["osascript", "-e", 'tell app "System Events" to restart'], check=False)
            elif action == "shutdown":
                subprocess.run(["osascript", "-e", 'tell app "System Events" to shut down'], check=False)
            elif action == "sleep":
                subprocess.run(["pmset", "sleepnow"], check=False)
        else:  # Linux
            if action == "restart":
                if shutil.which("systemctl"):
                    subprocess.run(["systemctl", "reboot"], check=False)
                else:
                    subprocess.run(["shutdown", "-r", "now"], check=False)
            elif action == "shutdown":
                if shutil.which("systemctl"):
                    subprocess.run(["systemctl", "poweroff"], check=False)
                else:
                    subprocess.run(["shutdown", "-h", "now"], check=False)
            elif action == "sleep":
                if shutil.which("systemctl"):
                    subprocess.run(["systemctl", "suspend"], check=False)
                else:
                    return jsonify({"error": "Install systemd (systemctl) for sleep support on this Linux system."}), 500
        return jsonify({"ok": True, "action": action})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/take-screenshot", methods=["POST"])
def take_screenshot_route():
    try:
        folder = screenshots_dir()
        filename = f"Screenshot_{time.strftime('%Y-%m-%d_%H-%M-%S')}.png"
        target = folder / filename
        ok = take_screenshot(target)
        if not ok:
            return jsonify({"error": "No screenshot tool available on this system. On Linux, install "
                                      "'gnome-screenshot' or 'scrot'. Windows and macOS work automatically."}), 500
        return jsonify({"ok": True, "path": str(target), "filename": filename})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/open-latest-screenshot", methods=["POST"])
def open_latest_screenshot():
    try:
        folder = screenshots_dir()
        files = sorted(
            (p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg")),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not files:
            return jsonify({"error": 'No screenshots found yet. Say "take a screenshot" first.'}), 404
        latest = files[0]
        before = _snapshot_hwnds()
        if SYSTEM == "Windows":
            start_file(str(latest))
        elif SYSTEM == "Darwin":
            subprocess.run(["open", str(latest)], check=True)
        else:
            subprocess.run(["xdg-open", str(latest)], check=True)
        focus_async(before, title_contains=latest.stem)
        return jsonify({"ok": True, "path": str(latest), "filename": latest.name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500



# ---------- Auto-scroll: "auto scroll" / "stop" ----------
# Simulates real mouse-wheel ticks (not something a browser tab can send to a
# DIFFERENT window or a native app) so it scrolls whatever window currently
# has focus — YouTube, Instagram, Reddit, LinkedIn, WhatsApp, anything —
# continuously until told to stop. Runs in a background thread so /scroll
# start returns immediately; the loop checks a stop flag every tick.
_scroll_thread = None
_scroll_stop_event = threading.Event()
_scroll_lock = threading.Lock()

WHEEL_DELTA = 120  # Windows' standard "one notch" unit


def _windows_scroll_tick(direction):
    user32 = ctypes.windll.user32
    amount = WHEEL_DELTA if direction == "up" else -WHEEL_DELTA
    # MOUSEEVENTF_WHEEL = 0x0800; dwData carries the signed wheel delta.
    user32.mouse_event(0x0800, 0, 0, ctypes.c_long(amount), 0)


def _linux_scroll_tick(direction):
    # xdotool click 4 = wheel up, click 5 = wheel down.
    button = "4" if direction == "up" else "5"
    subprocess.run(["xdotool", "click", button], check=False)


def _macos_scroll_tick(direction):
    # System Events can post a scroll wheel event via AppleScript.
    amount = 10 if direction == "up" else -10
    script = f'tell application "System Events" to scroll wheel event {amount}'
    subprocess.run(["osascript", "-e", script], check=False)


def _scroll_loop(direction, speed):
    interval = {"slow": 0.35, "normal": 0.18, "fast": 0.08}.get(speed, 0.18)
    while not _scroll_stop_event.is_set():
        try:
            if SYSTEM == "Windows":
                _windows_scroll_tick(direction)
            elif SYSTEM == "Darwin":
                _macos_scroll_tick(direction)
            else:
                _linux_scroll_tick(direction)
        except Exception:
            break
        _scroll_stop_event.wait(interval)


@app.route("/scroll", methods=["POST"])
def scroll_control():
    global _scroll_thread
    data = request.get_json(silent=True) or {}
    action = data.get("action", "start")
    direction = data.get("direction", "down")
    speed = data.get("speed", "normal")
    if direction not in ("up", "down"):
        direction = "down"

    if SYSTEM == "Linux" and shutil.which("xdotool") is None and action != "stop":
        return jsonify({"error": "Auto-scroll on Linux needs 'xdotool'. Install it with your package "
                                  "manager (e.g. sudo apt install xdotool) and try again."}), 500

    with _scroll_lock:
        if action == "stop":
            _scroll_stop_event.set()
            if _scroll_thread and _scroll_thread.is_alive():
                _scroll_thread.join(timeout=1.0)
            _scroll_thread = None
            return jsonify({"ok": True, "action": "stop"})

        if action == "step":
            # A single, one-off nudge — e.g. bare "scroll up"/"scroll down" —
            # as opposed to "start", which scrolls continuously until "stop".
            # Stop any continuous scroll first so the two never overlap.
            if _scroll_thread and _scroll_thread.is_alive():
                _scroll_stop_event.set()
                _scroll_thread.join(timeout=1.0)
                _scroll_thread = None
            try:
                ticks = max(1, min(10, int(data.get("ticks", 3))))
            except (TypeError, ValueError):
                ticks = 3
            for _ in range(ticks):
                if SYSTEM == "Windows":
                    _windows_scroll_tick(direction)
                elif SYSTEM == "Darwin":
                    _macos_scroll_tick(direction)
                else:
                    _linux_scroll_tick(direction)
                time.sleep(0.02)
            return jsonify({"ok": True, "action": "step", "direction": direction})

        # "start" — stop any previous scroll first so direction/speed changes
        # don't stack multiple loops on top of each other.
        if _scroll_thread and _scroll_thread.is_alive():
            _scroll_stop_event.set()
            _scroll_thread.join(timeout=1.0)

        _scroll_stop_event.clear()
        _scroll_thread = threading.Thread(target=_scroll_loop, args=(direction, speed), daemon=True)
        _scroll_thread.start()
        return jsonify({"ok": True, "action": "start", "direction": direction})


# ---------------------------------------------------------------------------
# Screen size + click/type/key — lets voice commands like "click the follow
# button" or "click the search bar and type this" act on whatever's visible
# on the shared screen. The browser tells us WHAT to click (by asking the
# vision model to locate it in the shared screenshot and return a fractional
# x/y position); this agent turns that fraction into a real screen pixel
# position and performs the actual click/keystrokes, for the same reason
# scrolling/opening apps needs the agent — a browser tab can't drive input
# into other windows or native apps on its own.
# ---------------------------------------------------------------------------

def _windows_screen_size():
    user32 = ctypes.windll.user32
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass
    return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)


def _linux_screen_size():
    out = subprocess.run(["xdotool", "getdisplaygeometry"], check=False, capture_output=True, text=True)
    parts = (out.stdout or "").split()
    if len(parts) == 2:
        return int(parts[0]), int(parts[1])
    return None


def _macos_screen_size():
    script = 'tell application "Finder" to get bounds of window of desktop'
    out = subprocess.run(["osascript", "-e", script], check=False, capture_output=True, text=True)
    parts = (out.stdout or "").strip().split(", ")
    if len(parts) == 4:
        return int(parts[2]), int(parts[3])
    return None


@app.route("/screen-size", methods=["GET"])
def screen_size():
    try:
        if SYSTEM == "Windows":
            w, h = _windows_screen_size()
        elif SYSTEM == "Darwin":
            res = _macos_screen_size()
            if not res:
                return jsonify({"error": "Couldn't read screen size."}), 500
            w, h = res
        else:
            if shutil.which("xdotool") is None:
                return jsonify({"error": "Reading screen size on Linux needs 'xdotool'."}), 500
            res = _linux_screen_size()
            if not res:
                return jsonify({"error": "Couldn't read screen size."}), 500
            w, h = res
        return jsonify({"width": w, "height": h})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _windows_click(x, y):
    user32 = ctypes.windll.user32
    user32.SetCursorPos(int(x), int(y))
    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.03)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)


def _linux_click(x, y):
    subprocess.run(["xdotool", "mousemove", str(int(x)), str(int(y)), "click", "1"], check=False)


def _macos_click(x, y):
    script = f'tell application "System Events" to click at {{{int(x)}, {int(y)}}}'
    subprocess.run(["osascript", "-e", script], check=False)


@app.route("/click", methods=["POST"])
def click_control():
    data = request.get_json(silent=True) or {}
    try:
        x = float(data["x"])
        y = float(data["y"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "click needs numeric 'x' and 'y' (real screen pixel coordinates)."}), 400

    try:
        if SYSTEM == "Windows":
            _windows_click(x, y)
        elif SYSTEM == "Darwin":
            _macos_click(x, y)
        else:
            if shutil.which("xdotool") is None:
                return jsonify({"error": "Clicking on Linux needs 'xdotool'. Install it with your package "
                                          "manager (e.g. sudo apt install xdotool) and try again."}), 500
            _linux_click(x, y)
        return jsonify({"ok": True, "x": x, "y": y})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _windows_type(text):
    user32 = ctypes.windll.user32
    for ch in text:
        code = ord(ch)
        # KEYEVENTF_UNICODE = 0x0004, KEYEVENTF_KEYUP = 0x0002
        user32.keybd_event(0, code, 0x0004, 0)
        user32.keybd_event(0, code, 0x0004 | 0x0002, 0)
        time.sleep(0.01)


def _linux_type(text):
    subprocess.run(["xdotool", "type", "--delay", "15", text], check=False)


def _macos_type(text):
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    script = f'tell application "System Events" to keystroke "{escaped}"'
    subprocess.run(["osascript", "-e", script], check=False)


@app.route("/type", methods=["POST"])
def type_control():
    data = request.get_json(silent=True) or {}
    text = data.get("text", "")
    if not text:
        return jsonify({"error": "type needs non-empty 'text'."}), 400
    try:
        if SYSTEM == "Windows":
            _windows_type(text)
        elif SYSTEM == "Darwin":
            _macos_type(text)
        else:
            if shutil.which("xdotool") is None:
                return jsonify({"error": "Typing on Linux needs 'xdotool'."}), 500
            _linux_type(text)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


_KEY_VK = {"enter": 0x0D, "tab": 0x09, "escape": 0x1B, "backspace": 0x08}


@app.route("/key", methods=["POST"])
def key_control():
    data = request.get_json(silent=True) or {}
    key = (data.get("key") or "enter").lower()
    try:
        if SYSTEM == "Windows":
            vk = _KEY_VK.get(key, 0x0D)
            user32 = ctypes.windll.user32
            user32.keybd_event(vk, 0, 0, 0)
            user32.keybd_event(vk, 0, 2, 0)
        elif SYSTEM == "Darwin":
            keymap = {"enter": 36, "tab": 48, "escape": 53, "backspace": 51}
            code = keymap.get(key, 36)
            subprocess.run(["osascript", "-e",
                             f'tell application "System Events" to key code {code}'], check=False)
        else:
            if shutil.which("xdotool") is None:
                return jsonify({"error": "Key presses on Linux need 'xdotool'."}), 500
            xkeymap = {"enter": "Return", "tab": "Tab", "escape": "Escape", "backspace": "BackSpace"}
            subprocess.run(["xdotool", "key", xkeymap.get(key, "Return")], check=False)
        return jsonify({"ok": True, "key": key})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    print(f"Maximus Desktop Agent running on {SYSTEM} — http://127.0.0.1:5055")
    print("Leave this window open. Press Ctrl+C to stop.")
    app.run(host="127.0.0.1", port=5055)