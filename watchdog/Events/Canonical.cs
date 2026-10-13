// Watchdog/Events/Canonical.cs
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

public static class Canonical
{
    static readonly JsonSerializerOptions Opts = new()
        { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, WriteIndented = false };

    public static string Json(JsonNode? n) => Sort(n)?.ToJsonString(Opts) ?? "null";

    static JsonNode? Sort(JsonNode? n) => n switch
    {
        JsonObject o => new JsonObject(o.OrderBy(p => p.Key, StringComparer.Ordinal)
                                        .Select(p => KeyValuePair.Create(p.Key, Sort(p.Value?.DeepClone())))),
        JsonArray a  => new JsonArray(a.Select(x => Sort(x?.DeepClone())).ToArray()),
        _            => n?.DeepClone()
    };

    public static string Sha256Hex(string s) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(s))).ToLowerInvariant();
}