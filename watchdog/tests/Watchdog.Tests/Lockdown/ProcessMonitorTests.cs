using Watchdog.Events;
using Watchdog.Lockdown;
using Xunit;
using static Watchdog.Tests.Lockdown.TestData;

namespace Watchdog.Tests.Lockdown;

public class ProcessMonitorTests
{
    private static readonly AllowedProcess[] DefaultAllowlist =
        { new("kiosk.exe", Sha256: Hash('a')) };

    private static readonly ProcessMonitorOptions Quiet = new()
    {
        SweepInterval = TimeSpan.Zero,
        KillExistingOnStart = false,
    };

    /// <summary>One monitor wired to a fake OS, a capturing sink and a manual clock.</summary>
    private sealed class Rig : IDisposable
    {
        public FakeProcessApi Api { get; } = new();
        public CapturingSink Sink { get; } = new();
        public FakeHasher Hasher { get; } = new();
        public ManualTime Time { get; } = new();
        public ProcessMonitor Monitor { get; }

        public Rig(ProcessMonitorOptions? options = null)
        {
            Monitor = new ProcessMonitor(Sink, options ?? Quiet, api: Api, hasher: Hasher, os: Os, time: Time);
        }

        public Rig Started(AllowedProcess[]? allowlist = null)
        {
            Monitor.Start(allowlist ?? DefaultAllowlist);
            return this;
        }

        public void Dispose() => Monitor.Dispose();
    }

    // ---- blocking and reporting ---------------------------------------------

    [Fact]
    public void Blocked_process_is_killed_and_reported_with_evidence()
    {
        using var rig = new Rig().Started();
        rig.Api.Images[200] = Evil;
        rig.Api.Images[1] = @"C:\Windows\explorer.exe";
        rig.Hasher.Add(Evil, Hash('b'));

        var decision = rig.Monitor.OnProcessStart(200, Evil, parentPid: 1);

        Assert.Equal(DecisionKind.Block, decision.Kind);
        var kill = Assert.Single(rig.Api.KillCalls);
        Assert.Equal(200, kill.Pid);
        Assert.Equal(Evil, kill.ExpectedPath);

        var evt = Assert.Single(rig.Sink.Events);
        Assert.Equal(EventType.PROCESS_BLOCKED, evt.Type);
        Assert.Equal(Severity.MEDIUM, evt.Severity);
        Assert.Equal(Evil, evt.Payload["imagePath"]);
        Assert.Equal(Hash('b'), evt.Payload["sha256"]);
        Assert.Equal(1, evt.Payload["parentPid"]);
        Assert.Equal(@"C:\Windows\explorer.exe", evt.Payload["parentImage"]);
        Assert.Equal(true, evt.Payload["killed"]);
    }

    [Fact]
    public void Allowed_process_is_left_alone()
    {
        using var rig = new Rig().Started();
        rig.Api.Images[300] = Kiosk;
        rig.Hasher.Add(Kiosk, Hash('a'));

        var decision = rig.Monitor.OnProcessStart(300, Kiosk, parentPid: 1);

        Assert.Equal(DecisionKind.Allow, decision.Kind);
        Assert.Empty(rig.Api.KillCalls);
        Assert.Empty(rig.Sink.Events);
    }

    [Fact]
    public void Process_that_exits_before_we_look_is_ignored()
    {
        using var rig = new Rig().Started(); // pid 400 is not in Images: it no longer exists

        var decision = rig.Monitor.OnProcessStart(400, imagePath: null, parentPid: 1);

        Assert.Equal(DecisionKind.Allow, decision.Kind);
        Assert.Empty(rig.Api.KillCalls);
        Assert.Empty(rig.Sink.Events);
    }

    [Fact]
    public void Path_is_resolved_when_the_start_event_does_not_carry_one()
    {
        using var rig = new Rig().Started();
        rig.Api.Images[500] = Evil;

        var decision = rig.Monitor.OnProcessStart(500, imagePath: null, parentPid: 1);

        Assert.Equal(DecisionKind.Block, decision.Kind);
        Assert.Equal(Evil, Assert.Single(rig.Api.KillCalls).ExpectedPath);
    }

