using System.Security.Cryptography;
using System.Security.Principal;
using Watchdog.Lockdown;

namespace Watchdog.Harness;

/// <summary>
/// Shows lockdown end to end without the Windows service or the kiosk:
///   named process starts -> ProcessMonitor -> signed, hash-chained event -> server.
/// It never touches a process whose name is not in --watch, and by default it only reports.
/// </summary>
internal static class Program
{
    private const int ExitOk = 0, ExitUsage = 2, ExitNotElevated = 3, ExitServer = 4, ExitChain = 5;

    private static async Task<int> Main(string[] args)
    {
        Options options;
        try
        {
            options = Options.Parse(args);
        }
        catch (UsageException ex)
        {
            Console.Error.WriteLine($"error: {ex.Message}\n");
            Console.Error.WriteLine(Options.UsageText);
            return ExitUsage;
        }

        if (options.Help)
        {
            Console.WriteLine(Options.UsageText);
            return ExitOk;
        }

        if (!IsElevated())
        {
            Console.Error.WriteLine("error: not elevated. Windows only reports process starts to administrators.");
            Console.Error.WriteLine("Open an elevated terminal (Run as administrator) and try again.");
            return ExitNotElevated;
        }

        using var stop = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true; // let us shut down cleanly and flush events
            stop.Cancel();
        };
        if (options.DurationSeconds is { } seconds)
            stop.CancelAfter(TimeSpan.FromSeconds(seconds));

