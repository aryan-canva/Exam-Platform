package com.codingexam.platform.controller;

import com.codingexam.platform.dto.request.SubmitRequest;
import com.codingexam.platform.dto.response.SubmissionView;
import com.codingexam.platform.model.Submission;
import com.codingexam.platform.security.AuthContext;
import com.codingexam.platform.service.SubmissionService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
public class SubmissionController {

    private final SubmissionService submissionService;

    public SubmissionController(SubmissionService submissionService) {
        this.submissionService = submissionService;
    }

    @PostMapping("/submissions")
    public ResponseEntity<Submission> submit(@Valid @RequestBody SubmitRequest req,
                                              @AuthenticationPrincipal AuthContext ctx) {
        Submission sub = submissionService.submit(req, ctx.userId());
        return ResponseEntity.status(HttpStatus.CREATED).body(sub);
    }

    @GetMapping("/submissions")
    public ResponseEntity<List<SubmissionView>> getMySubmissions(
            @RequestParam UUID contestId,
            @AuthenticationPrincipal AuthContext ctx) {
        List<SubmissionView> views = submissionService.getSubmissions(contestId, ctx.userId());
        return ResponseEntity.ok(views);
    }

    @GetMapping("/submissions/{id}")
    public ResponseEntity<Submission> getSubmission(@PathVariable UUID id,
                                                     @AuthenticationPrincipal AuthContext ctx) {
        Submission sub = submissionService.getSubmission(id, ctx.userId());
        return ResponseEntity.ok(sub);
    }

    @GetMapping("/contests/{id}/scoreboard")
    public ResponseEntity<List<SubmissionService.ScoreEntry>> scoreboard(
            @PathVariable UUID id,
            @AuthenticationPrincipal AuthContext ctx) {
        List<SubmissionService.ScoreEntry> board = submissionService.scoreboard(id);
        return ResponseEntity.ok(board);
    }
}