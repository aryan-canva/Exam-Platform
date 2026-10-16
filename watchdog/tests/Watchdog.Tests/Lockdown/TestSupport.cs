using System.Collections.Concurrent;
using Watchdog.Events;
using Watchdog.Lockdown;

namespace Watchdog.Tests.Lockdown;

internal static class TestData
{
    public static readonly OsBaseline Os = new(
        @"C:\Windows", @"C:\Windows\System32", @"C:\Windows\SysWOW64", @"C:\Windows\SystemApps");

    public const string Evil = @"C:\Users\student\Desktop\evil.exe";
    public const string Kiosk = @"C:\Program Files\ExamKiosk\kiosk.exe";

    public static string Hash(char c) => new string(c, 64);
}

internal sealed class FakeHasher : IFileHasher
{
    private readonly Dictionary<string, string> _hashes = new(StringComparer.OrdinalIgnoreCase);

    public FakeHasher Add(string path, string hash)
    {
        _hashes[path] = hash;
        return this;
    }

    public string? Sha256Of(string path) => _hashes.TryGetValue(path, out var h) ? h : null;
}

internal sealed class FakeSigner : ISignerVerifier
{
    public bool Result { get; set; }
    public bool IsSignedBy(string imagePath, string signer) => Result;
}

internal sealed class CapturingSink : IEventSink
{
    public sealed record Captured(EventType Type, Severity Severity, IReadOnlyDictionary<string, object?> Payload);

    private readonly ConcurrentQueue<Captured> _events = new();

    public bool Throw { get; set; }
    public IReadOnlyList<Captured> Events => _events.ToArray();

    public void Emit(EventType type, Severity severity, IReadOnlyDictionary<string, object?> payload)
    {
        if (Throw) throw new InvalidOperationException("sink is down");
        _events.Enqueue(new Captured(type, severity, payload));
    }
}

internal sealed class ManualTime : TimeProvider
{
    public DateTimeOffset Now { get; private set; } = new(2026, 10, 14, 10, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => Now;
    public void Advance(TimeSpan by) => Now += by;
}

/// <summary>A tiny scriptable "Windows". A pid missing from Images is a process that does not exist.</summary>
internal sealed class FakeProcessApi : IProcessApi
{
    public ConcurrentDictionary<int, string?> Images { get; } = new();
    public ConcurrentDictionary<int, int> Sessions { get; } = new();
    public List<ProcInfo> Processes { get; } = new();
    public HashSet<int> Unkillable { get; } = new();
    public ConcurrentQueue<(int Pid, string? ExpectedPath)> KillCalls { get; } = new();
    public bool SubscribeThrows { get; set; }

    public (string? ImagePath, bool Exists) QueryImage(int pid) =>
        Images.TryGetValue(pid, out var path) ? (path, true) : (null, false);

    public int? GetSessionId(int pid) => Sessions.TryGetValue(pid, out var s) ? s : 1;

    public IReadOnlyList<ProcInfo> Snapshot() => Processes.ToList();

    public bool Kill(int pid, string? expectedImagePath)
    {
        KillCalls.Enqueue((pid, expectedImagePath));
        if (Unkillable.Contains(pid)) return false;
        Images.TryRemove(pid, out _);
        return true;
    }

    public IDisposable SubscribeProcessStarts(Action<ProcInfo> onStart)
    {
        if (SubscribeThrows) throw new InvalidOperationException("WMI service is not running");
        return new NoopDisposable();
    }

    private sealed class NoopDisposable : IDisposable
    {
        public void Dispose() { }
    }
}
