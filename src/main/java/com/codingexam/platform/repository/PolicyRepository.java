package com.codingexam.platform.repository;

import com.codingexam.platform.model.Policy;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface PolicyRepository extends JpaRepository<Policy, UUID> {
    Optional<Policy> findTopByContestIdOrderByVersionDesc(UUID contestId);
}
