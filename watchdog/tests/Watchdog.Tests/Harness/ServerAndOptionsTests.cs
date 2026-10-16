using System.Net;
using System.Text;
using System.Text.Json;
using Watchdog.Events;
using Watchdog.Harness;
using Watchdog.Tests.Lockdown;
using Xunit;

namespace Watchdog.Tests.Harness;

public class OptionsTests
{
    private static Options Parse(params string[] args) => Options.Parse(args, _ => null);

    [Fact]
    public void Dry_run_needs_nothing_else_and_watches_notepad_in_log_mode()
    {
        var o = Parse("--dry-run");

        Assert.True(o.DryRun);
        Assert.False(o.Kill);
        Assert.Equal(new[] { "notepad" }, o.Watch);
        Assert.Null(o.DurationSeconds);
    }

    [Fact]
    public void Watch_can_be_repeated_and_replaces_the_default()
    {
        var o = Parse("--dry-run", "--watch", "notepad", "--watch", "calc.exe");

        Assert.Equal(new[] { "notepad", "calc.exe" }, o.Watch);
    }

    [Fact]
    public void Kill_and_duration_are_read()
    {
        var o = Parse("--dry-run", "--kill", "--duration", "45");

        Assert.True(o.Kill);
        Assert.Equal(45, o.DurationSeconds);
    }

    [Fact]
    public void Login_mode_needs_server_user_and_contest()
    {
        var o = Parse("--server", "http://localhost:8080", "--user", "s1", "--contest", "c1");

        Assert.Equal("http://localhost:8080/", o.Server!.ToString());
        Assert.Equal("s1", o.User);
        Assert.Equal("c1", o.Contest);
    }

    [Theory]
    [InlineData("--user", "s1", "--contest", "c1")]                                        // no server
    [InlineData("--server", "http://h", "--contest", "c1")]                                // no user
    [InlineData("--server", "http://h", "--user", "s1")]                                   // no contest
    public void Login_mode_reports_what_is_missing(params string[] args)
    {
        Assert.Throws<UsageException>(() => Parse(args));
    }

    [Fact]
    public void Existing_session_mode_needs_session_key_and_token_together()
    {
        var ok = Parse("--server", "http://h", "--session", "s", "--key", "k", "--token", "t");
        Assert.Equal("s", ok.Session);

        Assert.Throws<UsageException>(() => Parse("--server", "http://h", "--session", "s", "--key", "k"));
        Assert.Throws<UsageException>(() => Parse("--server", "http://h", "--token", "t"));
    }

    [Fact]
    public void Password_falls_back_to_the_environment()
    {
        var o = Options.Parse(
            new[] { "--server", "http://h", "--user", "s1", "--contest", "c1" },
            name => name == "HARNESS_PASSWORD" ? "from-env" : null);

        Assert.Equal("from-env", o.Password);
    }

    [Fact]
    public void Explicit_password_beats_the_environment()
    {
        var o = Options.Parse(
            new[] { "--server", "http://h", "--user", "s1", "--contest", "c1", "--password", "typed" },
            _ => "from-env");

        Assert.Equal("typed", o.Password);
    }

    [Theory]
    [InlineData("--bogus")]
    [InlineData("--dry-run", "--duration", "abc")]
    [InlineData("--dry-run", "--duration", "0")]
    [InlineData("--dry-run", "--duration", "-5")]
    [InlineData("--dry-run", "--watch")]                       // value missing at the end
    [InlineData("--dry-run", "--watch", "--kill")]             // next token is a flag, not a value
    [InlineData("--server", "ftp://h", "--dry-run")]
    [InlineData("--server", "not a url", "--dry-run")]
    public void Bad_input_is_a_usage_error(params string[] args)
    {
        Assert.Throws<UsageException>(() => Parse(args));
    }

    [Fact]
    public void Help_skips_validation()
    {
        Assert.True(Parse("--help").Help);
    }
}

public class KeyCodecTests
{
    [Fact]
    public void Decodes_base64_and_hex_to_the_same_key()
    {
        var key = Enumerable.Range(10, 32).Select(i => (byte)i).ToArray();

        Assert.Equal(key, KeyCodec.Decode(Convert.ToBase64String(key)));
        Assert.Equal(key, KeyCodec.Decode(Convert.ToHexString(key)));
        Assert.Equal(key, KeyCodec.Decode("  " + Convert.ToHexString(key).ToLowerInvariant() + "\n"));
    }

