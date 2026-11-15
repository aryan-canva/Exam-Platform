using System.Security.Cryptography;
using System.Text;

namespace Watchdog.Events;

/// <summary>
/// Server-compatible event integrity chain.
/// hash = SHA256(prevHash + "{\"payload\":"+payloadJson+",\"severity\":\""+severity+"\",\"ts\":\""+ts+"\",\"type\":\""+type+"}")
/// hmac = HMAC-SHA256(sessionKeyBytes, hashHexUtf8) as lower-case hex.
/// sessionKey is the per-session key bytes/hex provided by server at session start.
/// First prevHash is 64 zeros, first seq is 0.
/// </summary>
public static class ServerEventChain
{
    public static readonly string Genesis = new('0', 64);

    public static string ComputeHash(string prevHash, string type, string severity, string ts, string payloadJson)
    {
        var signed = prevHash + "{\"payload\":" + payloadJson + ",\"severity\":\"" + severity + "\",\"ts\":\"" + ts + "\",\"type\":\"" + type + "\"}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(signed))).ToLowerInvariant();
    }

    public static string ComputeHmacHex(byte[] sessionKey, string hashHex)
        => Convert.ToHexString(HMACSHA256.HashData(sessionKey, Encoding.UTF8.GetBytes(hashHex))).ToLowerInvariant();

    public static byte[] DecodeSessionKey(string key)
    {
        key = key.Trim();
        if (key.Length == 64 && key.All(Uri.IsHexDigit)) return Convert.FromHexString(key);
        return Convert.FromBase64String(key);
    }
}

public sealed record SignedServerEvent(
    long Seq,
    string Type,
    string Severity,
    string Ts,
    string PayloadJson,
    string PrevHash,
    string Hash,
    string Hmac);
