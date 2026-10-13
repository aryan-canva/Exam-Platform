package com.codingexam.platform.repository;

import com.codingexam.platform.model.Session;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface SessionRepository extends JpaRepository<Session, UUID> {
    Optional<Session> findByContestIdAndUserId(UUID contestId, UUID userId);
}
