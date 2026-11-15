using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Watchdog.Service;

public sealed class WatchdogServerClient : IDisposable
{
    private readonly HttpClient _http;
    public string BaseUrl { get; }
    public string? AccessToken { get; private set; }

    public WatchdogServerClient(string baseUrl, HttpClient? http = null)
    {
        BaseUrl = baseUrl.TrimEnd('/');
        _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    }

    public void SetToken(string token) => AccessToken = token;

    public async Task<string> LoginAsync(string username, string password, CancellationToken ct = default)
    {
        using var res = await _http.PostAsJsonAsync(BaseUrl + "/auth/login", new { username, password }, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"Login failed: {(int)res.StatusCode} {body}");
        using var doc = JsonDocument.Parse(body);
        var token = doc.RootElement.TryGetProperty("accessToken", out var t) ? t.GetString() : null;
        if (string.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("Login response missing accessToken");
        AccessToken = token;
        return token;
    }

    public async Task<(string SessionId, string SessionKey, JsonElement Raw)> StartSessionAsync(string contestId, string deviceFp, string clientVersion, CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, BaseUrl + "/sessions/start")
        {
            Content = JsonContent.Create(new { contestId, deviceFp, clientVersion })
        };
        Auth(req);
        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"Start session failed: {(int)res.StatusCode} {body}");
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement.Clone();
        var id = root.TryGetProperty("id", out var sid) ? sid.GetString() : root.TryGetProperty("sessionId", out sid) ? sid.GetString() : null;
        var key = root.TryGetProperty("sessionKey", out var sk) ? sk.GetString() : null;
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(key)) throw new InvalidOperationException("Session start missing id/sessionKey");
        return (id!, key!, root);
    }

    public async Task HeartbeatAsync(string sessionId, long seq, CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, BaseUrl + $"/sessions/{Uri.EscapeDataString(sessionId)}/heartbeat")
        { Content = JsonContent.Create(new { seq }) };
        Auth(req);
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Heartbeat failed: {(int)res.StatusCode} {body}");
        }
    }

    public async Task EndSessionAsync(string sessionId, CancellationToken ct = default)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, BaseUrl + $"/sessions/{Uri.EscapeDataString(sessionId)}/end")
        { Content = JsonContent.Create(new { }) };
        Auth(req);
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"End session failed: {(int)res.StatusCode} {body}");
        }
    }

    private void Auth(HttpRequestMessage req)
    {
        if (!string.IsNullOrWhiteSpace(AccessToken))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken);
    }

    public void Dispose() => _http.Dispose();
}
