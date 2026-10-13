package com.codingexam.platform.controller;

import com.codingexam.platform.dto.request.CreateProblemRequest;
import com.codingexam.platform.dto.response.ProblemView;
import com.codingexam.platform.model.Problem;
import com.codingexam.platform.model.Testcase;
import com.codingexam.platform.model.User;
import com.codingexam.platform.security.AuthContext;
import com.codingexam.platform.service.ProblemService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/problems")
public class ProblemController {

    private final ProblemService problemService;

    public ProblemController(ProblemService problemService) {
        this.problemService = problemService;
    }

    /** POST /problems — create a problem */
    @PostMapping
    public ResponseEntity<Problem> createProblem(@Valid @RequestBody CreateProblemRequest req,
                                                   @AuthenticationPrincipal AuthContext ctx) {
        ctx.requireRole(User.Role.INSTRUCTOR, User.Role.ADMIN);
        Problem p = problemService.createProblem(req, ctx.userId());
        return ResponseEntity.status(HttpStatus.CREATED).body(p);
    }

    /** POST /problems/{id}/testcases — add a testcase */
    @PostMapping("/{id}/testcases")
    public ResponseEntity<Testcase> addTestcase(@PathVariable UUID id,
                                                 @RequestBody Map<String, Object> body,
                                                 @AuthenticationPrincipal AuthContext ctx) {
        ctx.requireRole(User.Role.INSTRUCTOR, User.Role.ADMIN);
        String inputRef    = (String) body.get("inputRef");
        String expectedRef = (String) body.get("expectedRef");
        int points         = (int) body.getOrDefault("points", 0);
        boolean isSample   = (boolean) body.getOrDefault("isSample", false);
        Integer groupNo    = body.containsKey("groupNo") ? (Integer) body.get("groupNo") : null;

        Testcase tc = problemService.addTestcase(id, inputRef, expectedRef, points, isSample, groupNo);
        return ResponseEntity.status(HttpStatus.CREATED).body(tc);
    }

    /** GET /problems/{id}?contestId={cid} — student view */
    @GetMapping("/{id}")
    public ResponseEntity<ProblemView> getProblemForStudent(@PathVariable UUID id,
                                                             @RequestParam UUID contestId,
                                                             @AuthenticationPrincipal AuthContext ctx) {
        ProblemView view = problemService.getProblemForStudent(id, contestId);
        return ResponseEntity.ok(view);
    }
}