    [Fact]
    public void Extra_denied_process_in_a_windows_folder_is_blocked()
    {
        const string ping = @"C:\Windows\System32\ping.exe";
        using var rig = new Rig(Quiet with { ExtraDeniedProcesses = new[] { "ping" } }).Started();
        rig.Api.Images[210] = ping;

        var decision = rig.Monitor.OnProcessStart(210, ping, parentPid: 1);

        Assert.Equal(DecisionKind.Block, decision.Kind);
        Assert.Equal(210, Assert.Single(rig.Api.KillCalls).Pid);
    }

    [Fact]
    public void Log_mode_reports_but_never_kills()
    {
        using var rig = new Rig(Quiet with { Action = PolicyAction.LOG }).Started();
        rig.Api.Images[200] = Evil;

        rig.Monitor.OnProcessStart(200, Evil, parentPid: 1);

        Assert.Empty(rig.Api.KillCalls);
        var evt = Assert.Single(rig.Sink.Events);
        Assert.Equal(Severity.LOW, evt.Severity);
        Assert.Equal(false, evt.Payload["killed"]);
        Assert.Equal("LOG", evt.Payload["action"]);
    }

    // ---- failure paths -------------------------------------------------------

    [Fact]
    public void Kill_that_fails_is_reported_as_high_severity()
    {
        using var rig = new Rig().Started();
        rig.Api.Images[200] = Evil;
        rig.Api.Unkillable.Add(200);

        rig.Monitor.OnProcessStart(200, Evil, parentPid: 1);

        var evt = Assert.Single(rig.Sink.Events);
        Assert.Equal(Severity.HIGH, evt.Severity);
        Assert.Equal(false, evt.Payload["killed"]);
    }

    [Fact]
    public async Task Sweep_does_not_retry_a_process_that_could_not_be_killed()
    {
        var options = Quiet with { KillExistingOnStart = true, SweepInterval = TimeSpan.FromMilliseconds(20) };
        using var rig = new Rig(options);
        rig.Api.Images[200] = Evil;
        rig.Api.Unkillable.Add(200);
        rig.Api.Processes.Add(new ProcInfo(200, "evil.exe", Evil, 1, 1));

        rig.Monitor.Start(DefaultAllowlist);
        await Task.Delay(300); // about a dozen sweeps

        Assert.Single(rig.Api.KillCalls);
    }

    [Fact]
    public void A_throwing_event_sink_does_not_stop_enforcement()
    {
        using var rig = new Rig().Started();
        rig.Sink.Throw = true;
        rig.Api.Images[200] = Evil;

        var decision = rig.Monitor.OnProcessStart(200, Evil, parentPid: 1);

        Assert.Equal(DecisionKind.Block, decision.Kind);
        Assert.Single(rig.Api.KillCalls);
    }

    [Fact]
    public void Start_refuses_an_allowlist_that_would_block_the_kiosk()
    {
        using var rig = new Rig();

        Assert.Throws<ArgumentException>(() => rig.Monitor.Start(Array.Empty<AllowedProcess>()));
    }

    [Fact]
    public void Start_refuses_an_allowlist_of_bare_names()
    {
        using var rig = new Rig();

        Assert.Throws<ArgumentException>(() => rig.Monitor.Start(new[] { new AllowedProcess("kiosk.exe") }));
    }

    [Fact]
    public void Start_fails_loudly_when_process_events_are_unavailable()
    {
        using var rig = new Rig();
        rig.Api.SubscribeThrows = true;

        Assert.Throws<InvalidOperationException>(() => rig.Monitor.Start(DefaultAllowlist));
    }

    [Fact]
    public void Start_twice_is_rejected()
    {
        using var rig = new Rig().Started();

        Assert.Throws<InvalidOperationException>(() => rig.Monitor.Start(DefaultAllowlist));
    }

    [Fact]
    public void Stop_is_safe_to_call_twice_and_before_start()
    {
        using var never = new Rig();
        never.Monitor.Stop();

        using var rig = new Rig().Started();
        rig.Monitor.Stop();
        rig.Monitor.Stop();
    }

