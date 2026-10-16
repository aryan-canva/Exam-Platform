using System.Collections;
using System.Globalization;
using System.Text;

namespace Watchdog.Harness;

/// <summary>
/// PLACEHOLDER for the shared canonical-JSON rules (docs/canonical-json.md, owned by P1 + P3).
/// Follows RFC 8785 for what the harness emits: object keys sorted by UTF-16 code unit, no
/// whitespace, minimal string escaping, integers only. Supports null, bool, string, integer
/// types, dictionaries and lists. Floating point throws, because number formatting is exactly
/// where two implementations drift apart.
///
/// Replace with the shared implementation, and check it against
/// shared/test-vectors/canonical-json.json, before trusting any hash this produces.
/// </summary>
internal static class CanonicalJson
{
    public static string Serialize(object? value)
    {
        var sb = new StringBuilder();
        Write(sb, value);
        return sb.ToString();
    }

    private static void Write(StringBuilder sb, object? value)
    {
        switch (value)
        {
            case null:
                sb.Append("null");
                break;
            case string s:
                WriteString(sb, s);
                break;
            case bool b:
                sb.Append(b ? "true" : "false");
                break;
            case int or long or short or byte or sbyte or ushort or uint:
                sb.Append(Convert.ToString(value, CultureInfo.InvariantCulture));
                break;
            case IReadOnlyDictionary<string, object?> map:
                WriteObject(sb, map);
                break;
            case IDictionary<string, object?> map:
                WriteObject(sb, map.ToDictionary(kv => kv.Key, kv => kv.Value));
                break;
            case IEnumerable items:
                sb.Append('[');
                bool first = true;
                foreach (var item in items)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    Write(sb, item);
                }
                sb.Append(']');
                break;
            default:
                throw new NotSupportedException(
                    $"CanonicalJson cannot serialize {value.GetType().Name}. Convert it to string, bool or an integer first.");
        }
    }

    private static void WriteObject(StringBuilder sb, IReadOnlyDictionary<string, object?> map)
    {
        var keys = map.Keys.ToList();
        keys.Sort(string.CompareOrdinal); // UTF-16 code unit order, as RFC 8785 requires

        sb.Append('{');
        for (int i = 0; i < keys.Count; i++)
        {
            if (i > 0) sb.Append(',');
            WriteString(sb, keys[i]);
            sb.Append(':');
            Write(sb, map[keys[i]]);
        }
        sb.Append('}');
    }

    private static void WriteString(StringBuilder sb, string s)
    {
        sb.Append('"');
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
    }
}
