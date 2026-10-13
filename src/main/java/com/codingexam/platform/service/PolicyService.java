package com.codingexam.platform.service;

import com.codingexam.platform.crypto.CryptoService;
import com.codingexam.platform.model.*;
import com.codingexam.platform.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

/**
 * PolicyService – Person 1 (1.6)
 * <p>
 * buildPolicy(contestId)         → Policy (unsigned)
 * signPolicy(policy)             → Policy (signature set)
 * buildAndSignPolicy(contestId)  → Policy (both, convenience)
 * getPolicyForSession(sessionId) → Policy
 * publicKey()                    → byte[] (Ed25519 public key)
 */
@Service
public class PolicyService {

    private final ContestRepository contestRepo;
    private final PolicyRepository policyRepo;
    private final SessionRepository sessionRepo;
    private final CryptoService cryptoService;

    public PolicyService(ContestRepository contestRepo,
                         PolicyRepository policyRepo,
                         SessionRepository sessionRepo,
                         CryptoService cryptoService) {
        this.contestRepo = contestRepo;
        this.policyRepo = policyRepo;
        this.sessionRepo = sessionRepo;
        this.cryptoService = cryptoService;
    }

    // ── Build ─────────────────────────────────────────────────────────────────

    /**
     * Build a Policy from contest configuration.
     * The returned Policy is NOT yet persisted (no id) and NOT signed.
     */
    @Transactional
    public Policy buildPolicy(UUID contestId) {
        Contest contest = contestRepo.findById(contestId)
            .orElseThrow(() -> new NotFoundException("Contest not found: " + contestId));

        // Determine next version
        int nextVersion = policyRepo
            .findTopByContestIdOrderByVersionDesc(contestId)
            .map(p -> p.getVersion() + 1)
            .orElse(1);

        // Build policy JSON document
        Map<String, Object> policyDoc = buildPolicyDocument(contest, contestId, nextVersion);
        String policyJson = cryptoService.canonicalJson(policyDoc);

        Policy policy = new Policy();
        policy.setContest(contest);
        policy.setVersion(nextVersion);
        policy.setJson(policyJson);
        policy.setSignature(new byte[0]); // placeholder until signed

        return policy;
    }

    /**
     * Sign a policy with the server's Ed25519 private key and persist it.
     */
    @Transactional
    public Policy signPolicy(Policy policy) {
        byte[] jsonBytes = policy.getJson().getBytes(StandardCharsets.UTF_8);
        byte[] signature = cryptoService.sign(jsonBytes);
        policy.setSignature(signature);
        return policyRepo.save(policy);
    }

    /**
     * Build and sign in one step (used by ContestService.publish).
     */
    @Transactional
    public Policy buildAndSignPolicy(UUID contestId) {
        Policy policy = buildPolicy(contestId);
        return signPolicy(policy);
    }

    // ── Retrieve ──────────────────────────────────────────────────────────────

    /**
     * Return the signed policy for an active session.
     * Called by the Watchdog (Person 2/3) when starting a session.
     */
    @Transactional(readOnly = true)
    public Policy getPolicyForSession(UUID sessionId) {
        Session session = sessionRepo.findById(sessionId)
            .orElseThrow(() -> new NotFoundException("Session not found: " + sessionId));

        UUID contestId = session.getContest().getId();
        return policyRepo.findTopByContestIdOrderByVersionDesc(contestId)
            .orElseThrow(() -> new NotFoundException("No policy for contest: " + contestId));
    }

    // ── Public key ────────────────────────────────────────────────────────────

    /**
     * Return the server's Ed25519 public key bytes (X509 SubjectPublicKeyInfo).
     * Shared with all clients so they can verify policy signatures.
     */
    public byte[] publicKey() {
        return cryptoService.publicKeyBytes();
    }

    /**
     * Return the public key as a Base64-encoded string (for HTTP transport).
     */
    public String publicKeyBase64() {
        return Base64.getEncoder().encodeToString(publicKey());
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Map<String, Object> buildPolicyDocument(Contest contest, UUID contestId, int version) {
        // Default safe allowlist — extend from contest config in a real build
        List<Map<String, String>> allowedProcesses = List.of(
            Map.of("name", "chrome.exe"),
            Map.of("name", "msedge.exe"),
            Map.of("name", "firefox.exe"),
            Map.of("name", "CodingExamKiosk.exe")
        );

        // Server address (configurable; hardcoded to localhost for dev)
        Map<String, Object> allowedServer = Map.of(
            "host", "localhost",
            "ip",   "127.0.0.1",
            "ports", List.of(8080, 443)
        );

        return Map.of(
            "policyId",        UUID.randomUUID().toString(),
            "contestId",       contestId.toString(),
            "version",         version,
            "allowedProcesses", allowedProcesses,
            "allowedServer",   allowedServer,
            "blockUsb",        true,
            "blockedKeys",     List.of("VK_LWIN", "VK_RWIN"),
            "durationSec",     contest.getDurationSec(),
            "heartbeatSec",    30,
            "issuedAt",        Instant.now().toString()
        );
    }

    // ── Exception ─────────────────────────────────────────────────────────────

    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String message) { super(message); }
    }
}
