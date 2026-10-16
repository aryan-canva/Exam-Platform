using System.Collections.Concurrent;
using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Watchdog.Events;

namespace Watchdog.Lockdown;

public sealed record ProcessMonitorOptions
{
    /// <summary>BLOCK kills. WARN and LOG only emit an event (use LOG on your own machine).</summary>
    public PolicyAction Action { get; init; } = PolicyAction.BLOCK;

    /// <summary>At Start(), also judge everything already running (LLD: snapshotBaseline).</summary>
    public bool KillExistingOnStart { get; init; } = true;

    /// <summary>
    /// Session 0 holds Windows services (antivirus, VM tools, our own Watchdog). Off by default:
    /// students work in an interactive session, and killing services can wreck the machine.
    /// </summary>
    public bool EnforceSessionZero { get; init; } = false;

    /// <summary>Dev only: honor allowlist entries that have a name but no hash or signer.</summary>
    public bool AllowNameOnlyEntries { get; init; } = false;

    /// <summary>
    /// Safety net: re-judge every process this often, in case WMI dropped an event. Zero disables.
    /// Also makes UpdateAllowlist take effect on processes that are already running.
    /// </summary>
    public TimeSpan SweepInterval { get; init; } = TimeSpan.FromSeconds(3);

    /// <summary>Repeat blocks of the same binary inside this window are counted, not emitted one by one.</summary>
    public TimeSpan EventCoalesceWindow { get; init; } = TimeSpan.FromSeconds(1);

    public int Workers { get; init; } = 4;

    /// <summary>
    /// File names to block even when they sit in a trusted Windows folder (for example "notepad",
    /// "ping"). An allowlist entry that matches by hash still wins. Typically fed from
    /// Policy.preflight.forbiddenProcesses.
    /// </summary>
    public IReadOnlyCollection<string> ExtraDeniedProcesses { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Only enforce on processes for which this returns true. Null means everything.
    /// Use it in tests and on dev machines (for example: only children of the test runner).
    /// </summary>
    public Func<ProcInfo, bool>? Scope { get; init; }
}

/// <summary>
/// Watchdog 5.6. Watches process starts and terminates anything the policy does not allow.
///
/// Lifecycle: new ProcessMonitor(...), Start(allowlist) at lockdown, Stop() at teardown.
/// Start throws if it cannot run safely (empty allowlist, WMI unavailable); the caller
/// (SessionController.activateLockdown) treats that as a failed step and rolls back.
///
/// Holds no persistent state, so there is nothing for restore-pc to undo: a killed process
/// stays killed, and Stop() is the whole teardown.
/// </summary>
public sealed class ProcessMonitor : IDisposable
{
    private readonly IEventSink _events;
    private readonly ProcessMonitorOptions _opts;
    private readonly IProcessApi _api;
    private readonly IFileHasher _hasher;
    private readonly ISignerVerifier _signer;
    private readonly OsBaseline _os;
    private readonly TimeProvider _time;
    private readonly ILogger _log;

    private readonly ConcurrentDictionary<string, Gate> _gates = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<int, byte> _unkillable = new();
    private readonly int _selfPid = Environment.ProcessId;

    private volatile AllowlistMatcher? _matcher;
    private int _state; // 0 = new, 1 = running, 2 = stopped
    private IDisposable? _subscription;
    private Channel<ProcInfo>? _queue;
    private CancellationTokenSource? _cts;
    private Task[] _workers = Array.Empty<Task>();
    private Task? _sweeper;

    public ProcessMonitor(
        IEventSink events,
        ProcessMonitorOptions? options = null,
        IProcessApi? api = null,
        IFileHasher? hasher = null,
        ISignerVerifier? signer = null,
        OsBaseline? os = null,
        TimeProvider? time = null,
        ILogger<ProcessMonitor>? logger = null)
    {
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _opts = options ?? new ProcessMonitorOptions();
        _api = api ?? new WindowsProcessApi();
        _hasher = hasher ?? new CachingFileHasher();
        _signer = signer ?? new DenySignerVerifier();
        _os = os ?? OsBaseline.FromEnvironment();
        _time = time ?? TimeProvider.System;
        _log = logger ?? NullLogger<ProcessMonitor>.Instance;
    }

    // ---------------------------------------------------------------- LLD 5.6 surface

