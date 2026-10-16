using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Watchdog.Lockdown;

public interface IFileHasher
{
    /// <summary>Lower-case hex SHA-256 of the file, or null if it cannot be read.</summary>
    string? Sha256Of(string path);
}

public interface ISignerVerifier
{
    /// <summary>True only if the file carries a valid Authenticode signature from <paramref name="signer"/>.</summary>
    bool IsSignedBy(string imagePath, string signer);
}

/// <summary>
/// Week-1 default: signer entries never match (fail closed). Replace with a WinVerifyTrust-based
/// verifier before relying on Policy.allowedProcesses[].signer.
/// </summary>
public sealed class DenySignerVerifier : ISignerVerifier
{
    public bool IsSignedBy(string imagePath, string signer) => false;
}

/// <summary>SHA-256 with a (path, size, mtime) cache so svchost and friends are hashed once.</summary>
public sealed class CachingFileHasher : IFileHasher
{
    private readonly ConcurrentDictionary<string, (long Length, DateTime LastWriteUtc, string Hash)> _cache
        = new(StringComparer.OrdinalIgnoreCase);

    public string? Sha256Of(string path)
    {
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists) return null;

            if (_cache.TryGetValue(path, out var hit)
                && hit.Length == info.Length
                && hit.LastWriteUtc == info.LastWriteTimeUtc)
                return hit.Hash;

            // ReadWrite|Delete: the file is a running exe, other handles are open on it.
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete);
            var hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            _cache[path] = (info.Length, info.LastWriteTimeUtc, hash);
            return hash;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}

/// <summary>Folders whose contents count as "part of Windows".</summary>
public sealed record OsBaseline(string WindowsDir, string System32, string SysWow64, string SystemApps)
{
    public static OsBaseline FromEnvironment()
    {
        var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        return new OsBaseline(
            windows,
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            Environment.GetFolderPath(Environment.SpecialFolder.SystemX86),
            Path.Combine(windows, "SystemApps"));
    }
}

/// <summary>
/// Decides Allow or Block for one process. No OS calls except through the injected hasher and
/// signer, so every rule is unit-testable.
///
/// Order of rules (first match wins):
///   1. Critical OS process (csrss, lsass, ...)          -> Allow. Never killed, even if misconfigured.
///   2. Policy allowlist: name matches AND (sha256 matches OR signer verifies) -> Allow.
///   3. OS baseline: file is in System32 / SysWOW64 / SystemApps / the Windows folder itself
///      AND is not on the denied-tools list (built in, plus any extra names the caller passes,
///      for example Policy.preflight.forbiddenProcesses)  -> Allow.
///   4. Everything else                                    -> Block.
///
/// A renamed binary fails rule 2 (hash mismatch) and rule 3 (wrong folder), so it is blocked.
/// Known weak spot for week 1: rule 3 trusts a folder, not a signature. A student who can write
/// into System32 can bypass it, but then they are admin and the whole model is lost anyway.
/// The Authenticode check (ISignerVerifier) is the proper fix.
/// </summary>
public sealed class AllowlistMatcher
{
    private static readonly char[] PathChars = { '\\', '/', ':' };

    // Killing these bluescreens the machine or logs the user off.
    private static readonly HashSet<string> Critical = new(StringComparer.OrdinalIgnoreCase)
    {
        "System", "Registry", "Secure System", "Memory Compression",
        "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe", "lsass.exe",
    };

    // Ship with Windows, live in trusted folders, but must not run during an exam.
    // rundll32.exe is deliberately absent: Windows itself launches it all the time.
    private static readonly HashSet<string> DeniedOsTools = new(StringComparer.OrdinalIgnoreCase)
    {
        // shells and scripting hosts
        "cmd.exe", "powershell.exe", "pwsh.exe", "powershell_ise.exe", "wscript.exe", "cscript.exe",
        "mshta.exe", "wsl.exe", "bash.exe",
        // admin consoles and process tools
        "taskmgr.exe", "regedit.exe", "reg.exe", "mmc.exe", "msconfig.exe", "control.exe",
        "perfmon.exe", "resmon.exe", "eventvwr.exe", "wmic.exe", "schtasks.exe", "sc.exe",
        "net.exe", "net1.exe", "tasklist.exe", "taskkill.exe",
        // network and remote-access tools
        "mstsc.exe", "msra.exe", "quickassist.exe", "ssh.exe", "scp.exe", "sftp.exe", "curl.exe",
        "ftp.exe", "telnet.exe", "bitsadmin.exe", "certutil.exe", "netsh.exe",
        // editors, calculators, screenshots
        "notepad.exe", "wordpad.exe", "write.exe", "calc.exe", "mspaint.exe", "snippingtool.exe",
    };

