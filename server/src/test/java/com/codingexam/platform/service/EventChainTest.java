package com.codingexam.platform.service;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Vectors below were produced independently with Node (watchdog-linux/lib/chain.js, see its chain.test.js). */
class EventChainTest {

    private static final String PAYLOAD = "{\"cmd\":\"\u00e9\\\"x\",\"killed\":true,\"name\":\"firefox\",\"pid\":123}";

    @Test
    void hashMatchesTheWatchdogImplementation() {
        assertEquals("306d5f77e7e1c4616df89a771ff3cfeb23fff8206287cd82e7fbc8b9cb19cade",
            EventChain.hash(EventChain.GENESIS, "PROCESS_BLOCKED", "HIGH", "2026-11-13T10:00:00.000Z", PAYLOAD));
    }

    @Test
    void hmacMatchesTheWatchdogImplementation() {
        String key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
        assertEquals("1390fe41ed0006ef14dad6cfa5db68d96d2f0e77b55d3b732d3bcf6d41df9584",
            EventChain.hmacHex(key, "306d5f77e7e1c4616df89a771ff3cfeb23fff8206287cd82e7fbc8b9cb19cade"));
    }

    @Test
    void sessionKeyIsStablePerSessionAndMatchesNode() {
        UUID sid = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        String secret = "test-secret-test-secret-test-secret-1234";
        assertEquals("88f0f0f2f37a305a10de0d67e89fd4f7225eb8ed183e6eafab9d320bb7052c6d", EventChain.sessionKey(secret, sid));
        assertNotEquals(EventChain.sessionKey(secret, sid), EventChain.sessionKey(secret, UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")));
        assertNotEquals(EventChain.sessionKey(secret, sid), EventChain.sessionKey(secret + "x", sid));
    }

    @Test
    void formatChecks() {
        assertTrue(EventChain.validType("WD_HEARTBEAT"));
        assertFalse(EventChain.validType("wd_heartbeat"));
        assertFalse(EventChain.validType("A\"B"));
        assertTrue(EventChain.validTs("2026-11-13T10:00:00.000Z"));
        assertFalse(EventChain.validTs("2026-11-13T10:00:00Z"));
        assertTrue(EventChain.validHash("a".repeat(64)));
        assertFalse(EventChain.validHash("A".repeat(64)));
        assertFalse(EventChain.constantTimeEquals("a", null));
    }
}
