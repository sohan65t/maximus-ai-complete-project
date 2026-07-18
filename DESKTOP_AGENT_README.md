# Maximus Desktop Agent — setup

Your Maximus web app (`index.html` / `app.js`) runs in the browser, and
browsers are deliberately blocked from touching your operating system —
no website can open File Explorer, launch programs, or read your battery
by itself. That's a security feature.

To make voice commands like *"open task manager"* or *"battery percentage"*
actually work, this project now includes **`maximus_agent.py`** — a small
Python program that runs locally on your own computer and does the real
work. The web app just asks it politely over `http://127.0.0.1:5055`.

## 1. Install Python
Get Python 3.9+ from https://python.org if you don't already have it.

## 2. Install dependencies
```
pip install -r requirements.txt
```

## 3. Run the agent
```
python maximus_agent.py
```
Leave that terminal window open in the background. You'll see:
```
Maximus Desktop Agent running on Windows — http://127.0.0.1:5055
```

## 4. Use the app normally
Open/refresh `index.html` in your browser (or your existing local server for
it), tap the ✨ **AI Assistant** button, and try:

| Say this | What happens |
|---|---|
| "battery percentage" | Speaks your current battery % (and charging status) |
| "go to desktop" | Minimizes everything, like Win+D |
| "open file explorer" | Opens Explorer / Finder at your Desktop |
| "open task manager" | Opens Task Manager / Activity Monitor |
| "open computer settings" | Opens your OS's Settings app |
| "open vscode" | Launches VS Code |
| "open steam" / "open epic games" / "open obs studio" / "open free download manager" | Launches those apps (if installed) |
| "open recycle bin" | Opens the Recycle Bin / Trash |
| "open photos" | Opens the Photos app |
| "open microsoft store" | Opens the Microsoft Store (Windows only) |
| "open power point" / "open word" / "open excel" | Launches Microsoft Office apps |
| "create a file on desktop named notes" | Creates `notes.txt` on your Desktop — no extension needed, it defaults to `.txt` automatically. Give your own extension (e.g. "named report.pdf") and that's kept instead. |
| "create a file on desktop named todo.txt and open it in vscode" | Creates it, then opens it in VS Code |
| "create a folder on desktop named projects" | Creates a real folder (no extension added) |
| "empty the recycle bin" / "delete all the files in recycle bin" | Opens the Recycle Bin so you can see it, waits a beat, then empties it |
| "open notepad" / "open calculator" / "open chrome" / "open spotify" / "open discord" | Launches that app |
| "open `<anything on your PATH>`" | Falls back to launching it if it's a real installed command |
| "take a screenshot" | Captures the whole screen and saves it to your Pictures/Screenshots folder |
| "show screenshots" / "open screenshots" | Opens that folder so you can see all of them |
| "open the latest screenshot" / "open latest screenshot taken" | Opens the most recently taken screenshot in your default image viewer |
| "auto scroll" / "scroll down" | Starts continuously scrolling whatever window/app currently has focus (YouTube, Instagram, Reddit, LinkedIn, Facebook, WhatsApp, anything) |
| "scroll up" | Same, scrolling upward instead |
| "stop" / "stop scrolling" | Stops the auto-scroll |
| "increase brightness" / "decrease brightness" / "set brightness to 60" | Adjusts screen brightness (optionally "...by 20 percent") |
| "increase volume" / "decrease volume" / "set volume to 40" / "mute" / "unmute" | Adjusts system volume |
| "close notepad" / "close excel" / "close settings" / "close file explorer" / "close recycle bin" | Closes that specific app — sends it the same close signal as clicking its own X, so Office apps still get to show a "save changes?" prompt |
| "close all applications" (optionally "...except the browser and vs code") | Closes everything open **except** your browser (any of them, so the tab running Maximus is always safe), VS Code, and core Windows components |
| "restart the computer" / "reboot" | Restarts the computer immediately |
| "shut down the computer" | Shuts the computer down immediately |
| "sleep" / "go to sleep" / "sleep mode" | Puts the computer to sleep |
| "open edge" / "open firefox" / "open brave" / "open opera" | Launches that browser |
| "open visual studio" / "open command prompt" / "open powershell" | Launches Visual Studio, `cmd`, or PowerShell |
| "open whatsapp desktop" / "open telegram desktop" / "open zoom" / "open microsoft teams" | Launches those communication apps |
| "open vlc" / "open photoshop" / "open illustrator" / "open premiere pro" / "open after effects" / "open blender" / "open davinci resolve" | Launches those media/creative apps |
| "open control panel" / "open device manager" / "open registry editor" / "open disk management" / "open event viewer" / "open services" / "open task scheduler" / "open resource monitor" / "open performance monitor" | Launches Windows admin/system tools |
| "open snipping tool" / "open character map" / "open camera" / "open media player" | Launches those Windows utility apps |
| "close edge" / "close whatsapp desktop" / "close zoom" / "close blender" / etc. | Closes any of the newly added apps above, same "click its own X" close behavior as other apps |

