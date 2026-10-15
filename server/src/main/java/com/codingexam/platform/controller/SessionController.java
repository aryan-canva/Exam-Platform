package com.codingexam.platform.controller;

import com.codingexam.platform.model.Session;
import com.codingexam.platform.security.AuthContext;
import com.codingexam.platform.service.SessionService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/sessions")
public class SessionController {

    private final SessionService sessionService;

    public SessionController(SessionService sessionService) {
        this.sessionService = sessionService;
    }

    @PostMapping("/start")
    public ResponseEntity<Session> startSession(@RequestBody Map<String, String> body,
                                                 @AuthenticationPrincipal AuthContext ctx) {
        UUID contestId   = UUID.fromString(body.get("contestId"));
        String deviceFp  = body.getOrDefault("deviceFp", "");
        String clientVer = body.getOrDefault("clientVersion", "unknown");
        Session session  = sessionService.startSession(contestId, ctx.userId(), deviceFp, clientVer);
        return ResponseEntity.status(HttpStatus.CREATED).body(session);
    }

    @PostMapping("/{id}/heartbeat")
    public ResponseEntity<Session> heartbeat(@PathVariable UUID id,
                                              @RequestBody Map<String, Object> body,
                                              @AuthenticationPrincipal AuthContext ctx) {
        long seq = ((Number) body.get("seq")).longValue();
        Session session = sessionService.heartbeat(id, ctx.userId(), seq);
        return ResponseEntity.ok(session);
    }

    @PostMapping("/{id}/end")
    public ResponseEntity<Session> endSession(@PathVariable UUID id,
                                               @AuthenticationPrincipal AuthContext ctx) {
        Session session = sessionService.endSession(id, ctx.userId());
        return ResponseEntity.ok(session);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Session> getSession(@PathVariable UUID id,
                                               @AuthenticationPrincipal AuthContext ctx) {
        Session session = sessionService.getSession(id, ctx.userId());
        return ResponseEntity.ok(session);
    }
}