using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Watchdog.Events;
using Watchdog.Lockdown;
using Watchdog.Policy;
using Watchdog.State;

namespace Watchdog.Service;

/// <summary>
/// Activates and tears down lockdown for one exam session: policy fetch, event sink/uploader,
/// process monitor, and optional OS lockdown modules.
/// </summary>
public sealed class SessionController : IAsyncDisposable
{
    private readonly WatchdogOptions _opts;
    private readonly ILoggerFactory _logs;
    private readonly ILogger<SessionController> _log;

    public string? SessionId { get; private set; }
    public bool Active { get; private set; }
    public DateTimeOffset? StartedAt { get; private set; }

    private ProcessMonitor? _processMonitor;
    private ServerEventSink? _sink;
    private EventUploader? _uploader;
    private RestoreAll? _restore;
    private IFirewallManager? _firewall;
    private IUsbController? _usb;
    private IShellLockdown? _shell;
    private CancellationTokenSource? _heartbeatCts;
    private Task? _heartbeatTask;
    private WatchdogServerClient? _server;

    public SessionController(WatchdogOptions opts, ILoggerFactory logs)
    {
        _opts = opts;
        _logs = logs;
        _log = logs.CreateLogger<SessionController>();
    }

    public async Task<object> StartAsync(string contestId, string? username = null, string? password = null, string? accessToken = null, CancellationToken ct = default)
    {
        if (Active) throw new InvalidOperationException("A session is already active");

        Directory.CreateDirectory(_opts.StateDir);
        _restore = new RestoreAll(_opts.StateDir);
        if (_restore.HasPendingRestore)
        {
            _log.LogWarning("Pending restore state detected from previous run; attempting restore before new session");
            await RestoreSystemStateAsync(ct);
        }

        _server = new WatchdogServerClient(_opts.ServerUrl);
        var token = accessToken ?? _opts.AccessToken;
        if (!string.IsNullOrWhiteSpace(token)) _server.SetToken(token);
        if (string.IsNullOrWhiteSpace(_server.AccessToken))
        {
            var u = username ?? _opts.Username;
            var p = password ?? _opts.Password;
            if (string.IsNullOrWhiteSpace(u) || string.IsNullOrWhiteSpace(p))
                throw new InvalidOperationException("No access token or username/password configured for server login");
            token = await _server.LoginAsync(u!, p!, ct);
        }

        var deviceFp = Environment.MachineName + "-" + Environment.UserName;
        var (sessionId, sessionKey, raw) = await _server.StartSessionAsync(contestId, deviceFp, "watchdog-service-1.0", ct);
        SessionId = sessionId;
        StartedAt = DateTimeOffset.UtcNow;

        var keyBytes = ServerEventChain.DecodeSessionKey(sessionKey);
        _sink = new ServerEventSink(sessionId, keyBytes, Path.Combine(_opts.StateDir, "events"), _opts.ServerUrl, token);
        _uploader = new EventUploader(_sink, logger: _logs.CreateLogger<EventUploader>());
        _uploader.Start();
        _sink.Emit("SESSION_ATTACHED", "INFO", new Dictionary<string, object?> { { "source", "watchdog-service" }, { "machine", Environment.MachineName }, { "pid", Environment.ProcessId } });

        // Policy
        var policyClient = new PolicyClient(logger: _logs.CreateLogger<PolicyClient>());
        var policy = await policyClient.GetPolicyAsync(_opts.ServerUrl, contestId, token, ct);
        if (policy.AllowedProcesses.Count == 0)
        {
            foreach (var n in _opts.DefaultAllowedProcesses)
                policy.AllowedProcesses.Add(new AllowedProcess(n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? n : n + ".exe"));
        }
        foreach (var f in _opts.ForbiddenProcesses)
            if (!policy.ForbiddenProcesses.Contains(f, StringComparer.OrdinalIgnoreCase)) policy.ForbiddenProcesses.Add(f);

        // OS lockdown modules (best-effort, reversible)
        _firewall = new FirewallManager(_restore, _logs.CreateLogger<FirewallManager>());
        _usb = new UsbController(_restore, _logs.CreateLogger<UsbController>());
        _shell = new ShellLockdown(_restore, _logs.CreateLogger<ShellLockdown>());

        var moduleResults = new Dictionary<string, object?>();
        if (_opts.EnforceFirewall || policy.LockdownFirewall)
            moduleResults["firewall"] = await _firewall.ApplyLockdownAsync(ct);
        if (_opts.EnforceUsb || policy.BlockUsb)
            moduleResults["usb"] = _usb.DisableUsbStorage();
        if (_opts.EnforceShellLockdown || policy.ShellLockdown)
            moduleResults["shell"] = _shell.Apply();

        // Process monitor
        if (_opts.EnforceProcessMonitor)
        {
            try
            {
                var pmOpts = new ProcessMonitorOptions
                {
                    Action = PolicyAction.BLOCK,
                    KillExistingOnStart = true,
                    SweepInterval = TimeSpan.FromSeconds(3),
                    AllowNameOnlyEntries = true, // fallback for demo/dev; production policies should include hashes/signers
                    ExtraDeniedProcesses = policy.ForbiddenProcesses,
                };
                _processMonitor = new ProcessMonitor(_sink, pmOpts, logger: _logs.CreateLogger<ProcessMonitor>());
                _processMonitor.Start(policy.AllowedProcesses);
                moduleResults["processMonitor"] = new { ok = true, honoredEntries = "started" };
                _sink.Emit("PROCESS_MONITOR_STARTED", "INFO", new Dictionary<string, object?> { { "allowed", policy.AllowedProcesses.Count }, { "denied", policy.ForbiddenProcesses.Count } });
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Process monitor failed to start");
                moduleResults["processMonitor"] = new { ok = false, error = ex.Message };
                _sink.Emit("PROCESS_MONITOR_ERROR", "HIGH", new Dictionary<string, object?> { { "error", ex.Message } });
                throw; // lockdown activation failed -> caller treats as fatal for session start
            }
        }

        Active = true;
        _heartbeatCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _heartbeatTask = Task.Run(() => HeartbeatLoopAsync(_heartbeatCts.Token));
        _sink.Emit("LOCKDOWN_ACTIVE", "INFO", new Dictionary<string, object?> { { "contestId", contestId } });

        return new { sessionId, contestId, active = true, modules = moduleResults, session = JsonSerializer.Deserialize<object>(raw.GetRawText()) };
    }

