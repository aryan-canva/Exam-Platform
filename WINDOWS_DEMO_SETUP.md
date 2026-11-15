# Windows demo setup (evaluator)

This repo is prepared to run as a local demo on Windows using Docker Desktop for the server/database and Node.js for the teacher UI, judge workers, and student app.

## Prerequisites
- **Docker Desktop** (running, with `docker compose` available)
- **Node.js 18+** (`node -v`, `npm -v`)
- Windows PowerShell
- Internet access on first run (Docker image pulls, npm installs, Electron download for student app)

> You do **not** need Java/Maven installed locally; the server builds inside Docker.

## 1) Start server + database
```powershell
cd .\server
# server/.env is prefilled with local demo values. Edit if you want different secrets.
docker compose up -d --build
```
Check:
```powershell
curl http://localhost:8080/time
# or open http://localhost:8080/time in a browser -> {"now":"..."}
```
If it fails: `docker compose logs server --tail 100`

## 2) Start teacher UI
Open a new terminal:
```powershell
cd .\teacher-ui
npm install
npm run dev
```
Open the shown URL (usually `http://localhost:5173`).
- Set server address to `http://localhost:8080` and press **Test**
- Create the first teacher account, then log in

## 3) Start judge workers (required for Run/Submit judging)
Open a new terminal:
```powershell
cd .\judge
.\start-workers.ps1 -Server http://localhost:8080 -Token dev-judge-worker-token-12345
```
If script execution is blocked:
```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-workers.ps1 -Server http://localhost:8080 -Token dev-judge-worker-token-12345
```
> The token must match `APP_JUDGE_WORKER_TOKEN` in `server/.env`.
> First start pulls Docker images for C/C++, Java, and Python sandboxes.

Check in Teacher UI -> **Judge** tab: `judge-1` and `judge-2` should appear online.

## 4) Start student app (demo mode)
Open a new terminal:
```powershell
cd .\student-app
npm install
npm run dev
```
`npm run dev` opens a normal window (safe for demo). `npm start` launches locked-down kiosk mode.
- Enter server `http://localhost:8080`, press **Test**, and log in as a student created from the teacher UI.

## 5) Quick demo flow (teacher UI)
1. **Students**: add e.g. `student1,pass1234,Asha Verma,R001`
2. **Problems**: create a problem and add testcases (mark at least one sample, keep others hidden)
3. **Exams**: create exam, select languages/problem, enroll student, **Publish**, then **Start**
4. **Student app**: open exam, Run sample, Submit code; verify verdict/score
5. **Teacher UI**: check Standings/Submissions/Judge status

## Optional checks
- End-to-end test (needs server + workers running):
  ```powershell
  node .\tools\integration-test.mjs http://localhost:8080
  ```
- Build Windows installer for student PCs:
  ```powershell
  cd .\student-app
  npm install
  npm run dist
  ```
  Installer output: `student-app\dist\` (configure `student-app\defaults.json` before building if needed).

## Stop / reset
- Stop server stack: `cd server; docker compose down` (keeps DB data)
- **Do not** use `docker compose down -v` unless you want to delete the database/keys.
- Close the judge worker terminal windows to stop workers.

## Windows integrity/watchdog behavior (implemented in student app)
- **`npm run dev` (windowed):** safe for local testing. App-level monitoring/blocking is relaxed so you can develop.
- **`npm start` (kiosk exam mode):** enables stricter exam behavior:
  - records focus loss/return and kiosk-exit attempts as signed events sent to the server (`/events/ingest`, hash-chained/HMACed per session)
  - blocks external paste (records `PASTE` events), blocks many shortcuts/navigation/context menu, and keeps the exam window foregrounded
  - **best-effort app blocking on Windows:** periodically scans running processes and attempts to terminate common disallowed apps (browsers, chat/collab, remote/streaming tools) and records `PROCESS_BLOCKED` events
- **Limitations:** this is not a kernel/OS-service lockdown. It cannot guarantee prevention of all OS-level task switching (e.g. some system shortcuts/gestures) or all external apps, and it is separate from the legacy `watchdog/` C# service and `kiosk/` folder. For a strong demo, run the student app with `npm start`, keep Docker/Teacher UI/Judge running, and show recorded events in the teacher/exam session event views (or via API).
- Judging requires Docker Desktop and the judge workers to be running.
- If ports `8080` or `5173` are already in use, stop the conflicting app or change the config/ports accordingly.
- See `docs/RUNNING.md`, `docs/STATUS_REPORT.md`, `docs/NETWORKING.md`, and `docs/E2E_CHECKLIST.md` for more details.