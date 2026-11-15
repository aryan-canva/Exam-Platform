// Shared event contract for the watchdog lockdown modules and harness.
// Keep ProcessMonitor.EmitBlocked signature stable; the real service adds a string-event bridge.
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Watchdog.Events;

public enum EventType
{
    PROCESS_BLOCKED,
    USB_INSERTED,
    NEW_NIC,
    SERVICE_RESTARTED,
    HEARTBEAT_GAP,
    CLOCK_CHANGE,
    VM_DETECTED,
    MULTI_MONITOR,
    REMOTE_TOOL,
    SAFE_MODE,
    FIREWALL_CHANGED,
    KEY_BLOCKED,
    FOCUS_LOST,
    LARGE_PASTE,
    TYPING_BURST,
    POLICY_TAMPER,
    CHAIN_BREAK,
    LOGIN_FAIL,
    CLIENT_CRASH_RECOVERED,
    PASTE,
    TAB_SWITCH,
    SCREENSHOT_ATTEMPT,
    KIOSK_EXIT_ATTEMPT,
    APP_EXITED,
    SESSION_ATTACHED,
    SESSION_END,
}

public enum Severity { INFO, LOW, MEDIUM, HIGH, CRITICAL }

public interface IEventSink
{
    void Emit(EventType type, Severity severity, IReadOnlyDictionary<string, object?> payload);
}

/// <summary>Optional extension for sinks that can accept arbitrary/server event type names.</summary>
public interface IStringEventSink : IEventSink
{
    void Emit(string type, string severity, IReadOnlyDictionary<string, object?> payload);
}

internal static class EventPayload
{
    public static JsonNode? ToJsonNode(object? value)
    {
        if (value is null) return null;
        if (value is JsonNode n) return n.DeepClone();
        return JsonSerializer.SerializeToNode(value);
    }

    public static IReadOnlyDictionary<string, object?> Normalize(IReadOnlyDictionary<string, object?> payload)
        => new Dictionary<string, object?>(payload);
}