### Websites
Say "open `<name>`" (or "open `<name>` website" / "open `<name>.com`") for any of these — they open as a browser tab, not through the desktop agent, so they work even without `maximus_agent.py` running:

Google Drive, Google Docs, Google Sheets, Google Slides, Google Calendar, Google Maps, Google Translate, Google Photos, Google Meet, Google Keep, Outlook, OneDrive, Microsoft Teams, Microsoft 365, Bing, Copilot, Telegram, Crunchyroll, Twitch, Myntra, Meesho, BBC, CNN, Reuters, NDTV, Times of India, The Hindu, Cricbuzz, ESPN, TradingView, Yahoo Finance, CoinMarketCap, CoinGecko, Zerodha Kite, Groww, Upstox — plus everything already supported (YouTube, Google, ChatGPT, Instagram, Amazon, Flipkart, Reddit, WhatsApp Web, Spotify, Gmail, LinkedIn, Netflix, and more).

Note: a couple of names (e.g. "Microsoft Teams", "Spotify") exist both as a website and as a launchable desktop app above — saying "open `<name>`" opens the website version, since site matching is checked first.

## Restart / shutdown / sleep — no confirmation dialog
These three run immediately when spoken — Maximus says the confirmation
line ("Restarting the computer now.") itself right before the command
fires, so make sure you actually mean it before saying it. There's no undo
once the OS starts the shutdown/restart.

## Vision (webcam) — no agent needed
"open vision" turns your **browser's own camera** on (a small permission
prompt will appear the first time) and shows a live preview inside the
Maximus assistant window. While it's on, ask things like "what do you see"
or "look at this" and Maximus grabs the current frame and answers about it
out loud. Say "close vision" (or tap the 👁️ Vision button again) to turn the
camera off. This runs entirely in the browser and talks directly to the AI
provider — it does not go through `maximus_agent.py` at all, so it works
even without the desktop agent running.

## Screen Share — no agent needed
Tap **🖥️ Share Screen** (or say *"share my screen"*) and pick a tab, a
window, or your whole monitor in the browser's own share picker — this is
the same permission prompt every screen-sharing tool uses, so nothing extra
to install. A small preview appears so you can see what's being shared.
While it's on:
- Highlight/select any text on the shared screen and ask *"what does this
  mean"* or *"what am I looking at"* — Maximus grabs the current frame and
  answers about it out loud, prioritizing whatever's highlighted.
- This works on any site or app you have on screen — YouTube, Instagram,
  Reddit, LinkedIn, Facebook, WhatsApp, a document, code, anything.
