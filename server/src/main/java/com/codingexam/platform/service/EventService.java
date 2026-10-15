package com.codingexam.platform.service;

import com.codingexam.platform.dto.request.IngestEventsRequest;
import com.codingexam.platform.model.Event;
import com.codingexam.platform.model.Session;
import com.codingexam.platform.repository.EventRepository;
import com.codingexam.platform.repository.SessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class EventService {

    private static final List<String> SUSPICIOUS_TYPES = List.of(
        "PASTE", "FOCUS_LOST", "TAB_SWITCH", "SCREENSHOT_ATTEMPT"
    );

    private final EventRepository eventRepo;
    private final SessionRepository sessionRepo;

    public EventService(EventRepository eventRepo, SessionRepository sessionRepo) {
        this.eventRepo   = eventRepo;
        this.sessionRepo = sessionRepo;
    }

    @Transactional
    public int ingestEvents(IngestEventsRequest req, UUID userId) {
        Session session = sessionRepo.findById(req.sessionId())
            .orElseThrow(() -> new NotFoundException("Session not found: " + req.sessionId()));

        if (!session.getUser().getId().equals(userId)) {
            throw new ForbiddenException("Session does not belong to this user");
        }
        if (session.getStatus() != Session.Status.ACTIVE) {
            throw new ConflictException("Session is not ACTIVE");
        }

        Optional<Event> lastEvent = eventRepo.findTopBySessionIdOrderBySeqDesc(req.sessionId());
        String expectedPrevHash = lastEvent.map(Event::getHash).orElse(null);
        long expectedNextSeq    = lastEvent.map(e -> e.getSeq() + 1).orElse(0L);

        int accepted = 0;
        for (IngestEventsRequest.EventDto dto : req.events()) {
            if (dto.seq() < expectedNextSeq) continue;

            Event event = new Event();
            event.setSession(session);
            event.setSeq(dto.seq());
            event.setType(dto.type());
            event.setSeverity(dto.severity() != null ? dto.severity() : "INFO");
            event.setTs(dto.ts());
            event.setPayloadJson(dto.payloadJson());
            event.setPrevHash(dto.prevHash());
            event.setHash(dto.hash());
            event.setHmac(dto.hmac());

            eventRepo.save(event);

            expectedPrevHash = dto.hash();
            expectedNextSeq  = dto.seq() + 1;
            accepted++;
        }

        return accepted;
    }

    @Transactional(readOnly = true)
    public List<Event> getEvents(UUID sessionId, UUID requestingUserId, boolean isInstructor) {
        if (!isInstructor) {
            Session session = sessionRepo.findById(sessionId)
                .orElseThrow(() -> new NotFoundException("Session not found: " + sessionId));
            if (!session.getUser().getId().equals(requestingUserId)) {
                throw new ForbiddenException("Cannot view another student's session events");
            }
        }
        return eventRepo.findBySessionIdOrderBySeqAsc(sessionId);
    }

    @Transactional(readOnly = true)
    public int getSuspiciousEventCount(UUID sessionId) {
        return SUSPICIOUS_TYPES.stream()
            .mapToInt(type -> eventRepo.countBySessionIdAndType(sessionId, type))
            .sum();
    }

    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String msg) { super(msg); }
    }
    public static class ConflictException extends RuntimeException {
        public ConflictException(String msg) { super(msg); }
    }
    public static class ForbiddenException extends RuntimeException {
        public ForbiddenException(String msg) { super(msg); }
    }
}