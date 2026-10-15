package com.codingexam.platform.controller;

import com.codingexam.platform.dto.request.IngestEventsRequest;
import com.codingexam.platform.model.Event;
import com.codingexam.platform.model.User;
import com.codingexam.platform.security.AuthContext;
import com.codingexam.platform.service.EventService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/events")
public class EventController {

    private final EventService eventService;

    public EventController(EventService eventService) {
        this.eventService = eventService;
    }

    @PostMapping("/ingest")
    public ResponseEntity<Map<String, Integer>> ingest(
            @Valid @RequestBody IngestEventsRequest req,
            @AuthenticationPrincipal AuthContext ctx) {
        int accepted = eventService.ingestEvents(req, ctx.userId());
        return ResponseEntity.ok(Map.of("accepted", accepted));
    }

    @GetMapping
    public ResponseEntity<List<Event>> getEvents(
            @RequestParam UUID sessionId,
            @AuthenticationPrincipal AuthContext ctx) {
        boolean isInstructor = ctx.hasRole(User.Role.INSTRUCTOR, User.Role.ADMIN);
        List<Event> events = eventService.getEvents(sessionId, ctx.userId(), isInstructor);
        return ResponseEntity.ok(events);
    }

    @GetMapping("/suspicious")
    public ResponseEntity<Map<String, Integer>> getSuspicious(
            @RequestParam UUID sessionId,
            @AuthenticationPrincipal AuthContext ctx) {
        ctx.requireRole(User.Role.INSTRUCTOR, User.Role.ADMIN);
        int count = eventService.getSuspiciousEventCount(sessionId);
        return ResponseEntity.ok(Map.of("suspiciousEvents", count));
    }
}