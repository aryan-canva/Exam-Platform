package com.codingexam.platform.controller;

import com.codingexam.platform.model.Policy;
import com.codingexam.platform.service.PolicyService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
public class PolicyController {

    private final PolicyService policyService;

    public PolicyController(PolicyService policyService) {
        this.policyService = policyService;
    }

    /** GET /sessions/{sessionId}/policy — returns signed policy for a session */
    @GetMapping("/sessions/{sessionId}/policy")
    public ResponseEntity<Map<String, Object>> getPolicyForSession(@PathVariable UUID sessionId) {
        Policy policy = policyService.getPolicyForSession(sessionId);
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("policyId", policy.getId());
        out.put("version", policy.getVersion());
        out.put("json", policy.getJson());
        out.put("signature", java.util.Base64.getEncoder().encodeToString(policy.getSignature()));
        out.put("issuedAt", policy.getCreatedAt() == null ? null : policy.getCreatedAt().toString());
        return ResponseEntity.ok(out);
    }

    /** GET /crypto/public-key — returns the server's Ed25519 public key (Base64) */
    @GetMapping("/crypto/public-key")
    public ResponseEntity<Map<String, String>> getPublicKey() {
        return ResponseEntity.ok(Map.of("publicKey", policyService.publicKeyBase64()));
    }
}
