// STUB for Person 3's Events/IEventSink.cs (and the EventType / Severity enums).
// Lives in /stubs and is linked into Watchdog.csproj. Delete this file, and the
// <Compile Include> line for it, when P3's real version passes its checkpoint.
//
// ASSUMED shape. Confirm with Person 3: ProcessMonitor calls Emit in exactly one
// place (ProcessMonitor.EmitBlocked), so a different signature is a one-line change.
// Emit must be cheap and non-blocking (enqueue only): it runs on the kill path.
// Enum member names match the LLD exactly so they serialize to the strings the
// server expects.

namespace Watchdog.Events;

public enum EventType
{
    PROCESS_BLOCKED,
    USB_INSERTED,
    FIREWALL_CHANGED,
}

public enum Severity { INFO, LOW, MEDIUM, HIGH, CRITICAL }

public interface IEventSink
{
    void Emit(EventType type, Severity severity, IReadOnlyDictionary<string, object?> payload);
}
