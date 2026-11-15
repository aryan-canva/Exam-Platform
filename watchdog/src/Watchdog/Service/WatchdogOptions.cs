namespace Watchdog.Service;

public sealed class WatchdogOptions
{
    public string ServerUrl { get; set; } = "http://localhost:8080";
    public string? AccessToken { get; set; }
    public string? Username { get; set; }
    public string? Password { get; set; }
    public string? ContestId { get; set; }
    public string StateDir { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ExamWatchdog");
    public string ControlHost { get; set; } = "127.0.0.1";
    public int ControlPort { get; set; } = 8765;
    public bool RunAsWindowsService { get; set; } = false;
    public bool AutoStartSessionFromConfig { get; set; } = false;
    public bool EnforceProcessMonitor { get; set; } = true;
    public bool EnforceFirewall { get; set; } = false;
    public bool EnforceUsb { get; set; } = false;
    public bool EnforceShellLockdown { get; set; } = false;
    public List<string> DefaultAllowedProcesses { get; set; } = new() { "examclient", "student-app", "electron" };
    public List<string> ForbiddenProcesses { get; set; } = new() { "chrome", "msedge", "firefox", "brave", "opera", "discord", "telegram", "whatsapp", "teams", "slack", "zoom", "skype", "anydesk", "teamviewer" };
}
