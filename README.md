# Coding Exam Platform

Teachers build exams in a web console; students take them in a locked-down Windows app; code is judged by Docker workers. The three clients and the judge workers all connect to one server address, so they can be on different networks.

| Folder | What | Stack |
|---|---|---|
| `server/` | API, auth, contests, submissions, judge queue | Java 21, Spring Boot, Postgres (Flyway) |
| `teacher-ui/` | create problems/testcases, exams, students; live standings; judge status | React + Vite |
| `student-app/` | exam client: Monaco editor, run/submit, timer, kiosk | Electron (Windows installer) |
| `judge/` | two workers (judge-1, judge-2) that pull jobs and run code in isolated Docker containers | Node 18+, Docker |
| `watchdog-linux/` | Linux integrity watchdog bundled in the student app (process kill, signed event chain). See `docs/LINUX.md`; build with `./build-linux.sh` | Node |
| `watchdog/`, `kiosk/` | original Windows lockdown service and plans (not wired into the new student app yet) | C# |
| `docs/` | `NETWORKING.md`, `API_ENDPOINTS.md`, `JUDGE_PROTOCOL.md`, `E2E_CHECKLIST.md` | |
| `tools/` | `integration-test.mjs`: drives a real server end to end | Node |

**New here? Read `docs/RUNNING.md` (step by step) and `docs/STATUS_REPORT.md` (what works, what is pending).**  
**Windows evaluator demo:** see [`WINDOWS_DEMO_SETUP.md`](WINDOWS_DEMO_SETUP.md) for a ready-to-run local setup (includes prefilled `server/.env` demo values).

## Quick start
1. **Server**: `cd server && cp .env.example .env` (set secrets) `&& docker compose up -d --build`
2. **Judge workers** (a machine with Docker): `judge/start-workers.sh http://<SERVER>:8080 <WORKER_TOKEN>` (Windows: `start-workers.ps1`)
3. **Teacher UI**: `cd teacher-ui && npm install && npm run dev`, open it, type the server address, create the first teacher account.
4. **Student app**: `cd student-app && npm install && npm run dist` (on Windows), install the .exe on student PCs.
5. **Check everything**: `node tools/integration-test.mjs http://<SERVER>:8080`, then `docs/E2E_CHECKLIST.md`.

Reaching the server from other networks (port-forward, Cloudflare Tunnel, Tailscale, HTTPS): `docs/NETWORKING.md`.

## Typical exam
Problems (with testcases) -> Students (paste CSV) -> Exam: add problems, enroll students, Publish -> Start when the room is ready -> students open it and the timer runs from the server clock -> watch Standings/Submissions -> End (or it ends at the time limit).

## Tests
`cd judge/worker && npm test` (workers vs mock server) | `cd student-app && npm test` (renderer, needs Playwright) | `teacher-ui`: `npm run mock` for a fake API | `tools/integration-test.mjs` (real server).
