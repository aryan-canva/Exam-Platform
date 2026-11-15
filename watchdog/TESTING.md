# Watchdog service – implementation and testing guide

This document covers the **Windows watchdog service** in `watchdog/` (process lockdown, signed event pipeline, session/control lifecycle) and how to test each function/module.

> **Safety:** Do **not** run lockdown/enforcement on your personal/main PC. Use a Windows VM/snapshot (or a disposable test machine) as noted in the repo docs, especially when testing process killing, firewall/USB/shell changes, or running as a Windows Service.

## 1. Prerequisites

- Windows 10/11 (recommended for full lockdown/OS integration tests)
- .NET SDK matching the projects (`net10.0` target in current csproj files) and Visual Studio 2022+ or `dotnet` CLI
- **Administrator/elevated terminal** for: WMI process-start monitoring, process termination of protected targets, firewall/USB/shell changes, Windows Service install/start
- Exam server running (for end-to-end event ingestion/session tests): see `docs/RUNNING.md` and `WINDOWS_DEMO_SETUP.md`
- Optional: `curl` / PowerShell `Invoke-RestMethod` for control API testing

Build:
```powershell
cd watchdog
dotnet restore Watchdog.slnx
dotnet build Watchdog.slnx -c Debug
```

Run all automated tests (unit + integration-marked tests in this solution):
```powershell
cd watchdog
dotnet test Watchdog.slnx -c Debug
```
> Some tests (e.g. real WMI integration) may require elevation/Windows and may be skipped/fail in non-admin environments by design.

## 2. Project layout (key code)

- `src/Watchdog/Lockdown/`
  - `ProcessTypes.cs` – `AllowedProcess`, `PolicyAction`, `ProcInfo`, `Decision`
  - `AllowlistMatcher.cs` – pure allow/block decision rules, hashing/signer hooks, trusted OS locations
  - `WindowsProcessApi.cs` – real OS adapter (WMI start events, snapshots, kill, path/session lookup)
  - `ProcessMonitor.cs` – `Start/Stop/OnProcessStart/IsAllowed/Terminate/UpdateAllowlist`, sweep/coalescing, event emission
  - `FirewallManager.cs` – best-effort firewall lockdown/restore (netsh, Windows/admin)
  - `UsbController.cs` – USB storage disable/restore (registry, Windows/admin)
  - `ShellLockdown.cs` – task-manager/shell policy lockdown/restore (registry)
- `src/Watchdog/Events/`
  - `CanonicalJson.cs` – deterministic JSON serialization for payload hashing
  - `ServerEventChain.cs` – server-compatible `hash/hmac/seq/prevHash` rules
  - `EventJournal.cs` – append-only JSONL journal + ack tracking (persisted per session)
  - `ServerEventSink.cs` – thread-safe signed event builder implementing `IEventSink`/`IStringEventSink`
  - `EventUploader.cs` – batched uploader to `POST /events/ingest`
- `src/Watchdog/Policy/PolicyClient.cs` – fetch/parse exam policy (server or fallback defaults)
- `src/Watchdog/State/RestoreAll.cs` – persisted restore-state for reversible system changes
- `src/Watchdog/Service/`
  - `WatchdogOptions.cs` – configuration model (`appsettings.json` -> `Watchdog` section)
  - `WatchdogServerClient.cs` – login/session start/heartbeat/end client
  - `SessionController.cs` – session lifecycle orchestration (policy + sink/uploader + monitor + OS modules)
  - `TeardownManager.cs` – idempotent teardown/restore coordination
  - `ControlApiHost.cs` – localhost HTTP control API for testing/automation
- `src/Watchdog/Program.cs`, `Worker.cs` – host/bootstrap, Windows Service option, control API startup, restore-on-start, optional auto-session
- `tools/Watchdog.Harness/` – standalone elevated harness to demo `process start -> ProcessMonitor -> signed event -> server`
- `stubs/watchdog/EventsStub.cs` – shared event contract (`IEventSink`, enums) linked into service
- `tests/Watchdog.Tests/` – automated tests (lockdown, harness/event chain, server/options tests)

## 3. Step-by-step: test each function/module

### 3.1 Lockdown types and allowlist logic (`ProcessTypes`, `AllowlistMatcher`, `IFileHasher/ISignerVerifier`)

