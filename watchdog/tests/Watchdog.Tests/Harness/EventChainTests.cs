using System.Security.Cryptography;
using System.Text;
using Watchdog.Events;
using Watchdog.Harness;
using Watchdog.Tests.Lockdown;
using Xunit;

namespace Watchdog.Tests.Harness;

public class CanonicalJsonTests
{
    private static string Canon(object? v) => CanonicalJson.Serialize(v);

    [Fact]
    public void Object_keys_are_sorted_and_there_is_no_whitespace()
    {
        var obj = new Dictionary<string, object?> { ["b"] = 1, ["a"] = 2 };

        Assert.Equal("{\"a\":2,\"b\":1}", Canon(obj));
    }

    [Fact]
    public void Keys_sort_by_code_unit_not_by_culture()
    {
        var obj = new Dictionary<string, object?> { ["a"] = 2, ["B"] = 1 };

        Assert.Equal("{\"B\":1,\"a\":2}", Canon(obj)); // 'B' (0x42) sorts before 'a' (0x61)
    }

    [Fact]
    public void Nested_values_arrays_null_and_bool()
    {
        var obj = new Dictionary<string, object?>
        {
            ["z"] = new Dictionary<string, object?> { ["k"] = true, ["j"] = null },
            ["list"] = new object?[] { 1, "x", false },
        };

        Assert.Equal("{\"list\":[1,\"x\",false],\"z\":{\"j\":null,\"k\":true}}", Canon(obj));
    }

    [Fact]
    public void Strings_escape_only_what_json_requires()
    {
        Assert.Equal("\"a\\\"b\\\\c\\n\\u0001é\"", Canon("a\"b\\c\n\u0001é"));
    }

    [Fact]
    public void Windows_paths_keep_their_backslashes_escaped()
    {
        Assert.Equal("\"C:\\\\Users\\\\x\\\\evil.exe\"", Canon(@"C:\Users\x\evil.exe"));
    }

    [Fact]
    public void Large_integers_are_written_in_full()
    {
        Assert.Equal("9007199254740993", Canon(9007199254740993L));
    }

    [Fact]
    public void Floating_point_is_refused_rather_than_formatted_differently_from_the_server()
    {
        Assert.Throws<NotSupportedException>(() => Canon(1.5));
        Assert.Throws<NotSupportedException>(() => Canon(new Dictionary<string, object?> { ["x"] = 2.0f }));
    }

    [Fact]
    public void Unknown_types_are_refused()
    {
        Assert.Throws<NotSupportedException>(() => Canon(new object()));
    }
}

public class EventChainTests
{
    private static readonly byte[] Key = Enumerable.Range(1, 32).Select(i => (byte)i).ToArray();

    private static SignedEventSink NewSink(ManualTime? time = null, byte[]? key = null) =>
        new("session-1", key ?? Key, time ?? new ManualTime());

    private static void EmitBlocked(SignedEventSink sink, int pid) =>
        sink.Emit(EventType.PROCESS_BLOCKED, Severity.MEDIUM, new Dictionary<string, object?>
        {
            ["pid"] = pid,
            ["imagePath"] = @"C:\Windows\System32\notepad.exe",
            ["killed"] = false,
        });

    private static SignedEventSink ThreeEvents()
    {
        var sink = NewSink();
        EmitBlocked(sink, 101);
        EmitBlocked(sink, 102);
        EmitBlocked(sink, 103);
        return sink;
    }

    // ---- building the chain -------------------------------------------------

    [Fact]
    public void Records_are_numbered_from_one_and_linked_to_the_previous_hash()
    {
        var all = ThreeEvents().All();

        Assert.Equal(new[] { 1, 2, 3 }, all.Select(r => r.Seq).ToArray());
        Assert.Equal(EventChain.GenesisHash, all[0].PrevHash);
        Assert.Equal(all[0].Hash, all[1].PrevHash);
        Assert.Equal(all[1].Hash, all[2].PrevHash);
        Assert.All(all, r => Assert.Equal("session-1", r.SessionId));
        Assert.Equal(3, all.Select(r => r.EventId).Distinct().Count());
    }

