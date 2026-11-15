# Exam Client (student app, Windows)

Electron app: server connection, login, exam list, HackerRank-style exam screen (problem + samples, Monaco editor, C/C++/Java/Python, Run with custom input, Submit with per-test results, timer, My submissions), kiosk lockdown.

## Run / build
```
npm install          # electron, electron-builder, monaco-editor
npm run dev          # windowed, devtools on, no kiosk
npm start            # real exam mode (fullscreen kiosk while an exam is open)
npm run dist         # run on Windows -> dist/Exam Client Setup x.y.z.exe (NSIS installer)
```
Student PCs need no Node/Java: install the .exe, open it, type the server address once (remembered).

## Server address
Typed on the first screen and stored in `%APPDATA%/exam-student/config.json`. To pre-fill it for a lab, put it in `defaults.json` (`{"serverUrl":"http://192.168.1.50:8080"}`) before `npm run dist`, or start with `--server=http://host:8080`. All requests are made by the app's main process, so no CORS setup is needed and any reachable address works (LAN IP, public IP, Cloudflare Tunnel or Tailscale hostname).

## Exam mode
Kiosk fullscreen, always on top, no minimize or close, reload/devtools/close shortcuts blocked, window-focus loss counted and shown, paste limited to text copied inside the app, drag-drop off, drafts autosaved locally per problem and language. Electron cannot block the Windows key or Ctrl+Alt+Del; the existing watchdog service is the place for that.

## Test without Electron or a server
`node test/mock-server.mjs` is a fake server (student1 / studentpass). `PLAYWRIGHT_MODULE=<path to playwright> npm test` drives the renderer in headless Chromium against it (14 steps).
