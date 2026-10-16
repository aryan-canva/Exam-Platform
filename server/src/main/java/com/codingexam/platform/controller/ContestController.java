package com.codingexam.platform.controller;

import com.codingexam.platform.dto.request.CreateContestRequest;
import com.codingexam.platform.dto.response.ContestView;
import com.codingexam.platform.model.Contest;
import com.codingexam.platform.model.User;
import com.codingexam.platform.security.AuthContext;
import com.codingexam.platform.service.ContestService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/contests")
public class ContestController {

    private final ContestService contestService;

    public ContestController(ContestService contestService) {
        this.contestService = contestService;
    }

    /** POST /contests — create a new contest (INSTRUCTOR/ADMIN only) */
    @PostMapping
    public ResponseEntity<Contest> createContest(@Valid @RequestBody CreateContestRequest req,
                                                  @AuthenticationPrincipal AuthContext ctx) {
        ctx.requireRole(User.Role.TEACHER, User.Role.ADMIN);
        Contest c = contestService.createContest(req, ctx.userId());
        return ResponseEntity.status(HttpStatus.CREATED).body(c);
    }

    /** POST /contests/{id}/problems — add a problem */
    @PostMapping("/{id}/problems")
    public ResponseEntity<Void> addProblem(@PathVariable UUID id,
                                            @RequestBody Map<String, Object> body,
                                            @AuthenticationPrincipal AuthContext ctx) {
        ctx.requireRole(User.Role.TEACHER, User.Role.ADMIN);
        UUID problemId = UUID.fromString((String) body.get("problemId"));
        String label   = (String) body.get("label");
        int points     = (int) body.getOrDefault("points", 100);
        contestService.addProblem(id, problemId, label, points);
        return ResponseEntity.ok().build();
    }

    /** POST /contests/{id}/enroll — bulk enroll students */
    @PostMapping("/{id}/enroll")
    public ResponseEntity<Map<String, Integer>> enroll(@PathVariable UUID id,
                                                        @RequestBody Map<String, List<String>> body,
                                                        @AuthenticationPrincipal AuthContext ctx) {
        ctx.requireRole(User.Role.TEACHER, User.Role.ADMIN);
        List<UUID> userIds = body.get("userIds").stream().map(UUID::fromString).toList();
        int count = contestService.enroll(id, userIds);
        return ResponseEntity.ok(Map.of("enrolled", count));
    }

    /** POST /contests/{id}/publish — publish contest */
    @PostMapping("/{id}/publish")
    public ResponseEntity<Contest> publish(@PathVariable UUID id,
                                            @AuthenticationPrincipal AuthContext ctx) {
        ctx.requireRole(User.Role.TEACHER, User.Role.ADMIN);
        Contest c = contestService.publish(id);
        return ResponseEntity.ok(c);
    }

    /** GET /contests/{id} — student view */
    @GetMapping("/{id}")
    public ResponseEntity<ContestView> getForStudent(@PathVariable UUID id,
                                                      @AuthenticationPrincipal AuthContext ctx) {
        ContestView view = contestService.getContestForStudent(id, ctx.userId());
        return ResponseEntity.ok(view);
    }
}
