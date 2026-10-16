using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Watchdog.Lockdown;

/// <summary>
/// Everything ProcessMonitor needs from the operating system. One seam, so the decision logic
/// can be unit-tested with a fake and only this file needs a real Windows box.
/// </summary>
public interface IProcessApi
{
    /// <summary>Full image path (null if it cannot be read) and whether the process still exists.</summary>
    (string? ImagePath, bool Exists) QueryImage(int pid);

    int? GetSessionId(int pid);

    /// <summary>All running processes right now (ImagePath may be null for protected ones).</summary>
    IReadOnlyList<ProcInfo> Snapshot();

    /// <summary>
    /// Terminates the process tree. Returns true when the target is no longer running (killed,
    /// already gone, or the pid now belongs to a different program), false when it survived.
    /// If expectedImagePath is given and no longer matches, the pid was reused: leave it alone.
    /// </summary>
    bool Kill(int pid, string? expectedImagePath);

    /// <summary>Calls onStart for every new process, from a thread-pool thread. Dispose to unsubscribe.</summary>
    IDisposable SubscribeProcessStarts(Action<ProcInfo> onStart);
}

/// <summary>
/// WMI for events and snapshots, Win32 for path lookup. Must run elevated (the Watchdog runs as
/// SYSTEM): Win32_ProcessStartTrace is admin-only. WMI delivers the event slightly AFTER the
/// process starts, so a blocked process lives for a few tens of milliseconds. That is the
/// "dies within about a second" budget. ETW would be faster, WMI is enough for week 1.
/// </summary>
public sealed class WindowsProcessApi : IProcessApi
{
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const int ErrorInvalidParameter = 87; // OpenProcess on a pid that does not exist

    private readonly ILogger _log;

    public WindowsProcessApi(ILogger<WindowsProcessApi>? logger = null)
    {
        _log = logger ?? NullLogger<WindowsProcessApi>.Instance;
    }

    public (string? ImagePath, bool Exists) QueryImage(int pid)
    {
        if (pid <= 0) return (null, false);

        IntPtr handle = OpenProcess(ProcessQueryLimitedInformation, false, (uint)pid);
        if (handle == IntPtr.Zero)
        {
            // Invalid parameter = no such pid. Anything else (access denied) = it exists but is protected.
            return (null, Marshal.GetLastWin32Error() != ErrorInvalidParameter);
        }

        try
        {
            var buffer = new StringBuilder(1024);
            uint size = (uint)buffer.Capacity;
            return QueryFullProcessImageNameW(handle, 0, buffer, ref size)
                ? (buffer.ToString(0, (int)size), true)
                : (null, true);
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    public int? GetSessionId(int pid) =>
        pid > 0 && ProcessIdToSessionId((uint)pid, out uint session) ? (int)session : null;

    public IReadOnlyList<ProcInfo> Snapshot()
    {
        var list = new List<ProcInfo>();
        using var searcher = new ManagementObjectSearcher(
            "SELECT ProcessId, ParentProcessId, Name, ExecutablePath, SessionId FROM Win32_Process");
        using var results = searcher.Get();
        foreach (ManagementBaseObject row in results)
        {
            using (row)
            {
                list.Add(new ProcInfo(
                    Pid: Convert.ToInt32(row["ProcessId"]),
                    Name: Convert.ToString(row["Name"]) ?? string.Empty,
                    ImagePath: row["ExecutablePath"] as string,
                    ParentPid: Convert.ToInt32(row["ParentProcessId"]),
                    SessionId: Convert.ToInt32(row["SessionId"])));
            }
        }
        return list;
    }

    public bool Kill(int pid, string? expectedImagePath)
    {
        if (pid <= 4 || pid == Environment.ProcessId) return false;

        try
        {
            var (current, exists) = QueryImage(pid);
            if (!exists) return true;

            // pid reuse guard: between "judged" and "kill" the pid may belong to a new program.
            if (expectedImagePath is not null && current is not null
                && !string.Equals(current, expectedImagePath, StringComparison.OrdinalIgnoreCase))
                return true;

            using var process = Process.GetProcessById(pid);
            if (AllowlistMatcher.IsCritical(process.ProcessName)) return false;

            process.Kill(entireProcessTree: true);
            return process.WaitForExit(1000);
        }
        catch (ArgumentException)
        {
            return true; // GetProcessById: it exited in the meantime
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not terminate process {Pid}", pid);
            return false;
        }
    }

    public IDisposable SubscribeProcessStarts(Action<ProcInfo> onStart)
    {
        // Win32_ProcessStartTrace carries name, pid, parent pid and session, but no image path.
        var watcher = new ManagementEventWatcher(new WqlEventQuery("SELECT * FROM Win32_ProcessStartTrace"));
        watcher.EventArrived += (_, e) =>
        {
            try
            {
                var ev = e.NewEvent;
                onStart(new ProcInfo(
                    Pid: Convert.ToInt32(ev["ProcessID"]),
                    Name: Convert.ToString(ev["ProcessName"]) ?? string.Empty,
                    ImagePath: null,
                    ParentPid: Convert.ToInt32(ev["ParentProcessID"]),
                    SessionId: Convert.ToInt32(ev["SessionID"])));
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Could not handle a process start event");
            }
        };
        watcher.Start(); // throws if the WMI service is down: the caller must treat that as "cannot lock down"
        return new WatcherHandle(watcher);
    }

    private sealed class WatcherHandle(ManagementEventWatcher watcher) : IDisposable
    {
        public void Dispose()
        {
            try { watcher.Stop(); }
            finally { watcher.Dispose(); }
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder exeName, ref uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);
}
