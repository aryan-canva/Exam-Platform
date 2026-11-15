// Legacy compatibility shim.
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Watchdog.Legacy;

public record EventRecord(EventDraft D, string PrevHash, string Hash);

public class HashChain
{
    string _prev = new('0', 64);
    readonly object _lock = new();
    public EventRecord Append(EventDraft d)
    {
        lock (_lock)
        {
            var json = Canonical.Json(JsonSerializer.SerializeToNode(new { eventId = d.EventId, sessionId = d.SessionId, seq = d.Seq, type = d.Type, severity = d.Severity, ts = d.Ts, payload = d.Payload }));
            var hash = Canonical.Sha256Hex(_prev + json);
            var rec = new EventRecord(d, _prev, hash);
            _prev = hash;
            return rec;
        }
    }
}
