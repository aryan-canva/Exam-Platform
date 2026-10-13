package com.codingexam.platform.crypto;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.TreeMap;

/**
 * CryptoService – Person 1 (1.2)
 * <p>
 * Provides:
 *   sign(byte[])           → base64url signature (Ed25519)
 *   verify(byte[], sig, pubKey) → boolean
 *   hmac(key, data)        → hex string (HmacSHA256)
 *   sha256(data)           → hex string
 *   canonicalJson(obj)     → deterministic JSON string (sorted keys)
 *   publicKeyBytes()       → raw Ed25519 public key bytes
 * <p>
 * Keys are auto-generated on first startup and persisted to the paths
 * configured by app.crypto.private-key-path / app.crypto.public-key-path.
 */
@Service
public class CryptoService {

    @Value("${app.crypto.private-key-path:keys/ed25519_private.pem}")
    private String privateKeyPath;

    @Value("${app.crypto.public-key-path:keys/ed25519_public.pem}")
    private String publicKeyPath;

    private PrivateKey privateKey;
    private PublicKey publicKey;

    private final ObjectMapper canonicalMapper;

    public CryptoService() {
        // Canonical JSON: sorted keys, no pretty-print
        this.canonicalMapper = new ObjectMapper();
        this.canonicalMapper.configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @PostConstruct
    public void init() throws Exception {
        Path privPath = Path.of(privateKeyPath);
        Path pubPath  = Path.of(publicKeyPath);

        if (Files.exists(privPath) && Files.exists(pubPath)) {
            loadKeys(privPath, pubPath);
        } else {
            generateAndSaveKeys(privPath, pubPath);
        }
    }

    private void generateAndSaveKeys(Path privPath, Path pubPath) throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("Ed25519");
        KeyPair kp = kpg.generateKeyPair();
        this.privateKey = kp.getPrivate();
        this.publicKey  = kp.getPublic();

        Files.createDirectories(privPath.getParent() == null ? Path.of(".") : privPath.getParent());
        Files.createDirectories(pubPath.getParent()  == null ? Path.of(".") : pubPath.getParent());

        savePem(privPath, "PRIVATE KEY", privateKey.getEncoded());
        savePem(pubPath,  "PUBLIC KEY",  publicKey.getEncoded());
    }

    private void loadKeys(Path privPath, Path pubPath) throws Exception {
        byte[] privBytes = readPemBytes(privPath);
        byte[] pubBytes  = readPemBytes(pubPath);

        KeyFactory kf = KeyFactory.getInstance("Ed25519");
        this.privateKey = kf.generatePrivate(new PKCS8EncodedKeySpec(privBytes));
        this.publicKey  = kf.generatePublic(new X509EncodedKeySpec(pubBytes));
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Sign arbitrary bytes with the server's Ed25519 private key.
     * Returns base64url-encoded signature bytes.
     */
    public byte[] sign(byte[] data) {
        try {
            Signature sig = Signature.getInstance("Ed25519");
            sig.initSign(privateKey);
            sig.update(data);
            return sig.sign();
        } catch (Exception e) {
            throw new CryptoException("Signing failed", e);
        }
    }

    /**
     * Verify an Ed25519 signature.
     *
     * @param data      original data bytes
     * @param signature signature bytes (as returned by sign())
     * @param pubKeyBytes  raw SubjectPublicKeyInfo (X509) encoded public key bytes
     */
    public boolean verify(byte[] data, byte[] signature, byte[] pubKeyBytes) {
        try {
            KeyFactory kf = KeyFactory.getInstance("Ed25519");
            PublicKey pk = kf.generatePublic(new X509EncodedKeySpec(pubKeyBytes));
            Signature sig = Signature.getInstance("Ed25519");
            sig.initVerify(pk);
            sig.update(data);
            return sig.verify(signature);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * HMAC-SHA256 of data using the given key.
     * Returns lower-case hex string.
     */
    public String hmac(byte[] key, byte[] data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return toHex(mac.doFinal(data));
        } catch (Exception e) {
            throw new CryptoException("HMAC failed", e);
        }
    }

    /** Convenience overload: hmac with String key (UTF-8). */
    public String hmac(String key, String data) {
        return hmac(
            key.getBytes(StandardCharsets.UTF_8),
            data.getBytes(StandardCharsets.UTF_8)
        );
    }

    /**
     * SHA-256 hash of the given bytes.
     * Returns lower-case hex string.
     */
    public String sha256(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return toHex(md.digest(data));
        } catch (Exception e) {
            throw new CryptoException("SHA-256 failed", e);
        }
    }

    /** Convenience overload: sha256 of a UTF-8 string. */
    public String sha256(String data) {
        return sha256(data.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Produce a deterministic (canonical) JSON string from any object.
     * Object keys are sorted alphabetically at every nesting level.
     */
    public String canonicalJson(Object obj) {
        try {
            // Convert to a sorted TreeMap structure and re-serialize
            Object sorted = deepSort(obj);
            return canonicalMapper.writeValueAsString(sorted);
        } catch (Exception e) {
            throw new CryptoException("Canonical JSON failed", e);
        }
    }

    /** Raw public key bytes (X509 SubjectPublicKeyInfo), for sharing. */
    public byte[] publicKeyBytes() {
        return publicKey.getEncoded();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private Object deepSort(Object obj) {
        if (obj instanceof java.util.Map<?, ?> map) {
            TreeMap<String, Object> sorted = new TreeMap<>();
            for (var entry : map.entrySet()) {
                sorted.put(entry.getKey().toString(), deepSort(entry.getValue()));
            }
            return sorted;
        }
        if (obj instanceof java.util.List<?> list) {
            return list.stream().map(this::deepSort).toList();
        }
        return obj;
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static void savePem(Path path, String label, byte[] der) throws IOException {
        String encoded = Base64.getEncoder().encodeToString(der);
        String pem = "-----BEGIN " + label + "-----\n"
                   + encoded.replaceAll("(.{64})", "$1\n")
                   + "\n-----END " + label + "-----\n";
        Files.writeString(path, pem);
    }

    private static byte[] readPemBytes(Path path) throws IOException {
        String pem = Files.readString(path);
        String stripped = pem
            .replaceAll("-----BEGIN [^-]+-----", "")
            .replaceAll("-----END [^-]+-----", "")
            .replaceAll("\\s+", "");
        return Base64.getDecoder().decode(stripped);
    }

    // ── Exception ─────────────────────────────────────────────────────────────

    public static class CryptoException extends RuntimeException {
        public CryptoException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
