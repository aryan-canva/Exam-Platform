using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Watchdog.Service;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.Configure<WatchdogOptions>(builder.Configuration.GetSection("Watchdog"));
var opts = builder.Configuration.GetSection("Watchdog").Get<WatchdogOptions>() ?? new WatchdogOptions();

// Enable Windows Service hosting when requested (safe no-op on non-Windows for dev)
if (OperatingSystem.IsWindows() && (opts.RunAsWindowsService || args.Contains("--service", StringComparer.OrdinalIgnoreCase)))
{
#pragma warning disable CA1416
    builder.Services.AddWindowsService(o => o.ServiceName = "ExamWatchdogService");
#pragma warning restore CA1416
}

builder.Services.AddSingleton(opts);
builder.Services.AddSingleton<Watchdog.State.RestoreAll>(sp => new Watchdog.State.RestoreAll(opts.StateDir));
builder.Services.AddSingleton<SessionController>(sp => new SessionController(opts, sp.GetRequiredService<ILoggerFactory>()));
builder.Services.AddSingleton<TeardownManager>(sp => new TeardownManager(sp.GetRequiredService<SessionController>(), sp.GetRequiredService<ILogger<TeardownManager>>()));
builder.Services.AddSingleton<ControlApiHost>(sp => new ControlApiHost(opts.ControlHost, opts.ControlPort, sp.GetRequiredService<SessionController>(), sp.GetRequiredService<TeardownManager>(), sp.GetRequiredService<Watchdog.State.RestoreAll>(), sp.GetRequiredService<ILogger<ControlApiHost>>()));
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
await host.RunAsync();
