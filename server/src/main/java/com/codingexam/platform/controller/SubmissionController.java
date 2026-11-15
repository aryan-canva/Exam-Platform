package com.codingexam.platform.controller;

import com.codingexam.platform.dto.request.SubmitRequest;
import com.codingexam.platform.dto.response.SubmissionView;
import com.codingexam.platform.model.Submission;
import com.codingexam.platform.security.AuthContext;
import com.codingexam.platform.service.JudgeQueueService;
import com.codingexam.platform.service.SubmissionService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
public class SubmissionController {

    private final SubmissionService submissionService;
    private final JudgeQueueService judgeQueue;
    private final com.codingexam.platform.service.AdminService admin;

    public SubmissionController(SubmissionService submissionService, JudgeQueueService judgeQueue,
                                com.codingexam.platform.service.AdminService admin) {
        this.submissionService = submissionService;
        this.judgeQueue = judgeQueue;
        this.admin = admin;
    }

    @PostMapping("/submissions")
    public ResponseEntity<Map<String, Object>> submit(@Valid @RequestBody SubmitRequest req,
                                              @AuthenticationPrincipal AuthContext ctx) {
        admin.requireLanguage(req.contestId(), req.language());
        Submission sub = submissionService.submit(req, ctx.userId());
        judgeQueue.enqueueSubmission(sub.getId());   // after the submission transaction committed
        return ResponseEntity.status(HttpStatus.CREATED).body(admin.submissionCreated(sub.getId()));
    }

    @GetMapping("/submissions")
    public ResponseEntity<List<SubmissionView>> getMySubmissions(
            @RequestParam UUID contestId,
            @AuthenticationPrincipal AuthContext ctx) {
        List<SubmissionView> views = submissionService.getSubmissions(contestId, ctx.userId());
        return ResponseEntity.ok(views);
    }

    @GetMapping("/submissions/{id}")
    public ResponseEntity<Map<String, Object>> getSubmission(@PathVariable UUID id,
                                                     @AuthenticationPrincipal AuthContext ctx) {
        boolean teacher = ctx.hasRole(com.codingexam.platform.model.User.Role.TEACHER, com.codingexam.platform.model.User.Role.ADMIN);
        return ResponseEntity.ok(admin.submissionDetail(id, ctx.userId(), teacher));
    }

    @GetMapping("/contests/{id}/scoreboard")
    public ResponseEntity<List<SubmissionService.ScoreEntry>> scoreboard(
            @PathVariable UUID id,
            @AuthenticationPrincipal AuthContext ctx) {
        List<SubmissionService.ScoreEntry> board = submissionService.scoreboard(id);
        return ResponseEntity.ok(board);
    }
}