    private readonly IReadOnlyList<AllowedProcess> _entries;
    private readonly IFileHasher _hasher;
    private readonly ISignerVerifier _signer;
    private readonly OsBaseline _os;
    private readonly bool _allowNameOnlyEntries;
    private readonly HashSet<string> _denied;

    public AllowlistMatcher(
        IEnumerable<AllowedProcess> entries,
        IFileHasher hasher,
        ISignerVerifier signer,
        OsBaseline os,
        bool allowNameOnlyEntries = false,
        IEnumerable<string>? extraDeniedProcesses = null)
    {
        _entries = entries.ToList();
        _hasher = hasher;
        _signer = signer;
        _allowNameOnlyEntries = allowNameOnlyEntries;

        _denied = new HashSet<string>(DeniedOsTools, StringComparer.OrdinalIgnoreCase);
        foreach (var name in extraDeniedProcesses ?? Array.Empty<string>())
        {
            var trimmed = name.Trim();
            if (trimmed.Length == 0) continue;
            _denied.Add(Path.HasExtension(trimmed) ? trimmed : trimmed + ".exe"); // "notepad" means notepad.exe
        }
        _os = new OsBaseline(
            os.WindowsDir.TrimEnd('\\'), os.System32.TrimEnd('\\'),
            os.SysWow64.TrimEnd('\\'), os.SystemApps.TrimEnd('\\'));

        HonoredEntryCount = _entries.Count(IsHonored);
    }

    /// <summary>Entries that can actually match something. Zero means every non-OS process is blocked.</summary>
    public int HonoredEntryCount { get; }

    public static bool IsCritical(string processName) =>
        Critical.Contains(processName) || Critical.Contains(processName + ".exe");

    public Decision Evaluate(ProcInfo proc)
    {
        if (IsCritical(proc.Name))
            return Decision.Allow("critical OS process (never terminated)");

        var normalized = Normalize(proc.ImagePath);
        if (normalized is null)
            return Decision.Block("image path could not be resolved");
        string path = normalized;
        string fileName = Path.GetFileName(path);

        // Hash at most once per evaluation, and only if some entry needs it.
        string? hash = null;
        bool hashed = false;
        string? Hash()
        {
            if (!hashed) { hash = _hasher.Sha256Of(path); hashed = true; }
            return hash;
        }

        foreach (var entry in _entries)
        {
            if (!NameMatches(entry.Name, path, fileName)) continue;

            bool hasHash = !string.IsNullOrWhiteSpace(entry.Sha256);
            bool hasSigner = !string.IsNullOrWhiteSpace(entry.Signer);

            if (!hasHash && !hasSigner)
            {
                if (_allowNameOnlyEntries) return Decision.Allow($"allowlist (name only): {entry.Name}");
                continue; // a bare name proves nothing: any renamed binary would pass
            }

            if (hasHash && string.Equals(Hash(), entry.Sha256!.Trim(), StringComparison.OrdinalIgnoreCase))
                return Decision.Allow($"allowlist (sha256): {entry.Name}");

            if (hasSigner && _signer.IsSignedBy(path, entry.Signer!))
                return Decision.Allow($"allowlist (signer): {entry.Name}");
        }

        if (IsTrustedOsLocation(path))
        {
            return _denied.Contains(fileName)
                ? Decision.Block($"OS tool not permitted during the exam: {fileName}")
                : Decision.Allow("OS baseline");
        }

        return Decision.Block("not in allowlist");
    }

    private bool IsHonored(AllowedProcess e) =>
        !string.IsNullOrWhiteSpace(e.Sha256)
        || !string.IsNullOrWhiteSpace(e.Signer)
        || _allowNameOnlyEntries;

    private bool IsTrustedOsLocation(string path) =>
        IsUnder(path, _os.System32)
        || IsUnder(path, _os.SysWow64)
        || IsUnder(path, _os.SystemApps)
        // Files directly in C:\Windows (explorer.exe), NOT its subfolders: C:\Windows\Temp is user-writable.
        || string.Equals(Path.GetDirectoryName(path), _os.WindowsDir, StringComparison.OrdinalIgnoreCase);

    private static bool IsUnder(string path, string dir) =>
        path.StartsWith(dir + "\\", StringComparison.OrdinalIgnoreCase);

    private static bool NameMatches(string entryName, string path, string fileName)
    {
        var name = Environment.ExpandEnvironmentVariables(entryName.Trim());
        if (name.IndexOfAny(PathChars) >= 0)
            return string.Equals(Normalize(name), path, StringComparison.OrdinalIgnoreCase); // full-path entry
        return string.Equals(name, fileName, StringComparison.OrdinalIgnoreCase);
    }

    private static string? Normalize(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        try { return Path.GetFullPath(path.Trim()); }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or IOException) { return null; }
    }
}
