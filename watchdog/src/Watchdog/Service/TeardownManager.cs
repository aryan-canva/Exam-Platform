using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Watchdog.Service;

/// <summary>
/// Coordinates full teardown/restore on shutdown or failure (idempotent).
/// </summary>
public sealed class TeardownManager
{
    private readonly SessionController _session;
    private readonly ILogger<TeardownManager> _log;

    public TeardownManager(SessionController session, ILogger<TeardownManager>? logger = null)
    {
        _session = session;
        _log = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<TeardownManager>.Instance;
    }

    public async Task<(bool ok, string message)> TeardownAsync(string reason, CancellationToken ct = default)
    {
        try
        {
            var r = await _session.StopAsync(reason, ct);
            _log.LogInformation("Teardown complete: {Reason}", reason);
            return (true, "Teardown complete");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Teardown failed");
            return (false, ex.Message);
        }
    }
}