    /// <summary>start(allowlist): subscribe to process starts, then judge what is already running.</summary>
    public void Start(IReadOnlyList<AllowedProcess> allowlist)
    {
        ArgumentNullException.ThrowIfNull(allowlist);
        if (Interlocked.CompareExchange(ref _state, 1, 0) != 0)
            throw new InvalidOperationException("ProcessMonitor can only be started once; create a new instance per session.");

        try
        {
            UpdateAllowlist(allowlist); // throws on a list that would kill the kiosk

            _cts = new CancellationTokenSource();
            var queue = Channel.CreateUnbounded<ProcInfo>();
            _queue = queue;
            _workers = Enumerable.Range(0, Math.Max(1, _opts.Workers))
                .Select(_ => Task.Run(() => WorkerLoopAsync(queue.Reader)))
                .ToArray();

            // Subscribe BEFORE the first sweep so a process that starts in between is not missed.
            _subscription = _api.SubscribeProcessStarts(p => queue.Writer.TryWrite(p));

            if (_opts.KillExistingOnStart) SweepOnce();

            if (_opts.SweepInterval > TimeSpan.Zero)
            {
                var token = _cts.Token;
                _sweeper = Task.Run(() => SweepLoopAsync(token));
            }
        }
        catch
        {
            Stop();
            throw;
        }
    }

    /// <summary>snapshotBaseline(): every process running right now.</summary>
    public IReadOnlyList<ProcInfo> SnapshotBaseline() => _api.Snapshot();

    /// <summary>
    /// onProcessStart(pid, imagePath, parentPid): judge one process and, unless the action is
    /// LOG or WARN, kill it if it is not allowed. Safe to call from any thread.
    /// </summary>
    public Decision OnProcessStart(int pid, string? imagePath, int parentPid)
    {
        var name = imagePath is null ? string.Empty : Path.GetFileName(imagePath);
        return Handle(new ProcInfo(pid, name, imagePath, parentPid, _api.GetSessionId(pid) ?? -1));
    }

    /// <summary>isAllowed(proc): the pure decision. Does not kill or emit anything.</summary>
    public bool IsAllowed(ProcInfo proc) => RequireMatcher().Evaluate(proc).Kind == DecisionKind.Allow;

    /// <summary>terminate(pid): kills the process tree. True if the process is gone afterwards.</summary>
    public bool Terminate(int pid) => _api.Kill(pid, null);

    /// <summary>stop(): unsubscribe, drain, flush coalesced counts. Idempotent.</summary>
    public void Stop()
    {
        if (Interlocked.CompareExchange(ref _state, 2, 1) != 1) return;

        try { _subscription?.Dispose(); }
        catch (Exception ex) { _log.LogWarning(ex, "Failed to unsubscribe from process start events"); }

        _queue?.Writer.TryComplete();
        WaitQuietly(_workers, TimeSpan.FromSeconds(2));

        _cts?.Cancel();
        if (_sweeper is not null) WaitQuietly(new[] { _sweeper }, TimeSpan.FromSeconds(2));

        FlushCoalesced();
        _unkillable.Clear();
        _cts?.Dispose();
    }

    public void Dispose() => Stop();

    /// <summary>For UPDATE_POLICY: swap the allowlist while running. The next sweep applies it.</summary>
    public void UpdateAllowlist(IReadOnlyList<AllowedProcess> allowlist)
    {
        ArgumentNullException.ThrowIfNull(allowlist);
        var matcher = new AllowlistMatcher(
            allowlist, _hasher, _signer, _os, _opts.AllowNameOnlyEntries, _opts.ExtraDeniedProcesses);

        // An allowlist that matches nothing blocks the kiosk and the Watchdog's own children.
        // Refuse it rather than turn the exam desktop into a blank screen.
        if (matcher.HonoredEntryCount == 0)
            throw new ArgumentException(
                "Allowlist has no entry with a sha256 or signer. Refusing to enforce: it would block the kiosk.",
                nameof(allowlist));

        _matcher = matcher;
    }

    // ---------------------------------------------------------------- internals

    private AllowlistMatcher RequireMatcher() =>
        _matcher ?? throw new InvalidOperationException("ProcessMonitor has no allowlist yet; call Start first.");

    private Decision Handle(ProcInfo proc)
    {
        var matcher = RequireMatcher();

        if (proc.Pid == _selfPid)
            return Decision.Allow("the Watchdog itself");

        if (proc.SessionId == 0 && !_opts.EnforceSessionZero)
            return Decision.Allow("session 0 (services) is not enforced");

        if (_opts.Scope is not null && !_opts.Scope(proc))
            return Decision.Allow("outside the enforcement scope");

        if (proc.ImagePath is null)
        {
            var (path, exists) = _api.QueryImage(proc.Pid);
            if (!exists) return Decision.Allow("process already exited");
            proc = proc with { ImagePath = path, Name = path is null ? proc.Name : Path.GetFileName(path) };
        }

        var decision = matcher.Evaluate(proc);
        if (decision.Kind == DecisionKind.Allow) return decision;

        Enforce(proc, decision);
        return decision;
    }

