using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Watchdog.Service;
using Watchdog.State;

namespace Watchdog;

public sealed class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly WatchdogOptions _opts;
    private readonly SessionController _session;
    private readonly ControlApiHost _control;
    private readonly TeardownManager _teardown;
    private readonly RestoreAll _restore;

    public Worker(ILogger<Worker> logger, WatchdogOptions opts, SessionController session, ControlApiHost control, TeardownManager teardown, RestoreAll restore)
    {
        _logger = logger;
        _opts = opts;
        _session = session;
        _control = control;
        _teardown = teardown;
        _restore = restore;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Exam Watchdog service starting. StateDir={StateDir} Control={Host}:{Port}", _opts.StateDir, _opts.ControlHost, _opts.ControlPort);

        if (_restore.HasPendingRestore)
        {
            _logger.LogWarning("Pending restore state found. Attempting safe restore.");
            await _teardown.TeardownAsync("startup-restore", stoppingToken);
        }

        try { _control.Start(); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start control API on {Host}:{Port}. Continuing without control API.", _opts.ControlHost, _opts.ControlPort);
        }

        if (_opts.AutoStartSessionFromConfig && !string.IsNullOrWhiteSpace(_opts.ContestId))
        {
            try
            {
                _logger.LogInformation("Auto-starting session for contest {ContestId}", _opts.ContestId);
                await _session.StartAsync(_opts.ContestId!, ct: stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Auto-start session failed");
            }
        }

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
                // periodic health tick (keeps service alive; process monitor/event uploader run internally)
                _logger.LogDebug("Watchdog heartbeat: active={Active} session={SessionId}", _session.Active, _session.SessionId ?? "-");
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            _logger.LogInformation("Exam Watchdog service stopping...");
            try { await _teardown.TeardownAsync("service-stop"); } catch (Exception ex) { _logger.LogWarning(ex, "Teardown on stop failed"); }
            try { await _control.DisposeAsync(); } catch { }
        }
    }
}
