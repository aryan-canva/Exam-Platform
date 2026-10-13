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
    public ResponseEntity<Policy> getPolicyForSession(@PathVariable UUID sessionId) {
        Policy policy = policyService.getPolicyForSession(sessionId);
        return ResponseEntity.ok(policy);
    }

    /** GET /crypto/public-key — returns the server's Ed25519 public key (Base64) */
    @GetMapping("/crypto/public-key")
    public ResponseEntity<Map<String, String>> getPublicKey() {
        return ResponseEntity.ok(Map.of("publicKey", policyService.publicKeyBase64()));
    }
}
