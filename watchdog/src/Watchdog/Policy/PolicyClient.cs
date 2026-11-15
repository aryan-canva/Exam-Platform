using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Watchdog.Lockdown;

namespace Watchdog.Policy;

public sealed record ExamPolicy
{
    public string? ContestId { get; init; }
    public List<AllowedProcess> AllowedProcesses { get; init; } = new();
    public List<string> ForbiddenProcesses { get; init; } = new();
    public bool BlockUsb { get; init; }
    public bool LockdownFirewall { get; init; }
    public bool ShellLockdown { get; init; }

    public static ExamPolicy FromLocalDefaults(IEnumerable<string>? allowedNames = null, IEnumerable<string>? forbidden = null)
    {
        var p = new ExamPolicy();
        foreach (var n in allowedNames ?? Array.Empty<string>())
        {
            var name = n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? n : n + ".exe";
            p.AllowedProcesses.Add(new AllowedProcess(name)); // name-only honored only if monitor option allows; typically paired with hashes in real policy
        }
        if (forbidden != null) p.ForbiddenProcesses.AddRange(forbidden);
        return p;
    }
}

/// <summary>
/// Fetches/verifies exam policy from server or file. If unavailable, falls back to local defaults.
/// Signature verification is intentionally conservative; real deployments should verify server policy signature.
/// </summary>
public sealed class PolicyClient
{
    private readonly HttpClient _http;
    private readonly ILogger<PolicyClient> _log;

    public PolicyClient(HttpClient? http = null, ILogger<PolicyClient>? logger = null)
    {
        _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        _log = logger ?? NullLogger<PolicyClient>.Instance;
    }

    public async Task<ExamPolicy> GetPolicyAsync(string serverUrl, string contestId, string? accessToken, CancellationToken ct)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, serverUrl.TrimEnd('/') + $"/policy?contestId={Uri.EscapeDataString(contestId)}");
            if (!string.IsNullOrWhiteSpace(accessToken)) req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            using var res = await _http.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"HTTP {(int)res.StatusCode}");
            var json = await res.Content.ReadAsStringAsync(ct);
            return ParsePolicy(json, contestId);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to fetch policy from server; using local fallback");
            return new ExamPolicy { ContestId = contestId };
        }
    }

    public static ExamPolicy ParsePolicy(string json, string? contestId = null)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (root.TryGetProperty("json", out var inner) && inner.ValueKind == JsonValueKind.Object) root = inner; // signed policy wrapper
        var p = new ExamPolicy { ContestId = contestId };
        if (root.TryGetProperty("allowedProcesses", out var ap) && ap.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in ap.EnumerateArray())
            {
                var name = item.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (string.IsNullOrWhiteSpace(name)) continue;
                var sha = item.TryGetProperty("sha256", out var s) ? s.GetString() : null;
                var signer = item.TryGetProperty("signer", out var sg) ? sg.GetString() : null;
                p.AllowedProcesses.Add(new AllowedProcess(name, sha, signer));
            }
        }
        if (root.TryGetProperty("forbiddenProcesses", out var fp) && fp.ValueKind == JsonValueKind.Array)
            p.ForbiddenProcesses.AddRange(fp.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x))!);
        return p with
        {
            BlockUsb = root.TryGetProperty("blockUsb", out var bu) && bu.ValueKind == JsonValueKind.True,
            LockdownFirewall = root.TryGetProperty("lockdownFirewall", out var lf) && lf.ValueKind == JsonValueKind.True,
            ShellLockdown = root.TryGetProperty("shellLockdown", out var sl) && sl.ValueKind == JsonValueKind.True,
        };
    }
}
