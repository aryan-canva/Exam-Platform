package com.codingexam.platform.controller;

import com.codingexam.platform.model.User;
import com.codingexam.platform.security.AuthContext;
import com.codingexam.platform.service.JudgeQueueService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Judge-facing endpoints (/judge/**, authenticated with X-Worker-Token, no JWT)
 * plus the student "Run" endpoints and a teacher view of the workers.
 */
@RestController
public class JudgeController {

    private final JudgeQueueService judge;

    public JudgeController(JudgeQueueService judge) {
        this.judge = judge;
    }

    // ── Worker API ───────────────────────────────────────────────────────────

    /** Long-poll for the next job. 200 + job JSON, or 204 after `wait` seconds with nothing. */
    @PostMapping("/judge/claim")
    public ResponseEntity<Map<String, Object>> claim(
            @RequestHeader(value = "X-Worker-Token", required = false) String token,
            @RequestParam String workerId,
            @RequestParam(required = false) String version,
            @RequestParam(defaultValue = "20") int wait,
            HttpServletRequest request) throws InterruptedException {
        judge.checkWorkerToken(token);
        judge.touchWorker(workerId, request.getRemoteAddr(), version);

        long deadline = System.currentTimeMillis() + Math.min(Math.max(wait, 0), 25) * 1000L;
        while (true) {
            Map<String, Object> job = judge.claim(workerId);
            if (job != null) return ResponseEntity.ok(job);
            if (System.currentTimeMillis() >= deadline) break;
            Thread.sleep(500);
        }
        judge.touchWorker(workerId, request.getRemoteAddr(), version);
        return ResponseEntity.noContent().build();
    }

    /** Worker posts the verdicts for a job it claimed. */
    @PostMapping("/judge/jobs/{id}/result")
    public ResponseEntity<Map<String, Object>> result(
            @RequestHeader(value = "X-Worker-Token", required = false) String token,
            @PathVariable UUID id,
            @RequestBody Map<String, Object> body) {
        judge.checkWorkerToken(token);
        judge.complete(id, String.valueOf(body.getOrDefault("workerId", "")), body);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    /** Worker heartbeat while judging a long job; 409 means the lease is gone, stop working on it. */
    @PostMapping("/judge/jobs/{id}/extend")
    public ResponseEntity<Map<String, Object>> extend(
            @RequestHeader(value = "X-Worker-Token", required = false) String token,
            @PathVariable UUID id,
            @RequestParam String workerId) {
        judge.checkWorkerToken(token);
        if (!judge.extendLease(id, workerId)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("ok", false));
        }
        return ResponseEntity.ok(Map.of("ok", true));
    }

    // ── Student run (custom input) ───────────────────────────────────────────

    public record RunRequest(String language, String sourceCode, String stdin, String problemId) {}

    @PostMapping("/runs")
    public ResponseEntity<Map<String, Object>> run(@RequestBody RunRequest req,
                                                   @AuthenticationPrincipal AuthContext ctx) {
        UUID problemId = (req.problemId() == null || req.problemId().isBlank())
            ? null : UUID.fromString(req.problemId());
        UUID id = judge.enqueueRun(ctx.userId(), req.language(), req.sourceCode(), req.stdin(), problemId);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of("id", id.toString(), "status", "QUEUED"));
    }

    @GetMapping("/runs/{id}")
    public ResponseEntity<Map<String, Object>> getRun(@PathVariable UUID id,
                                                      @AuthenticationPrincipal AuthContext ctx) {
        return ResponseEntity.ok(judge.getRun(id, ctx.userId()));
    }

    // ── Teacher view ─────────────────────────────────────────────────────────

    @GetMapping("/admin/judge/workers")
    public ResponseEntity<Map<String, Object>> workers(@AuthenticationPrincipal AuthContext ctx) {
        ctx.requireRole(User.Role.TEACHER, User.Role.ADMIN);
        List<Map<String, Object>> workers = judge.listWorkers();
        return ResponseEntity.ok(Map.of("workers", workers, "queue", judge.queueStats()));
    }
}
