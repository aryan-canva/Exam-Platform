# Coding Exam Platform and Lockdown System (Team SAAD BUGS)

Locked-down coding exam environment: Windows kiosk + SYSTEM watchdog, exam server, Judge0 judging, tamper-evident event log.

## Start here
1. `docs/HOUR0.md`: the first-hour checklist.
2. `docs/stubs.md`: run the stub server so everyone can build in parallel.
3. `docs/canonical-json.md` + `shared/test-vectors/`: the Java/C# byte-compatibility contract.
4. `docs/openapi.yaml`: the API contract. `docs/class-diagrams.md` (and PDF): the design.

## Layout
| Folder | Owner | What |
|---|---|---|
| `server/` | P1 (+P3 session/integrity, P4 submissions) | Java 21 + Spring Boot |
| `watchdog/` | P2 lockdown, P3 events/IPC | C# Windows Service |
| `kiosk/` | P4 | WPF + WebView2 |
| `web/` | P4 (timeline page P3) | React + Vite |
| `judge/` | P4 | Judge0 (Docker, Linux) |
| `stubs/mock-server/` | all | zero-dependency stub of the API |
| `shared/test-vectors/`, `tools/` | P1 + P3 | contract tests and reference implementation |
| `scripts/` | P2 install/restore, all demo | PowerShell/bash helpers |

## Quick commands
```bash
python tools/verify_vectors.py          # contract vectors self-check
node stubs/mock-server/server.js        # stub API on :8080  (student1 / password)
node stubs/mock-server/selftest.js      # run against stub or real server (BASE=http://host:8080)
docker compose up -d db                 # app database
cd judge && docker compose up -d        # Judge0 (Linux, cgroups v1)
```

## Rules
- One feature per branch (`p2/process-monitor`), PR into `main`, one review.
- Never run the Watchdog on your own PC. Use the Windows VM with a `clean` snapshot.
- Change the API or canonical-JSON rules only via a PR everyone approves.