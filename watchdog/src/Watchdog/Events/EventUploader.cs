using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Watchdog.Events;

public sealed class EventUploader : IDisposable
{
    private readonly ServerEventSink _sink;
    private readonly HttpClient _http;
    private readonly TimeSpan _interval;
    private readonly ILogger<EventUploader> _log;
    private CancellationTokenSource? _cts;
    private Task? _loop;

    public EventUploader(ServerEventSink sink, HttpClient? http = null, TimeSpan? interval = null, ILogger<EventUploader>? logger = null)
    {
        _sink = sink;
        _http = http ?? new HttpClient();
        _interval = interval ?? TimeSpan.FromSeconds(2);
        _log = logger ?? NullLogger<EventUploader>.Instance;
    }

    public void Start()
    {
        if (_loop != null) return;
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => RunAsync(_cts.Token));
    }

    public async Task StopAsync()
    {
        if (_cts == null) return;
        _cts.Cancel();
        if (_loop != null) try { await _loop; } catch { }
        await FlushAsync(CancellationToken.None);
        _cts.Dispose(); _cts = null; _loop = null;
    }

    public async Task FlushAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var batch = _sink.Pending(50);
            if (batch.Count == 0) return;
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, _sink.ServerUrl + "/events/ingest")
                {
                    Content = JsonContent.Create(new
                    {
                        sessionId = _sink.SessionId,
                        events = batch.Select(e => new
                        {
                            seq = e.Seq,
                            type = e.Type,
                            severity = e.Severity,
                            ts = e.Ts,
                            payloadJson = e.PayloadJson,
                            prevHash = e.PrevHash,
                            hash = e.Hash,
                            hmac = e.Hmac
                        })
                    })
                };
                var token = _sink.AccessToken;
                if (!string.IsNullOrWhiteSpace(token)) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using var res = await _http.SendAsync(req, ct);
                var body = await res.Content.ReadAsStringAsync(ct);
                if (res.IsSuccessStatusCode)
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(body);
                        if (doc.RootElement.TryGetProperty("nextSeq", out var ns) && ns.TryGetInt64(out var next)) _sink.Ack(next - 1);
                        else _sink.Ack(batch[^1].Seq);
                    }
                    catch { _sink.Ack(batch[^1].Seq); }
                }
                else
                {
                    _log.LogWarning("Event ingest failed: {Status} {Body}", (int)res.StatusCode, body);
                    return; // retry later (could be final integrity/auth error)
                }
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "Event upload error");
                return;
            }
        }
    }

    private async Task RunAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(_interval);
        try
        {
            while (await timer.WaitForNextTickAsync(ct)) await FlushAsync(ct);
        }
        catch (OperationCanceledException) { }
    }

    public void Dispose()
    {
        try { _cts?.Cancel(); } catch { }
        _http.Dispose();
    }
}
