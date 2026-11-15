# API summary for the teacher UI and student app (JWT: `Authorization: Bearer <accessToken>`)

All responses below are plain JSON (no JPA entities). Timestamps are ISO-8601 UTC strings.

## Auth
- `POST /auth/login {username,password}` -> `{accessToken, refreshToken, user:{id,username,role,fullName}}`
- `POST /auth/register {username,password}` -> first teacher can self-register; afterwards teacher-only (min 8 chars)

## Teacher
| Method & path | Purpose |
|---|---|
| `GET /problems` | list (`id,title,statementMd,timeLimitMs,memoryLimitKb,checkerType,testcaseCount`) |
| `POST /problems {title,statementMd,timeLimitMs,memoryLimitKb,checkerType}` | create (checker `EXACT` or `TOKEN`) |
| `POST /problems/{id}/testcases {inputRef,expectedRef,points,isSample,groupNo}` | add (`inputRef`/`expectedRef` are the literal text) |
| `GET /problems/{id}/testcases`, `DELETE /problems/{id}/testcases/{tcId}` | list / remove |
| `GET /contests` | list with `problemCount`, `enrolledCount` |
| `POST /contests {title,durationSec,scoringMode(ICPC|IOI)}` | create (DRAFT) |
| `POST /contests/{id}/problems {problemId,label,points}` | add problem (DRAFT only) |
| `GET /users?role=STUDENT` | list students |
| `POST /users/students/bulk {students:[{username,password,fullName,studentRef}]}` | -> `{created,skipped}` |
| `POST /users/{id}/password {password}` | reset |
| `POST /contests/{id}/enroll {userIds:[...]}` / `DELETE /contests/{id}/enroll/{userId}` | add / remove students |
| `POST /contests/{id}/publish` | DRAFT -> SCHEDULED (builds signed policy) |
| `POST /contests/{id}/start` / `/stop` | SCHEDULED -> RUNNING (sets start/end from duration) / RUNNING -> ENDED. Also auto-ends at `endsAt`. |
| `GET /contests/{id}/detail` | contest + problems + enrolled students |
| `GET /contests/{id}/submissions`, `GET /contests/{id}/standings` | monitoring |
| `GET /contests/{id}/sessions` | one row per enrolled student: `{userId, username, fullName, sessionId, status (NOT_STARTED if none), startedAt, endedAt, lastHeartbeatAt, events, suspicious, byType{TYPE:n}, lastEventAt, lastWdHeartbeatAt}` |
| `GET /events?sessionId=` | stored events of a session, oldest first: `{seq,type,severity,ts,payloadJson,hash,receivedAt}` (students: own session only) |
| `GET /events/suspicious?sessionId=` | `{suspiciousEvents}`; counted types: PASTE, FOCUS_LOST, TAB_SWITCH, SCREENSHOT_ATTEMPT, PROCESS_BLOCKED, KIOSK_EXIT_ATTEMPT, APP_EXITED |
| `GET /admin/judge/workers` | judge workers + queue |

## Student
- `GET /time` -> `{now}` (sync the exam timer)
- `GET /contests/mine`; `GET /contests/{id}` (problem list, requires enrollment)
- `GET /problems/{id}?contestId=` (statement + sample testcases)
- `POST /sessions/start {contestId,deviceFp,clientVersion}` -> `{id,status,...,sessionKey}` (`sessionKey` = 64-hex per-session event-signing key, sent only here; the student app's main process keeps it and never passes it to the page); `POST /sessions/{id}/heartbeat {seq}`; `POST /sessions/{id}/end`
- `POST /runs {language,sourceCode,stdin,problemId?}` -> `{id}`; poll `GET /runs/{id}`
- `POST /submissions {sessionId,contestId,problemId,language,sourceCode}` -> `{id,status}`; poll `GET /submissions/{id}` -> verdict, score, `tests[]`, `compileOutput` on CE
- `GET /submissions?contestId=` my submissions

Languages: `C`, `CPP`, `JAVA` (class must be `Main`), `PYTHON`.


## Changes in chunk 7
- `GET /sessions/{id}/policy` now returns `{policyId, version, json, signature (base64), issuedAt}` instead of the JPA entity.
- `GET /contests/{id}/standings` rows now include `penaltyMin` (minutes from contest start to each first AC, plus 20 per non-CE wrong attempt before it). Order: score, solved, lower penalty.
- `PUT /contests/{id}/languages` (teacher) body `{"languages":["CPP","PYTHON"]}`, only while DRAFT or SCHEDULED. Contest objects from `/contests`, `/contests/{id}/detail` and `/contests/mine` now carry `languages` (all four by default). `POST /submissions` returns 400 for a language the exam does not allow.


## Event ingest (chunk 3)
`POST /events/ingest {sessionId, events:[{seq,type,severity,ts,payloadJson,prevHash,hash,hmac}]}` (student, own ACTIVE session, max 200 events) -> `{accepted, duplicates, nextSeq}`.
Rules (all-or-nothing per request): `seq` = last stored + 1 (first is 0); `prevHash` = hash of the previous event (first is 64 zeros); `hash = SHA256(prevHash + canonical({type,severity,ts,payload}))`, recomputed by the server from the received text; `hmac = HMAC-SHA256(sessionKey, hash)`; `ts` must be `yyyy-MM-ddTHH:mm:ss.SSSZ`. An event whose seq is already stored is skipped only if its hash is identical (retry after a lost response). Any violation -> **400 `INTEGRITY_VIOLATION`**, nothing from that request is stored; the watchdog treats 400/403/404/409 as final and keeps its copy on disk.
`sessionKey = HMAC-SHA256(APP_INTEGRITY_SECRET, sessionId)` (hex). Migration `V3__event_integrity.sql` turns `events.type/severity` into plain strings (the V1 enum had none of the watchdog types) and adds `payload_raw` (exact signed text; `payload_json` is JSONB and re-orders keys).
