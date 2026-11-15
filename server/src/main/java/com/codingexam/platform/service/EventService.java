package com.codingexam.platform.service;

import com.codingexam.platform.dto.request.IngestEventsRequest;
import com.codingexam.platform.model.Event;
import com.codingexam.platform.model.Session;
import com.codingexam.platform.repository.EventRepository;
import com.codingexam.platform.repository.SessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class EventService {

    /** Event types a teacher should look at. Used by the per-session count and the per-contest summary. */
    public static final List<String> SUSPICIOUS_TYPES = List.of(
        "PASTE", "FOCUS_LOST", "TAB_SWITCH", "SCREENSHOT_ATTEMPT",
        "PROCESS_BLOCKED", "KIOSK_EXIT_ATTEMPT", "APP_EXITED"
    );

    private static final DateTimeFormatter ISO_MS =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    private final EventRepository eventRepo;
    private final SessionRepository sessionRepo;
    private final SessionKeyService keys;

    public EventService(EventRepository eventRepo, SessionRepository sessionRepo, SessionKeyService keys) {
        this.eventRepo   = eventRepo;
        this.sessionRepo = sessionRepo;
        this.keys        = keys;
    }

    public record IngestResult(int accepted, int duplicates, long nextSeq) {}

    /**
     * All-or-nothing. Each event must be exactly the next one in the session's chain:
     * seq = last+1 (first is 0), prevHash = hash of the last event (first is 64 zeros), hash recomputed from the
     * content, HMAC made with this session's key. A seq that is already stored is accepted silently only if its hash
     * is identical (a retry after a lost response); a different hash for a stored seq is tampering.
     */
    @Transactional
    public IngestResult ingestEvents(IngestEventsRequest req, UUID userId) {
        Session session = sessionRepo.findByIdForUpdate(req.sessionId())
            .orElseThrow(() -> new NotFoundException("Session not found: " + req.sessionId()));

        if (!session.getUser().getId().equals(userId)) {
            throw new ForbiddenException("Session does not belong to this user");
        }
        if (session.getStatus() != Session.Status.ACTIVE) {
            throw new ConflictException("Session is not ACTIVE");
        }

        Optional<Event> lastEvent = eventRepo.findTopBySessionIdOrderBySeqDesc(req.sessionId());
        String prevHash  = lastEvent.map(Event::getHash).orElse(EventChain.GENESIS);
        long nextSeq     = lastEvent.map(e -> e.getSeq() + 1).orElse(0L);
        String key       = keys.keyFor(session.getId());

        int accepted = 0, duplicates = 0;
        for (IngestEventsRequest.EventDto dto : req.events()) {
            String severity = dto.severity() != null ? dto.severity() : "INFO";
            if (!EventChain.validType(dto.type()))          throw bad(dto, "invalid type");
            if (!EventChain.SEVERITIES.contains(severity))  throw bad(dto, "invalid severity");
            if (!EventChain.validTs(dto.ts()))              throw bad(dto, "ts must be yyyy-MM-ddTHH:mm:ss.SSSZ");
            if (!EventChain.validHash(dto.prevHash()) || !EventChain.validHash(dto.hash()) || !EventChain.validHash(dto.hmac()))
                throw bad(dto, "prevHash, hash and hmac must be 64 lower-case hex characters");

            if (dto.seq() < nextSeq) {
                Event stored = eventRepo.findBySessionIdAndSeq(req.sessionId(), dto.seq())
                    .orElseThrow(() -> bad(dto, "seq is behind the chain but not stored"));
                if (!stored.getHash().equals(dto.hash())) throw bad(dto, "seq already stored with a different hash");
                duplicates++;
                continue;
            }
            if (dto.seq() != nextSeq)                       throw bad(dto, "expected seq " + nextSeq);
            if (!prevHash.equals(dto.prevHash()))           throw bad(dto, "prevHash does not match the previous event");

            String hash = EventChain.hash(dto.prevHash(), dto.type(), severity, dto.ts(), dto.payloadJson());
            if (!hash.equals(dto.hash()))                   throw bad(dto, "hash does not match the event content");
            if (!EventChain.constantTimeEquals(EventChain.hmacHex(key, hash), dto.hmac()))
                throw bad(dto, "HMAC invalid");

            Event event = new Event();
            event.setSession(session);
            event.setSeq(dto.seq());
            event.setType(dto.type());
            event.setSeverity(severity);
            event.setTs(Instant.parse(dto.ts()));
            event.setPayloadJson(dto.payloadJson());
            event.setPayloadRaw(dto.payloadJson());
            event.setPrevHash(dto.prevHash());
            event.setHash(dto.hash());
            event.setHmac(dto.hmac());
            eventRepo.save(event);

            prevHash = hash;
            nextSeq++;
            accepted++;
        }
        return new IngestResult(accepted, duplicates, nextSeq);
    }

    private static IntegrityException bad(IngestEventsRequest.EventDto dto, String why) {
        return new IntegrityException("Event seq " + dto.seq() + " rejected: " + why);
    }

    /** Plain maps, not entities: the entity's lazy session proxy must never reach the JSON serializer. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> getEvents(UUID sessionId, UUID requestingUserId, boolean isInstructor) {
        if (!isInstructor) {
            Session session = sessionRepo.findById(sessionId)
                .orElseThrow(() -> new NotFoundException("Session not found: " + sessionId));
            if (!session.getUser().getId().equals(requestingUserId)) {
                throw new ForbiddenException("Cannot view another student's session events");
            }
        }
        return eventRepo.findBySessionIdOrderBySeqAsc(sessionId).stream().map(e -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("seq", e.getSeq());
            m.put("type", e.getType());
            m.put("severity", e.getSeverity());
            m.put("ts", ISO_MS.format(e.getTs()));
            m.put("payloadJson", e.getPayloadRaw() != null ? e.getPayloadRaw() : e.getPayloadJson());
            m.put("hash", e.getHash());
            m.put("receivedAt", e.getReceivedAt() != null ? ISO_MS.format(e.getReceivedAt()) : null);
            return m;
        }).toList();
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
    /** Broken chain, bad HMAC or malformed event. Mapped to 400; the watchdog treats it as final and keeps its copy locally. */
    public static class IntegrityException extends RuntimeException {
        public IntegrityException(String msg) { super(msg); }
    }
}
