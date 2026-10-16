using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Watchdog.Harness;

/// <summary>An AppError { code, message, details } from the server, or a transport failure (Code = "NETWORK").</summary>
internal sealed class ServerException : Exception
{
    public string Code { get; }
    public HttpStatusCode? Status { get; }

    public ServerException(string code, string message, HttpStatusCode? status = null, Exception? inner = null)
        : base(message, inner)
    {
        Code = code;
        Status = status;
    }

    /// <summary>Worth trying again later: the server was unreachable, overloaded, or throttling us.</summary>
    public bool IsTransient =>
        Code is "NETWORK" or "RATE_LIMITED" || (Status is { } s && (int)s >= 500);
}

internal sealed record StartedSession(string SessionId, byte[] SessionKey);

/// <summary>
/// Just enough of the REST surface (LLD 3.19) for the harness:
///   POST /auth/login, POST /sessions/start, POST /sessions/{id}/events, POST /sessions/{id}/end.
/// Request and response shapes follow the LLD. Confirm them against docs/openapi.yaml once Person 1
/// publishes it: the places that depend on a guess are marked ASSUMED.
/// </summary>
internal sealed class ServerClient : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private string? _accessToken;

    public ServerClient(Uri baseUri, HttpMessageHandler? handler = null)
    {
        _http = handler is null ? new HttpClient() : new HttpClient(handler, disposeHandler: false);
        _http.BaseAddress = baseUri;
        _http.Timeout = TimeSpan.FromSeconds(10);
    }

    public void UseToken(string accessToken)
    {
        _accessToken = accessToken;
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
    }

    public async Task LoginAsync(string username, string password, string deviceFp, CancellationToken ct)
    {
        using var doc = await SendAsync(HttpMethod.Post, "/auth/login",
            new { username, password, deviceFp }, ct);

        var token = doc.RootElement.TryGetProperty("accessToken", out var t) ? t.GetString() : null;
        if (string.IsNullOrEmpty(token))
            throw new ServerException("PROTOCOL", "Login response has no accessToken.");
        UseToken(token);
    }

    public async Task<StartedSession> StartSessionAsync(string contestId, string deviceFp, CancellationToken ct)
    {
        // The harness does no real preflight: these values are canned, and say so via clientVersion.
        var preflight = new
        {
            vm = false,
            vmEvidence = Array.Empty<string>(),
            monitorCount = 1,
            remoteTools = Array.Empty<string>(),
            usbStorage = Array.Empty<string>(),
            forbiddenRunning = Array.Empty<string>(),
            safeMode = false,
            osBuild = Environment.OSVersion.Version.ToString(),
            clientVersion = ClientVersion,
        };

        using var doc = await SendAsync(HttpMethod.Post, "/sessions/start",
            new { contestId, deviceFp, clientVersion = ClientVersion, preflight }, ct);

        var root = doc.RootElement;
        var sessionId = root.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null;
        var keyText = root.TryGetProperty("sessionKey", out var sk) ? sk.GetString() : null;
        if (string.IsNullOrEmpty(sessionId) || string.IsNullOrEmpty(keyText))
            throw new ServerException("PROTOCOL", "Start-session response is missing sessionId or sessionKey.");

        return new StartedSession(sessionId, KeyCodec.Decode(keyText));
    }

    /// <summary>
    /// POST /sessions/{id}/events with the batch as a bare JSON array (ASSUMED; the LLD says
    /// "batch" without a wrapper). Returns the server's lastSeq. The server is idempotent on
    /// (sessionId, seq), so re-sending after a timeout is safe.
    /// </summary>
    public async Task<int> PostEventsAsync(string sessionId, IReadOnlyList<EventRecord> batch, CancellationToken ct)
    {
        using var doc = await SendAsync(HttpMethod.Post, $"/sessions/{Uri.EscapeDataString(sessionId)}/events", batch, ct);

        return doc.RootElement.TryGetProperty("lastSeq", out var last) && last.TryGetInt32(out var seq)
            ? seq
            : throw new ServerException("PROTOCOL", "Events response has no lastSeq.");
    }

    public async Task EndSessionAsync(string sessionId, string reason, CancellationToken ct)
    {
        using var _ = await SendAsync(HttpMethod.Post, $"/sessions/{Uri.EscapeDataString(sessionId)}/end", new { reason }, ct);
    }

    public const string ClientVersion = "harness-0.1";

    public void Dispose() => _http.Dispose();

    private async Task<JsonDocument> SendAsync(HttpMethod method, string path, object body, CancellationToken ct)
    {
        try
        {
            using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body, options: Json) };
            using var response = await _http.SendAsync(request, ct);
            var text = await response.Content.ReadAsStringAsync(ct);

            if (!response.IsSuccessStatusCode)
                throw ToServerException(response.StatusCode, text);

            return JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
        }
        catch (HttpRequestException ex)
        {
            throw new ServerException("NETWORK", $"Cannot reach the server: {ex.Message}", inner: ex);
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            throw new ServerException("NETWORK", "The server did not answer in time.", inner: ex);
        }
        catch (JsonException ex)
        {
            throw new ServerException("PROTOCOL", $"The server sent invalid JSON: {ex.Message}", inner: ex);
        }
    }

    private static ServerException ToServerException(HttpStatusCode status, string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("code", out var code))
            {
                var message = root.TryGetProperty("message", out var m) ? m.GetString() : null;
                return new ServerException(code.GetString() ?? "ERROR", message ?? $"HTTP {(int)status}", status);
            }
        }
        catch (JsonException)
        {
            // not an AppError body: fall through
        }
        return new ServerException("HTTP_" + (int)status, $"HTTP {(int)status} {status}", status);
    }
}