    // ---- scope guards --------------------------------------------------------

    [Fact]
    public void The_watchdog_never_judges_itself()
    {
        using var rig = new Rig().Started();
        rig.Api.Images[Environment.ProcessId] = Evil;

        var decision = rig.Monitor.OnProcessStart(Environment.ProcessId, Evil, parentPid: 1);

        Assert.Equal(DecisionKind.Allow, decision.Kind);
        Assert.Empty(rig.Api.KillCalls);
    }

    [Fact]
    public void Session_zero_services_are_not_enforced_by_default()
    {
        using var rig = new Rig().Started();
        rig.Api.Images[600] = Evil;
        rig.Api.Sessions[600] = 0;

        Assert.Equal(DecisionKind.Allow, rig.Monitor.OnProcessStart(600, Evil, parentPid: 1).Kind);
        Assert.Empty(rig.Api.KillCalls);
    }

    [Fact]
    public void Session_zero_is_enforced_when_the_option_is_on()
    {
        using var rig = new Rig(Quiet with { EnforceSessionZero = true }).Started();
        rig.Api.Images[600] = Evil;
        rig.Api.Sessions[600] = 0;

        Assert.Equal(DecisionKind.Block, rig.Monitor.OnProcessStart(600, Evil, parentPid: 1).Kind);
    }

    [Fact]
    public void Scope_limits_which_processes_are_enforced()
    {
        using var rig = new Rig(Quiet with { Scope = p => p.ParentPid == 77 }).Started();
        rig.Api.Images[1000] = Evil;
        rig.Api.Images[1001] = Evil;

        Assert.Equal(DecisionKind.Allow, rig.Monitor.OnProcessStart(1000, Evil, parentPid: 5).Kind);
        Assert.Equal(DecisionKind.Block, rig.Monitor.OnProcessStart(1001, Evil, parentPid: 77).Kind);

        Assert.Equal(1001, Assert.Single(rig.Api.KillCalls).Pid);
    }

    // ---- sweep and live updates ----------------------------------------------

    [Fact]
    public void Start_judges_processes_that_are_already_running()
    {
        using var rig = new Rig(Quiet with { KillExistingOnStart = true });
        rig.Api.Images[10] = Evil;
        rig.Api.Images[11] = Kiosk;
        rig.Hasher.Add(Kiosk, Hash('a'));
        rig.Api.Processes.Add(new ProcInfo(10, "evil.exe", Evil, 1, 1));
        rig.Api.Processes.Add(new ProcInfo(11, "kiosk.exe", Kiosk, 1, 1));

        rig.Monitor.Start(DefaultAllowlist);

        Assert.Equal(10, Assert.Single(rig.Api.KillCalls).Pid);
    }

    [Fact]
    public void Start_leaves_existing_processes_alone_when_asked()
    {
        using var rig = new Rig(Quiet with { KillExistingOnStart = false });
        rig.Api.Images[10] = Evil;
        rig.Api.Processes.Add(new ProcInfo(10, "evil.exe", Evil, 1, 1));

        rig.Monitor.Start(DefaultAllowlist);

        Assert.Empty(rig.Api.KillCalls);
    }

    [Fact]
    public void Updated_allowlist_applies_to_the_next_decision()
    {
        using var rig = new Rig().Started();
        rig.Api.Images[200] = Evil;
        rig.Api.Images[201] = Evil;
        rig.Hasher.Add(Evil, Hash('b'));

        Assert.Equal(DecisionKind.Block, rig.Monitor.OnProcessStart(200, Evil, parentPid: 1).Kind);

        rig.Monitor.UpdateAllowlist(new AllowedProcess[]
        {
            new("kiosk.exe", Sha256: Hash('a')),
            new("evil.exe", Sha256: Hash('b')),
        });

        Assert.Equal(DecisionKind.Allow, rig.Monitor.OnProcessStart(201, Evil, parentPid: 1).Kind);
    }

