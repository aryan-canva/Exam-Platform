using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;

namespace Watchdog.Events;

/// <summary>
/// Deterministic JSON (sorted keys, no whitespace) used for hashing/signing event payloads.
/// Compatible with the server/watchdog-linux canonical form for objects/arrays/strings/bools/null.
/// </summary>
public static class CanonicalJson
{
    public static string Serialize(JsonNode? node) => Write(node);

    public static string SerializeObject(IReadOnlyDictionary<string, object?> payload)
    {
        var obj = new JsonObject();
        foreach (var kv in payload.OrderBy(k => k.Key, StringComparer.Ordinal))
        {
            obj[kv.Key] = ToNode(kv.Value);
        }
        return obj.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = false }) is string s
            ? CanonicalizeJsonString(s, obj)
            : Write(obj);
    }

    private static string CanonicalizeJsonString(string _, JsonNode node) => Write(node);

    private static string Write(JsonNode? node)
    {
        switch (node)
        {
            case null:
                return "null";
            case JsonValue v:
                if (v.TryGetValue<string>(out var s)) return JsonString(s);
                if (v.TryGetValue<bool>(out var b)) return b ? "true" : "false";
                if (v.TryGetValue<long>(out var l)) return l.ToString(CultureInfo.InvariantCulture);
                if (v.TryGetValue<int>(out var i)) return i.ToString(CultureInfo.InvariantCulture);
                if (v.TryGetValue<ulong>(out var ul)) return ul.ToString(CultureInfo.InvariantCulture);
                if (v.TryGetValue<uint>(out var ui)) return ui.ToString(CultureInfo.InvariantCulture);
                if (v.TryGetValue<decimal>(out var dec)) return dec.ToString(CultureInfo.InvariantCulture);
                if (v.TryGetValue<double>(out var d)) return d.ToString("R", CultureInfo.InvariantCulture);
                if (v.TryGetValue<float>(out var f)) return f.ToString("R", CultureInfo.InvariantCulture);
                return v.ToJsonString();
            case JsonArray a:
                return "[" + string.Join(",", a.Select(Write)) + "]";
            case JsonObject o:
                var sb = new StringBuilder();
                sb.Append('{');
                bool first = true;
                foreach (var kv in o.OrderBy(k => k.Key, StringComparer.Ordinal))
                {
                    if (!first) sb.Append(',');
                    first = false;
                    sb.Append(JsonString(kv.Key));
                    sb.Append(':');
                    sb.Append(Write(kv.Value));
                }
                sb.Append('}');
                return sb.ToString();
            default:
                return node.ToJsonString();
        }
    }

    public static JsonNode? ToNode(object? value)
    {
        if (value is null) return null;
        return value switch
        {
            JsonNode n => n.DeepClone(),
            string s => JsonValue.Create(s),
            bool b => JsonValue.Create(b),
            int i => JsonValue.Create(i),
            long l => JsonValue.Create(l),
            short sh => JsonValue.Create((int)sh),
            byte by => JsonValue.Create((int)by),
            uint ui => JsonValue.Create(ui),
            ulong ul => JsonValue.Create(ul),
            float f => JsonValue.Create(f),
            double d => JsonValue.Create(d),
            decimal dec => JsonValue.Create(dec),
            DateTime dt => JsonValue.Create(dt.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)),
            DateTimeOffset dto => JsonValue.Create(dto.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)),
            Enum e => JsonValue.Create(e.ToString()),
            IReadOnlyDictionary<string, object?> rod => DictToNode(rod),
            IDictionary<string, object?> dct => DictToNode(dct.ToDictionary(k => k.Key, v => v.Value)),
            System.Collections.IDictionary id => DictToNode(id.Keys.Cast<object?>().Where(k => k != null).ToDictionary(k => k!.ToString()!, k => id[k!])),
            System.Collections.IEnumerable en when value is not string => new JsonArray(en.Cast<object?>().Select(ToNode).ToArray()),
            _ => JsonValue.Create(value.ToString())
        };
    }

    private static JsonObject DictToNode(IEnumerable<KeyValuePair<string, object?>> d)
    {
        var o = new JsonObject();
        foreach (var kv in d) o[kv.Key] = ToNode(kv.Value);
        return o;
    }

    private static string JsonString(string s) => System.Text.Json.JsonSerializer.Serialize(s);
}