/// <summary>
/// The LLD says the session key is "a random 256-bit key" without saying how it travels in JSON.
/// ASSUMED: base64, or 64 hex characters. A 32-byte key is 44 base64 characters, so the two
/// forms cannot be confused.
/// </summary>
internal static class KeyCodec
{
    public static byte[] Decode(string text)
    {
        text = text.Trim();
        try
        {
            if (text.Length == 64 && text.All(Uri.IsHexDigit))
                return Convert.FromHexString(text);
            return Convert.FromBase64String(text);
        }
        catch (FormatException ex)
        {
            throw new ServerException("PROTOCOL", "sessionKey is neither base64 nor hex.", inner: ex);
        }
    }
}

/// <summary>
/// Sends pending records in batches of up to 500 (LLD limit), backs off on transient failures,
/// and stops for good on errors that retrying cannot fix (CHAIN_BREAK, AUTH_INVALID, ...).
/// </summary>
internal sealed class EventUploader
{
    public const int MaxBatch = 500;

    private readonly SignedEventSink _sink;
    private readonly ServerClient _server;
    private readonly string _sessionId;
    private readonly TimeSpan _tick;
    private readonly TimeSpan _maxBackoff;

    public EventUploader(
        SignedEventSink sink, ServerClient server, string sessionId,
        TimeSpan? tick = null, TimeSpan? maxBackoff = null)
    {
        _sink = sink;
        _server = server;
        _sessionId = sessionId;
        _tick = tick ?? TimeSpan.FromSeconds(1);
        _maxBackoff = maxBackoff ?? TimeSpan.FromSeconds(10);
    }

    /// <summary>Set when the uploader gave up. Null while healthy.</summary>
    public ServerException? Fatal { get; private set; }

    public event Action<string>? Info;

    /// <summary>One pass: send everything pending. Throws ServerException on failure.</summary>
    public async Task FlushAsync(CancellationToken ct)
    {
        while (true)
        {
            var batch = _sink.Pending(MaxBatch);
            if (batch.Count == 0) return;

            int lastSeq = await _server.PostEventsAsync(_sessionId, batch, ct);
            _sink.Ack(lastSeq);

            if (lastSeq < batch[^1].Seq) return; // server took only part of it: try again on the next tick
        }
    }

    /// <summary>Background loop until cancelled or a fatal error.</summary>
    public async Task RunAsync(CancellationToken ct)
    {
        var backoff = _tick;
        try
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    await FlushAsync(ct);
                    backoff = _tick;
                }
                catch (ServerException ex) when (ex.IsTransient)
                {
                    Info?.Invoke($"upload will retry in {backoff.TotalSeconds:0.#}s ({ex.Code}: {ex.Message})");
                    await Task.Delay(backoff, ct);
                    backoff = TimeSpan.FromTicks(Math.Min(backoff.Ticks * 2, _maxBackoff.Ticks));
                    continue;
                }
                catch (ServerException ex)
                {
                    Fatal = ex; // retrying identical bytes will not change the answer
                    return;
                }

                await Task.Delay(_tick, ct);
            }
        }
        catch (OperationCanceledException)
        {
            // normal shutdown
        }
    }
}