    [Fact]
    public void Updating_to_a_useless_allowlist_is_rejected_and_the_old_one_stays_active()
    {
        using var rig = new Rig().Started();
        rig.Api.Images[300] = Kiosk;
        rig.Hasher.Add(Kiosk, Hash('a'));

        Assert.Throws<ArgumentException>(() => rig.Monitor.UpdateAllowlist(Array.Empty<AllowedProcess>()));

        Assert.Equal(DecisionKind.Allow, rig.Monitor.OnProcessStart(300, Kiosk, parentPid: 1).Kind);
    }

    // ---- event coalescing ----------------------------------------------------

    [Fact]
    public void Burst_of_the_same_binary_emits_one_event_but_kills_every_copy()
    {
        using var rig = new Rig().Started();
        for (int pid = 700; pid < 705; pid++)
        {
            rig.Api.Images[pid] = Evil;
            rig.Monitor.OnProcessStart(pid, Evil, parentPid: 1);
        }

        Assert.Equal(5, rig.Api.KillCalls.Count);
        Assert.Single(rig.Sink.Events);
    }

    [Fact]
    public void Suppressed_count_is_carried_on_the_next_event()
    {
        using var rig = new Rig().Started();
        for (int pid = 700; pid < 703; pid++)
        {
            rig.Api.Images[pid] = Evil;
            rig.Monitor.OnProcessStart(pid, Evil, parentPid: 1);
        }

        rig.Time.Advance(TimeSpan.FromSeconds(2));
        rig.Api.Images[710] = Evil;
        rig.Monitor.OnProcessStart(710, Evil, parentPid: 1);

        Assert.Equal(2, rig.Sink.Events.Count);
        Assert.Equal(0, rig.Sink.Events[0].Payload["coalescedCount"]);
        Assert.Equal(2, rig.Sink.Events[1].Payload["coalescedCount"]);
    }

    [Fact]
    public void Stop_reports_counts_that_never_got_a_following_event()
    {
        var rig = new Rig().Started();
        for (int pid = 700; pid < 704; pid++)
        {
            rig.Api.Images[pid] = Evil;
            rig.Monitor.OnProcessStart(pid, Evil, parentPid: 1);
        }

        rig.Monitor.Stop();

        Assert.Equal(2, rig.Sink.Events.Count);
        var summary = rig.Sink.Events[1];
        Assert.Equal(true, summary.Payload["summary"]);
        Assert.Equal(3, summary.Payload["coalescedCount"]);
    }

    // ---- plain decision and terminate ----------------------------------------

    [Fact]
    public void IsAllowed_judges_without_killing_or_emitting()
    {
        using var rig = new Rig().Started();
        rig.Hasher.Add(Kiosk, Hash('a'));

        Assert.True(rig.Monitor.IsAllowed(new ProcInfo(1, "kiosk.exe", Kiosk, 0, 1)));
        Assert.False(rig.Monitor.IsAllowed(new ProcInfo(2, "evil.exe", Evil, 0, 1)));
        Assert.Empty(rig.Api.KillCalls);
        Assert.Empty(rig.Sink.Events);
    }

    [Fact]
    public void IsAllowed_before_start_is_an_error_not_a_silent_allow()
    {
        using var rig = new Rig();

        Assert.Throws<InvalidOperationException>(() => rig.Monitor.IsAllowed(new ProcInfo(1, "x.exe", Evil, 0, 1)));
    }

    [Fact]
    public void Terminate_passes_the_pid_through_and_reports_the_result()
    {
        using var rig = new Rig().Started();
        rig.Api.Images[800] = Evil;
        rig.Api.Images[801] = Evil;
        rig.Api.Unkillable.Add(801);

        Assert.True(rig.Monitor.Terminate(800));
        Assert.False(rig.Monitor.Terminate(801));
        Assert.Equal(new[] { 800, 801 }, rig.Api.KillCalls.Select(k => k.Pid).ToArray());
    }

    [Fact]
    public void SnapshotBaseline_returns_what_the_os_reports()
    {
        using var rig = new Rig();
        rig.Api.Processes.Add(new ProcInfo(10, "evil.exe", Evil, 1, 1));

        Assert.Equal(10, Assert.Single(rig.Monitor.SnapshotBaseline()).Pid);
    }
}
