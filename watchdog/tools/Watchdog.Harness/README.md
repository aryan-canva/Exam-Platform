# watchdog-harness

Shows the lockdown path without the Windows service or the kiosk:

```
named process starts -> ProcessMonitor -> signed, hash-chained event -> POST /sessions/{id}/events
```

It only ever touches processes whose name is in `--watch` (default `notepad`), and by default it
only reports (LOG mode). Add `--kill` to terminate them too.

## Run it

Open an **elevated** terminal (Windows only reports process starts to administrators).

```powershell
# 1. No server: proves the monitor and the signing. Start Notepad, then Ctrl+C.
dotnet run --project watchdog/tools/Watchdog.Harness -- --dry-run

# 2. Against the server: logs in, starts a session, uploads, ends the session.
dotnet run --project watchdog/tools/Watchdog.Harness -- `
  --server http://localhost:8080 --user student1 --contest <contestId>

# 3. Same, but actually terminate Notepad (and nothing else), for 60 seconds.
dotnet run --project watchdog/tools/Watchdog.Harness -- `
  --server http://localhost:8080 --user student1 --contest <contestId> --kill --duration 60

# 4. Reuse a session you created another way.
dotnet run --project watchdog/tools/Watchdog.Harness -- `
  --server http://localhost:8080 --session <id> --key <base64-or-hex> --token <jwt>
```

Password: `--password`, or the `HARNESS_PASSWORD` environment variable, or you are asked.

## What you should see

```
10:02:11  session 4f1c... ready
10:02:11  mode LOG (report only), watching: notepad
10:02:11  running. Start one now, Ctrl+C to stop.
10:02:19  #1 PROCESS_BLOCKED LOW  notepad.exe pid=8124 killed=False  hash=9c41e0aa17d2
...
10:02:31  events emitted: 1, acknowledged by server: 1
10:02:31  local chain check: OK (links, hashes and HMACs all verify)
```

Then open the timeline page, or `GET /sessions/{id}/timeline`, to see the same event server-side.

## Exit codes

0 ok, 2 bad arguments, 3 not elevated, 4 server error (including CHAIN_BREAK), 5 local chain check failed.

## Things it assumes: check these if the server disagrees

All three live in `SignedEventSink.cs` (`EventChain`), plus two in `ServerClient.cs`:

1. The hash covers `{ type, severity, ts, payload }`, `prevHash` of the first event is 64 zeros,
   `seq` starts at 1, and the HMAC input is the hash as lower-case hex text.
2. The canonical JSON in `CanonicalJson.cs` is a stand-in for `docs/canonical-json.md`.
3. The events body is a bare JSON array, and the response contains `lastSeq`.
4. `sessionKey` arrives as base64 or 64 hex characters.
5. The preflight sent to `/sessions/start` is canned (no VM or monitor checks).

Align all of them with `shared/test-vectors/hash-chain.json` and `docs/openapi.yaml` once Person 3
and Person 1 publish them.

## Not what the real Watchdog does

Events live in memory only (no encrypted SQLite queue), the server policy is not fetched or
verified (no PolicyClient yet), and there is no lockdown, heartbeat or teardown.
