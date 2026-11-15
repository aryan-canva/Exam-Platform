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
    private final com.codingexam.platform.service.AdminService admin;
    private final com.codingexam.platform.service.SessionKeyService keys;

    public SessionController(SessionService sessionService, com.codingexam.platform.service.AdminService admin,
                             com.codingexam.platform.service.SessionKeyService keys) {
        this.sessionService = sessionService;
        this.admin = admin;
        this.keys = keys;
    }

    @PostMapping("/start")
    public ResponseEntity<Map<String, Object>> startSession(@RequestBody Map<String, String> body,
                                                 @AuthenticationPrincipal AuthContext ctx) {
        UUID contestId   = UUID.fromString(body.get("contestId"));
        String deviceFp  = body.getOrDefault("deviceFp", "");
        String clientVer = body.getOrDefault("clientVersion", "unknown");
        Session session  = sessionService.startSession(contestId, ctx.userId(), deviceFp, clientVer);
        // The event-signing key is handed out here and nowhere else (heartbeat/end/get never repeat it).
        Map<String, Object> out = new java.util.LinkedHashMap<>(admin.sessionMap(session.getId()));
        out.put("sessionKey", keys.keyFor(session.getId()));
        return ResponseEntity.status(HttpStatus.CREATED).body(out);
    }

    @PostMapping("/{id}/heartbeat")
    public ResponseEntity<Map<String, Object>> heartbeat(@PathVariable UUID id,
                                              @RequestBody Map<String, Object> body,
                                              @AuthenticationPrincipal AuthContext ctx) {
        long seq = ((Number) body.get("seq")).longValue();
        Session session = sessionService.heartbeat(id, ctx.userId(), seq);
        return ResponseEntity.ok(admin.sessionMap(session.getId()));
    }

    @PostMapping("/{id}/end")
    public ResponseEntity<Map<String, Object>> endSession(@PathVariable UUID id,
                                               @AuthenticationPrincipal AuthContext ctx) {
        Session session = sessionService.endSession(id, ctx.userId());
        return ResponseEntity.ok(admin.sessionMap(session.getId()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getSession(@PathVariable UUID id,
                                               @AuthenticationPrincipal AuthContext ctx) {
        Session session = sessionService.getSession(id, ctx.userId());
        return ResponseEntity.ok(admin.sessionMap(session.getId()));
    }
}