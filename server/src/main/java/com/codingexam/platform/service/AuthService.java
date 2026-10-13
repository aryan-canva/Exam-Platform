package com.codingexam.platform.service;

import com.codingexam.platform.dto.request.LoginRequest;
import com.codingexam.platform.dto.response.LoginResponse;
import com.codingexam.platform.model.User;
import com.codingexam.platform.repository.UserRepository;
import com.codingexam.platform.security.AuthContext;
import com.codingexam.platform.security.JwtService;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * AuthService – Person 1 (1.3)
 * <p>
 * hashPassword(plain)             → argon2id hash string
 * verifyPassword(plain, hash)     → bool
 * login(username, password)       → Result<{accessToken, user}>
 * verifyToken(jwt)                → AuthContext
 * requireRole(ctx, roles)         → void | throws ForbiddenException
 */
@Service
public class AuthService {

    // Argon2id with recommended parameters (Spring Security defaults are fine for demo)
    private static final Argon2PasswordEncoder passwordEncoder =
        Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();

    private final UserRepository userRepository;
    private final JwtService jwtService;

    public AuthService(UserRepository userRepository, JwtService jwtService) {
        this.userRepository = userRepository;
        this.jwtService = jwtService;
    }

    // ── Password ──────────────────────────────────────────────────────────────

    /**
     * Hash a plain-text password using Argon2id.
     * Store the returned string; never store the plain password.
     */
    public String hashPassword(String plain) {
        return passwordEncoder.encode(plain);
    }

    /**
     * Verify a plain-text password against an Argon2id hash.
     */
    public boolean verifyPassword(String plain, String hash) {
        return passwordEncoder.matches(plain, hash);
    }

    // ── Login ─────────────────────────────────────────────────────────────────

    /**
     * Authenticate a user and return JWT tokens.
     *
     * @throws AuthException on invalid credentials or inactive account
     */
    @Transactional(readOnly = true)
    public LoginResponse login(String username, String password) {
        User user = userRepository.findByUsername(username)
            .orElseThrow(() -> new AuthException("Invalid credentials"));

        if (!user.isActive()) {
            throw new AuthException("Account is disabled");
        }

        if (!verifyPassword(password, user.getPasswordHash())) {
            throw new AuthException("Invalid credentials");
        }

        String accessToken  = jwtService.generateAccessToken(user.getId().toString(), user.getRole().name());
        String refreshToken = jwtService.generateRefreshToken(user.getId().toString());

        return new LoginResponse(
            accessToken,
            refreshToken,
            new LoginResponse.UserDTO(user.getId(), user.getUsername(), user.getRole().name(), user.getFullName())
        );
    }

    // ── Token ─────────────────────────────────────────────────────────────────

    /**
     * Validate a JWT and return the caller's AuthContext.
     *
     * @throws AuthException if the token is invalid or expired
     */
    public AuthContext verifyToken(String jwt) {
        try {
            Claims claims = jwtService.validateToken(jwt);
            UUID userId = UUID.fromString(claims.getSubject());
            User.Role role = User.Role.valueOf(claims.get("role", String.class));
            return new AuthContext(userId, role);
        } catch (JwtException | IllegalArgumentException e) {
            throw new AuthException("Invalid or expired token");
        }
    }

    /**
     * Guard: throws ForbiddenException if the caller doesn't have one of the required roles.
     */
    public void requireRole(AuthContext ctx, User.Role... roles) {
        ctx.requireRole(roles);
    }

    // ── Exceptions ────────────────────────────────────────────────────────────

    public static class AuthException extends RuntimeException {
        public AuthException(String message) { super(message); }
    }
}