    private void Enforce(ProcInfo proc, Decision decision)
    {
        // Kill first, collect evidence second: the kill is what the demo measures.
        bool killed = false;
        if (_opts.Action == PolicyAction.BLOCK)
        {
            killed = _api.Kill(proc.Pid, proc.ImagePath);
            if (!killed) _unkillable[proc.Pid] = 0; // do not retry (and re-emit) every sweep
        }

        string key = proc.ImagePath ?? proc.Name;
        if (!ShouldEmit(key, out int coalesced)) return;

        string? hash = proc.ImagePath is null ? null : _hasher.Sha256Of(proc.ImagePath);
        string? parentImage = _api.QueryImage(proc.ParentPid).ImagePath;

        // BLOCK that failed to kill is the serious one: the student is still running it.
        var severity = _opts.Action != PolicyAction.BLOCK ? Severity.LOW
                     : killed ? Severity.MEDIUM
                     : Severity.HIGH;

        EmitBlocked(severity, new Dictionary<string, object?>
        {
            ["pid"] = proc.Pid,
            ["imagePath"] = proc.ImagePath,
            ["sha256"] = hash,
            ["parentPid"] = proc.ParentPid,
            ["parentImage"] = parentImage,
            ["reason"] = decision.Reason,
            ["action"] = _opts.Action.ToString(),
            ["killed"] = killed,
            ["coalescedCount"] = coalesced,
        });
    }

    // The single call into Person 3's pipeline.
    private void EmitBlocked(Severity severity, IReadOnlyDictionary<string, object?> payload)
    {
        try { _events.Emit(EventType.PROCESS_BLOCKED, severity, payload); }
        catch (Exception ex)
        {
            // Losing evidence is bad, but a throwing sink must never stop enforcement.
            _log.LogError(ex, "Event sink rejected a PROCESS_BLOCKED event");
        }
    }

    private async Task WorkerLoopAsync(ChannelReader<ProcInfo> reader)
    {
        await foreach (var proc in reader.ReadAllAsync())
        {
            try { Handle(proc); }
            catch (Exception ex) { _log.LogError(ex, "Failed to judge process {Pid}", proc.Pid); }
        }
    }

    private async Task SweepLoopAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(_opts.SweepInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(ct)) SweepOnce();
        }
        catch (OperationCanceledException)
        {
            // Stop() asked us to finish.
        }
    }

    private void SweepOnce()
    {
        IReadOnlyList<ProcInfo> processes;
        try { processes = _api.Snapshot(); }
        catch (Exception ex)
        {
            _log.LogError(ex, "Process sweep could not list processes");
            return;
        }

        foreach (var proc in processes)
        {
            if (_unkillable.ContainsKey(proc.Pid)) continue;
            try { Handle(proc); }
            catch (Exception ex) { _log.LogError(ex, "Sweep failed on process {Pid}", proc.Pid); }
        }
    }

    // ---------------------------------------------------------------- event coalescing

    private sealed class Gate(string key)
    {
        public string Key { get; } = key;
        public DateTimeOffset LastEmit { get; set; } = DateTimeOffset.MinValue;
        public int Suppressed { get; set; }
    }

    private bool ShouldEmit(string key, out int coalesced)
    {
        var gate = _gates.GetOrAdd(key, static k => new Gate(k));
        lock (gate)
        {
            var now = _time.GetUtcNow();
            if (now - gate.LastEmit < _opts.EventCoalesceWindow)
            {
                gate.Suppressed++;
                coalesced = 0;
                return false;
            }

            coalesced = gate.Suppressed;
            gate.Suppressed = 0;
            gate.LastEmit = now;
            return true;
        }
    }

    /// <summary>Counts that never got a following event would vanish, so report them at Stop().</summary>
    private void FlushCoalesced()
    {
        foreach (var gate in _gates.Values)
        {
            lock (gate)
            {
                if (gate.Suppressed == 0) continue;
                EmitBlocked(
                    _opts.Action == PolicyAction.BLOCK ? Severity.MEDIUM : Severity.LOW,
                    new Dictionary<string, object?>
                    {
                        ["imagePath"] = gate.Key,
                        ["action"] = _opts.Action.ToString(),
                        ["summary"] = true,
                        ["coalescedCount"] = gate.Suppressed,
                    });
                gate.Suppressed = 0;
            }
        }
    }

    private static void WaitQuietly(Task[] tasks, TimeSpan timeout)
    {
        try { Task.WaitAll(tasks, timeout); }
        catch (AggregateException) { /* workers log their own failures */ }
    }
}
