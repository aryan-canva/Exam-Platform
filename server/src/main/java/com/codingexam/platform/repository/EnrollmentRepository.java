package com.codingexam.platform.repository;

import com.codingexam.platform.model.Enrollment;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface EnrollmentRepository extends JpaRepository<Enrollment, Enrollment.EnrollmentId> {
    List<Enrollment> findByContestId(UUID contestId);
    Optional<Enrollment> findByContestIdAndUserId(UUID contestId, UUID userId);
    boolean existsByContestIdAndUserId(UUID contestId, UUID userId);
}