    private async Task HeartbeatLoopAsync(CancellationToken ct)
    {
        var seq = 0L;
        try
        {
            while (!ct.IsCancellationRequested && _server != null && SessionId != null)
            {
                await Task.Delay(TimeSpan.FromSeconds(10), ct);
                seq++;
                try { await _server.HeartbeatAsync(SessionId, seq, ct); }
                catch (Exception ex) { _log.LogWarning(ex, "Heartbeat failed"); _sink?.Emit("HEARTBEAT_GAP", "MEDIUM", new Dictionary<string, object?> { { "seq", seq }, { "error", ex.Message } }); }
            }
        }
        catch (OperationCanceledException) { }
    }

    public async Task<object> StopAsync(string reason = "stopped", CancellationToken ct = default)
    {
        if (!Active && SessionId == null) return new { ok = true, message = "No active session" };
        Active = false;
        try { _heartbeatCts?.Cancel(); if (_heartbeatTask != null) await _heartbeatTask; } catch { }
        _sink?.Emit("SESSION_END", "INFO", new Dictionary<string, object?> { { "reason", reason } });
        try { _processMonitor?.Stop(); } catch (Exception ex) { _log.LogWarning(ex, "Error stopping process monitor"); }
        await RestoreSystemStateAsync(ct);
        if (_uploader != null) try { await _uploader.FlushAsync(ct); await _uploader.StopAsync(); } catch { }
        if (_server != null && SessionId != null)
        {
            try { await _server.EndSessionAsync(SessionId, ct); } catch (Exception ex) { _log.LogWarning(ex, "Failed to end server session"); }
        }
        var sid = SessionId;
        SessionId = null;
        _sink?.Dispose();
        _uploader?.Dispose();
        _server?.Dispose();
        _processMonitor?.Dispose();
        return new { ok = true, sessionId = sid, reason };
    }

    private async Task RestoreSystemStateAsync(CancellationToken ct)
    {
        try { if (_shell != null) _shell.Restore(); } catch { }
        try { if (_usb != null) _usb.RestoreUsbStorage(); } catch { }
        try { if (_firewall != null) await _firewall.RestoreAsync(ct); } catch { }
        try { _restore?.MarkClean(); } catch { }
    }

    public object Status() => new { active = Active, sessionId = SessionId, startedAt = StartedAt, pendingEvents = _sink?.PendingCount ?? 0 };

    public void Emit(string type, string severity, Dictionary<string, object?> payload) => _sink?.Emit(type, severity, payload);

    public async ValueTask DisposeAsync() => await StopAsync("disposed");
}
