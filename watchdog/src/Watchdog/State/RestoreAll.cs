using System.Text.Json;

namespace Watchdog.State;

/// <summary>
/// Records reversible system changes made during lockdown so Teardown/restore-pc can undo them.
/// State is persisted to disk; on service restart, call RestoreIfNeeded() before starting a new session.
/// </summary>
public sealed class RestoreAll
{
    private readonly string _stateFile;
    private readonly object _gate = new();

    public sealed class RestoreState
    {
        public bool FirewallModified { get; set; }
        public string? FirewallPreviousPolicy { get; set; }
        public bool UsbStorageDisabled { get; set; }
        public bool ShellLocked { get; set; }
        public string? PreviousShell { get; set; }
        public string? PreviousTaskMgr { get; set; }
        public DateTimeOffset? LockedAt { get; set; }
    }

    public RestoreState Current { get; private set; } = new();

    public RestoreAll(string stateDir)
    {
        Directory.CreateDirectory(stateDir);
        _stateFile = Path.Combine(stateDir, "restore-state.json");
        Load();
    }

    private void Load()
    {
        lock (_gate)
        {
            if (!File.Exists(_stateFile)) { Current = new RestoreState(); return; }
            try { Current = JsonSerializer.Deserialize<RestoreState>(File.ReadAllText(_stateFile)) ?? new RestoreState(); }
            catch { Current = new RestoreState(); }
        }
    }

    public void Save(Action<RestoreState> mutate)
    {
        lock (_gate)
        {
            mutate(Current);
            File.WriteAllText(_stateFile, JsonSerializer.Serialize(Current, new JsonSerializerOptions { WriteIndented = true }));
        }
    }

    public bool HasPendingRestore => Current.FirewallModified || Current.UsbStorageDisabled || Current.ShellLocked;

    public void MarkClean()
    {
        lock (_gate)
        {
            Current = new RestoreState();
            if (File.Exists(_stateFile)) File.Delete(_stateFile);
        }
    }
}
