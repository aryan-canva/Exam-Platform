package com.codingexam.platform.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Refuses to start (when APP_REQUIRE_STRONG_SECRETS=true) or logs a loud warning (default) if the server
 * is running with the built-in/placeholder secrets. A server reachable from the internet with a known JWT
 * secret lets anyone forge a teacher token.
 */
@Component
public class SecretsGuard {

    private static final Logger log = LoggerFactory.getLogger(SecretsGuard.class);
    private static final String BUILTIN_JWT = "ThisIsAVerySecretKeyThatIsAtLeast256BitsLong1234567890ABCDEF";

    public SecretsGuard(@Value("${app.jwt.secret}") String jwtSecret,
                        @Value("${app.judge.worker-token:dev-worker-token}") String workerToken,
                        @Value("${spring.datasource.password:}") String dbPassword,
                        @Value("${app.integrity.secret:dev-integrity-secret-change-me}") String integritySecret,
                        @Value("${app.require-strong-secrets:false}") boolean enforce) {
        List<String> problems = check(jwtSecret, workerToken, dbPassword, integritySecret);
        if (problems.isEmpty()) return;
        String msg = "Weak/default secrets: " + String.join("; ", problems)
                + ". Set them in server/.env (openssl rand -base64 32) before exposing the server to a network.";
        if (enforce) throw new IllegalStateException(msg);
        log.warn("*** {} (set APP_REQUIRE_STRONG_SECRETS=true to refuse to start) ***", msg);
    }

    static boolean weak(String v, int minLen) {
        if (v == null) return true;
        String s = v.trim().toLowerCase();
        return s.length() < minLen || s.contains("change-me") || s.contains("changeme");
    }

    static List<String> check(String jwt, String worker, String db, String integrity) {
        List<String> p = new ArrayList<>();
        if (weak(jwt, 32) || BUILTIN_JWT.equals(jwt)) p.add("APP_JWT_SECRET is the built-in/placeholder value or shorter than 32 characters");
        if (weak(worker, 16) || "dev-worker-token".equals(worker)) p.add("APP_JUDGE_WORKER_TOKEN is the default/placeholder or shorter than 16 characters");
        if (weak(db, 8) || "system".equals(db) || "postgres".equals(db)) p.add("POSTGRES_PASSWORD is the default/placeholder or shorter than 8 characters");
        if (weak(integrity, 32) || "dev-integrity-secret-change-me".equals(integrity)) p.add("APP_INTEGRITY_SECRET is the default/placeholder or shorter than 32 characters");
        return p;
    }
}
