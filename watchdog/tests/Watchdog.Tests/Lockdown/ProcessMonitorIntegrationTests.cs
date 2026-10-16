using System.Diagnostics;
using System.Security.Principal;
using Watchdog.Events;
using Watchdog.Lockdown;
using Xunit;

namespace Watchdog.Tests.Lockdown;

/// <summary>Skips itself unless the test runner is elevated (Win32_ProcessStartTrace is admin-only).</summary>
public sealed class AdminOnlyFactAttribute : FactAttribute
{
    public AdminOnlyFactAttribute()
    {
        using var identity = WindowsIdentity.GetCurrent();
        if (!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
            Skip = "Run from an elevated shell: WMI process start events need admin rights.";
    }
}

/// <summary>
/// Real WMI, real processes. Safe on a dev machine because Scope limits enforcement to direct
/// children of the test runner, so your IDE, browser and everything else are never touched.
/// Run:  dotnet test --filter Category=Integration   (elevated shell)
/// </summary>
[Trait("Category", "Integration")]
public class ProcessMonitorIntegrationTests
{
    private static readonly AllowedProcess[] Placeholder =
        { new("placeholder.exe", Sha256: new string('0', 64)) };

    private static ProcessMonitorOptions OnlyOurChildren(PolicyAction action) => new()
    {
        Action = action,
        KillExistingOnStart = false,
        SweepInterval = TimeSpan.Zero, // prove the WMI event path, not the sweep
        Scope = p => p.ParentPid == Environment.ProcessId,
    };

    private static Process StartCmd() =>
        Process.Start(new ProcessStartInfo("cmd.exe", "/c ping -n 30 127.0.0.1 >nul")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        })!;

    [AdminOnlyFact]
    public void Blocked_child_dies_within_a_second_and_is_reported()
    {
        var sink = new CapturingSink();
        using var monitor = new ProcessMonitor(sink, OnlyOurChildren(PolicyAction.BLOCK));
        monitor.Start(Placeholder);

        var clock = Stopwatch.StartNew();
        using var child = StartCmd();

        Assert.True(child.WaitForExit(3000), "cmd.exe should have been terminated");
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(1.5), $"took {clock.Elapsed}");

        SpinWait.SpinUntil(() => sink.Events.Count > 0, TimeSpan.FromSeconds(2));
        var evt = Assert.Single(sink.Events);
        Assert.Equal(EventType.PROCESS_BLOCKED, evt.Type);
        Assert.EndsWith("cmd.exe", (string)evt.Payload["imagePath"]!, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(true, evt.Payload["killed"]);
        Assert.NotNull(evt.Payload["sha256"]);
    }

    [AdminOnlyFact]
    public void Log_mode_reports_the_child_but_leaves_it_running()
    {
        var sink = new CapturingSink();
        using var monitor = new ProcessMonitor(sink, OnlyOurChildren(PolicyAction.LOG));
        monitor.Start(Placeholder);

        using var child = StartCmd();
        try
        {
            Assert.True(SpinWait.SpinUntil(() => sink.Events.Count > 0, TimeSpan.FromSeconds(3)),
                "no PROCESS_BLOCKED event arrived");
            Assert.False(child.HasExited);
        }
        finally
        {
            if (!child.HasExited) child.Kill(entireProcessTree: true);
        }
    }

    [AdminOnlyFact]
    public void Real_snapshot_contains_the_test_runner_itself()
    {
        using var monitor = new ProcessMonitor(new CapturingSink(), OnlyOurChildren(PolicyAction.LOG));

        var snapshot = monitor.SnapshotBaseline();

        var self = Assert.Single(snapshot, p => p.Pid == Environment.ProcessId);
        Assert.NotNull(self.ImagePath);
    }
}