**Functions/rules to verify:** critical OS process allow, policy allow by name+sha256/signer, deny if hash mismatch/renamed/wrong path, trusted Windows folders allowed except denied tools, extra denied names, full-path entries, unreadable file/hash, name-only behavior flag, signer fail-closed default.

**How to test**
1. **Automated (recommended):**
   ```powershell
   cd watchdog
   dotnet test Watchdog.slnx -c Debug --filter "FullyQualifiedName~AllowlistMatcher"
   ```
   - Inspect/extend: `tests/Watchdog.Tests/Lockdown/AllowlistMatcherTests.cs`
2. **Ad-hoc manual check in code/debugger:**
   - Instantiate `AllowlistMatcher` with a `FakeHasher`/`CachingFileHasher`, sample `OsBaseline`, and `AllowedProcess` entries.
   - Call `Evaluate(new ProcInfo(...))` / `IsAllowed` for cases: same-name renamed binary, binary in `System32` notepad vs allowed kiosk hash, session-critical `csrss.exe`, path-traversal/lookalike folder cases.
3. **Hasher behavior (`CachingFileHasher.Sha256Of`):**
   - Point to an existing file -> returns stable lower-case hex SHA-256.
   - Same path, unchanged size/mtime -> cached result reused.
   - Missing/unreadable file -> returns `null` (entry cannot match by hash).

**Expected:** decisions match rule priority; renamed/relocated binaries not matching hash/signer+path rules are blocked; unreadable hash cannot allow.

### 3.2 Windows process API adapter (`WindowsProcessApi`)

**Functions:** `QueryImage`, `GetSessionId`, `Snapshot`, `SubscribeProcessStarts`, `Kill`.

**How to test (Windows, elevated VM recommended)**
1. **Automated integration (if present/enabled):**
   ```powershell
   dotnet test Watchdog.slnx -c Debug --filter "FullyQualifiedName~ProcessMonitorIntegration"
   ```
   (`tests/Watchdog.Tests/Lockdown/ProcessMonitorIntegrationTests.cs`) – uses real WMI/elevation and scoped processes.
