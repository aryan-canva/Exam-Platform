package com.codingexam.platform.controller;

import com.codingexam.platform.dto.request.LoginRequest;
import com.codingexam.platform.dto.response.LoginResponse;
import com.codingexam.platform.model.User;
import com.codingexam.platform.repository.UserRepository;
import com.codingexam.platform.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService authService;
    private final UserRepository userRepository;

    public AuthController(AuthService authService, UserRepository userRepository) {
        this.authService = authService;
        this.userRepository = userRepository;
    }

    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        LoginResponse response = authService.login(request.username(), request.password());
        return ResponseEntity.ok(response);
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody LoginRequest req) {
        User user = new User();
        user.setUsername(req.username());
        user.setPasswordHash(authService.hashPassword(req.password()));
        user.setRole(User.Role.TEACHER);
        user.setFullName("Demo Teacher");
        user.setActive(true);
        userRepository.save(user);
        return ResponseEntity.ok(Map.of("created", user.getUsername()));
    }
}