    [Fact]
    public void Hash_follows_the_documented_formula()
    {
        var time = new ManualTime();
        var sink = NewSink(time);
        sink.Emit(EventType.PROCESS_BLOCKED, Severity.LOW, new Dictionary<string, object?> { ["a"] = 1 });
        var record = Assert.Single(sink.All());

        string canonical = $"{{\"payload\":{{\"a\":1}},\"severity\":\"LOW\",\"ts\":\"{record.Ts}\",\"type\":\"PROCESS_BLOCKED\"}}";
        string expectedHash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(EventChain.GenesisHash + canonical))).ToLowerInvariant();
        string expectedHmac = Convert.ToHexString(
            HMACSHA256.HashData(Key, Encoding.UTF8.GetBytes(expectedHash))).ToLowerInvariant();

        Assert.Equal(expectedHash, record.Hash);
        Assert.Equal(expectedHmac, record.Hmac);
        Assert.Equal("2026-10-14T10:00:00.000Z", record.Ts);
    }

    [Fact]
    public void Changing_the_payload_dictionary_after_emit_does_not_change_the_record()
    {
        var sink = NewSink();
        var payload = new Dictionary<string, object?> { ["pid"] = 1 };
        sink.Emit(EventType.PROCESS_BLOCKED, Severity.LOW, payload);

        payload["pid"] = 999;

        Assert.Equal(1, sink.All()[0].Payload["pid"]);
        Assert.True(EventChain.Verify(sink.All(), Key).Ok);
    }

    [Fact]
    public void Recorded_event_fires_once_per_emit_with_the_chained_record()
    {
        var sink = NewSink();
        var seen = new List<EventRecord>();
        sink.Recorded += seen.Add;

        EmitBlocked(sink, 1);
        EmitBlocked(sink, 2);

        Assert.Equal(new[] { 1, 2 }, seen.Select(r => r.Seq).ToArray());
    }

    [Fact]
    public void Concurrent_emits_still_form_one_unbroken_chain()
    {
        var sink = NewSink();

        Parallel.For(0, 300, i => EmitBlocked(sink, i));

        var all = sink.All();
        Assert.Equal(300, all.Count);
        Assert.True(EventChain.Verify(all, Key).Ok);
    }

    // ---- verification: what the server will check ----------------------------

    [Fact]
    public void An_untouched_chain_verifies()
    {
        Assert.True(EventChain.Verify(ThreeEvents().All(), Key).Ok);
    }

    [Fact]
    public void An_empty_chain_verifies()
    {
        Assert.True(EventChain.Verify(Array.Empty<EventRecord>(), Key).Ok);
    }

    [Fact]
    public void An_edited_event_is_detected_at_its_sequence_number()
    {
        var all = ThreeEvents().All().ToList();
        all[1] = all[1] with { Payload = new Dictionary<string, object?> { ["pid"] = 102, ["killed"] = true } };

        var result = EventChain.Verify(all, Key);

        Assert.False(result.Ok);
        Assert.Equal(2, result.BadSeq);
        Assert.Contains("edited", result.Problem);
    }

    [Fact]
    public void A_deleted_event_is_detected()
    {
        var all = ThreeEvents().All().ToList();
        all.RemoveAt(1);

        var result = EventChain.Verify(all, Key);

        Assert.False(result.Ok);
        Assert.Equal(3, result.BadSeq);
        Assert.Contains("gap", result.Problem);
    }

    [Fact]
    public void A_missing_first_event_is_detected()
    {
        var all = ThreeEvents().All().ToList();
        all.RemoveAt(0);

        Assert.False(EventChain.Verify(all, Key).Ok);
    }

    [Fact]
    public void Reordered_events_are_detected()
    {
        var all = ThreeEvents().All().ToList();
        (all[0], all[1]) = (all[1], all[0]);

        Assert.False(EventChain.Verify(all, Key).Ok);
    }

    [Fact]
    public void A_wrong_session_key_fails_the_hmac_check()
    {
        var all = ThreeEvents().All();

        var result = EventChain.Verify(all, new byte[32]);

        Assert.False(result.Ok);
        Assert.Equal(1, result.BadSeq);
        Assert.Contains("HMAC", result.Problem);
    }

    [Fact]
    public void A_forged_event_with_a_recomputed_hash_but_no_key_fails_the_hmac_check()
    {
        var all = ThreeEvents().All().ToList();
        var payload = new Dictionary<string, object?> { ["pid"] = 777 };
        var forgedHash = EventChain.ComputeHash(all[0].PrevHash, all[0].Type, all[0].Severity, all[0].Ts, payload);
        all[0] = all[0] with { Payload = payload, Hash = forgedHash };

        var result = EventChain.Verify(all, Key);

        Assert.False(result.Ok);
        Assert.Equal(1, result.BadSeq);
        Assert.Contains("HMAC", result.Problem);
    }

    // ---- acknowledgements -----------------------------------------------------

    [Fact]
    public void Pending_returns_unacknowledged_records_in_order_and_respects_the_limit()
    {
        var sink = ThreeEvents();

        Assert.Equal(new[] { 1, 2 }, sink.Pending(2).Select(r => r.Seq).ToArray());

        sink.Ack(2);

        Assert.Equal(new[] { 3 }, sink.Pending(10).Select(r => r.Seq).ToArray());
        Assert.Equal(2, sink.AckedSeq);
    }

    [Fact]
    public void Ack_never_moves_backwards_and_never_passes_what_exists()
    {
        var sink = ThreeEvents();

        sink.Ack(3);
        sink.Ack(1);
        Assert.Equal(3, sink.AckedSeq);

        sink.Ack(50);
        Assert.Equal(3, sink.AckedSeq);
        Assert.Empty(sink.Pending(10));
    }
}