2. **Manual function checks (elevated PowerShell/C# interactive or quick harness):**
   - `Snapshot()` -> returns current processes with pid/name/path/session info.
   - `QueryImage(pid)` for a running process -> returns path+exists; for nonexistent pid -> indicates not existing.
   - `GetSessionId(pid)` -> valid session id or null.
   - `SubscribeProcessStarts(cb)` -> start `notepad.exe`; callback receives `ProcInfo` (WMI may deliver shortly after start). Dispose subscription to stop.
   - `Kill(pid, expectedImagePath)` -> kills target tree when path matches; returns `true` if already gone; **pid-reuse guard:** if `expectedImagePath` differs from current, it must not kill the reused process.

**Expected:** subscription requires admin/WMI; kill is safe-guarded; snapshot/query behave for existing and exited processes.

### 3.3 Process monitor (`ProcessMonitor`)

**Functions:** `Start`, `Stop`/`Dispose`, `OnProcessStart`, `IsAllowed`, `Terminate`, `UpdateAllowlist`, snapshot/sweep/coalescing behavior.

**How to test**
1. **Automated (primary):**
   ```powershell
   dotnet test Watchdog.slnx -c Debug --filter "FullyQualifiedName~ProcessMonitorTests"
   ```
   (`tests/Watchdog.Tests/Lockdown/ProcessMonitorTests.cs`, `TestSupport.cs`) covers: kill+report evidence, allow, exited-before-lookup, path resolution, extra denied, LOG mode, failed kill severity, sweep retry suppression for unkillable, sink-throw resilience, refused/empty/bare-name allowlists, subscribe failure, start-once/stop-idempotent, scope/session-0 handling, coalescing, allowlist update, etc.
2. **Real Windows behavior via Harness (recommended demo):**
   - Elevated terminal:
     ```powershell
     dotnet run --project tools/Watchdog.Harness -- --dry-run --watch notepad
     ```
     Start Notepad -> observe `PROCESS_BLOCKED` event emitted and local chain OK.
   - Block/terminate mode (VM only):
     ```powershell
     dotnet run --project tools/Watchdog.Harness -- --dry-run --watch notepad --kill --duration 60
     ```
     Start Notepad -> process terminated and event shows `killed=True` (subject to timing/rights).
3. **Scoped/dev-safe run:** use harness `--watch` to restrict enforcement to named processes (harness scopes by name and avoids touching others).

**Expected:** blocked processes generate `PROCESS_BLOCKED` with evidence and configured action; LOG/WARN do not kill; BLOCK kills when possible; coalesced repeats summarized; invalid/unsafe startup conditions throw.

### 3.4 Server-compatible event chain and serialization (`CanonicalJson`, `ServerEventChain`, `EventJournal`, `ServerEventSink`)

**Functions:**
- `CanonicalJson.Serialize/ToNode` – deterministic JSON
- `ServerEventChain.ComputeHash/ComputeHmacHex/DecodeSessionKey` – server-compatible integrity
- `EventJournal.Append/Tail/Pending/Ack` – durable queue state
- `ServerEventSink.Emit/SetAccessToken/Pending/Ack` – signed event creation implementing `IEventSink`

**How to test**
1. **Automated harness chain tests (existing):**
   ```powershell
   dotnet test Watchdog.slnx -c Debug --filter "FullyQualifiedName~EventChainTests"
   ```
   Note: `tests/Watchdog.Tests/Harness/EventChainTests.cs` validates the **harness** chain/canonical implementation in `tools/Watchdog.Harness` (different seq/field assumptions). Keep these passing for harness behavior.
2. **Manual verification of server-compatible chain (`ServerEventChain`):**
   - Create a temp state dir and a 32-byte session key.
   - Emit events via `ServerEventSink` and inspect produced `SignedServerEvent` fields:
     - `seq` starts at `0`, increments by 1
     - `prevHash` of first is 64 zeros, then previous `hash`
     - `hash == SHA256(prevHash + {"payload":<payloadJson>,"severity":"...","ts":"...","type":"..."})`
     - `hmac == HMAC-SHA256(sessionKey, hashHexText)`
     - `payloadJson` is canonical JSON text
   - Restart sink pointing to same journal/session -> `Tail()` resumes seq/prevHash correctly.
3. **Journal durability:**
   - Append events, read `LogPath` JSONL; simulate partial write/torn last line -> loader should drop torn line and continue.
   - `Ack(n)` persists to `.ack`; `Pending()` returns only unacked records.
4. **Compatibility check against server:**
   - Use running server and a real session key from `POST /sessions/start`; post generated events to `/events/ingest`.
   - Success (`accepted/nextSeq`) confirms format/signing compatibility; `IntegrityException`/400 indicates mismatch in payload canonicalization, ts format, key decoding, or chain order.

**Expected:** deterministic canonicalization, unbroken resumable chain, durable acking, server-accepted signed batches.

### 3.5 Event uploader (`EventUploader`)

**Functions:** `Start`, `StopAsync`, `FlushAsync`, batch ingest POST, ack advancement, retry/stop behavior on failures.

**How to test**
1. **Manual with local server:**
   - Start server and create an ACTIVE session (obtain `sessionId`, `sessionKey`, bearer token).
   - Instantiate `ServerEventSink` + `EventUploader`, `Start()` uploader, emit events.
   - Observe HTTP `POST {server}/events/ingest` succeeds and sink `PendingCount` drops.
   - Stop network/server temporarily -> uploader logs/warns and retains pending; restore -> retries and drains.
2. **Token update:** call `ServerEventSink.SetAccessToken(newToken)` and verify subsequent uploads use new bearer token.
3. **Final flush on shutdown:** enqueue events, call `StopAsync()` -> should attempt final flush.

**Expected:** batches (<=50) uploaded in order, ack advanced from response, transient failures retried later, uploader stops cleanly.

### 3.6 Policy client (`PolicyClient`, `ExamPolicy`)

**Functions:** `GetPolicyAsync`, `ParsePolicy`, `FromLocalDefaults`.

**How to test**
1. **Parse tests (manual/unit-style):**
   - JSON with `allowedProcesses` entries (`name`, optional `sha256`, `signer`), `forbiddenProcesses`, flags (`blockUsb`, `lockdownFirewall`, `shellLockdown`) -> parsed into `ExamPolicy`.
   - Wrapped policy `{ "json": { ... } }` -> inner object parsed.
2. **Server fetch fallback:**
   - Valid endpoint + token -> policy loaded.
   - Missing endpoint/401/500/network error -> returns fallback/local policy without crashing (logs warning).
3. **Defaults:** `FromLocalDefaults` adds `.exe`-normalized names and forbidden list.

**Expected:** tolerant parsing, safe fallback, usable allow/deny/flag outputs for `SessionController`.

### 3.7 Restore state (`RestoreAll`)

**Functions:** `Save`, `Load`, `HasPendingRestore`, `MarkClean`, persistence file behavior.

**How to test**
1. Create with temp `stateDir`; mutate via `Save` (firewall/usb/shell flags, previous values, `LockedAt`).
2. Recreate instance on same dir -> state reloaded, `HasPendingRestore` reflects flags.
3. `MarkClean()` -> state reset and file removed; `HasPendingRestore` false.
4. Corrupt JSON file -> constructor/load falls back to clean state.

**Expected:** durable, recoverable restore marker used to avoid leaving machine in modified state after crash/restart.

### 3.8 OS lockdown modules (`FirewallManager`, `UsbController`, `ShellLockdown`)

**Functions:** apply and restore for each module (Windows/admin-sensitive). All should be best-effort and update `RestoreAll`.

**How to test (Windows VM, elevated, snapshot before changes)**
1. **FirewallManager**
   - `ApplyLockdownAsync` -> runs `netsh advfirewall set allprofiles state on`; on success marks `RestoreState.FirewallModified` and returns ok message.
   - `RestoreAsync` -> clears marker (profiles left enabled per safe behavior).
   - Non-Windows -> returns not supported / no-op as implemented.
2. **UsbController**
   - `DisableUsbStorage()` -> sets `HKLM\SYSTEM\CurrentControlSet\Services\USBSTOR\Start` to `4`, marks restore state.
   - `RestoreUsbStorage()` -> sets `Start` back to `3`, clears marker.
   - Verify registry value and (optionally) storage device behavior after policy refresh/replug/reboot as applicable.
3. **ShellLockdown**
   - `Apply()` -> sets `HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System\DisableTaskMgr=1`, records previous value.
   - `Restore()` -> restores previous/deletes value, clears marker.
   - Verify Task Manager availability (Ctrl+Shift+Esc / taskmgr) before/after.
4. **Failure handling:** run without admin -> expect failure result/messages, no crash; state changes only when successful.

**Expected:** reversible, logged/best-effort enforcement; safe no-op/unsupported behavior off Windows.

### 3.9 Session controller and teardown (`SessionController`, `TeardownManager`)

**Functions:** `StartAsync`, `StopAsync`, `Status`, `Emit`, `DisposeAsync`, heartbeat loop, restore-on-failure/pending-state handling.

**How to test**
1. **Control API driven (easiest end-to-end function test):**
   - Configure `appsettings.json` with server URL and credentials/token; run service (see 3.11).
   - Start session:
     ```powershell
     Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/session/start -ContentType application/json -Body (@{contestId="<contest-guid>"; username="student1"; password="pass"} | ConvertTo-Json)
     ```
   - Check status: `GET http://127.0.0.1:8765/status`
   - Emit custom event: `POST /event` with `{ "type":"FOCUS_LOST","severity":"MEDIUM","payload":{"source":"manual"} }`
   - Stop: `POST /session/stop` with `{ "reason":"test-end" }`
2. **Verify side effects:**
   - Server session created/active then ended; heartbeats posted while active.
   - Events journaled under `StateDir/events` and ingested to server `/events` for the session.
   - Process monitor started when enabled (and blocks/records per policy in Windows/elevated tests).
   - OS modules applied/restored based on config/policy and permissions.
3. **Pending restore recovery:** leave restore-state dirty (or simulate), restart service -> startup restore/teardown path runs before normal operation.
4. **TeardownManager:** `TeardownAsync` delegates to `SessionController.StopAsync` and returns ok/error; idempotent when no session.

**Expected:** full session lifecycle orchestration, durable/signed event flow, clean teardown and state restoration.

### 3.10 Control API host (`ControlApiHost`)

**Functions/endpoints:** listener start/stop, routing and responses for `GET /health`, `GET /status`, `POST /session/start`, `POST /session/stop`, `POST /event`, `POST /restore`.

**How to test**
1. Start watchdog service/process with control host/port enabled.
2. Call each endpoint:
   ```powershell
   Invoke-RestMethod http://127.0.0.1:8765/health
   Invoke-RestMethod http://127.0.0.1:8765/status
   ```
   - `/event` requires JSON body: `{"type":"PASTE","severity":"LOW","payload":{"chars":10}}`
   - unknown path/method -> error response.
3. Confirm bind is localhost by default (`ControlHost=127.0.0.1`) and port conflicts produce startup log/error without crashing the whole worker unexpectedly.

**Expected:** local automation/control works for all implemented functions with JSON responses.

### 3.11 Host/worker/service entry (`Program.cs`, `Worker`)

**Functions:** config binding, DI wiring, Windows Service registration option, control API startup, pending-restore handling, auto-start session option, graceful shutdown teardown.

**How to test**
1. **Console/dev run:**
   ```powershell
   cd watchdog
   dotnet run --project src/Watchdog -c Debug
   ```
   - Observe logs, control API availability, periodic health ticks.
2. **Auto-start:** set `Watchdog:AutoStartSessionFromConfig=true`, `ContestId`, and credentials/token -> service attempts session start on boot.
3. **Windows Service mode (Windows VM, elevated):**
   - Publish/build executable, install as service (e.g. `sc.exe create ExamWatchdogService binPath= "<full-path>\Watchdog.exe --service" start= auto`) or use configured `RunAsWindowsService`.
   - Start/stop service and verify control API (if reachable), logs, and teardown behavior.
4. **Graceful shutdown:** stop console/service -> worker triggers teardown (`service-stop`) and disposes control API.

**Expected:** service boots with configured modules, recovers/restores safely, and shuts down cleanly.

### 3.12 Harness (`tools/Watchdog.Harness`)

**Functions:** CLI parsing/options, elevation check, dry-run or server login/session start, signed sink + uploader loop, scoped `ProcessMonitor`, shutdown flush, chain verification, session end.

**How to test**
1. **Options/help:** `dotnet run --project tools/Watchdog.Harness -- --help`
2. **Dry-run (no server):** elevated -> `--dry-run --watch notepad [--kill] [--duration N]`
3. **Server-backed:** provide `--server --user --contest [--password]` or `--session --key --token`; confirm events uploaded and session ended.
4. **Automated harness tests:**
   ```powershell
   dotnet test Watchdog.slnx -c Debug --filter "FullyQualifiedName~Harness"
   ```
   Covers canonicalization/chain and server/options logic as implemented.

**Expected:** end-to-end demo of monitor -> signed chain -> server ingest with clear exit codes and summaries.

## 4. End-to-end verification checklist (recommended demo on Windows VM)

1. Build solution and run unit tests: `dotnet test Watchdog.slnx -c Debug`.
2. Start exam server + DB (and judge/teacher UI as needed per `docs/RUNNING.md`).
3. Run watchdog service: `dotnet run --project src/Watchdog -c Debug` (elevated VM).
4. Start an exam session via control API with valid contest/user credentials.
5. Launch a forbidden process (e.g. Notepad/Chrome if configured) -> confirm it is reported/killed per mode and `PROCESS_BLOCKED` recorded.
6. Emit/query events and confirm persistence in server (`GET /events?sessionId=...`, suspicious counts, teacher views).
7. Stop session/service -> confirm uploader flush, session end, and system state restored (firewall/USB/task manager as enabled).

## 5. Notes and limitations

- Real enforcement (WMI start trace, kill, firewall/netsh, registry USB/task-manager, Windows Service) depends on **Windows, elevation, and policy rights**; on non-Windows or non-admin runs many operations are intentionally no-op/fail-safe with reported errors.
- `AllowNameOnlyEntries` and default local allow/deny lists are provided for demo/testability; production deployments should use signed/hash-verified policy entries (`PolicyClient` verification should be hardened as needed).
- Do not test destructive lockdown behavior on a personal machine; prefer a revertible VM snapshot.