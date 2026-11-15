// Legacy compatibility shim.
using System.Text.Json.Nodes;

namespace Watchdog.Legacy;

public record EventDraft(string EventId, string SessionId, long Seq, string Type, string Severity, string Ts, JsonNode? Payload);

public class EventBuilder
{
    readonly string _sessionId; long _seq;
    readonly Func<DateTime> _now;
    public EventBuilder(string sessionId, Func<DateTime>? now = null) { _sessionId = sessionId; _now = now ?? (() => DateTime.UtcNow); }
    public EventDraft Create(string type, string severity, JsonNode? payload)
    {
        var seq = Interlocked.Increment(ref _seq);
        return new($"e-{seq}", _sessionId, seq, type, severity, _now().ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"), payload);
    }
}