- Say *"stop sharing my screen"* (or tap the button again, or use the
  browser's own "Stop sharing" bar) to turn it off.

Like Vision, this runs entirely in the browser and talks directly to the AI
provider — it does not go through `maximus_agent.py`, so it works even
without the desktop agent running. The one thing it *can't* do on its own is
scroll — see Auto-scroll below for that.

## Understanding natural phrasing, not just exact commands
Voice commands no longer have to match one of the scripted phrasings above
word-for-word. If what you say doesn't match instantly, Maximus now asks
the AI model to figure out whether you meant one of these actions anyway
(e.g. "could you pull up youtube for me" or "turn the volume down a
touch") and runs it — only falling back to a normal conversational answer
if it really was just a question or chit-chat. This needs your API key to
be set (Settings), since it's a small extra AI call before answering.

## Volume commands not working?
If "increase/decrease volume" wasn't doing anything even with `pycaw` and
`comtypes` installed, that was almost always a COM-initialization issue —
Windows requires COM to be set up on whatever thread is handling the
request, and the agent's web server wasn't always doing that on the right
thread. The agent now initializes COM defensively on every volume call, so
this should work reliably now. If it's still silent after restarting the
agent, run `pip install --upgrade pycaw comtypes` and restart the agent
again; without those two packages installed, volume changes will fall back
to simulating your physical volume keys instead (~2% per step, and no exact
percentage read-back), which still works but is coarser.

## Brightness & volume — one extra install step
These two need small additional packages beyond the base three. If you
already ran `pip install -r requirements.txt` after this update, you're
covered; if not:
```
pip install screen_brightness_control pycaw comtypes
```
`pycaw`/`comtypes` are what let volume commands report and set an *exact*
percentage on Windows. Without them, volume up/down still works by
simulating your keyboard's physical volume keys (~2% per step), just without
an exact number to read back. Brightness needs `screen_brightness_control`
either way — without it, brightness commands will tell you it's not
installed rather than silently doing nothing.

## Auto-scroll — how it works and its limits
Saying "auto scroll" (or "start scrolling") while looking at YouTube,
Instagram, Reddit, LinkedIn, Facebook, WhatsApp, or anything else sends real
mouse-wheel input to whatever window currently has focus, through
`maximus_agent.py` — a browser tab can never scroll a *different* window or
a native app by itself, the same restriction covered above for opening apps.
So:
- **This needs the agent running**, unlike Vision and Screen Share.
- **The scrolled window must actually have focus/be on top** — click into it
  (or Alt-Tab to it) before saying "auto scroll" if it isn't already active.
- Works out of the box on **Windows** and **macOS**. On **Linux** it needs
  `xdotool` installed (e.g. `sudo apt install xdotool`); without it, the
  agent will say so rather than silently failing.
- Say "stop" or "stop scrolling" any time to stop it — there's no automatic
  timeout.
- **"scroll up" / "scroll down" on their own are one-off nudges**, not
  continuous scrolling — say "auto scroll", "start scrolling", or "keep
  scrolling" if you want it to keep going until you say "stop".

## Clicking things on your shared screen
While screen sharing is on, you can say things like:
- "click the follow button" / "click messages" / "click home" / "click
  reels" / "click search" / "click notifications" / "click profile" — works
  on Instagram, LinkedIn, or anywhere else those show up. Common nav labels
  (Home, Reels, Messages, Search, Notifications, Create, Profile on
  Instagram; Home, My Network, Jobs, Messaging, Notifications, Me on
  LinkedIn) get extra icon/shape hints under the hood so they land on the
  right one instead of a similar-looking icon elsewhere on screen.
- "click the video titled `<name>`" (YouTube or similar).
- "click the search bar and type `<text>`" — clicks the field, types the
  text, and presses Enter since it's a search.
- "click the first website" / "click the second result" / "click `<a
  website's name>`" in a list of search results or links — works the same
  way on Google or any other search/results page.
- Basically "click `<anything you can see>`" — Maximus asks the vision model
  where it is on the screenshot, then the agent actually clicks it.

## Uploading a photo or video
Say "upload a photo" / "upload video" / "upload reel" (on Instagram,
LinkedIn, or any other site):
- Maximus clicks whatever create/upload/add-media control it can find (a
  "+" icon, camera icon, "Add media" button, etc).
- If that opens a menu first (e.g. Instagram's Post/Reel/Story choice),
  say which one — "click post" or "click reel" — then say "upload photo"
  again for the file dialog.
- If you name a file — "upload the photo named vacation.jpg" or "upload
  video from C:\Users\me\Desktop\clip.mp4" — Maximus types that straight
  into the native file-picker's filename field and presses Enter. A full
  path is more reliable than a bare filename, since the dialog only finds a
  bare filename if it happens to already be browsing that folder.
- If you don't name a file, the dialog is left open for you to pick by hand.

Notes:
- **This needs `maximus_agent.py` running**, same as auto-scroll — a browser
  tab can't click into a different window or native app by itself.
- **Accuracy is best when you share your Entire Screen**, not a single tab
  or window, since click coordinates are computed from the screenshot as a
  fraction of the full screen. If you shared a window/tab instead, Maximus
  will still try but will remind you it might be off.
- If you say "click X" before screen sharing has started, Maximus starts it
  for you first (same as asking a screen question).

## Reading vs. explaining highlighted text
These are now two different things:
- **"read the highlighted text"** (or "read this") transcribes exactly what's
  highlighted on your screen, word for word, and reads that back — no
  paraphrasing.
- **"explain the highlighted text"** (or "explain this") describes what it
  *means* instead, and won't just read it back verbatim.

## "Who is this?" while screen sharing
Asking "who is this" (or "who's that") while screen sharing is on now looks
at your **shared screen**, not the webcam — useful for asking about a face
or profile currently visible on screen. If screen sharing isn't on but
Vision (the webcam) is, it falls back to the webcam instead. Note Maximus
will only offer a name if it's genuinely confident (e.g. a public figure it
recognizes) — for anyone else, it describes what it sees rather than
guessing an identity.

## Closing applications — how it decides what's safe
"Close all applications" **never** touches: any browser (Chrome, Edge,
Firefox, Brave, Opera, Vivaldi), VS Code, or core Windows/shell processes
(Explorer, the taskbar, Task Manager, etc.) — regardless of whether you say
"except the browser and VS Code" or just "close everything". This is a
fixed safety list built into the agent, not something spoken commands can
override.

Closing a *specific* named app (e.g. "close excel") asks it to close the
same way clicking its own **X** button would — so if you have unsaved work,
you'll still see that app's own "save changes?" prompt rather than losing
anything. Only apps with no visible window (e.g. something sitting quietly
in the system tray) get force-closed directly.

## Windows: opened things now actually show up on screen
Previously, some things (File Explorer, Task Manager, Settings, the Recycle
Bin, the Microsoft Store, Steam, OBS, etc.) could open **behind** your other
windows, so you had to click the taskbar to actually see them. The agent now
watches for the new window right after launching it and forcefully brings it
to the front — this works even if your browser is minimized, since the
agent is a separate program from your browser and keeps running regardless
of the browser's window state.

## Steam / OBS "not found" errors
The agent now checks several more places before giving up: their normal
default install folder (`C:\Program Files (x86)\Steam\steam.exe`, etc.),
the Windows registry (for Steam specifically), and then a folder search
across **every drive letter**, not just your `C:` drive — so an install on
`D:\Steam` or `D:\SteamLibrary` is now found too. If your install is
somewhere unusual, add the exact path to `KNOWN_PATH_HINTS` near the top of
`maximus_agent.py`.

If the agent isn't running, Maximus will tell you instead of silently
failing, e.g. *"I can't reach the Maximus Desktop Agent on this computer.
Start it first..."*

## Windows: apps opening but not popping to the front
Windows normally blocks background processes (like this agent) from
stealing focus, so newly opened windows could sit behind everything else
until you clicked the taskbar. The agent now calls Windows'
`AllowSetForegroundWindow` before every launch so new windows actually pop
to the front. If a specific app still opens behind others, it's usually
that app's own splash/loading behavior (common for Steam and Epic Games
Launcher on first load) rather than something Maximus can control.

## Notes & limits
- **Windows** has the fullest support (Task Manager, `ms-settings:`, Recycle
  Bin, etc. are Windows-specific concepts). macOS and Linux equivalents are
  included (Activity Monitor, System Settings/Preferences, Trash,
  `gnome-system-monitor`, etc.) but may need an app installed for full
  coverage.
- **Steam / Epic Games / OBS / Free Download Manager** are launched by their
  registered install name (e.g. `steam.exe`, `com.epicgames.launcher://`).
  This works out of the box on a normal install; if yours is installed to a
  non-standard location, edit the `APP_MAP` dict near the top of
  `maximus_agent.py` and point it at the full `.exe` path instead.
- The agent only binds to `127.0.0.1` (this computer only) — nothing on
  your network can reach it.
- `open-app` only launches apps from the built-in whitelist in
  `maximus_agent.py` (edit that dict to add your own favorites) or anything
  already recognized on your system PATH — it never runs an arbitrary
  command string sent from the browser.
- `create-file` / `create-folder` only ever write inside your Desktop
  folder, and strip anything (`..`, `/`, `\`) that could point outside it.
- "Empty recycle bin" permanently deletes everything in it — there's no
  undo, same as doing it manually.
- To have the agent start automatically with your computer, add
  `python maximus_agent.py` to your OS's startup apps/login items — that
  part is OS-specific and not automated here.