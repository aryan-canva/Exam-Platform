# Judge host

Two (or more) workers run on any machine with Docker + Node 18+. They only make
**outbound** HTTP calls to the exam server, so the judge host can be on a different
network from the server (NAT is fine) as long as it can reach the server's URL.

```bash
# Linux / macOS
./start-workers.sh http://<SERVER_IP>:8080 <WORKER_TOKEN>
# Windows (Docker Desktop)
.\start-workers.ps1 -Server http://<SERVER_IP>:8080 -Token <WORKER_TOKEN>
```
`<WORKER_TOKEN>` must equal the server's `APP_JUDGE_WORKER_TOKEN` (default `dev-worker-token`: change it).
Run on separate machines for real redundancy: `node worker/worker.js --server ... --id judge-3 --token ...`.
First start pulls `gcc:13`, `eclipse-temurin:21-jdk`, `python:3.12-slim`.

## Sandbox (per submission)
- compile in a throw-away container (1 GB, 30 s, no network), then run all testcases in a second container:
  `--network none`, `--memory/--memory-swap` = problem limit, `--pids-limit 64`, `--cpus 1`,
  `--read-only` rootfs + 16 MB tmpfs, code mounted read-only, `--cap-drop ALL`, `no-new-privileges`, user `nobody`.
- per test: `docker exec ... timeout -s KILL <limit>`; the fixed `docker exec` overhead is measured and subtracted.
- Time factors: Java x2, Python x2 (env `TIME_FACTOR_JAVA`, `TIME_FACTOR_PYTHON`). Java class must be `Main`.
- `SANDBOX=process` (dev/tests only) runs code on the host. NEVER use it for real exams.

## Tests
`cd worker && npm test` : mock server + 2 worker processes; covers AC/WA/TLE/RE/CE, RUN, C/C++/Python (+Java if javac exists).
