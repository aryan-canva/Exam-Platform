using System.Text.Json;
using System.Text.Json.Nodes;

namespace Watchdog.Events;

/// <summary>
/// Server-compatible, thread-safe event sink: builds canonical payload JSON, signs, appends to journal,
/// and exposes batches for upload. Also implements IEventSink for ProcessMonitor.
/// </summary>
public sealed class ServerEventSink : IStringEventSink, IDisposable
{
    private readonly object _gate = new();
    private readonly byte[] _sessionKey;
    private readonly EventJournal _journal;
    private readonly TimeProvider _time;

    public string SessionId { get; }
    public string ServerUrl { get; private set; }
    public string? AccessToken { get; private set; }

    private long _nextSeq;
    private string _prevHash;
    private bool _disposed;

    public event Action<SignedServerEvent>? Recorded;

    public ServerEventSink(string sessionId, byte[] sessionKey, string stateDir, string serverUrl, string? accessToken = null, TimeProvider? time = null)
    {
        SessionId = sessionId;
        _sessionKey = sessionKey;
        ServerUrl = serverUrl.TrimEnd('/');
        AccessToken = accessToken;
        _time = time ?? TimeProvider.System;
        _journal = new EventJournal(stateDir, sessionId);
        (_nextSeq, _prevHash) = _journal.Tail();
    }

    public void SetAccessToken(string token) { lock (_gate) AccessToken = token; }

    public void Emit(EventType type, Severity severity, IReadOnlyDictionary<string, object?> payload)
        => Emit(type.ToString(), severity.ToString(), payload);

    public void Emit(string type, string severity, IReadOnlyDictionary<string, object?> payload)
    {
        if (_disposed) return;
        SignedServerEvent rec;
        lock (_gate)
        {
            var ts = _time.GetUtcNow().UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
            var frozen = CanonicalJson.ToNode(new Dictionary<string, object?>(payload)) ?? new JsonObject();
            var payloadJson = CanonicalJson.Serialize(frozen);
            var hash = ServerEventChain.ComputeHash(_prevHash, type, severity, ts, payloadJson);
            var hmac = ServerEventChain.ComputeHmacHex(_sessionKey, hash);
            rec = new SignedServerEvent(_nextSeq, type, severity, ts, payloadJson, _prevHash, hash, hmac);
            _journal.Append(rec);
            _prevHash = hash;
            _nextSeq++;
        }
        try { Recorded?.Invoke(rec); } catch { /* listeners must not break event path */ }
    }

    public IReadOnlyList<SignedServerEvent> Pending(int max = 50) { lock (_gate) return _journal.Pending(max); }
    public void Ack(long lastSeq) { lock (_gate) _journal.Ack(lastSeq); }
    public int PendingCount => _journal.PendingCount;

    public void Dispose() { _disposed = true; }
}
