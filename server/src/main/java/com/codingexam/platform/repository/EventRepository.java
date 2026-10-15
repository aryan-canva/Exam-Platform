package com.codingexam.platform.repository;

import com.codingexam.platform.model.Event;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface EventRepository extends JpaRepository<Event, UUID> {

    List<Event> findBySessionIdOrderBySeqAsc(UUID sessionId);

    Optional<Event> findTopBySessionIdOrderBySeqDesc(UUID sessionId);

    int countBySessionIdAndType(UUID sessionId, String type);

    List<Event> findBySessionIdAndSeverity(UUID sessionId, String severity);
}