    [Fact]
    public void Garbage_is_a_protocol_error()
    {
        var ex = Assert.Throws<ServerException>(() => KeyCodec.Decode("not a key!"));

        Assert.Equal("PROTOCOL", ex.Code);
    }
}

public class ServerClientTests
{
    private sealed class StubHandler(Func<HttpRequestMessage, string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Seen { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            lock (Seen) Seen.Add((request, body));
            return respond(request, body);
        }
    }

    private static HttpResponseMessage Reply(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static ServerClient Client(StubHandler handler) => new(new Uri("http://server.test"), handler);

    private static readonly byte[] Key = Enumerable.Range(1, 32).Select(i => (byte)i).ToArray();

    private static SignedEventSink SinkWith(int count)
    {
        var sink = new SignedEventSink("s-1", Key, new ManualTime());
        for (int i = 0; i < count; i++)
            sink.Emit(EventType.PROCESS_BLOCKED, Severity.LOW, new Dictionary<string, object?> { ["pid"] = i });
        return sink;
    }

    // ---- login and start ------------------------------------------------------

    [Fact]
    public async Task Login_keeps_the_token_and_sends_it_on_later_calls()
    {
        var handler = new StubHandler((req, _) => req.RequestUri!.AbsolutePath switch
        {
            "/auth/login" => Reply(HttpStatusCode.OK, """{"accessToken":"tok-1","refreshToken":"r","user":{}}"""),
            _ => Reply(HttpStatusCode.OK, """{"accepted":0,"lastSeq":0}"""),
        });
        using var client = Client(handler);

        await client.LoginAsync("s1", "pw", "fp", CancellationToken.None);
        await client.PostEventsAsync("s-1", Array.Empty<EventRecord>(), CancellationToken.None);

        Assert.Equal("Bearer tok-1", handler.Seen[1].Request.Headers.Authorization!.ToString());
        Assert.Contains("\"username\":\"s1\"", handler.Seen[0].Body);
        Assert.Contains("\"deviceFp\":\"fp\"", handler.Seen[0].Body);
    }

    [Fact]
    public async Task Rejected_login_surfaces_the_server_error_code_and_is_not_transient()
    {
        var handler = new StubHandler((_, _) => Reply(HttpStatusCode.Unauthorized,
            """{"code":"AUTH_INVALID","message":"bad credentials"}"""));
        using var client = Client(handler);

        var ex = await Assert.ThrowsAsync<ServerException>(
            () => client.LoginAsync("s1", "nope", "fp", CancellationToken.None));

        Assert.Equal("AUTH_INVALID", ex.Code);
        Assert.Equal("bad credentials", ex.Message);
        Assert.False(ex.IsTransient);
    }

    [Fact]
    public async Task Login_response_without_a_token_is_a_protocol_error()
    {
        using var client = Client(new StubHandler((_, _) => Reply(HttpStatusCode.OK, "{}")));

        var ex = await Assert.ThrowsAsync<ServerException>(
            () => client.LoginAsync("s1", "pw", "fp", CancellationToken.None));

        Assert.Equal("PROTOCOL", ex.Code);
    }

    [Fact]
    public async Task Start_session_returns_the_id_and_decoded_key_and_declares_itself_a_harness()
    {
        var keyB64 = Convert.ToBase64String(Key);
        var handler = new StubHandler((_, _) => Reply(HttpStatusCode.OK,
            $$"""{"sessionId":"sess-9","sessionKey":"{{keyB64}}","policy":{},"serverTime":"2026-10-14T10:00:00Z"}"""));
        using var client = Client(handler);

        var started = await client.StartSessionAsync("contest-1", "fp", CancellationToken.None);

        Assert.Equal("sess-9", started.SessionId);
        Assert.Equal(Key, started.SessionKey);
        Assert.Contains("\"contestId\":\"contest-1\"", handler.Seen[0].Body);
        Assert.Contains("harness-0.1", handler.Seen[0].Body);
    }

    [Fact]
    public async Task Start_session_conflict_keeps_the_code()
    {
        using var client = Client(new StubHandler((_, _) => Reply(HttpStatusCode.Conflict,
            """{"code":"SESSION_ACTIVE_ELSEWHERE","message":"already active"}""")));

        var ex = await Assert.ThrowsAsync<ServerException>(
            () => client.StartSessionAsync("c", "fp", CancellationToken.None));

        Assert.Equal("SESSION_ACTIVE_ELSEWHERE", ex.Code);
    }

    // ---- posting events -------------------------------------------------------

    [Fact]
    public async Task Events_are_posted_as_a_camel_case_json_array_and_lastSeq_is_returned()
    {
        var handler = new StubHandler((_, _) => Reply(HttpStatusCode.OK, """{"accepted":2,"lastSeq":2}"""));
        using var client = Client(handler);
        var sink = SinkWith(2);

        int lastSeq = await client.PostEventsAsync("s-1", sink.All(), CancellationToken.None);

        Assert.Equal(2, lastSeq);
        Assert.Equal("/sessions/s-1/events", handler.Seen[0].Request.RequestUri!.AbsolutePath);

        using var doc = JsonDocument.Parse(handler.Seen[0].Body);
        Assert.Equal(JsonValueKind.Array, doc.RootElement.ValueKind);
        var first = doc.RootElement[0];
        Assert.Equal(1, first.GetProperty("seq").GetInt32());
        Assert.Equal("PROCESS_BLOCKED", first.GetProperty("type").GetString());
        Assert.Equal("LOW", first.GetProperty("severity").GetString());
        Assert.Equal(64, first.GetProperty("hash").GetString()!.Length);
        Assert.Equal(64, first.GetProperty("hmac").GetString()!.Length);
        Assert.Equal(new string('0', 64), first.GetProperty("prevHash").GetString());
        Assert.Equal(0, first.GetProperty("payload").GetProperty("pid").GetInt32());
        Assert.Equal("s-1", first.GetProperty("sessionId").GetString());
    }

    [Fact]
    public async Task Server_error_5xx_is_transient()
    {
        using var client = Client(new StubHandler((_, _) => Reply(HttpStatusCode.ServiceUnavailable, "down")));

        var ex = await Assert.ThrowsAsync<ServerException>(
            () => client.PostEventsAsync("s-1", SinkWith(1).All(), CancellationToken.None));

        Assert.True(ex.IsTransient);
    }

    [Fact]
    public async Task Unreachable_server_is_a_transient_network_error()
    {
        using var client = Client(new StubHandler((_, _) => throw new HttpRequestException("connection refused")));

        var ex = await Assert.ThrowsAsync<ServerException>(
            () => client.PostEventsAsync("s-1", SinkWith(1).All(), CancellationToken.None));

        Assert.Equal("NETWORK", ex.Code);
        Assert.True(ex.IsTransient);
    }

    [Fact]
    public async Task Response_without_lastSeq_is_a_protocol_error()
    {
        using var client = Client(new StubHandler((_, _) => Reply(HttpStatusCode.OK, """{"accepted":1}""")));

        var ex = await Assert.ThrowsAsync<ServerException>(
            () => client.PostEventsAsync("s-1", SinkWith(1).All(), CancellationToken.None));

        Assert.Equal("PROTOCOL", ex.Code);
    }

    [Fact]
    public async Task End_session_posts_the_reason()
    {
        var handler = new StubHandler((_, _) => Reply(HttpStatusCode.OK, "{}"));
        using var client = Client(handler);

        await client.EndSessionAsync("s-1", "harness finished", CancellationToken.None);

        Assert.Equal("/sessions/s-1/end", handler.Seen[0].Request.RequestUri!.AbsolutePath);
        Assert.Contains("harness finished", handler.Seen[0].Body);
    }

    // ---- uploader -------------------------------------------------------------

    /// <summary>A server that accepts everything it is sent, answering with the highest seq in the batch.</summary>
    private static HttpResponseMessage AcceptAll(string body)
    {
        using var doc = JsonDocument.Parse(body);
        int last = doc.RootElement.EnumerateArray().Last().GetProperty("seq").GetInt32();
        return Reply(HttpStatusCode.OK, "{\"accepted\":1,\"lastSeq\":" + last + "}");
    }

    [Fact]
    public async Task Flush_sends_batches_of_at_most_500_and_acks_them()
    {
        var handler = new StubHandler((_, body) => AcceptAll(body));
        using var client = Client(handler);
        var sink = SinkWith(1200);
        var uploader = new EventUploader(sink, client, "s-1");

        await uploader.FlushAsync(CancellationToken.None);

        Assert.Equal(3, handler.Seen.Count);
        Assert.Equal(1200, sink.AckedSeq);
        Assert.Empty(sink.Pending(10));
        Assert.All(handler.Seen, s => Assert.True(JsonDocument.Parse(s.Body).RootElement.GetArrayLength() <= 500));
    }

    [Fact]
    public async Task Flush_with_nothing_pending_makes_no_request()
    {
        var handler = new StubHandler((_, body) => AcceptAll(body));
        using var client = Client(handler);
        var uploader = new EventUploader(SinkWith(0), client, "s-1");

        await uploader.FlushAsync(CancellationToken.None);

        Assert.Empty(handler.Seen);
    }

    [Fact]
    public async Task Flush_stops_when_the_server_accepts_only_part_of_a_batch()
    {
        var handler = new StubHandler((_, _) => Reply(HttpStatusCode.OK, """{"accepted":2,"lastSeq":2}"""));
        using var client = Client(handler);
        var sink = SinkWith(5);
        var uploader = new EventUploader(sink, client, "s-1");

        await uploader.FlushAsync(CancellationToken.None);

        Assert.Single(handler.Seen);
        Assert.Equal(2, sink.AckedSeq);
        Assert.Equal(3, sink.Pending(10).Count);
    }

    [Fact]
    public async Task Run_retries_transient_failures_and_delivers_everything_once_the_server_is_back()
    {
        int calls = 0;
        var handler = new StubHandler((_, body) =>
            Interlocked.Increment(ref calls) <= 2 ? Reply(HttpStatusCode.ServiceUnavailable, "down") : AcceptAll(body));
        using var client = Client(handler);
        var sink = SinkWith(3);
        var uploader = new EventUploader(sink, client, "s-1",
            tick: TimeSpan.FromMilliseconds(5), maxBackoff: TimeSpan.FromMilliseconds(20));
        var infos = new List<string>();
        uploader.Info += infos.Add;

        using var stop = new CancellationTokenSource();
        var loop = uploader.RunAsync(stop.Token);

        Assert.True(SpinWait.SpinUntil(() => sink.AckedSeq == 3, TimeSpan.FromSeconds(5)), "events were never delivered");
        stop.Cancel();
        await loop;

        Assert.Null(uploader.Fatal);
        Assert.NotEmpty(infos); // it said it was retrying
    }

    [Fact]
    public async Task Run_picks_up_events_emitted_after_it_started()
    {
        var handler = new StubHandler((_, body) => AcceptAll(body));
        using var client = Client(handler);
        var sink = SinkWith(0);
        var uploader = new EventUploader(sink, client, "s-1", tick: TimeSpan.FromMilliseconds(5));

        using var stop = new CancellationTokenSource();
        var loop = uploader.RunAsync(stop.Token);
        sink.Emit(EventType.PROCESS_BLOCKED, Severity.LOW, new Dictionary<string, object?> { ["pid"] = 1 });

        Assert.True(SpinWait.SpinUntil(() => sink.AckedSeq == 1, TimeSpan.FromSeconds(5)));
        stop.Cancel();
        await loop;
    }

    [Fact]
    public async Task Run_gives_up_on_a_chain_break_instead_of_resending_the_same_bytes()
    {
        var handler = new StubHandler((_, _) => Reply(HttpStatusCode.Conflict,
            """{"code":"CHAIN_BREAK","message":"prevHash mismatch at seq 2"}"""));
        using var client = Client(handler);
        var sink = SinkWith(3);
        var uploader = new EventUploader(sink, client, "s-1", tick: TimeSpan.FromMilliseconds(5));

        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await uploader.RunAsync(stop.Token); // returns by itself

        Assert.Equal("CHAIN_BREAK", uploader.Fatal!.Code);
        Assert.Single(handler.Seen);
        Assert.Equal(0, sink.AckedSeq);
    }

    [Fact]
    public async Task Run_stops_quietly_when_cancelled_while_the_server_is_down()
    {
        var handler = new StubHandler((_, _) => throw new HttpRequestException("refused"));
        using var client = Client(handler);
        var uploader = new EventUploader(SinkWith(1), client, "s-1",
            tick: TimeSpan.FromMilliseconds(5), maxBackoff: TimeSpan.FromMilliseconds(20));

        using var stop = new CancellationTokenSource();
        var loop = uploader.RunAsync(stop.Token);
        await Task.Delay(100);
        stop.Cancel();
        await loop;

        Assert.Null(uploader.Fatal);
    }
}
