using System.Text.Json;

namespace Watchdog.Events;

/// <summary>Append-only JSONL journal for signed events of a session (survives restart).</summary>
public sealed class EventJournal
{
    private readonly object _gate = new();
    public string LogPath { get; }
    public string AckPath { get; }

    private readonly List<SignedServerEvent> _records = new();
    private long _acked = -1;

    public EventJournal(string stateDir, string sessionId)
    {
        Directory.CreateDirectory(stateDir);
        var safe = string.Concat(sessionId.Where(ch => char.IsLetterOrDigit(ch) || ch == '-' || ch == '_'));
        if (string.IsNullOrWhiteSpace(safe)) safe = "session";
        LogPath = Path.Combine(stateDir, safe + ".jsonl");
        AckPath = Path.Combine(stateDir, safe + ".ack");
        Load();
    }

    private void Load()
    {
        lock (_gate)
        {
            _records.Clear();
            if (File.Exists(LogPath))
            {
                foreach (var line in File.ReadAllLines(LogPath))
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    try
                    {
                        var r = JsonSerializer.Deserialize<SignedServerEvent>(line, JsonOpts);
                        if (r != null) _records.Add(r);
                    }
                    catch { /* drop torn line */ }
                }
            }
            _acked = -1;
            if (File.Exists(AckPath) && long.TryParse(File.ReadAllText(AckPath), out var a)) _acked = a;
        }
    }

    public (long NextSeq, string PrevHash) Tail()
    {
        lock (_gate)
        {
            if (_records.Count == 0) return (0, ServerEventChain.Genesis);
            var last = _records[^1];
            return (last.Seq + 1, last.Hash);
        }
    }

    public void Append(SignedServerEvent rec)
    {
        lock (_gate)
        {
            File.AppendAllText(LogPath, JsonSerializer.Serialize(rec, JsonOpts) + Environment.NewLine);
            _records.Add(rec);
        }
    }

    public IReadOnlyList<SignedServerEvent> Pending(int max)
    {
        lock (_gate)
        {
            var outList = new List<SignedServerEvent>(Math.Min(max, _records.Count));
            for (int i = 0; i < _records.Count && outList.Count < max; i++)
            {
                if (_records[i].Seq > _acked) outList.Add(_records[i]);
            }
            return outList;
        }
    }

    public void Ack(long lastSeq)
    {
        lock (_gate)
        {
            if (lastSeq <= _acked) return;
            _acked = Math.Min(lastSeq, _records.Count == 0 ? -1 : _records[^1].Seq);
            File.WriteAllText(AckPath, _acked.ToString());
        }
    }

    public int PendingCount
    {
        get { lock (_gate) return _records.Count(r => r.Seq > _acked); }
    }

    public IReadOnlyList<SignedServerEvent> All()
    {
        lock (_gate) return _records.ToList();
    }

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);
}
