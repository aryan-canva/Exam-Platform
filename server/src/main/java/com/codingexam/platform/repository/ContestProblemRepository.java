package com.codingexam.platform.repository;

import com.codingexam.platform.model.ContestProblem;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface ContestProblemRepository extends JpaRepository<ContestProblem, ContestProblem.ContestProblemId> {
    List<ContestProblem> findByContestId(UUID contestId);
    boolean existsByContestIdAndProblemId(UUID contestId, UUID problemId);
}
