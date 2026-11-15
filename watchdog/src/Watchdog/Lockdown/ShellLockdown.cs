using Microsoft.Win32;

namespace Watchdog.Lockdown;

public interface IShellLockdown
{
    (bool ok, string message) Apply();
    (bool ok, string message) Restore();
}

/// <summary>
/// Best-effort shell/task-manager lockdown for exam sessions (Windows, admin recommended).
/// Disables Task Manager via policy; full shell replacement is environment-specific and recorded.
/// </summary>
public sealed class ShellLockdown : IShellLockdown
{
    private readonly Watchdog.State.RestoreAll _restore;
    private readonly ILogger<ShellLockdown> _log;

    public ShellLockdown(Watchdog.State.RestoreAll restore, ILogger<ShellLockdown>? logger = null)
    {
        _restore = restore;
        _log = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<ShellLockdown>.Instance;
    }

    public (bool ok, string message) Apply()
    {
        if (!OperatingSystem.IsWindows()) return (false, "Shell lockdown supported on Windows only");
        try
        {
            // Disable Task Manager for current user policy
            using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Policies\System", writable: true);
            if (key == null) return (false, "Cannot open Policies\\System key");
            var prev = key.GetValue("DisableTaskMgr")?.ToString();
            key.SetValue("DisableTaskMgr", 1, RegistryValueKind.DWord);
            _restore.Save(s => { s.ShellLocked = true; s.PreviousTaskMgr = prev; s.LockedAt ??= DateTimeOffset.UtcNow; });
            return (true, "Task Manager disabled for exam session");
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to apply shell lockdown");
            return (false, ex.Message);
        }
    }

    public (bool ok, string message) Restore()
    {
        if (!OperatingSystem.IsWindows()) { _restore.Save(s => s.ShellLocked = false); return (true, "No-op on non-Windows"); }
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Policies\System", writable: true);
            if (key != null)
            {
                if (_restore.Current.PreviousTaskMgr == null) key.DeleteValue("DisableTaskMgr", throwOnMissingValue: false);
                else key.SetValue("DisableTaskMgr", int.TryParse(_restore.Current.PreviousTaskMgr, out var v) ? v : 0, RegistryValueKind.DWord);
            }
            _restore.Save(s => { s.ShellLocked = false; s.PreviousTaskMgr = null; });
            return (true, "Shell/task-manager policy restored");
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to restore shell lockdown");
            return (false, ex.Message);
        }
    }
}
