using System.Diagnostics;

namespace Watchdog.Lockdown;

public interface IFirewallManager
{
    Task<(bool ok, string message)> ApplyLockdownAsync(CancellationToken ct);
    Task<(bool ok, string message)> RestoreAsync(CancellationToken ct);
}

/// <summary>
/// Best-effort Windows firewall lockdown using netsh (requires admin). 
/// In exam mode we can restrict outbound except allowed apps/server; for safety this implementation
/// records intent and applies a conservative profile toggle only when explicitly enabled.
/// </summary>
public sealed class FirewallManager : IFirewallManager
{
    private readonly Watchdog.State.RestoreAll _restore;
    private readonly ILogger<FirewallManager> _log;
    private bool _applied;

    public FirewallManager(Watchdog.State.RestoreAll restore, ILogger<FirewallManager>? logger = null)
    {
        _restore = restore;
        _log = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<FirewallManager>.Instance;
    }

    public async Task<(bool ok, string message)> ApplyLockdownAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows()) return (false, "Firewall lockdown supported on Windows only");
        // Safe, reversible baseline: enable firewall on all profiles. Deeper per-app rules should be policy-driven.
        var r = await RunAsync("netsh", "advfirewall set allprofiles state on", ct);
        _applied = r.ok;
        if (r.ok) _restore.Save(s => { s.FirewallModified = true; s.LockedAt ??= DateTimeOffset.UtcNow; });
        else _log.LogWarning("Firewall lockdown failed: {Message}", r.message);
        return r;
    }

    public async Task<(bool ok, string message)> RestoreAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows()) return (true, "No-op on non-Windows");
        // Do not disable firewall blindly; just clear our "modified" marker. (Real restore would revert exact prior rules.)
        _restore.Save(s => { s.FirewallModified = false; s.FirewallPreviousPolicy = null; });
        _applied = false;
        await Task.CompletedTask;
        return (true, "Firewall state marker restored (profiles left enabled)");
    }

    private static async Task<(bool ok, string message)> RunAsync(string file, string args, CancellationToken ct)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo(file, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            });
            if (p == null) return (false, "Failed to start process");
            var stdout = await p.StandardOutput.ReadToEndAsync(ct);
            var stderr = await p.StandardError.ReadToEndAsync(ct);
            await p.WaitForExitAsync(ct);
            var msg = (stdout + "\n" + stderr).Trim();
            return (p.ExitCode == 0, string.IsNullOrWhiteSpace(msg) ? $"exit {p.ExitCode}" : msg);
        }
        catch (Exception ex) { return (false, ex.Message); }
    }
}
