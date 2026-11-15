// Legacy compatibility shim. Prefer Watchdog.Events.CanonicalJson in service code.
namespace Watchdog.Legacy;

public static class Canonical
{
    public static string Json(System.Text.Json.Nodes.JsonNode? n) => Watchdog.Events.CanonicalJson.Serialize(n);
    public static string Sha256Hex(string s) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(s))).ToLowerInvariant();
}
