package com.codingexam.platform.controller;

import com.codingexam.platform.model.User;
import com.codingexam.platform.security.AuthContext;
import com.codingexam.platform.service.AdminService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Teacher/admin console endpoints (+ "my contests" and server time for students). */
@RestController
public class AdminController {

    private final AdminService admin;

    public AdminController(AdminService admin) {
        this.admin = admin;
    }

    private static void teacherOnly(AuthContext ctx) {
        ctx.requireRole(User.Role.TEACHER, User.Role.ADMIN);
    }

    @GetMapping("/time")
    public Map<String, Object> time() {
        return Map.of("now", Instant.now().toString());
    }

    // ── contests ─────────────────────────────────────────────────────────────
    @GetMapping("/contests")
    public List<Map<String, Object>> contests(@AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        return admin.listContests();
    }

    @GetMapping("/contests/mine")
    public List<Map<String, Object>> myContests(@AuthenticationPrincipal AuthContext ctx) {
        return admin.myContests(ctx.userId());
    }

    @GetMapping("/contests/{id}/detail")
    public Map<String, Object> contestDetail(@PathVariable UUID id, @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        return admin.contestDetail(id);
    }

    @PutMapping("/contests/{id}/languages")
    public Map<String, Object> setLanguages(@PathVariable UUID id, @RequestBody Map<String, Object> body,
                                            @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        Object l = body.get("languages");
        List<String> langs = new java.util.ArrayList<>();
        if (l instanceof List<?> li) for (Object o : li) langs.add(o == null ? null : o.toString());
        return admin.setLanguages(id, langs);
    }

    @PostMapping("/contests/{id}/start")
    public Map<String, Object> start(@PathVariable UUID id, @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        return admin.startContest(id);
    }

    @PostMapping("/contests/{id}/stop")
    public Map<String, Object> stop(@PathVariable UUID id, @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        return admin.stopContest(id);
    }

    @DeleteMapping("/contests/{id}/enroll/{userId}")
    public ResponseEntity<Void> unenroll(@PathVariable UUID id, @PathVariable UUID userId,
                                         @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        admin.unenroll(id, userId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/contests/{id}/submissions")
    public List<Map<String, Object>> submissions(@PathVariable UUID id, @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        return admin.contestSubmissions(id);
    }

    @GetMapping("/contests/{id}/standings")
    public List<Map<String, Object>> standings(@PathVariable UUID id, @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        return admin.standings(id);
    }

    // ── users ────────────────────────────────────────────────────────────────
    @GetMapping("/users")
    public List<Map<String, Object>> users(@RequestParam(required = false) String role,
                                           @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        return admin.listUsers(role);
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/users/students/bulk")
    public Map<String, Object> createStudents(@RequestBody Map<String, Object> body,
                                              @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        return admin.createStudents((List<Map<String, Object>>) body.get("students"));
    }

    @PostMapping("/users/{id}/password")
    public ResponseEntity<Void> resetPassword(@PathVariable UUID id, @RequestBody Map<String, String> body,
                                              @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        admin.resetPassword(id, body.get("password"));
        return ResponseEntity.noContent().build();
    }

    // ── problems ─────────────────────────────────────────────────────────────
    @GetMapping("/problems/{id}/testcases")
    public List<Map<String, Object>> testcases(@PathVariable UUID id, @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        return admin.testcases(id);
    }

    @DeleteMapping("/problems/{id}/testcases/{tcId}")
    public ResponseEntity<Void> deleteTestcase(@PathVariable UUID id, @PathVariable UUID tcId,
                                               @AuthenticationPrincipal AuthContext ctx) {
        teacherOnly(ctx);
        admin.deleteTestcase(id, tcId);
        return ResponseEntity.noContent().build();
    }
}
