using Watchdog.Lockdown;
using Xunit;
using static Watchdog.Tests.Lockdown.TestData;

namespace Watchdog.Tests.Lockdown;

public class AllowlistMatcherTests
{
    private static AllowlistMatcher Matcher(
        AllowedProcess[] entries,
        FakeHasher? hasher = null,
        ISignerVerifier? signer = null,
        bool nameOnly = false,
        string[]? extraDenied = null) =>
        new(entries, hasher ?? new FakeHasher(), signer ?? new DenySignerVerifier(), Os, nameOnly, extraDenied);

    private static ProcInfo Proc(string path, string? name = null) =>
        new(Pid: 100, Name: name ?? Path.GetFileName(path), ImagePath: path, ParentPid: 1, SessionId: 1);

    // ---- policy allowlist ------------------------------------------------

    [Fact]
    public void Name_and_hash_match_is_allowed()
    {
        var hasher = new FakeHasher().Add(Kiosk, Hash('a'));
        var m = Matcher(new[] { new AllowedProcess("kiosk.exe", Sha256: Hash('a')) }, hasher);

        Assert.Equal(DecisionKind.Allow, m.Evaluate(Proc(Kiosk)).Kind);
    }

    [Fact]
    public void Hash_and_name_comparison_ignore_case()
    {
        var hasher = new FakeHasher().Add(Kiosk, Hash('a'));
        var m = Matcher(new[] { new AllowedProcess("KIOSK.EXE", Sha256: Hash('A')) }, hasher);

        Assert.Equal(DecisionKind.Allow, m.Evaluate(Proc(Kiosk)).Kind);
    }

    [Fact]
    public void Forbidden_binary_renamed_to_an_allowed_name_is_blocked()
    {
        // notepad.exe copied to the desktop and renamed kiosk.exe: same name, different bytes.
        const string renamed = @"C:\Users\student\Desktop\kiosk.exe";
        var hasher = new FakeHasher().Add(renamed, Hash('n')); // notepad's hash
        var m = Matcher(new[] { new AllowedProcess("kiosk.exe", Sha256: Hash('a')) }, hasher);

        Assert.Equal(DecisionKind.Block, m.Evaluate(Proc(renamed)).Kind);
    }

    [Fact]
    public void Allowed_binary_copied_under_another_name_is_blocked()
    {
        const string copy = @"C:\Users\student\Desktop\helper.exe";
        var hasher = new FakeHasher().Add(copy, Hash('a')); // the kiosk's real hash
        var m = Matcher(new[] { new AllowedProcess("kiosk.exe", Sha256: Hash('a')) }, hasher);

        Assert.Equal(DecisionKind.Block, m.Evaluate(Proc(copy)).Kind);
    }

    [Fact]
    public void Entry_with_a_full_path_only_matches_that_path()
    {
        var hasher = new FakeHasher().Add(Kiosk, Hash('a')).Add(@"D:\elsewhere\kiosk.exe", Hash('a'));
        var m = Matcher(new[] { new AllowedProcess(Kiosk, Sha256: Hash('a')) }, hasher);

        Assert.Equal(DecisionKind.Allow, m.Evaluate(Proc(Kiosk)).Kind);
        Assert.Equal(DecisionKind.Block, m.Evaluate(Proc(@"D:\elsewhere\kiosk.exe")).Kind);
    }

    [Fact]
    public void Unreadable_file_cannot_satisfy_a_hash_entry()
    {
        var m = Matcher(new[] { new AllowedProcess("kiosk.exe", Sha256: Hash('a')) }); // hasher knows no files

        Assert.Equal(DecisionKind.Block, m.Evaluate(Proc(Kiosk)).Kind);
    }

    [Fact]
    public void Name_only_entry_is_ignored_unless_dev_flag_is_set()
    {
        var entries = new[] { new AllowedProcess("kiosk.exe") };

        Assert.Equal(DecisionKind.Block, Matcher(entries).Evaluate(Proc(Kiosk)).Kind);
        Assert.Equal(DecisionKind.Allow, Matcher(entries, nameOnly: true).Evaluate(Proc(Kiosk)).Kind);
    }

    [Fact]
    public void Signer_entry_fails_closed_by_default_and_allows_when_verified()
    {
        var entries = new[] { new AllowedProcess("msedgewebview2.exe", Signer: "Microsoft Corporation") };
        const string webview = @"C:\Program Files (x86)\Microsoft\EdgeWebView\Application\1.0\msedgewebview2.exe";

        Assert.Equal(DecisionKind.Block, Matcher(entries).Evaluate(Proc(webview)).Kind);
        Assert.Equal(DecisionKind.Allow,
            Matcher(entries, signer: new FakeSigner { Result = true }).Evaluate(Proc(webview)).Kind);
    }

    [Fact]
    public void Allowlist_can_permit_an_otherwise_denied_tool_by_hash()
    {
        const string calc = @"C:\Windows\System32\calc.exe";
        var hasher = new FakeHasher().Add(calc, Hash('c'));

        Assert.Equal(DecisionKind.Block, Matcher(Array.Empty<AllowedProcess>(), hasher).Evaluate(Proc(calc)).Kind);
        Assert.Equal(DecisionKind.Allow,
            Matcher(new[] { new AllowedProcess("calc.exe", Sha256: Hash('c')) }, hasher).Evaluate(Proc(calc)).Kind);
    }

    [Fact]
    public void Honored_entry_count_ignores_entries_that_can_never_match()
    {
        var entries = new[] { new AllowedProcess("a.exe"), new AllowedProcess("b.exe", Sha256: Hash('b')) };

        Assert.Equal(1, Matcher(entries).HonoredEntryCount);
        Assert.Equal(2, Matcher(entries, nameOnly: true).HonoredEntryCount);
    }

