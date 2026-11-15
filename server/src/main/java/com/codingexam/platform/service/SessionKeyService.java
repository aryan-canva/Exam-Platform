package com.codingexam.platform.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.UUID;

/** Derives each session's event-signing key from the server secret; nothing is stored. */
@Component
public class SessionKeyService {
    private final String secret;

    public SessionKeyService(@Value("${app.integrity.secret}") String secret) {
        this.secret = secret;
    }

    public String keyFor(UUID sessionId) {
        return EventChain.sessionKey(secret, sessionId);
    }
}
