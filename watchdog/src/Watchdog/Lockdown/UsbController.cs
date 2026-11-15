using Microsoft.Win32;

namespace Watchdog.Lockdown;

public interface IUsbController
{
    (bool ok, string message) DisableUsbStorage();
    (bool ok, string message) RestoreUsbStorage();
}

/// <summary>
/// Disables/enables USB mass storage via registry policy (Windows, admin required).
/// HKLM\SYSTEM\CurrentControlSet\Services\USBSTOR Start: 3=enabled, 4=disabled.
/// </summary>
public sealed class UsbController : IUsbController
{
    private readonly Watchdog.State.RestoreAll _restore;
    private readonly ILogger<UsbController> _log;
    private const string KeyPath = @"SYSTEM\CurrentControlSet\Services\USBSTOR";
    private const string ValueName = "Start";

    public UsbController(Watchdog.State.RestoreAll restore, ILogger<UsbController>? logger = null)
    {
        _restore = restore;
        _log = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<UsbController>.Instance;
    }

    public (bool ok, string message) DisableUsbStorage()
    {
        if (!OperatingSystem.IsWindows()) return (false, "USB control supported on Windows only");
        try
        {
            using var key = Registry.LocalMachine.CreateSubKey(KeyPath, writable: true);
            if (key == null) return (false, "Cannot open USBSTOR registry key");
            key.SetValue(ValueName, 4, RegistryValueKind.DWord);
            _restore.Save(s => { s.UsbStorageDisabled = true; s.LockedAt ??= DateTimeOffset.UtcNow; });
            return (true, "USB storage disabled (USBSTOR Start=4)");
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to disable USB storage");
            return (false, ex.Message);
        }
    }

    public (bool ok, string message) RestoreUsbStorage()
    {
        if (!OperatingSystem.IsWindows()) { _restore.Save(s => s.UsbStorageDisabled = false); return (true, "No-op on non-Windows"); }
        try
        {
            using var key = Registry.LocalMachine.CreateSubKey(KeyPath, writable: true);
            if (key == null) return (false, "Cannot open USBSTOR registry key");
            key.SetValue(ValueName, 3, RegistryValueKind.DWord);
            _restore.Save(s => s.UsbStorageDisabled = false);
            return (true, "USB storage re-enabled (USBSTOR Start=3)");
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to restore USB storage");
            return (false, ex.Message);
        }
    }
}
