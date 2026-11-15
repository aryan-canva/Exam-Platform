package com.codingexam.platform.service;

import com.codingexam.platform.dto.request.IngestEventsRequest;
import com.codingexam.platform.dto.request.IngestEventsRequest.EventDto;
import com.codingexam.platform.model.Contest;
import com.codingexam.platform.model.Event;
import com.codingexam.platform.model.Session;
import com.codingexam.platform.model.User;
import com.codingexam.platform.repository.EventRepository;
import com.codingexam.platform.repository.SessionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.time.Instant;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Runs the real EventService against in-memory fakes of the two repositories (java.lang.reflect.Proxy, no Mockito, no database).
 * There is no transaction here, so "nothing is kept after a rejected batch" is NOT tested at this level; that rule is the
 * @Transactional rollback and is covered by the mock-server rules and by tools/integration-test.mjs against the real server.
 */
class EventServiceIngestTest {

    static final String SECRET = "test-secret-test-secret-test-secret-1234";
    final UUID sid = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    final UUID uid = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    List<Event> store;
    Session session;
    EventService svc;
    String key;

    @BeforeEach
    void setUp() {
        store = new ArrayList<>();
        User u = new User(); u.setId(uid);
        session = new Session(); session.setId(sid); session.setUser(u); session.setContest(new Contest()); session.setStatus(Session.Status.ACTIVE);
        key = EventChain.sessionKey(SECRET, sid);

        EventRepository events = (EventRepository) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{EventRepository.class}, (p, m, a) -> switch (m.getName()) {
            case "findTopBySessionIdOrderBySeqDesc" -> store.stream().max(Comparator.comparingLong(Event::getSeq));
            case "findBySessionIdAndSeq" -> store.stream().filter(e -> e.getSeq() == (long) a[1]).findFirst();
            case "findBySessionIdOrderBySeqAsc" -> store.stream().sorted(Comparator.comparingLong(Event::getSeq)).toList();
            case "countBySessionIdAndType" -> (int) store.stream().filter(e -> e.getType().equals(a[1])).count();
            case "save" -> { store.add((Event) a[0]); yield a[0]; }
            default -> throw new UnsupportedOperationException(m.getName());
        });
        SessionRepository sessions = (SessionRepository) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{SessionRepository.class}, (p, m, a) ->
            (m.getName().equals("findByIdForUpdate") || m.getName().equals("findById")) ? (a[0].equals(sid) ? Optional.of(session) : Optional.empty()) : null);
        svc = new EventService(events, sessions, new SessionKeyService(SECRET));
    }

    /** A signed chain of n events, built the way the watchdog builds it. */
    List<EventDto> chain(int n, String key) {
        List<EventDto> out = new ArrayList<>();
        String prev = EventChain.GENESIS;
        for (int i = 0; i < n; i++) {
            String type = i == 0 ? "WATCHDOG_STARTED" : "PASTE", sev = i == 0 ? "INFO" : "MEDIUM", ts = "2026-11-13T10:00:0" + i + ".000Z", payload = "{\"i\":" + i + "}";
            String h = EventChain.hash(prev, type, sev, ts, payload);
            out.add(new EventDto(i, type, sev, ts, payload, prev, h, EventChain.hmacHex(key, h)));
            prev = h;
        }
        return out;
    }

    IngestEventsRequest req(List<EventDto> e) { return new IngestEventsRequest(sid, e); }

    @Test
    void acceptsAValidChainInPieces() {
        List<EventDto> c = chain(5, key);
        assertEquals(new EventService.IngestResult(2, 0, 2), svc.ingestEvents(req(c.subList(0, 2)), uid));
        assertEquals(new EventService.IngestResult(3, 0, 5), svc.ingestEvents(req(c.subList(2, 5)), uid));
        assertEquals(5, store.size());
        assertEquals("{\"i\":3}", store.get(3).getPayloadRaw());
        assertEquals(Instant.parse("2026-11-13T10:00:03.000Z"), store.get(3).getTs());
    }

    @Test
    void firstEventMustBeSeqZero() {
        var ex = assertThrows(EventService.IntegrityException.class, () -> svc.ingestEvents(req(chain(3, key).subList(1, 3)), uid));
        assertTrue(ex.getMessage().contains("expected seq 0"), ex.getMessage());
        assertEquals(0, store.size());
    }

    @Test
    void gapIsRejected() {
        List<EventDto> c = chain(5, key);
        svc.ingestEvents(req(c.subList(0, 2)), uid);
        var ex = assertThrows(EventService.IntegrityException.class, () -> svc.ingestEvents(req(List.of(c.get(3))), uid));
        assertTrue(ex.getMessage().contains("expected seq 2"), ex.getMessage());
        assertEquals(2, store.size());
    }

    @Test
    void wrongPrevHashIsRejected() {
        List<EventDto> c = new ArrayList<>(chain(2, key));
        EventDto e = c.get(1);
        c.set(1, new EventDto(e.seq(), e.type(), e.severity(), e.ts(), e.payloadJson(), "1".repeat(64), e.hash(), e.hmac()));
        var ex = assertThrows(EventService.IntegrityException.class, () -> svc.ingestEvents(req(c), uid));
        assertTrue(ex.getMessage().contains("prevHash"), ex.getMessage());
    }

    @Test
    void editedPayloadIsRejected() {
        List<EventDto> c = new ArrayList<>(chain(2, key));
        EventDto e = c.get(1);
        c.set(1, new EventDto(e.seq(), e.type(), e.severity(), e.ts(), "{\"i\":99}", e.prevHash(), e.hash(), e.hmac()));
        var ex = assertThrows(EventService.IntegrityException.class, () -> svc.ingestEvents(req(c), uid));
        assertTrue(ex.getMessage().contains("hash does not match"), ex.getMessage());
    }

    @Test
    void rehashedPayloadWithoutTheKeyIsRejected() {
        List<EventDto> c = new ArrayList<>(chain(1, key));
        EventDto e = c.get(0);
        String h = EventChain.hash(e.prevHash(), e.type(), e.severity(), e.ts(), "{\"i\":7}");
        c.set(0, new EventDto(0, e.type(), e.severity(), e.ts(), "{\"i\":7}", e.prevHash(), h, e.hmac()));
        var ex = assertThrows(EventService.IntegrityException.class, () -> svc.ingestEvents(req(c), uid));
        assertTrue(ex.getMessage().contains("HMAC invalid"), ex.getMessage());
    }

    @Test
    void wrongKeyIsRejected_ownKeyAndOtherSessionsKey() {
        var own = assertThrows(EventService.IntegrityException.class, () -> svc.ingestEvents(req(chain(1, "ab".repeat(32))), uid));
        assertTrue(own.getMessage().contains("HMAC invalid"));
        String other = EventChain.sessionKey(SECRET, UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"));
        assertThrows(EventService.IntegrityException.class, () -> svc.ingestEvents(req(chain(1, other)), uid));
    }

    @Test
    void retryIsIdempotentButADifferentEventForAStoredSeqIsTampering() {
        List<EventDto> c = chain(3, key);
        svc.ingestEvents(req(c), uid);
        assertEquals(new EventService.IngestResult(0, 2, 3), svc.ingestEvents(req(c.subList(1, 3)), uid));
        EventDto e = c.get(1);
        String h = EventChain.hash(e.prevHash(), e.type(), e.severity(), e.ts(), "{\"i\":5}");
        EventDto swapped = new EventDto(1, e.type(), e.severity(), e.ts(), "{\"i\":5}", e.prevHash(), h, EventChain.hmacHex(key, h));
        var ex = assertThrows(EventService.IntegrityException.class, () -> svc.ingestEvents(req(List.of(swapped)), uid));
        assertTrue(ex.getMessage().contains("different hash"), ex.getMessage());
        assertEquals(3, store.size());
    }

    @Test
    void malformedFieldsAreRejected() {
        EventDto e = chain(1, key).get(0);
        assertThrows(EventService.IntegrityException.class, () -> svc.ingestEvents(req(List.of(new EventDto(0, "paste", "INFO", e.ts(), e.payloadJson(), e.prevHash(), e.hash(), e.hmac()))), uid));
        assertThrows(EventService.IntegrityException.class, () -> svc.ingestEvents(req(List.of(new EventDto(0, e.type(), "URGENT", e.ts(), e.payloadJson(), e.prevHash(), e.hash(), e.hmac()))), uid));
        assertThrows(EventService.IntegrityException.class, () -> svc.ingestEvents(req(List.of(new EventDto(0, e.type(), e.severity(), "2026-11-13T10:00:00Z", e.payloadJson(), e.prevHash(), e.hash(), e.hmac()))), uid));
    }

    @Test
    void sessionRulesStillApply() {
        assertThrows(EventService.ForbiddenException.class, () -> svc.ingestEvents(req(chain(1, key)), UUID.randomUUID()));
        session.setStatus(Session.Status.ENDED);
        assertThrows(EventService.ConflictException.class, () -> svc.ingestEvents(req(chain(1, key)), uid));
        assertThrows(EventService.NotFoundException.class, () -> svc.ingestEvents(new IngestEventsRequest(UUID.randomUUID(), chain(1, key)), uid));
    }

    @Test
    void suspiciousCountIncludesWatchdogTypes() {
        for (String t : List.of("PROCESS_BLOCKED", "KIOSK_EXIT_ATTEMPT", "APP_EXITED", "PASTE", "FOCUS_LOST", "WD_HEARTBEAT", "FOCUS_BACK")) {
            Event e = new Event(); e.setType(t); store.add(e);
        }
        assertEquals(5, svc.getSuspiciousEventCount(sid));
    }

    @Test
    void getEventsReturnsPlainMapsWithoutHmacOrSession() {
        svc.ingestEvents(req(chain(2, key)), uid);
        List<Map<String, Object>> out = svc.getEvents(sid, UUID.randomUUID(), true);
        assertEquals(2, out.size());
        assertEquals("2026-11-13T10:00:01.000Z", out.get(1).get("ts"));
        assertEquals("{\"i\":1}", out.get(1).get("payloadJson"));
        assertFalse(out.get(0).containsKey("hmac"));
        assertFalse(out.get(0).containsKey("session"));
        assertThrows(EventService.ForbiddenException.class, () -> svc.getEvents(sid, UUID.randomUUID(), false));
    }
}
