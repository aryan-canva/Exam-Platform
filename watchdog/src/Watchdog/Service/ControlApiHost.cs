using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Watchdog.Service;

/// <summary>
/// Minimal local HTTP control API for testing/automation (start/stop/status/emit/restore).
/// Bind to localhost by default.
/// </summary>
public sealed class ControlApiHost : IAsyncDisposable
{
    private readonly HttpListener _listener = new();
    private readonly SessionController _session;
    private readonly TeardownManager _teardown;
    private readonly Watchdog.State.RestoreAll _restore;
    private readonly ILogger<ControlApiHost> _log;
    private CancellationTokenSource? _cts;
    private Task? _loop;

    public string Prefix { get; }

    public ControlApiHost(string host, int port, SessionController session, TeardownManager teardown, Watchdog.State.RestoreAll restore, ILogger<ControlApiHost>? logger = null)
    {
        Prefix = $"http://{host}:{port}/";
        _listener.Prefixes.Add(Prefix);
        _session = session;
        _teardown = teardown;
        _restore = restore;
        _log = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<ControlApiHost>.Instance;
    }

    public void Start()
    {
        _listener.Start();
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => LoopAsync(_cts.Token));
        _log.LogInformation("Control API listening at {Prefix}", Prefix);
    }

    private async Task LoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            HttpListenerContext? ctx = null;
            try { ctx = await _listener.GetContextAsync().WaitAsync(ct); }
            catch { break; }
            _ = Task.Run(() => HandleAsync(ctx), ct);
        }
    }

    private async Task HandleAsync(HttpListenerContext ctx)
    {
        try
        {
            var path = ctx.Request.Url?.AbsolutePath ?? "/";
            var method = ctx.Request.HttpMethod.ToUpperInvariant();
            object? result = (method, path) switch
            {
                ("GET", "/health") => new { ok = true, service = "watchdog", time = DateTimeOffset.UtcNow },
                ("GET", "/status") => _session.Status(),
                ("POST", "/session/start") => await StartAsync(ctx.Request),
                ("POST", "/session/stop") => await _session.StopAsync(await ReadReasonAsync(ctx.Request)),
                ("POST", "/event") => Emit(ctx.Request),
                ("POST", "/restore") => await RestoreAsync(),
                _ => new { error = "not found", path, method }
            };
            await WriteJsonAsync(ctx, result, path == "/" ? 404 : 200);
        }
        catch (Exception ex)
        {
            try { await WriteJsonAsync(ctx, new { ok = false, error = ex.Message }, 400); } catch { }
        }
        finally { try { ctx.Response.OutputStream.Close(); } catch { } }
    }

    private async Task<object> StartAsync(HttpListenerRequest req)
    {
        using var doc = await JsonDocument.ParseAsync(req.InputStream);
        var root = doc.RootElement;
        var contestId = root.GetProperty("contestId").GetString() ?? throw new ArgumentException("contestId required");
        var username = root.TryGetProperty("username", out var u) ? u.GetString() : null;
        var password = root.TryGetProperty("password", out var p) ? p.GetString() : null;
        var token = root.TryGetProperty("accessToken", out var t) ? t.GetString() : null;
        return await _session.StartAsync(contestId, username, password, token);
    }

    private async Task<string> ReadReasonAsync(HttpListenerRequest req)
    {
        try
        {
            using var doc = await JsonDocument.ParseAsync(req.InputStream);
            if (doc.RootElement.TryGetProperty("reason", out var r)) return r.GetString() ?? "stopped";
        }
        catch { }
        return "stopped";
    }

    private object Emit(HttpListenerRequest req)
    {
        using var doc = JsonDocument.Parse(req.InputStream);
        var root = doc.RootElement;
        var type = root.GetProperty("type").GetString() ?? "INFO";
        var severity = root.TryGetProperty("severity", out var s) ? s.GetString() ?? "INFO" : "INFO";
        var payload = new Dictionary<string, object?>();
        if (root.TryGetProperty("payload", out var p) && p.ValueKind == JsonValueKind.Object)
        {
            payload = JsonSerializer.Deserialize<Dictionary<string, object?>>(p.GetRawText()) ?? payload;
        }
        _session.Emit(type, severity, payload);
        return new { ok = true, emitted = type };
    }

    private async Task<object> RestoreAsync()
    {
        var r = await _teardown.TeardownAsync("manual-restore");
        _restore.MarkClean();
        return new { ok = r.ok, message = r.message };
    }

    private static async Task WriteJsonAsync(HttpListenerContext ctx, object? obj, int status)
    {
        var json = JsonSerializer.Serialize(obj, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var bytes = Encoding.UTF8.GetBytes(json);
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.OutputStream.WriteAsync(bytes);
    }

    public async ValueTask DisposeAsync()
    {
        try { _cts?.Cancel(); } catch { }
        try { _listener.Stop(); } catch { }
        try { _listener.Close(); } catch { }
        if (_loop != null) try { await _loop; } catch { }
        _cts?.Dispose();
    }
}
