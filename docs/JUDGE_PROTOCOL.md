# Judge protocol (server <-> judge workers)

Workers **pull** jobs over HTTP. They only make outbound requests, so a worker
can sit behind NAT / on a different network as long as it can reach the server
URL (an IP like `http://203.0.113.5:8080` or a tunnel hostname).

All `/judge/**` calls carry header `X-Worker-Token: <app.judge.worker-token>`
(server env `APP_JUDGE_WORKER_TOKEN`). No JWT.

## Claim (long poll)
`POST /judge/claim?workerId=judge-1&version=1.0&wait=20`
- `204` nothing queued after `wait` seconds (worker loops)
- `200` job:
```json
{ "id":"<uuid>", "kind":"SUBMIT|RUN", "language":"C|CPP|JAVA|PYTHON",
  "sourceCode":"...", "timeLimitMs":2000, "memoryLimitKb":262144,
  "checker":"EXACT", "attempt":1,
  "stdin":"...",                                   // RUN only
  "testcases":[{"id":"<uuid>","ordinal":1,"input":"...","expected":"...","points":10}] // SUBMIT only
}
```
The job is leased for `app.judge.lease-seconds` (90). No result in time => re-queued
(max 3 attempts, then verdict `IE`).

## Result
`POST /judge/jobs/{id}/result` (`409` if the lease was lost: discard your result)
```json
{ "workerId":"judge-1",
  "compile": { "ok": true, "output": "" },
  "tests": [ { "testcaseId":"<uuid>", "verdict":"AC|WA|TLE|MLE|RE|IE",
               "timeMs":12, "memoryKb":3400, "points":10, "stdout":"first 500 chars" } ],
  "stdout":"", "stderr":"", "exitCode":0, "timeMs":0, "verdict":"OK|CE|TLE|MLE|RE",   // RUN only
  "systemError": "docker unavailable"      // optional: server re-queues (or IE after 3 tries)
}
```
Server computes: overall verdict (all AC => AC, else first failing), score
(ICPC = all-or-nothing of the contest-problem points, IOI = proportional),
`submissions.status/verdict/score/runtime_ms/memory_kb`, and `submission_results` rows.

## Student endpoints
- `POST /runs {language, sourceCode, stdin, problemId?}` -> `202 {id}` (max 2 open runs per user)
- `GET  /runs/{id}` -> `{status: QUEUED|RUNNING|DONE, result?}`
- `POST /submissions` (existing) now also enqueues a SUBMIT job.

## Teacher
- `GET /admin/judge/workers` -> `{workers:[{workerId,host,online,jobsDone,...}], queue:{queued,running}}`

## Lease extension
`POST /judge/jobs/{id}/extend?workerId=judge-1` -> `200` (lease renewed) or `409` (lease lost: abandon the job).
Workers call it every 30 s while judging.
