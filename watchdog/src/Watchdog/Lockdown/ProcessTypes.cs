namespace Watchdog.Lockdown;

/// <summary>
/// One entry of Policy.allowedProcesses: { name, sha256?, signer? }.
/// Move this and PolicyAction next to the Policy DTO when PolicyClient.cs lands.
/// </summary>
public sealed record AllowedProcess(string Name, string? Sha256 = null, string? Signer = null);

/// <summary>What to do with a process that is not allowed (Policy.actionByEvent[PROCESS_BLOCKED]).</summary>
public enum PolicyAction { BLOCK, WARN, LOG }

/// <summary>A running process as the monitor sees it. ImagePath is null until resolved.</summary>
public sealed record ProcInfo(int Pid, string Name, string? ImagePath, int ParentPid, int SessionId);

public enum DecisionKind { Allow, Block }

public sealed record Decision(DecisionKind Kind, string Reason)
{
    public static Decision Allow(string reason) => new(DecisionKind.Allow, reason);
    public static Decision Block(string reason) => new(DecisionKind.Block, reason);
}
