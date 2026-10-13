package com.codingexam.platform.controller;

import com.codingexam.platform.dto.request.LoginRequest;
import com.codingexam.platform.dto.response.LoginResponse;
import com.codingexam.platform.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    /**
     * POST /auth/login
     * Body: { "username": "...", "password": "..." }
     * Returns: { accessToken, refreshToken, user }
     */
    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        LoginResponse response = authService.login(request.username(), request.password());
        return ResponseEntity.ok(response);
    }
}
