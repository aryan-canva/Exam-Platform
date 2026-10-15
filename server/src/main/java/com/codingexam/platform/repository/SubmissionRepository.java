package com.codingexam.platform.repository;

import com.codingexam.platform.model.Submission;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface SubmissionRepository extends JpaRepository<Submission, UUID> {

    List<Submission> findByContestIdAndUserId(UUID contestId, UUID userId);

    List<Submission> findByContestIdAndProblemId(UUID contestId, UUID problemId);

    List<Submission> findByContestId(UUID contestId);

    @Query("""
        SELECT s FROM Submission s
        WHERE s.contest.id = :contestId
          AND s.verdict = 'ACCEPTED'
        ORDER BY s.createdAt ASC
        """)
    List<Submission> findAcceptedByContest(@Param("contestId") UUID contestId);

    int countBySessionId(UUID sessionId);
}