# Linux student app + watchdog

## What the watchdog does
`watchdog-linux/` is a small Node program the student app starts itself (no root, no separate install).
It runs only while an exam session is open and:

| Job | How |
|---|---|
| Kill forbidden programs | polls `/proc` every 250 ms; browsers, terminals, IDEs, chat, remote-desktop, screen-capture and local compilers (list: `DEFAULT_DENY` in `lib/procmon.js`) are killed and reported as `PROCESS_BLOCKED`. Programs already open at exam start are reported `when: present_at_start` |
| Never touch the app | the app, the watchdog and their children are protected |
| Report app events | `FOCUS_LOST/BACK`, `PASTE` (blocked outside paste), `KIOSK_EXIT_ATTEMPT` (close/minimize/leave-fullscreen). The app cannot send any other type |
| Signed evidence | every event is chained: `hash = SHA256(prevHash + canonical{type,severity,ts,payload})`, `hmac = HMAC(sessionKey, hash)`, `seq` from 0; `sessionKey` is the **server's** per-session key (from `POST /sessions/start`, kept by the app's main process, never written to disk by the watchdog); stored on disk first, then uploaded to `POST /events/ingest` |
| Survive trouble | server down: queued and retried (backoff); token expired: waits for the app's refreshed token; watchdog killed: app respawns it, chain continues (`WATCHDOG_RESUMED`); app killed: `APP_EXITED` is recorded and flushed |
| Proof of life | `WD_HEARTBEAT` every 60 s: a gap in the teacher's timeline means the watchdog was stopped |

Order at the end of an exam: flush events -> `POST /sessions/{id}/end` -> `WATCHDOG_STOPPED` (the server only accepts events while the session is ACTIVE).

`windowed`/`--windowed` (dev) runs the watchdog in **LOG** mode: it reports but never kills. Real kiosk runs kill.
Config in `defaults.json` / `config.json`: `requireWatchdog` (true = refuse to open an exam if the watchdog cannot start), `watchdogMode` (`kill` | `log`). Flag `--no-watchdog` disables it.

## Build (needs internet)
```bash
./build-linux.sh        # tests, npm install, AppImage + .deb in student-app/dist/
sudo apt install ./student-app/dist/exam-client-0.1.0-amd64.deb     # or run the .AppImage
```
Run: `exam-client` (deb) or `./exam-client-*.AppImage`; optional `--server=http://<SERVER>:8080`.

## Run from source (no packaging)
```bash
cd student-app && npm install && npm start            # kiosk, kill mode
npm run dev                                           # windowed, LOG mode
```

## Kiosk caveats on Linux
* Use an **X11 session** (Ubuntu login screen -> gear -> "Ubuntu on Xorg"). Under Wayland, global shortcut blocking (Alt+Tab etc.) does not work.
* Ubuntu 24.04 AppImage: the app switches Chromium's setuid sandbox off automatically (`APPIMAGE` is set). The `.deb` keeps it.
* A user with a terminal and `kill` rights can still stop the watchdog; the app respawns it and the teacher sees `WATCHDOG_RESUMED` / a heartbeat gap. Running it as a root systemd service is the next hardening step (not built).
* The Windows watchdog (C#, `watchdog/`) is still not connected to the Windows build.

## Tests
```bash
cd watchdog-linux && npm test                 # 22: chain vs Python vector, journal, /proc monitor + kills, server ingest rules
cd student-app   && npm run test:watchdog     # 18: real watchdog process + client + main.js IPC vs mock server (server rules mirrored from EventService)
```
Not covered here: Electron itself, `npm run dist:linux`, a real display (kiosk), real server.
