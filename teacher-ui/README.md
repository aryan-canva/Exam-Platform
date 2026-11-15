# Teacher UI (Exam Desk)

React + Vite web console for teachers: problems with testcases, exams (add problems, enroll students, publish, start, end), live standings and submissions, bulk student creation, and judge-worker status.

## Run
1. `npm install`
2. `npm run dev` (port 5173, reachable from other devices on the network), or `npm run build` and serve `dist/` with any static host.
3. Open the page and type the **server address** on the login screen (e.g. `http://192.168.1.50:8080`, or a tunnel hostname such as `https://exam.example.com`). Press Test to check it. The address is remembered in the browser. `.env` `VITE_SERVER_URL` is only the default.

First run: use "Create the first teacher account" (password at least 8 characters). After that, only a logged-in teacher can create more.

## Server side
- CORS: set `app.cors.allowed-origins=http://<teacher-pc>:5173` (or your hosting origin) in `server/src/main/resources/application.properties`; the default `*` also works.
- Open port 8080 on the server machine, or use a tunnel (see `docs/NETWORKING.md`).

## Try it without the server
`npm run mock` starts a fake in-memory API on port 8080 (login: any username, password `teacherpass`).

## Integrity tab
Exam page -> Integrity: one row per enrolled student (session status, event count, suspicious count, last watchdog heartbeat). Rows with no `WD_HEARTBEAT` for more than 2 minutes while the session is ACTIVE are flagged and sorted first. Click a student for the timeline (`GET /events?sessionId=`): suspicious events highlighted, heartbeat gaps shown inline, filters for heartbeats / suspicious-only. "Now" is the server's clock (`GET /time`), not the teacher PC's. `npm run mock` seeds demo sessions when you start an exam (one healthy, one with stopped heartbeats and suspicious events, one not started, one ended).

## Tests
`npm test` runs the gap/summary logic tests and drives the mock server over HTTP. It does not render React (no browser here).

## Typical flow
Problems: create, add testcases (tick "sample" for ones students may see) -> Students: paste CSV -> Exams: new exam, add problems, enroll students, Publish -> Start exam when the room is ready -> watch Standings/Submissions -> End exam.
