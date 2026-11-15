package com.codingexam.platform.service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The event-integrity rules, shared by the Linux watchdog (lib/chain.js) and the server. No Spring here so it can be unit-tested alone.
 *
 *   hash = SHA256( prevHash + canonical({type,severity,ts,payload}) )     lower-case hex, UTF-8
 *   hmac = HMAC-SHA256( sessionKey bytes, hash as UTF-8 hex text )
 *   sessionKey = HMAC-SHA256( serverSecret, sessionId ) as hex (64 chars)
 *
 * canonical() sorts keys and has no whitespace, so the signed text is exactly
 *   {"payload":<payloadJson>,"severity":"..","ts":"..","type":".."}
 * payloadJson is already canonical text produced by the signer; the server hashes that text as received instead of
 * re-serialising it, so a different serialiser cannot change the result. type/severity/ts are restricted to
 * characters that need no JSON escaping.
 */
public final class EventChain {
    private EventChain() {}

    public static final String GENESIS = "0".repeat(64);
    public static final Set<String> SEVERITIES = Set.of("INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL");
    private static final Pattern TYPE = Pattern.compile("^[A-Z][A-Z0-9_]{1,49}$");
    private static final Pattern TS   = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$");
    private static final Pattern HEX64 = Pattern.compile("^[0-9a-f]{64}$");

    public static boolean validType(String s)     { return s != null && TYPE.matcher(s).matches(); }
    public static boolean validTs(String s)       { return s != null && TS.matcher(s).matches(); }
    public static boolean validHash(String s)     { return s != null && HEX64.matcher(s).matches(); }

    /** Per-session signing key, hex. Same inputs always give the same key, so a resumed watchdog gets the same one. */
    public static String sessionKey(String serverSecret, UUID sessionId) {
        return HexFormat.of().formatHex(hmac(serverSecret.getBytes(StandardCharsets.UTF_8), sessionId.toString()));
    }

    public static String hash(String prevHash, String type, String severity, String ts, String payloadJson) {
        String signed = prevHash + "{\"payload\":" + payloadJson + ",\"severity\":\"" + severity + "\",\"ts\":\"" + ts + "\",\"type\":\"" + type + "\"}";
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(signed.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    public static String hmacHex(String keyHex, String hash) {
        return HexFormat.of().formatHex(hmac(HexFormat.of().parseHex(keyHex), hash));
    }

    public static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) return false;
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] hmac(byte[] key, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (java.security.GeneralSecurityException e) { throw new IllegalStateException(e); }
    }
}
