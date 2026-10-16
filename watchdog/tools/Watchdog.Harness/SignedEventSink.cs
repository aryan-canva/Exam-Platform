using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Watchdog.Events;

namespace Watchdog.Harness;

/// <summary>LLD EventRecord. Field names serialize camelCase: eventId, sessionId, seq, ...</summary>
internal sealed record EventRecord(
    string EventId,
    string SessionId,
    int Seq,
    string Type,
    string Severity,
    string Ts,
    IReadOnlyDictionary<string, object?> Payload,
    string PrevHash,
    string Hash,
    string Hmac);

internal sealed record ChainResult(bool Ok, int? BadSeq, string? Problem)
{
    public static readonly ChainResult Good = new(true, null, null);
    public static ChainResult Bad(int seq, string problem) => new(false, seq, problem);
}

/// <summary>
/// The LLD chain rule: hash = SHA256(prevHash + canonical(event)), hmac = HMAC(sessionKey, hash).
///
/// THREE CHOICES THE LLD LEAVES OPEN. They live here, in one place, so aligning with Person 3's
/// real HashChain and shared/test-vectors/hash-chain.json is an edit to this file only:
///   1. canonical(event) covers { type, severity, ts, payload }: not seq, eventId or sessionId.
///   2. The first event's prevHash is 64 zeros, and seq starts at 1.
///   3. The HMAC input is the UTF-8 bytes of the hash's lower-case hex string.
/// If the server reports CHAIN_BREAK on a stream the harness thinks is fine, suspect these first.
/// </summary>
internal static class EventChain
{
    public static readonly string GenesisHash = new('0', 64);

    public static string ComputeHash(
        string prevHash, string type, string severity, string ts, IReadOnlyDictionary<string, object?> payload)
    {
        var canonical = CanonicalJson.Serialize(new Dictionary<string, object?>
        {
            ["type"] = type,
            ["severity"] = severity,
            ["ts"] = ts,
            ["payload"] = payload,
        });
        return Hex(SHA256.HashData(Encoding.UTF8.GetBytes(prevHash + canonical)));
    }

    public static string ComputeHmac(byte[] sessionKey, string hash) =>
        Hex(HMACSHA256.HashData(sessionKey, Encoding.UTF8.GetBytes(hash)));

    /// <summary>Re-derives every link. Detects edits, deletions, reordering and a wrong key.</summary>
    public static ChainResult Verify(IReadOnlyList<EventRecord> records, byte[] sessionKey)
    {
        string prev = GenesisHash;
        int expectedSeq = 1;

        foreach (var r in records)
        {
            if (r.Seq != expectedSeq)
                return ChainResult.Bad(r.Seq, $"sequence gap or reorder: expected {expectedSeq}, found {r.Seq}");
            if (!string.Equals(r.PrevHash, prev, StringComparison.Ordinal))
                return ChainResult.Bad(r.Seq, "prevHash does not match the previous event");

            var hash = ComputeHash(r.PrevHash, r.Type, r.Severity, r.Ts, r.Payload);
            if (!string.Equals(r.Hash, hash, StringComparison.Ordinal))
                return ChainResult.Bad(r.Seq, "hash does not match the event contents (edited event)");
            if (!string.Equals(r.Hmac, ComputeHmac(sessionKey, hash), StringComparison.Ordinal))
                return ChainResult.Bad(r.Seq, "HMAC invalid (wrong session key or forged event)");

            prev = r.Hash;
            expectedSeq++;
        }
        return ChainResult.Good;
    }

    private static string Hex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();
}

/// <summary>
/// An IEventSink that signs instead of just queueing: every Emit becomes a chained, HMAC-ed
/// EventRecord. Stands in for Person 3's EventBuilder + HashChain + LocalQueue in the harness.
/// Memory only: nothing survives a restart, unlike the real encrypted SQLite queue.
/// Thread-safe: ProcessMonitor emits from several worker threads.
/// </summary>
internal sealed class SignedEventSink : IEventSink
{
    private readonly object _gate = new();
    private readonly string _sessionId;
    private readonly byte[] _sessionKey;
    private readonly TimeProvider _time;
    private readonly List<EventRecord> _records = new();
    private string _prevHash = EventChain.GenesisHash;
    private int _ackedSeq;

    public SignedEventSink(string sessionId, byte[] sessionKey, TimeProvider? time = null)
    {
        _sessionId = sessionId;
        _sessionKey = sessionKey;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>Raised after each record is chained, on the emitting thread.</summary>
    public event Action<EventRecord>? Recorded;

    public byte[] SessionKey => _sessionKey;

    public void Emit(EventType type, Severity severity, IReadOnlyDictionary<string, object?> payload)
    {
        EventRecord record;
        lock (_gate)
        {
            // Copy: a caller mutating its dictionary later must not change what was hashed.
            var frozen = new Dictionary<string, object?>(payload);
            string typeName = type.ToString();
            string severityName = severity.ToString();
            string ts = _time.GetUtcNow().UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

            string hash = EventChain.ComputeHash(_prevHash, typeName, severityName, ts, frozen);
            record = new EventRecord(
                EventId: Guid.NewGuid().ToString(),
                SessionId: _sessionId,
                Seq: _records.Count + 1,
                Type: typeName,
                Severity: severityName,
                Ts: ts,
                Payload: frozen,
                PrevHash: _prevHash,
                Hash: hash,
                Hmac: EventChain.ComputeHmac(_sessionKey, hash));

            _prevHash = hash;
            _records.Add(record);
        }
        Recorded?.Invoke(record);
    }

    /// <summary>Everything emitted so far, in order.</summary>
    public IReadOnlyList<EventRecord> All()
    {
        lock (_gate) return _records.ToList();
    }

    /// <summary>Records the server has not acknowledged yet, oldest first, at most <paramref name="max"/>.</summary>
    public IReadOnlyList<EventRecord> Pending(int max)
    {
        lock (_gate) return _records.Skip(_ackedSeq).Take(max).ToList();
    }

    /// <summary>Server accepted everything up to and including lastSeq. Never moves backwards.</summary>
    public void Ack(int lastSeq)
    {
        lock (_gate) _ackedSeq = Math.Clamp(Math.Max(_ackedSeq, lastSeq), 0, _records.Count);
    }

    public int AckedSeq
    {
        get { lock (_gate) return _ackedSeq; }
    }
}
