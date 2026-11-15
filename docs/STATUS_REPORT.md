# Exam Platform: status report (11 Nov 2026)

## 1. What this is
Teachers build exams in a web console. Students take them in a locked-down desktop app (Monaco editor, Run/Submit, timer). Code is judged by two Docker workers. Everything connects outbound to one server address, so parts can sit on different networks.

| Part | Folder | Stack |
|---|---|---|
| Server | `server/` | Java 21, Spring Boot 4.1.1, PostgreSQL 16, Flyway, Hibernate 7 |
| Teacher UI | `teacher-ui/` | React + Vite |
| Student app | `student-app/` | Electron (Windows installer; also runs on Linux for testing) |
| Judge workers | `judge/` | Node 18+, Docker (gcc:13, eclipse-temurin:21-jdk, python:3.12-slim) |

## 2. Verification levels
**VERIFIED on a real machine** (Ubuntu 24.04, by the tester, using the real server and Docker):
- Docker/Compose startup, PostgreSQL, Spring Boot, Flyway (schema version 2, 14 tables)
- Teacher login, student creation, problem creation, exam creation, add problem, assign student, publish
- Student login, exam visible in the student app, backend connection check
- Two judge workers online; Docker images pulled
- C++ Run with custom input; C++ Submit judged by a worker with verdict AC, score 100

**VERIFIED only against mocks** (automated, headless): student-app interface (15 steps), judge-worker protocol (10 cases including Python/C/C++/Java in process mode), teacher UI flow.

**WRITTEN, NOT YET RUN anywhere:** see section 5 (pending tests).

## 3. Changes made by the tester's debugging session (now merged into this zip)
| File | Change | Why |
|---|---|---|
| `server/pom.xml` | `flyway-core` replaced by `spring-boot-starter-flyway` | Spring Boot 4 no longer auto-runs Flyway with the bare core artifact |
| `config/SecurityConfig.java` | `GET /time` is public | the student app checks reachability before login |
| `model/Policy.java` | `@JdbcTypeCode(SqlTypes.JSON)` on `json` | publishing failed: jsonb column vs varchar parameter |

## 4. Changes made in this release
| Area | Change |
|---|---|
| `model/Event.java` | Same JSONB fix as Policy on `payloadJson`. It would have failed the first time events were stored. |
| Student app | **Run with empty input now uses the problem's first sample input** and shows the expected output beside the result. Typed input always wins. Submissions are unchanged. |
| Student app tests | New test for the sample-input behavior; one test fixed (mock exam clock now starts when the exam is opened). 15 of 15 pass. |
| Server/UI (earlier) | Standings penalty and tie-break; per-exam language restriction; policy endpoint returns a plain map; teacher/admin endpoints; first-teacher register gate. |
| Docs | `docs/RUNNING.md` (step-by-step for Linux and Windows), this report, README links. |

## 5. Pending work
### 5.1 Tests nobody has run yet (do these first, in this order)
1. Multiple test cases on one problem (add 3 to `Add Two Numbers`, mark one hidden).
2. Verdicts: WA, CE (compiler text shown), RE, TLE, MLE.
3. Python and Java submissions (Java class must be `Main`).
4. Exam workflow: Start button, timer from server clock, finishing manually, auto-end at time up, no access before start, no submissions after end, restart mid-exam.
5. Judge reliability: both workers take jobs, simultaneous submissions, kill a worker mid-job (job is re-queued after 90 s lease, up to 3 attempts), reconnect.
6. Security: student blocked from teacher endpoints (403), cannot read other students' submissions, hidden tests never shown, expired token rejected.
7. `node tools/integration-test.mjs http://localhost:8080` (automates most of 1, 2, 3 and 6).
8. Sandbox safety: infinite loop, huge memory allocation, fork bomb, network access from submitted code.
9. Real use from another network (Cloudflare Tunnel, see `docs/NETWORKING.md`).
10. Windows: `npm run dist` installer, kiosk mode (`npm start`), Monaco editor inside Electron.

### 5.2 Known gaps (not built)
| Gap | Impact |
|---|---|
| ~~Focus-loss and paste events are counted in the app only~~ **Linux: now sent** (watchdog-linux, see `docs/LINUX.md`). Windows build still not wired | teacher UI has no integrity view yet |
| Windows watchdog service and event hash chain not connected to the student app | Electron cannot block the Windows key or Ctrl+Alt+Del |
| `memoryKb` always reported as 0 | MLE only detected via Docker OOM kill |
| `/runs` (custom runs) does not check the exam's allowed languages | students can run a disallowed language, but not submit it |
| An ended session cannot be reopened | a student whose session ended by mistake needs a new exam or DB fix |
| `ddl-auto` is `none`; entities are not checked against the schema | schema mismatches show up only at runtime |
| Compile errors for CE are read from `judge_jobs.result_json` | fine, but rows are not cleaned up |
| Default secrets in `application.properties` | must be overridden by `.env` before real use (compose does this) |

### 5.3 Risks to watch
- Java code compiled successfully in the tester's Docker build, but only paths exercised so far are known to work; the rest (standings penalty, languages SQL, student reset password, bulk import) should be checked in the browser.
- Docker sandbox on Windows hosts (`--mount` paths) is untested.

## 6. Rules for continuing (from the tester)
Never run `docker compose down -v` (it deletes the database). Do not share `.env` secrets. Change one component at a time and rebuild only that component.
