namespace Watchdog.Harness;

internal sealed class UsageException(string message) : Exception(message);

internal sealed record Options
{
    public Uri? Server { get; init; }
    public string? User { get; init; }
    public string? Password { get; init; }
    public string? Contest { get; init; }

    /// <summary>Use an existing session instead of logging in: all three must be given together.</summary>
    public string? Session { get; init; }
    public string? Key { get; init; }
    public string? Token { get; init; }

    public IReadOnlyList<string> Watch { get; init; } = new[] { "notepad" };

    /// <summary>False (default) = LOG: report only. True = BLOCK: also terminate the watched processes.</summary>
    public bool Kill { get; init; }

    /// <summary>Stop after this many seconds. Null = run until Ctrl+C.</summary>
    public int? DurationSeconds { get; init; }

    /// <summary>No server at all: sign events with a throwaway key and print them.</summary>
    public bool DryRun { get; init; }

    public bool Help { get; init; }

    public const string UsageText = """
        watchdog-harness: run ProcessMonitor against named processes and post signed events.

        Against a server (logs in and starts a session):
          watchdog-harness --server http://HOST:PORT --user NAME --contest ID [--password PW]

        Against an existing session:
          watchdog-harness --server http://HOST:PORT --session ID --key KEY --token JWT

        Without a server:
          watchdog-harness --dry-run

        Options:
          --watch NAME     process to watch, e.g. notepad (repeatable, default: notepad)
          --kill           terminate watched processes too (default: report only, LOG mode)
          --duration SEC   stop after SEC seconds (default: until Ctrl+C)
          --password PW    or set HARNESS_PASSWORD, or you will be asked
          --help

        Run from an elevated terminal: Windows only reports process starts to administrators.
        Only processes whose name matches --watch are ever touched.
        """;

    public static Options Parse(IReadOnlyList<string> args, Func<string, string?>? env = null)
    {
        env ??= Environment.GetEnvironmentVariable;

        var opts = new Options();
        var watch = new List<string>();

        for (int i = 0; i < args.Count; i++)
        {
            string flag = args[i];
            string Value()
            {
                if (i + 1 >= args.Count || args[i + 1].StartsWith("--", StringComparison.Ordinal))
                    throw new UsageException($"{flag} needs a value.");
                return args[++i];
            }

            switch (flag)
            {
                case "--server":
                    var text = Value();
                    if (!Uri.TryCreate(text, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
                        throw new UsageException($"--server must be an http(s) URL, got '{text}'.");
                    opts = opts with { Server = uri };
                    break;
                case "--user": opts = opts with { User = Value() }; break;
                case "--password": opts = opts with { Password = Value() }; break;
                case "--contest": opts = opts with { Contest = Value() }; break;
                case "--session": opts = opts with { Session = Value() }; break;
                case "--key": opts = opts with { Key = Value() }; break;
                case "--token": opts = opts with { Token = Value() }; break;
                case "--watch": watch.Add(Value()); break;
                case "--kill": opts = opts with { Kill = true }; break;
                case "--dry-run": opts = opts with { DryRun = true }; break;
                case "--help" or "-h" or "-?": opts = opts with { Help = true }; break;
                case "--duration":
                    var secs = Value();
                    if (!int.TryParse(secs, out var n) || n <= 0)
                        throw new UsageException($"--duration must be a positive number of seconds, got '{secs}'.");
                    opts = opts with { DurationSeconds = n };
                    break;
                default:
                    throw new UsageException($"Unknown option '{flag}'. Try --help.");
            }
        }

        if (watch.Count > 0) opts = opts with { Watch = watch };
        opts = opts with { Password = opts.Password ?? env("HARNESS_PASSWORD") };

        return opts.Help ? opts : opts.Validated();
    }

    private Options Validated()
    {
        if (DryRun) return this;

        if (Server is null)
            throw new UsageException("--server is required (or use --dry-run).");

        bool anyDirect = Session is not null || Key is not null || Token is not null;
        if (anyDirect)
        {
            if (Session is null || Key is null || Token is null)
                throw new UsageException("--session, --key and --token must be given together.");
            return this;
        }

        if (string.IsNullOrWhiteSpace(User))
            throw new UsageException("--user is required (or give --session/--key/--token, or use --dry-run).");
        if (string.IsNullOrWhiteSpace(Contest))
            throw new UsageException("--contest is required to start a session.");
        return this;
    }
}