    // ---- OS baseline -----------------------------------------------------

    [Theory]
    [InlineData(@"C:\Windows\notepad.exe")]
    [InlineData(@"C:\Windows\System32\notepad.exe")]
    [InlineData(@"C:\Windows\System32\cmd.exe")]
    [InlineData(@"C:\Windows\SysWOW64\cmd.exe")]
    [InlineData(@"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")]
    [InlineData(@"C:\Windows\regedit.exe")]
    [InlineData(@"C:\Windows\System32\taskmgr.exe")]
    public void Windows_tools_on_the_denied_list_are_blocked_even_in_system_folders(string path)
    {
        Assert.Equal(DecisionKind.Block, Matcher(Array.Empty<AllowedProcess>()).Evaluate(Proc(path)).Kind);
    }

    [Theory]
    [InlineData(@"C:\Windows\System32\svchost.exe")]
    [InlineData(@"C:\Windows\System32\conhost.exe")]
    [InlineData(@"C:\Windows\SysWOW64\dllhost.exe")]
    [InlineData(@"C:\Windows\explorer.exe")]
    [InlineData(@"C:\Windows\SystemApps\ShellExperienceHost_cw5n1h2txyewy\ShellExperienceHost.exe")]
    public void Normal_windows_processes_are_allowed(string path)
    {
        Assert.Equal(DecisionKind.Allow, Matcher(Array.Empty<AllowedProcess>()).Evaluate(Proc(path)).Kind);
    }

    [Theory]
    [InlineData(@"C:\Users\student\Desktop\explorer.exe")]   // fake system name, wrong folder
    [InlineData(@"C:\Users\student\Desktop\svchost.exe")]
    [InlineData(@"C:\Windows\Temp\evil.exe")]                // subfolder of Windows is user-writable
    [InlineData(@"C:\Windows\System32x\evil.exe")]           // prefix lookalike
    [InlineData(@"C:\Program Files\Mozilla Firefox\firefox.exe")]
    public void Anything_outside_trusted_folders_and_the_allowlist_is_blocked(string path)
    {
        Assert.Equal(DecisionKind.Block, Matcher(Array.Empty<AllowedProcess>()).Evaluate(Proc(path)).Kind);
    }

    [Fact]
    public void Extra_denied_names_block_an_otherwise_trusted_windows_binary()
    {
        const string ping = @"C:\Windows\System32\ping.exe";

        Assert.Equal(DecisionKind.Allow, Matcher(Array.Empty<AllowedProcess>()).Evaluate(Proc(ping)).Kind);
        Assert.Equal(DecisionKind.Block,
            Matcher(Array.Empty<AllowedProcess>(), extraDenied: new[] { "ping" }).Evaluate(Proc(ping)).Kind);
        Assert.Equal(DecisionKind.Block,
            Matcher(Array.Empty<AllowedProcess>(), extraDenied: new[] { " PING.EXE " }).Evaluate(Proc(ping)).Kind);
    }

    [Fact]
    public void Extra_denied_names_do_not_override_an_allowlist_hash_match()
    {
        const string ping = @"C:\Windows\System32\ping.exe";
        var hasher = new FakeHasher().Add(ping, Hash('p'));
        var m = Matcher(new[] { new AllowedProcess("ping.exe", Sha256: Hash('p')) }, hasher, extraDenied: new[] { "ping" });

        Assert.Equal(DecisionKind.Allow, m.Evaluate(Proc(ping)).Kind);
    }

    [Fact]
    public void Blank_extra_denied_names_are_ignored()
    {
        var m = Matcher(Array.Empty<AllowedProcess>(), extraDenied: new[] { "", "   " });

        Assert.Equal(DecisionKind.Allow, m.Evaluate(Proc(@"C:\Windows\System32\svchost.exe")).Kind);
    }

    [Fact]
    public void Dot_dot_segments_cannot_smuggle_a_path_into_a_trusted_folder()
    {
        const string sneaky = @"C:\Users\student\..\..\Windows\System32\..\Temp\evil.exe"; // resolves to C:\Windows\Temp
        Assert.Equal(DecisionKind.Block, Matcher(Array.Empty<AllowedProcess>()).Evaluate(Proc(sneaky)).Kind);
    }

    // ---- critical processes and unresolved paths -------------------------

    [Theory]
    [InlineData("csrss.exe")]
    [InlineData("lsass.exe")]
    [InlineData("System")]
    [InlineData("Registry")]
    [InlineData("Memory Compression")]
    public void Critical_processes_are_always_allowed_even_without_a_path(string name)
    {
        var proc = new ProcInfo(Pid: 4, Name: name, ImagePath: null, ParentPid: 0, SessionId: 0);

        Assert.Equal(DecisionKind.Allow, Matcher(Array.Empty<AllowedProcess>()).Evaluate(proc).Kind);
    }

    [Fact]
    public void Unknown_process_with_no_resolvable_path_is_blocked()
    {
        var proc = new ProcInfo(Pid: 500, Name: "mystery.exe", ImagePath: null, ParentPid: 1, SessionId: 1);

        Assert.Equal(DecisionKind.Block, Matcher(Array.Empty<AllowedProcess>()).Evaluate(proc).Kind);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Blank_path_is_treated_as_unresolved(string path)
    {
        var proc = new ProcInfo(Pid: 500, Name: "x.exe", ImagePath: path, ParentPid: 1, SessionId: 1);

        Assert.Equal(DecisionKind.Block, Matcher(Array.Empty<AllowedProcess>()).Evaluate(proc).Kind);
    }
}