        ServerClient? server = null;
        string? sessionId = null;
        try
        {
            // ---- 1. a session: that gives us an id and the key events are signed with
            byte[] key;
            if (options.DryRun)
            {
                sessionId = "dry-run";
                key = RandomNumberGenerator.GetBytes(32);
                Say(ConsoleColor.Yellow, "dry run: events are signed with a throwaway key and not sent anywhere");
            }
            else
            {
                server = new ServerClient(options.Server!);
                (sessionId, key) = await OpenSessionAsync(server, options, stop.Token);
                Say(ConsoleColor.Green, $"session {sessionId} ready");
            }

            // ---- 2. signed event sink (+ uploader when there is a server)
            var sink = new SignedEventSink(sessionId, key);
            sink.Recorded += PrintRecord;

            EventUploader? uploader = null;
            Task uploadLoop = Task.CompletedTask;
            using var uploadStop = new CancellationTokenSource();
            if (server is not null)
            {
                uploader = new EventUploader(sink, server, sessionId);
                uploader.Info += msg => Say(ConsoleColor.DarkYellow, msg);
                uploadLoop = uploader.RunAsync(uploadStop.Token);
            }

            // ---- 3. the monitor, fenced in to the watched names only
            var watched = options.Watch.Select(NormalizeName).ToHashSet(StringComparer.OrdinalIgnoreCase);
            using var monitor = new ProcessMonitor(sink, new ProcessMonitorOptions
            {
                Action = options.Kill ? PolicyAction.BLOCK : PolicyAction.LOG,
                Scope = p => watched.Contains(NormalizeName(p.Name)),
                ExtraDeniedProcesses = watched.ToList(),
                KillExistingOnStart = false,           // do not touch a Notepad you already have open
                SweepInterval = TimeSpan.Zero,         // show the event path, not the safety-net sweep
            });
            // The allowlist is a placeholder: the harness does not use the server policy, so it
            // does not need PolicyClient or a signature check. Only the watched names matter.
            monitor.Start(new[] { new AllowedProcess("harness-placeholder.exe", Sha256: new string('0', 64)) });

            Say(ConsoleColor.Cyan,
                $"mode {(options.Kill ? "BLOCK (watched processes are terminated)" : "LOG (report only)")}, " +
                $"watching: {string.Join(", ", watched)}");
            Say(ConsoleColor.Cyan,
                options.DurationSeconds is { } d ? $"running for {d}s. Start one now." : "running. Start one now, Ctrl+C to stop.");

            try { await Task.Delay(Timeout.Infinite, stop.Token); }
            catch (OperationCanceledException) { /* Ctrl+C or --duration */ }

            // ---- 4. shut down in order: monitor first (it flushes counts), then the uploader
            Console.WriteLine();
            Say(ConsoleColor.Cyan, "stopping...");
            monitor.Stop();

            int exit = ExitOk;
            if (uploader is not null)
            {
                uploadStop.Cancel();
                await uploadLoop;
                if (uploader.Fatal is null)
                {
                    using var finalFlush = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                    try { await uploader.FlushAsync(finalFlush.Token); }
                    catch (Exception ex) when (ex is ServerException or OperationCanceledException)
                    {
                        Say(ConsoleColor.Red, $"final upload failed: {ex.Message}");
                    }
                }
                if (uploader.Fatal is { } fatal)
                {
                    Say(ConsoleColor.Red, $"server rejected the events: {fatal.Code}: {fatal.Message}");
                    exit = ExitServer;
                }
            }

            // ---- 5. summary + local chain check
            var all = sink.All();
            var chain = EventChain.Verify(all, key);
            Console.WriteLine();
            Say(ConsoleColor.White, $"events emitted: {all.Count}" + (server is null ? "" : $", acknowledged by server: {sink.AckedSeq}"));
            if (chain.Ok)
                Say(ConsoleColor.Green, "local chain check: OK (links, hashes and HMACs all verify)");
            else
            {
                Say(ConsoleColor.Red, $"local chain check FAILED at seq {chain.BadSeq}: {chain.Problem}");
                exit = ExitChain;
            }

            if (server is not null && sessionId is not null)
                await EndSessionQuietlyAsync(server, sessionId);

            return exit;
        }
        catch (ServerException ex)
        {
            Say(ConsoleColor.Red, $"server error: {ex.Code}: {ex.Message}");
            return ExitServer;
        }
        catch (OperationCanceledException)
        {
            Say(ConsoleColor.Gray, "cancelled before the monitor started");
            return ExitOk;
        }
        finally
        {
            server?.Dispose();
        }
    }

    private static async Task<(string SessionId, byte[] Key)> OpenSessionAsync(ServerClient server, Options o, CancellationToken ct)
    {
        if (o.Session is not null)
        {
            server.UseToken(o.Token!);
            return (o.Session, KeyCodec.Decode(o.Key!));
        }

        string password = o.Password ?? ReadPassword($"password for {o.User}: ");
        string deviceFp = "harness-" + Environment.MachineName;

        await server.LoginAsync(o.User!, password, deviceFp, ct);
        Say(ConsoleColor.Green, $"logged in as {o.User}");

        var started = await server.StartSessionAsync(o.Contest!, deviceFp, ct);
        return (started.SessionId, started.SessionKey);
    }

    private static async Task EndSessionQuietlyAsync(ServerClient server, string sessionId)
    {
        // Leave nothing ACTIVE behind: the user could not start a new session otherwise
        // (SESSION_ACTIVE_ELSEWHERE). Best effort only.
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await server.EndSessionAsync(sessionId, "harness finished", timeout.Token);
            Say(ConsoleColor.Gray, "session ended");
        }
        catch (Exception ex) when (ex is ServerException or OperationCanceledException)
        {
            Say(ConsoleColor.DarkYellow, $"could not end the session ({ex.Message}); end it manually if the server still lists it as active");
        }
    }

    private static void PrintRecord(EventRecord r)
    {
        string Field(string name) => r.Payload.TryGetValue(name, out var v) ? v?.ToString() ?? "-" : "-";

        string what = r.Payload.ContainsKey("summary")
            ? $"summary: {Field("coalescedCount")} more of {Path.GetFileName(Field("imagePath"))}"
            : $"{Path.GetFileName(Field("imagePath"))} pid={Field("pid")} killed={Field("killed")}";

        Say(r.Severity is "HIGH" or "CRITICAL" ? ConsoleColor.Red : ConsoleColor.Yellow,
            $"#{r.Seq} {r.Type} {r.Severity}  {what}  hash={r.Hash[..12]}");
    }

    private static string NormalizeName(string name)
    {
        var n = name.Trim();
        return n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? n[..^4] : n;
    }

    private static bool IsElevated()
    {
        using var identity = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    private static string ReadPassword(string prompt)
    {
        Console.Write(prompt);
        var chars = new List<char>();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) break;
            if (key.Key == ConsoleKey.Backspace) { if (chars.Count > 0) chars.RemoveAt(chars.Count - 1); }
            else if (!char.IsControl(key.KeyChar)) chars.Add(key.KeyChar);
        }
        Console.WriteLine();
        return new string(chars.ToArray());
    }

    private static readonly object ConsoleGate = new();

    private static void Say(ConsoleColor color, string text)
    {
        lock (ConsoleGate) // events arrive on worker threads
        {
            var previous = Console.ForegroundColor;
            Console.ForegroundColor = color;
            Console.WriteLine($"{DateTime.Now:HH:mm:ss}  {text}");
            Console.ForegroundColor = previous;
        }
    }
}
