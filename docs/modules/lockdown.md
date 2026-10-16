# Lockdown module (Person 2)

One section per component. Each has: purpose, interface, failure modes, what is tested.
Only ProcessMonitor is written so far; the rest are placeholders.

## ProcessMonitor

**Purpose.** While a session is locked, terminate any process the signed policy does not allow,
and report each one as a PROCESS_BLOCKED event. Target: a forbidden process dies within about a
second of starting.

**Where it lives.** `watchdog/src/Watchdog/Lockdown/`: `ProcessMonitor.cs` (lifecycle, enforcement,
events), `AllowlistMatcher.cs` (the rules, no OS calls), `WindowsProcessApi.cs` (the only file that
touches WMI and Win32), `ProcessTypes.cs`.

**Interface (LLD 5.6).**
- `Start(allowlist)`: subscribe to process starts, then judge what is already running.
- `SnapshotBaseline() -> ProcInfo[]`, `OnProcessStart(pid, imagePath, parentPid) -> Decision`,
  `IsAllowed(proc) -> bool`, `Terminate(pid) -> bool`, `Stop()`.
- Added: `UpdateAllowlist(list)` for UPDATE_POLICY.
- Consumes: `IEventSink.Emit(PROCESS_BLOCKED, severity, payload)` from Person 3.
- Called by: `SessionController.activateLockdown` (Start) and `TeardownManager` (Stop).
- Needs no backup and no restore-pc step: it keeps no persistent state.

**Decision rules, first match wins.**
1. Critical OS process (csrss, lsass, ...): allow, never killed.
2. Policy entry: file name matches AND (SHA-256 matches OR signer verifies): allow.
3. File is in System32, SysWOW64, SystemApps, or directly in C:\Windows, and is not on the denied
   list (cmd, powershell, notepad, regedit, taskmgr, ...): allow.
4. Otherwise: block.

A renamed binary fails rule 2 (wrong hash) and rule 3 (wrong folder).

**Choices to know about.**
- Session 0 (services) is not enforced by default, so antivirus, VM tools and the Watchdog are safe.
- Entries with a name but no hash or signer are ignored unless the dev flag is on.
- `Start` refuses an allowlist with no usable entry, instead of blocking the kiosk.
- Signer entries fail closed until a real Authenticode verifier replaces `DenySignerVerifier`.
- Repeat blocks of one binary within 1 s are counted into the next event, and flushed at Stop.
- A sweep every 3 s re-judges all processes, in case WMI drops an event.

**Failure modes.**
| What goes wrong | What happens |
|---|---|
| WMI service down | `Start` throws; activateLockdown rolls back |
| Kill fails (protected process) | event with severity HIGH and killed=false; not retried by the sweep |
| Process exits before we look | ignored |
| Pid reused between judge and kill | image path re-checked; the new program is left alone |
| Event sink throws | logged; the kill still happens |
| Hash file unreadable | a hash entry cannot match; the process is blocked |
| Allowlist hash out of date (new kiosk build) | the kiosk is killed: update the policy hash on every build |

**Known limits.** The kill is after the fact (WMI fires just after the process starts).
Rule 3 trusts a folder, not a signature. An admin student defeats all of this.

**Tested.** `AllowlistMatcherTests` (every rule, renamed binary, `..` paths, lookalike folders),
`ProcessMonitorTests` (kill and report, LOG mode, failed kill, sweep, scope, session 0, coalescing,
refused allowlists, live update; all against a fake OS), `ProcessMonitorIntegrationTests`
(real WMI, elevated shell, children of the test runner only).

## RestoreAll, ServiceHost, PolicyClient, SessionController, FirewallManager, UsbController, ShellLockdown, TeardownManager

TODO: one section each, same four headings, before that component's first PR.
