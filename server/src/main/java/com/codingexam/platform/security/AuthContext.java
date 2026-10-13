package com.codingexam.platform.security;

import com.codingexam.platform.model.User;
import java.util.UUID;

/**
 * Immutable auth context attached to each request after token validation.
 */
public record AuthContext(UUID userId, User.Role role) {

    public boolean hasRole(User.Role... roles) {
        for (User.Role r : roles) {
            if (this.role == r) return true;
        }
        return false;
    }

    public void requireRole(User.Role... roles) {
        if (!hasRole(roles)) {
            throw new ForbiddenException("Access denied. Required role: " + java.util.Arrays.toString(roles));
        }
    }

    public static class ForbiddenException extends RuntimeException {
        public ForbiddenException(String message) { super(message); }
    }
}
