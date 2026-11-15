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

    private final com.codingexam.platform.service.AdminService admin;

    public AuthController(AuthService authService, UserRepository userRepository,
                          com.codingexam.platform.service.AdminService admin) {
        this.authService = authService;
        this.userRepository = userRepository;
        this.admin = admin;
    }

    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        LoginResponse response = authService.login(request.username(), request.password());
        return ResponseEntity.ok(response);
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody LoginRequest req,
            @org.springframework.security.core.annotation.AuthenticationPrincipal com.codingexam.platform.security.AuthContext caller) {
        // First-run bootstrap: anyone may create the first teacher. After that only a logged-in teacher/admin may.
        if (admin.anyTeacherExists()) {
            if (caller == null) throw new com.codingexam.platform.security.AuthContext.ForbiddenException("Log in as a teacher to create another teacher account");
            caller.requireRole(User.Role.TEACHER, User.Role.ADMIN);
        }
        if (req.password() == null || req.password().length() < 8) {
            throw new com.codingexam.platform.service.JudgeQueueService.BadRequestException("Password must be at least 8 characters");
        }
        if (userRepository.existsByUsername(req.username())) {
            throw new com.codingexam.platform.service.JudgeQueueService.ConflictException("Username already exists");
        }
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